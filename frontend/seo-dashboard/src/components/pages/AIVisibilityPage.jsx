import { Card, CardHeader, MetricCard, Badge } from '../ui/Card';
import { SparkLine, BarChartComp } from '../ui/MiniChart';
import {
  aiVisibilityData,
  competitorData,
  aiSources,
  brandMentionKeywords,
  brandMentions,
  mentionsBySource,
} from '../../data/mockData';
import { Sparkles } from 'lucide-react';

const totalAiMentions = (mentionsBySource['AI Overview'] || 0) + (mentionsBySource.ChatGPT || 0);
const totalMentions = brandMentions.length;
const uniqueKeywords = brandMentionKeywords.length;
const aiCoverage = totalMentions > 0 ? Math.round((totalAiMentions / totalMentions) * 100) : 0;

export default function AIVisibilityPage() {
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Score card */}
      <div style={{ background: 'linear-gradient(135deg, var(--accent) 0%, #8b5cf6 100%)', borderRadius: 'var(--radius)', padding: '24px 28px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6, fontWeight: 500 }}>AI Visibility Score</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 48, fontWeight: 800, lineHeight: 1 }}>{aiCoverage}</div>
          <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>out of 100 · {totalAiMentions} AI mentions across {uniqueKeywords} keywords</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 'var(--radius)', padding: '12px 20px', backdropFilter: 'blur(10px)' }}>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Total Citations</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700 }}>{totalMentions}</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>across SERP + AI sources</div>
          </div>
        </div>
      </div>

      {/* AI metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <MetricCard label="Total AI Mentions" value={String(totalAiMentions)} change={undefined}>
          <SparkLine data={aiVisibilityData} color="var(--accent)" />
        </MetricCard>
        <MetricCard label="Keywords Tracked" value={String(uniqueKeywords)} change={undefined}>
          <div style={{ marginTop: 6 }}>
            <Badge variant="info">{uniqueKeywords} brand queries</Badge>
          </div>
        </MetricCard>
        <MetricCard label="AI Coverage" value={`${aiCoverage}%`} change={undefined}>
          <SparkLine data={aiVisibilityData.map(d => ({ ...d, value: d.value * 1.1 }))} color="var(--green)" />
        </MetricCard>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Source breakdown */}
        <Card>
          <CardHeader title="Mentions by Source" />
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {aiSources.map(s => (
              <div key={s.name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.mentions} mentions</span>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{s.share}%</span>
                  </div>
                </div>
                <div style={{ height: 6, background: 'var(--border)', borderRadius: 99 }}>
                  <div style={{ height: '100%', borderRadius: 99, background: s.color, width: `${s.share}%`, transition: 'width 0.6s ease' }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Top brand-mention keywords */}
        <Card>
          <CardHeader title="Top Tracked Keywords" subtitle="Keywords monitored for brand visibility" />
          <div style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {brandMentionKeywords.slice(0, 10).map((kw, i) => {
                const kwMentions = brandMentions.filter(m => m.keyword === kw);
                const aiCount = kwMentions.filter(m => m.source === 'AI Overview' || m.source === 'ChatGPT').length;
                return (
                  <div key={kw} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < 9 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', flex: 1 }}>{kw}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Badge variant={aiCount > 0 ? 'success' : 'default'}>{kwMentions.length} citations</Badge>
                      {aiCount > 0 && <Badge variant="accent">{aiCount} AI</Badge>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      </div>

      {/* Competitor Insights */}
      <Card>
        <CardHeader title="Top Competing Sites" subtitle="Sites appearing most frequently for tracked keywords" />
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
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--accent)' }}>{c.name}</td>
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
