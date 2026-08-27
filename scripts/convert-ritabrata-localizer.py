#!/usr/bin/env python3
"""Convert Ritabrata's ROOT localization assets into browser-loadable files.

Tool-only dependencies (not application runtime dependencies): numpy, uproot.
The converter never executes the supplied Linux binary.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import struct
from typing import Any

try:
    import numpy as np
    import uproot
except ImportError as error:  # pragma: no cover - exercised by the operator environment
    raise SystemExit(
        "Missing tool-only dependencies. Install numpy and uproot in an isolated "
        "environment before running this converter."
    ) from error


PIXEL_COUNT = 126
ENERGY_BIN_COUNT = 100
EFFECTIVE_AREA_COUNT = 91
TEMPLATE_COUNT = 742
ASSET_VERSION = "ritabrata-standalone-celoc-v1"
GEOMETRY_VERSION = "CESimulation-V2R8-candidate"
DIRECTION_FRAME = "RITABRATA_ROOT_PLUS_Z_POLAR_PHI_ATAN2_Y_X"
PIXEL_POSITION_FRAME = "CELOC_UPCAL_RAW_COMPONENT_ORDER_UNVALIDATED"
REQUIRED_FILES = (
    "CELoc.cc",
    "upCal.txt",
    "allEffArea.root",
    "srcpos-5deg.txt",
    "temEdepPix5deg.root",
    "sample-src-41-117.root",
    "sample-src-74-349.root",
    "CMakeLists.txt",
)
GOOGLE_DRIVE_FILE_IDS = {
    "allEffArea.root": "1yqtIT39ob3SDJtnCzD8RW1ia1Dgl2m0F",
    "CELoc.cc": "1rfJUfU8dX6tfX2tSRrQpJfH62oVpaTD6",
    "CMakeLists.txt": "1S7pAnNNcSMNmG44fPK0zoTIAvw_zaOnh",
    "sample-src-41-117.root": "19AlA_ECByYdWHk3JNnYaERKfb_RPhX85",
    "sample-src-74-349.root": "1iIVFGPss43bfT5V8fCQZ_625TTGf5nWP",
    "srcpos-5deg.txt": "1iRrU-5NvL6T3tYqvzVJ8kQy2m33tLQNC",
    "temEdepPix5deg.root": "1K9QMaYaJv5zMseI-t9_7O8SFNrMckRNk",
    "upCal.txt": "1XRglTfOSB9SuOiGRF5okQrjMepl0MtcE",
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
    result = np.asarray(values, dtype=np.float64)
    if not np.isfinite(result).all():
        raise ValueError("Encountered a non-finite ROOT value.")
    return result.tolist()


def load_pixel_positions(path: Path) -> tuple[list[int], list[list[float]]]:
    rows = np.loadtxt(path, dtype=np.float64)
    if rows.shape != (PIXEL_COUNT, 4):
        raise ValueError(f"upCal must have shape ({PIXEL_COUNT}, 4), got {rows.shape}.")
    pixel_ids = rows[:, 0].astype(np.int64)
    if sorted(pixel_ids.tolist()) != list(range(PIXEL_COUNT)):
        raise ValueError("upCal pixel IDs must be a bijection over 0..125.")
    # Preserve source-file row order: CELoc.cc ignores column n and pushes x/y/z
    # sequentially. Reordering here would not port the supplied implementation.
    return pixel_ids.tolist(), finite_list(rows[:, 1:4].astype(np.float32))


def load_template_directions(path: Path) -> tuple[np.ndarray, list[dict[str, Any]]]:
    # SetTemPosInfoFile binds the text fields to Float_t.
    directions = np.loadtxt(path, dtype=np.float32)
    if directions.shape != (TEMPLATE_COUNT, 2):
        raise ValueError(
            f"srcpos must have shape ({TEMPLATE_COUNT}, 2), got {directions.shape}."
        )
    templates = [
        {
            "templateId": f"hEdepPix_{int(theta)}_{int(phi)}",
            "thetaDeg": float(theta),
            "phiDeg": float(phi),
        }
        for theta, phi in directions
    ]
    if len({template["templateId"] for template in templates}) != TEMPLATE_COUNT:
        raise ValueError("Integer-truncated ROOT template names are not unique.")
    return directions, templates


def load_effective_area(path: Path) -> tuple[list[float], list[dict[str, Any]]]:
    root_file = uproot.open(path)
    rows: list[dict[str, Any]] = []
    reference_edges: np.ndarray | None = None
    for theta in range(EFFECTIVE_AREA_COUNT):
        histogram = root_file[f"hEffArea{theta}"]
        values = np.asarray(histogram.values(), dtype=np.float64)
        edges = np.asarray(histogram.axis().edges(), dtype=np.float64)
        if values.shape != (ENERGY_BIN_COUNT,) or edges.shape != (ENERGY_BIN_COUNT + 1,):
            raise ValueError(f"Unexpected hEffArea{theta} dimensions.")
        flow = np.asarray(histogram.values(flow=True), dtype=np.float64)
        if flow.shape != (ENERGY_BIN_COUNT + 2,) or flow[0] != 0 or flow[-1] != 0:
            raise ValueError(f"hEffArea{theta} underflow/overflow must be zero.")
        if not np.isfinite(values).all() or np.any(values <= 0):
            raise ValueError(f"hEffArea{theta} must contain positive finite values.")
        if reference_edges is None:
            reference_edges = edges
        elif not np.array_equal(reference_edges, edges):
            raise ValueError("Effective-area energy axes differ.")
        rows.append({"thetaDeg": theta, "areaByEnergyBin": finite_list(values)})
    assert reference_edges is not None
    return finite_list(reference_edges), rows


def write_template_response(
    input_path: Path,
    directions: np.ndarray,
    expected_energy_edges: list[float],
    output_path: Path,
) -> tuple[int, str]:
    root_file = uproot.open(input_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as raw_output:
        with gzip.GzipFile(
            filename="ritabrata-template-response.f32",
            mode="wb",
            fileobj=raw_output,
            compresslevel=9,
            mtime=0,
        ) as compressed:
            for theta, phi in directions:
                name = f"hEdepPix_{int(theta)}_{int(phi)}"
                histogram = root_file[name]
                values = np.asarray(histogram.values(), dtype="<f4")
                if values.shape != (PIXEL_COUNT, ENERGY_BIN_COUNT):
                    raise ValueError(f"Unexpected {name} shape {values.shape}.")
                pixel_edges = np.asarray(histogram.axes[0].edges(), dtype=np.float64)
                energy_edges = np.asarray(histogram.axes[1].edges(), dtype=np.float64)
                if not np.array_equal(pixel_edges, np.arange(PIXEL_COUNT + 1)):
                    raise ValueError(f"Unexpected {name} pixel axis.")
                if not np.array_equal(energy_edges, np.asarray(expected_energy_edges)):
                    raise ValueError(f"Unexpected {name} energy axis.")
                flow = np.asarray(histogram.values(flow=True), dtype=np.float64)
                if np.any(flow[0, :]) or np.any(flow[-1, :]) or np.any(flow[:, 0]) or np.any(flow[:, -1]):
                    raise ValueError(f"{name} underflow/overflow must be zero.")
                if not np.isfinite(values).all() or np.any(values < 0):
                    raise ValueError(f"{name} contains invalid response values.")
                compressed.write(values.tobytes(order="C"))
    uncompressed_bytes = TEMPLATE_COUNT * PIXEL_COUNT * ENERGY_BIN_COUNT * struct.calcsize("<f")
    return uncompressed_bytes, sha256(output_path)


def sample_truth_from_name(path: Path) -> dict[str, float]:
    match = re.fullmatch(r"sample-src-(\d+)-(\d+)\.root", path.name)
    if not match:
        raise ValueError(f"Cannot derive sample truth label from {path.name}.")
    return {"thetaDeg": float(match.group(1)), "phiDeg": float(match.group(2))}


def load_sample(
    path: Path,
    energy_edges: list[float],
    pixel_ids: list[int],
) -> dict[str, Any]:
    root_file = uproot.open(path)
    pixel_histogram = root_file["hNormEdepPix"]
    energy_histogram = root_file["hNormEdepTotCal"]
    pixel_counts = np.asarray(pixel_histogram.values(), dtype=np.float64)
    pixel_errors = np.asarray(pixel_histogram.errors(), dtype=np.float64)
    energy_counts = np.asarray(energy_histogram.values(), dtype=np.float64)
    sample_edges = np.asarray(energy_histogram.axis().edges(), dtype=np.float64)
    if pixel_counts.shape != (PIXEL_COUNT,) or pixel_errors.shape != (PIXEL_COUNT,):
        raise ValueError(f"Unexpected pixel histogram dimensions in {path.name}.")
    if energy_counts.shape != (ENERGY_BIN_COUNT,):
        raise ValueError(f"Unexpected energy histogram dimensions in {path.name}.")
    if not np.array_equal(sample_edges, np.asarray(energy_edges)):
        raise ValueError(f"Energy axis mismatch in {path.name}.")
    for histogram, histogram_name in (
        (pixel_histogram, "hNormEdepPix"),
        (energy_histogram, "hNormEdepTotCal"),
    ):
        flow = np.asarray(histogram.values(flow=True), dtype=np.float64)
        if flow[0] != 0 or flow[-1] != 0:
            raise ValueError(f"{histogram_name} flow bins are non-zero in {path.name}.")
    return {
        "fixtureId": path.stem,
        "sourceFile": path.name,
        "sourceSha256": sha256(path),
        "injectedDirectionLabelFromFilename": sample_truth_from_name(path),
        "pixelCounts": finite_list(pixel_counts),
        "pixelErrors": finite_list(pixel_errors),
        "depositedEnergyCounts": finite_list(energy_counts),
        "rootExpectedReconstruction": None,
        "rootExpectedReconstructionStatus": "REQUESTED_FROM_DOMAIN_AUTHOR",
        "geometryVersion": GEOMETRY_VERSION,
        "directionFrame": DIRECTION_FRAME,
        "pixelIds": list(range(PIXEL_COUNT)),
        "energyBinEdgesKeV": energy_edges,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    arguments = parser.parse_args()
    input_dir = arguments.input_dir.resolve()
    output_dir = arguments.output_dir.resolve()
    missing = [name for name in REQUIRED_FILES if not (input_dir / name).is_file()]
    if missing:
        raise SystemExit(f"Missing required input files: {', '.join(missing)}")

    source_hashes = {name: sha256(input_dir / name) for name in REQUIRED_FILES}
    pixel_ids, pixel_vectors = load_pixel_positions(input_dir / "upCal.txt")
    directions, templates = load_template_directions(input_dir / "srcpos-5deg.txt")
    energy_edges, effective_area = load_effective_area(input_dir / "allEffArea.root")
    response_name = "ritabrata-template-response.f32.bin"
    response_path = output_dir / response_name
    uncompressed_bytes, response_hash = write_template_response(
        input_dir / "temEdepPix5deg.root", directions, energy_edges, response_path
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    fixture_names = ("sample-src-41-117.root", "sample-src-74-349.root")
    fixtures = [load_sample(input_dir / name, energy_edges, pixel_ids) for name in fixture_names]
    fixture_path = output_dir / "ritabrata-localizer-samples.json"
    fixture_path.write_text(
        json.dumps({"schemaVersion": 1, "fixtures": fixtures}, indent=2) + "\n",
        encoding="utf-8",
    )

    provenance_hash = canonical_hash(source_hashes)
    manifest = {
        "schemaVersion": 1,
        "assetVersion": ASSET_VERSION,
        "geometryVersion": GEOMETRY_VERSION,
        "directionFrame": DIRECTION_FRAME,
        "pixelPositionFrame": PIXEL_POSITION_FRAME,
        "pixelCount": PIXEL_COUNT,
        "energyBinCount": ENERGY_BIN_COUNT,
        "templateCount": TEMPLATE_COUNT,
        "effectiveAreaThetaCount": EFFECTIVE_AREA_COUNT,
        "pixelIdsInSourceFileOrder": pixel_ids,
        "pixelPositionVectorsInSourceFileOrder": pixel_vectors,
        "energyBinEdgesKeV": energy_edges,
        "templates": templates,
        "effectiveArea": effective_area,
        "templateResponse": {
            "file": response_name,
            "encoding": "gzip-float32-little-endian",
            "layout": "template,pixel,energy",
            "uncompressedByteLength": uncompressed_bytes,
            "sha256": response_hash,
        },
        "sourceFilesSha256": source_hashes,
        "sourceFilesGoogleDriveIds": GOOGLE_DRIVE_FILE_IDS,
        "provenanceSha256": provenance_hash,
        "rootParity": {
            "verified": False,
            "rootVersion": "",
            "goldenFixtureId": "",
            "goldenOutputSha256": "",
            "assetProvenanceSha256": "",
            "status": "PENDING_OFFICIAL_ROOT_OUTPUTS",
        },
        "limitations": [
            "upCal source-file row order is preserved because CELoc.cc ignores the ID column",
            "the supplied C++ erases from fVProb during range iteration; this port applies the stated >=1% filter deterministically",
            "detector-local theta/phi to spacecraft or RA/Dec conversion is outside this asset",
        ],
    }
    manifest_path = output_dir / "ritabrata-localizer.manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "manifest": str(manifest_path),
        "samples": str(fixture_path),
        "templateResponse": str(response_path),
        "provenanceSha256": provenance_hash,
        "templateResponseSha256": response_hash,
    }, indent=2))


if __name__ == "__main__":
    main()
