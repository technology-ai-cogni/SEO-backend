# Production RBAC & Authorization Matrix

This document defines the complete access control specification for the SEO-backend platform. Authorization is enforced strictly on the server side via cryptographic JWT verification, database-backed role validation, and object-level scoping.

Client-side state (including `sessionStorage`, `localStorage`, React state, and URL/request body claims) is treated as untrusted and has zero bearing on backend privilege evaluation.

---

## Authorization Invariant

```
Unauthenticated Request               ──> 401 Unauthorized
Authenticated but Unauthorized Role   ──> 403 Forbidden (Empty/No protected data)
Authenticated but Unassigned Project  ──> 403 Forbidden (IDOR/BOLA Protection)
Authenticated and Authorized          ──> 200 OK (Scoped data returned)
```

---

## Complete API Authorization Matrix

| Category | Endpoint | Method | Required Role / Dependency | Object Scoping / IDOR Rule | Unauth (401) | Unauthz (403) | Success (2xx) | Protected Data Returned |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Auth** | `/auth/login` | POST | Public | None | N/A | 401 on Bad Creds | 200 OK | JWT Token & User Profile |
| **Auth** | `/auth/signup` | POST | Public | None | N/A | 400 on Conflict | 201 Created | JWT Token & User Profile |
| **Auth** | `/auth/me` | GET | `require_authenticated_user` | Self only (from JWT) | 401 | 403 (if disabled) | 200 OK | Current User Profile |
| **Auth / RBAC** | `/auth/users` | GET | `require_admin` | Global user directory | 401 | 403 Forbidden | 200 OK | Full User Roster & Permissions |
| **Auth / RBAC** | `/auth/users` | POST | `require_admin` | Admin only | 401 | 403 Forbidden | 201 Created | Created User Account |
| **Auth / RBAC** | `/auth/users/{id}/role` | PUT | `require_admin` | Admin only | 401 | 403 Forbidden | 200 OK | Updated User Settings |
| **Auth / RBAC** | `/auth/users/{id}/status` | PUT | `require_admin` | Admin only | 401 | 403 Forbidden | 200 OK | Updated User Status |
| **Auth / RBAC** | `/auth/users/{id}` | DELETE | `require_admin` | Admin only | 401 | 403 Forbidden | 200 OK | User Profile Purged |
| **Security Logs** | `/audit-logs` | GET | `require_admin` | Admin only | 401 | 403 Forbidden | 200 OK | System Audit Trail |
| **Security Logs** | `/audit-logs` | POST | `require_authenticated_user` | Appends log with verified identity | 401 | 403 (if disabled) | 200 OK | Log Confirmation |
| **Security Logs** | `/audit-logs` | DELETE | `require_admin` | Admin only | 401 | 403 Forbidden | 200 OK | Purged Logs |
| **Recycle Bin** | `/recycle-bin` | GET | `require_admin` | Admin only | 401 | 403 Forbidden | 200 OK | Archived Items & Deleted Projects |
| **Recycle Bin** | `/recycle-bin/{id}/restore` | POST | `require_admin` | Admin only | 401 | 403 Forbidden | 200 OK | Restored Item |
| **Recycle Bin** | `/recycle-bin/{id}` | DELETE | `require_admin` | Admin only | 401 | 403 Forbidden | 200 OK | Hard Purged Item |
| **Projects** | `/projects` | GET | `require_authenticated_user` | `only_deleted=true` requires Admin. Non-admin results filtered to `assigned_project`. | 401 | 403 (if deleted requested) | 200 OK | Scoped Project Directory |
| **Projects** | `/projects` | POST | `require_authenticated_user` | Project Creator | 401 | 403 (if disabled) | 200 OK | Created Project |
| **Projects** | `/projects/{project}` | DELETE | `require_admin` | Admin only (Soft delete) | 401 | 403 Forbidden | 200 OK | Project Moved to Trash |
| **Projects** | `/projects/{project}/hard` | DELETE | `require_admin` | Admin only (Permanent purge) | 401 | 403 Forbidden | 200 OK | Project Permanently Purged |
| **Projects** | `/projects/{project}/restore` | POST | `require_admin` | Admin only | 401 | 403 Forbidden | 200 OK | Restored Project |
| **Project Data** | `/projects/{project}/results` | GET | `require_project_access` | Checked against JWT `assigned_project` | 401 | 403 Forbidden | 200 OK | Category & Cluster Keyword Metrics |
| **Project Data** | `/projects/{project}/categories` | GET | `require_project_access` | Checked against JWT `assigned_project` | 401 | 403 Forbidden | 200 OK | Keyword Categorization Data |
| **Project Data** | `/projects/{project}/clusters` | GET | `require_project_access` | Checked against JWT `assigned_project` | 401 | 403 Forbidden | 200 OK | Keyword Clusters |
| **Project Data** | `/projects/{project}/pages` | GET | `require_project_access` | Checked against JWT `assigned_project` | 401 | 403 Forbidden | 200 OK | Project Pages |
| **Project Data** | `/projects/{project}/pages` | POST | `require_project_access` | Checked against JWT `assigned_project` | 401 | 403 Forbidden | 200 OK | Uploaded Pages |
| **Project Data** | `/projects/{project}/competitor-pages` | GET | `require_project_access` | Checked against JWT `assigned_project` | 401 | 403 Forbidden | 200 OK | Competitor Pages |
| **Project Data** | `/projects/{project}/competitor-pages` | POST | `require_project_access` | Checked against JWT `assigned_project` | 401 | 403 Forbidden | 200 OK | Uploaded Competitor Pages |
| **Project Data** | `/projects/{slug}/summary` | GET | `require_project_access` | Checked against JWT `assigned_project` | 401 | 403 Forbidden | 200 OK | Aggregated Dashboard Metrics |
| **Project Data** | `/projects/{slug}/outreach` | GET | `require_project_access` | Checked against JWT `assigned_project` | 401 | 403 Forbidden | 200 OK | Project Outreach Sites |
| **Project Data** | `/projects/{slug}/outreach` | POST | `require_project_access` | Checked against JWT `assigned_project` | 401 | 403 Forbidden | 200 OK | Added Outreach Site |
| **Project Data** | `/projects/{slug}/ai-analysis-history` | GET | `require_project_access` | Checked against JWT `assigned_project` | 401 | 403 Forbidden | 200 OK | Historical LLM Visibility Audits |
| **Project Data** | `/projects/{project}/check-rank` | POST | `require_project_access` | Checked against JWT `assigned_project` | 401 | 403 Forbidden | 200 OK | Enqueued Rank Checks |
| **Competitors** | `/competitors` | GET | `require_authenticated_user` | Filtered to `assigned_project`. Explicit query for unassigned project yields 403. | 401 | 403 Forbidden | 200 OK | Competitor Intelligence |
| **Domains** | `/domains` | GET | `require_authenticated_user` | Scoped to `assigned_project` | 401 | 403 (if disabled) | 200 OK | Domain Registrations |
| **Jobs** | `/jobs` | GET | `require_authenticated_user` | Scoped to `assigned_project` | 401 | 403 (if disabled) | 200 OK | Jobs List |
| **Jobs** | `/jobs/{job_id}` | GET | `require_authenticated_user` | Checked against job's domain / `assigned_project` | 401 | 403 Forbidden | 200 OK | Job Details |
| **Jobs** | `/jobs/{job_id}/results` | GET | `require_authenticated_user` | Checked against job's domain / `assigned_project` | 401 | 403 Forbidden | 200 OK | Categorization / Cluster Results |
| **Monthly Ops** | `/monthly-operations/imports` | GET | `require_authenticated_user` | Scoped to `assigned_project` | 401 | 403 (if disabled) | 200 OK | Monthly Imports |
| **Monthly Ops** | `/monthly-operations/schedules` | GET | `require_authenticated_user` | Scoped to `assigned_project` | 401 | 403 (if disabled) | 200 OK | Scheduled Activities |
| **Off-Page** | `/off-page-activities` | GET | `require_authenticated_user` | Filtered to `assigned_project` | 401 | 403 Forbidden | 200 OK | Off-Page Tasks |
| **Off-Page** | `/off-page-activities/{id}` | GET | `require_authenticated_user` | Checked against activity project allocation | 401 | 403 Forbidden | 200 OK | Task Detail |

---

## Regression Testing Summary

The test suite in [`backend/tests/test_rbac_security.py`](file:///c:/Users/abhin/SEO-backend/backend/tests/test_rbac_security.py) runs 26 automated regression tests verifying both mutation integrity and read confidentiality:

1. **Authentication Token Integrity**: Unauthenticated requests, malformed tokens, bad signatures, and expired tokens return `401`.
2. **Privilege Boundary Enforcement**: Associate tokens attempting administrative mutations (delete user, modify roles, hard delete project, purge audit logs) return `403`.
3. **Database State Verification**: Live database queries verify zero database mutation occurs when an unauthorized user attempts a mutation.
4. **Confidentiality Protection**: Associate tokens attempting to access `/audit-logs`, `/recycle-bin`, or `GET /projects?only_deleted=true` return `403` with zero protected data in the response body.
5. **IDOR / BOLA Prevention**: Associate tokens attempting to access unassigned projects, unassigned competitors, unassigned project pages, summaries, outreach sites, or AI analysis history return `403 Forbidden`.
6. **Scoped Entity Listings**: Listing endpoints (`/projects`, `/domains`, `/competitors`, `/jobs`, `/outreach`) strictly filter returned collections to only the user's allocated project(s).
