"""National-level HMDA summary statistics."""

from .db import query

ACTION_LABELS = {
    "1": "Loan originated",
    "2": "Approved, not accepted",
    "3": "Denied",
    "4": "Withdrawn",
    "5": "File closed for incompleteness",
    "6": "Purchased by institution",
    "7": "Preapproval denied",
    "8": "Preapproval approved, not accepted",
}

LOAN_TYPE_LABELS = {"1": "Conventional", "2": "FHA", "3": "VA", "4": "USDA/RHS"}

LOAN_PURPOSE_LABELS = {
    "1": "Purchase",
    "2": "Home Improvement",
    "31": "Refinance",
    "32": "Cash-out Refinance",
    "4": "Other",
    "5": "Not Applicable",
}

DENIAL_REASON_LABELS = {
    "1": "Debt-to-income ratio",
    "2": "Employment history",
    "3": "Credit history",
    "4": "Collateral",
    "5": "Insufficient cash",
    "6": "Unverifiable information",
    "7": "Credit application incomplete",
    "8": "Mortgage insurance denied",
    "9": "Other",
    "10": "Not applicable",
}


def summary():
    """High-level national summary numbers."""
    rows = query("""
        SELECT
            COUNT(*) as total_apps,
            SUM(CASE WHEN action_taken = '1' THEN 1 ELSE 0 END) as originated,
            SUM(CASE WHEN action_taken = '3' THEN 1 ELSE 0 END) as denied,
            COUNT(DISTINCT lei) as lender_count,
            ROUND(AVG(CASE WHEN action_taken = '1' THEN CAST(loan_amount AS REAL) END), 0) as avg_loan,
            ROUND(SUM(CASE WHEN action_taken = '1' THEN CAST(loan_amount AS REAL) ELSE 0 END) / 1e9, 1) as total_volume_b,
            ROUND(AVG(CASE WHEN action_taken = '1' AND interest_rate NOT IN ('Exempt', 'NA', '')
                       THEN CAST(interest_rate AS REAL) END), 3) as avg_rate
        FROM hmda
    """)
    return rows[0]


def by_action():
    """Application outcomes breakdown."""
    rows = query("""
        SELECT action_taken as code, COUNT(*) as count,
               ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM hmda), 1) as pct,
               ROUND(AVG(CAST(loan_amount AS REAL)), 0) as avg_loan
        FROM hmda GROUP BY action_taken ORDER BY count DESC
    """)
    for r in rows:
        r["label"] = ACTION_LABELS.get(r["code"], r["code"])
    return rows


def by_loan_type():
    """Loan type breakdown."""
    rows = query("""
        SELECT loan_type as code, COUNT(*) as count,
               ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM hmda), 1) as pct,
               ROUND(AVG(CAST(loan_amount AS REAL)), 0) as avg_loan
        FROM hmda GROUP BY loan_type ORDER BY count DESC
    """)
    for r in rows:
        r["label"] = LOAN_TYPE_LABELS.get(r["code"], r["code"])
    return rows


def by_loan_purpose():
    """Loan purpose breakdown."""
    rows = query("""
        SELECT loan_purpose as code, COUNT(*) as count,
               ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM hmda), 1) as pct,
               ROUND(AVG(CAST(loan_amount AS REAL)), 0) as avg_loan
        FROM hmda GROUP BY loan_purpose ORDER BY count DESC
    """)
    for r in rows:
        r["label"] = LOAN_PURPOSE_LABELS.get(r["code"], r["code"])
    return rows


def rate_distribution():
    """Interest rate distribution for originated loans."""
    rows = query("""
        SELECT
            CASE
                WHEN CAST(interest_rate AS REAL) < 4 THEN 'Under 4%'
                WHEN CAST(interest_rate AS REAL) < 5 THEN '4-5%'
                WHEN CAST(interest_rate AS REAL) < 6 THEN '5-6%'
                WHEN CAST(interest_rate AS REAL) < 7 THEN '6-7%'
                WHEN CAST(interest_rate AS REAL) < 8 THEN '7-8%'
                WHEN CAST(interest_rate AS REAL) < 9 THEN '8-9%'
                WHEN CAST(interest_rate AS REAL) >= 9 THEN '9%+'
                ELSE 'Exempt/NA'
            END as bucket,
            COUNT(*) as count
        FROM hmda
        WHERE action_taken = '1'
        GROUP BY bucket
        ORDER BY bucket
    """)
    return rows


def denial_reasons():
    """Top denial reasons for denied applications."""
    rows = query("""
        SELECT denial_reason_1 as code, COUNT(*) as count
        FROM hmda
        WHERE action_taken = '3' AND denial_reason_1 != '' AND denial_reason_1 != '10'
        GROUP BY denial_reason_1
        ORDER BY count DESC
    """)
    for r in rows:
        r["label"] = DENIAL_REASON_LABELS.get(r["code"], r["code"])
    return rows


def generate():
    """Generate the full national analysis payload."""
    return {
        "summary": summary(),
        "by_action": by_action(),
        "by_loan_type": by_loan_type(),
        "by_loan_purpose": by_loan_purpose(),
        "rate_distribution": rate_distribution(),
        "denial_reasons": denial_reasons(),
    }
