import { Card, CardHeader, MetricCard, Badge, Table } from '../ui/Card';
import { SparkLine, BarChartComp } from '../ui/MiniChart';
import {
  visibilityData, trafficData, positionData,
  topKeywords, summaryAlerts, competitorData,
  rankingsDistribution, totalKeywordCount,
  intentDistribution, clusterDistribution,
} from '../../data/mockData';
import { TrendingUp, TrendingDown, Info, AlertTriangle, CheckCircle, Zap } from 'lucide-react';

const alertIcons = { info: Info, success: CheckCircle, warning: AlertTriangle, tip: Zap };
const alertColors = { info: 'var(--blue)', success: 'var(--green)', warning: 'var(--amber)', tip: 'var(--accent)' };
const alertBgs = { info: 'var(--blue-bg)', success: 'var(--green-bg)', warning: 'var(--amber-bg)', tip: 'var(--accent-light)' };

function getIntentVariant(intent) {
  const lower = intent.toLowerCase();
  if (lower.includes('commercial')) return 'accent';
  if (lower.includes('informational')) return 'info';
  if (lower.includes('transactional')) return 'success';
  return 'default';
}

const maxDist = Math.max(...rankingsDistribution.map(r => r.count), 1);

export default function DashboardPage() {
  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1400 }}>
      {/* Domain header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Singapore · Google · English · OWIS Keyword Research</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--accent)' }}>GSG Schools – OWIS</h2>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Badge variant="default">Keywords: {totalKeywordCount.toLocaleString()}</Badge>
          <Badge variant="info">Clusters: {clusterDistribution.length}</Badge>
        </div>
      </div>

      {/* Metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <MetricCard label="Visibility" value="1.44%" change={-0.45} potential="See potential">
          <SparkLine data={visibilityData} color="#5c4af2" />
        </MetricCard>
        <MetricCard label="Estimated Traffic" value="25.87" change={14.08} potential="See potential">
          <SparkLine data={trafficData} color="#16a34a" />
        </MetricCard>
        <MetricCard label="Average Position" value="86.38" change={1.19} potential="See potential">
          <SparkLine data={positionData} color="#d97706" />
        </MetricCard>
      </div>

      {/* K/D Distribution + Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 16 }}>
        {/* K/D Distribution */}
        <Card>
          <CardHeader title="Keyword Difficulty Distribution" />
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rankingsDistribution.map(r => (
              <div key={r.range}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-secondary)' }}>{r.range}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{r.count}</span>
                </div>
                <div style={{ height: 6, background: 'var(--border)', borderRadius: 99 }}>
                  <div style={{ height: '100%', borderRadius: 99, background: r.color, width: `${(r.count / maxDist) * 100}%` }} />
                </div>
              </div>
            ))}
            <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Total Keywords</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800 }}>{totalKeywordCount}</span>
                <div style={{ fontSize: 12, textAlign: 'right' }}>
                  {intentDistribution.slice(0, 2).map(d => (
                    <div key={d.intent} style={{ color: 'var(--text-muted)' }}>{d.intent}: {d.count}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Summary */}
        <Card>
          <CardHeader title="Summary" subtitle="OWIS Keyword Research · Singapore" />
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {summaryAlerts.map((alert, i) => {
              const Icon = alertIcons[alert.type];
              return (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: alertBgs[alert.type], borderRadius: 'var(--radius-sm)', border: `1px solid ${alertColors[alert.type]}22` }}>
                  <Icon size={14} color={alertColors[alert.type]} style={{ marginTop: 1, flexShrink: 0 }} />
                  <p style={{ fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.5 }}>{alert.message}</p>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Top keywords by volume */}
      <Card>
        <CardHeader title="Top Keywords by Search Volume" subtitle="Sorted by highest monthly search volume" />
        <Table
          headers={['Keyword', 'Intent', 'Volume', 'K/D', 'Cluster']}
          rows={topKeywords.slice(0, 20).map(k => [
            <span key="kw" style={{ fontWeight: 500 }}>{k.keyword}</span>,
            <Badge key="intent" variant={getIntentVariant(k.intent)}>{k.intent || '—'}</Badge>,
            <span key="vol" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{k.volume.toLocaleString()}</span>,
            <span key="kd" style={{ color: k.kd !== null ? (k.kd > 60 ? 'var(--red)' : k.kd > 30 ? 'var(--amber)' : 'var(--green)') : 'var(--text-muted)', fontWeight: 600 }}>
              {k.kd !== null ? k.kd : 'n/a'}
            </span>,
            <span key="cluster" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{k.cluster || '—'}</span>,
          ])}
        />
      </Card>

      {/* Competitor overview */}
      <Card>
        <CardHeader title="Top Competing Sites" subtitle="Sites appearing for tracked keywords across SERP & AI" />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Domain', 'Total Mentions', 'AI Mentions', 'SERP Mentions', 'AI Share'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {competitorData.map((c, i) => (
                <tr key={i} style={{ borderBottom: i < competitorData.length - 1 ? '1px solid var(--border)' : 'none' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 13 }}>{c.name}</span>
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 700 }}>{c.mentions}</td>
                  <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--green)' }}>{c.aiMentions}</td>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>{c.serpMentions}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 40, height: 4, background: 'var(--border)', borderRadius: 99 }}>
                        <div style={{ width: `${c.aiVisibility}%`, height: '100%', borderRadius: 99, background: c.aiVisibility >= 50 ? 'var(--green)' : 'var(--amber)' }} />
                      </div>
                      <span style={{ fontWeight: 700 }}>{c.aiVisibility}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
