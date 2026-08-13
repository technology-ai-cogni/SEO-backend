import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.db import engine
from sqlalchemy import text

def clean_non_admin_users():
    with engine.begin() as conn:
        res = conn.execute(text("DELETE FROM users WHERE LOWER(email) != 'admin@company.com' AND role != 'ADMIN'"))
        print(f"[Success] Removed {res.rowcount} non-admin users from Supabase database.")

if __name__ == "__main__":
    clean_non_admin_users()
