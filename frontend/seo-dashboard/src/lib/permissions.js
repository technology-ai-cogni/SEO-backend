export const ROLES = {
  USER: 'USER',
  VENDOR: 'VENDOR',
  ADMIN: 'ADMIN',
};

// Centralized list of permissions
export const PERMISSIONS = {
  VIEW_DASHBOARD: 'view_dashboard',
  VIEW_REPORTS: 'view_reports',
  UPLOAD_DATA: 'upload_data',
  MANAGE_ASSIGNED_PROJECTS: 'manage_assigned_projects',
  FULL_ACCESS: 'full_access',
  RESTORE_PROJECT: 'restore_project',
  VIEW_LOGS: 'view_logs',
  MANAGE_USERS: 'manage_users',
};

// Maps roles to their active permissions
export const ROLE_PERMISSIONS = {
  [ROLES.USER]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_REPORTS
  ],
  [ROLES.VENDOR]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.UPLOAD_DATA,
    PERMISSIONS.MANAGE_ASSIGNED_PROJECTS
  ],
  [ROLES.ADMIN]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.UPLOAD_DATA,
    PERMISSIONS.MANAGE_ASSIGNED_PROJECTS,
    PERMISSIONS.FULL_ACCESS,
    PERMISSIONS.RESTORE_PROJECT,
    PERMISSIONS.VIEW_LOGS,
    PERMISSIONS.MANAGE_USERS
  ]
};

/**
 * Checks whether a user possesses the requested permission.
 *
 * @param {Object} user - The logged-in user context.
 * @param {string} permission - The permission constant to verify.
 * @returns {boolean} True if permission is granted, otherwise False.
 */
export function hasPermission(user, permission) {
  if (!user || !user.role) return false;
  const userRole = user.role.toUpperCase();
  const permissions = ROLE_PERMISSIONS[userRole] || [];
  return permissions.includes(permission);
}
