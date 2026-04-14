#!/usr/bin/env python3
"""Load multi-year HMDA data from zip files into SQLite database.

Handles two file formats:
- Combined MLAR (2022-2025): 85 columns, pipe-delimited
- Public dynamic LAR (2018-2021): 99 columns, pipe-delimited
  Mapped to MLAR schema with column renames and extra columns dropped.
"""

import csv
import sqlite3
import os
import zipfile
import io
import time

DB_PATH = "hmda.db"
BATCH_SIZE = 50_000

# Files to load in order (oldest first)
FILES = [
    # (zip_path, txt_name_inside_zip, format)
    ("input-data/2018_lar.zip", "2018_lar.txt", "lar"),
    ("input-data/2019_lar.zip", "2019_lar.txt", "lar"),
    ("input-data/2020_lar.zip", "2020_lar.txt", "lar"),
    ("input-data/2021_lar.zip", "2021_lar.txt", "lar"),
    ("input-data/2022_combined_mlar_header.zip", "2022_combined_mlar_header.txt", "mlar"),
    ("input-data/2023_combined_mlar_header.zip", "2023_combined_mlar_header.txt", "mlar"),
    ("input-data/2024_combined_mlar_header.zip", "2024_combined_mlar_header.txt", "mlar"),
    ("2025_combined_mlar_header.zip", "2025_combined_mlar_header.txt", "mlar"),
]

# The 85 MLAR columns define our table schema
MLAR_COLUMNS = [
    "activity_year", "lei", "loan_type", "loan_purpose", "preapproval",
    "construction_method", "occupancy_type", "loan_amount", "action_taken",
    "state_code", "county_code", "census_tract",
    "applicant_ethnicity_1", "applicant_ethnicity_2", "applicant_ethnicity_3",
    "applicant_ethnicity_4", "applicant_ethnicity_5",
    "co_applicant_ethnicity_1", "co_applicant_ethnicity_2", "co_applicant_ethnicity_3",
    "co_applicant_ethnicity_4", "co_applicant_ethnicity_5",
    "applicant_ethnicity_observed", "co_applicant_ethnicity_observed",
    "applicant_race_1", "applicant_race_2", "applicant_race_3",
    "applicant_race_4", "applicant_race_5",
    "co_applicant_race_1", "co_applicant_race_2", "co_applicant_race_3",
    "co_applicant_race_4", "co_applicant_race_5",
    "applicant_race_observed", "co_applicant_race_observed",
    "applicant_sex", "co_applicant_sex",
    "applicant_sex_observed", "co_applicant_sex_observed",
    "applicant_age", "applicant_age_above_62",
    "co_applicant_age", "co_applicant_age_above_62",
    "income", "purchaser_type", "rate_spread", "hoepa_status", "lien_status",
    "applicant_credit_scoring_model", "co_applicant_credit_scoring_model",
    "denial_reason_1", "denial_reason_2", "denial_reason_3", "denial_reason_4",
    "total_loan_costs", "total_points_and_fees", "origination_charges",
    "discount_points", "lender_credits", "interest_rate",
    "prepayment_penalty_term", "debt_to_income_ratio",
    "combined_loan_to_value_ratio", "loan_term", "intro_rate_period",
    "balloon_payment", "interest_only_payment", "negative_amortization",
    "other_non_amortizing_features", "property_value",
    "manufactured_home_secured_property_type",
    "manufactured_home_land_property_interest",
    "total_units", "multifamily_affordable_units",
    "submission_of_application", "initially_payable_to_institution",
    "aus_1", "aus_2", "aus_3", "aus_4", "aus_5",
    "reverse_mortgage", "open_end_line_of_credit",
    "business_or_commercial_purpose",
]

# Column renames: public LAR name -> MLAR name
LAR_TO_MLAR_RENAMES = {
    "applicant_credit_score_type": "applicant_credit_scoring_model",
    "co_applicant_credit_score_type": "co_applicant_credit_scoring_model",
    "other_nonamortizing_features": "other_non_amortizing_features",
}


def build_column_map(lar_headers):
    """Build index mapping from LAR columns to MLAR column positions.

    Returns a list of LAR column indices, one per MLAR column, or -1 if
    the MLAR column doesn't exist in the LAR file.
    """
    # Apply renames
    renamed = []
    for h in lar_headers:
        renamed.append(LAR_TO_MLAR_RENAMES.get(h, h))

    lar_idx = {name: i for i, name in enumerate(renamed)}
    mapping = []
    for col in MLAR_COLUMNS:
        mapping.append(lar_idx.get(col, -1))
    return mapping


