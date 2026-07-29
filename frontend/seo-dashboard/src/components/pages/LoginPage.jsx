import { useState } from 'react';
import { Search, Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react';

export default function LoginPage({ onNavigate, initialAdminMode = false, user = null, onLoginSuccess = null, onLogout = null }) {
  const [isAdmin, setIsAdmin] = useState(initialAdminMode);
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

    try {
      const response = await fetch('http://localhost:5000/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password: password
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setErrorMsg(data.detail || 'Credentials are wrong. Please try again.');
        setIsLoading(false);
        return;
      }

      const loggedInUser = data.user || { email: email.trim(), name: email.split('@')[0] };
      if (onLoginSuccess) {
        onLoginSuccess(loggedInUser);
      }

      setSubmittedMessage(`Welcome back, ${loggedInUser.name}! Redirecting to workspace...`);
      setTimeout(() => {
        onNavigate('home');
      }, 1000);
    } catch (err) {
      setErrorMsg('Cannot connect to backend server. Make sure FastAPI server is running on port 8000.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: 'calc(100vh - var(--topbar-h) - 40px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 16px',
      background: 'var(--bg)'
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
            background: isAdmin ? 'var(--amber-bg)' : 'var(--accent-light)',
            border: `1px solid ${isAdmin ? 'var(--amber)' : 'var(--accent)'}`,
            borderRadius: 12,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12
          }}>
            {isAdmin ? (
              <ShieldCheck size={22} color="var(--amber)" />
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
            {isAdmin ? 'Admin Login' : 'User Login'}
          </h2>

          <p style={{
            fontSize: 13,
            color: 'var(--text-muted)',
            lineHeight: 1.4
          }}>
            {isAdmin
              ? 'Enter administrative credentials to manage settings'
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
              background: isAdmin ? 'var(--amber)' : 'var(--accent)',
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
            {isAdmin ? 'Log in as Admin' : 'Log in'}
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

          {/* Admin Mode Toggle Link */}
          <div>
            <button
              onClick={() => setIsAdmin(!isAdmin)}
              style={{
                background: 'none',
                border: 'none',
                padding: '4px 8px',
                color: 'var(--text-muted)',
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                fontSize: 12.5,
                borderRadius: 'var(--radius-sm)'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = 'var(--text-primary)';
                e.currentTarget.style.background = 'var(--surface-2)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'var(--text-muted)';
                e.currentTarget.style.background = 'none';
              }}
            >
              {isAdmin ? 'Switch to User Login' : 'Login as Admin'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
