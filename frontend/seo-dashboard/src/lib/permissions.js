export const CATEGORIES = {
  ADMIN: 'Admin',
  INTERNAL: 'Internal',
  CLIENT_ACCESS: 'Client Access',
  VENDOR: 'Vendor',
};

export const ROLES = {
  ADMIN: 'ADMIN',
  // Internal Category Roles
  INTERNAL_TEAM_LEAD: 'INTERNAL_TEAM_LEAD',
  INTERNAL_SR_ASSOCIATE: 'INTERNAL_SR_ASSOCIATE',
  INTERNAL_ASSOCIATE: 'INTERNAL_ASSOCIATE',
  // Client Access Category Roles
  CLIENT_TEAM_LEAD: 'CLIENT_TEAM_LEAD',
  CLIENT_SR_ASSOCIATE: 'CLIENT_SR_ASSOCIATE',
  CLIENT_ASSOCIATE: 'CLIENT_ASSOCIATE',
  // Vendor Category Roles
  VENDOR: 'VENDOR',
  // Legacy fallback
  USER: 'USER',
};

export const ROLE_DISPLAY_NAMES = {
  ADMIN: 'Admin',
  INTERNAL_TEAM_LEAD: 'Team Lead',
  INTERNAL_SR_ASSOCIATE: 'Sr. Associate',
  INTERNAL_ASSOCIATE: 'Associate',
  CLIENT_TEAM_LEAD: 'Client Team Lead',
  CLIENT_SR_ASSOCIATE: 'Client Sr. Associate',
  CLIENT_ASSOCIATE: 'Client Associate',
  VENDOR: 'Vendor',
  USER: 'User'
};

export const CATEGORY_ROLES_MAP = {
  [CATEGORIES.ADMIN]: [ROLES.ADMIN],
  [CATEGORIES.INTERNAL]: [ROLES.INTERNAL_TEAM_LEAD, ROLES.INTERNAL_SR_ASSOCIATE, ROLES.INTERNAL_ASSOCIATE],
  [CATEGORIES.CLIENT_ACCESS]: [ROLES.CLIENT_TEAM_LEAD, ROLES.CLIENT_SR_ASSOCIATE, ROLES.CLIENT_ASSOCIATE],
  [CATEGORIES.VENDOR]: [ROLES.VENDOR]
};

// Centralized list of permissions
export const PERMISSIONS = {
  VIEW_DASHBOARD: 'view_dashboard',
  VIEW_REPORTS: 'view_reports',
  UPLOAD_DATA: 'upload_data',
  RUN_ANALYSIS: 'run_analysis',
  MANAGE_ASSIGNED_PROJECTS: 'manage_assigned_projects',
  FULL_ACCESS: 'full_access',
  RESTORE_PROJECT: 'restore_project',
  VIEW_LOGS: 'view_logs',
  MANAGE_USERS: 'manage_users',
};

// Maps roles to their active permissions
const STANDARD_PERMISSIONS = [PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_REPORTS];

export const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.UPLOAD_DATA,
    PERMISSIONS.RUN_ANALYSIS,
    PERMISSIONS.MANAGE_ASSIGNED_PROJECTS,
    PERMISSIONS.FULL_ACCESS,
    PERMISSIONS.RESTORE_PROJECT,
    PERMISSIONS.VIEW_LOGS,
    PERMISSIONS.MANAGE_USERS
  ],
  // Internal Category Roles
  [ROLES.INTERNAL_TEAM_LEAD]: [...STANDARD_PERMISSIONS, PERMISSIONS.UPLOAD_DATA, PERMISSIONS.RUN_ANALYSIS, PERMISSIONS.MANAGE_ASSIGNED_PROJECTS],
  [ROLES.INTERNAL_SR_ASSOCIATE]: [...STANDARD_PERMISSIONS, PERMISSIONS.UPLOAD_DATA],
  [ROLES.INTERNAL_ASSOCIATE]: [...STANDARD_PERMISSIONS],

  // Client Access Category Roles
  [ROLES.CLIENT_TEAM_LEAD]: [...STANDARD_PERMISSIONS, PERMISSIONS.UPLOAD_DATA, PERMISSIONS.RUN_ANALYSIS],
  [ROLES.CLIENT_SR_ASSOCIATE]: [...STANDARD_PERMISSIONS, PERMISSIONS.UPLOAD_DATA],
  [ROLES.CLIENT_ASSOCIATE]: [...STANDARD_PERMISSIONS],

  // Vendor Category Roles
  [ROLES.VENDOR]: [...STANDARD_PERMISSIONS],
  [ROLES.USER]: [...STANDARD_PERMISSIONS]
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
  if (userRole === 'ADMIN') return true;

  const userPerms = (user.permissions || 'Default').trim().toLowerCase();

  // If user has explicit View Only override from Admin:
  if (userPerms === 'view only' || userPerms === 'view') {
    if (permission !== PERMISSIONS.VIEW_PROJECTS && permission !== PERMISSIONS.VIEW_LOGS) {
      return false;
    }
  }

  if (permission === PERMISSIONS.RESTORE_PROJECT && (userPerms.includes('recycle bin') || userPerms.includes('recycle-bin') || userPerms.includes('full control'))) {
    return true;
  }
  if (permission === PERMISSIONS.VIEW_LOGS && (userPerms.includes('logs') || userPerms.includes('full control'))) {
    return true;
  }
  if (permission === PERMISSIONS.RUN_ANALYSIS && canEdit(user)) {
    return true;
  }

  const permissions = ROLE_PERMISSIONS[userRole] || [];
  return permissions.includes(permission);
}

