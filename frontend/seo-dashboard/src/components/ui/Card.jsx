export function Card({ children, style = {}, className = '' }) {
  return (
    <div className={className} style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow)',
      ...style,
    }}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, style = {} }) {
  return (
    <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', ...style }}>
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function MetricCard({ label, value, change, changeLabel, potential, children, accentColor }) {
  const positive = change > 0;
  const neutral = change === 0 || change === undefined;

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow)',
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
        {potential && (
          <button style={{ fontSize: 11, fontWeight: 600, color: accentColor || 'var(--accent)', background: 'var(--accent-light)', border: 'none', borderRadius: 99, padding: '3px 10px', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
            {potential}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{value}</span>
        {change !== undefined && (
          <span style={{ fontSize: 12, fontWeight: 600, color: neutral ? 'var(--text-muted)' : positive ? 'var(--green)' : 'var(--red)' }}>
            {!neutral && (positive ? '▲' : '▼')} {Math.abs(change)}{typeof change === 'number' && !String(change).includes('%') ? '' : ''}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export function Badge({ children, variant = 'default', style = {} }) {
  const variants = {
    default: { background: 'var(--border)', color: 'var(--text-secondary)' },
    success: { background: 'var(--green-bg)', color: 'var(--green)' },
    danger: { background: 'var(--red-bg)', color: 'var(--red)' },
    warning: { background: 'var(--amber-bg)', color: 'var(--amber)' },
    info: { background: 'var(--blue-bg)', color: 'var(--blue)' },
    accent: { background: 'var(--accent-light)', color: 'var(--accent)' },
  };
  return (
    <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 99, padding: '2px 8px', ...variants[variant], ...style }}>
      {children}
    </span>
  );
}

export function Table({ headers, rows, style = {} }) {
  return (
    <div style={{ overflowX: 'auto', ...style }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {headers.map((h, i) => (
              <th key={i} style={{ padding: '10px 16px', textAlign: i === 0 ? 'left' : 'right', fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ borderBottom: ri < rows.length - 1 ? '1px solid var(--border)' : 'none' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              {row.map((cell, ci) => (
                <td key={ci} style={{ padding: '10px 16px', textAlign: ci === 0 ? 'left' : 'right', fontSize: 13, color: 'var(--text-primary)' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
