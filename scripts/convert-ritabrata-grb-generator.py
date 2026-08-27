#!/usr/bin/env python3
"""Convert Ritabrata's CEGenGRB ROOT database into compact response kernels.

Tool-only dependencies: numpy and uproot. The supplied C++ and binaries are
never compiled or executed. Generated assets are intentionally written only to
the operator-selected output directory; this script does not publish them.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
import struct
from typing import Any

try:
    import numpy as np
    import uproot
except ImportError as error:  # pragma: no cover
    raise SystemExit(
        "Install the pinned tool-only requirements before running this converter."
    ) from error


PIXEL_COUNT = 126
EXPECTED_DIRECTION_COUNT = 985
PRIMARY_BIN_COUNT = 100
DEPOSITED_BIN_COUNT = 100
SOURCE_AREA_CM2 = 4 * 18 * 18
ASSET_VERSION = "ritabrata-cegengrb-nearest-template-v1-candidate"
DIRECTION_FRAME = "RITABRATA_ROOT_PLUS_Z_POLAR_PHI_ATAN2_Y_X"
REQUIRED_FILES = (
    "CEGenGRB.cc",
    "srcpos-sam-set7.txt",
    "sampleDataSet.root",
    "sampleSrc_41_117.root",
)
GOOGLE_DRIVE_FILE_IDS = {
    "CEGenGRB.cc": "1arh3EdEkcH33qdkS66CWwxUJY0a2xklb",
    "srcpos-sam-set7.txt": "1F0jwd-cts6Hteg9Xq0mI1mDA7RbLdpxl",
    "sampleDataSet.root": "1DymlekOoLOQkq0vE9fH0bahN3j7c-2eH",
    "sampleSrc_41_117.root": "1bZsJJoXEzNTOFRlFiV75N4VkkItvu82y",
}
KERNEL_LAYOUTS = {
    "pixelMean": "primary-energy,pixel",
    "pixelVariance": "primary-energy,pixel",
    "depositedEnergyMean": "primary-energy,deposited-energy",
    "depositedEnergyVariance": "primary-energy,deposited-energy",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_hash(source_hashes: dict[str, str]) -> str:
    payload = json.dumps(source_hashes, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()


def finite_list(values: Any) -> list[float]:
    array = np.asarray(values, dtype=np.float64)
    if not np.isfinite(array).all():
        raise ValueError("Encountered a non-finite value.")
    return array.tolist()


def load_directions(path: Path) -> list[dict[str, Any]]:
    directions: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        fields = raw_line.split()
        if not fields:
            continue
        if len(fields) != 3:
            raise ValueError(f"Malformed direction row {line_number}.")
        source_id, theta_text, phi_text = fields
        theta = np.float32(theta_text)
        phi = np.float32(phi_text)
        if not (np.isfinite(theta) and np.isfinite(phi) and 0 <= theta <= 90):
            raise ValueError(f"Invalid direction row {line_number}.")
        response_key = f"{int(theta)}_{int(phi)}"
        directions.append({
            "sourceId": source_id,
            "thetaDeg": float(theta),
            "phiDeg": float(phi),
            "responseKey": response_key,
        })
    if len(directions) != EXPECTED_DIRECTION_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_DIRECTION_COUNT} directions, got {len(directions)}. "
            "The supplied email stated 984; the acquired file contains 985."
        )
    if len({row["sourceId"] for row in directions}) != len(directions):
        raise ValueError("Direction source IDs are not unique.")
    if len({row["responseKey"] for row in directions}) != len(directions):
        raise ValueError("Integer-truncated ROOT response keys are not unique.")
    return directions


def histogram_with_axes(root_file: Any, name: str) -> tuple[np.ndarray, np.ndarray]:
    histogram = root_file[name]
    values = np.asarray(histogram.values(), dtype=np.float64)
    edges = np.asarray(histogram.axis().edges(), dtype=np.float64)
    if values.shape != (PRIMARY_BIN_COUNT,) or edges.shape != (PRIMARY_BIN_COUNT + 1,):
        raise ValueError(f"Unexpected dimensions for {name}.")
    if not np.isfinite(values).all() or np.any(values <= 0):
        raise ValueError(f"{name} must contain positive finite primary counts.")
    if not np.all(np.diff(edges) > 0):
        raise ValueError(f"{name} energy edges are not strictly increasing.")
    return values, edges


def aggregate_direction(
    tree: Any,
    primary_counts: np.ndarray,
    primary_edges: np.ndarray,
    deposited_edges: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    arrays = tree.arrays(
        ["peng", "totEdep", "pixEdep[px]", "pixID[px]"],
        library="np",
    )
    primary_energy = np.asarray(arrays["peng"], dtype=np.float64)
    total_deposited = np.asarray(arrays["totEdep"], dtype=np.float64)
    pixel_energy = arrays["pixEdep[px]"]
    pixel_ids = arrays["pixID[px]"]
    if not (
        primary_energy.shape == total_deposited.shape == pixel_energy.shape == pixel_ids.shape
    ):
        raise ValueError("Tree branch entry counts differ.")
    if not np.isfinite(primary_energy).all() or not np.isfinite(total_deposited).all():
        raise ValueError("Tree contains non-finite scalar energies.")
    if np.any(total_deposited <= 0):
        raise ValueError("Tree contains a non-positive total deposited energy.")

    primary_indices = np.searchsorted(primary_edges, primary_energy, side="right") - 1
    primary_indices[primary_energy == primary_edges[-1]] = PRIMARY_BIN_COUNT - 1
    if np.any(primary_indices < 0) or np.any(primary_indices >= PRIMARY_BIN_COUNT):
        raise ValueError("Primary energy outside hPeng axes.")
    inverse_primary_counts = 1.0 / primary_counts[primary_indices]

    pixel_mean = np.zeros((PRIMARY_BIN_COUNT, PIXEL_COUNT), dtype=np.float64)
    pixel_variance = np.zeros_like(pixel_mean)
    lengths = np.fromiter((len(row) for row in pixel_ids), dtype=np.int64, count=len(pixel_ids))
    if np.any(lengths != np.fromiter(
        (len(row) for row in pixel_energy), dtype=np.int64, count=len(pixel_energy)
    )):
        raise ValueError("Pixel ID and energy vector lengths differ.")
    flattened_ids = np.concatenate(pixel_ids).astype(np.int64, copy=False)
    flattened_energy = np.concatenate(pixel_energy).astype(np.float64, copy=False)
    if (
        np.any(flattened_ids < 0) or np.any(flattened_ids >= PIXEL_COUNT) or
        not np.isfinite(flattened_energy).all() or np.any(flattened_energy < 0)
    ):
        raise ValueError("Tree contains invalid pixel data.")
    repeated_primary = np.repeat(primary_indices, lengths)
    repeated_total = np.repeat(total_deposited, lengths)
    repeated_inverse_counts = np.repeat(inverse_primary_counts, lengths)
    fractions = flattened_energy / repeated_total
    first_moment_weights = fractions * repeated_inverse_counts
    np.add.at(pixel_mean, (repeated_primary, flattened_ids), first_moment_weights)
    np.add.at(
        pixel_variance,
        (repeated_primary, flattened_ids),
        first_moment_weights * first_moment_weights,
    )

    deposited_mean = np.zeros((PRIMARY_BIN_COUNT, DEPOSITED_BIN_COUNT), dtype=np.float64)
    deposited_variance = np.zeros_like(deposited_mean)
    deposited_indices = np.searchsorted(deposited_edges, total_deposited, side="right") - 1
    deposited_indices[total_deposited == deposited_edges[-1]] = DEPOSITED_BIN_COUNT - 1
    in_range = (deposited_indices >= 0) & (deposited_indices < DEPOSITED_BIN_COUNT)
    np.add.at(
        deposited_mean,
        (primary_indices[in_range], deposited_indices[in_range]),
        inverse_primary_counts[in_range],
    )
    np.add.at(
        deposited_variance,
        (primary_indices[in_range], deposited_indices[in_range]),
        inverse_primary_counts[in_range] * inverse_primary_counts[in_range],
    )
    return pixel_mean, pixel_variance, deposited_mean, deposited_variance


def load_golden(path: Path) -> dict[str, Any]:
    root_file = uproot.open(path)
    result: dict[str, Any] = {
        "fixtureId": "CEGenGRB-default-request-40-120",
        "sourceFile": path.name,
        "sourceSha256": sha256(path),
        "requestedDirection": {"thetaDeg": 40.0, "phiDeg": 120.0},
        "selectedDirection": {
            "sourceId": "src-41-117",
            "thetaDeg": float(np.float32(41.9898)),
            "phiDeg": float(np.float32(117.146)),
            "responseKey": "41_117",
        },
        "spectrum": {
            "normalization": float(np.float32(0.026)),
            "spectralIndex": float(np.float32(-1.07)),
            "peakEnergyKeV": float(np.float32(756.4)),
        },
    }
    for root_name, output_name in (
        ("hNormEdepPix", "pixel"),
        ("hNormEdepTotCal", "depositedEnergy"),
    ):
        histogram = root_file[root_name]
        values = np.asarray(histogram.values(), dtype=np.float64)
        errors = np.asarray(histogram.errors(), dtype=np.float64)
        if not np.isfinite(values).all() or not np.isfinite(errors).all():
            raise ValueError(f"Golden {root_name} contains non-finite values.")
        result[f"{output_name}CountsPerSecond"] = finite_list(values)
        result[f"{output_name}ErrorsPerSecond"] = finite_list(errors)
        result[f"{output_name}BinEdges"] = finite_list(histogram.axis().edges())
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    arguments = parser.parse_args()
    input_dir = arguments.input_dir.resolve()
    output_dir = arguments.output_dir.resolve()
    missing = [name for name in REQUIRED_FILES if not (input_dir / name).is_file()]
    if missing:
        raise SystemExit(f"Missing required inputs: {', '.join(missing)}")
    output_dir.mkdir(parents=True, exist_ok=True)

    source_hashes = {name: sha256(input_dir / name) for name in REQUIRED_FILES}
    directions = load_directions(input_dir / "srcpos-sam-set7.txt")
    database = uproot.open(input_dir / "sampleDataSet.root")
    expected_keys = {
        f"{prefix}_{direction['responseKey']}"
        for direction in directions
        for prefix in ("hPeng", "tEdepPix")
    }
    actual_keys = {key.split(";")[0] for key in database.keys()}
    if actual_keys != expected_keys:
        missing_keys = sorted(expected_keys - actual_keys)[:5]
        extra_keys = sorted(actual_keys - expected_keys)[:5]
        raise ValueError(f"ROOT key mismatch; missing={missing_keys}, extra={extra_keys}")

    golden = load_golden(input_dir / "sampleSrc_41_117.root")
    deposited_edges = np.asarray(golden["depositedEnergyBinEdges"], dtype=np.float64)
    kernel_files = {
        name: output_dir / f"ritabrata-grb-{name}.f32.members.gz"
        for name in KERNEL_LAYOUTS
    }
    streams = {name: path.open("wb") for name, path in kernel_files.items()}
    members: dict[str, list[dict[str, Any]]] = {name: [] for name in KERNEL_LAYOUTS}
    primary_edges: np.ndarray | None = None
    try:
        for direction_index, direction in enumerate(directions):
            response_key = direction["responseKey"]
            primary_counts, direction_edges = histogram_with_axes(
                database, f"hPeng_{response_key}"
            )
            if primary_edges is None:
                primary_edges = direction_edges
            elif not np.array_equal(primary_edges, direction_edges):
                raise ValueError(f"Primary axes differ for {response_key}.")
            kernels = aggregate_direction(
                database[f"tEdepPix_{response_key}"],
                primary_counts,
                direction_edges,
                deposited_edges,
            )
            for name, values in zip(KERNEL_LAYOUTS, kernels, strict=True):
                if not np.isfinite(values).all() or np.any(values < 0):
                    raise ValueError(f"Invalid {name} kernel for {response_key}.")
                uncompressed = np.asarray(values, dtype="<f4").tobytes(order="C")
                compressed = gzip.compress(uncompressed, compresslevel=9, mtime=0)
                offset = streams[name].tell()
                streams[name].write(compressed)
                members[name].append({
                    "directionIndex": direction_index,
                    "offset": offset,
                    "compressedByteLength": len(compressed),
                    "uncompressedByteLength": len(uncompressed),
                    "sha256": hashlib.sha256(compressed).hexdigest(),
                })
            if (direction_index + 1) % 100 == 0:
                print(f"Converted {direction_index + 1}/{len(directions)} directions", flush=True)
    finally:
        for stream in streams.values():
            stream.close()
    assert primary_edges is not None

    golden_path = output_dir / "ritabrata-grb-golden.json"
    golden_path.write_text(json.dumps(golden, indent=2) + "\n", encoding="utf-8")
    primary_bytes = len(directions) * PRIMARY_BIN_COUNT
    kernel_manifest = {}
    for name, layout in KERNEL_LAYOUTS.items():
        trailing = PIXEL_COUNT if name.startswith("pixel") else DEPOSITED_BIN_COUNT
        uncompressed_bytes = primary_bytes * trailing * struct.calcsize("<f")
        kernel_manifest[name] = {
            "file": kernel_files[name].name,
            "encoding": "range-addressable-concatenated-gzip-members-float32-little-endian",
            "memberLayout": layout,
            "totalUncompressedByteLength": uncompressed_bytes,
            "fileByteLength": kernel_files[name].stat().st_size,
            "fileSha256": sha256(kernel_files[name]),
            "members": members[name],
        }
    manifest = {
        "schemaVersion": 1,
        "assetVersion": ASSET_VERSION,
        "directionFrame": DIRECTION_FRAME,
        "pixelCount": PIXEL_COUNT,
        "directionCount": len(directions),
        "primaryEnergyBinCount": PRIMARY_BIN_COUNT,
        "depositedEnergyBinCount": DEPOSITED_BIN_COUNT,
        "sourceAreaCm2": SOURCE_AREA_CM2,
        "primaryEnergyBinEdgesKeV": finite_list(primary_edges),
        "depositedEnergyBinEdgesKeV": finite_list(deposited_edges),
        "directions": directions,
        "kernels": kernel_manifest,
        "goldenFixture": {
            "file": golden_path.name,
            "sha256": sha256(golden_path),
        },
        "sourceFilesSha256": source_hashes,
        "sourceFilesGoogleDriveIds": GOOGLE_DRIVE_FILE_IDS,
        "provenanceSha256": canonical_hash(source_hashes),
        "rootParity": {
            "verified": False,
            "goldenFixtureId": golden["fixtureId"],
            "goldenOutputSha256": sha256(input_dir / "sampleSrc_41_117.root"),
            "assetProvenanceSha256": "",
            "status": "OFFLINE_TYPESCRIPT_PARITY_VALIDATION_REQUIRED",
        },
        "scientificStatus": "PROVISIONAL_DOMAIN_VALIDATION_REQUIRED",
    }
    manifest_path = output_dir / "ritabrata-grb-generator.manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {manifest_path}")


if __name__ == "__main__":
    main()