/**
 * Verifies whether a user profile is granted access to a given route/section.
 * Restricted by default unless explicitly granted by Admin in user.section_access.
 *
 * @param {Object} user - Logged in user context.
 * @param {string} routePath - Navigation path (e.g. 'search-visibility/keywords').
 * @returns {boolean} True if route access is allowed.
 */
export function canAccessRoute(user, routePath) {
  if (!user || !user.role) return true;
  const userRole = user.role.toUpperCase();
  if (userRole === 'ADMIN') return true;

  // Off-Page restriction: when a project is not allocated to an associate or to anyone, they should not be able to see the off-page
  if (routePath === 'search-visibility/off-page-scheduler' || routePath.startsWith('search-visibility/off-page-scheduler')) {
    const hasAllocatedProject = Boolean(
      user?.assigned_project &&
      user.assigned_project.trim() !== '' &&
      user.assigned_project.trim() !== 'All Projects' &&
      user.assigned_project.trim().toLowerCase() !== 'none'
    );
    if (!hasAllocatedProject) {
      return false;
    }
  }

  const sectionAccess = (user.section_access || 'Default').trim();
  const lowerAccess = sectionAccess.toLowerCase();
  const userPerms = (user.permissions || 'Default').trim().toLowerCase();

  const isDefaultAccess = lowerAccess.startsWith('default') || !sectionAccess;
  const hasFullAccess = lowerAccess.includes('access all') || lowerAccess.includes('all sections');

  // Common authenticated user pages
  if (
    routePath === 'profile' ||
    routePath === 'login' ||
    routePath === 'landing' ||
    routePath === 'help' ||
    routePath === 'notifications' ||
    routePath === 'home' ||
    routePath === 'dashboard'
  ) {
    return true;
  }

  // System & Management Pages (Controlled by Action Permissions / Role)
  if (routePath === 'users') {
    return userRole === 'ADMIN';
  }

  if (routePath === 'recycle-bin') {
    return userRole === 'ADMIN' || userPerms.includes('recycle bin') || userPerms.includes('recycle-bin') || userPerms.includes('full control');
  }

  if (routePath === 'logs') {
    return userRole === 'ADMIN' || userPerms.includes('logs') || userPerms.includes('full control');
  }

  if (hasFullAccess) return true;

  // Role-Based Default Section Access (when sectionAccess === 'Default'):
  if (isDefaultAccess) {
    if (userRole === 'VENDOR') {
      return routePath === 'search-visibility/off-page-scheduler' || routePath === 'home';
    }
    if (userRole === 'CLIENT_ASSOCIATE') {
      return routePath.startsWith('search-visibility') || routePath === 'home';
    }
    if (userRole === 'CLIENT_SR_ASSOCIATE') {
      return routePath.startsWith('search-visibility') || routePath.startsWith('ai-visibility') || routePath === 'home';
    }
    if (userRole === 'CLIENT_TEAM_LEAD') {
      return routePath.startsWith('search-visibility') || routePath.startsWith('ai-visibility') || routePath.startsWith('content-engine') || routePath === 'home';
    }
    // Internal Associate, Internal Sr Associate, Internal Team Lead have default access to all workspace modules
    return true;
  }

  // Explicit Section Access Overrides (Supports Multiple Allocated Modules):
  let isAllowed = false;

  if (lowerAccess.includes('project setup') && routePath.startsWith('project-setup')) {
    isAllowed = true;
  }

  if (lowerAccess.includes('performance')) {
    const performanceRoutes = [
      'search-visibility/position-analysis',
      'search-visibility/ai-analysis',
      'search-visibility/keywords',
      'search-visibility/top-pages',
      'search-visibility/competitors'
    ];
    if (performanceRoutes.some(r => routePath === r || routePath.startsWith(r))) {
      isAllowed = true;
    }
  }

  if (lowerAccess.includes('operations')) {
    const operationsRoutes = [
      'search-visibility/off-page-scheduler'
    ];
    if (operationsRoutes.some(r => routePath === r || routePath.startsWith(r))) {
      isAllowed = true;
    }
  }

  return isAllowed;
}

