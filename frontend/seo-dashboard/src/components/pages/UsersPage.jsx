import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Users, UserPlus, Shield, CheckCircle, AlertCircle, RefreshCw, X, Search,
  Trash2, Eye, EyeOff, UserCheck, UserX, Key, Mail, User, Save, Layers, Lock, ChevronDown, Calendar
} from 'lucide-react';
import {
  hasPermission, PERMISSIONS, CATEGORIES, ROLES, ROLE_DISPLAY_NAMES, CATEGORY_ROLES_MAP
} from '../../lib/permissions';
import { fetchUsersApi, createUserApi, updateUserStatusApi, updateUserRoleApi, deleteUserApi, updateUserAttendanceApi, markAllAttendanceApi } from '../../lib/projectsApi';

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
  'Full Control',
];

function ModuleAccessMultiSelect({ value = 'Default', onChange }) {
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
        onClick={() => setOpen(!open)}
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
          background: '#ffffff',
          color: '#0f172a',
          cursor: 'pointer',
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

export function deriveCategoryFromRole(role, category) {
  if (!role) return category || CATEGORIES.INTERNAL;
  const r = role.toUpperCase();
  if (r === 'ADMIN') return CATEGORIES.ADMIN;
  if (r === 'VENDOR') return CATEGORIES.VENDOR;
  if (r.startsWith('CLIENT')) return CATEGORIES.CLIENT_ACCESS;
  if (r.startsWith('INTERNAL')) return CATEGORIES.INTERNAL;
  return category || CATEGORIES.INTERNAL;
}

export default function UsersPage({ user, onNavigate }) {
  const [usersList, setUsersList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [savingUserId, setSavingUserId] = useState(null);
  const [alertMsg, setAlertMsg] = useState({ type: '', text: '' });

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Inline User Edits Map { userId: { category, role, section_access, permissions, isDirty } }
  const [editedUsers, setEditedUsers] = useState({});

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [attendanceRecords, setAttendanceRecords] = useState(() => {
    try {
      const saved = localStorage.getItem('seo_users_attendance');
      return saved ? JSON.parse(saved) : {};
    } catch (_) {
      return {};
    }
  });

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
    status: 'Active'
  });
  const [showPassword, setShowPassword] = useState(false);

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
        map[u.id] = {
          category: uCat,
          role: uRole,
          section_access: u.section_access || 'Default',
          permissions: u.permissions || 'Default',
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
    const rolesForCategory = CATEGORY_ROLES_MAP[newCategory] || [ROLES.INTERNAL_ASSOCIATE];
    const targetUser = usersList.find(u => u.id === userId);
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
    const current = editedUsers[userId] || (targetUser ? {
      category: targetUser.category || 'Internal',
      role: targetUser.role || 'INTERNAL_ASSOCIATE',
      section_access: targetUser.section_access || 'Default',
      permissions: targetUser.permissions || 'Default'
    } : {});

    const updated = {
      category: current.category || 'Internal',
      role: current.role || 'INTERNAL_ASSOCIATE',
      section_access: current.section_access || 'Default',
      permissions: current.permissions || 'Default',
      [field]: value,
      isDirty: true
    };

    setEditedUsers(prev => ({
      ...prev,
      [userId]: updated
    }));
  };

  const handleSaveUserSettings = async (targetUser) => {
    const edits = editedUsers[targetUser.id];
    if (!edits || !edits.isDirty) return;

    setSavingUserId(targetUser.id);
    setAlertMsg({ type: '', text: '' });
    try {
      const updatedUser = await updateUserRoleApi(targetUser.id, edits.role, edits.category, edits.section_access, edits.permissions);

      const newSec = updatedUser?.section_access || edits.section_access || 'Default';
      const newPerm = updatedUser?.permissions || edits.permissions || 'Default';
      const newCat = updatedUser?.category || edits.category || 'Internal';
      const newRole = updatedUser?.role || edits.role || 'INTERNAL_ASSOCIATE';

      // 1. Local storage cache sync
      const cachedList = JSON.parse(localStorage.getItem('seo_users_list') || '[]');
      const cachedUser = cachedList.find(u => u.id === targetUser.id || u.email?.toLowerCase() === targetUser?.email?.toLowerCase());
      if (cachedUser) {
        cachedUser.category = newCat;
        cachedUser.role = newRole;
        cachedUser.section_access = newSec;
        cachedUser.permissions = newPerm;
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
          permissions: newPerm
        }));
      }

      // 3. Update main active users state
      setUsersList(prev => prev.map(u => u.id === targetUser.id ? {
        ...u,
        category: newCat,
        role: newRole,
        section_access: newSec,
        permissions: newPerm
      } : u));

      setEditedUsers(prev => ({
        ...prev,
        [targetUser.id]: {
          category: newCat,
          role: newRole,
          section_access: newSec,
          permissions: newPerm,
          isDirty: false
        }
      }));

      setAlertMsg({
        type: 'success',
        text: 'Saved'
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
      await createUserApi(formData);
      setAlertMsg({
        type: 'success',
        text: `Created user login credentials for "${formData.email}".`
      });
      setShowCreateModal(false);
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
              fontWeight: 600,
              color: '#ffffff',
              background: '#7c3aed',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer'
            }}
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, background: '#f8fafc', minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Container */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
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
                fontWeight: 600,
                color: '#ffffff',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(124, 58, 237, 0.2)'
              }}
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
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search user by username or email..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 12px 7px 32px',
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
              padding: '7px 12px',
              fontSize: 12.5,
              fontWeight: 600,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-secondary)'
            }}
          >
            <option value="all">All Categories</option>
            <option value="Internal">Internal</option>
            <option value="Client Access">Client Access</option>
            <option value="Vendor">Vendor</option>
            <option value="Admin">Admin</option>
          </select>

          {/* Role Filter */}
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            style={{
              padding: '7px 12px',
              fontSize: 12.5,
              fontWeight: 600,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-secondary)'
            }}
          >
            <option value="all">All Roles</option>
            <option value="ADMIN">Admin</option>
            <option value="INTERNAL_TEAM_LEAD">Internal Team Lead</option>
            <option value="INTERNAL_SR_ASSOCIATE">Internal Sr. Associate</option>
            <option value="INTERNAL_ASSOCIATE">Internal Associate</option>
            <option value="CLIENT_TEAM_LEAD">Client Team Lead</option>
            <option value="CLIENT_SR_ASSOCIATE">Client Sr. Associate</option>
            <option value="CLIENT_ASSOCIATE">Client Associate</option>
            <option value="VENDOR">Vendor</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{
              padding: '7px 12px',
              fontSize: 12.5,
              fontWeight: 600,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-secondary)'
            }}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>

        {/* ─── ADMIN USER ACCESS CONTROL TABLE ───────────────────────────────── */}
        {loading ? (
          <div style={{ padding: '36px 0', textAlign: 'center', fontSize: 13.5, color: 'var(--text-muted)' }}>
            Loading user profiles...
          </div>
        ) : filteredUsers.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', fontSize: 13.5, color: 'var(--text-muted)', background: 'var(--surface-2)', border: '1.5px dashed var(--border)', borderRadius: 12 }}>
            No user profiles found matching your search.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Username</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Email Address</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Category</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Role</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Module Access</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, width: 145 }}>Permissions</th>
                  <th style={{ padding: '10px 16px', fontWeight: 700, textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span>Attendance</span>
                      <button
                        onClick={handleMarkAllPresent}
                        title="Mark all associates present in Supabase database"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '3px 8px',
                          fontSize: 10.5,
                          fontWeight: 700,
                          color: '#15803d',
                          background: '#f0fdf4',
                          border: '1px solid #bbf7d0',
                          borderRadius: 6,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          textTransform: 'none'
                        }}
                      >
                        <CheckCircle size={12} />
                        <span>Mark All Present</span>
                      </button>
                    </div>
                  </th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(u => {
                  const isActive = (u.status || 'Active') === 'Active';
                  const initials = u.name ? u.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'U';

                  const uRole = u.role || 'INTERNAL_ASSOCIATE';
                  const uCat = deriveCategoryFromRole(uRole, u.category);

                  const currentEdit = editedUsers[u.id] || {
                    category: uCat,
                    role: uRole,
                    section_access: u.section_access || 'Default',
                    permissions: u.permissions || 'Default',
                    isDirty: false
                  };

                  const effectiveCategory = deriveCategoryFromRole(currentEdit.role, currentEdit.category);
                  const availableRoles = CATEGORY_ROLES_MAP[effectiveCategory] || [ROLES.INTERNAL_ASSOCIATE];
                  const isSaving = savingUserId === u.id;

                  return (
                    <tr key={u.id} style={{ borderBottom: '1px solid var(--border)', background: currentEdit.isDirty ? '#fffbeb' : 'var(--surface)' }}>

                      {/* USERNAME */}
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 34,
                            height: 34,
                            borderRadius: '50%',
                            background: currentEdit.role === 'ADMIN' ? '#f5f3ff' : '#f0f9ff',
                            color: currentEdit.role === 'ADMIN' ? '#7c3aed' : '#0284c7',
                            border: `1px solid ${currentEdit.role === 'ADMIN' ? '#ddd6fe' : '#bae6fd'}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 800,
                            fontSize: 12.5,
                            position: 'relative'
                          }}>
                            {initials}
                            <span style={{
                              position: 'absolute',
                              bottom: 0,
                              right: 0,
                              width: 9,
                              height: 9,
                              borderRadius: '50%',
                              background: isActive ? '#16a34a' : '#dc2626',
                              border: '2px solid #ffffff'
                            }} />
                          </div>
                          <div>
                            <strong style={{ fontSize: 13.5, color: 'var(--text-primary)', display: 'block' }}>{u.name}</strong>
                            {user?.email?.toLowerCase() === u.email?.toLowerCase() && (
                              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--accent)' }}>(You)</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* EMAIL ADDRESS */}
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: 12.5 }}>
                        {u.email}
                      </td>

                      {/* CATEGORY DROPDOWN */}
                      <td style={{ padding: '12px 16px' }}>
                        <select
                          value={currentEdit.category}
                          onChange={e => handleInlineCategoryChange(u.id, e.target.value)}
                          style={{
                            padding: '6px 10px',
                            fontSize: 12,
                            fontWeight: 700,
                            borderRadius: 6,
                            border: '1px solid #cbd5e1',
                            background: currentEdit.category === 'Admin' ? '#fef3c7' : currentEdit.category === 'Client Access' ? '#ccfbf1' : currentEdit.category === 'Vendor' ? '#ffedd5' : '#e0e7ff',
                            color: currentEdit.category === 'Admin' ? '#b45309' : currentEdit.category === 'Client Access' ? '#0f766e' : currentEdit.category === 'Vendor' ? '#c2410c' : '#3730a3',
                            cursor: 'pointer',
                            outline: 'none'
                          }}
                        >
                          <option value={CATEGORIES.INTERNAL}>Internal</option>
                          <option value={CATEGORIES.CLIENT_ACCESS}>Client Access</option>
                          <option value={CATEGORIES.VENDOR}>Vendor</option>
                          <option value={CATEGORIES.ADMIN}>Admin</option>
                        </select>
                      </td>

                      {/* ROLE DROPDOWN */}
                      <td style={{ padding: '12px 16px' }}>
                        <select
                          value={currentEdit.role}
                          onChange={e => handleInlineFieldChange(u.id, 'role', e.target.value)}
                          style={{
                            padding: '6px 10px',
                            fontSize: 12,
                            fontWeight: 600,
                            borderRadius: 6,
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#334155',
                            cursor: 'pointer',
                            outline: 'none'
                          }}
                        >
                          {availableRoles.map(rKey => (
                            <option key={rKey} value={rKey}>
                              {ROLE_DISPLAY_NAMES[rKey] || rKey}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* MODULE ACCESS MULTI-SELECT */}
                      <td style={{ padding: '12px 16px' }}>
                        <ModuleAccessMultiSelect
                          value={currentEdit.section_access}
                          onChange={val => handleInlineFieldChange(u.id, 'section_access', val)}
                        />
                      </td>

                      {/* PERMISSIONS DROPDOWN */}
                      <td style={{ padding: '12px 16px', width: 145 }}>
                        <select
                          value={currentEdit.permissions}
                          onChange={e => handleInlineFieldChange(u.id, 'permissions', e.target.value)}
                          style={{
                            padding: '6px 8px',
                            fontSize: 12,
                            fontWeight: 600,
                            borderRadius: 6,
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#0f172a',
                            cursor: 'pointer',
                            outline: 'none',
                            width: 145,
                            maxWidth: 145,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
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
                                cursor: 'pointer',
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
                              title={`Toggle attendance status for ${u.name}`}
                            >
                              <input
                                type="checkbox"
                                checked={isPresent}
                                onChange={(e) => {
                                  handleMarkAttendance(u.id, e.target.checked ? 'Present' : 'Not Present');
                                }}
                                style={{ cursor: 'pointer', accentColor: '#16a34a', width: 13, height: 13 }}
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

                          {/* TOGGLE STATUS */}
                          <button
                            onClick={() => handleToggleStatus(u)}
                            disabled={actionLoading}
                            title={isActive ? 'Disable User Profile' : 'Enable User Profile'}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '5px 9px',
                              fontSize: 11.5,
                              fontWeight: 600,
                              borderRadius: 6,
                              cursor: actionLoading ? 'not-allowed' : 'pointer',
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
                            onClick={() => { setSelectedUser(u); setShowDeleteModal(true); }}
                            disabled={actionLoading}
                            title="Delete User"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#94a3b8',
                              cursor: actionLoading ? 'not-allowed' : 'pointer',
                              padding: 6,
                              borderRadius: 6
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                            onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
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
            maxWidth: 500,
            width: '100%',
            padding: 28,
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
                  Set username, email, category, role, section access, and permissions.
                </p>
              </div>
            </div>

            <form onSubmit={handleCreateUserSubmit} autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                  <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 5 }}>
                    Module Access (Multiple)
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

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 12 }}>
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
                <button
                  type="submit"
                  disabled={actionLoading}
                  style={{
                    padding: '8px 18px',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#ffffff',
                    background: 'var(--accent)',
                    border: 'none',
                    borderRadius: 8,
                    cursor: actionLoading ? 'not-allowed' : 'pointer'
                  }}
                >
                  {actionLoading ? 'Creating Credential...' : 'Create Credential'}
                </button>
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
