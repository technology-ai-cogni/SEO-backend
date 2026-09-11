#!/usr/bin/env python3
"""
Utility script to detect and terminate stuck database locks or idle-in-transaction
connections in Supabase / PostgreSQL.

Usage:
    python backend/scripts/kill_db_locks.py
"""

import os
import sys
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

# Load environment
env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
load_dotenv(env_path)
load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL or DATABASE_URL.startswith("sqlite"):
    print("[kill_db_locks] No PostgreSQL DATABASE_URL configured. Exiting.")
    sys.exit(0)

engine = create_engine(DATABASE_URL)

def check_and_kill_locks():
    print("[kill_db_locks] Inspecting active connections and locks in PostgreSQL...")
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        # 1. View blocking/idle connections
        res = conn.execute(text("""
            SELECT pid, usename, state, age(clock_timestamp(), query_start) AS duration, query
            FROM pg_stat_activity
            WHERE pid <> pg_backend_pid()
              AND usename = 'postgres'
              AND (
                  state = 'idle in transaction'
                  OR state = 'idle in transaction (aborted)'
                  OR wait_event_type = 'Lock'
                  OR age(clock_timestamp(), query_start) > interval '1 minute'
              )
        """)).mappings().all()

        if not res:
            print("[kill_db_locks] No stuck locks or blocking connections found. Database is healthy.")
            return

        print(f"[kill_db_locks] Found {len(res)} stuck / long-running connection(s):")
        for row in res:
            print(f"  - PID {row['pid']} | User: {row['usename']} | State: {row['state']} | Duration: {row['duration']}")
            print(f"    Query: {str(row['query'])[:120]}...")

        # 2. Terminate stuck connections
        for row in res:
            pid = row['pid']
            try:
                conn.execute(text("SELECT pg_terminate_backend(:pid)"), {"pid": pid})
                print(f"[kill_db_locks] Terminated PID {pid} successfully.")
            except Exception as e:
                print(f"[kill_db_locks] Failed to terminate PID {pid}: {e}")

if __name__ == "__main__":
    check_and_kill_locks()