/**
 * Role-Based Default Action Permission Mapping:
 * - ADMIN: Full Control
 * - INTERNAL_TEAM_LEAD: View + Edit + Delete
 * - INTERNAL_SR_ASSOCIATE: View + Edit
 * - INTERNAL_ASSOCIATE: View Only (Read-Only Default)
 * - CLIENT_TEAM_LEAD: View + Edit
 * - CLIENT_SR_ASSOCIATE: View Only (Read-Only Default)
 * - CLIENT_ASSOCIATE: View Only (Read-Only Default)
 * - VENDOR: View Only (Read-Only Default)
 * - USER: View Only (Read-Only Default)
 *
 * @param {Object} user - Logged in user context.
 * @returns {boolean} True if user is read-only.
 */
export function isReadOnlyUser(user) {
  if (!user || !user.role) return false;
  const role = user.role.toUpperCase();
  if (role === 'ADMIN') return false;

  const permissions = (user.permissions || 'Default').trim().toLowerCase();

  // Explicit Admin Overrides:
  if (permissions === 'view only' || permissions === 'view') return true;
  if (permissions.includes('edit') || permissions.includes('update') || permissions.includes('delete') || permissions.includes('full control')) return false;

  // Role-Based Defaults (when permissions === 'Default'):
  if (
    role === 'INTERNAL_ASSOCIATE' ||
    role === 'CLIENT_SR_ASSOCIATE' ||
    role === 'CLIENT_ASSOCIATE' ||
    role === 'VENDOR' ||
    role === 'USER'
  ) {
    return true; // Default is View Only for these roles!
  }

  return false;
}

/**
 * Determines whether a user can perform edit actions.
 * Triggered by: 'View + Edit', 'View + Edit + Delete', 'Full Control'
 *
 * Permission levels (from Users Page):
 *   View Only              → Edit ❌  Delete ❌  Run/Import ❌
 *   View + Edit            → Edit ✅  Delete ❌  Run/Import ❌
 *   View + Edit + Delete   → Edit ✅  Delete ✅  Run/Import ❌
 *   Full Control           → Edit ✅  Delete ✅  Run/Import ✅
 *
 * @param {Object} user - Logged in user context.
 * @returns {boolean} True if user can see/use edit buttons.
 */
export function canEdit(user) {
  if (!user || !user.role) return false;
  const role = user.role.toUpperCase();
  if (role === 'ADMIN') return true;

  const permissions = (user.permissions || 'Default').trim().toLowerCase();

  // Explicit permission overrides:
  if (permissions === 'view only' || permissions === 'view') return false;
  if (
    permissions.includes('edit') ||
    permissions.includes('update') ||
    permissions.includes('delete') ||
    permissions.includes('full control')
  ) return true;

  // Role-Based Defaults (when permissions === 'Default'):
  if (role === 'INTERNAL_TEAM_LEAD' || role === 'CLIENT_TEAM_LEAD') {
    return true;
  }

  return false;
}

/**
 * Determines whether a user can perform delete actions.
 * Triggered by: 'View + Edit + Delete', 'Full Control'
 *
 * @param {Object} user - Logged in user context.
 * @returns {boolean} True if user can see/use delete buttons.
 */
