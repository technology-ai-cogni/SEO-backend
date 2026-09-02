import { useState } from 'react';
import { Home, LayoutDashboard, Search, Sparkles, FileText, FolderOpen, ChevronDown, ChevronRight, Settings, HelpCircle, Bell, Trash2, Users } from 'lucide-react';
import { NAV_STRUCTURE } from '../../data/navigation';
import { canAccessRoute } from '../../lib/permissions';

const ICONS = { Home, LayoutDashboard, Search, Sparkles, FileText, FolderOpen, Settings };

const MODULE_COLORS = {
  'settings-menu': { dot: 'var(--accent)', bg: 'var(--accent-light)' },
  'search-visibility': { dot: 'var(--accent-magenta)', bg: 'var(--accent-magenta-light)' },
  'ai-visibility': { dot: 'var(--accent)', bg: 'var(--accent-light)' },
  'content-engine': { dot: '#0284c7', bg: '#f0f9ff' },
};

export default function Sidebar({ activePath, onNavigate, user }) {
  const [expanded, setExpanded] = useState({ 'settings-menu': true, 'search-visibility': true });

  const toggle = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }));

  return (
    <aside style={{
      width: 'var(--sidebar-w)',
      minWidth: 'var(--sidebar-w)',
      height: '100vh',
      background: 'radial-gradient(circle at 90% 15%, rgba(95, 35, 155, 0.35) 0%, transparent 60%), radial-gradient(circle at 10% 85%, rgba(185, 20, 105, 0.25) 0%, transparent 55%), linear-gradient(180deg, #09060E 0%, #100A1A 38%, #170C24 70%, #1C0B29 100%)',
      borderRight: '1px solid rgba(255, 255, 255, 0.08)',
      boxShadow: '4px 0 28px rgba(9, 6, 14, 0.5)',
      display: 'flex',
      flexDirection: 'column',
      position: 'fixed',
      left: 0, top: 0,
      zIndex: 100,
      overflowY: 'auto',
    }}>
      {/* Logo */}
      <div
        onClick={() => onNavigate && onNavigate('home')}
        style={{
          height: 'var(--topbar-h)',
          padding: '0 30px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          background: 'rgba(9, 6, 14, 0.4)',
          backdropFilter: 'blur(8px)',
          transition: 'background 0.15s ease'
        }}
        title="hariba.ai - Home"
      >
        <img
          src="/branding/hariba-logo-white.png"
          alt="hariba.ai"
          style={{
            height: 25,
            width: 'auto',
            maxHeight: '70%',
            objectFit: 'contain',
            display: 'block'
          }}
        />
      </div>


      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0 16px' }}>
        {NAV_STRUCTURE.map(item => {
          const Icon = ICONS[item.icon];
          const isActive = activePath === item.path || activePath?.startsWith(item.path + '/');
          const isExpanded = expanded[item.id];
          const hasChildren = item.children?.length > 0;

          if (!hasChildren) {
            if (!canAccessRoute(user, item.path)) return null;
          } else {
            const hasAnyAllowedChild = item.children.some(sec =>
              sec.items.some(child => canAccessRoute(user, child.path))
            );
            if (!hasAnyAllowedChild) return null;
          }

          return (
            <div key={item.id}>
              <button
                onClick={() => {
                  if (hasChildren) toggle(item.id);
                  else onNavigate(item.path);
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 16px',
                  background: isActive && !hasChildren ? 'linear-gradient(90deg, rgba(123, 47, 190, 0.42) 0%, rgba(212, 0, 122, 0.15) 100%)' : 'transparent',
                  border: 'none',
                  borderLeft: isActive && !hasChildren ? '3px solid #D946EF' : '3px solid transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: isActive ? '#FFFFFF' : '#A5A1B8',
                  fontFamily: 'var(--font-body)',
                  fontSize: 13.5,
                  fontWeight: isActive ? 700 : 500,
                  borderRadius: 0,
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)'; e.currentTarget.style.color = '#FFFFFF'; } }}
                onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#A5A1B8'; } }}
              >
                {Icon && <Icon size={15} strokeWidth={isActive ? 2.5 : 2} color={isActive ? '#E879F9' : '#A5A1B8'} />}
                <span style={{ flex: 1 }}>{item.label}</span>
                {hasChildren && (isExpanded
                  ? <ChevronDown size={13} color="#A5A1B8" />
                  : <ChevronRight size={13} color="#A5A1B8" />
                )}
              </button>

              {hasChildren && isExpanded && (
                <div style={{ background: 'rgba(0, 0, 0, 0.22)' }}>
                  {item.children.map((section, si) => {
                    const allowedChildren = section.items.filter(child => canAccessRoute(user, child.path));
                    if (allowedChildren.length === 0) return null;

                    return (
                      <div key={si}>
                        {section.label && section.label !== 'CONFIGURATION' && (
                          <div style={{ padding: '8px 16px 3px 34px', fontSize: 10.5, fontWeight: 700, color: '#E879F9', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                            {section.label}
                          </div>
                        )}
                        {allowedChildren.map(child => {
                          const childActive = activePath === child.path;
                          return (
                            <button
                              key={child.id}
                              onClick={() => onNavigate(child.path)}
                              style={{
                                width: '100%',
                                display: 'block',
                                padding: childActive ? '6px 16px 6px 31px' : '6px 16px 6px 34px',
                                background: childActive ? 'linear-gradient(90deg, rgba(123, 47, 190, 0.38) 0%, rgba(212, 0, 122, 0.18) 100%)' : 'transparent',
                                border: 'none',
                                borderLeft: childActive ? '3px solid #E879F9' : '3px solid transparent',
                                cursor: 'pointer',
                                textAlign: 'left',
                                color: childActive ? '#FFFFFF' : '#A5A1B8',
                                fontFamily: 'var(--font-body)',
                                fontSize: 13,
                                fontWeight: childActive ? 700 : 500,
                                transition: 'all 0.15s ease',
                              }}
                              onMouseEnter={e => { if (!childActive) { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'; e.currentTarget.style.color = '#FFFFFF'; } }}
                              onMouseLeave={e => { if (!childActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#A5A1B8'; } }}
                            >
                              {child.label}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
