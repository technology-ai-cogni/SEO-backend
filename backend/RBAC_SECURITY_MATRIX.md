# RBAC Security Matrix & Authorization Specification

This document defines the server-authoritative authorization matrix enforced across the entire backend API. All authorization decisions are derived exclusively from cryptographically validated JWT access tokens and verified against the backend identity store.

---

## 1. Core Authorization Principles

1. **Zero Client Trust**: Values stored in `sessionStorage`, `localStorage`, React state, request parameters, or body fields (such as `role: "ADMIN"`) are completely ignored during authorization decisions.
2. **Deny By Default**: All mutating and sensitive data endpoints require explicit authentication and authorization dependencies (`require_admin`, `require_authenticated_user`, `require_project_access`).
3. **Object-Level Scoping**: Non-admin users are strictly locked to their `assigned_project`. Cross-tenant project snooping (IDOR) is rejected with `403 Forbidden`.
4. **Immediate Revocation**: Users with `status = "Disabled"` are rejected immediately on every request (`403 Forbidden`), even if their JWT has not expired.

---

## 2. API Authorization Matrix

| Endpoint | Method | Required Dependency | Minimum Role / Scope | Unauthenticated | Associate / Vendor | Admin |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `/auth/login` | POST | None (Public) | Any valid credentials | `200` | `200` | `200` |
| `/auth/signup` | POST | None (Public) | Any new registration | `201` | `201` | `201` |
| `/auth/me` | GET | `require_authenticated_user` | Any active user | `401` | `200` | `200` |
| `/auth/users` | GET | `require_admin` | `ADMIN` only | `401` | `403` | `200` |
| `/auth/users` | POST | `require_admin` | `ADMIN` only | `401` | `403` | `201` |
| `/auth/users/{id}/status` | PUT | `require_admin` | `ADMIN` only | `401` | `403` | `200` |
| `/auth/users/{id}/role` | PUT | `require_admin` | `ADMIN` only | `401` | `403` | `200` |
| `/auth/users/{id}` | DELETE | `require_admin` | `ADMIN` only | `401` | `403` | `200` |
| `/projects` | GET | `require_authenticated_user` | Authenticated users | `401` | `200` | `200` |
| `/projects/{project}` | DELETE | `require_admin` | `ADMIN` only | `401` | `403` | `200` |
| `/projects/{project}/hard` | DELETE | `require_admin` | `ADMIN` only | `401` | `403` | `200` |
| `/projects/{project}/restore` | POST | `require_admin` | `ADMIN` only | `401` | `403` | `200` |
| `/projects/{project}/results` | GET | `require_project_access` | Allocated project or Admin | `401` | `200` / `403`* | `200` |
| `/projects/{project}/categories` | GET | `require_project_access` | Allocated project or Admin | `401` | `200` / `403`* | `200` |
| `/projects/{project}/clusters` | GET | `require_project_access` | Allocated project or Admin | `401` | `200` / `403`* | `200` |
| `/projects/{project}/recluster` | POST | `require_project_access` | Allocated project or Admin | `401` | `200` / `403`* | `200` |
| `/projects/{project}/kw-data` | DELETE | `require_project_access` | Allocated project or Admin | `401` | `200` / `403`* | `200` |
| `/projects/{project}/pages` | DELETE | `require_project_access` | Allocated project or Admin | `401` | `200` / `403`* | `200` |
| `/recycle-bin` | GET | `require_authenticated_user` | Authenticated users | `401` | `200` | `200` |
| `/recycle-bin/{id}/restore` | POST | `require_admin` | `ADMIN` only | `401` | `403` | `200` |
| `/recycle-bin/{id}` | DELETE | `require_admin` | `ADMIN` only | `401` | `403` | `200` |
| `/audit-logs` | GET | `require_authenticated_user` | Authenticated users | `401` | `200` | `200` |
| `/audit-logs` | DELETE | `require_admin` | `ADMIN` only | `401` | `403` | `200` |
| `/domains` | GET / POST | `require_authenticated_user` | Authenticated users | `401` | `200` | `200` |
| `/domains/{project_slug}` | PATCH / PUT | `require_project_access` | Allocated project or Admin | `401` | `200` / `403`* | `200` |
| `/keywords/{kw_id}` | DELETE | `require_authenticated_user` | Authenticated users | `401` | `200` | `200` |
| `/keywords/bulk-delete` | POST | `require_authenticated_user` | Authenticated users | `401` | `200` | `200` |
| `/pages/bulk-delete` | POST | `require_authenticated_user` | Authenticated users | `401` | `200` | `200` |
| `/competitors` | ALL | `require_authenticated_user` | Authenticated users | `401` | `200` | `200` |

*\* Note on Object-Level Access (`require_project_access`)*: If an Associate assigned to `project_a` attempts to access `project_b`, the backend returns `403 Forbidden` with `"Access denied: your account is not allocated to project 'project_b'"`.

---

## 3. Automated Test Verification

Run all RBAC and authentication tests with:
```bash
python -m pytest tests/test_rbac_security.py -v
```
