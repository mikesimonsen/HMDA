"""Geographic HMDA analysis — state and county level.

Generates filterable cubes at (state, action, type, purpose) and
(county, action, type, purpose) grain for client-side filtering.
"""

import csv
import os

from .db import query

COUNTY_FIPS_FILE = os.path.join(os.path.dirname(__file__), "county_fips.txt")


def _load_county_lookup():
    """Load county FIPS lookups from Census file.

    Returns (names, fips_to_state) where:
      names: 5-digit FIPS -> county name
      fips_to_state: 2-digit state FIPS -> state abbreviation
    """
    names = {}
    fips_to_state = {}
    with open(COUNTY_FIPS_FILE, encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="|")
        for row in reader:
            fips5 = row["STATEFP"] + row["COUNTYFP"]
            names[fips5] = row["COUNTYNAME"]
            fips_to_state[row["STATEFP"]] = row["STATE"]
    return names, fips_to_state


def state_cube():
    """State cube at (state, action, type, purpose) grain."""
    rows = query("""
        SELECT
            state_code as state,
            action_taken as a,
            loan_type as t,
            loan_purpose as p,
            COUNT(*) as c,
            SUM(CAST(loan_amount AS REAL)) as s,
            SUM(CASE WHEN interest_rate NOT IN ('Exempt', 'NA', '')
                THEN CAST(interest_rate AS REAL) ELSE 0 END) as r,
            SUM(CASE WHEN interest_rate NOT IN ('Exempt', 'NA', '')
                THEN 1 ELSE 0 END) as rc
        FROM hmda
        WHERE state_code != '' AND state_code != 'NA'
        GROUP BY state_code, action_taken, loan_type, loan_purpose
    """)
    # Round to save space
    for row in rows:
        row["s"] = round(row["s"])
        row["r"] = round(row["r"], 2)
    return rows


def county_cube(top_n=200):
    """County cube for the top N counties by volume.

    Derives state from the county FIPS code (first 2 digits) so rows with
    state_code='NA' get the correct state. Merges rows that differ only
    in the original state_code value.
    """
    _, fips_to_state = _load_county_lookup()

    rows = query("""
        SELECT
            county_code as fips,
            state_code as state,
            action_taken as a,
            loan_type as t,
            loan_purpose as p,
            COUNT(*) as c,
            SUM(CAST(loan_amount AS REAL)) as s,
            SUM(CASE WHEN interest_rate NOT IN ('Exempt', 'NA', '')
                THEN CAST(interest_rate AS REAL) ELSE 0 END) as r,
            SUM(CASE WHEN interest_rate NOT IN ('Exempt', 'NA', '')
                THEN 1 ELSE 0 END) as rc
        FROM hmda
        WHERE county_code IN (
            SELECT county_code FROM hmda
            WHERE county_code != '' AND county_code != 'NA'
            GROUP BY county_code
            ORDER BY COUNT(*) DESC
            LIMIT ?
        )
        GROUP BY county_code, state_code, action_taken, loan_type, loan_purpose
    """, [top_n])

    # Fix state from FIPS and merge rows that were split by NA vs real state
    merged = {}
    for row in rows:
        state = row["state"]
        if state in ("", "NA"):
            state = fips_to_state.get(row["fips"][:2], "")
        key = (row["fips"], state, row["a"], row["t"], row["p"])
        if key in merged:
            m = merged[key]
            m["c"] += row["c"]
            m["s"] += row["s"]
            m["r"] += row["r"]
            m["rc"] += row["rc"]
        else:
            row["state"] = state
            merged[key] = row

    result = list(merged.values())
    for row in result:
        row["s"] = round(row["s"])
        row["r"] = round(row["r"], 2)
    return result


def generate():
    """Generate the full geographic analysis payload."""
    names, _ = _load_county_lookup()
    return {
        "county_names": names,
        "state_cube": state_cube(),
        "county_cube": county_cube(),
    }
