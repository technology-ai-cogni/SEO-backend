import { useState } from 'react';
import { Home, LayoutDashboard, Search, Sparkles, FileText, FolderOpen, ChevronDown, ChevronRight, Settings, HelpCircle, Bell } from 'lucide-react';
import { NAV_STRUCTURE } from '../../data/navigation';

const ICONS = { Home, LayoutDashboard, Search, Sparkles, FileText, FolderOpen };

const MODULE_COLORS = {
  'search-visibility': { dot: '#e74c6f', bg: '#fdeef2' },
  'ai-visibility': { dot: '#d4a017', bg: '#fef9e4' },
  'content-engine': { dot: '#3b82f6', bg: '#dbeafe' },
};

export default function Sidebar({ activePath, onNavigate }) {
  const [expanded, setExpanded] = useState({ 'search-visibility': true });

  const toggle = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }));

  return (
    <aside style={{
      width: 'var(--sidebar-w)',
      minWidth: 'var(--sidebar-w)',
      height: '100vh',
      background: 'var(--surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      position: 'fixed',
      left: 0, top: 0,
      zIndex: 100,
      overflowY: 'auto',
    }}>
      {/* Logo */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, minHeight: 'var(--topbar-h)' }}>
        <div style={{ width: 28, height: 28, background: 'var(--accent)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Search size={14} color="#fff" strokeWidth={2.5} />
        </div>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
          SEO<span style={{ color: 'var(--accent)' }}>Vision</span>
        </span>
      </div>

      {/* Domain selector */}
      <div style={{ padding: '10px 14px', margin: '10px 10px 4px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 1 }}>Active Domain</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>cognitute.org</div>
        </div>
        <ChevronDown size={14} color="var(--text-muted)" />
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0 16px' }}>
        {NAV_STRUCTURE.map(item => {
          const Icon = ICONS[item.icon];
          const isActive = activePath === item.path || activePath?.startsWith(item.path + '/');
          const isExpanded = expanded[item.id];
          const color = MODULE_COLORS[item.id];
          const hasChildren = item.children?.length > 0;

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
                  background: isActive && !hasChildren ? 'var(--accent-light)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 13.5,
                  fontWeight: isActive ? 600 : 500,
                  borderRadius: 0,
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface-2)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                {color ? (
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color.dot, flexShrink: 0 }} />
                ) : (
                  Icon && <Icon size={15} strokeWidth={isActive ? 2.5 : 2} />
                )}
                <span style={{ flex: 1 }}>{item.label}</span>
                {hasChildren && (isExpanded
                  ? <ChevronDown size={13} />
                  : <ChevronRight size={13} />
                )}
              </button>

              {hasChildren && isExpanded && (
                <div style={{ background: color ? `${color.bg}55` : 'transparent' }}>
                  {item.children.map((section, si) => (
                    <div key={si}>
                      <div style={{ padding: '6px 16px 2px 34px', fontSize: 10.5, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                        {section.label}
                      </div>
                      {section.items.map(child => {
                        const childActive = activePath === child.path;
                        return (
                          <button
                            key={child.id}
                            onClick={() => onNavigate(child.path)}
                            style={{
                              width: '100%',
                              display: 'block',
                              padding: '6px 16px 6px 34px',
                              background: childActive ? 'var(--accent-light)' : 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              textAlign: 'left',
                              color: childActive ? 'var(--accent)' : 'var(--text-secondary)',
                              fontFamily: 'var(--font-body)',
                              fontSize: 13,
                              fontWeight: childActive ? 600 : 400,
                              transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => { if (!childActive) e.currentTarget.style.background = '#f0f2f7'; }}
                            onMouseLeave={e => { if (!childActive) e.currentTarget.style.background = 'transparent'; }}
                          >
                            {child.label}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom */}
      <div style={{ padding: '12px 10px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {[{ icon: Bell, label: 'Notifications' }, { icon: Settings, label: 'Settings' }, { icon: HelpCircle, label: 'Help' }].map(({ icon: Icon, label }) => (
          <button key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', fontSize: 13, fontFamily: 'var(--font-body)', width: '100%', transition: 'background 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
    </aside>
  );
}
