import os
import sys
import pytest
from datetime import datetime, timedelta, timezone
import jwt
from fastapi.testclient import TestClient

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app import app
from auth import router as auth_router_mod
from auth.security import create_access_token, JWT_SECRET_KEY, JWT_ALGORITHM
from auth.dependencies import require_authenticated_user, require_admin, require_project_access

client = TestClient(app)

# Dummy test user identities
ADMIN_USER = {
    "id": 1,
    "email": "admin@company.com",
    "name": "System Admin",
    "role": "ADMIN",
    "category": "Admin",
    "status": "Active",
    "assigned_project": "All Projects"
}

ASSOCIATE_USER = {
    "id": 2,
    "email": "associate@company.com",
    "name": "Test Associate",
    "role": "INTERNAL_ASSOCIATE",
    "category": "Internal",
    "status": "Active",
    "assigned_project": "All Projects"
}

VENDOR_USER = {
    "id": 4,
    "email": "vendor@external.com",
    "name": "Vendor Partner",
    "role": "VENDOR",
    "category": "Vendor",
    "status": "Active",
    "assigned_project": "euroschoolindia"
}

DISABLED_USER = {
    "id": 3,
    "email": "disabled@company.com",
    "name": "Disabled Employee",
    "role": "INTERNAL_ASSOCIATE",
    "category": "Internal",
    "status": "Disabled",
    "assigned_project": "All Projects"
}

READONLY_USER = {
    "id": 5,
    "email": "readonly@company.com",
    "name": "Read Only User",
    "role": "INTERNAL_ASSOCIATE",
    "category": "Internal",
    "status": "Active",
    "permissions": "View Only",
    "assigned_project": "All Projects"
}

EDIT_ONLY_USER = {
    "id": 6,
    "email": "editonly@company.com",
    "name": "Edit Only User",
    "role": "INTERNAL_ASSOCIATE",
    "category": "Internal",
    "status": "Active",
    "permissions": "View + Edit",
    "assigned_project": "All Projects"
}

TEAM_LEAD_USER = {
    "id": 7,
    "email": "lead@company.com",
    "name": "Team Lead User",
    "role": "INTERNAL_TEAM_LEAD",
    "category": "Internal",
    "status": "Active",
    "permissions": "Default",
    "assigned_project": "All Projects"
}


# ─── 1. AUTHENTICATION INTEGRITY TESTS ──────────────────────────────────────────


def test_unauthenticated_request_rejected():
    """No token provided to protected endpoint must return 401."""
    res = client.delete("/projects/euroschoolindia")
    assert res.status_code == 401
    assert "Authentication required" in res.json().get("detail", "")


def test_malformed_token_rejected():
    """Malformed non-JWT token must return 401."""
    headers = {"Authorization": "Bearer not-a-valid-jwt-token"}
    res = client.delete("/projects/euroschoolindia", headers=headers)
    assert res.status_code == 401


def test_invalid_signature_rejected():
    """JWT signed with unauthorized secret key must return 401."""
    fake_token = jwt.encode(
        {"sub": "1", "email": "admin@company.com", "role": "ADMIN", "exp": int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp())},
        "wrong-secret-key-attack",
        algorithm="HS256"
    )
    headers = {"Authorization": f"Bearer {fake_token}"}
    res = client.delete("/projects/euroschoolindia", headers=headers)
    assert res.status_code == 401


def test_expired_token_rejected():
    """Expired JWT must return 401 Session expired."""
    expired_token = jwt.encode(
        {"sub": "1", "email": "admin@company.com", "role": "ADMIN", "exp": int((datetime.now(timezone.utc) - timedelta(hours=1)).timestamp())},
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM
    )
    headers = {"Authorization": f"Bearer {expired_token}"}
    res = client.delete("/projects/euroschoolindia", headers=headers)
    assert res.status_code == 401
    assert "expired" in res.json().get("detail", "").lower()


# ─── 2. ROLE AUTHORIZATION & PRIVILEGE ESCALATION TESTS ──────────────────────

