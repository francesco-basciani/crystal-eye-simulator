#!/usr/bin/env python3
"""Split one converted CELoc response into deterministic, Git-compatible gzip shards."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("converted_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--templates-per-shard", type=int, default=1000)
    arguments = parser.parse_args()
    source = arguments.converted_dir.resolve()
    output = arguments.output_dir.resolve()
    if arguments.templates_per_shard <= 0:
        raise SystemExit("templates-per-shard must be positive")
    manifest_path = source / "ritabrata-localizer.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    descriptor = manifest["templateResponse"]
    if "file" not in descriptor or "sha256" not in descriptor:
        raise SystemExit("source manifest must describe one monolithic response")
    source_response = source / descriptor["file"]
    if sha256(source_response) != descriptor["sha256"]:
        raise SystemExit("source response SHA-256 mismatch")
    output.mkdir(parents=True, exist_ok=True)
    bytes_per_template = manifest["pixelCount"] * manifest["energyBinCount"] * 4
    shards = []
    with gzip.open(source_response, "rb") as uncompressed:
        template_start = 0
        shard_index = 0
        while template_start < manifest["templateCount"]:
            template_count = min(
                arguments.templates_per_shard,
                manifest["templateCount"] - template_start,
            )
            expected_bytes = template_count * bytes_per_template
            payload = uncompressed.read(expected_bytes)
            if len(payload) != expected_bytes:
                raise SystemExit("source response ended before the declared template count")
            name = f"ritabrata-template-response-{shard_index:02d}.f32.bin"
            path = output / name
            with path.open("wb") as raw_output:
                with gzip.GzipFile(
                    filename=f"ritabrata-template-response-{shard_index:02d}.f32",
                    mode="wb",
                    fileobj=raw_output,
                    compresslevel=9,
                    mtime=0,
                ) as compressed:
                    compressed.write(payload)
            shards.append({
                "file": name,
                "templateStart": template_start,
                "templateCount": template_count,
                "uncompressedByteLength": expected_bytes,
                "sha256": sha256(path),
            })
            template_start += template_count
            shard_index += 1
        if uncompressed.read(1):
            raise SystemExit("source response contains undeclared trailing bytes")
    manifest["templateResponse"] = {
        "encoding": descriptor["encoding"],
        "layout": descriptor["layout"],
        "uncompressedByteLength": descriptor["uncompressedByteLength"],
        "shards": shards,
    }
    for name in (
        "ritabrata-localizer-samples.json",
        "ritabrata-template-projection-flow.f32.bin",
    ):
        source_path = source / name
        if source_path.is_file():
            (output / name).write_bytes(source_path.read_bytes())
    (output / "ritabrata-localizer.manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "manifest": str(output / "ritabrata-localizer.manifest.json"),
        "templateCount": manifest["templateCount"],
        "shards": shards,
    }, indent=2))


if __name__ == "__main__":
    main()
