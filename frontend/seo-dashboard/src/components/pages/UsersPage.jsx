import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Users, UserPlus, Shield, CheckCircle, AlertCircle, RefreshCw, X, Search,
  Trash2, Eye, EyeOff, UserCheck, UserX, Key, Mail, User, Save, Layers, Lock, ChevronDown, Calendar, Info,
  Building2, MapPin, Hash, Phone, ArrowRight
} from 'lucide-react';
import {
  hasPermission, PERMISSIONS, CATEGORIES, ROLES, ROLE_DISPLAY_NAMES, CATEGORY_ROLES_MAP
} from '../../lib/permissions';
import { fetchUsersApi, createUserApi, updateUserStatusApi, updateUserRoleApi, deleteUserApi, updateUserAttendanceApi, markAllAttendanceApi, fetchDomainRows } from '../../lib/projectsApi';
import BrandInfinityLoader from '../common/BrandInfinityLoader';

const SECTION_ACCESS_OPTIONS = [
  'Default',
  'Project Setup',
  'Performance',
  'Operations',
  'Access All',
];

const PERMISSION_OPTIONS = [
  'Default',
  'View Only',
  'View + Edit',
  'View + Edit + Delete',
  'View + Edit + Delete + Update',
];

function ModuleAccessMultiSelect({ value = 'Default', onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const MODULE_OPTIONS = [
    'Default',
    'Project Setup',
    'Performance',
    'Operations',
    'Access All',
  ];

  const currentList = useMemo(() => {
    if (!value || value === 'Default') return ['Default'];
    return value.split(',').map(s => s.trim()).filter(Boolean);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const toggleOption = (opt) => {
    if (disabled) return;
    if (opt === 'Default') {
      onChange('Default');
      return;
    }

    if (opt === 'Access All') {
      onChange('Access All');
      return;
    }

    let nextList = currentList.filter(item => item !== 'Default' && item !== 'Access All');

    if (nextList.includes(opt)) {
      nextList = nextList.filter(item => item !== opt);
    } else {
      nextList.push(opt);
    }

    if (nextList.length === 0) {
      onChange('Default');
    } else {
      onChange(nextList.join(', '));
    }
  };

  const displayLabel = useMemo(() => {
    if (currentList.length === 0 || (currentList.length === 1 && currentList[0] === 'Default')) {
      return 'Default';
    }
    if (currentList.length === 1) {
      return currentList[0];
    }
    return `${currentList.length} Modules Selected`;
  }, [currentList]);

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          padding: '6px 10px',
          fontSize: 12,
          fontWeight: 600,
          borderRadius: 6,
          border: '1px solid #cbd5e1',
          background: disabled ? '#f8fafc' : '#ffffff',
          color: disabled ? '#94a3b8' : '#0f172a',
          cursor: disabled ? 'not-allowed' : 'pointer',
          outline: 'none',
          minWidth: 150
        }}
      >
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 130 }} title={value}>
          {displayLabel}
        </span>
        <ChevronDown size={13} color="#64748b" />
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: '110%',
          left: 0,
          zIndex: 999,
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: 8,
          boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
          padding: '6px 0',
          minWidth: 180
        }}>
          {MODULE_OPTIONS.map(opt => {
            const isChecked = currentList.includes(opt);
            return (
              <div
                key={opt}
                onClick={() => toggleOption(opt)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 12px',
                  fontSize: 12,
                  fontWeight: isChecked ? 700 : 500,
                  color: isChecked ? '#7c3aed' : '#334155',
                  background: isChecked ? '#f5f3ff' : 'transparent',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => { }}
                  style={{ cursor: 'pointer', accentColor: '#7c3aed' }}
                />
                <span>{opt}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProjectAssignmentMultiSelect({ value = 'None', projectOptions = [], onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Available options: 'All Projects', 'None', plus specific project names
  const availableProjects = useMemo(() => {
    const specificProjects = projectOptions.filter(p => p !== 'All Projects' && p !== 'None');
    return ['All Projects', 'None', ...specificProjects];
  }, [projectOptions]);

  const currentList = useMemo(() => {
    if (!value || value === 'None' || value.trim() === '') return ['None'];
    if (value === 'All Projects') return ['All Projects'];
    return value.split(',').map(s => s.trim()).filter(Boolean);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const toggleOption = (opt) => {
    if (disabled) return;
    if (opt === 'All Projects') {
      onChange('All Projects');
      return;
    }
    if (opt === 'None') {
      onChange('None');
      return;
    }

    let nextList = currentList.filter(item => item !== 'All Projects' && item !== 'None');

    if (nextList.includes(opt)) {
      nextList = nextList.filter(item => item !== opt);
    } else {
      nextList.push(opt);
    }

    if (nextList.length === 0) {
      onChange('None');
    } else {
      onChange(nextList.join(', '));
    }
  };

  const displayLabel = useMemo(() => {
    if (currentList.length === 0 || (currentList.length === 1 && currentList[0] === 'None')) {
      return 'None';
    }
    if (currentList.length === 1 && currentList[0] === 'All Projects') {
      return 'All Projects';
    }
    if (currentList.length === 1) {
      return currentList[0];
    }
    return `${currentList.length} Projects Selected`;
  }, [currentList]);

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          padding: '6px 10px',
          fontSize: 12,
          fontWeight: 600,
          borderRadius: 6,
          border: '1px solid #cbd5e1',
          background: disabled ? '#f8fafc' : '#ffffff',
          color: disabled ? '#94a3b8' : (currentList.includes('None') ? '#64748b' : '#0f172a'),
          cursor: disabled ? 'not-allowed' : 'pointer',
          outline: 'none',
          width: '100%',
          minWidth: 140
        }}
        title={value}
      >
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 130 }}>
          {displayLabel}
        </span>
        <ChevronDown size={13} color="#64748b" />
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: '110%',
          left: 0,
          zIndex: 999,
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: 8,
          boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
          padding: '6px 0',
          minWidth: 200,
          maxHeight: 220,
          overflowY: 'auto'
        }}>
          {availableProjects.map(opt => {
            const isChecked = currentList.includes(opt);
            return (
              <div
                key={opt}
                onClick={() => toggleOption(opt)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 12px',
                  fontSize: 12,
                  fontWeight: isChecked ? 700 : 500,
                  color: isChecked ? '#7c3aed' : '#334155',
                  background: isChecked ? '#f5f3ff' : 'transparent',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => { }}
                  style={{ cursor: 'pointer', accentColor: '#7c3aed' }}
                />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function deriveCategoryFromRole(role, category) {
  if (!role) return category || CATEGORIES.INTERNAL;
  const r = role.toUpperCase();
  if (r === 'ADMIN') return CATEGORIES.ADMIN;
  if (r === 'VENDOR') return CATEGORIES.VENDOR;
  if (r.startsWith('CLIENT')) return CATEGORIES.CLIENT_ACCESS;
  if (r.startsWith('INTERNAL')) return CATEGORIES.INTERNAL;
  return category || CATEGORIES.INTERNAL;
}

function RolePermissionMatrixView() {
  const MATRIX_DATA = [
    {
      category: 'Admin',
      badgeColor: '#7c3aed',
      badgeBg: '#f3e8ff',
      roles: [
        {
          name: 'Admin',
          roleKey: 'ADMIN',
          defaultActionPerm: 'Full Control',
          defaultSectionAccess: 'All Sections (Access All)',
          description: 'Unrestricted system access to all projects, user management, audit logs, and settings.',
          capabilities: {
            viewDashboard: true,
            uploadData: true,
            runAnalysis: true,
            deleteRecords: true,
            manageUsers: true,
            viewLogs: true
          }
        }
      ]
    },
    {
      category: 'Internal',
      badgeColor: '#2563eb',
      badgeBg: '#eff6ff',
      roles: [
        {
          name: 'Team Lead',
          roleKey: 'INTERNAL_TEAM_LEAD',
          defaultActionPerm: 'View + Edit + Run Analysis',
          defaultSectionAccess: 'All Modules (Default)',
          description: 'Full workspace access to all modules, data upload, analysis execution, and project setup.',
          capabilities: {
            viewDashboard: true,
            uploadData: true,
            runAnalysis: true,
            deleteRecords: false,
            manageUsers: false,
            viewLogs: false
          }
        },
        {
          name: 'Sr. Associate',
          roleKey: 'INTERNAL_SR_ASSOCIATE',
          defaultActionPerm: 'View + Edit',
          defaultSectionAccess: 'All Modules (Default)',
          description: 'Read and edit access across workspace modules and dataset uploads.',
          capabilities: {
            viewDashboard: true,
            uploadData: true,
            runAnalysis: false,
            deleteRecords: false,
            manageUsers: false,
            viewLogs: false
          }
        },
        {
          name: 'Associate',
          roleKey: 'INTERNAL_ASSOCIATE',
          defaultActionPerm: 'View Only',
          defaultSectionAccess: 'All Modules (Default)',
          description: 'Read-only viewer for workspace reports, keyword rankings, and dashboards.',
          capabilities: {
            viewDashboard: true,
            uploadData: false,
            runAnalysis: false,
            deleteRecords: false,
            manageUsers: false,
            viewLogs: false
          }
        }
      ]
    },
    {
      category: 'Client Access',
      badgeColor: '#059669',
      badgeBg: '#ecfdf5',
      roles: [
        {
          name: 'Client Team Lead',
          roleKey: 'CLIENT_TEAM_LEAD',
          defaultActionPerm: 'View + Edit + Run Analysis',
          defaultSectionAccess: 'Search, AI & Content Engine',
          description: 'Client lead view with edit and analysis permissions for search visibility & content engine.',
          capabilities: {
            viewDashboard: true,
            uploadData: true,
            runAnalysis: true,
            deleteRecords: false,
            manageUsers: false,
            viewLogs: false
          }
        },
        {
          name: 'Client Sr. Associate',
          roleKey: 'CLIENT_SR_ASSOCIATE',
          defaultActionPerm: 'View + Edit',
          defaultSectionAccess: 'Search & AI Visibility',
          description: 'Client senior access with read/edit access to performance metrics and search visibility.',
          capabilities: {
            viewDashboard: true,
            uploadData: true,
            runAnalysis: false,
            deleteRecords: false,
            manageUsers: false,
            viewLogs: false
          }
        },
        {
          name: 'Client Associate',
          roleKey: 'CLIENT_ASSOCIATE',
          defaultActionPerm: 'View Only',
          defaultSectionAccess: 'Search Visibility',
          description: 'Read-only view of client search performance and keyword position reports.',
          capabilities: {
            viewDashboard: true,
            uploadData: false,
            runAnalysis: false,
            deleteRecords: false,
            manageUsers: false,
            viewLogs: false
          }
        }
      ]
    },
    {
      category: 'Vendor',
      badgeColor: '#d97706',
      badgeBg: '#fffbe6',
      roles: [
        {
          name: 'Vendor',
          roleKey: 'VENDOR',
          defaultActionPerm: 'View Only',
          defaultSectionAccess: 'Off-Page (Scheduler)',
          description: 'External link-building and outreach vendor scoped exclusively to Off-Page.',
          capabilities: {
            viewDashboard: true,
            uploadData: false,
            runAnalysis: false,
            deleteRecords: false,
            manageUsers: false,
            viewLogs: false
          }
        }
      ]
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Overview Card */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '20px 24px' }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 6px 0' }}>
          Role & Default Permission Reference Grid
        </h3>
        <p style={{ fontSize: 13, color: '#64748b', margin: 0, lineHeight: 1.5 }}>
          This reference matrix outlines standard default capabilities for each platform role. Admins can override individual user permissions, section access, and categories directly in the <strong>User Accounts & Access</strong> tab.
        </p>
      </div>

      {/* Role Categories */}
      {MATRIX_DATA.map((catGroup) => (
        <div key={catGroup.category} style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: catGroup.badgeColor, background: catGroup.badgeBg, padding: '3px 10px', borderRadius: 6, border: `1px solid ${catGroup.badgeColor}33` }}>
                {catGroup.category} Category
              </span>
              <span style={{ fontSize: 12.5, color: '#64748b' }}>
                ({catGroup.roles.length} {catGroup.roles.length === 1 ? 'Role' : 'Roles'})
              </span>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  <th style={{ padding: '12px 20px', textAlign: 'left', width: 180 }}>Role</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', width: 220 }}>Default Action Permission</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', width: 220 }}>Default Section Access</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>View Reports</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Upload Data</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Run Analysis</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Delete Records</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Manage Users</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>View Audit Logs</th>
                </tr>
              </thead>
              <tbody>
                {catGroup.roles.map((role) => (
                  <tr key={role.roleKey} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '14px 20px', fontWeight: 700, color: '#0f172a' }}>
                      {role.name}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ fontWeight: 600, fontSize: 12, background: '#f1f5f9', color: '#334155', padding: '3px 8px', borderRadius: 6, border: '1px solid #cbd5e1' }}>
                        {role.defaultActionPerm}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', color: '#475569', fontWeight: 500 }}>
                      {role.defaultSectionAccess}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                      {role.capabilities.viewDashboard ? <CheckCircle size={16} color="#16a34a" style={{ margin: '0 auto' }} /> : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                      {role.capabilities.uploadData ? <CheckCircle size={16} color="#16a34a" style={{ margin: '0 auto' }} /> : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                      {role.capabilities.runAnalysis ? <CheckCircle size={16} color="#16a34a" style={{ margin: '0 auto' }} /> : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                      {role.capabilities.deleteRecords ? <CheckCircle size={16} color="#16a34a" style={{ margin: '0 auto' }} /> : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                      {role.capabilities.manageUsers ? <CheckCircle size={16} color="#16a34a" style={{ margin: '0 auto' }} /> : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                      {role.capabilities.viewLogs ? <CheckCircle size={16} color="#16a34a" style={{ margin: '0 auto' }} /> : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function UsersPage({ user, onNavigate }) {
  const [subTab, setSubTab] = useState('users'); // 'users' | 'matrix'
  const [usersList, setUsersList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [savingUserId, setSavingUserId] = useState(null);
  const [alertMsg, setAlertMsg] = useState({ type: '', text: '' });
  const [projectOptions, setProjectOptions] = useState(() => {
    try {
      const cachedDomains = JSON.parse(localStorage.getItem('seo_domains') || '[]');
      const cachedProjects = JSON.parse(localStorage.getItem('seo_projects') || '[]');
      const names = [
        ...cachedDomains.map(d => d.project_name || d.name || d.domain),
        ...cachedProjects.map(p => p.name || p.project_name || p.domain)
      ].filter(Boolean);
      const unique = Array.from(new Set(['All Projects', ...names]));
      return unique.length > 1 ? unique : ['All Projects', 'OWIS', 'Stamford American', 'testing308'];
    } catch (_) {
      return ['All Projects', 'OWIS', 'Stamford American', 'testing308'];
    }
  });

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Inline User Edits Map { userId: { category, role, section_access, permissions, assigned_project, isDirty } }
  const [editedUsers, setEditedUsers] = useState({});

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showModuleInfo, setShowModuleInfo] = useState(false);
  const [attendanceRecords, setAttendanceRecords] = useState(() => {
    try {
      const saved = localStorage.getItem('seo_users_attendance');
      return saved ? JSON.parse(saved) : {};
    } catch (_) {
      return {};
    }
  });

  useEffect(() => {
    async function loadProjects() {
      try {
        const domainRows = await fetchDomainRows();
        if (domainRows && domainRows.length > 0) {
          const names = domainRows.map(d => d.name || d.project_name || d.domain).filter(Boolean);
          const unique = Array.from(new Set(['All Projects', ...names]));
          setProjectOptions(unique);
        }
      } catch (err) {
        console.warn('[UsersPage] Failed to load projects from Project Setup:', err);
      }
    }
    loadProjects();
  }, []);

  const handleMarkAttendance = async (userId, status) => {
    const updated = {
      ...attendanceRecords,
      [userId]: { status }
    };
    setAttendanceRecords(updated);
    setUsersList(prev => prev.map(u => String(u.id) === String(userId) ? { ...u, attendance: status } : u));
    try {
      await updateUserAttendanceApi(userId, status);
      setAlertMsg({ type: 'success', text: `Updated attendance to "${status}".` });
    } catch (err) {
      console.error('Failed to save attendance:', err);
    }
  };

  const handleMarkAllPresent = async () => {
    const updated = { ...attendanceRecords };
    usersList.forEach(u => {
      updated[u.id] = { status: 'Present' };
    });
    setAttendanceRecords(updated);
    setUsersList(prev => prev.map(u => ({ ...u, attendance: 'Present' })));
    try {
      await markAllAttendanceApi('Present');
      setAlertMsg({ type: 'success', text: `Marked all ${usersList.length} associates present in Supabase DB.` });
    } catch (err) {
      console.error('Failed to mark all present:', err);
    }
  };

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    category: CATEGORIES.INTERNAL,
    role: ROLES.INTERNAL_ASSOCIATE,
    section_access: 'Default',
    permissions: 'Default',
    assigned_project: 'None',
    status: 'Active'
  });
  const [showPassword, setShowPassword] = useState(false);

  // Client Detail State & Modal Tab
  const [modalTab, setModalTab] = useState('client_detail'); // 'client_detail' | 'user_credential'
  const [clientData, setClientData] = useState({
    name: '',
    address: '',
    gst: '',
    poc_name: '',
    poc_number: '',
    poc_address: ''
  });

  const isAdmin = user?.role?.toUpperCase() === 'ADMIN';
  const canManageUsers = hasPermission(user, PERMISSIONS.MANAGE_USERS) || isAdmin;

  const loadUsers = async () => {
    if (!canManageUsers) return;
    setLoading(true);
    try {
      const data = await fetchUsersApi();
      setUsersList(data || []);

      // Initialize inline edit map for each user
      const map = {};
      (data || []).forEach(u => {
        const uRole = u.role?.toUpperCase() || ROLES.INTERNAL_ASSOCIATE;
        const uCat = deriveCategoryFromRole(uRole, u.category);
        const defaultProj = uRole === 'ADMIN' ? 'All Projects' : (u.assigned_project || 'None');
        map[u.id] = {
          category: uCat,
          role: uRole,
          section_access: u.section_access || 'Default',
          permissions: u.permissions || 'Default',
          assigned_project: defaultProj,
          isDirty: false
        };
      });
      setEditedUsers(map);
    } catch (err) {
      console.error('Failed to load users:', err);
      setAlertMsg({ type: 'error', text: err.message || 'Failed to load user accounts.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canManageUsers) {
      loadUsers();
    }
  }, [user]);

  // Dynamic available roles for form category
  const availableFormRoles = useMemo(() => {
    return CATEGORY_ROLES_MAP[formData.category] || [ROLES.INTERNAL_ASSOCIATE];
  }, [formData.category]);

  const handleFormCategoryChange = (newCategory) => {
    const rolesForCategory = CATEGORY_ROLES_MAP[newCategory] || [ROLES.INTERNAL_ASSOCIATE];
    if (newCategory === CATEGORIES.CLIENT_ACCESS) {
      setClientDetailEnabled(true);
    }
    setFormData(prev => ({
      ...prev,
      category: newCategory,
      role: rolesForCategory[0],
      section_access: 'Default',
      permissions: 'Default'
    }));
  };

  // Inline Edit Handlers for Admin User Table (Auto-Saves Instantly into Database)
  const handleInlineCategoryChange = async (userId, newCategory) => {
    const targetUser = usersList.find(u => u.id === userId);
    if (
      (user?.email && targetUser?.email && user.email.toLowerCase() === targetUser.email.toLowerCase()) ||
      (user?.id && targetUser?.id && String(user.id) === String(targetUser.id))
    ) {
      setAlertMsg({ type: 'error', text: 'You cannot modify your own account settings.' });
      return;
    }

    const rolesForCategory = CATEGORY_ROLES_MAP[newCategory] || [ROLES.INTERNAL_ASSOCIATE];
    const current = editedUsers[userId] || (targetUser ? {
      category: targetUser.category || 'Internal',
      role: targetUser.role || 'INTERNAL_ASSOCIATE',
      section_access: targetUser.section_access || 'Default',
      permissions: targetUser.permissions || 'Default'
    } : {});

    const newRole = rolesForCategory[0];
    const newSec = current.section_access || targetUser?.section_access || 'Default';
    const newPerm = current.permissions || targetUser?.permissions || 'Default';

    // 1. Instant local UI update
    setEditedUsers(prev => ({
      ...prev,
      [userId]: {
        ...prev[userId],
        category: newCategory,
        role: newRole,
        section_access: newSec,
        permissions: newPerm,
        isDirty: false
      }
    }));

    setUsersList(prev => prev.map(u => u.id === userId ? {
      ...u,
      category: newCategory,
      role: newRole,
      section_access: newSec,
      permissions: newPerm
    } : u));

    // 2. Local storage cache sync
    const cachedList = JSON.parse(localStorage.getItem('seo_users_list') || '[]');
    const cachedUser = cachedList.find(u => u.id === userId || u.email?.toLowerCase() === targetUser?.email?.toLowerCase());
    if (cachedUser) {
      cachedUser.category = newCategory;
      cachedUser.role = newRole;
      cachedUser.section_access = newSec;
      cachedUser.permissions = newPerm;
      localStorage.setItem('seo_users_list', JSON.stringify(cachedList));
    }

    // 3. Active session sync if target user is logged in
    const activeSessionUser = JSON.parse(sessionStorage.getItem('seo_dashboard_user') || 'null');
    if (activeSessionUser && targetUser && activeSessionUser.email?.toLowerCase() === targetUser.email?.toLowerCase()) {
      sessionStorage.setItem('seo_dashboard_user', JSON.stringify({
        ...activeSessionUser,
        category: newCategory,
        role: newRole,
        section_access: newSec,
        permissions: newPerm
      }));
    }

    // 4. Persist to API / Database
    setSavingUserId(userId);
    try {
      const dbResponse = await updateUserRoleApi(userId, newRole, newCategory, newSec, newPerm);
      if (dbResponse) {
        const dbSec = dbResponse.section_access || newSec;
        const dbPerm = dbResponse.permissions || newPerm;
        const dbRole = dbResponse.role || newRole;
        const dbCat = dbResponse.category || newCategory;

        setUsersList(prev => prev.map(u => u.id === userId ? {
          ...u,
          category: dbCat,
          role: dbRole,
          section_access: dbSec,
          permissions: dbPerm
        } : u));

        setEditedUsers(prev => ({
          ...prev,
          [userId]: {
            category: dbCat,
            role: dbRole,
            section_access: dbSec,
            permissions: dbPerm,
            isDirty: false
          }
        }));
      }
      setAlertMsg({ type: 'success', text: `Saved to database: Category = "${newCategory}".` });
    } catch (err) {
      setAlertMsg({ type: 'error', text: err.message || 'Failed to update category in DB.' });
    } finally {
      setSavingUserId(null);
    }
  };

  const handleInlineFieldChange = (userId, field, value) => {
    const targetUser = usersList.find(u => u.id === userId);
    if (
      (user?.email && targetUser?.email && user.email.toLowerCase() === targetUser.email.toLowerCase()) ||
      (user?.id && targetUser?.id && String(user.id) === String(targetUser.id))
    ) {
      return;
    }

    const current = editedUsers[userId] || (targetUser ? {
      category: targetUser.category || 'Internal',
      role: targetUser.role || 'INTERNAL_ASSOCIATE',
      section_access: targetUser.section_access || 'Default',
      permissions: targetUser.permissions || 'Default',
      assigned_project: targetUser.assigned_project || 'All Projects'
    } : {});

    let newCategory = current.category || 'Internal';
    if (field === 'role') {
      newCategory = deriveCategoryFromRole(value, newCategory);
    }

    const updated = {
      category: newCategory,
      role: current.role || 'INTERNAL_ASSOCIATE',
      section_access: current.section_access || 'Default',
      permissions: current.permissions || 'Default',
      assigned_project: current.assigned_project || 'All Projects',
      [field]: value,
      isDirty: true
    };

    setEditedUsers(prev => ({
      ...prev,
      [userId]: updated
    }));
  };

  const handleSaveUserSettings = async (targetUser) => {
    if (
      (user?.email && targetUser?.email && user.email.toLowerCase() === targetUser.email.toLowerCase()) ||
      (user?.id && targetUser?.id && String(user.id) === String(targetUser.id))
    ) {
      setAlertMsg({ type: 'error', text: 'You cannot modify your own account settings.' });
      return;
    }

    const edits = editedUsers[targetUser.id];
    if (!edits || !edits.isDirty) return;

    setSavingUserId(targetUser.id);
    setAlertMsg({ type: '', text: '' });
    try {
      const updatedUser = await updateUserRoleApi(
        targetUser.id,
        edits.role,
        edits.category,
        edits.section_access,
        edits.permissions,
        edits.assigned_project
      );

      const newSec = updatedUser?.section_access || edits.section_access || 'Default';
      const newPerm = updatedUser?.permissions || edits.permissions || 'Default';
      const newCat = updatedUser?.category || edits.category || 'Internal';
      const newRole = updatedUser?.role || edits.role || 'INTERNAL_ASSOCIATE';
      const newProj = updatedUser?.assigned_project || edits.assigned_project || 'All Projects';

      // 1. Local storage cache sync
      const cachedList = JSON.parse(localStorage.getItem('seo_users_list') || '[]');
      const cachedUser = cachedList.find(u => u.id === targetUser.id || u.email?.toLowerCase() === targetUser?.email?.toLowerCase());
      if (cachedUser) {
        cachedUser.category = newCat;
        cachedUser.role = newRole;
        cachedUser.section_access = newSec;
        cachedUser.permissions = newPerm;
        cachedUser.assigned_project = newProj;
        localStorage.setItem('seo_users_list', JSON.stringify(cachedList));
      }

      // 2. Active session sync if target user is logged in
      const activeSessionUser = JSON.parse(sessionStorage.getItem('seo_dashboard_user') || 'null');
      if (activeSessionUser && targetUser && activeSessionUser.email?.toLowerCase() === targetUser.email?.toLowerCase()) {
        sessionStorage.setItem('seo_dashboard_user', JSON.stringify({
          ...activeSessionUser,
          category: newCat,
          role: newRole,
          section_access: newSec,
          permissions: newPerm,
          assigned_project: newProj
        }));
      }

      // 3. Update main active users state
      setUsersList(prev => prev.map(u => u.id === targetUser.id ? {
        ...u,
        category: newCat,
        role: newRole,
        section_access: newSec,
        permissions: newPerm,
        assigned_project: newProj
      } : u));

      setEditedUsers(prev => ({
        ...prev,
        [targetUser.id]: {
          category: newCat,
          role: newRole,
          section_access: newSec,
          permissions: newPerm,
          assigned_project: newProj,
          isDirty: false
        }
      }));

      setAlertMsg({
        type: 'success',
        text: `Saved user settings (Assigned Project: ${newProj})`
      });
    } catch (err) {
      setAlertMsg({ type: 'error', text: err.message || 'Failed to update user settings in database.' });
    } finally {
      setSavingUserId(null);
    }
  };

  // Filtered Users list
  const filteredUsers = useMemo(() => {
    return usersList.filter(u => {
      const matchSearch = searchQuery === '' ||
        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(searchQuery.toLowerCase());

      const userCat = editedUsers[u.id]?.category || u.category || (u.role?.toUpperCase() === 'ADMIN' ? 'Admin' : 'Internal');
      const matchCategory = categoryFilter === 'all' || userCat.toLowerCase() === categoryFilter.toLowerCase();
      const matchRole = roleFilter === 'all' || u.role?.toUpperCase() === roleFilter.toUpperCase();
      const matchStatus = statusFilter === 'all' || (u.status || 'Active').toLowerCase() === statusFilter.toLowerCase();

      return matchSearch && matchCategory && matchRole && matchStatus;
    });
  }, [usersList, editedUsers, searchQuery, categoryFilter, roleFilter, statusFilter]);

  // Summary Metrics
  const totalUsers = usersList.length;
  const activeCount = usersList.filter(u => (u.status || 'Active') === 'Active').length;
  const disabledCount = usersList.filter(u => u.status === 'Disabled').length;
  const adminCount = usersList.filter(u => u.role?.toUpperCase() === 'ADMIN').length;

  const handleToggleStatus = async (targetUser) => {
    if (
      (user?.email && targetUser?.email && user.email.toLowerCase() === targetUser.email.toLowerCase()) ||
      (user?.id && targetUser?.id && String(user.id) === String(targetUser.id))
    ) {
      setAlertMsg({ type: 'error', text: 'You cannot disable your own account.' });
      return;
    }

    const nextStatus = (targetUser.status || 'Active') === 'Active' ? 'Disabled' : 'Active';
    setActionLoading(true);
    setAlertMsg({ type: '', text: '' });
    try {
      await updateUserStatusApi(targetUser.id, nextStatus);
      setAlertMsg({
        type: 'success',
        text: `Successfully ${nextStatus === 'Active' ? 'enabled' : 'disabled'} user profile for ${targetUser.email}.`
      });
      await loadUsers();
    } catch (err) {
      setAlertMsg({ type: 'error', text: err.message || 'Failed to update user status.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateUserSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.email.trim() || !formData.password.trim()) {
      setAlertMsg({ type: 'error', text: 'Please fill in all required fields (Name, Email, Password).' });
      return;
    }

    setActionLoading(true);
    setAlertMsg({ type: '', text: '' });
    try {
      const hasClientData = Boolean(
        (clientData.name && clientData.name.trim()) ||
        (clientData.address && clientData.address.trim()) ||
        (clientData.gst && clientData.gst.trim()) ||
        (clientData.poc_name && clientData.poc_name.trim()) ||
        (clientData.poc_number && clientData.poc_number.trim()) ||
        (clientData.poc_address && clientData.poc_address.trim())
      );
      const isClientEnabled = clientDetailEnabled || hasClientData;

      const payload = {
        ...formData,
        client_detail_enabled: isClientEnabled,
        client_name: isClientEnabled ? clientData.name : null,
        client_address: isClientEnabled ? clientData.address : null,
        client_gst: isClientEnabled ? clientData.gst : null,
        poc_name: isClientEnabled ? clientData.poc_name : null,
        poc_number: isClientEnabled ? clientData.poc_number : null,
        poc_address: isClientEnabled ? clientData.poc_address : null
      };

      if (clientDetailEnabled && clientData.name.trim()) {
        try {
          const clientRecords = JSON.parse(localStorage.getItem('seo_client_records') || '[]');
          clientRecords.push({
            id: Date.now(),
            user_email: formData.email,
            ...clientData,
            createdAt: new Date().toISOString()
          });
          localStorage.setItem('seo_client_records', JSON.stringify(clientRecords));
        } catch (_) {}
      }

      await createUserApi(payload);
      setAlertMsg({
        type: 'success',
        text: `Created user login credentials for "${formData.email}".`
      });
      setShowCreateModal(false);
      setClientDetailEnabled(false);
      setClientData({
        name: '',
        address: '',
        gst: '',
        poc_name: '',
        poc_number: '',
        poc_address: ''
      });
      setFormData({
        name: '',
        email: '',
        password: '',
        category: CATEGORIES.INTERNAL,
        role: ROLES.INTERNAL_ASSOCIATE,
        section_access: 'All Sections (Full Access)',
        permissions: 'View Only',
        status: 'Active'
      });
      await loadUsers();
    } catch (err) {
      setAlertMsg({ type: 'error', text: err.message || 'Failed to create user credential.' });
    } finally {
      setActionLoading(false);
    }
  };

  const confirmDeleteUser = async () => {
    if (!selectedUser) return;
    if (
      (user?.email && selectedUser?.email && user.email.toLowerCase() === selectedUser.email.toLowerCase()) ||
      (user?.id && selectedUser?.id && String(user.id) === String(selectedUser.id))
    ) {
      setAlertMsg({ type: 'error', text: 'You cannot delete your own account.' });
      setShowDeleteModal(false);
      return;
    }
    setActionLoading(true);
    setAlertMsg({ type: '', text: '' });
    try {
      await deleteUserApi(selectedUser.id);
      setAlertMsg({
        type: 'success',
        text: `Deleted user profile for ${selectedUser.email}.`
      });
      setShowDeleteModal(false);
      setSelectedUser(null);
      await loadUsers();
    } catch (err) {
      setAlertMsg({ type: 'error', text: err.message || 'Failed to delete user profile.' });
    } finally {
      setActionLoading(false);
    }
  };

  if (!canManageUsers) {
    return (
      <div style={{ padding: 40, textAlign: 'center', background: '#f8fafc', minHeight: '100vh' }}>
        <div style={{
          maxWidth: 450,
          margin: '40px auto',
          background: '#ffffff',
          padding: 32,
          borderRadius: 16,
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)'
        }}>
          <Shield size={48} color="#dc2626" style={{ marginBottom: 16 }} />
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: '0 0 8px 0' }}>Access Denied</h2>
          <p style={{ fontSize: 13.5, color: '#64748b', lineHeight: 1.5, margin: '0 0 20px 0' }}>
            User management table is reserved strictly for Administrator accounts.
          </p>
          <button
            onClick={() => onNavigate && onNavigate('search-visibility/position-analysis')}
            style={{
              padding: '9px 18px',
              fontSize: 13,
              fontWeight: 700,
              color: '#ffffff',
              background: '#2D2D44',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(45, 45, 68, 0.25)',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#1F1F30'}
            onMouseLeave={e => e.currentTarget.style.background = '#2D2D44'}
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, background: 'var(--bg)', minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Container */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: 24,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
      }}>

        {/* Header Title & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'var(--accent-light)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent)'
              }}>
                <Shield size={20} />
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 }}>
                Admin User Access Control Table
              </h1>
            </div>
            <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0 46px' }}>
              Manage username, email, category, role, section access (Project Setup access), and action permissions for platform users.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={loadUsers}
              disabled={loading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: '#475569',
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                borderRadius: 8,
                cursor: 'pointer'
              }}
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
              <span>Refresh</span>
            </button>

            <button
              onClick={() => {
                setFormData({
                  name: '',
                  email: '',
                  password: '',
                  category: CATEGORIES.INTERNAL,
                  role: ROLES.INTERNAL_ASSOCIATE,
                  section_access: 'Default',
                  permissions: 'Default',
                  status: 'Active'
                });
                setShowCreateModal(true);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                fontSize: 13.5,
                fontWeight: 700,
                color: '#ffffff',
                background: '#2D2D44',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(45, 45, 68, 0.25)',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#1F1F30'}
              onMouseLeave={e => e.currentTarget.style.background = '#2D2D44'}
            >
              <UserPlus size={16} />
              <span>Create User Credential</span>
            </button>
          </div>
        </div>

        {/* System Alert Notification */}
        {alertMsg.text && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderRadius: 8,
            marginBottom: 20,
            fontSize: 13,
            fontWeight: 600,
            background: alertMsg.type === 'error' ? '#fef2f2' : '#f0fdf4',
            color: alertMsg.type === 'error' ? '#dc2626' : '#166534',
            border: `1px solid ${alertMsg.type === 'error' ? '#fca5a5' : '#bbf7d0'}`
          }}>
            {alertMsg.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
            <span style={{ flex: 1 }}>{alertMsg.text}</span>
            <button onClick={() => setAlertMsg({ type: '', text: '' })} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit' }}>
              <X size={14} />
            </button>
          </div>
        )}

        {/* Summary Metric Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
              {[
                { label: 'Total Users', value: totalUsers, color: 'var(--text-primary)', bg: 'var(--surface-2)' },
                { label: 'Active Profiles', value: activeCount, color: '#16a34a', bg: '#f0fdf4' },
                { label: 'Disabled Profiles', value: disabledCount, color: '#dc2626', bg: '#fef2f2' },
                { label: 'Admin Accounts', value: adminCount, color: '#7c3aed', bg: '#f5f3ff' },
              ].map(card => (
                <div key={card.label} style={{
                  background: card.bg,
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '14px 18px'
                }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>{card.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: card.color }}>{card.value}</div>
                </div>
              ))}
            </div>

            {/* Search & Category/Role/Status Filters */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 20,
              flexWrap: 'wrap',
              background: 'var(--surface-2)',
              padding: '12px 16px',
              borderRadius: 10,
              border: '1px solid var(--border)'
            }}>
              {/* Search */}
              <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
                <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder="Search users by name or email..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px 8px 36px',
                    fontSize: 13,
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--text-primary)',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Category Filter */}
              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                style={{
                  padding: '8px 12px',
                  fontSize: 13,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="all">All Categories</option>
                <option value={CATEGORIES.ADMIN}>Admin</option>
                <option value={CATEGORIES.INTERNAL}>Internal</option>
                <option value={CATEGORIES.CLIENT_ACCESS}>Client Access</option>
                <option value={CATEGORIES.VENDOR}>Vendor</option>
              </select>

              {/* Role Filter */}
              <select
                value={roleFilter}
                onChange={e => setRoleFilter(e.target.value)}
                style={{
                  padding: '8px 12px',
                  fontSize: 13,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="all">All Roles</option>
                {Object.keys(ROLE_DISPLAY_NAMES).filter(rKey => rKey !== 'USER').map(rKey => (
                  <option key={rKey} value={rKey}>{ROLE_DISPLAY_NAMES[rKey]}</option>
                ))}
              </select>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                style={{
                  padding: '8px 12px',
                  fontSize: 13,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="all">All Statuses</option>
                <option value="Active">Active</option>
                <option value="Disabled">Disabled</option>
              </select>

              {/* Mark All Present */}
              <button
                onClick={handleMarkAllPresent}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: '#15803d',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 6,
                  cursor: 'pointer',
                  marginLeft: 'auto'
                }}
                title="Mark all users present for today"
              >
                <CheckCircle size={14} />
                <span>Mark All Present</span>
              </button>
            </div>

            {/* Main Admin User Control Table */}
            {loading ? (
              <div style={{ padding: '40px 16px', textAlign: 'center' }}>
                <BrandInfinityLoader label="Loading user accounts…" size="md" minHeight="200px" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <div style={{ padding: 60, textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
                <Users size={32} style={{ margin: '0 auto 12px auto', color: 'var(--text-muted)' }} />
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>No Users Found</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No platform users match the selected search or filter criteria.</div>
              </div>
            ) : (
              <div style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                overflow: 'hidden',
                boxShadow: 'var(--shadow-sm)'
              }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        <th style={{ padding: '12px 16px', textAlign: 'left' }}>User Info</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', width: 135 }}>Category</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', width: 155 }}>Role</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', width: 175 }}>Assigned Project</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', width: 185 }}>Section Access</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', width: 140 }}>Permissions</th>
                        <th style={{ padding: '12px 16px', textAlign: 'center', width: 115 }}>Attendance</th>
                        <th style={{ padding: '12px 16px', textAlign: 'right', width: 140 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u) => {
                        const currentEdit = editedUsers[u.id] || {
                          category: u.category || 'Internal',
                          role: u.role || 'INTERNAL_ASSOCIATE',
                          section_access: u.section_access || 'Default',
                          permissions: u.permissions || 'Default',
                          assigned_project: u.assigned_project || 'All Projects'
                        };
                        const isActive = u.status !== 'Disabled';
                        const currentRoleKey = (currentEdit.role || 'INTERNAL_ASSOCIATE').toUpperCase();
                        const categoryRoles = CATEGORY_ROLES_MAP[currentEdit.category] || [ROLES.INTERNAL_ASSOCIATE];
                        const rolesForCategory = categoryRoles.includes(currentRoleKey) ? categoryRoles : [currentRoleKey, ...categoryRoles];
                        const isVendor = currentEdit.category === 'Vendor' || currentEdit.role === 'VENDOR' || currentRoleKey === 'VENDOR';
                        const isSelf = Boolean(
                          (user?.email && u?.email && user.email.toLowerCase() === u.email.toLowerCase()) ||
                          (user?.id && u?.id && String(user.id) === String(u.id))
                        );

                        return (
                          <tr key={u.id} style={{ borderBottom: '1px solid var(--border)', opacity: isActive ? 1 : 0.65, background: isSelf ? '#f8fafc' : 'transparent' }}>
                            {/* USER INFO */}
                            <td style={{ padding: '12px 16px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: '50%',
                                  background: isActive ? 'var(--accent-light)' : '#f1f5f9',
                                  color: isActive ? 'var(--accent)' : '#94a3b8',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontWeight: 700,
                                  fontSize: 14
                                }}>
                                  {u.name ? u.name.charAt(0).toUpperCase() : u.email.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {u.name || 'User'}
                                    {isSelf && (
                                      <span style={{ fontSize: 10, fontWeight: 700, background: '#e0e7ff', color: '#3730a3', padding: '2px 6px', borderRadius: 4, border: '1px solid #c7d2fe' }}>
                                        You (Current User)
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.email}</div>
                                </div>
                              </div>
                            </td>

                            {/* CATEGORY DROPDOWN */}
                            <td style={{ padding: '12px 16px', width: 135 }}>
                              <select
                                disabled={isSelf}
                                value={currentEdit.category}
                                onChange={e => handleInlineCategoryChange(u.id, e.target.value)}
                                style={{
                                  padding: '6px 8px',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  borderRadius: 6,
                                  border: '1px solid #cbd5e1',
                                  background: isSelf ? '#f8fafc' : '#ffffff',
                                  color: isSelf ? '#94a3b8' : '#0f172a',
                                  cursor: isSelf ? 'not-allowed' : 'pointer',
                                  outline: 'none',
                                  width: '100%',
                                  minWidth: 100
                                }}
                                title={isSelf ? "You cannot modify your own category" : undefined}
                              >
                                {Object.values(CATEGORIES).map(cat => (
                                  <option key={cat} value={cat}>{cat}</option>
                                ))}
                              </select>
                            </td>

                            {/* ROLE DROPDOWN */}
                            <td style={{ padding: '12px 16px', width: 155 }}>
                              <select
                                disabled={isSelf}
                                value={currentRoleKey}
                                onChange={e => handleInlineFieldChange(u.id, 'role', e.target.value)}
                                style={{
                                  padding: '6px 8px',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  borderRadius: 6,
                                  border: '1px solid #cbd5e1',
                                  background: isSelf ? '#f8fafc' : '#ffffff',
                                  color: isSelf ? '#94a3b8' : '#0f172a',
                                  cursor: isSelf ? 'not-allowed' : 'pointer',
                                  outline: 'none',
                                  width: '100%',
                                  minWidth: 120
                                }}
                                title={isSelf ? "You cannot modify your own role" : undefined}
                              >
                                {rolesForCategory.map(rKey => (
                                  <option key={rKey} value={rKey}>{ROLE_DISPLAY_NAMES[rKey] || rKey}</option>
                                ))}
                              </select>
                            </td>

                            {/* ASSIGNED PROJECT (VENDOR SCOPED ONLY) */}
                            <td style={{ padding: '12px 16px', width: 175 }}>
                              {isVendor ? (
                                <ProjectAssignmentMultiSelect
                                  disabled={isSelf}
                                  value={currentEdit.assigned_project}
                                  projectOptions={projectOptions}
                                  onChange={val => handleInlineFieldChange(u.id, 'assigned_project', val)}
                                />
                              ) : (
                                <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>
                                  All Projects
                                </span>
                              )}
                            </td>

                            {/* SECTION ACCESS (MULTI-SELECT) */}
                            <td style={{ padding: '12px 16px', width: 190 }}>
                              <ModuleAccessMultiSelect
                                disabled={isSelf}
                                value={currentEdit.section_access}
                                onChange={val => handleInlineFieldChange(u.id, 'section_access', val)}
                              />
                            </td>

                            {/* PERMISSIONS DROPDOWN */}
                            <td style={{ padding: '12px 16px', width: 145 }}>
                              <select
                                disabled={isSelf}
                                value={currentEdit.permissions}
                                onChange={e => handleInlineFieldChange(u.id, 'permissions', e.target.value)}
                                style={{
                                  padding: '6px 8px',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  borderRadius: 6,
                                  border: '1px solid #cbd5e1',
                                  background: isSelf ? '#f8fafc' : '#ffffff',
                                  color: isSelf ? '#94a3b8' : '#0f172a',
                                  cursor: isSelf ? 'not-allowed' : 'pointer',
                                  outline: 'none',
                                  width: 145,
                                  maxWidth: 145,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}
                                title={isSelf ? "You cannot modify your own permissions" : undefined}
                              >
                                {PERMISSION_OPTIONS.map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </td>

                            {/* ATTENDANCE CHECKBOX COLUMN */}
                            {(() => {
                              const currentAttendance = attendanceRecords[u.id]?.status || u.attendance || 'Not Present';
                              const isPresent = currentAttendance === 'Present';
                              return (
                                <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                                  <label
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      cursor: isSelf ? 'not-allowed' : 'pointer',
                                      opacity: isSelf ? 0.6 : 1,
                                      fontSize: 11.5,
                                      fontWeight: 600,
                                      userSelect: 'none',
                                      background: isPresent ? '#f0fdf4' : '#fef2f2',
                                      color: isPresent ? '#15803d' : '#dc2626',
                                      border: `1px solid ${isPresent ? '#bbf7d0' : '#fca5a5'}`,
                                      padding: '4px 8px',
                                      borderRadius: 6,
                                      transition: 'all 0.15s ease'
                                    }}
                                    title={isSelf ? "You cannot toggle your own attendance" : `Toggle attendance status for ${u.name}`}
                                  >
                                    <input
                                      type="checkbox"
                                      disabled={isSelf}
                                      checked={isPresent}
                                      onChange={(e) => {
                                        if (!isSelf) handleMarkAttendance(u.id, e.target.checked ? 'Present' : 'Not Present');
                                      }}
                                      style={{ cursor: isSelf ? 'not-allowed' : 'pointer', accentColor: '#16a34a', width: 13, height: 13 }}
                                    />
                                    <span>{isPresent ? 'Present' : 'Not Present'}</span>
                                  </label>
                                </td>
                              );
                            })()}

                            {/* ACTIONS */}
                            <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>

                                {/* SAVE BUTTON */}
                                {!isSelf && editedUsers[u.id]?.isDirty && (
                                  <button
                                    onClick={() => handleSaveUserSettings(u)}
                                    disabled={savingUserId === u.id}
                                    title="Save user role, section access, and permissions to database"
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 4,
                                      padding: '5px 9px',
                                      fontSize: 11.5,
                                      fontWeight: 600,
                                      borderRadius: 6,
                                      cursor: savingUserId === u.id ? 'not-allowed' : 'pointer',
                                      background: '#2563eb',
                                      color: '#ffffff',
                                      border: 'none',
                                      boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                                      transition: 'all 0.15s ease'
                                    }}
                                  >
                                    <Save size={13} />
                                    <span>{savingUserId === u.id ? 'Saving…' : 'Save'}</span>
                                  </button>
                                )}

                                {/* TOGGLE STATUS */}
                                <button
                                  onClick={() => !isSelf && handleToggleStatus(u)}
                                  disabled={actionLoading || isSelf}
                                  title={isSelf ? "You cannot disable your own account" : (isActive ? 'Disable User Profile' : 'Enable User Profile')}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    padding: '5px 9px',
                                    fontSize: 11.5,
                                    fontWeight: 600,
                                    borderRadius: 6,
                                    cursor: (actionLoading || isSelf) ? 'not-allowed' : 'pointer',
                                    opacity: isSelf ? 0.4 : 1,
                                    background: isActive ? '#fef2f2' : '#f0fdf4',
                                    color: isActive ? '#dc2626' : '#166534',
                                    border: `1px solid ${isActive ? '#fca5a5' : '#bbf7d0'}`
                                  }}
                                >
                                  {isActive ? <UserX size={13} /> : <UserCheck size={13} />}
                                  <span>{isActive ? 'Disable' : 'Enable'}</span>
                                </button>

                                {/* DELETE PROFILE */}
                                <button
                                  onClick={() => { if (!isSelf) { setSelectedUser(u); setShowDeleteModal(true); } }}
                                  disabled={actionLoading || isSelf}
                                  title={isSelf ? "You cannot delete your own account" : "Delete User"}
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: isSelf ? '#cbd5e1' : '#94a3b8',
                                    cursor: (actionLoading || isSelf) ? 'not-allowed' : 'pointer',
                                    opacity: isSelf ? 0.35 : 1,
                                    padding: 6,
                                    borderRadius: 6
                                  }}
                                  onMouseEnter={e => { if (!isSelf) e.currentTarget.style.color = '#dc2626'; }}
                                  onMouseLeave={e => { if (!isSelf) e.currentTarget.style.color = '#94a3b8'; }}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
      </div>

      {/* ─── CREATE USER CREDENTIAL MODAL ─────────────────────────────────────── */}
      {showCreateModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 20
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 16,
            maxWidth: 520,
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '24px 28px',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
            position: 'relative',
            border: '1px solid var(--border)'
          }}>
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              style={{
                position: 'absolute',
                top: 18,
                right: 18,
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: 4
              }}
            >
              <X size={18} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'var(--accent-light)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent)'
              }}>
                <UserPlus size={22} />
              </div>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                  Create User Login Credential
                </h3>
                <p style={{ fontSize: 12.5, color: '#64748b', margin: '2px 0 0 0' }}>
                  Set client details, username, email, role, and permissions.
                </p>
              </div>
            </div>

            {/* Segmented Pill Toggle Bar */}
            <div style={{ display: 'flex', background: 'var(--surface-2, #f4f0fa)', borderRadius: 10, padding: 4, gap: 4, marginBottom: 16 }}>
              <button
                type="button"
                onClick={() => setModalTab('client_detail')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 600,
                  border: 'none',
                  background: modalTab === 'client_detail' ? '#ffffff' : 'transparent',
                  color: modalTab === 'client_detail' ? 'var(--accent, #7928ca)' : 'var(--text-secondary, #64748b)',
                  boxShadow: modalTab === 'client_detail' ? '0 1px 4px rgba(121, 40, 202, 0.12)' : 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  fontFamily: 'var(--font-body)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6
                }}
              >
                <span>Client Detail</span>
                {(clientData.name || clientData.address || clientData.gst || clientData.poc_name || clientData.poc_number || clientData.poc_address) && (
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent, #7928ca)' }} />
                )}
              </button>

              <button
                type="button"
                onClick={() => setModalTab('user_credential')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 600,
                  border: 'none',
                  background: modalTab === 'user_credential' ? '#ffffff' : 'transparent',
                  color: modalTab === 'user_credential' ? 'var(--accent, #7928ca)' : 'var(--text-secondary, #64748b)',
                  boxShadow: modalTab === 'user_credential' ? '0 1px 4px rgba(121, 40, 202, 0.12)' : 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  fontFamily: 'var(--font-body)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6
                }}
              >
                <span>User Credential</span>
                {(formData.name || formData.email || formData.password) && (
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent, #7928ca)' }} />
                )}
              </button>
            </div>

            <form onSubmit={handleCreateUserSubmit} autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Tab 1: Client Detail (Toggle on the left) */}
              {modalTab === 'client_detail' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Name */}
                  <div>
                    <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 5 }}>
                      Name
                    </label>
                    <div style={{ position: 'relative' }}>
                      <Building2 size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#94a3b8' }} />
                      <input
                        type="text"
                        placeholder="e.g. Acme Corporation / Client Name"
                        value={clientData.name}
                        onChange={e => setClientData({ ...clientData, name: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '8px 12px 8px 32px',
                          fontSize: 13,
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          outline: 'none'
                        }}
                      />
                    </div>
                  </div>

                  {/* Address */}
                  <div>
                    <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 5 }}>
                      Address
                    </label>
                    <div style={{ position: 'relative' }}>
                      <MapPin size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#94a3b8' }} />
                      <input
                        type="text"
                        placeholder="e.g. Office 402, Business Bay, City"
                        value={clientData.address}
                        onChange={e => setClientData({ ...clientData, address: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '8px 12px 8px 32px',
                          fontSize: 13,
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          outline: 'none'
                        }}
                      />
                    </div>
                  </div>

                  {/* GST */}
                  <div>
                    <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 5 }}>
                      GST
                    </label>
                    <div style={{ position: 'relative' }}>
                      <Hash size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#94a3b8' }} />
                      <input
                        type="text"
                        placeholder="e.g. 29AAAAA0000A1Z5"
                        value={clientData.gst}
                        onChange={e => setClientData({ ...clientData, gst: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '8px 12px 8px 32px',
                          fontSize: 13,
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          outline: 'none'
                        }}
                      />
                    </div>
                  </div>

                  {/* POC Name */}
                  <div>
                    <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 5 }}>
                      POC Name
                    </label>
                    <div style={{ position: 'relative' }}>
                      <User size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#94a3b8' }} />
                      <input
                        type="text"
                        placeholder="e.g. Point of Contact Name"
                        value={clientData.poc_name}
                        onChange={e => setClientData({ ...clientData, poc_name: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '8px 12px 8px 32px',
                          fontSize: 13,
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          outline: 'none'
                        }}
                      />
                    </div>
                  </div>

                  {/* POC Number */}
                  <div>
                    <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 5 }}>
                      POC Number
                    </label>
                    <div style={{ position: 'relative' }}>
                      <Phone size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#94a3b8' }} />
                      <input
                        type="text"
                        placeholder="e.g. +91 98765 43210"
                        value={clientData.poc_number}
                        onChange={e => setClientData({ ...clientData, poc_number: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '8px 12px 8px 32px',
                          fontSize: 13,
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          outline: 'none'
                        }}
                      />
                    </div>
                  </div>

                  {/* POC Address */}
                  <div>
                    <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 5 }}>
                      POC Address
                    </label>
                    <div style={{ position: 'relative' }}>
                      <MapPin size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#94a3b8' }} />
                      <input
                        type="text"
                        placeholder="e.g. POC Branch / City"
                        value={clientData.poc_address}
                        onChange={e => setClientData({ ...clientData, poc_address: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '8px 12px 8px 32px',
                          fontSize: 13,
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          outline: 'none'
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: User Credential */}
              {modalTab === 'user_credential' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* Full Name */}
                  <div>
                    <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 5 }}>
                      Username / Full Name <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <User size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#94a3b8' }} />
                      <input
                        type="text"
                        autoComplete="off"
                        placeholder="e.g. Name"
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        required
                        style={{
                          width: '100%',
                          padding: '8px 12px 8px 32px',
                          fontSize: 13,
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          outline: 'none'
                        }}
                      />
                    </div>
                  </div>

                  {/* Email Address */}
                  <div>
                    <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 5 }}>
                      Email Address <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <Mail size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#94a3b8' }} />
                      <input
                        type="email"
                        autoComplete="off"
                        placeholder="Email@company.com"
                        value={formData.email}
                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                        required
                        style={{
                          width: '100%',
                          padding: '8px 12px 8px 32px',
                          fontSize: 13,
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          outline: 'none'
                        }}
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div>
                    <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 5 }}>
                      Login Password <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <Key size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#94a3b8' }} />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        placeholder="Minimum 6 characters"
                        value={formData.password}
                        onChange={e => setFormData({ ...formData, password: e.target.value })}
                        required
                        minLength={6}
                        style={{
                          width: '100%',
                          padding: '8px 36px 8px 32px',
                          fontSize: 13,
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          outline: 'none'
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        style={{
                          position: 'absolute',
                          right: 10,
                          top: 8,
                          background: 'transparent',
                          border: 'none',
                          color: '#94a3b8',
                          cursor: 'pointer'
                        }}
                      >
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>

                  {/* Category & Role Controls */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 5 }}>
                        User Category
                      </label>
                      <select
                        value={formData.category}
                        onChange={e => handleFormCategoryChange(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          fontSize: 13,
                          fontWeight: 600,
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          background: '#ffffff'
                        }}
                      >
                        <option value={CATEGORIES.INTERNAL}>Internal</option>
                        <option value={CATEGORIES.CLIENT_ACCESS}>Client Access</option>
                        <option value={CATEGORIES.VENDOR}>Vendor</option>
                        <option value={CATEGORIES.ADMIN}>Admin</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 5 }}>
                        Assigned Role
                      </label>
                      <select
                        value={formData.role}
                        onChange={e => setFormData({ ...formData, role: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          fontSize: 13,
                          fontWeight: 600,
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          background: '#ffffff'
                        }}
                      >
                        {availableFormRoles.map(rKey => (
                          <option key={rKey} value={rKey}>
                            {ROLE_DISPLAY_NAMES[rKey] || rKey}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Section Access & Permissions */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                        <span>Module Access</span>
                        <span
                          style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
                          onMouseEnter={() => setShowModuleInfo(true)}
                          onMouseLeave={() => setShowModuleInfo(false)}
                          title="You can choose multiple modules"
                        >
                          <Info size={13} style={{ color: '#64748b' }} />
                          {showModuleInfo && (
                            <div style={{
                              position: 'absolute',
                              bottom: '100%',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              marginBottom: 6,
                              background: '#0f172a',
                              color: '#ffffff',
                              fontSize: 11.5,
                              fontWeight: 500,
                              padding: '5px 10px',
                              borderRadius: 6,
                              whiteSpace: 'nowrap',
                              boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
                              zIndex: 100,
                              pointerEvents: 'none'
                            }}>
                              You can choose multiple modules
                              <div style={{
                                position: 'absolute',
                                top: '100%',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                borderWidth: 4,
                                borderStyle: 'solid',
                                borderColor: '#0f172a transparent transparent transparent'
                              }} />
                            </div>
                          )}
                        </span>
                      </label>
                      <ModuleAccessMultiSelect
                        value={formData.section_access}
                        onChange={val => setFormData({ ...formData, section_access: val })}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 5 }}>
                        Action Permissions
                      </label>
                      <select
                        value={formData.permissions}
                        onChange={e => setFormData({ ...formData, permissions: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          fontSize: 13,
                          fontWeight: 600,
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          background: '#ffffff'
                        }}
                      >
                        {PERMISSION_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Assigned Project selector strictly for Vendor role */}
                  {((formData.category || '').toLowerCase() === 'vendor' || (formData.role || '').toUpperCase() === 'VENDOR') && (
                    <div>
                      <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 5 }}>
                        Assigned Project Scope
                      </label>
                      <ProjectAssignmentMultiSelect
                        value={formData.assigned_project}
                        projectOptions={projectOptions}
                        onChange={val => setFormData({ ...formData, assigned_project: val })}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Actions Footer */}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 14 }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={{
                    padding: '8px 16px',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#475569',
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: 8,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                {modalTab === 'client_detail' ? (
                  <button
                    type="button"
                    onClick={() => setModalTab('user_credential')}
                    style={{
                      padding: '9px 20px',
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#ffffff',
                      background: '#2D2D44',
                      border: 'none',
                      borderRadius: 8,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      boxShadow: '0 2px 8px rgba(45, 45, 68, 0.25)',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#1F1F30'}
                    onMouseLeave={e => e.currentTarget.style.background = '#2D2D44'}
                  >
                    <span>Next: User Credential</span>
                    <ArrowRight size={14} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={actionLoading}
                    style={{
                      padding: '9px 20px',
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#ffffff',
                      background: '#2D2D44',
                      border: 'none',
                      borderRadius: 8,
                      cursor: actionLoading ? 'not-allowed' : 'pointer',
                      boxShadow: '0 2px 8px rgba(45, 45, 68, 0.25)',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={e => { if (!actionLoading) e.currentTarget.style.background = '#1F1F30'; }}
                    onMouseLeave={e => { if (!actionLoading) e.currentTarget.style.background = '#2D2D44'; }}
                  >
                    {actionLoading ? 'Creating Credential...' : 'Create Credential'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete User Modal */}
      {showDeleteModal && selectedUser && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 20
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 16,
            maxWidth: 420,
            width: '100%',
            padding: 24,
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
            border: '1px solid var(--border)'
          }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: '#fef2f2',
                color: '#dc2626',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px auto'
              }}>
                <Trash2 size={24} />
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: '0 0 6px 0' }}>
                Delete User Profile?
              </h3>
              <p style={{ fontSize: 13, color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                Are you sure you want to permanently delete credentials for <strong>{selectedUser.name}</strong> ({selectedUser.email})? This action cannot be undone.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
              <button
                onClick={() => setShowDeleteModal(false)}
                style={{
                  flex: 1,
                  padding: '9px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#475569',
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: 8,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteUser}
                disabled={actionLoading}
                style={{
                  flex: 1,
                  padding: '9px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#ffffff',
                  background: '#dc2626',
                  border: 'none',
                  borderRadius: 8,
                  cursor: actionLoading ? 'not-allowed' : 'pointer'
                }}
              >
                {actionLoading ? 'Deleting...' : 'Delete Profile'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
