import { useState } from 'react';
import { Search, Eye, EyeOff, Lock, Mail, ShieldCheck, Briefcase } from 'lucide-react';

export default function LoginPage({ onNavigate, initialAdminMode = false, user = null, onLoginSuccess = null, onLogout = null }) {
  const [selectedRole, setSelectedRole] = useState(initialAdminMode ? 'ADMIN' : 'USER');
  const isAdmin = selectedRole === 'ADMIN';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [submittedMessage, setSubmittedMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmittedMessage('');

    if (!email || !password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }

    setIsLoading(true);

    let loggedInUser = null;

    try {
      // 1) Attempt production REST API login first
      const res = await fetch('http://52.44.80.193:8000/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password: password.trim() })
      });

      if (res.ok) {
        const data = await res.json();
        let dbUser = data.user;
        
        // Enforce role check if DB user has assigned role
        if (dbUser && dbUser.role && dbUser.role.toUpperCase() !== selectedRole.toUpperCase()) {
          setErrorMsg(`Access Denied: Only ${selectedRole} accounts are authorized to log in using this card.`);
          setIsLoading(false);
          return;
        }

        loggedInUser = dbUser || { email: email.trim(), name: email.split('@')[0], role: selectedRole };
      } else {
        const errData = await res.json().catch(() => null);
        setErrorMsg(errData?.detail || 'Invalid email or password.');
        setIsLoading(false);
        return;
      }
    } catch (err) {
      setErrorMsg('Unable to connect to authentication server. Please try again.');
      setIsLoading(false);
      return;
    }

    setIsLoading(false);
    setSubmittedMessage(`Login successful! Logged in as ${selectedRole}.`);

    if (onLoginSuccess && loggedInUser) {
      onLoginSuccess(loggedInUser);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      padding: 24
    }}>
      <div style={{
        width: '100%',
        maxWidth: 420,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-md)',
        padding: '36px 32px'
      }}>
        {/* Header Icon & Brand */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 44,
            height: 44,
            background: selectedRole === 'ADMIN' ? 'var(--amber-bg)' : selectedRole === 'VENDOR' ? 'var(--red-bg)' : 'var(--accent-light)',
            border: `1px solid ${selectedRole === 'ADMIN' ? 'var(--amber)' : selectedRole === 'VENDOR' ? 'var(--red)' : 'var(--accent)'}`,
            borderRadius: 12,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12
          }}>
            {selectedRole === 'ADMIN' ? (
              <ShieldCheck size={22} color="var(--amber)" />
            ) : selectedRole === 'VENDOR' ? (
              <Briefcase size={22} color="var(--red)" />
            ) : (
              <Search size={22} color="var(--accent)" />
            )}
          </div>

          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--text-primary)',
            lineHeight: 1.3,
            marginBottom: 6
          }}>
            {selectedRole === 'ADMIN' ? 'Admin Login' : selectedRole === 'VENDOR' ? 'Vendor Login' : 'User Login'}
          </h2>

          <p style={{
            fontSize: 13,
            color: 'var(--text-muted)',
            lineHeight: 1.4
          }}>
            {selectedRole === 'ADMIN'
              ? 'Enter administrative credentials to manage settings'
              : selectedRole === 'VENDOR'
              ? 'Enter vendor credentials to manage assigned projects'
              : 'Welcome back! Log in to access your SEO workspace'}
          </p>
        </div>

        {/* Already logged in Banner */}
        {user && (
          <div style={{
            background: 'var(--accent-light)',
            border: '1px solid var(--accent)',
            borderRadius: 'var(--radius-sm)',
            padding: '14px 16px',
            marginBottom: 20,
            textAlign: 'center'
          }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', marginBottom: 8 }}>
              Currently logged in as {user.name || user.email}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => onNavigate('home')}
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 14px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Go to Workspace
              </button>
              <button
                type="button"
                onClick={onLogout}
                style={{
                  background: 'var(--surface)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 14px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Log Out
              </button>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMsg && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #f87171',
            color: '#dc2626',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 14px',
            fontSize: 13,
            fontWeight: 500,
            marginBottom: 20,
            textAlign: 'center'
          }}>
            {errorMsg}
          </div>
        )}

        {/* Feedback Alert */}
        {submittedMessage && (
          <div style={{
            background: 'var(--green-bg)',
            border: '1px solid var(--green)',
            color: 'var(--green)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 14px',
            fontSize: 13,
            fontWeight: 500,
            marginBottom: 20,
            textAlign: 'center'
          }}>
            {submittedMessage}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Email input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-body)'
            }}>
              Email address
            </label>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 12px',
              transition: 'border-color 0.15s'
            }}>
              <Mail size={16} color="var(--text-muted)" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
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

          {/* Password input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-body)'
              }}>
                Password
              </label>
              <a
                href="#forgot-password"
                onClick={(e) => {
                  e.preventDefault();
                  alert('Password reset link sent (UI Demo)');
                }}
                style={{
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: 'var(--accent)',
                  textDecoration: 'none'
                }}
                onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
              >
                Forgot your password?
              </a>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 12px',
              transition: 'border-color 0.15s'
            }}>
              <Lock size={16} color="var(--text-muted)" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
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
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--text-muted)'
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            style={{
              marginTop: 6,
              background: selectedRole === 'ADMIN' ? 'var(--amber)' : selectedRole === 'VENDOR' ? 'var(--red)' : 'var(--accent)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '11px 16px',
              fontSize: 14,
              fontWeight: 600,
              fontFamily: 'var(--font-body)',
              cursor: 'pointer',
              transition: 'opacity 0.15s ease',
              boxShadow: '0 2px 6px rgba(0,0,0,0.08)'
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            {selectedRole === 'ADMIN' ? 'Log in as Admin' : selectedRole === 'VENDOR' ? 'Log in as Vendor' : 'Log in'}
          </button>
        </form>

        {/* Footer links */}
        <div style={{
          marginTop: 24,
          paddingTop: 20,
          borderTop: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          fontSize: 13,
          color: 'var(--text-secondary)'
        }}>
          {/* Sign Up Link */}
          <div>
            Don't have an account?{' '}
            <button
              onClick={() => onNavigate('signup')}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'var(--accent)',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                fontSize: 13
              }}
              onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
              onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
            >
              Sign Up
            </button>
          </div>

          {/* Role Mode Toggle Links */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {['USER', 'VENDOR', 'ADMIN'].map((r) => {
              const isSelected = selectedRole === r;
              const activeBg = r === 'ADMIN' ? 'var(--amber-bg)' : r === 'VENDOR' ? 'var(--red-bg)' : 'var(--accent-light)';
              const activeColor = r === 'ADMIN' ? 'var(--amber)' : r === 'VENDOR' ? 'var(--red)' : 'var(--accent)';
              const activeBorder = r === 'ADMIN' ? '1px solid var(--amber)' : r === 'VENDOR' ? '1px solid var(--red)' : '1px solid var(--accent)';

              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSelectedRole(r)}
                  style={{
                    background: isSelected ? activeBg : 'none',
                    border: isSelected ? activeBorder : '1px solid transparent',
                    padding: '5px 10px',
                    color: isSelected ? activeColor : 'var(--text-muted)',
                    fontWeight: isSelected ? 600 : 500,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-body)',
                    fontSize: 12.5,
                    borderRadius: 'var(--radius-sm)',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => {
                    if (!isSelected) {
                      e.currentTarget.style.color = 'var(--text-primary)';
                      e.currentTarget.style.background = 'var(--surface-2)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isSelected) {
                      e.currentTarget.style.color = 'var(--text-muted)';
                      e.currentTarget.style.background = 'none';
                    }
                  }}
                >
                  {r === 'USER' ? 'Login as User' : r === 'VENDOR' ? 'Login as Vendor' : 'Login as Admin'}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
