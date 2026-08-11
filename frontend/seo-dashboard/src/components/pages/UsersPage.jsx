import { useState, useEffect, useMemo } from 'react';
import { 
  Users, UserPlus, Shield, CheckCircle, AlertCircle, RefreshCw, X, Search, 
  Trash2, Eye, EyeOff, UserCheck, UserX, Key, Mail, User
} from 'lucide-react';
import { hasPermission, PERMISSIONS } from '../../lib/permissions';
import { fetchUsersApi, createUserApi, updateUserStatusApi, updateUserRoleApi, deleteUserApi } from '../../lib/projectsApi';

export default function UsersPage({ user, onNavigate }) {
  const [usersList, setUsersList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [alertMsg, setAlertMsg] = useState({ type: '', text: '' });

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'USER',
    status: 'Active'
  });
  const [showPassword, setShowPassword] = useState(false);

  const canManageUsers = hasPermission(user, PERMISSIONS.MANAGE_USERS) || user?.role?.toUpperCase() === 'ADMIN';

  const loadUsers = async () => {
    if (!canManageUsers) return;
    setLoading(true);
    try {
      const data = await fetchUsersApi();
      setUsersList(data || []);
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

  // Filtered Users
  const filteredUsers = useMemo(() => {
    return usersList.filter(u => {
      const matchSearch = searchQuery === '' ||
        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchRole = roleFilter === 'all' || u.role.toUpperCase() === roleFilter.toUpperCase();
      const matchStatus = statusFilter === 'all' || (u.status || 'Active').toLowerCase() === statusFilter.toLowerCase();

      return matchSearch && matchRole && matchStatus;
    });
  }, [usersList, searchQuery, roleFilter, statusFilter]);

  // Summary Metrics
  const totalUsers = usersList.length;
  const activeCount = usersList.filter(u => (u.status || 'Active') === 'Active').length;
  const disabledCount = usersList.filter(u => u.status === 'Disabled').length;
  const adminCount = usersList.filter(u => u.role?.toUpperCase() === 'ADMIN').length;

  // Handlers
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

  const handleChangeRole = async (userId, newRole) => {
    setActionLoading(true);
    setAlertMsg({ type: '', text: '' });
    try {
      await updateUserRoleApi(userId, newRole);
      setAlertMsg({ type: 'success', text: `Updated user role to ${newRole}.` });
      await loadUsers();
    } catch (err) {
      setAlertMsg({ type: 'error', text: err.message || 'Failed to update user role.' });
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
      setFormData({ name: '', email: '', password: '', role: 'USER', status: 'Active' });
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
      <div style={{ padding: 32, maxWidth: 1200, margin: '0 auto' }}>
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: 40,
          textAlign: 'center',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <div style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: '#fef2f2',
            color: '#dc2626',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px'
          }}>
            <Shield size={28} />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>
            Access Restricted
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 460, margin: '0 auto 20px', lineHeight: 1.5 }}>
            You do not have permission to manage User Profiles. Only system administrators can create login credentials and configure user roles.
          </p>
          <button
            onClick={() => onNavigate?.('home')}
            style={{
              padding: '8px 18px',
              fontSize: 13.5,
              fontWeight: 600,
              color: '#ffffff',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer'
            }}
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 28, maxWidth: 1280, margin: '0 auto' }}>
      {/* Notification Banner */}
      {alertMsg.text && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderRadius: 8,
          marginBottom: 20,
          background: alertMsg.type === 'success' ? 'var(--green-bg)' : '#fef2f2',
          border: `1px solid ${alertMsg.type === 'success' ? 'var(--green)' : '#f87171'}`,
          color: alertMsg.type === 'success' ? 'var(--green)' : '#dc2626',
          fontSize: 13.5,
          fontWeight: 500
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {alertMsg.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
            <span>{alertMsg.text}</span>
          </div>
          <button
            onClick={() => setAlertMsg({ type: '', text: '' })}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Container */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-sm)',
        padding: 28
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
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
              <Users size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                User Management
                <span style={{
                  fontSize: 12,
                  fontWeight: 600,
                  background: 'var(--surface-2)',
                  color: 'var(--text-secondary)',
                  padding: '2px 9px',
                  borderRadius: 12,
                  border: '1px solid var(--border)'
                }}>
                  {totalUsers} {totalUsers === 1 ? 'User' : 'Users'}
                </span>
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '3px 0 0 0' }}>
                Create login credentials, configure access roles, and enable or disable user profiles.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => loadUsers()}
              disabled={loading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
              <span>Refresh</span>
            </button>

            <button
              onClick={() => setShowCreateModal(true)}
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

        {/* Search & Filters */}
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
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search user by name or email..."
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

        {/* User Data Table */}
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
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>User Profile</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Email Address</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Role</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Status</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Created Date</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(u => {
                  const isActive = (u.status || 'Active') === 'Active';
                  const initials = u.name ? u.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'U';

                  return (
                    <tr key={u.id} style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                      {/* Name & Avatar */}
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 36,
                            height: 36,
                            borderRadius: '50%',
                            background: u.role?.toUpperCase() === 'ADMIN' ? '#f5f3ff' : '#f0f9ff',
                            color: u.role?.toUpperCase() === 'ADMIN' ? '#7c3aed' : '#0284c7',
                            border: `1px solid ${u.role?.toUpperCase() === 'ADMIN' ? '#ddd6fe' : '#bae6fd'}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 800,
                            fontSize: 13,
                            position: 'relative'
                          }}>
                            {initials}
                            <span style={{
                              position: 'absolute',
                              bottom: 0,
                              right: 0,
                              width: 10,
                              height: 10,
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

                      {/* Email */}
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                        {u.email}
                      </td>

                      {/* Role Badge */}
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          fontSize: 11.5,
                          fontWeight: 700,
                          padding: '3px 10px',
                          borderRadius: 6,
                          background: u.role?.toUpperCase() === 'ADMIN' ? '#fef3c7' : '#f1f5f9',
                          color: u.role?.toUpperCase() === 'ADMIN' ? '#b45309' : '#334155',
                          border: `1px solid ${u.role?.toUpperCase() === 'ADMIN' ? '#fde68a' : '#cbd5e1'}`
                        }}>
                          {u.role?.toUpperCase() || 'USER'}
                        </span>
                      </td>

                      {/* Status Pill */}
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          fontSize: 11.5,
                          fontWeight: 700,
                          padding: '3px 10px',
                          borderRadius: 12,
                          background: isActive ? '#dcfce7' : '#fee2e2',
                          color: isActive ? '#15803d' : '#b91c1c',
                          border: `1px solid ${isActive ? '#86efac' : '#fca5a5'}`
                        }}>
                          {isActive ? 'Active' : 'Disabled'}
                        </span>
                      </td>

                      {/* Created Date */}
                      <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 12.5 }}>
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : 'Recently'}
                      </td>

                      {/* Actions: Enable/Disable Toggle + Delete */}
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                          <button
                            onClick={() => handleToggleStatus(u)}
                            disabled={actionLoading}
                            title={isActive ? 'Disable User Profile' : 'Enable User Profile'}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                              padding: '5px 11px',
                              fontSize: 12,
                              fontWeight: 600,
                              borderRadius: 6,
                              cursor: actionLoading ? 'not-allowed' : 'pointer',
                              background: isActive ? '#fef2f2' : '#f0fdf4',
                              color: isActive ? '#dc2626' : '#166534',
                              border: `1px solid ${isActive ? '#fca5a5' : '#bbf7d0'}`
                            }}
                          >
                            {isActive ? <UserX size={13} /> : <UserCheck size={13} />}
                            <span>{isActive ? 'Disable Profile' : 'Enable Profile'}</span>
                          </button>

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
                            <Trash2 size={15} />
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
            maxWidth: 480,
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
                  Provide credentials and role permissions for the new user.
                </p>
              </div>
            </div>

            <form onSubmit={handleCreateUserSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Full Name */}
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 5 }}>
                  Full Name <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <User size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#94a3b8' }} />
                  <input
                    type="text"
                    placeholder="e.g. Sarah Connor"
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
                    placeholder="sarah@company.com"
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

              {/* Role & Status Controls */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 5 }}>
                    User Role
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
                    <option value="USER">USER (Standard Access)</option>
                    <option value="ADMIN">ADMIN (Full Control)</option>
                    <option value="VENDOR">VENDOR (Assigned Projects)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 5 }}>
                    Account Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={e => setFormData({ ...formData, status: e.target.value })}
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
                    <option value="Active">Active (Enabled)</option>
                    <option value="Disabled">Disabled (Blocked)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={{
                    padding: '9px 18px',
                    fontSize: 13.5,
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
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '9px 18px',
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: '#ffffff',
                    background: 'var(--accent)',
                    border: 'none',
                    borderRadius: 8,
                    cursor: actionLoading ? 'not-allowed' : 'pointer',
                    opacity: actionLoading ? 0.7 : 1
                  }}
                >
                  <UserPlus size={15} />
                  <span>{actionLoading ? 'Creating...' : 'Create Credential'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── CONFIRM DELETE USER MODAL ─────────────────────────────────────── */}
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
            maxWidth: 440,
            width: '100%',
            padding: 28,
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
            position: 'relative',
            border: '1px solid var(--border)'
          }}>
            <button
              type="button"
              onClick={() => { setShowDeleteModal(false); setSelectedUser(null); }}
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

            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px 0' }}>
              Delete User Account?
            </h3>
            <p style={{ fontSize: 13.5, color: '#475569', lineHeight: '1.5', margin: '0 0 24px 0' }}>
              Are you sure you want to permanently delete user profile <strong style={{ color: '#0f172a' }}>"{selectedUser.email}"</strong>?
              <br /><br />
              This will purge login access for this account. <span style={{ color: '#dc2626', fontWeight: 600 }}>This action cannot be undone.</span>
            </p>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => { setShowDeleteModal(false); setSelectedUser(null); }}
                disabled={actionLoading}
                style={{
                  padding: '9px 18px',
                  fontSize: 13.5,
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
                type="button"
                onClick={confirmDeleteUser}
                disabled={actionLoading}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '9px 18px',
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: '#ffffff',
                  background: '#dc2626',
                  border: 'none',
                  borderRadius: 8,
                  cursor: actionLoading ? 'not-allowed' : 'pointer',
                  opacity: actionLoading ? 0.7 : 1
                }}
              >
                <Trash2 size={15} />
                <span>{actionLoading ? 'Deleting...' : 'Yes, Delete User'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
