import { LogOut, Settings } from 'lucide-react';

export default function Topbar({ title, subtitle, onNavigate, user, onLogout }) {
  return (
    <header style={{
      height: 'var(--topbar-h)',
      background: '#4b103ef4',
      borderBottom: '1px solid #E2D9F3',
      boxShadow: '0 2px 10px rgba(123, 47, 190, 0.04)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
      position: 'sticky',
      top: 0,
      zIndex: 50,
    }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: '#ffffffff', lineHeight: 1.2 }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 12, color: '#e4e4e4ff', marginTop: 2 }}>{subtitle}</p>}
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
                background: '#FAF8FD',
                border: '1px solid #E2D9F3',
                boxShadow: '0 2px 6px rgba(123, 47, 190, 0.04)',
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
                background: 'linear-gradient(135deg, #7B2FBE 0%, #D4007A 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 700,
                textTransform: 'uppercase',
                boxShadow: '0 2px 6px rgba(123, 47, 190, 0.3)'
              }}>
                {user.name ? user.name.charAt(0) : (user.email ? user.email.charAt(0) : 'U')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A', lineHeight: 1.2 }}>
                  {user.name || user.email}
                </span>
                {user.name && user.email && (
                  <span style={{ fontSize: 10.5, color: '#64748B', lineHeight: 1 }}>
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
                  color: '#64748B',
                  marginLeft: '4px',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#EDE5F8';
                  e.currentTarget.style.color = '#7B2FBE';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#64748B';
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
                background: '#FFFFFF',
                border: '1px solid #E2D9F3',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 12px',
                fontSize: 12.5,
                fontWeight: 600,
                color: '#475569',
                fontFamily: 'var(--font-body)',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = '#EF4444';
                e.currentTarget.style.color = '#DC2626';
                e.currentTarget.style.background = '#FEF2F2';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = '#E2D9F3';
                e.currentTarget.style.color = '#475569';
                e.currentTarget.style.background = '#FFFFFF';
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
                background: '#FFFFFF',
                border: '1px solid #CBD5E1',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: '#1A1A1A',
                fontFamily: 'var(--font-body)',
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#7B2FBE'; e.currentTarget.style.color = '#7B2FBE'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#CBD5E1'; e.currentTarget.style.color = '#1A1A1A'; }}
            >
              Log In
            </button>

            {/* Sign Up button */}
            <button
              onClick={() => onNavigate?.('signup')}
              style={{
                background: 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)',
                border: '1.5px solid #09060E',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 700,
                color: '#fff',
                fontFamily: 'var(--font-body)',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(123, 47, 190, 0.35)',
                transition: 'all 0.15s'
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'linear-gradient(135deg, #581F9E 0%, #8A33D4 45%, #D6237A 80%, #E50C88 100%)'}
              onMouseLeave={e => e.currentTarget.style.background = 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)'}
            >
              Sign Up
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

