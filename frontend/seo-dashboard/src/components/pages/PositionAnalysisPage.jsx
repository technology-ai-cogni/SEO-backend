import { useState } from 'react';
import { Card, CardHeader, MetricCard, Badge, Table } from '../ui/Card';
import { Search, Globe, Loader2, AlertCircle, TrendingUp, Users, Link2, ExternalLink } from 'lucide-react';

const API_BASE = 'http://localhost:8100';

function getIntentVariant(intent) {
  const lower = (intent || '').toLowerCase();
  if (lower.includes('commercial')) return 'accent';
  if (lower.includes('informational')) return 'info';
  if (lower.includes('transactional')) return 'success';
  if (lower.includes('navigational')) return 'warning';
  return 'default';
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

const ENGINE_ICONS = {
  claude: '💬',
  openai: '🟢',
  gemini: '💎',
};

const ENGINE_LABELS = {
  claude: 'ChatGPT',
  openai: 'AI Overview',
  gemini: 'Gemini',
};

export default function PositionAnalysisPage() {
  const [url, setUrl] = useState('');
  const [country, setCountry] = useState('India');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const handleAnalyze = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`${API_BASE}/api/analyze-position`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), country }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e.message || 'Failed to connect to analyzer');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAnalyze();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* ── Search Bar ─────────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '20px 24px', display: 'flex', gap: 12, alignItems: 'center',
      }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--surface-2)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '0 16px', height: 44,
          transition: 'border-color 0.15s',
        }}>
          <Globe size={16} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Enter domain to analyze (e.g. socialoffline.in)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1, border: 'none', background: 'transparent', outline: 'none',
              fontSize: 14, fontFamily: 'var(--font-body)', color: 'var(--text-primary)',
            }}
          />
        </div>

        {/* Country selector */}
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          style={{
            height: 44, padding: '0 14px', borderRadius: 'var(--radius)',
            border: '1px solid var(--border)', background: 'var(--surface-2)',
            fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--text-primary)',
            cursor: 'pointer', outline: 'none', fontWeight: 500,
          }}
        >
          {['India', 'Singapore', 'United States', 'United Kingdom', 'UAE', 'Canada', 'Australia'].map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <button
          onClick={handleAnalyze}
          disabled={loading || !url.trim()}
          style={{
            height: 44, padding: '0 24px', borderRadius: 'var(--radius)',
            border: 'none', background: loading ? 'var(--border)' : 'var(--accent)',
            color: '#fff', fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-body)', display: 'flex', alignItems: 'center', gap: 8,
            transition: 'background 0.15s',
          }}
        >
          {loading ? <Loader2 size={16} className="spin-icon" /> : <Search size={16} />}
          {loading ? 'Analyzing…' : 'Analyze'}
        </button>
      </div>

      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* ── Loading State ──────────────────────────────────────────── */}
        {loading && (
          <Card>
            <div style={{ padding: 48, textAlign: 'center' }}>
              <Loader2 size={32} className="spin-icon" color="var(--accent)" style={{ marginBottom: 16 }} />
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                Analyzing {url}…
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Querying Claude, OpenAI & Gemini in parallel. This takes ~15-30 seconds.
              </div>
            </div>
          </Card>
        )}

        {/* ── Error State ────────────────────────────────────────────── */}
        {error && (
          <Card>
            <div style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 12, color: 'var(--red)' }}>
              <AlertCircle size={20} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Analysis Failed</div>
                <div style={{ fontSize: 13, marginTop: 2 }}>{error}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Make sure the position analyzer is running: <code>python3 -m uvicorn scripts.position_analyzer:app --port 8100</code>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* ── Results ────────────────────────────────────────────────── */}
        {data && !loading && (
          <>
            {/* Domain + disclaimer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                  {data.domain}
                </div>
                <Badge variant="accent">AI-Estimated Data</Badge>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {data.engines_ok}/{data.engines_total} engines responded
                </span>
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 99, padding: '5px 14px', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)',
              }}>
                🌍 {data.country}
              </div>
            </div>

            {/* ── Two-column: AI Search + SEO cards ─────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* AI Search Card */}
              <Card>
                <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Badge variant="accent" style={{ fontSize: 12, padding: '4px 12px' }}>AI Search</Badge>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{data.country}</span>
                </div>
                <div style={{ padding: 20 }}>
                  {/* Top metrics */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 4 }}>AI Visibility</div>
                      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--accent)' }}>
                        {data.ai_search.ai_visibility}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 4 }}>Mentions</div>
                      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                        {data.ai_search.mentions}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 4 }}>Cited Pages</div>
                      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                        {data.ai_search.cited_pages}
                      </div>
                    </div>
                  </div>

                  {/* Per-engine table */}
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {(data.ai_search.per_engine || []).map((eng) => (
                        <tr key={eng.engine} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '8px 0', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                            <span style={{ marginRight: 8 }}>{ENGINE_ICONS[eng.engine] || '⚡'}</span>
                            {eng.label || eng.engine}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: eng.error ? 'var(--red)' : 'var(--text-primary)' }}>
                            {eng.error ? '✗' : eng.mentions}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: eng.error ? 'var(--red)' : 'var(--text-primary)', paddingLeft: 16 }}>
                            {eng.error ? '✗' : eng.cited_pages}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* SEO Card */}
              <Card>
                <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Badge variant="danger" style={{ fontSize: 12, padding: '4px 12px', background: '#fee2e2', color: '#dc2626' }}>SEO</Badge>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Scope: Root Domain</span>
                </div>
                <div style={{ padding: 20 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
                    {/* Authority Score */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 8 }}>Authority Score</div>
                      <div style={{
                        width: 72, height: 72, borderRadius: '50%', margin: '0 auto',
                        border: `4px solid ${data.seo.authority_score >= 50 ? 'var(--green)' : data.seo.authority_score >= 25 ? 'var(--amber)' : 'var(--red)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <span style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                          {data.seo.authority_score}
                        </span>
                      </div>
                    </div>

                    {/* Organic Traffic */}
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 4 }}>Organic Traffic ↓</div>
                      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                        {formatNumber(data.seo.organic_traffic)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginTop: 12, marginBottom: 4 }}>Paid Keywords</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-muted)' }}>0</div>
                    </div>

                    {/* Organic Keywords */}
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 4 }}>Organic Keywords ↓</div>
                      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                        {formatNumber(data.seo.organic_keywords)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginTop: 12, marginBottom: 4 }}>Ref. Domains</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {formatNumber(data.seo.ref_domains)}
                      </div>
                    </div>
                  </div>

                  {/* Backlinks row */}
                  <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Link2 size={14} color="var(--text-muted)" />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>Backlinks:</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{formatNumber(data.seo.backlinks)}</span>
                  </div>
                </div>
              </Card>
            </div>

            {/* ── Position Tracking ─────────────────────────────────── */}
            <Card>
              <CardHeader
                title="Position Tracking"
                subtitle={`${data.country} (Google) · English`}
              />
              <div style={{ padding: 20 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 20 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 6 }}>Visibility</div>
                    <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--accent)' }}>
                      {data.position_summary.visibility_pct}%
                    </div>
                  </div>
                  {[
                    { label: 'Top 3', value: data.position_summary.top_3 },
                    { label: 'Top 10', value: data.position_summary.top_10 },
                    { label: 'Top 20', value: data.position_summary.top_20 },
                    { label: 'Top 100', value: data.position_summary.top_100 },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 6 }}>{label}</div>
                      <div style={{
                        fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)',
                        color: value > 0 ? 'var(--green)' : 'var(--text-muted)',
                      }}>
                        {value}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Top keywords mini-table */}
                {data.keywords.filter(k => k.position <= 10).length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      Top Keywords
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <th style={{ textAlign: 'left', padding: '8px 0', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Keywords</th>
                          <th style={{ textAlign: 'right', padding: '8px 0', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Position</th>
                          <th style={{ textAlign: 'right', padding: '8px 0', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Visibility</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.keywords.filter(k => k.position <= 10).slice(0, 8).map((k, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '8px 0', fontSize: 13, fontWeight: 500, color: 'var(--accent)' }}>{k.keyword}</td>
                            <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{k.position}</td>
                            <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{k.visibility}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Card>

            {/* ── Keyword Difficulty Distribution ────────────────────── */}
            <Card>
              <CardHeader title="Keyword Difficulty Distribution" />
              <div style={{ padding: 20 }}>
                {(() => {
                  const dist = data.kd_distribution;
                  const total = dist.easy + dist.medium + dist.hard + dist.very_hard || 1;
                  const segments = [
                    { label: 'Easy (1-20)', count: dist.easy, color: '#16a34a' },
                    { label: 'Medium (21-40)', count: dist.medium, color: '#2563eb' },
                    { label: 'Hard (41-60)', count: dist.hard, color: '#d97706' },
                    { label: 'Very Hard (61+)', count: dist.very_hard, color: '#dc2626' },
                  ];
                  return (
                    <>
                      <div style={{ display: 'flex', height: 10, borderRadius: 99, overflow: 'hidden', marginBottom: 16 }}>
                        {segments.map((s, i) => (
                          <div key={i} style={{ flex: Math.max(s.count, 0.5), background: s.color }} />
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        {segments.map(s => (
                          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                            {s.label} · <strong style={{ color: 'var(--text-primary)' }}>{s.count}</strong>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </div>
            </Card>

            {/* ── Tracked Keywords Table ─────────────────────────────── */}
            <Card>
              <CardHeader
                title="Tracked Keywords"
                subtitle={`${data.keywords.length} keywords analyzed for ${data.country}`}
              />
              <Table
                headers={['Keyword', 'Intent', 'Est. Position', 'Search Volume', 'K/D', 'Visibility']}
                rows={data.keywords.map(k => [
                  <div key="kw" style={{ fontWeight: 500, fontSize: 13 }}>{k.keyword}</div>,
                  <Badge key="intent" variant={getIntentVariant(k.intent)}>{k.intent || '—'}</Badge>,
                  <span key="pos" style={{ fontWeight: 700, fontSize: 13, color: k.position <= 3 ? 'var(--green)' : k.position <= 10 ? 'var(--accent)' : 'var(--text-primary)' }}>
                    {k.position}
                  </span>,
                  <span key="vol" style={{ fontWeight: 700 }}>{k.search_volume.toLocaleString()}</span>,
                  <span key="kd" style={{
                    color: k.kd > 60 ? 'var(--red)' : k.kd > 30 ? 'var(--amber)' : 'var(--green)',
                    fontWeight: 600, fontSize: 13,
                  }}>
                    {k.kd}
                  </span>,
                  <span key="vis" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{k.visibility}%</span>,
                ])}
              />
            </Card>

            {/* ── Competitors ───────────────────────────────────────── */}
            {data.competitors.length > 0 && (
              <Card>
                <CardHeader title="Competitor Domains" subtitle="Domains competing for similar keywords" />
                <Table
                  headers={['Domain', 'Est. Authority']}
                  rows={data.competitors.map(c => [
                    <div key="d" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ExternalLink size={12} color="var(--text-muted)" />
                      <span style={{ fontWeight: 500, fontSize: 13, color: 'var(--accent)' }}>{c.domain}</span>
                    </div>,
                    <span key="a" style={{
                      fontWeight: 700, fontSize: 13,
                      color: c.authority >= 50 ? 'var(--green)' : c.authority >= 25 ? 'var(--amber)' : 'var(--red)',
                    }}>
                      {c.authority}
                    </span>,
                  ])}
                />
              </Card>
            )}

            {/* ── Engine Errors ──────────────────────────────────────── */}
            {data.errors?.length > 0 && (
              <Card>
                <div style={{ padding: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--red)', marginBottom: 8 }}>Engine Errors</div>
                  {data.errors.map((e, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                      <strong>{e.engine}:</strong> {e.error}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}

        {/* ── Empty State ────────────────────────────────────────────── */}
        {!data && !loading && !error && (
          <Card>
            <div style={{ padding: 64, textAlign: 'center' }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%', background: 'var(--accent-light)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px',
              }}>
                <TrendingUp size={28} color="var(--accent)" />
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)', marginBottom: 6 }}>
                Position Analysis
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
                Enter a domain URL above and click <strong>Analyze</strong> to get AI-powered position tracking.
                We'll query Claude, OpenAI, and Gemini to estimate keyword rankings, visibility, and competitor landscape.
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
