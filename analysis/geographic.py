"""Geographic HMDA analysis — state and county level."""

import csv
import os

from .db import query

COUNTY_FIPS_FILE = os.path.join(os.path.dirname(__file__), "county_fips.txt")


def _load_county_names():
    """Load FIPS-to-county-name lookup from Census file.

    Returns dict keyed by 5-digit FIPS (e.g. "04013") -> "Maricopa County".
    """
    names = {}
    with open(COUNTY_FIPS_FILE, encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="|")
        for row in reader:
            fips5 = row["STATEFP"] + row["COUNTYFP"]
            names[fips5] = row["COUNTYNAME"]
    return names


def state_overview():
    """State-level summary: volume, rates, denial rates, loan mix."""
    return query("""
        SELECT
            state_code as state,
            COUNT(*) as apps,
            SUM(CASE WHEN action_taken = '1' THEN 1 ELSE 0 END) as originated,
            ROUND(SUM(CASE WHEN action_taken = '1' THEN 1.0 ELSE 0 END) / COUNT(*) * 100, 1) as orig_pct,
            ROUND(SUM(CASE WHEN action_taken = '3' THEN 1.0 ELSE 0 END) / COUNT(*) * 100, 1) as deny_pct,
            ROUND(AVG(CASE WHEN action_taken = '1' THEN CAST(loan_amount AS REAL) END), 0) as avg_loan,
            ROUND(AVG(CASE WHEN action_taken = '1' AND interest_rate NOT IN ('Exempt', 'NA', '')
                       THEN CAST(interest_rate AS REAL) END), 3) as avg_rate,
            ROUND(SUM(CASE WHEN action_taken = '1' THEN CAST(loan_amount AS REAL) ELSE 0 END) / 1e9, 1) as volume_b,
            -- Loan type mix (originated)
            ROUND(SUM(CASE WHEN action_taken = '1' AND loan_type = '1' THEN 1.0 ELSE 0 END)
                / NULLIF(SUM(CASE WHEN action_taken = '1' THEN 1.0 ELSE 0 END), 0) * 100, 1) as conv_pct,
            ROUND(SUM(CASE WHEN action_taken = '1' AND loan_type = '2' THEN 1.0 ELSE 0 END)
                / NULLIF(SUM(CASE WHEN action_taken = '1' THEN 1.0 ELSE 0 END), 0) * 100, 1) as fha_pct,
            ROUND(SUM(CASE WHEN action_taken = '1' AND loan_type = '3' THEN 1.0 ELSE 0 END)
                / NULLIF(SUM(CASE WHEN action_taken = '1' THEN 1.0 ELSE 0 END), 0) * 100, 1) as va_pct,
            -- Purpose mix (originated)
            ROUND(SUM(CASE WHEN action_taken = '1' AND loan_purpose = '1' THEN 1.0 ELSE 0 END)
                / NULLIF(SUM(CASE WHEN action_taken = '1' THEN 1.0 ELSE 0 END), 0) * 100, 1) as purchase_pct,
            ROUND(SUM(CASE WHEN action_taken = '1' AND loan_purpose IN ('31','32') THEN 1.0 ELSE 0 END)
                / NULLIF(SUM(CASE WHEN action_taken = '1' THEN 1.0 ELSE 0 END), 0) * 100, 1) as refi_pct
        FROM hmda
        WHERE state_code != '' AND state_code != 'NA'
        GROUP BY state_code
        HAVING COUNT(*) > 1000
        ORDER BY apps DESC
    """)


def top_counties(limit=50):
    """Top counties by origination volume."""
    county_names = _load_county_names()
    rows = query("""
        SELECT
            county_code as fips,
            state_code as state,
            COUNT(*) as apps,
            SUM(CASE WHEN action_taken = '1' THEN 1 ELSE 0 END) as originated,
            ROUND(SUM(CASE WHEN action_taken = '1' THEN 1.0 ELSE 0 END) / COUNT(*) * 100, 1) as orig_pct,
            ROUND(SUM(CASE WHEN action_taken = '3' THEN 1.0 ELSE 0 END) / COUNT(*) * 100, 1) as deny_pct,
            ROUND(AVG(CASE WHEN action_taken = '1' THEN CAST(loan_amount AS REAL) END), 0) as avg_loan,
            ROUND(SUM(CASE WHEN action_taken = '1' THEN CAST(loan_amount AS REAL) ELSE 0 END) / 1e9, 1) as volume_b
        FROM hmda
        WHERE county_code != '' AND county_code != 'NA'
        GROUP BY state_code, county_code
        ORDER BY originated DESC
        LIMIT ?
    """, [limit])
    for r in rows:
        r["county_name"] = county_names.get(r["fips"], "Unknown")
    return rows


def state_rankings():
    """Generate various state ranking lists."""
    states = state_overview()

    by_volume = sorted(states, key=lambda s: s["originated"], reverse=True)[:10]
    by_avg_loan = sorted(states, key=lambda s: s["avg_loan"] or 0, reverse=True)[:10]
    by_cheapest = sorted(states, key=lambda s: s["avg_loan"] or float("inf"))[:10]
    by_denial = sorted(states, key=lambda s: s["deny_pct"] or 0, reverse=True)[:10]
    by_lowest_denial = sorted(states, key=lambda s: s["deny_pct"] or float("inf"))[:10]
    by_highest_rate = sorted(states, key=lambda s: s["avg_rate"] or 0, reverse=True)[:10]
    by_lowest_rate = sorted(states, key=lambda s: s["avg_rate"] or float("inf"))[:10]

    return {
        "by_volume": by_volume,
        "most_expensive": by_avg_loan,
        "least_expensive": by_cheapest,
        "highest_denial": by_denial,
        "lowest_denial": by_lowest_denial,
        "highest_rate": by_highest_rate,
        "lowest_rate": by_lowest_rate,
    }


def generate():
    """Generate the full geographic analysis payload."""
    return {
        "states": state_overview(),
        "rankings": state_rankings(),
        "top_counties": top_counties(50),
    }
