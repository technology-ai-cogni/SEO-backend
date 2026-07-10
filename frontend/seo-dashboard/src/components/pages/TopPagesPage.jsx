import { Card, CardHeader, Badge, Table } from '../ui/Card';
import { SparkLine } from '../ui/MiniChart';
import { topPages, visibilityData } from '../../data/mockData';
import { ExternalLink } from 'lucide-react';

export default function TopPagesPage() {
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {[
          { label: 'Total Pages Tracked', value: '5' },
          { label: 'Avg. Traffic per Page', value: '469' },
          { label: 'Avg. Position', value: '18.1' },
        ].map(s => (
          <Card key={s.label} style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800 }}>{s.value}</div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Top Performing Pages" subtitle="Ranked by organic traffic" />
        <Table
          headers={['Page URL', 'Traffic', 'Keywords', 'Avg Position', 'Trend']}
          rows={topPages.map(p => [
            <div key="url" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 500, color: 'var(--accent)' }}>{p.page}</span>
              <ExternalLink size={11} color="var(--text-muted)" />
            </div>,
            <span key="t" style={{ fontWeight: 700 }}>{p.traffic.toLocaleString()}</span>,
            p.keywords,
            p.position,
            <div key="tr" style={{ width: 80, display: 'inline-block' }}>
              <SparkLine data={visibilityData} color="var(--accent)" height={28} />
            </div>,
          ])}
        />
      </Card>
    </div>
  );
}