def remap_row(row, col_map):
    """Remap a LAR row to MLAR column order."""
    return [row[i] if i >= 0 else "" for i in col_map]


def load_file(conn, zip_path, txt_name, fmt, insert_sql):
    """Load one zip file into the database."""
    print(f"\n  Loading {zip_path}...")
    t0 = time.time()

    with zipfile.ZipFile(zip_path) as zf:
        with zf.open(txt_name) as f:
            reader = csv.reader(io.TextIOWrapper(f, encoding="utf-8"), delimiter="|")
            headers = next(reader)

            col_map = None
            if fmt == "lar":
                col_map = build_column_map(headers)
                missing = sum(1 for i in col_map if i < 0)
                if missing:
                    missing_names = [MLAR_COLUMNS[j] for j, i in enumerate(col_map) if i < 0]
                    print(f"    Note: {missing} MLAR columns not in LAR: {missing_names}")

            batch = []
            total = 0

            for row in reader:
                if col_map:
                    row = remap_row(row, col_map)
                batch.append(row)
                if len(batch) >= BATCH_SIZE:
                    conn.executemany(insert_sql, batch)
                    conn.commit()
                    total += len(batch)
                    elapsed = time.time() - t0
                    print(f"    {total:,} rows ({elapsed:.0f}s, {total/elapsed:,.0f}/sec)", flush=True)
                    batch = []

            if batch:
                conn.executemany(insert_sql, batch)
                conn.commit()
                total += len(batch)

    elapsed = time.time() - t0
    print(f"    Done: {total:,} rows in {elapsed:.1f}s")
    return total


def main():
    # Check which files exist
    available = [(z, t, f) for z, t, f in FILES if os.path.exists(z)]
    missing = [(z, t, f) for z, t, f in FILES if not os.path.exists(z)]

    if missing:
        print("Missing files (will be skipped):")
        for z, t, f in missing:
            print(f"  {z}")
        print()

    print(f"Loading {len(available)} files into {DB_PATH}...")

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA cache_size=-2000000")

    # Create table from MLAR schema
    cols_def = ", ".join(f'"{h}" TEXT' for h in MLAR_COLUMNS)
    conn.execute("DROP TABLE IF EXISTS hmda")
    conn.execute(f"CREATE TABLE hmda ({cols_def})")

    placeholders = ", ".join(["?"] * len(MLAR_COLUMNS))
    insert_sql = f"INSERT INTO hmda VALUES ({placeholders})"

    grand_total = 0
    t0 = time.time()

    for zip_path, txt_name, fmt in available:
        count = load_file(conn, zip_path, txt_name, fmt, insert_sql)
        grand_total += count

    elapsed = time.time() - t0
    print(f"\n{'='*60}")
    print(f"All files loaded: {grand_total:,} rows in {elapsed:.1f}s")

    # Create indexes
    print("\nCreating indexes...")
    conn.execute("CREATE INDEX idx_year ON hmda(activity_year)")
    conn.execute("CREATE INDEX idx_lei ON hmda(lei)")
    conn.execute("CREATE INDEX idx_state ON hmda(state_code)")
    conn.execute("CREATE INDEX idx_action ON hmda(action_taken)")
    conn.execute("CREATE INDEX idx_loan_type ON hmda(loan_type)")
    conn.execute("CREATE INDEX idx_loan_purpose ON hmda(loan_purpose)")
    conn.execute("CREATE INDEX idx_year_action ON hmda(activity_year, action_taken)")
    conn.commit()
    print("Indexes created.")

    # Per-year summary
    print("\nPer-year summary:")
    rows = conn.execute("""
        SELECT activity_year, COUNT(*),
               SUM(CASE WHEN action_taken = '1' THEN 1 ELSE 0 END)
        FROM hmda GROUP BY activity_year ORDER BY activity_year
    """).fetchall()
    for year, total, originated in rows:
        print(f"  {year}: {total:>12,} apps, {originated:>12,} originated")

    total = conn.execute("SELECT COUNT(*) FROM hmda").fetchone()[0]
    print(f"\nTotal: {total:,} rows")
    conn.close()


if __name__ == "__main__":
    main()
