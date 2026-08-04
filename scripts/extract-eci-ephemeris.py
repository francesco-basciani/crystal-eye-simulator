#!/usr/bin/env python3
"""Extract the approved ECI worksheet to the deterministic runtime TSV."""

from __future__ import annotations

import argparse
import hashlib
import re
from decimal import Decimal
from pathlib import Path
from xml.etree import ElementTree
from zipfile import ZipFile


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
EXPECTED_HEADER = (
    "UTC time",
    "Sat X (km)",
    "Sat Y (km)",
    "Sat Z (km)",
    "Sun X (km)",
    "Sun Y (km)",
    "Sun Z (km)",
    "Moon X (km)",
    "Moon Y (km)",
    "Moon Z (km)",
)
RUNTIME_HEADER = (
    "utc",
    "sat_x_km",
    "sat_y_km",
    "sat_z_km",
    "sun_x_km",
    "sun_y_km",
    "sun_z_km",
    "moon_x_km",
    "moon_y_km",
    "moon_z_km",
)
UTC_2033 = re.compile(r"^2033-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$")
DECIMAL_PLACES = (2, 2, 2, 0, 0, 0, 1, 1, 1)
ROUNDING_TOLERANCE = Decimal("0.000000001")


def shared_strings(archive: ZipFile) -> list[str]:
    root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    return [
        "".join(node.text or "" for node in item.iter(f"{{{MAIN_NS}}}t"))
        for item in root
    ]


def worksheet_path(archive: ZipFile, sheet_name: str) -> str:
    workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    relationships = ElementTree.fromstring(
        archive.read("xl/_rels/workbook.xml.rels")
    )
    targets = {node.attrib["Id"]: node.attrib["Target"] for node in relationships}
    sheets = workbook.find(f"{{{MAIN_NS}}}sheets")
    if sheets is None:
        raise ValueError("Workbook has no worksheets.")
    for sheet in sheets:
        if sheet.attrib.get("name") == sheet_name:
            relation_id = sheet.attrib[f"{{{REL_NS}}}id"]
            target = targets[relation_id].lstrip("/")
            return target if target.startswith("xl/") else f"xl/{target}"
    raise ValueError(f"Workbook has no {sheet_name!r} worksheet.")


def cell_values(row: ElementTree.Element, strings: list[str]) -> list[str]:
    values: list[str] = []
    for cell in row.findall(f"{{{MAIN_NS}}}c"):
        value = cell.find(f"{{{MAIN_NS}}}v")
        text = "" if value is None or value.text is None else value.text
        if cell.attrib.get("t") == "s" and text:
            text = strings[int(text)]
        values.append(text)
    return values


def extract(source: Path) -> str:
    with ZipFile(source) as archive:
        strings = shared_strings(archive)
        root = ElementTree.fromstring(archive.read(worksheet_path(archive, "ECI")))
        rows = root.findall(f".//{{{MAIN_NS}}}sheetData/{{{MAIN_NS}}}row")
        values = [cell_values(row, strings) for row in rows]

    if not values or tuple(values[0]) != EXPECTED_HEADER:
        raise ValueError("ECI worksheet header does not match the approved schema.")
    records = values[1:]
    if len(records) != 9_304:
        raise ValueError(f"Expected 9304 ECI records, found {len(records)}.")
    normalized_records: list[list[str]] = []
    for index, record in enumerate(records, start=2):
        if len(record) != 10:
            raise ValueError(f"ECI row {index} does not contain 10 fields.")
        if not UTC_2033.fullmatch(record[0]):
            raise ValueError(f"ECI row {index} is outside the approved 2033 scenario.")
        normalized = [record[0]]
        for numeric, places in zip(record[1:], DECIMAL_PLACES, strict=True):
            source_value = Decimal(numeric)
            quantum = Decimal(1).scaleb(-places)
            rounded = source_value.quantize(quantum)
            if abs(source_value - rounded) > ROUNDING_TOLERANCE:
                raise ValueError(
                    f"ECI row {index} exceeds the approved precision for its column."
                )
            clean = format(rounded, "f")
            if "." in clean:
                clean = clean.rstrip("0").rstrip(".")
            normalized.append("0" if clean in {"", "-0"} else clean)
        normalized_records.append(normalized)

    lines = [
        "\t".join(RUNTIME_HEADER),
        *("\t".join(row) for row in normalized_records),
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    arguments = parser.parse_args()
    payload = extract(arguments.source).encode("ascii")
    arguments.destination.parent.mkdir(parents=True, exist_ok=True)
    arguments.destination.write_bytes(payload)
    print(f"records=9304 bytes={len(payload)} sha256={hashlib.sha256(payload).hexdigest()}")


if __name__ == "__main__":
    main()
