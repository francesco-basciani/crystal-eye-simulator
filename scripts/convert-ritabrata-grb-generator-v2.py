#!/usr/bin/env python3
"""Convert the updated three-neighbour CEGenGRB ROOT database for the web.

The browser asset stores per-direction sufficient statistics, not individual
Monte Carlo events.  Runtime interpolation therefore reproduces the expected
full-sample response of CEGenGRB's weighted mixture.  It does not reproduce the
C++ implementation's request-dependent ``floor(entries * weight)`` prefix
sampling exactly; that limitation is recorded in the generated manifest.

Tool-only dependencies: numpy and uproot.  The C++ source is hashed for
provenance but is never compiled or executed.
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
    raise SystemExit("Install numpy and uproot in an isolated environment.") from error


PIXEL_COUNT = 126
PRIMARY_BIN_COUNT = 100
DEPOSITED_BIN_COUNT = 100
SOURCE_AREA_CM2 = 4 * 18 * 18
ASSET_VERSION = "cegengrb-three-neighbour-expectation-v2-candidate"
DIRECTION_FRAME = "RITABRATA_ROOT_PLUS_Z_POLAR_PHI_ATAN2_Y_X"
EXPECTED_DIRECTION_COUNT = 1093
REQUIRED_FILES = ("CEGenGRB.cc", "temDataSet5degNew.root")
GOOGLE_DRIVE_FILE_IDS = {
    "CEGenGRB.cc": "1UJeHpDSWlZwKIWDC2ijNNvtKR_yI4ROj",
    "temDataSet5degNew.root": "1NPqQwPq97VgiISXY69wSSsyX1uhXnFJ5",
}
KERNEL_LAYOUTS = {
    "primaryCounts": "primary-energy",
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


def load_directions(database: Any) -> list[dict[str, Any]]:
    location_tree = database["tLocInfo"]
    arrays = location_tree.arrays(["theta", "phi"], library="np")
    theta_values = np.asarray(arrays["theta"], dtype=np.float32)
    phi_values = np.asarray(arrays["phi"], dtype=np.float32)
    if theta_values.shape != phi_values.shape or theta_values.shape != (EXPECTED_DIRECTION_COUNT,):
        raise ValueError("Unexpected tLocInfo dimensions.")
    directions = []
    for index, (theta, phi) in enumerate(zip(theta_values, phi_values, strict=True)):
        if not (np.isfinite(theta) and np.isfinite(phi) and 0 <= theta <= 116):
            raise ValueError(f"Invalid direction at tLocInfo row {index}.")
        response_key = f"{int(theta)}_{int(phi)}"
        directions.append({
            "sourceId": f"source-{index}",
            "thetaDeg": float(theta),
            "phiDeg": float(phi),
            "responseKey": response_key,
        })
    if len({row["responseKey"] for row in directions}) != len(directions):
        raise ValueError("Integer-truncated ROOT response keys are not unique.")
    return directions


def primary_histogram(database: Any, name: str) -> tuple[np.ndarray, np.ndarray]:
    histogram = database[name]
    counts = np.asarray(histogram.values(), dtype=np.float64)
    edges = np.asarray(histogram.axis().edges(), dtype=np.float64)
    if counts.shape != (PRIMARY_BIN_COUNT,) or edges.shape != (PRIMARY_BIN_COUNT + 1,):
        raise ValueError(f"Unexpected dimensions for {name}.")
    if not np.isfinite(counts).all() or np.any(counts <= 0) or not np.all(np.diff(edges) > 0):
        raise ValueError(f"Invalid primary histogram {name}.")
    return counts, edges


def aggregate_direction(
    tree: Any,
    primary_counts: np.ndarray,
    primary_edges: np.ndarray,
    deposited_edges: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    arrays = tree.arrays(["peng", "totEdep", "pixEdep[px]", "pixID[px]"], library="np")
    primary_energy = np.asarray(arrays["peng"], dtype=np.float64)
    total_deposited = np.asarray(arrays["totEdep"], dtype=np.float64)
    pixel_energy = arrays["pixEdep[px]"]
    pixel_ids = arrays["pixID[px]"]
    if not (primary_energy.shape == total_deposited.shape == pixel_energy.shape == pixel_ids.shape):
        raise ValueError("Tree branch entry counts differ.")
    if not np.isfinite(primary_energy).all() or not np.isfinite(total_deposited).all():
        raise ValueError("Tree contains non-finite energies.")
    if np.any(total_deposited <= 0):
        raise ValueError("Tree contains a non-positive deposited energy.")

    primary_indices = np.searchsorted(primary_edges, primary_energy, side="right") - 1
    # TH1::FindBin maps values outside the Float_t axis into flow bins. hNorm
    # never assigns those flow bins, so CEGenGRB gives those events zero weight.
    # Drop them before aggregation to preserve that behavior.
    in_primary_range = (primary_indices >= 0) & (primary_indices < PRIMARY_BIN_COUNT)
    primary_indices = primary_indices[in_primary_range]
    total_deposited = total_deposited[in_primary_range]
    pixel_energy = pixel_energy[in_primary_range]
    pixel_ids = pixel_ids[in_primary_range]
    inverse_primary_counts = 1.0 / primary_counts[primary_indices]

    pixel_mean = np.zeros((PRIMARY_BIN_COUNT, PIXEL_COUNT), dtype=np.float64)
    pixel_variance = np.zeros_like(pixel_mean)
    lengths = np.fromiter((len(row) for row in pixel_ids), dtype=np.int64, count=len(pixel_ids))
    energy_lengths = np.fromiter((len(row) for row in pixel_energy), dtype=np.int64, count=len(pixel_energy))
    if np.any(lengths != energy_lengths):
        raise ValueError("Pixel ID and energy vector lengths differ.")
    flattened_ids = np.concatenate(pixel_ids).astype(np.int64, copy=False)
    flattened_energy = np.concatenate(pixel_energy).astype(np.float64, copy=False)
    if (np.any(flattened_ids < 0) or np.any(flattened_ids >= PIXEL_COUNT) or
            not np.isfinite(flattened_energy).all() or np.any(flattened_energy < 0)):
        raise ValueError("Tree contains invalid pixel data.")
    repeated_primary = np.repeat(primary_indices, lengths)
    fractions = flattened_energy / np.repeat(total_deposited, lengths)
    normalized = fractions * np.repeat(inverse_primary_counts, lengths)
    np.add.at(pixel_mean, (repeated_primary, flattened_ids), normalized)
    np.add.at(pixel_variance, (repeated_primary, flattened_ids), normalized * normalized)

    deposited_mean = np.zeros((PRIMARY_BIN_COUNT, DEPOSITED_BIN_COUNT), dtype=np.float64)
    deposited_variance = np.zeros_like(deposited_mean)
    deposited_indices = np.searchsorted(deposited_edges, total_deposited, side="right") - 1
    deposited_indices[total_deposited == deposited_edges[-1]] = DEPOSITED_BIN_COUNT - 1
    in_range = (deposited_indices >= 0) & (deposited_indices < DEPOSITED_BIN_COUNT)
    np.add.at(deposited_mean, (primary_indices[in_range], deposited_indices[in_range]),
              inverse_primary_counts[in_range])
    np.add.at(deposited_variance, (primary_indices[in_range], deposited_indices[in_range]),
              inverse_primary_counts[in_range] * inverse_primary_counts[in_range])
    return pixel_mean, pixel_variance, deposited_mean, deposited_variance


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
    database = uproot.open(input_dir / "temDataSet5degNew.root")
    directions = load_directions(database)
    expected_keys = {
        f"{prefix}_{direction['responseKey']}"
        for direction in directions
        for prefix in ("hPeng", "tEdepPix")
    } | {"tLocInfo"}
    actual_keys = {key.split(";")[0] for key in database.keys()}
    if actual_keys != expected_keys:
        raise ValueError(
            f"ROOT key mismatch; missing={sorted(expected_keys-actual_keys)[:5]}, "
            f"extra={sorted(actual_keys-expected_keys)[:5]}"
        )

    # CEGenGRB constructs both axes from the same Float_t edge vector. Reuse
    # the stored ROOT hPeng axis verbatim so the CELoc bridge can compare it
    # exactly with the localizer template energy axis.
    first_counts, deposited_edges = primary_histogram(
        database, f"hPeng_{directions[0]['responseKey']}"
    )
    del first_counts
    files = {name: output_dir / f"cegengrb-v2-{name}.f32.members.bin" for name in KERNEL_LAYOUTS}
    streams = {name: path.open("wb") for name, path in files.items()}
    members: dict[str, list[dict[str, Any]]] = {name: [] for name in KERNEL_LAYOUTS}
    primary_edges: np.ndarray | None = None
    try:
        for direction_index, direction in enumerate(directions):
            key = direction["responseKey"]
            counts, edges = primary_histogram(database, f"hPeng_{key}")
            if primary_edges is None:
                primary_edges = edges
            elif not np.array_equal(primary_edges, edges):
                raise ValueError(f"Primary axes differ for {key}.")
            aggregates = aggregate_direction(database[f"tEdepPix_{key}"], counts, edges, deposited_edges)
            values_by_name = {"primaryCounts": counts, **dict(zip(
                ("pixelMean", "pixelVariance", "depositedEnergyMean", "depositedEnergyVariance"),
                aggregates,
                strict=True,
            ))}
            for name, values in values_by_name.items():
                if not np.isfinite(values).all() or np.any(values < 0):
                    raise ValueError(f"Invalid {name} kernel for {key}.")
                raw = np.asarray(values, dtype="<f4").tobytes(order="C")
                compressed = gzip.compress(raw, compresslevel=9, mtime=0)
                offset = streams[name].tell()
                streams[name].write(compressed)
                members[name].append({
                    "directionIndex": direction_index,
                    "offset": offset,
                    "compressedByteLength": len(compressed),
                    "uncompressedByteLength": len(raw),
                    "sha256": hashlib.sha256(compressed).hexdigest(),
                })
            if (direction_index + 1) % 100 == 0:
                print(f"Converted {direction_index + 1}/{len(directions)} directions", flush=True)
    finally:
        for stream in streams.values():
            stream.close()
    assert primary_edges is not None

    kernel_manifest = {}
    for name, layout in KERNEL_LAYOUTS.items():
        trailing = 1 if name == "primaryCounts" else (
            PIXEL_COUNT if name.startswith("pixel") else DEPOSITED_BIN_COUNT
        )
        kernel_manifest[name] = {
            "file": files[name].name,
            "encoding": "range-addressable-concatenated-gzip-members-float32-little-endian",
            "memberLayout": layout,
            "totalUncompressedByteLength": len(directions) * PRIMARY_BIN_COUNT * trailing * struct.calcsize("<f"),
            "fileByteLength": files[name].stat().st_size,
            "fileSha256": sha256(files[name]),
            "members": members[name],
        }

    manifest = {
        "schemaVersion": 2,
        "assetVersion": ASSET_VERSION,
        "directionFrame": DIRECTION_FRAME,
        "pixelCount": PIXEL_COUNT,
        "directionCount": len(directions),
        "primaryEnergyBinCount": PRIMARY_BIN_COUNT,
        "depositedEnergyBinCount": DEPOSITED_BIN_COUNT,
        "sourceAreaCm2": SOURCE_AREA_CM2,
        "maximumRequestedThetaDeg": 113,
        "interpolation": {
            "neighborCount": 3,
            "weighting": "inverse-angular-distance-normalized",
            "exactMatch": "single-template-weight-one",
            "responseSemantics": "full-sample-expectation-approximation",
        },
        "primaryEnergyBinEdgesKeV": finite_list(primary_edges),
        "depositedEnergyBinEdgesKeV": finite_list(deposited_edges),
        "directions": directions,
        "kernels": kernel_manifest,
        "sourceFilesSha256": source_hashes,
        "sourceFilesGoogleDriveIds": GOOGLE_DRIVE_FILE_IDS,
        "provenanceSha256": canonical_hash(source_hashes),
        "rootParity": {
            "verified": False,
            "goldenFixtureId": "",
            "goldenOutputSha256": "",
            "assetProvenanceSha256": "",
            "status": "PENDING_IDENTICAL_INPUT_CPP_ROOT_PARITY",
        },
        "scientificStatus": "PROVISIONAL_DOMAIN_VALIDATION_REQUIRED",
        "limitations": [
            "Runtime combines full-sample sufficient statistics; C++ copies request-dependent event prefixes using floor(entries*weight).",
            "The source database includes support templates beyond the approved 113 degree request limit.",
            "No identical-input C++/ROOT golden output has been supplied for this updated generator.",
        ],
    }
    manifest_path = output_dir / "cegengrb-v2.manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "manifest": str(manifest_path),
        "manifestSha256": sha256(manifest_path),
        "provenanceSha256": manifest["provenanceSha256"],
        "directionCount": len(directions),
        "thetaRangeDeg": [min(row["thetaDeg"] for row in directions), max(row["thetaDeg"] for row in directions)],
    }, indent=2))


if __name__ == "__main__":
    main()
