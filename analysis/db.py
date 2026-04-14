"""Database connection helper for HMDA analysis."""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "hmda.db")


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def query(sql, params=None):
    """Run a query and return results as list of dicts."""
    conn = get_connection()
    cursor = conn.execute(sql, params or [])
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows
