#!/usr/bin/env python3
"""Run all HMDA analyses and write JSON to docs/data/."""

import json
import os
import sys
import time

# Add project root to path so we can import as a package
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analysis import national, geographic, cube, lenders, quality

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "data")


def write_json(filename, data, compact=False):
    path = os.path.join(OUTPUT_DIR, filename)
    with open(path, "w") as f:
        if compact:
            json.dump(data, f, separators=(",", ":"))
        else:
            json.dump(data, f, indent=2)
    size_mb = os.path.getsize(path) / 1e6
    print(f"  Wrote {path} ({size_mb:.1f}MB)")


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    t0 = time.time()

    print("Running national analysis...")
    write_json("national.json", national.generate())

    print("Running geographic analysis...")
    write_json("geographic.json", geographic.generate(), compact=True)

    print("Running cube analysis...")
    write_json("cube.json", cube.generate())

    print("Running lender analysis...")
    write_json("lenders.json", lenders.generate(), compact=True)

    print("Running loan-quality analysis...")
    write_json("quality.json", quality.generate(), compact=True)

    elapsed = time.time() - t0
    print(f"\nAll analyses complete in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
