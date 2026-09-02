import os
import sys
import pytest
from datetime import datetime, timedelta, timezone
import jwt
from fastapi.testclient import TestClient

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app import app
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
