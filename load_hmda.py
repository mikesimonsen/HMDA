#!/usr/bin/env python3
"""Load HMDA data from zip into SQLite database."""

import csv
import sqlite3
import sys
import zipfile
import io
import time

DB_PATH = "hmda.db"
ZIP_PATH = "2025_combined_mlar_header.zip"
TXT_NAME = "2025_combined_mlar_header.txt"
BATCH_SIZE = 50_000

def main():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA cache_size=-2000000")  # 2GB cache

    with zipfile.ZipFile(ZIP_PATH) as zf:
        with zf.open(TXT_NAME) as f:
            reader = csv.reader(io.TextIOWrapper(f, encoding="utf-8"), delimiter="|")
            headers = next(reader)

            # Create table - all columns as TEXT initially (HMDA uses many coded values)
            cols_def = ", ".join(f'"{h}" TEXT' for h in headers)
            conn.execute(f"DROP TABLE IF EXISTS hmda")
            conn.execute(f"CREATE TABLE hmda ({cols_def})")

            placeholders = ", ".join(["?"] * len(headers))
            insert_sql = f"INSERT INTO hmda VALUES ({placeholders})"

            batch = []
            total = 0
            t0 = time.time()

            for row in reader:
                batch.append(row)
                if len(batch) >= BATCH_SIZE:
                    conn.executemany(insert_sql, batch)
                    conn.commit()
                    total += len(batch)
                    elapsed = time.time() - t0
                    rate = total / elapsed
                    print(f"  {total:,} rows loaded ({rate:,.0f} rows/sec)", flush=True)
                    batch = []

            if batch:
                conn.executemany(insert_sql, batch)
                conn.commit()
                total += len(batch)

            elapsed = time.time() - t0
            print(f"\nDone: {total:,} rows in {elapsed:.1f}s ({total/elapsed:,.0f} rows/sec)")

    # Create key indexes for analysis
    print("Creating indexes...")
    conn.execute("CREATE INDEX idx_lei ON hmda(lei)")
    conn.execute("CREATE INDEX idx_state ON hmda(state_code)")
    conn.execute("CREATE INDEX idx_action ON hmda(action_taken)")
    conn.execute("CREATE INDEX idx_loan_type ON hmda(loan_type)")
    conn.execute("CREATE INDEX idx_loan_purpose ON hmda(loan_purpose)")
    conn.commit()
    print("Indexes created.")

    # Quick stats
    count = conn.execute("SELECT COUNT(*) FROM hmda").fetchone()[0]
    print(f"Total rows in database: {count:,}")

    conn.close()

if __name__ == "__main__":
    main()
