#!/usr/bin/env python3
"""Extract the 126 Crystal Eye planar silhouettes from the approved photo.

The script reads colour silhouettes only. It never performs OCR and never
changes pixel identity or shape flags. The updated configuration is emitted on
stdout so the repository file can be reviewed before it is replaced.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image


def connected_components(mask: np.ndarray, kind: str) -> list[tuple[np.ndarray, str]]:
    height, width = mask.shape
    seen = np.zeros(mask.shape, dtype=bool)
    result: list[tuple[np.ndarray, str]] = []
    for row, column in zip(*np.nonzero(mask)):
        if seen[row, column]:
            continue
        stack = [(int(row), int(column))]
        seen[row, column] = True
        points: list[tuple[int, int]] = []
        while stack:
            y, x = stack.pop()
            points.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                next_y, next_x = y + dy, x + dx
                if (
                    0 <= next_y < height
                    and 0 <= next_x < width
                    and mask[next_y, next_x]
                    and not seen[next_y, next_x]
                ):
                    seen[next_y, next_x] = True
                    stack.append((next_y, next_x))
        if len(points) > 200:
            result.append((np.asarray(points, dtype=float), kind))
    return result


def split_merged_component(
    components: list[tuple[np.ndarray, str]],
) -> list[tuple[np.ndarray, str]]:
    result: list[tuple[np.ndarray, str]] = []
    split_count = 0
    for points, kind in components:
        if kind != "gray" or len(points) <= 5_000:
            result.append((points, kind))
            continue
        xy = points[:, [1, 0]]
        centers = np.asarray(
            [xy[np.argmin(xy[:, 1])], xy[np.argmax(xy[:, 1])]],
            dtype=float,
        )
        for _ in range(64):
            labels = ((xy[:, None, :] - centers[None, :, :]) ** 2).sum(2).argmin(1)
            updated = np.asarray([xy[labels == index].mean(0) for index in range(2)])
            if np.max(np.abs(updated - centers)) < 1e-12:
                break
            centers = updated
        for index in range(2):
            result.append((xy[labels == index][:, [1, 0]], kind))
        split_count += 1
    if split_count != 1:
        raise ValueError(f"Expected one merged gray silhouette, found {split_count}.")
    return result


def convex_hull(points: np.ndarray) -> list[tuple[int, int]]:
    unique = sorted(set(map(tuple, points[:, [1, 0]].astype(int))))

    def cross(origin, first, second):
        return (first[0] - origin[0]) * (second[1] - origin[1]) - (
            first[1] - origin[1]
        ) * (second[0] - origin[0])

    lower: list[tuple[int, int]] = []
    for point in unique:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    upper: list[tuple[int, int]] = []
    for point in reversed(unique):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    return lower[:-1] + upper[:-1]


def css_hex_rotation(points: np.ndarray) -> float:
    hull = convex_hull(points)
    circular_sum = 0j
    for index, point in enumerate(hull):
        following = hull[(index + 1) % len(hull)]
        dx, dy = following[0] - point[0], following[1] - point[1]
        length = math.hypot(dx, dy)
        if length >= 3:
            circular_sum += length * np.exp(1j * 6 * math.atan2(dy, dx))
    degrees = math.degrees(np.angle(circular_sum) / 6)
    return (degrees + 60) % 60


def hungarian(cost: list[list[float]]) -> list[int]:
    matrix = np.asarray(cost, dtype=float)
    row_count, column_count = matrix.shape
    if row_count != column_count:
        raise ValueError("Assignment matrix must be square.")
    row_potentials = np.zeros(row_count + 1)
    column_potentials = np.zeros(column_count + 1)
    column_matches = np.zeros(column_count + 1, dtype=int)
    previous_columns = np.zeros(column_count + 1, dtype=int)
    for row in range(1, row_count + 1):
        column_matches[0] = row
        current_column = 0
        minimum_costs = np.full(column_count + 1, np.inf)
        used_columns = np.zeros(column_count + 1, dtype=bool)
        while True:
            used_columns[current_column] = True
            current_row = int(column_matches[current_column])
            delta = np.inf
            next_column = 0
            for column in range(1, column_count + 1):
                if used_columns[column]:
                    continue
                reduced = (
                    matrix[current_row - 1, column - 1]
                    - row_potentials[current_row]
                    - column_potentials[column]
                )
                if reduced < minimum_costs[column]:
                    minimum_costs[column] = reduced
                    previous_columns[column] = current_column
                if minimum_costs[column] < delta:
                    delta = minimum_costs[column]
                    next_column = column
            for column in range(column_count + 1):
                if used_columns[column]:
                    row_potentials[int(column_matches[column])] += delta
                    column_potentials[column] -= delta
                else:
                    minimum_costs[column] -= delta
            current_column = next_column
            if column_matches[current_column] == 0:
                break
        while True:
            previous = int(previous_columns[current_column])
            column_matches[current_column] = column_matches[previous]
            current_column = previous
            if current_column == 0:
                break
    assignment = [-1] * row_count
    for column in range(1, column_count + 1):
        assignment[int(column_matches[column]) - 1] = column - 1
    return assignment


def extract_photo_cells(photo_path: Path) -> list[dict[str, float | str]]:
    image = np.asarray(Image.open(photo_path).convert("RGB"))
    height, width = image.shape[:2]
    red, green, blue = [image[:, :, index].astype(float) for index in range(3)]
    components = connected_components(
        (red > 70) & (red > 1.35 * green) & (red > 1.18 * blue), "red"
    )
    components += connected_components(
        (blue > 75) & (blue > 1.08 * red) & (blue > 1.03 * green), "gray"
    )
    components += connected_components(
        (green > 45) & (green > 1.2 * red) & (green > 1.05 * blue), "gray"
    )
    components = split_merged_component(components)
    cells: list[dict[str, float | str]] = []
    for points, kind in components:
        center = points[:, [1, 0]].mean(0)
        cells.append(
            {
                "x": 100 * float(center[0]) / width,
                "y": 100 * float(center[1]) / height,
                "rotationDeg": css_hex_rotation(points),
                "kind": kind,
            }
        )
    counts = Counter(cell["kind"] for cell in cells)
    if len(cells) != 126 or counts != {"gray": 96, "red": 30}:
        raise ValueError(f"Unexpected silhouette counts: total={len(cells)}, {counts}.")
    return cells


def map_cells(configuration: dict, photo: list[dict[str, float | str]]):
    baseline = configuration["pixels"]
    mapping: dict[int, int] = {}
    confidence: list[dict[str, float | int | str]] = []
    for kind, group_count, group_size, start in (
        ("gray", 6, 16, 0),
        ("red", 10, 3, 96),
    ):
        photo_indices = [i for i, cell in enumerate(photo) if cell["kind"] == kind]
        centroids = []
        for group in range(group_count):
            members = baseline[start + group * group_size : start + (group + 1) * group_size]
            centroids.append(
                (
                    sum(cell["x"] for cell in members) / group_size,
                    sum(cell["y"] for cell in members) / group_size,
                )
            )
        capacity_slots = [
            (group, position)
            for group in range(group_count)
            for position in range(group_size)
        ]
        group_assignment = hungarian(
            [
                [
                    (float(photo[index]["x"]) - centroids[group][0]) ** 2
                    + (float(photo[index]["y"]) - centroids[group][1]) ** 2
                    for group, _ in capacity_slots
                ]
                for index in photo_indices
            ]
        )
        groups: list[list[int]] = [[] for _ in range(group_count)]
        for photo_row, capacity_column in enumerate(group_assignment):
            groups[capacity_slots[capacity_column][0]].append(photo_indices[photo_row])
        if [len(group) for group in groups] != [group_size] * group_count:
            raise ValueError(f"Unbalanced {kind} groups.")

        for group_index, group in enumerate(groups):
            baseline_indices = list(
                range(
                    start + group_index * group_size,
                    start + (group_index + 1) * group_size,
                )
            )
            scale_x = scale_y = 1.0
            offset_x = offset_y = 0.0
            assignment: list[int] = []
            for _ in range(8):
                assignment = hungarian(
                    [
                        [
                            (
                                baseline[baseline_index]["x"]
                                - (scale_x * float(photo[photo_index]["x"]) + offset_x)
                            )
                            ** 2
                            + (
                                baseline[baseline_index]["y"]
                                - (scale_y * float(photo[photo_index]["y"]) + offset_y)
                            )
                            ** 2
                            for photo_index in group
                        ]
                        for baseline_index in baseline_indices
                    ]
                )
                x = np.asarray([float(photo[group[index]]["x"]) for index in assignment])
                y = np.asarray([float(photo[group[index]]["y"]) for index in assignment])
                target_x = np.asarray([baseline[index]["x"] for index in baseline_indices])
                target_y = np.asarray([baseline[index]["y"] for index in baseline_indices])
                scale_x, offset_x = np.linalg.lstsq(
                    np.c_[x, np.ones(len(x))], target_x, rcond=None
                )[0]
                scale_y, offset_y = np.linalg.lstsq(
                    np.c_[y, np.ones(len(y))], target_y, rcond=None
                )[0]
            errors = []
            for row, baseline_index in enumerate(baseline_indices):
                photo_index = group[assignment[row]]
                mapping[baseline_index] = photo_index
                errors.append(
                    math.hypot(
                        baseline[baseline_index]["x"]
                        - (scale_x * float(photo[photo_index]["x"]) + offset_x),
                        baseline[baseline_index]["y"]
                        - (scale_y * float(photo[photo_index]["y"]) + offset_y),
                    )
                )
            confidence.append(
                {
                    "kind": kind,
                    "group": group_index,
                    "rmsePercentagePoints": math.sqrt(
                        sum(error * error for error in errors) / len(errors)
                    ),
                    "maximumPercentagePoints": max(errors),
                }
            )
    return mapping, confidence


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("photo", type=Path)
    parser.add_argument("configuration", type=Path)
    parser.add_argument("--report", action="store_true")
    arguments = parser.parse_args()
    configuration = json.loads(arguments.configuration.read_text())
    original_contract = [
        (pixel["index"], pixel["id"], pixel.get("secondaryId"), pixel["isSeam"], pixel["isPentagon"])
        for pixel in configuration["pixels"]
    ]
    photo = extract_photo_cells(arguments.photo)
    mapping, confidence = map_cells(configuration, photo)
    for geometry_slot, pixel in enumerate(configuration["pixels"]):
        detected = photo[mapping[geometry_slot]]
        pixel["x"] = round(float(detected["x"]), 4)
        pixel["y"] = round(float(detected["y"]), 4)
        if pixel["isPentagon"]:
            pixel["rotationDeg"] = 180 if geometry_slot == 6 else 0
        else:
            pixel["rotationDeg"] = round(float(detected["rotationDeg"]), 1)
    updated_contract = [
        (pixel["index"], pixel["id"], pixel.get("secondaryId"), pixel["isSeam"], pixel["isPentagon"])
        for pixel in configuration["pixels"]
    ]
    if updated_contract != original_contract:
        raise ValueError("Identity or shape contract changed during photo alignment.")
    if arguments.report:
        json.dump({"centers": len(photo), "counts": {"gray": 96, "red": 30}, "confidence": confidence}, sys.stderr, indent=2)
        sys.stderr.write("\n")
    json.dump(configuration, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
