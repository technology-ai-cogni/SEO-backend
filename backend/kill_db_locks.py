"""
Utility script to terminate stuck or idle-in-transaction connections
holding table locks in PostgreSQL (e.g. on Supabase).
"""
import os
import sys
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("[Error] DATABASE_URL is not set in .env")
    sys.exit(1)

engine = create_engine(DATABASE_URL)

def kill_stuck_locks():
    with engine.begin() as conn:
        print("[DB Locks] Checking for stuck or blocking PostgreSQL connections...")
        try:
            result = conn.execute(text("""
                SELECT pid, usename, state, age(clock_timestamp(), query_start) as age, query
                FROM pg_stat_activity
                WHERE pid <> pg_backend_pid()
                  AND (
                    state = 'idle in transaction'
                    OR state = 'idle in transaction (aborted)'
                    OR wait_event_type = 'Lock'
                  );
            """)).fetchall()
        except Exception as e:
            print(f"[DB Locks] Could not query pg_stat_activity: {e}")
            return

        if not result:
            print("[DB Locks] No stuck or blocking connections found.")
            return

        print(f"[DB Locks] Found {len(result)} candidate connection(s). Terminating...")
        for row in result:
            pid = row[0]
            print(f"  - Terminating PID {pid} (state: {row[2]}, age: {row[3]}, user: {row[1]})")
            try:
                conn.execute(text("SELECT pg_terminate_backend(:pid)"), {"pid": pid})
            except Exception as ex:
                print(f"    Warning: Could not terminate PID {pid}: {ex}")

        print("[DB Locks] Done clearing locks.")

if __name__ == "__main__":
    kill_stuck_locks()
