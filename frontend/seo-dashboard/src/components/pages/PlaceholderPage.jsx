import { Construction } from 'lucide-react';

export default function PlaceholderPage({ title }) {
  return (
    <div style={{ padding: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--accent-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
          <Construction size={28} color="var(--accent)" />
        </div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{title}</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6 }}>
          This section is ready for your data. Connect your sources to populate analytics, reports, and insights here.
        </p>
        <button style={{ marginTop: 20, fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#fff', background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 20px', cursor: 'pointer' }}>
          Set up data source
        </button>
      </div>
    </div>
  );
}
