#!/usr/bin/env python3
"""Compare the updated C++ prefix-event mixture with the web expectation model.

This audit reads the contributor-supplied ``temDataSet5degNew.root`` directly.
It does not execute the C++ program.  For each fixed detector direction it
reconstructs the two response constructions from the same ROOT events:

* C++ semantics: copy ``floor(tree_entries * weight)`` leading events;
* web semantics: use the weighted full-sample expectation.

Tool-only dependencies: numpy, awkward and uproot.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import platform
from typing import Any

import awkward as ak
import numpy as np
import uproot


PIXEL_COUNT = 126
SOURCE_AREA_CM2 = 4 * 18 * 18
DEFAULT_CASES = ((40.0, 120.0), (110.0, 120.0), (45.0, 33.0), (80.0, 250.0))
SPECTRUM = {"normalization": 0.026, "spectralIndex": -1.07, "peakEnergyKeV": 756.4}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def direction(theta_deg: float, phi_deg: float) -> np.ndarray:
    theta = math.radians(theta_deg)
    phi = math.radians(phi_deg)
    return np.asarray((
        math.sin(theta) * math.cos(phi),
        math.sin(theta) * math.sin(phi),
        math.cos(theta),
    ))


def angular_distance_deg(first: np.ndarray, second: np.ndarray) -> float:
    return math.degrees(math.acos(float(np.clip(np.dot(first, second), -1.0, 1.0))))


def differential_flux(energy_kev: float) -> float:
    amplitude = SPECTRUM["normalization"]
    alpha = SPECTRUM["spectralIndex"]
    peak = SPECTRUM["peakEnergyKeV"]
    return amplitude * (energy_kev / 100.0) ** alpha * math.exp(-(alpha + 2.0) * energy_kev / peak)


def adaptive_simpson(lower: float, upper: float, tolerance: float = 1e-10) -> float:
    def estimate(left: float, right: float, lv: float, cv: float, rv: float) -> float:
        return (right - left) * (lv + 4.0 * cv + rv) / 6.0

    midpoint = (lower + upper) / 2.0
    left_value = differential_flux(lower)
    middle_value = differential_flux(midpoint)
    right_value = differential_flux(upper)
    whole = estimate(lower, upper, left_value, middle_value, right_value)

    def visit(
        left: float,
        right: float,
        lv: float,
        cv: float,
        rv: float,
        previous: float,
        remaining: float,
        depth: int,
    ) -> float:
        center = (left + right) / 2.0
        left_center = (left + center) / 2.0
        right_center = (center + right) / 2.0
        lcv = differential_flux(left_center)
        rcv = differential_flux(right_center)
        left_estimate = estimate(left, center, lv, lcv, cv)
        right_estimate = estimate(center, right, cv, rcv, rv)
        delta = left_estimate + right_estimate - previous
        if depth <= 0 or abs(delta) <= 15.0 * remaining:
            return left_estimate + right_estimate + delta / 15.0
        return (
            visit(left, center, lv, lcv, cv, left_estimate, remaining / 2.0, depth - 1)
            + visit(center, right, cv, rcv, rv, right_estimate, remaining / 2.0, depth - 1)
        )

    return visit(
        lower,
        upper,
        left_value,
        middle_value,
        right_value,
        whole,
        max(1e-14, abs(whole) * tolerance),
        20,
    )


def aggregate_pixel_fractions(
    tree: Any,
    primary_edges: np.ndarray,
    entry_limit: int | None,
) -> np.ndarray:
    branches = tree.arrays(
        ["peng", "totEdep", "pixEdep[px]", "pixID[px]"],
        entry_stop=entry_limit,
        library="ak",
    )
    primary_energy = np.asarray(branches["peng"])
    total_deposited = np.asarray(branches["totEdep"])
    pixel_ids = ak.to_numpy(ak.flatten(branches["pixID[px]"])).astype(np.int64, copy=False)
    pixel_energy = ak.to_numpy(ak.flatten(branches["pixEdep[px]"])).astype(np.float64, copy=False)
    lengths = ak.to_numpy(ak.num(branches["pixID[px]"])).astype(np.int64, copy=False)
    primary_bins = np.searchsorted(primary_edges, primary_energy, side="right") - 1
    repeated_bins = np.repeat(primary_bins, lengths)
    repeated_total = np.repeat(total_deposited, lengths)
    # hNorm underflow and overflow are reset to zero in CEGenGRB.cc.
    in_range = (repeated_bins >= 0) & (repeated_bins < len(primary_edges) - 1)
    result = np.zeros((len(primary_edges) - 1, PIXEL_COUNT), dtype=np.float64)
    np.add.at(
        result,
        (repeated_bins[in_range], pixel_ids[in_range]),
        pixel_energy[in_range] / repeated_total[in_range],
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root_file", type=Path)
    parser.add_argument("output_json", type=Path)
    arguments = parser.parse_args()
    root_path = arguments.root_file.resolve()
    database = uproot.open(root_path)
    locations = database["tLocInfo"].arrays(["theta", "phi"], library="np")
    theta = np.asarray(locations["theta"], dtype=np.float64)
    phi = np.asarray(locations["phi"], dtype=np.float64)
    vectors = np.stack([direction(t, p) for t, p in zip(theta, phi, strict=True)])
    cases: list[dict[str, Any]] = []

    for requested_theta, requested_phi in DEFAULT_CASES:
        requested_vector = direction(requested_theta, requested_phi)
        separations = np.degrees(np.arccos(np.clip(vectors @ requested_vector, -1.0, 1.0)))
        ranked = sorted(
            range(len(theta)),
            key=lambda index: (separations[index], theta[index], phi[index], index),
        )[:3]
        if any(separations[index] <= 0.0 for index in ranked):
            raise ValueError("The fixed audit cases must not coincide with a template.")
        inverse = np.asarray([1.0 / separations[index] for index in ranked])
        weights = inverse / inverse.sum()
        primary_histograms = []
        full_numerator: np.ndarray | None = None
        prefix_numerator: np.ndarray | None = None
        primary_edges: np.ndarray | None = None
        selected = []

        for index, weight in zip(ranked, weights, strict=True):
            key = f"{int(theta[index])}_{int(phi[index])}"
            histogram = database[f"hPeng_{key}"]
            counts = np.asarray(histogram.values(), dtype=np.float64)
            edges = np.asarray(histogram.axis().edges(), dtype=np.float64)
            if primary_edges is None:
                primary_edges = edges
            elif not np.array_equal(primary_edges, edges):
                raise ValueError("Primary-energy axes differ between selected templates.")
            tree = database[f"tEdepPix_{key}"]
            entry_limit = math.floor(tree.num_entries * weight)
            full = aggregate_pixel_fractions(tree, edges, None)
            prefix = aggregate_pixel_fractions(tree, edges, entry_limit)
            full_numerator = weight * full if full_numerator is None else full_numerator + weight * full
            prefix_numerator = prefix if prefix_numerator is None else prefix_numerator + prefix
            primary_histograms.append(weight * counts)
            selected.append({
                "thetaDeg": float(theta[index]),
                "phiDeg": float(phi[index]),
                "separationDeg": float(separations[index]),
                "weight": float(weight),
                "treeEntries": int(tree.num_entries),
                "prefixEntries": entry_limit,
            })

        assert primary_edges is not None and full_numerator is not None and prefix_numerator is not None
        mixed_primary = np.sum(primary_histograms, axis=0)
        incident_rate = np.asarray([
            adaptive_simpson(primary_edges[i], primary_edges[i + 1]) * SOURCE_AREA_CM2
            for i in range(len(primary_edges) - 1)
        ])
        normalization = incident_rate / mixed_primary
        prefix_response = np.sum(prefix_numerator * normalization[:, np.newaxis], axis=0)
        expectation_response = np.sum(full_numerator * normalization[:, np.newaxis], axis=0)
        delta = prefix_response - expectation_response
        cosine = float(np.dot(prefix_response, expectation_response) /
                       (np.linalg.norm(prefix_response) * np.linalg.norm(expectation_response)))
        cases.append({
            "requestedDirection": {"thetaDeg": requested_theta, "phiDeg": requested_phi},
            "selectedTemplates": selected,
            "prefixTotalCountsPerSecond": float(prefix_response.sum()),
            "expectationTotalCountsPerSecond": float(expectation_response.sum()),
            "relativeL2Difference": float(np.linalg.norm(delta) / np.linalg.norm(prefix_response)),
            "normalizedResponseShapeAngleDeg": math.degrees(math.acos(float(np.clip(cosine, -1.0, 1.0)))),
            "maximumAbsolutePixelDifferenceOverPrefixPeak": float(
                np.max(np.abs(delta)) / np.max(prefix_response)
            ),
        })

    evidence = {
        "schemaVersion": 1,
        "status": "PROVISIONAL",
        "purpose": "Quantify the expectation-level web approximation against the supplied C++ prefix-event construction without executing C++.",
        "source": {
            "file": root_path.name,
            "byteLength": root_path.stat().st_size,
            "sha256": sha256(root_path),
        },
        "software": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "awkward": ak.__version__,
            "uproot": uproot.__version__,
        },
        "spectrum": SPECTRUM,
        "cases": cases,
        "limitations": [
            "The comparison reconstructs documented C++ operations from ROOT data; it is not executable-level parity.",
            "Spectral integrals use this script's adaptive Simpson quadrature rather than ROOT TF1::Integral.",
            "Four fixed directions are diagnostic and do not characterize the full field of view.",
        ],
    }
    arguments.output_json.parent.mkdir(parents=True, exist_ok=True)
    arguments.output_json.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(arguments.output_json),
        "cases": len(cases),
        "sourceSha256": evidence["source"]["sha256"],
    }, indent=2))


if __name__ == "__main__":
    main()
