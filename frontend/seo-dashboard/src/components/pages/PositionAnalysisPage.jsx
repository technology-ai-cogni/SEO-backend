import { useState, useEffect } from 'react';
import { ExternalLink, Plus, Share2, Settings, Info, X, CheckCircle, Globe, Monitor } from 'lucide-react';
import { fetchDomainRows, fetchKeywordRows, fetchPageRows } from '../../lib/projectsApi';

export default function PositionAnalysisPage({ onNavigate }) {
  const [projects, setProjects] = useState([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [activeProject, setActiveProject] = useState(null);
  const [kwCount, setKwCount] = useState(650);
  const [pageCount, setPageCount] = useState(150);
  const [aiTab, setAiTab] = useState('Overview');
  const [loading, setLoading] = useState(true);
  const [showReport, setShowReport] = useState(false);

  // Hidden cards state
  const [closedCards, setClosedCards] = useState({});

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        setLoading(true);
        const domains = await fetchDomainRows();
        if (isMounted && domains && domains.length > 0) {
          setProjects(domains);
          const first = domains[0];
          setSelectedSlug(first.slug);
          setActiveProject(first);

          // Fetch project-specific data if present
          try {
            const kws = await fetchKeywordRows(first.slug);
            if (kws && kws.length > 0 && isMounted) {
              setKwCount(kws.length);
            }
            const pgs = await fetchPageRows(first.slug);
            if (pgs && pgs.length > 0 && isMounted) {
              setPageCount(pgs.length);
            }
          } catch (e) {
            // keep fallbacks
          }
        }
      } catch (err) {
        console.error('Error loading projects:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadData();
    return () => { isMounted = false; };
  }, []);

  const handleSelectProject = async (slug) => {
    setSelectedSlug(slug);
    const p = projects.find(item => item.slug === slug);
    if (p) {
      setActiveProject(p);
      try {
        const kws = await fetchKeywordRows(p.slug);
        if (kws && kws.length > 0) setKwCount(kws.length);
        else setKwCount(650);

        const pgs = await fetchPageRows(p.slug);
        if (pgs && pgs.length > 0) setPageCount(pgs.length);
        else setPageCount(150);
      } catch (e) {
        // fallbacks
      }
    }
  };

  const toggleClose = (cardId) => {
    setClosedCards(prev => ({ ...prev, [cardId]: true }));
  };

  const domainDisplay = activeProject?.domain || activeProject?.name || 'ittisa.org';
  const locationDisplay = activeProject?.location || 'India (Google)';

  return (
    <div style={{
      padding: '24px 32px',
      background: 'var(--bg, #f8fafc)',
      minHeight: '100vh',
      fontFamily: 'var(--font-body, system-ui, sans-serif)',
      color: '#1e293b'
    }}>
      {/* ─── HEADER BAR ────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 24,
        flexWrap: 'wrap',
        gap: 16
      }}>
        {/* Left: Domain selector / title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{
            fontFamily: 'var(--font-display, inherit)',
            fontSize: 22,
            fontWeight: 800,
            color: '#0f172a',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            SEO Dashboard:
            {projects.length > 1 ? (
              <select
                value={selectedSlug}
                onChange={(e) => handleSelectProject(e.target.value)}
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  color: '#7c3aed',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit'
                }}
              >
                {projects.map(p => (
                  <option key={p.slug} value={p.slug}>{p.domain || p.name}</option>
                ))}
              </select>
            ) : (
              <span style={{ color: '#7c3aed' }}>{domainDisplay}</span>
            )}
            <a
              href={`https://${domainDisplay}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#7c3aed', display: 'inline-flex', alignItems: 'center' }}
            >
              <ExternalLink size={16} />
            </a>
          </h1>
        </div>

        {/* Right: Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => onNavigate ? onNavigate('project-setup') : (window.location.hash = '#project-setup')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: '#7c3aed',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              padding: '9px 16px',
              fontSize: 13.5,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(124, 58, 237, 0.25)',
              transition: 'background 0.15s'
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#6d28d9'}
            onMouseLeave={e => e.currentTarget.style.background = '#7c3aed'}
          >
            <Plus size={16} />
            Create SEO Project
          </button>
          
          <button
            onClick={() => navigator.clipboard.writeText(window.location.href)}
            style={{
              background: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <Share2 size={14} />
            Share
          </button>

          <button
            style={{
              background: '#ffffff',
              color: '#64748b',
              border: '1px solid #cbd5e1',
              borderRadius: 8,
              padding: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* ─── TOP ROW: AI SEARCH & SEO CARDS ────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))',
        gap: 20,
        marginBottom: 20
      }}>
        {/* CARD 1: AI SEARCH */}
        {!closedCards.aiSearch && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}>
            {/* Card Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{
                background: '#f3e8ff',
                color: '#7c3aed',
                fontSize: 11,
                fontWeight: 800,
                padding: '3px 10px',
                borderRadius: 6,
                letterSpacing: '0.5px'
              }}>
                AI SEARCH
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
                <span>🇺🇸 United States</span>
                <X size={14} style={{ cursor: 'pointer' }} onClick={() => toggleClose('aiSearch')} />
              </div>
            </div>

            {/* Sub-nav tabs */}
            <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #f1f5f9', pb: 10 }}>
              {['Overview', 'ChatGPT', 'Gemini', 'AI Mode', 'AI Overview'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setAiTab(tab)}
                  style={{
                    background: aiTab === tab ? '#ede9fe' : 'transparent',
                    color: aiTab === tab ? '#7c3aed' : '#64748b',
                    fontWeight: aiTab === tab ? 700 : 500,
                    fontSize: 13,
                    border: 'none',
                    borderRadius: 6,
                    padding: '5px 12px',
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Content Body */}
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 24, alignItems: 'center' }}>
              {/* Left Meter */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                <div style={{ position: 'relative', width: 110, height: 60, display: 'flex', justifyContent: 'center' }}>
                  <svg width="110" height="60" viewBox="0 0 110 60">
                    <path
                      d="M 10 55 A 45 45 0 0 1 100 55"
                      fill="none"
                      stroke="#e2e8f0"
                      strokeWidth="10"
                      strokeLinecap="round"
                    />
                    <path
                      d="M 10 55 A 45 45 0 0 1 75 20"
                      fill="none"
                      stroke="#7c3aed"
                      strokeWidth="10"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div style={{ position: 'absolute', bottom: 0, textAlign: 'center' }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>18</span>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600, marginTop: 4 }}>AI Visibility</div>

                <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#7c3aed' }}>7</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>Mentions</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#7c3aed' }}>38</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>Cited pages</div>
                  </div>
                </div>
              </div>

              {/* Right Table List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { name: 'ChatGPT', val1: 0, val2: 17 },
                  { name: 'AI Overview', val1: 1, val2: 15 },
                  { name: 'AI Mode', val1: 2, val2: 20 },
                  { name: 'Gemini', val1: 4, val2: 9 },
                ].map(row => (
                  <div
                    key={row.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 13,
                      color: '#334155',
                      fontWeight: 500,
                      padding: '4px 0'
                    }}
                  >
                    <span>{row.name}</span>
                    <div style={{ display: 'flex', gap: 24 }}>
                      <span style={{ fontWeight: 700, color: '#0f172a', width: 14, textAlign: 'right' }}>{row.val1}</span>
                      <span style={{ fontWeight: 700, color: '#7c3aed', width: 20, textAlign: 'right' }}>{row.val2}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* CARD 2: SEO */}
        {!closedCards.seoCard && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: 20
          }}>
            {/* Card Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{
                background: '#e0f2fe',
                color: '#0284c7',
                fontSize: 11,
                fontWeight: 800,
                padding: '3px 10px',
                borderRadius: 6,
                letterSpacing: '0.5px'
              }}>
                SEO
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
                <span>🇺🇸 US 💻 Desktop Jul 12, 2026</span>
                <X size={14} style={{ cursor: 'pointer' }} onClick={() => toggleClose('seoCard')} />
              </div>
            </div>

            {/* 5 Column Metrics */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 12,
              paddingTop: 10
            }}>
              {/* Metric 1 */}
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 6 }}>Authority Score</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 800
                  }}>S</div>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>19</span>
                </div>
                <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 4 }}>Semrush: 2.4M</div>
              </div>

              {/* Metric 2 */}
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 6 }}>Organic Traffic</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>261</div>
                <div style={{ fontSize: 10.5, color: '#16a34a', fontWeight: 700, marginTop: 4 }}>+96.24%</div>
              </div>

              {/* Metric 3 */}
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 6 }}>Org. Keywords</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{kwCount}</div>
                <div style={{ fontSize: 10.5, color: '#16a34a', fontWeight: 700, marginTop: 4 }}>+28.46%</div>
              </div>

              {/* Metric 4 */}
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 6 }}>Paid Keywords</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>0</div>
                <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 4 }}>0%</div>
              </div>

              {/* Metric 5 */}
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 6 }}>Ref. Domains</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>426</div>
                <div style={{ fontSize: 10.5, color: '#16a34a', fontWeight: 700, marginTop: 4 }}>+1.91%</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── MIDDLE ROW: POSITION TRACKING & SITE AUDIT ────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))',
        gap: 20,
        marginBottom: 20
      }}>
        {/* CARD 3: Position Tracking */}
        {!closedCards.posTracking && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>Position Tracking</span>
                <Info size={14} color="#94a3b8" />
              </div>
              <X size={14} style={{ cursor: 'pointer', color: '#94a3b8' }} onClick={() => toggleClose('posTracking')} />
            </div>

            <div style={{ fontSize: 12, color: '#64748b' }}>
              {locationDisplay} · English
            </div>

            {/* Dashed status box */}
            <div style={{
              background: '#f8fafc',
              border: '1.5px dashed #c084fc',
              borderRadius: 10,
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: '#7c3aed',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  ✓
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Rank Audit Complete</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    Ranks successfully generated for all {kwCount} keywords.
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowReport(true)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#7c3aed',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                View Report
              </button>
            </div>
          </div>
        )}

        {/* CARD 4: Site Audit */}
        {!closedCards.siteAudit && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>Site Audit</span>
                <Info size={14} color="#94a3b8" />
              </div>
              <X size={14} style={{ cursor: 'pointer', color: '#94a3b8' }} onClick={() => toggleClose('siteAudit')} />
            </div>

            <div style={{ fontSize: 12, color: '#64748b' }}>
              Project Scope: Root Domain
            </div>

            {/* Score Ring & Stats */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 6
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {/* Circular donut indicator */}
                <div style={{
                  position: 'relative',
                  width: 54,
                  height: 54,
                  borderRadius: '50%',
                  background: 'conic-gradient(#7c3aed 82%, #e2e8f0 0)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <div style={{
                    width: 42,
                    height: 42,
                    borderRadius: '50%',
                    background: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    fontWeight: 800,
                    color: '#0f172a'
                  }}>
                    82%
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Site Health Score</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    crawled {pageCount}/{pageCount} pages.
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 13, fontWeight: 700, color: '#16a34a' }}>
                Healthy
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── BOTTOM ROW: ON-PAGE, BACKLINK & ORGANIC TRAFFIC INSIGHTS CARDS ─────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: 20
      }}>
        {/* CARD 5: On Page SEO Checker */}
        {!closedCards.onPage && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 16,
            minHeight: 140
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>On Page SEO Checker</span>
                  <Info size={14} color="#94a3b8" />
                </div>
                <X size={14} style={{ cursor: 'pointer', color: '#94a3b8' }} onClick={() => toggleClose('onPage')} />
              </div>
              <p style={{ fontSize: 12.5, color: '#64748b', margin: 0, lineHeight: 1.4 }}>
                Collect ideas on strategy, content, backlinks and more.
              </p>
            </div>
            <div>
              <button style={{
                background: '#f1f5f9',
                color: '#334155',
                border: 'none',
                borderRadius: 6,
                padding: '6px 14px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer'
              }}>
                Set up
              </button>
            </div>
          </div>
        )}

        {/* CARD 6: Backlink Audit */}
        {!closedCards.backlink && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 16,
            minHeight: 140
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Backlink Audit</span>
                  <Info size={14} color="#94a3b8" />
                </div>
                <X size={14} style={{ cursor: 'pointer', color: '#94a3b8' }} onClick={() => toggleClose('backlink')} />
              </div>
              <p style={{ fontSize: 12.5, color: '#64748b', margin: 0, lineHeight: 1.4 }}>
                Detoxify your backlink portfolio and strengthen your website rankings.
              </p>
            </div>
            <div>
              <button style={{
                background: '#f1f5f9',
                color: '#334155',
                border: 'none',
                borderRadius: 6,
                padding: '6px 14px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer'
              }}>
                Set up
              </button>
            </div>
          </div>
        )}

        {/* CARD 7: Organic Traffic Insights */}
        {!closedCards.organicTraffic && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 16,
            minHeight: 140
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Organic Traffic Insights</span>
                  <Info size={14} color="#94a3b8" />
                </div>
                <X size={14} style={{ cursor: 'pointer', color: '#94a3b8' }} onClick={() => toggleClose('organicTraffic')} />
              </div>
              <p style={{ fontSize: 12.5, color: '#64748b', margin: 0, lineHeight: 1.4 }}>
                Uncover "not provided" keywords combining GA, GSC and Semrush data.
              </p>
            </div>
            <div>
              <button style={{
                background: '#f1f5f9',
                color: '#334155',
                border: 'none',
                borderRadius: 6,
                padding: '6px 14px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer'
              }}>
                Set up
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── MODAL REPORT VIEW (Triggered by View Report) ────────────────────────── */}
      {showReport && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.5)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 16,
            width: '100%',
            maxWidth: 640,
            padding: 24,
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle color="#7c3aed" size={20} />
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                  Rank Audit Summary ({domainDisplay})
                </h3>
              </div>
              <X size={18} style={{ cursor: 'pointer' }} onClick={() => setShowReport(false)} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13.5, color: '#334155' }}>
              <p style={{ margin: 0 }}>
                Position tracking analysis was successfully generated for <strong>{domainDisplay}</strong> ({locationDisplay}).
              </p>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span>Total Tracked Keywords:</span>
                  <strong>{kwCount}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span>Crawled Site Pages:</span>
                  <strong>{pageCount}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Location Target:</span>
                  <strong>{locationDisplay}</strong>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                onClick={() => setShowReport(false)}
                style={{
                  background: '#7c3aed',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 18px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
