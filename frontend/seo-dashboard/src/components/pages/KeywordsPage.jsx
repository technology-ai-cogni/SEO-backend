import { useState } from 'react';
import { Card, CardHeader, Badge, Table } from '../ui/Card';
import { SparkLine } from '../ui/MiniChart';
import { topKeywords, totalKeywordCount, visibilityData, intentDistribution } from '../../data/mockData';
import { Search, Plus, Filter, Download } from 'lucide-react';

const intentColors = {
  Commercial: 'accent',
  Informational: 'info',
  Transactional: 'success',
  Navigational: 'default',
};

function getIntentVariant(intent) {
  const lower = intent.toLowerCase();
  if (lower.includes('commercial')) return 'accent';
  if (lower.includes('informational')) return 'info';
  if (lower.includes('transactional')) return 'success';
  if (lower.includes('navigational')) return 'default';
  return 'default';
}

export default function KeywordsPage() {
  const [search, setSearch] = useState('');
  const [clusterFilter, setClusterFilter] = useState('');

  const clusters = [...new Set(topKeywords.map(k => k.cluster).filter(Boolean))].sort();

  const filtered = topKeywords.filter(k => {
    const matchSearch = k.keyword.toLowerCase().includes(search.toLowerCase());
    const matchCluster = !clusterFilter || k.cluster === clusterFilter;
    return matchSearch && matchCluster;
  });

  const commercialCount = topKeywords.filter(k => k.intent.toLowerCase().includes('commercial')).length;
  const informationalCount = topKeywords.filter(k => k.intent.toLowerCase().includes('informational')).length;
  const avgVolume = Math.round(topKeywords.reduce((s, k) => s + k.volume, 0) / (topKeywords.length || 1));

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {[
          { label: 'Total Keywords', value: totalKeywordCount.toLocaleString(), badge: null },
          { label: 'Commercial Intent', value: commercialCount.toLocaleString(), badge: { text: `${Math.round(commercialCount / totalKeywordCount * 100)}%`, variant: 'accent' } },
          { label: 'Informational Intent', value: informationalCount.toLocaleString(), badge: { text: `${Math.round(informationalCount / totalKeywordCount * 100)}%`, variant: 'info' } },
          { label: 'Avg. Volume', value: avgVolume.toLocaleString(), badge: null },
        ].map(s => (
          <Card key={s.label} style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 500 }}>{s.label}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800 }}>{s.value}</span>
              {s.badge && <Badge variant={s.badge.variant}>{s.badge.text}</Badge>}
            </div>
          </Card>
        ))}
      </div>

      {/* Keywords table */}
      <Card>
        <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', gap: 12 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700 }}>All Keywords</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, maxWidth: 500 }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 12px' }}>
              <Search size={13} color="var(--text-muted)" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search keywords..."
                style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, fontFamily: 'var(--font-body)', flex: 1 }}
              />
            </div>
            <select
              value={clusterFilter}
              onChange={e => setClusterFilter(e.target.value)}
              style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-secondary)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', cursor: 'pointer', fontFamily: 'var(--font-body)' }}
            >
              <option value="">All Clusters</option>
              {clusters.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: '#fff', background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '6px 14px', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
              <Plus size={13} /> Add Keywords
            </button>
            <button style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 500, color: 'var(--text-secondary)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 12px', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
              <Download size={12} />
            </button>
          </div>
        </div>
        <Table
          headers={['Keyword', 'Intent', 'Volume', 'K/D', 'Cluster', 'Target']}
          rows={filtered.map(k => [
            <span key="kw" style={{ fontWeight: 500 }}>{k.keyword}</span>,
            <Badge key="intent" variant={getIntentVariant(k.intent)}>{k.intent || '—'}</Badge>,
            <span key="vol" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{k.volume.toLocaleString()}</span>,
            <div key="kd" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {k.kd !== null ? (
                <>
                  <div style={{ width: 40, height: 4, background: 'var(--border)', borderRadius: 99 }}>
                    <div style={{ height: '100%', borderRadius: 99, width: `${Math.min(k.kd, 100)}%`, background: k.kd > 60 ? 'var(--red)' : k.kd > 30 ? 'var(--amber)' : 'var(--green)' }} />
                  </div>
                  <span style={{ fontSize: 12 }}>{k.kd}</span>
                </>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>n/a</span>
              )}
            </div>,
            <span key="cluster" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{k.cluster || '—'}</span>,
            <Badge key="target" variant={k.target === 'Landing Page' ? 'accent' : k.target === 'Topical Blog' ? 'info' : 'default'}>{k.target || '—'}</Badge>,
          ])}
        />
      </Card>
    </div>
  );
}