export function canDelete(user) {
  if (!user || !user.role) return false;
  const role = user.role.toUpperCase();
  if (role === 'ADMIN') return true;

  const permissions = (user.permissions || 'Default').trim().toLowerCase();

  // Explicit permission overrides:
  if (permissions === 'view only' || permissions === 'view') return false;
  if (
    permissions.includes('delete') ||
    permissions.includes('update') ||
    permissions.includes('full control')
  ) return true;

  // Role-Based Defaults: no role gets delete by default except ADMIN
  return false;
}

/**
 * Determines whether a user can run update operations such as AI-Clustering and AI Rank Check.
 * Triggered by: 'View + Edit + Delete + Update', 'Full Control'
 *
 * @param {Object} user - Logged in user context.
 * @returns {boolean} True if user can trigger AI-Clustering and AI Rank Check.
 */
export function canUpdate(user) {
  if (!user || !user.role) return false;
  const role = user.role.toUpperCase();
  if (role === 'ADMIN') return true;

  const permissions = (user.permissions || 'Default').trim().toLowerCase();

  // Explicit permission overrides:
  if (permissions === 'view only' || permissions === 'view') return false;
  if (
    permissions.includes('update') ||
    permissions.includes('full control')
  ) return true;

  // Role-Based Defaults:
  if (role === 'INTERNAL_TEAM_LEAD' || role === 'CLIENT_TEAM_LEAD') return true;

  return false;
}

/**
 * Determines whether a user can download data files (CSV, Excel).
 * Requires explicit 'View + Edit + Delete + Update' or 'Full Control' permissions,
 * or Admin / Team Lead default roles. Internal Associates and viewers do NOT get download permission by default.
 *
 * @param {Object} user - Logged in user context.
 * @returns {boolean} True if user is allowed to download CSV/Excel data.
 */
export function canDownload(user) {
  if (!user || !user.role) return false;
  const role = user.role.toUpperCase();
  if (role === 'ADMIN') return true;

  const permissions = (user.permissions || 'Default').trim().toLowerCase();

  // Explicit permission overrides:
  if (permissions === 'view only' || permissions === 'view') return false;
  if (
    permissions.includes('update') ||
    permissions.includes('full control') ||
    permissions.includes('download')
  ) {
    return true;
  }

  // Internal Associates, Sr Associates, Client Associates, Vendors default to NO download capability
  if (
    role === 'INTERNAL_ASSOCIATE' ||
    role === 'INTERNAL_SR_ASSOCIATE' ||
    role === 'CLIENT_ASSOCIATE' ||
    role === 'CLIENT_SR_ASSOCIATE' ||
    role === 'VENDOR' ||
    role === 'USER'
  ) {
    return false;
  }

  // Role-Based Defaults: Team Leads get download permission by default
  if (role === 'INTERNAL_TEAM_LEAD' || role === 'CLIENT_TEAM_LEAD') return true;

  return false;
}

/**
 * Determines whether a user can run/trigger analysis actions or import data.
 * Triggered only by: 'Full Control'
 *
 * @param {Object} user - Logged in user context.
 * @returns {boolean} True if user can trigger Re-analyze, Import Data, Schedule Activity.
 */
export function canRunActions(user) {
  if (!user || !user.role) return false;
  const role = user.role.toUpperCase();
  if (role === 'ADMIN') return true;

  const permissions = (user.permissions || 'Default').trim().toLowerCase();

  // Explicit permission overrides:
  if (permissions === 'view only' || permissions === 'view') return false;

  if (
    permissions.includes('full control') ||
    permissions.includes('edit') ||
    permissions.includes('update') ||
    permissions.includes('delete') ||
    canEdit(user)
  ) return true;

  // Role-Based Defaults (when permissions === 'Default'):
  if (role === 'INTERNAL_TEAM_LEAD' || role === 'CLIENT_TEAM_LEAD') return true;

  return false;
}

/**
 * Checks whether a user is an Associate (Internal, Client, or legacy user role).
 *
 * @param {Object} user - Logged in user context.
 * @returns {boolean} True if user is an Associate.
 */
export function isAssociateUser(user) {
  if (!user || !user.role) return false;
  const role = user.role.toUpperCase();
  return (
    role === 'INTERNAL_ASSOCIATE' ||
    role === 'INTERNAL_SR_ASSOCIATE' ||
    role === 'CLIENT_ASSOCIATE' ||
    role === 'CLIENT_SR_ASSOCIATE' ||
    role === 'USER' ||
    role.includes('ASSOCIATE')
  );
}

