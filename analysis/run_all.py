#!/usr/bin/env python3
"""Run all HMDA analyses and write JSON to docs/data/."""

import json
import os
import sys
import time

# Add project root to path so we can import as a package
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analysis import national, geographic

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "data")


def write_json(filename, data):
    path = os.path.join(OUTPUT_DIR, filename)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"  Wrote {path}")


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    t0 = time.time()

    print("Running national analysis...")
    write_json("national.json", national.generate())

    print("Running geographic analysis...")
    write_json("geographic.json", geographic.generate())

    elapsed = time.time() - t0
    print(f"\nAll analyses complete in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
