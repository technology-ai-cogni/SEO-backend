import { useState, useEffect } from 'react';
import { User, Lock, Mail, Shield, CheckCircle, AlertCircle, Eye, EyeOff, Save, RotateCcw, Trash2, RefreshCw, FileText, AlertTriangle, X } from 'lucide-react';
import { hasPermission, PERMISSIONS } from '../../lib/permissions';
import { getApiBaseUrl, fetchAuditLogsApi, createAuditLogApi, clearAuditLogsApi, fetchRecycleBinItemsApi, restoreRecycleBinItemApi, hardDeleteRecycleBinItemApi } from '../../lib/projectsApi';

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



  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setProfileMsg({ type: '', text: '' });

    if (!name.trim()) {
      setProfileMsg({ type: 'error', text: 'Name cannot be empty.' });
      return;
    }

    setSavingProfile(true);
    try {
      const token = sessionStorage.getItem('seo_token');
      const response = await fetch(`${getApiBaseUrl()}/auth/update-profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
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
      const token = sessionStorage.getItem('seo_token');
      const response = await fetch(`${getApiBaseUrl()}/auth/change-password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
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





      </div>
    </div>
  );
}
