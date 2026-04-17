"""Loan-quality cube.

Aggregates HMDA records at a grain that lets the frontend cross-filter on
quality-related dimensions (DTI, CLTV, purchaser, rate spread, lien,
non-amortizing features) alongside the existing year/action/type/purpose
filters. Bucketed aggressively so the JSON stays loadable over the wire.
"""

from .db import query


# Bucket ordering used by the frontend for axis labels. Keep in sync with
# the CASE expressions below.
DTI_ORDER = ["<20", "20-30", "30-36", "36-50", "50-60", ">60", "NA"]
LTV_ORDER = ["<60", "60-80", "80-90", "90-97", "97-100", ">100", "NA"]
SPREAD_ORDER = ["<1.5", "1.5-3", "3-5", ">5", "NA"]
NON_AM_ORDER = ["vanilla", "exotic", "exempt"]

PURCHASER_LABELS = {
    "0": "Not sold",
    "1": "Fannie Mae",
    "2": "Ginnie Mae",
    "3": "Freddie Mac",
    "4": "Farmer Mac",
    "5": "Private securitizer",
    "6": "Commercial bank/thrift",
    "71": "Credit union/mtg co/finance",
    "72": "Life insurer",
    "8": "Affiliate institution",
    "9": "Other",
}

LIEN_LABELS = {"1": "First lien", "2": "Subordinate", "1111": "Exempt"}

NON_AM_LABELS = {
    "vanilla": "Vanilla",
    "exotic": "Has exotic feature",
    "exempt": "Exempt",
}


def quality_cube():
    """Cube at (year, action, type, purpose, dti, ltv, purchaser, spread, lien, non_am)."""
    return query("""
        SELECT
            activity_year as y,
            action_taken as a,
            loan_type as t,
            loan_purpose as p,
            CASE
                WHEN debt_to_income_ratio IN ('NA', 'Exempt', '') THEN 'NA'
                WHEN debt_to_income_ratio = '<20%' THEN '<20'
                WHEN debt_to_income_ratio = '20%-<30%' THEN '20-30'
                WHEN debt_to_income_ratio = '30%-<36%' THEN '30-36'
                WHEN debt_to_income_ratio = '50%-60%' THEN '50-60'
                WHEN debt_to_income_ratio = '>60%' THEN '>60'
                ELSE '36-50'
            END as d,
            CASE
                WHEN combined_loan_to_value_ratio IN ('NA', 'Exempt', '') THEN 'NA'
                WHEN CAST(combined_loan_to_value_ratio AS REAL) < 60 THEN '<60'
                WHEN CAST(combined_loan_to_value_ratio AS REAL) < 80 THEN '60-80'
                WHEN CAST(combined_loan_to_value_ratio AS REAL) < 90 THEN '80-90'
                WHEN CAST(combined_loan_to_value_ratio AS REAL) < 97 THEN '90-97'
                WHEN CAST(combined_loan_to_value_ratio AS REAL) <= 100 THEN '97-100'
                ELSE '>100'
            END as l,
            purchaser_type as pu,
            CASE
                WHEN rate_spread IN ('NA', 'Exempt', '') THEN 'NA'
                WHEN CAST(rate_spread AS REAL) < 1.5 THEN '<1.5'
                WHEN CAST(rate_spread AS REAL) < 3 THEN '1.5-3'
                WHEN CAST(rate_spread AS REAL) < 5 THEN '3-5'
                ELSE '>5'
            END as rs,
            lien_status as li,
            CASE
                WHEN balloon_payment='1' OR interest_only_payment='1'
                  OR negative_amortization='1' OR other_non_amortizing_features='1' THEN 'exotic'
                WHEN balloon_payment IN ('1111', 'Exempt') THEN 'exempt'
                ELSE 'vanilla'
            END as nm,
            COUNT(*) as c,
            SUM(CAST(loan_amount AS REAL)) as s,
            SUM(CASE WHEN interest_rate NOT IN ('Exempt', 'NA', '')
                THEN CAST(interest_rate AS REAL) ELSE 0 END) as r,
            SUM(CASE WHEN interest_rate NOT IN ('Exempt', 'NA', '')
                THEN 1 ELSE 0 END) as rc
        FROM hmda
        GROUP BY y, a, t, p, d, l, pu, rs, li, nm
    """)


def generate():
    rows = quality_cube()
    for row in rows:
        row["s"] = round(row["s"])
        row["r"] = round(row["r"], 2)
    return {
        "cube": rows,
        "orders": {
            "dti": DTI_ORDER,
            "ltv": LTV_ORDER,
            "spread": SPREAD_ORDER,
            "non_am": NON_AM_ORDER,
        },
        "labels": {
            "purchaser": PURCHASER_LABELS,
            "lien": LIEN_LABELS,
            "non_am": NON_AM_LABELS,
        },
    }
