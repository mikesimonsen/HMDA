"""Investor-activity analysis.

Aggregates HMDA originations along the dimensions used to identify investor
loans: occupancy_type, business_or_commercial_purpose, and loan_purpose.

The "investor" segment in HMDA is most cleanly defined as
occupancy_type=3 (investment property) AND business_or_commercial_purpose=1.
Pure spec-builder construction loans are commercial loans and largely
excluded from HMDA reporting; only construction-to-permanent loans for
1-4 unit dwellings are reportable.
"""

from .db import query
from .geographic import _load_county_lookup


OCCUPANCY_LABELS = {
    "1": "Principal residence",
    "2": "Second residence",
    "3": "Investment property",
}

BIZ_PURPOSE_LABELS = {
    "1": "Business/commercial",
    "2": "Consumer",
    "1111": "Exempt",
}

LOAN_PURPOSE_LABELS = {
    "1": "Purchase",
    "2": "Home Improvement",
    "31": "Refinance",
    "32": "Cash-out Refinance",
    "4": "Other",
    "5": "Not Applicable",
}


def national_cube():
    """Originations grouped by (year, occupancy, business_purpose, loan_purpose).

    Includes interest-rate sums so the frontend can compute an avg rate per
    slice without a second pass.
    """
    rows = query("""
        SELECT
            activity_year as y,
            occupancy_type as occ,
            business_or_commercial_purpose as bp,
            loan_purpose as p,
            COUNT(*) as c,
            SUM(CAST(loan_amount AS REAL)) as s,
            SUM(CASE WHEN interest_rate NOT IN ('Exempt','NA','')
                THEN CAST(interest_rate AS REAL) ELSE 0 END) as r,
            SUM(CASE WHEN interest_rate NOT IN ('Exempt','NA','')
                THEN 1 ELSE 0 END) as rc
        FROM hmda
        WHERE action_taken = '1'
        GROUP BY activity_year, occupancy_type, business_or_commercial_purpose, loan_purpose
    """)
    for row in rows:
        row["s"] = round(row["s"])
        row["r"] = round(row["r"], 2)
    return rows


def state_cube():
    """State originations grouped by (year, state, occupancy, biz_purpose, loan_purpose)."""
    rows = query("""
        SELECT
            activity_year as y,
            state_code as state,
            occupancy_type as occ,
            business_or_commercial_purpose as bp,
            loan_purpose as p,
            COUNT(*) as c,
            SUM(CAST(loan_amount AS REAL)) as s
        FROM hmda
        WHERE action_taken = '1' AND state_code != '' AND state_code != 'NA'
        GROUP BY activity_year, state_code, occupancy_type, business_or_commercial_purpose, loan_purpose
    """)
    for row in rows:
        row["s"] = round(row["s"])
    return rows


def county_cube(top_n=200):
    """Top-N counties by origination count, grouped along investor dims.

    State is derived from the county FIPS prefix (matches the Geographic tab).
    """
    _, fips_to_state = _load_county_lookup()
    rows = query("""
        SELECT
            activity_year as y,
            county_code as fips,
            occupancy_type as occ,
            business_or_commercial_purpose as bp,
            loan_purpose as p,
            COUNT(*) as c,
            SUM(CAST(loan_amount AS REAL)) as s
        FROM hmda
        WHERE action_taken = '1' AND county_code IN (
            SELECT county_code FROM hmda
            WHERE action_taken = '1' AND county_code != '' AND county_code != 'NA'
            GROUP BY county_code
            ORDER BY COUNT(*) DESC
            LIMIT ?
        )
        GROUP BY activity_year, county_code, occupancy_type, business_or_commercial_purpose, loan_purpose
    """, [top_n])
    for row in rows:
        row["s"] = round(row["s"])
        row["state"] = fips_to_state.get(row["fips"][:2], "")
    return rows


def generate():
    # County names live in geographic.json; the frontend reuses them.
    return {
        "national_cube": national_cube(),
        "state_cube": state_cube(),
        "county_cube": county_cube(),
        "labels": {
            "occupancy": OCCUPANCY_LABELS,
            "biz_purpose": BIZ_PURPOSE_LABELS,
            "loan_purpose": LOAN_PURPOSE_LABELS,
        },
    }
