"""Generate filterable data cubes for the interactive frontend.

Instead of pre-aggregated totals, this produces granular aggregates at the
(action_taken, loan_type, loan_purpose) grain so the JS frontend can slice
and dice by clicking chart segments.
"""

from .db import query


def main_cube():
    """Core cube: counts and sums at (action, type, purpose) grain.

    Each row has additive metrics the frontend can sum/average across any
    combination of filters.
    """
    return query("""
        SELECT
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
        GROUP BY action_taken, loan_type, loan_purpose
    """)


def rate_cube():
    """Rate distribution cube for originated loans at (type, purpose, bucket) grain."""
    return query("""
        SELECT
            loan_type,
            loan_purpose,
            CASE
                WHEN CAST(interest_rate AS REAL) < 4 THEN 'Under 4%'
                WHEN CAST(interest_rate AS REAL) < 5 THEN '4-5%'
                WHEN CAST(interest_rate AS REAL) < 6 THEN '5-6%'
                WHEN CAST(interest_rate AS REAL) < 7 THEN '6-7%'
                WHEN CAST(interest_rate AS REAL) < 8 THEN '7-8%'
                WHEN CAST(interest_rate AS REAL) < 9 THEN '8-9%'
                WHEN CAST(interest_rate AS REAL) >= 9 THEN '9%+'
            END as rate_bucket,
            COUNT(*) as count
        FROM hmda
        WHERE action_taken = '1'
          AND interest_rate NOT IN ('Exempt', 'NA', '')
        GROUP BY loan_type, loan_purpose, rate_bucket
    """)


def denial_cube():
    """Denial reason cube at (type, purpose, reason) grain."""
    return query("""
        SELECT
            loan_type,
            loan_purpose,
            denial_reason_1 as reason,
            COUNT(*) as count
        FROM hmda
        WHERE action_taken = '3'
          AND denial_reason_1 != ''
          AND denial_reason_1 != '10'
        GROUP BY loan_type, loan_purpose, denial_reason_1
    """)


def generate():
    """Generate the full cube payload."""
    return {
        "main": main_cube(),
        "rates": rate_cube(),
        "denials": denial_cube(),
    }
