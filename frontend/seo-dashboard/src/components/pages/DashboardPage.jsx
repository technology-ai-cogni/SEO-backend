import { Card, CardHeader, MetricCard, Badge, Table } from '../ui/Card';
import { SparkLine } from '../ui/MiniChart';
import { TrendingUp, TrendingDown, Info, AlertTriangle, CheckCircle, Zap, FolderOpen } from 'lucide-react';

const alertIcons = { info: Info, success: CheckCircle, warning: AlertTriangle, tip: Zap };
const alertColors = { info: 'var(--blue)', success: 'var(--green)', warning: 'var(--amber)', tip: 'var(--accent)' };
const alertBgs = { info: 'var(--blue-bg)', success: 'var(--green-bg)', warning: 'var(--amber-bg)', tip: 'var(--accent-light)' };

function getIntentVariant(intent) {
  if (!intent) return 'default';
  const lower = intent.toLowerCase();
  if (lower.includes('commercial')) return 'accent';
  if (lower.includes('informational')) return 'info';
  if (lower.includes('transactional')) return 'success';
  return 'default';
}

export default function DashboardPage({ activeProject, keywords = [], loadingKeywords = false }) {
  if (loadingKeywords) {
    return (
      <div style={{ padding: 32, display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', color: 'var(--text-muted)' }}>
        Loading project dashboard...
      </div>
    );
  }

  if (!activeProject) {
    return (
      <div style={{ padding: '64px 32px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <FolderOpen size={48} color="var(--text-muted)" />
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>No Active Project</h2>
        <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>Please select or create a project to see metrics.</p>
      </div>
    );
  }

  if (keywords.length === 0) {
    return (
      <div style={{ padding: '64px 32px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <FolderOpen size={48} color="var(--text-muted)" />
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>No Keywords Found</h2>
        <p style={{ fontSize: 13.5, color: 'var(--text-muted)', maxWidth: 400, margin: '0 auto 12px' }}>
          This project doesn't have any keywords yet. Go to the project setup to import keywords and run categorization.
        </p>
      </div>
    );
  }

  // 1. Compute Dynamic Metrics
  const totalKeywords = keywords.length;
  
  // Visibility: % of keywords ranked <= 30
  const rankedKeywords = keywords.filter(k => k.rank !== null && k.rank > 0);
  const visibilityCount = keywords.filter(k => k.rank !== null && k.rank > 0 && k.rank <= 30).length;
  const visibilityPct = ((visibilityCount / (totalKeywords || 1)) * 100).toFixed(2);
  
  // Avg. Position
  const avgPosition = rankedKeywords.length > 0
    ? (rankedKeywords.reduce((sum, k) => sum + k.rank, 0) / rankedKeywords.length).toFixed(1)
    : '—';

  // Estimated Traffic using standard CTR curve
  // Pos 1: 30% CTR, Pos 2-3: 15% CTR, Pos 4-10: 4% CTR, Pos 11+: 0.5% CTR
  const estTraffic = Math.round(keywords.reduce((sum, k) => {
    if (!k.rank || k.rank <= 0) return sum;
    const sv = Number(k.sv) || 0;
    if (k.rank === 1) return sum + sv * 0.30;
    if (k.rank <= 3) return sum + sv * 0.15;
    if (k.rank <= 10) return sum + sv * 0.04;
    return sum + sv * 0.005;
  }, 0));

  // 2. Keyword Difficulty Distribution
  const easyCount = keywords.filter(k => k.kwDiff !== null && Number(k.kwDiff) <= 30).length;
  const mediumCount = keywords.filter(k => k.kwDiff !== null && Number(k.kwDiff) > 30 && Number(k.kwDiff) <= 60).length;
  const hardCount = keywords.filter(k => k.kwDiff !== null && Number(k.kwDiff) > 60).length;

  const rankingsDistribution = [
    { range: 'Easy (0-30)', count: easyCount, color: 'var(--green)' },
    { range: 'Medium (31-60)', count: mediumCount, color: 'var(--amber)' },
    { range: 'Hard (61-100)', count: hardCount, color: 'var(--red)' },
  ];
  const maxDist = Math.max(...rankingsDistribution.map(r => r.count), 1);

  // Intent counts
  const intentCounts = {};
  keywords.forEach(k => {
    const intent = k.targetSubtype || 'Informational'; // fallback
    intentCounts[intent] = (intentCounts[intent] || 0) + 1;
  });

  // Clusters count
  const uniqueClustersCount = new Set(keywords.map(k => k.cluster).filter(Boolean)).size;

  // 3. Generate Summary Alerts
  const summaryAlerts = [];
  if (rankedKeywords.length === 0) {
    summaryAlerts.push({
      type: 'warning',
      message: 'Rank tracking has not been executed yet. Go to Project Setup to trigger a search rank check.'
    });
  } else {
    summaryAlerts.push({
      type: 'success',
      message: `Rank tracking is active. Checked ranks for ${rankedKeywords.length} out of ${totalKeywords} keywords.`
    });
  }

  const hardKws = keywords.filter(k => Number(k.kwDiff) > 60).length;
  if (hardKws > totalKeywords * 0.3) {
    summaryAlerts.push({
      type: 'info',
      message: `About ${Math.round(hardKws / totalKeywords * 100)}% of your keywords are High Difficulty. We recommend focusing on medium or easy keywords first.`
    });
  } else {
    summaryAlerts.push({
      type: 'tip',
      message: `Good difficulty profile! A healthy mix of easy and medium keywords are available to target.`
    });
  }

  const unclustered = keywords.filter(k => !k.cluster).length;
  if (unclustered > 0) {
    summaryAlerts.push({
      type: 'warning',
      message: `${unclustered} keywords are pending AI clustering. Trigger clustering in Project Setup.`
    });
  } else {
    summaryAlerts.push({
      type: 'success',
      message: `All keywords are successfully grouped into ${uniqueClustersCount} thematic clusters.`
    });
  }

  // 4. Sorted Keywords (by volume descending)
  const topKeywordsList = [...keywords]
    .sort((a, b) => (Number(b.sv) || 0) - (Number(a.sv) || 0))
    .slice(0, 20);

  // Sparkline data generation (simple placeholder values for visual chart)
  const sparklineData = [12, 14, 13, 16, 18, 17, 21, 23, 22, 25];

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1400 }}>
      {/* Domain header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
            {activeProject.location} · Google · English · Keyword Research Dashboard
          </div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--accent)' }}>
            {activeProject.domain || activeProject.name}
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Badge variant="default">Keywords: {totalKeywords.toLocaleString()}</Badge>
          <Badge variant="info">Clusters: {uniqueClustersCount}</Badge>
        </div>
      </div>

      {/* Metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <MetricCard label="Visibility (Top 30)" value={`${visibilityPct}%`} change={0} potential="Keywords in top 30">
          <SparkLine data={sparklineData} color="#5c4af2" />
        </MetricCard>
        <MetricCard label="Estimated Monthly Traffic" value={estTraffic.toLocaleString()} change={0} potential="CTR-weighted search volume">
          <SparkLine data={sparklineData} color="#16a34a" />
        </MetricCard>
        <MetricCard label="Average Position" value={avgPosition} change={0} potential="For ranked keywords">
          <SparkLine data={sparklineData} color="#d97706" />
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
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800 }}>{totalKeywords}</span>
                <div style={{ fontSize: 12, textAlign: 'right' }}>
                  {Object.entries(intentCounts).slice(0, 2).map(([intent, count]) => (
                    <div key={intent} style={{ color: 'var(--text-muted)' }}>{intent}: {count}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Summary */}
        <Card>
          <CardHeader title="Summary" subtitle={`${activeProject.name} Workspace Status`} />
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
          headers={['Keyword', 'Intent/Type', 'Volume', 'K/D', 'Cluster', 'Rank']}
          rows={topKeywordsList.map(k => [
            <span key="kw" style={{ fontWeight: 500 }}>{k.kw}</span>,
            <Badge key="intent" variant={getIntentVariant(k.targetSubtype || k.type)}>{k.targetSubtype || k.type || '—'}</Badge>,
            <span key="vol" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{(Number(k.sv) || 0).toLocaleString()}</span>,
            <span key="kd" style={{ color: k.kwDiff !== null && k.kwDiff !== '' ? (Number(k.kwDiff) > 60 ? 'var(--red)' : Number(k.kwDiff) > 30 ? 'var(--amber)' : 'var(--green)') : 'var(--text-muted)', fontWeight: 600 }}>
              {k.kwDiff !== null && k.kwDiff !== '' ? k.kwDiff : '—'}
            </span>,
            <span key="cluster" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{k.cluster || '—'}</span>,
            <span key="rank" style={{ fontWeight: 600, color: k.rank ? 'var(--accent)' : 'var(--text-muted)' }}>
              {k.rank ? `#${k.rank}` : '—'}
            </span>,
          ])}
        />
      </Card>
    </div>
  );
}
