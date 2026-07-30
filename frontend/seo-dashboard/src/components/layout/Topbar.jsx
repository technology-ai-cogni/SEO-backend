import { LogOut, Settings } from 'lucide-react';

export default function Topbar({ title, subtitle, onNavigate, user, onLogout }) {
  return (
    <header style={{
      height: 'var(--topbar-h)',
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
      position: 'sticky',
      top: 0,
      zIndex: 50,
    }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>{subtitle}</p>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>

        {/* User state / Auth buttons */}
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: '9999px',
                padding: '4px 12px 4px 6px',
                cursor: 'default',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--accent) 0%, #6366f1 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 700,
                textTransform: 'uppercase',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}>
                {user.name ? user.name.charAt(0) : (user.email ? user.email.charAt(0) : 'U')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                  {user.name || user.email}
                </span>
                {user.name && user.email && (
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1 }}>
                    {user.email}
                  </span>
                )}
              </div>
              <button
                onClick={() => onNavigate?.('profile')}
                title="Profile Settings"
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '4px',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  marginLeft: '4px',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--border)';
                  e.currentTarget.style.color = 'var(--accent)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-muted)';
                }}
              >
                <Settings size={14} />
              </button>
            </div>

            <button
              onClick={onLogout}
              title="Log Out"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 12px',
                fontSize: 12.5,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-body)',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--red, #ef4444)';
                e.currentTarget.style.color = 'var(--red, #ef4444)';
                e.currentTarget.style.background = 'var(--red-bg, #fef2f2)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.color = 'var(--text-secondary)';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <LogOut size={14} />
              <span>Log Out</span>
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Login button */}
            <button
              onClick={() => onNavigate?.('login')}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-body)',
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            >
              Log In
            </button>

            {/* Sign Up button */}
            <button
              onClick={() => onNavigate?.('signup')}
              style={{
                background: 'var(--accent)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: '#fff',
                fontFamily: 'var(--font-body)',
                cursor: 'pointer',
                transition: 'background 0.15s'
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--accent)'}
            >
              Sign Up
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

