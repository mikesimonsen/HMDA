"""Lender-level HMDA analysis.

Generates:
- LEI-to-name lookup from the CFPB filer API
- Lender cube at (lei, action, type, purpose) grain for client-side filtering
- Per-lender top states
"""

import json
import os
import urllib.request

from .db import query

FILER_CACHE = os.path.join(os.path.dirname(__file__), "filer_cache.json")
CFPB_URL = "https://ffiec.cfpb.gov/v2/reporting/filers/2025"


def _fetch_lender_names():
    """Fetch LEI-to-name mapping from CFPB, with local cache."""
    if os.path.exists(FILER_CACHE):
        with open(FILER_CACHE) as f:
            return json.load(f)

    print("    Fetching lender names from CFPB...")
    req = urllib.request.Request(CFPB_URL)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())

    names = {inst["lei"]: inst["name"] for inst in data["institutions"]}

    with open(FILER_CACHE, "w") as f:
        json.dump(names, f)
    print(f"    Cached {len(names)} lender names")
    return names


def lender_cube():
    """Lender cube at (lei, action, type, purpose) grain."""
    return query("""
        SELECT
            lei,
            action_taken,
            loan_type,
            loan_purpose,
            COUNT(*) as count,
            SUM(CAST(loan_amount AS REAL)) as sum_loan_amount,
            SUM(CASE WHEN interest_rate NOT IN ('Exempt', 'NA', '')
                THEN CAST(interest_rate AS REAL) ELSE 0 END) as sum_rate,
            SUM(CASE WHEN interest_rate NOT IN ('Exempt', 'NA', '')
                THEN 1 ELSE 0 END) as rate_count
        FROM hmda
        GROUP BY lei, action_taken, loan_type, loan_purpose
    """)


def lender_states():
    """Top 5 states per lender by origination count."""
    rows = query("""
        SELECT lei, state_code as state, COUNT(*) as count
        FROM hmda
        WHERE action_taken = '1' AND state_code != '' AND state_code != 'NA'
        GROUP BY lei, state_code
    """)

    # Group by lei, keep top 5 states
    by_lei = {}
    for r in rows:
        by_lei.setdefault(r["lei"], []).append({"state": r["state"], "count": r["count"]})

    result = {}
    for lei, states in by_lei.items():
        states.sort(key=lambda s: s["count"], reverse=True)
        result[lei] = states[:5]

    return result


def generate():
    """Generate the full lender analysis payload.

    Uses short keys in the cube to minimize JSON size (~91K rows).
    Key mapping: l=lei, a=action_taken, t=loan_type, p=loan_purpose,
                 c=count, s=sum_loan_amount, r=sum_rate, rc=rate_count
    """
    names = _fetch_lender_names()
    cube_raw = lender_cube()
    states = lender_states()

    # Compact the cube — short keys, round floats
    cube = []
    for r in cube_raw:
        cube.append({
            "l": r["lei"], "a": r["action_taken"], "t": r["loan_type"],
            "p": r["loan_purpose"], "c": r["count"],
            "s": round(r["sum_loan_amount"]),
            "r": round(r["sum_rate"], 2), "rc": r["rate_count"],
        })

    return {
        "names": names,
        "cube": cube,
        "states": states,
    }
