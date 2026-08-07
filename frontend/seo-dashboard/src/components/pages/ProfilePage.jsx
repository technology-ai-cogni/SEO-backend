import { useState, useEffect } from 'react';
import { User, Lock, Mail, Shield, CheckCircle, AlertCircle, Eye, EyeOff, Save, RotateCcw, Trash2, RefreshCw, FileText } from 'lucide-react';
import { hasPermission, PERMISSIONS } from '../../lib/permissions';
import { fetchAuditLogsApi, createAuditLogApi, clearAuditLogsApi } from '../../lib/projectsApi';

export default function ProfilePage({ user, onUserUpdate, onNavigate }) {
  const [name, setName] = useState(user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [profileMsg, setProfileMsg] = useState({ type: '', text: '' });
  const [passwordMsg, setPasswordMsg] = useState({ type: '', text: '' });

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // --- Project Restoration States ---
  const [deletedProjects, setDeletedProjects] = useState([]);
  const [selectedProjectSlug, setSelectedProjectSlug] = useState('');
  const [restoreMsg, setRestoreMsg] = useState({ type: '', text: '' });
  const [loadingDeleted, setLoadingDeleted] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // --- Admin Audit Logs States ---
  const [logs, setLogs] = useState([]);
  const [logSearch, setLogSearch] = useState('');
  const [logFilterSeverity, setLogFilterSeverity] = useState('All');
  const [loadingLogs, setLoadingLogs] = useState(false);

  const loadAuditLogs = async () => {
    if (!hasPermission(user, PERMISSIONS.VIEW_LOGS)) return;
    setLoadingLogs(true);
    try {
      const data = await fetchAuditLogsApi(logSearch, logFilterSeverity);
      setLogs(data);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  };

  // --- Effects ---
  useEffect(() => {
    if (user) {
      fetchDeletedProjects();
    }
  }, [user]);

  useEffect(() => {
    loadAuditLogs();
  }, [user, logSearch, logFilterSeverity]);

  // --- API Handlers ---
  const fetchDeletedProjects = async () => {
    setLoadingDeleted(true);
    try {
      const response = await fetch('http://localhost:8000/projects?only_deleted=true');
      if (response.ok) {
        const data = await response.json();
        setDeletedProjects(data.projects || []);
      }
    } catch (err) {
      console.error('Failed to fetch deleted projects:', err);
    } finally {
      setLoadingDeleted(false);
    }
  };

  const handleRestoreProject = async (e) => {
    e.preventDefault();
    setRestoreMsg({ type: '', text: '' });

    if (!selectedProjectSlug) {
      setRestoreMsg({ type: 'error', text: 'Please select a project to restore.' });
      return;
    }

    setRestoring(true);
    try {
      const currentUserEmail = user?.email || 'system';
      const response = await fetch(`http://localhost:8000/projects/${selectedProjectSlug}/restore?user_email=${encodeURIComponent(currentUserEmail)}`, {
        method: 'POST'
      });

      const data = await response.json();

      if (!response.ok) {
        setRestoreMsg({ type: 'error', text: data.detail || 'Failed to restore project.' });
        return;
      }

      setRestoreMsg({ type: 'success', text: 'Project restored successfully!' });
      setSelectedProjectSlug('');
      fetchDeletedProjects();
    } catch (err) {
      setRestoreMsg({ type: 'error', text: 'Network error. Make sure backend is running.' });
    } finally {
      setRestoring(false);
    }
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setProfileMsg({ type: '', text: '' });

    if (!name.trim()) {
      setProfileMsg({ type: 'error', text: 'Name cannot be empty.' });
      return;
    }

    setSavingProfile(true);
    try {
      const response = await fetch('http://localhost:8000/auth/update-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          name: name.trim()
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setProfileMsg({ type: 'error', text: data.detail || 'Failed to update profile.' });
        return;
      }

      if (data.user) {
        onUserUpdate(data.user);
      } else {
        onUserUpdate({ ...user, name: name.trim() });
      }

      setProfileMsg({ type: 'success', text: 'Profile name updated successfully!' });
    } catch (err) {
      setProfileMsg({ type: 'error', text: 'Network error. Make sure backend is running.' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordMsg({ type: '', text: '' });

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMsg({ type: 'error', text: 'Please fill in all password fields.' });
      return;
    }

    if (newPassword.length < 6) {
      setPasswordMsg({ type: 'error', text: 'New password must be at least 6 characters.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: 'error', text: 'New passwords do not match.' });
      return;
    }

    setSavingPassword(true);
    try {
      const response = await fetch('http://localhost:8000/auth/change-password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          current_password: currentPassword,
          new_password: newPassword
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setPasswordMsg({ type: 'error', text: data.detail || 'Failed to change password.' });
        return;
      }

      setPasswordMsg({ type: 'success', text: 'Password changed successfully!' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordMsg({ type: 'error', text: 'Network error. Make sure backend is running.' });
    } finally {
      setSavingPassword(false);
    }
  };

  const handleClearLogs = async () => {
    if (!confirm('Are you sure you want to clear audit logs?')) return;
    try {
      await clearAuditLogsApi();
      await loadAuditLogs();
    } catch (err) {
      console.error('Failed to clear audit logs:', err);
    }
  };

  if (!user) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h2>You are not logged in</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>Please log in to manage your account settings.</p>
        <button
          onClick={() => onNavigate('login')}
          style={{
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Go to Login
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          Account Settings
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          Manage your personal account profile, display name, and password
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Profile Details Card */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-sm)',
          padding: 28
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'var(--accent-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <User size={20} color="var(--accent)" />
            </div>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Personal Profile</h2>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Update your name and account identity</p>
            </div>
          </div>

          {profileMsg.text && (
            <div style={{
              background: profileMsg.type === 'error' ? '#fef2f2' : 'var(--green-bg)',
              border: `1px solid ${profileMsg.type === 'error' ? '#f87171' : 'var(--green)'}`,
              color: profileMsg.type === 'error' ? '#dc2626' : 'var(--green)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 14px',
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}>
              {profileMsg.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
              <span>{profileMsg.text}</span>
            </div>
          )}

          <form onSubmit={handleUpdateProfile} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Email (Read Only) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                Email Address
              </label>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '9px 12px',
                opacity: 0.85
              }}>
                <Mail size={16} color="var(--text-muted)" />
                <input
                  type="email"
                  value={user.email}
                  disabled
                  style={{
                    border: 'none',
                    background: 'transparent',
                    outline: 'none',
                    fontSize: 14,
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-body)',
                    width: '100%',
                    cursor: 'not-allowed'
                  }}
                />
              </div>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Email address cannot be changed</span>
            </div>

            {/* Display Name */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                Full Name
              </label>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '9px 12px'
              }}>
                <User size={16} color="var(--accent)" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    outline: 'none',
                    fontSize: 14,
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-body)',
                    width: '100%'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button
                type="submit"
                disabled={savingProfile}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '9px 18px',
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: savingProfile ? 'wait' : 'pointer',
                  opacity: savingProfile ? 0.7 : 1,
                  transition: 'background 0.15s'
                }}
              >
                <Save size={15} />
                <span>{savingProfile ? 'Saving...' : 'Save Profile'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Change Password Card */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-sm)',
          padding: 28
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'var(--amber-bg, #fef9e4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Shield size={20} color="var(--amber, #d4a017)" />
            </div>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Password & Security</h2>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Update your password to keep your account safe</p>
            </div>
          </div>

          {passwordMsg.text && (
            <div style={{
              background: passwordMsg.type === 'error' ? '#fef2f2' : 'var(--green-bg)',
              border: `1px solid ${passwordMsg.type === 'error' ? '#f87171' : 'var(--green)'}`,
              color: passwordMsg.type === 'error' ? '#dc2626' : 'var(--green)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 14px',
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}>
              {passwordMsg.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
              <span>{passwordMsg.text}</span>
            </div>
          )}

          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Current Password */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                Current Password
              </label>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '9px 12px'
              }}>
                <Lock size={16} color="var(--text-muted)" />
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder=""
                  style={{
                    border: 'none',
                    background: 'transparent',
                    outline: 'none',
                    fontSize: 14,
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-body)',
                    width: '100%'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  {showCurrentPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* New Password */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                New Password
              </label>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '9px 12px'
              }}>
                <Lock size={16} color="var(--accent)" />
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    outline: 'none',
                    fontSize: 14,
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-body)',
                    width: '100%'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Confirm New Password */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                Confirm New Password
              </label>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '9px 12px'
              }}>
                <Lock size={16} color="var(--accent)" />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    outline: 'none',
                    fontSize: 14,
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-body)',
                    width: '100%'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button
                type="submit"
                disabled={savingPassword}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'var(--amber, #d4a017)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '9px 18px',
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: savingPassword ? 'wait' : 'pointer',
                  opacity: savingPassword ? 0.7 : 1,
                  transition: 'background 0.15s'
                }}
              >
                <Lock size={15} />
                <span>{savingPassword ? 'Updating...' : 'Change Password'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Restore Projects Card */}
        {hasPermission(user, PERMISSIONS.RESTORE_PROJECT) && (
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-sm)',
            padding: 28
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'var(--accent-light)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <RotateCcw size={20} color="var(--accent)" />
              </div>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Restore Deleted Projects</h2>
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '2px 0 0 0' }}>Recover projects deleted within the last 30 days</p>
              </div>
            </div>

            {restoreMsg.text && (
              <div style={{
                background: restoreMsg.type === 'error' ? '#fef2f2' : 'var(--green-bg)',
                border: `1px solid ${restoreMsg.type === 'error' ? '#f87171' : 'var(--green)'}`,
                color: restoreMsg.type === 'error' ? '#dc2626' : 'var(--green)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 16px',
                fontSize: 13,
                fontWeight: 500,
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}>
                {restoreMsg.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
                <span>{restoreMsg.text}</span>
              </div>
            )}

            <form onSubmit={handleRestoreProject} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  Deleted Projects (Saved for 30 days)
                </label>
                <div style={{ position: 'relative' }}>
                  {loadingDeleted ? (
                    <div style={{ padding: '10px 14px', fontSize: 13.5, color: 'var(--text-muted)' }}>
                      Loading deleted projects...
                    </div>
                  ) : deletedProjects.length === 0 ? (
                    <div style={{ padding: '10px 14px', fontSize: 13.5, color: 'var(--text-muted)', background: 'var(--surface-2)', border: '1.5px solid var(--border)', borderRadius: 8 }}>
                      No deleted projects to restore.
                    </div>
                  ) : (
                    <select
                      value={selectedProjectSlug}
                      onChange={(e) => setSelectedProjectSlug(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        fontSize: 13.5,
                        background: 'var(--surface)',
                        border: '1.5px solid var(--border)',
                        borderRadius: 8,
                        color: 'var(--text-primary)',
                        outline: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="">-- Choose a project to restore --</option>
                      {deletedProjects.map((p) => (
                        <option key={p.slug} value={p.slug}>
                          {p.name} ({p.domain})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                <button
                  type="submit"
                  disabled={restoring || !selectedProjectSlug}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'var(--accent)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    padding: '9px 18px',
                    fontSize: 13.5,
                    fontWeight: 600,
                    cursor: (restoring || !selectedProjectSlug) ? 'not-allowed' : 'pointer',
                    opacity: (restoring || !selectedProjectSlug) ? 0.7 : 1,
                    transition: 'background 0.15s'
                  }}
                >
                  <RotateCcw size={15} />
                  <span>{restoring ? 'Restoring...' : 'Restore Project'}</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* System Audit Logs Card (Admin Only) */}
        {hasPermission(user, PERMISSIONS.VIEW_LOGS) && (
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-sm)',
            padding: 28
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'var(--accent-light)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <FileText size={18} color="var(--accent)" />
                </div>
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>System Audit Logs</h2>
                  <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '2px 0 0 0' }}>Monitor administrative actions and system events.</p>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleClearLogs}
                  title="Clear all stored logs"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: '#fef2f2',
                    border: '1.5px solid #fecaca',
                    borderRadius: 8,
                    padding: '8px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#dc2626',
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fee2e2'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fef2f2'}
                >
                  <Trash2 size={13} />
                  <span>Clear Logs</span>
                </button>
              </div>
            </div>

            {/* Filter and Search bar */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <input
                type="text"
                placeholder="Search by User or Action..."
                value={logSearch}
                onChange={e => setLogSearch(e.target.value)}
                style={{
                  flex: 1,
                  padding: '9px 14px',
                  fontSize: 13.5,
                  background: 'var(--surface)',
                  border: '1.5px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text-primary)',
                  outline: 'none'
                }}
              />
              <select
                value={logFilterSeverity}
                onChange={e => setLogFilterSeverity(e.target.value)}
                style={{
                  width: 140,
                  padding: '9px 14px',
                  fontSize: 13.5,
                  background: 'var(--surface)',
                  border: '1.5px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text-primary)',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="All">All Severity</option>
                <option value="Success">Success</option>
                <option value="Warning">Warning</option>
                <option value="Info">Info</option>
              </select>
            </div>

            {/* Logs Table */}
            <div style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              overflow: 'hidden',
              boxShadow: 'var(--shadow-sm)'
            }}>
              <div style={{ overflowY: 'auto', maxHeight: 320 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8f9fb', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 }}>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 170 }}>Timestamp</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 220 }}>User</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Action</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 100 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const filteredLogs = logs.filter(l => {
                        const matchesSearch = 
                          (l.user || '').toLowerCase().includes(logSearch.toLowerCase()) ||
                          (l.action || '').toLowerCase().includes(logSearch.toLowerCase());
                        
                        if (logFilterSeverity === 'All') return matchesSearch;
                        return matchesSearch && l.status === logFilterSeverity;
                      });

                      if (filteredLogs.length === 0) {
                        return (
                          <tr>
                            <td colSpan={4} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13.5 }}>
                              No audit log matches found.
                            </td>
                          </tr>
                        );
                      }

                      return filteredLogs.map(log => {
                        const statusColors = {
                          Success: { bg: 'var(--green-bg)', text: 'var(--green)' },
                          Warning: { bg: '#fef3c7', text: '#d97706' },
                          Info: { bg: 'var(--surface-2)', text: 'var(--text-muted)' },
                        };
                        const colors = statusColors[log.status] || { bg: '#fef2f2', text: '#dc2626' };
                        return (
                          <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{log.timestamp}</td>
                            <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{log.user}</td>
                            <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>{log.action}</td>
                            <td style={{ padding: '12px 16px', fontSize: 12.5 }}>
                              <span style={{
                                background: colors.bg,
                                color: colors.text,
                                padding: '2px 7px',
                                borderRadius: 6,
                                fontWeight: 700,
                                fontSize: 11
                              }}>
                                {log.status}
                              </span>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
