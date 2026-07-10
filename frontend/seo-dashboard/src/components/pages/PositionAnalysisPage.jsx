import { Card, CardHeader, MetricCard, Badge, Table } from '../ui/Card';
import { SparkLine } from '../ui/MiniChart';
import { visibilityData, trafficData, positionData, topKeywords, rankingsDistribution, totalKeywordCount } from '../../data/mockData';
import { Filter, ArrowUpDown } from 'lucide-react';

function getIntentVariant(intent) {
  const lower = intent.toLowerCase();
  if (lower.includes('commercial')) return 'accent';
  if (lower.includes('informational')) return 'info';
  if (lower.includes('transactional')) return 'success';
  return 'default';
}

export default function PositionAnalysisPage() {
  const tabs = ['Landscape', 'Overview', 'K/D Distribution', 'Clusters', 'Pages', 'Cannibalization', 'Competitors Discovery', 'Devices & Locations', 'Featured Snippets'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Tabs */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 24px', display: 'flex', gap: 0, overflowX: 'auto' }}>
        {tabs.map((tab, i) => (
          <button key={tab} style={{
            padding: '12px 16px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 13,
            fontFamily: 'var(--font-body)',
            fontWeight: i === 0 ? 600 : 500,
            color: i === 0 ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: i === 0 ? '2px solid var(--accent)' : '2px solid transparent',
            whiteSpace: 'nowrap',
            transition: 'color 0.15s',
          }}>
            {tab}
          </button>
        ))}
      </div>

      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Domain filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 99, padding: '5px 14px 5px 10px', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
            OWIS · Singapore
            <button style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
          </div>
        </div>

        {/* Metrics row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <MetricCard label="Visibility" value="1.44%" change={-0.45} potential="+0.67% potential">
            <SparkLine data={visibilityData} color="var(--accent)" />
          </MetricCard>
          <MetricCard label="Estimated Traffic" value="25.87" change={14.08} potential="+141.18 potential">
            <SparkLine data={trafficData} color="var(--green)" />
          </MetricCard>
          <MetricCard label="Average Position" value="86.38" change={1.19} potential="↑17.26 potential">
            <SparkLine data={positionData} color="var(--amber)" />
          </MetricCard>
        </div>

        {/* K/D Distribution */}
        <Card>
          <CardHeader title="Keyword Difficulty Distribution" />
          <div style={{ padding: 20 }}>
            {/* Color bar */}
            <div style={{ display: 'flex', height: 10, borderRadius: 99, overflow: 'hidden', marginBottom: 16 }}>
              {rankingsDistribution.map((r, i) => (
                <div key={i} style={{ flex: r.count || 1, background: r.color }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {rankingsDistribution.map(r => (
                <div key={r.range} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: r.color, display: 'inline-block' }} />
                  {r.range} · <strong style={{ color: 'var(--text-primary)' }}>{r.count}</strong>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Keywords table */}
        <Card>
          <CardHeader
            title="Tracked Keywords"
            subtitle={`${totalKeywordCount.toLocaleString()} keywords tracked for Singapore · Google`}
            action={
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 500, color: 'var(--text-secondary)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '5px 12px', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                  <Filter size={12} /> Filter
                </button>
                <button style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 500, color: 'var(--text-secondary)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '5px 12px', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                  <ArrowUpDown size={12} /> Sort
                </button>
              </div>
            }
          />
          <Table
            headers={['Keyword', 'Intent', 'Search Volume', 'K/D', 'Cluster']}
            rows={topKeywords.slice(0, 30).map(k => [
              <div key="kw">
                <div style={{ fontWeight: 500, fontSize: 13 }}>{k.keyword}</div>
              </div>,
              <Badge key="intent" variant={getIntentVariant(k.intent)}>{k.intent || '—'}</Badge>,
              <span key="vol" style={{ fontWeight: 700 }}>{k.volume.toLocaleString()}</span>,
              <span key="kd" style={{ color: k.kd !== null ? (k.kd > 60 ? 'var(--red)' : k.kd > 30 ? 'var(--amber)' : 'var(--green)') : 'var(--text-muted)', fontWeight: 600, fontSize: 13 }}>
                {k.kd !== null ? k.kd : 'n/a'}
              </span>,
              <span key="cluster" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{k.cluster || '—'}</span>,
            ])}
          />
        </Card>
      </div>
    </div>
  );
}
