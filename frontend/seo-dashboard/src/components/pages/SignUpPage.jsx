import { useState } from 'react';
import { Search, Eye, EyeOff, Lock, Mail, User } from 'lucide-react';
import { getApiBaseUrl } from '../../lib/projectsApi';

export default function SignUpPage({ onNavigate, user = null, onLoginSuccess = null }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [submittedMessage, setSubmittedMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmittedMessage('');

    if (!fullName || !email || !password || !confirmPassword) {
      setErrorMsg('Please fill out all fields.');
      return;
    }

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    try {
      const response = await fetch(`${getApiBaseUrl()}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fullName.trim(),
          email: email.trim(),
          password: password
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setErrorMsg(data.detail || 'Registration failed.');
        return;
      }

      setSubmittedMessage('Account registered successfully! Please login to continue.');
      
      // Clear form inputs so that they start fresh
      setFullName('');
      setEmail('');
      setPassword('');
      setConfirmPassword('');

      setTimeout(() => {
        onNavigate('login');
      }, 2200);
    } catch (err) {
      setErrorMsg('Cannot connect to backend server. Make sure FastAPI server is running on port 8000.');
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
        maxWidth: 440,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-md)',
        padding: '36px 32px'
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>

          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--text-primary)',
            lineHeight: 1.3,
            marginBottom: 6
          }}>
            Create your account
          </h2>

          <p style={{
            fontSize: 13,
            color: 'var(--text-muted)',
            lineHeight: 1.4
          }}>
            Join hariba.ai to start optimizing your online presence
          </p>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div style={{
            background: 'var(--red-bg)',
            border: '1px solid var(--red)',
            color: 'var(--red)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 14px',
            fontSize: 13,
            fontWeight: 500,
            marginBottom: 18,
            textAlign: 'center'
          }}>
            {errorMsg}
          </div>
        )}

        {/* Success Alert */}
        {submittedMessage && (
          <div style={{
            background: 'var(--green-bg)',
            border: '1px solid var(--green)',
            color: 'var(--green)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 14px',
            fontSize: 13,
            fontWeight: 500,
            marginBottom: 18,
            textAlign: 'center'
          }}>
            {submittedMessage}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Full Name Input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-body)'
            }}>
              Full Name
            </label>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 12px'
            }}>
              <User size={16} color="var(--text-muted)" />
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your name"
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

          {/* Email Input */}
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
              padding: '8px 12px'
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

          {/* Password Input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-body)'
            }}>
              Password
            </label>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 12px'
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

          {/* Confirm Password Input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-body)'
            }}>
              Confirm Password
            </label>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 12px'
            }}>
              <Lock size={16} color="var(--text-muted)" />
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
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
                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            style={{
              marginTop: 8,
              background: 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)',
              color: '#ffffff',
              border: '1.5px solid #09060E',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 16px',
              fontSize: 14,
              fontWeight: 700,
              fontFamily: 'var(--font-body)',
              cursor: 'pointer',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: '0 4px 16px rgba(123, 47, 190, 0.35), 0 2px 6px rgba(212, 0, 122, 0.2)'
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg, #581F9E 0%, #8A33D4 45%, #D6237A 80%, #E50C88 100%)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)'; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            Sign Up
          </button>
        </form>

        {/* Footer Link */}
        <div style={{
          marginTop: 24,
          paddingTop: 20,
          borderTop: '1px solid var(--border)',
          textAlign: 'center',
          fontSize: 13,
          color: 'var(--text-secondary)'
        }}>
          Already have an account?{' '}
          <button
            onClick={() => onNavigate('login')}
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
            Log in
          </button>
        </div>
      </div>
    </div>
  );
}