def test_associate_token_cannot_delete_project(monkeypatch):
    """A valid associate token must receive 403 Forbidden when trying to delete a project."""
    token = create_access_token(ASSOCIATE_USER)
    
    # Mock DB lookup so test doesn't require live user query to match
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: ASSOCIATE_USER)
    
    headers = {"Authorization": f"Bearer {token}"}
    res = client.delete("/projects/euroschoolindia", headers=headers)
    assert res.status_code == 403
    assert "Administrative privileges required" in res.json().get("detail", "")


def test_associate_token_cannot_modify_user_roles(monkeypatch):
    """An associate cannot promote themselves or anyone else via /auth/users/{id}/role."""
    token = create_access_token(ASSOCIATE_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: ASSOCIATE_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.put("/auth/users/2/role", json={"role": "ADMIN"}, headers=headers)
    assert res.status_code == 403
    assert "Administrative privileges required" in res.json().get("detail", "")


def test_associate_token_cannot_delete_users(monkeypatch):
    """An associate cannot delete users."""
    token = create_access_token(ASSOCIATE_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: ASSOCIATE_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.delete("/auth/users/1", headers=headers)
    assert res.status_code == 403


def test_unauthorized_user_deletion_does_not_mutate_database(monkeypatch):
    """
    REGRESSION TEST FOR INTEGRITY VULNERABILITY:
    Verifies that when an ASSOCIATE user sends DELETE /auth/users/{target_id},
    1. The response is HTTP 403 Forbidden.
    2. The database state is checked and the target record STILL exists.
    3. The record is NOT deleted until an authorized ADMIN sends the request.
    """
    target_user_record = {"id": 999, "email": "target_delete_victim@company.com"}
    db_state = {999: target_user_record.copy()}

    def mock_get_user_by_email(email):
        if email == ADMIN_USER["email"]:
            return ADMIN_USER
        if email == ASSOCIATE_USER["email"]:
            return ASSOCIATE_USER
        return None

    def mock_delete_user_by_id(uid):
        if uid in db_state:
            return db_state.pop(uid)["email"]
        return None

    monkeypatch.setattr("auth.dependencies.get_user_by_email", mock_get_user_by_email)
    monkeypatch.setattr(sys.modules["auth.router"], "delete_user_by_id", mock_delete_user_by_id)

    # 1. Verify target exists BEFORE any call
    assert 999 in db_state
    assert db_state[999]["email"] == "target_delete_victim@company.com"

    # 2. Attack: Associate attempts to delete target user
    associate_token = create_access_token(ASSOCIATE_USER)
    assoc_headers = {"Authorization": f"Bearer {associate_token}"}
    res_assoc = client.delete("/auth/users/999", headers=assoc_headers)

    # 3. Verify HTTP 403 Forbidden
    assert res_assoc.status_code == 403

    # 4. CRITICAL INTEGRITY CHECK: Verify database was NOT mutated
    assert 999 in db_state, "VULNERABILITY DETECTED: Database record was deleted by unauthorized user!"
    assert db_state[999]["email"] == "target_delete_victim@company.com"

    # 5. Authorized action: Admin deletes target user
    admin_token = create_access_token(ADMIN_USER)
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    res_admin = client.delete("/auth/users/999", headers=admin_headers)

    # 6. Verify HTTP 200 OK and database mutation
    assert res_admin.status_code == 200
    assert 999 not in db_state, "Admin deletion did not delete record from database"


def test_live_database_unauthorized_deletion_integrity(monkeypatch):
    """
    Live Supabase database test verifying target user record persists after unauthorized attack.
    """
    from auth.db import create_user, get_user_by_email, delete_user_by_id
    import time
    test_email = f"integrity_test_{int(time.time())}@company.com"
    created = create_user(
        name="Integrity Target",
        email=test_email,
        password_hash="testpass123",
        role="INTERNAL_ASSOCIATE"
    )
    user_id = created["id"]
    try:
        # Check exists before
        assert get_user_by_email(test_email) is not None

        # Associate attempts delete
        token = create_access_token(ASSOCIATE_USER)
        monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: ASSOCIATE_USER)
        res = client.delete(f"/auth/users/{user_id}", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 403

        # Explicitly verify DB still contains the user
        still_exists = get_user_by_email(test_email, force_refresh=True)
        assert still_exists is not None, "FATAL: Database record was deleted after 403!"
        assert still_exists["id"] == user_id
    finally:
        # Cleanup
        delete_user_by_id(user_id)


def test_associate_token_cannot_clear_audit_logs(monkeypatch):
    """An associate cannot clear audit logs."""
    token = create_access_token(ASSOCIATE_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: ASSOCIATE_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.delete("/audit-logs", headers=headers)
    assert res.status_code == 403


# ─── 3. CLIENT TAMPERING / SPOOFING RESISTANCE ───────────────────────────────

def test_client_spoofing_role_in_request_body_fails(monkeypatch):
    """
    Even if client sends `role: 'ADMIN'` in payload or tries to pass admin claims,
    the backend strictly derives authority from verified server identity.
    """
    token = create_access_token(ASSOCIATE_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: ASSOCIATE_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.delete("/projects/euroschoolindia?user_email=admin@company.com", headers=headers)
    # Backend rejects because token identity is ASSOCIATE
    assert res.status_code == 403


# ─── 4. OBJECT-LEVEL ACCESS CONTROL (IDOR PROTECTION) ─────────────────────────

def test_vendor_cannot_access_unassigned_project(monkeypatch):
    """
    Vendor assigned only to 'euroschoolindia' receives 403 Forbidden
    when attempting to query unassigned project 'other_client_corp'.
    """
    token = create_access_token(VENDOR_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: VENDOR_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/projects/other_client_corp/results", headers=headers)
    assert res.status_code == 403
    assert "not allocated" in res.json().get("detail", "").lower()


def test_associate_can_access_all_projects(monkeypatch):
    """
    Associate role has access across all registered projects.
    """
    token = create_access_token(ASSOCIATE_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: ASSOCIATE_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/projects", headers=headers)
    assert res.status_code == 200


# ─── 5. DISABLED ACCOUNT REVOCATION ──────────────────────────────────────────

def test_disabled_user_token_is_rejected(monkeypatch):
    """A disabled account cannot perform actions even if holding a non-expired JWT."""
    token = create_access_token(DISABLED_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: DISABLED_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/projects", headers=headers)
    assert res.status_code == 403
    assert "disabled" in res.json().get("detail", "").lower()


# ─── 6. READ AUTHORIZATION & CONFIDENTIALITY AUDIT TESTS ──────────────────────

def test_unauthenticated_get_audit_logs_returns_401():
    """Unauthenticated users cannot read audit logs."""
    res = client.get("/audit-logs")
    assert res.status_code == 401
    assert "logs" not in res.json()


def test_associate_cannot_read_audit_logs(monkeypatch):
    """
    Associate attempting to read audit logs receives 403 Forbidden.
    Response must NOT contain any audit log data.
    """
    token = create_access_token(ASSOCIATE_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: ASSOCIATE_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/audit-logs", headers=headers)
    assert res.status_code == 403
    data = res.json()
    assert "logs" not in data
    assert "Administrative privileges required" in data.get("detail", "")


def test_admin_can_read_audit_logs(monkeypatch):
    """Admin users can read audit logs."""
    token = create_access_token(ADMIN_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: ADMIN_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/audit-logs", headers=headers)
    assert res.status_code == 200
    assert "logs" in res.json()


def test_unauthenticated_get_recycle_bin_returns_401():
    """Unauthenticated users cannot read recycle bin."""
    res = client.get("/recycle-bin")
    assert res.status_code == 401
    assert "items" not in res.json()


def test_associate_cannot_read_recycle_bin(monkeypatch):
    """
    Associate attempting to read recycle bin receives 403 Forbidden.
    Response must NOT contain any deleted files/items.
    """
    token = create_access_token(ASSOCIATE_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: ASSOCIATE_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/recycle-bin", headers=headers)
    assert res.status_code == 403
    data = res.json()
    assert "items" not in data
    assert "Administrative privileges required" in data.get("detail", "")


def test_admin_can_read_recycle_bin(monkeypatch):
    """Admin users can read recycle bin."""
    token = create_access_token(ADMIN_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: ADMIN_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/recycle-bin", headers=headers)
    assert res.status_code == 200
    assert "items" in res.json()


def test_associate_cannot_list_only_deleted_projects(monkeypatch):
    """Associates cannot list only deleted projects."""
    token = create_access_token(ASSOCIATE_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: ASSOCIATE_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/projects?only_deleted=true", headers=headers)
    assert res.status_code == 403
    assert "projects" not in res.json()


def test_idor_vendor_cannot_read_unassigned_project_pages(monkeypatch):
    """Vendor cannot read pages of an unassigned project (403 + no data)."""
    token = create_access_token(VENDOR_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: VENDOR_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/projects/unassigned_corp/pages", headers=headers)
    assert res.status_code == 403
    assert "pages" not in res.json()


def test_idor_vendor_cannot_read_unassigned_project_competitors(monkeypatch):
    """Vendor cannot read competitors of an unassigned project (403 + no data)."""
    token = create_access_token(VENDOR_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: VENDOR_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/competitors?project=unassigned_corp", headers=headers)
    assert res.status_code == 403
    assert "competitors" not in res.json()


def test_idor_vendor_cannot_read_unassigned_project_summary(monkeypatch):
    """Vendor cannot read project summary of an unassigned project."""
    token = create_access_token(VENDOR_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: VENDOR_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/projects/unassigned_corp/summary", headers=headers)
    assert res.status_code == 403


def test_idor_vendor_cannot_read_unassigned_project_outreach(monkeypatch):
    """Vendor cannot read outreach sites of an unassigned project."""
    token = create_access_token(VENDOR_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: VENDOR_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/projects/unassigned_corp/outreach", headers=headers)
    assert res.status_code == 403
    assert "sites" not in res.json()


def test_idor_vendor_cannot_read_unassigned_project_ai_history(monkeypatch):
    """Vendor cannot read AI analysis history of an unassigned project."""
    token = create_access_token(VENDOR_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: VENDOR_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/projects/unassigned_corp/ai-analysis-history", headers=headers)
    assert res.status_code == 403


def test_vendor_project_list_scoped_to_assigned_project(monkeypatch):
    """Vendor calling GET /projects only sees their assigned project."""
    token = create_access_token(VENDOR_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: VENDOR_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/projects", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "projects" in data
    for p in data["projects"]:
        assert p.get("slug", "").lower() == "euroschoolindia"


# ─── 4. DEVTOOLS CLIENT-TAMPERING & SERVER-SIDE RBAC MUTATION TESTS ──────────

def test_readonly_user_cannot_create_pages(monkeypatch):
    """Read-only user unhiding 'Add Pages' button via DevTools is blocked with 403."""
    token = create_access_token(READONLY_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: READONLY_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.post("/projects/euroschoolindia/pages", json=[{"pageName": "Hacked", "url": "https://hacked.com"}], headers=headers)
    assert res.status_code == 403
    assert "Forbidden" in res.json().get("detail", "")


def test_readonly_user_cannot_update_page(monkeypatch):
    """Read-only user unhiding edit inputs via DevTools is blocked on PATCH /pages/{id} with 403."""
    token = create_access_token(READONLY_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: READONLY_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.patch("/pages/1", json={"pageName": "Tampered Name"}, headers=headers)
    assert res.status_code == 403
    assert "Forbidden" in res.json().get("detail", "")


def test_readonly_user_cannot_delete_page(monkeypatch):
    """Read-only user unhiding delete buttons via DevTools is blocked on DELETE /pages/{id} with 403."""
    token = create_access_token(READONLY_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: READONLY_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.delete("/pages/1", headers=headers)
    assert res.status_code == 403
    assert "Forbidden" in res.json().get("detail", "")


def test_readonly_user_cannot_bulk_delete_pages(monkeypatch):
    """Read-only user sending bulk delete payload is blocked on POST /pages/bulk-delete with 403."""
    token = create_access_token(READONLY_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: READONLY_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.post("/pages/bulk-delete", json={"ids": [1, 2, 3]}, headers=headers)
    assert res.status_code == 403
    assert "Forbidden" in res.json().get("detail", "")


def test_readonly_user_cannot_delete_keyword(monkeypatch):
    """Read-only user attempting DELETE /keywords/{kw_id} via DevTools receives 403."""
    token = create_access_token(READONLY_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: READONLY_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.delete("/keywords/1", headers=headers)
    assert res.status_code == 403
    assert "Forbidden" in res.json().get("detail", "")


def test_readonly_user_cannot_create_competitor(monkeypatch):
    """Read-only user attempting POST /competitors receives 403."""
    token = create_access_token(READONLY_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: READONLY_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.post("/competitors", json={"domain": "rival.com", "projectSlug": "euroschoolindia"}, headers=headers)
    assert res.status_code == 403
    assert "Forbidden" in res.json().get("detail", "")


def test_readonly_user_cannot_delete_competitor(monkeypatch):
    """Read-only user attempting DELETE /competitors/{id} receives 403."""
    token = create_access_token(READONLY_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: READONLY_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.delete("/competitors/1", headers=headers)
    assert res.status_code == 403
    assert "Forbidden" in res.json().get("detail", "")


def test_edit_only_user_cannot_delete_keyword(monkeypatch):
    """User with View+Edit permissions cannot delete keywords (DELETE rejected with 403)."""
    token = create_access_token(EDIT_ONLY_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: EDIT_ONLY_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.delete("/keywords/1", headers=headers)
    assert res.status_code == 403
    assert "Forbidden" in res.json().get("detail", "")


def test_edit_only_user_cannot_bulk_delete_keywords(monkeypatch):
    """User with View+Edit permissions cannot bulk-delete keywords (403)."""
    token = create_access_token(EDIT_ONLY_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: EDIT_ONLY_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.post("/keywords/bulk-delete", json={"ids": [1, 2]}, headers=headers)
    assert res.status_code == 403
    assert "Forbidden" in res.json().get("detail", "")


def test_readonly_user_cannot_create_off_page_activity(monkeypatch):
    """Read-only user attempting POST /off-page-activities receives 403."""
    token = create_access_token(READONLY_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: READONLY_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.post("/off-page-activities", json={"activity_name": "Test Activity"}, headers=headers)
    assert res.status_code == 403
    assert "Forbidden" in res.json().get("detail", "")


def test_readonly_user_cannot_run_clustering(monkeypatch):
    """Read-only user unhiding AI-Clustering button in DevTools receives 403."""
    token = create_access_token(READONLY_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: READONLY_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.post("/projects/euroschoolindia/recluster", headers=headers)
    assert res.status_code == 403
    assert "Forbidden" in res.json().get("detail", "")


def test_edit_only_user_cannot_run_clustering(monkeypatch):
    """View+Edit user attempting to trigger AI-Clustering receives 403 Forbidden."""
    token = create_access_token(EDIT_ONLY_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: EDIT_ONLY_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.post("/projects/euroschoolindia/recluster", headers=headers)
    assert res.status_code == 403
    assert "Forbidden" in res.json().get("detail", "")


def test_edit_only_user_cannot_run_ai_visibility(monkeypatch):
    """View+Edit user attempting to trigger AI visibility analysis receives 403 Forbidden."""
    token = create_access_token(EDIT_ONLY_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: EDIT_ONLY_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.post("/projects/euroschoolindia/ai-visibility-analysis", json={"engine": "all", "force_refresh": True}, headers=headers)
    assert res.status_code == 403
    assert "Forbidden" in res.json().get("detail", "")


def test_edit_only_user_cannot_run_rank_check(monkeypatch):
    """View+Edit user attempting to trigger rank check receives 403 Forbidden."""
    token = create_access_token(EDIT_ONLY_USER)
    monkeypatch.setattr("auth.dependencies.get_user_by_email", lambda e: EDIT_ONLY_USER)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.post("/projects/euroschoolindia/check-rank", json={"keywords": ["test"]}, headers=headers)
    assert res.status_code == 403
    assert "Forbidden" in res.json().get("detail", "")


# ─── FAILED LOGIN ATTEMPTS & AUTO-LOCKOUT TESTS ─────────────────────────────

def test_login_wrong_password_shows_remaining_attempts(monkeypatch):
    """Wrong password tracks failed attempts and shows remaining attempts countdown."""
    from auth.security import hash_password
    test_user = {
        "id": 99,
        "email": "lockout_test@company.com",
        "name": "Lockout User",
        "role": "INTERNAL_ASSOCIATE",
        "category": "Internal",
        "status": "Active",
        "password_hash": hash_password("CorrectPass123!"),
        "failed_login_attempts": 0
    }
    
    attempts = 0
    def mock_get_user(email, force_refresh=False):
        return test_user

    def mock_record_failed(email):
        nonlocal attempts
        attempts += 1
        return {"failed_attempts": attempts, "is_disabled": attempts >= 5, "user_id": test_user["id"], "just_locked": attempts == 5}

    monkeypatch.setattr(auth_router_mod, "get_user_by_email", mock_get_user)
    monkeypatch.setattr(auth_router_mod, "record_failed_login", mock_record_failed)
    monkeypatch.setattr(auth_router_mod, "insert_audit_log", lambda **kwargs: None)

    # 1st attempt wrong
    res = client.post("/auth/login", json={"email": "lockout_test@company.com", "password": "WrongPassword"})
    assert res.status_code == 401
    assert "4 attempts remaining" in res.json().get("detail", "")

    # 2nd attempt wrong
    res = client.post("/auth/login", json={"email": "lockout_test@company.com", "password": "WrongPassword"})
    assert res.status_code == 401
    assert "3 attempts remaining" in res.json().get("detail", "")


def test_login_auto_disabled_on_5th_failed_attempt(monkeypatch):
    """Entering wrong credentials 5 times automatically disables user account (403 forbidden)."""
    from auth.security import hash_password
    test_user = {
        "id": 100,
        "email": "autolock@company.com",
        "name": "Auto Lock User",
        "role": "INTERNAL_ASSOCIATE",
        "category": "Internal",
        "status": "Active",
        "password_hash": hash_password("SecretPass123!"),
        "failed_login_attempts": 0
    }

    attempts = 0
    def mock_get_user(email, force_refresh=False):
        return test_user

    def mock_record_failed(email):
        nonlocal attempts
        attempts += 1
        is_locked = attempts >= 5
        if is_locked:
            test_user["status"] = "Disabled"
        return {"failed_attempts": attempts, "is_disabled": is_locked, "user_id": test_user["id"], "just_locked": is_locked}

    monkeypatch.setattr(auth_router_mod, "get_user_by_email", mock_get_user)
    monkeypatch.setattr(auth_router_mod, "record_failed_login", mock_record_failed)
    monkeypatch.setattr(auth_router_mod, "insert_audit_log", lambda **kwargs: None)

    # 4 failed attempts
    for i in range(1, 5):
        res = client.post("/auth/login", json={"email": "autolock@company.com", "password": "BadPassword"})
        assert res.status_code == 401

    # 5th failed attempt: Account locks and raises 403
    res5 = client.post("/auth/login", json={"email": "autolock@company.com", "password": "BadPassword"})
    assert res5.status_code == 403
    assert "disabled due to multiple failed login attempts" in res5.json().get("detail", "")

    # 6th attempt with previously locked status: rejected with 403 immediately
    res6 = client.post("/auth/login", json={"email": "autolock@company.com", "password": "SecretPass123!"})
    assert res6.status_code == 403
    assert "disabled" in res6.json().get("detail", "").lower()


def test_successful_login_resets_failed_attempts(monkeypatch):
    """A successful login resets the failed login attempt counter."""
    from auth.security import hash_password
    test_user = {
        "id": 101,
        "email": "reset_test@company.com",
        "name": "Reset User",
        "role": "INTERNAL_ASSOCIATE",
        "category": "Internal",
        "status": "Active",
        "password_hash": hash_password("GoodPassword123!"),
        "failed_login_attempts": 3
    }

    reset_called = False
    def mock_reset_failed(email):
        nonlocal reset_called
        reset_called = True

    monkeypatch.setattr(auth_router_mod, "get_user_by_email", lambda e, force_refresh=False: test_user)
    monkeypatch.setattr(auth_router_mod, "reset_failed_login", mock_reset_failed)
    monkeypatch.setattr(auth_router_mod, "insert_audit_log", lambda **kwargs: None)

    res = client.post("/auth/login", json={"email": "reset_test@company.com", "password": "GoodPassword123!"})
    assert res.status_code == 200
    assert reset_called is True
    assert "access_token" in res.json()