/**
 * Determines whether a user can run Brand Discovery analysis.
 * Default Permission Rules:
 * - ADMIN & Team Leads: Full continuous run/re-analyze permission.
 * - Associates: Default allowed ONCE per project. After 1 hit, the Analyze button is removed for them.
 * - View Only override: Cannot run.
 *
 * @param {Object} user - Logged in user context.
 * @param {string} projectSlug - The active project identifier.
 * @returns {boolean} True if user is allowed to hit Analyze on Brand Discovery.
 */
export function canRunBrandDiscovery(user, projectSlug) {
  if (!user || !user.role) return false;
  const role = user.role.toUpperCase();
  if (role === 'ADMIN') return true;

  const permissions = (user.permissions || 'Default').trim().toLowerCase();

  // Explicit permission overrides:
  if (permissions === 'view only' || permissions === 'view') return false;
  if (
    permissions.includes('full control') ||
    permissions.includes('edit') ||
    permissions.includes('update') ||
    permissions.includes('delete') ||
    canEdit(user)
  ) return true;

  // Team Leads get multi-use access
  if (role === 'INTERNAL_TEAM_LEAD' || role === 'CLIENT_TEAM_LEAD') return true;

  // Associates: Allowed ONCE by default for Brand Discovery
  if (isAssociateUser(user)) {
    const userId = user.id || user.username || user.email || 'user';
    const storageKey = `bd_analyzed_associate_${userId}_${projectSlug || 'default'}`;
    const hasAnalyzed = localStorage.getItem(storageKey) === 'true';
    return !hasAnalyzed;
  }

  return false;
}

/**
 * Determines whether a user can run/trigger AI model analysis on Brand Discovery or AI Analysis pages.
 * Default Permission Rules for Associates:
 * - Admin, Team Leads, or Full Control: Continuous access to Analyze / Re-analyze anytime.
 * - Associates: Allowed to hit Analyze ONCE per model per project. Once data comes back (hasData === true)
 *   or if analysis was previously run, the button gets HIDDEN.
 *
 * @param {Object} user - Logged in user context.
 * @param {string} projectSlug - The active project identifier.
 * @param {string} engineName - Model identifier ('chatgpt', 'gemini', 'ai overview', 'all').
 * @param {boolean} hasData - Whether data is currently available for this model/project.
 * @returns {boolean} True if the Analyze button should be visible.
 */
export function canRunAiModelAnalysis(user, projectSlug, engineName = 'all', hasData = false) {
  if (!user || !user.role) return false;
  const role = user.role.toUpperCase();
  if (role === 'ADMIN' || role === 'INTERNAL_TEAM_LEAD' || role === 'CLIENT_TEAM_LEAD') return true;

  const permissions = (user.permissions || 'Default').trim().toLowerCase();
  if (permissions.includes('full control')) return true;
  if (permissions === 'view only' || permissions === 'view') return false;

  if (isAssociateUser(user)) {
    // If data is already present for this model/project, hide the Analyze button for associates
    if (hasData) return false;

    const userId = user.id || user.username || user.email || 'user';
    const slug = projectSlug || 'default';
    const eng = (engineName || 'all').toLowerCase().trim().replace(/\s+/g, '_');
    
    // Check general project run flag or specific engine run flag
    const genKey = `bd_analyzed_associate_${userId}_${slug}`;
    const engKey = `ai_analyzed_associate_${userId}_${slug}_${eng}`;
    
    const hasGenRun = localStorage.getItem(genKey) === 'true';
    const hasEngRun = localStorage.getItem(engKey) === 'true';

    if (eng === 'all' && (hasGenRun || hasEngRun)) return false;
    return !hasEngRun;
  }

  return true;
}

export function recordAiModelAnalysisRun(user, projectSlug, engineName = 'all') {
  if (!user) return;
  const userId = user.id || user.username || user.email || 'user';
  const slug = projectSlug || 'default';
  const eng = (engineName || 'all').toLowerCase().trim().replace(/\s+/g, '_');

  const genKey = `bd_analyzed_associate_${userId}_${slug}`;
  const engKey = `ai_analyzed_associate_${userId}_${slug}_${eng}`;

  localStorage.setItem(genKey, 'true');
  localStorage.setItem(engKey, 'true');
}


