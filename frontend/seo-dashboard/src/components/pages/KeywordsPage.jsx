import { useState, useEffect } from 'react';
import { Search, ChevronDown, ExternalLink, Download, KeyRound, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchDomainRows, fetchKeywordRows } from '../../lib/projectsApi';
import { canDownload } from '../../lib/permissions';

// MultiSelectField Component for Popover Filters
function MultiSelectField({ label, options, selectedValues = [], onChange }) {
  const [open, setOpen] = useState(false);
  const isAll = !selectedValues || selectedValues.length === 0;

  const toggleOption = (val) => {
    if (selectedValues.includes(val)) {
      onChange(selectedValues.filter(v => v !== val));
    } else {
      onChange([...selectedValues, val]);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 }}>
        {label} {selectedValues.length > 0 && <span style={{ color: '#7c3aed', fontWeight: 800 }}>({selectedValues.length})</span>}
      </label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          fontSize: 12,
          padding: '6px 10px',
          borderRadius: 6,
          border: selectedValues.length > 0 ? '1px solid #7c3aed' : '1px solid #cbd5e1',
          background: selectedValues.length > 0 ? '#f5f3ff' : '#ffffff',
          color: selectedValues.length > 0 ? '#7c3aed' : '#334155',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontWeight: selectedValues.length > 0 ? 700 : 500
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isAll ? `All ${label}s` : selectedValues.join(', ')}
        </span>
        <ChevronDown size={14} color="#64748b" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '105%',
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          zIndex: 200,
          padding: 6,
          maxHeight: 180,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 2
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 6px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, background: isAll ? '#f1f5f9' : 'transparent', color: isAll ? '#7c3aed' : '#475569' }}>
            <input
              type="checkbox"
              checked={isAll}
              onChange={() => onChange([])}
              style={{ accentColor: '#7c3aed' }}
            />
            All {label}s
          </label>
          {options.map(opt => {
            const isChecked = selectedValues.includes(opt);
            return (
              <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 6px', borderRadius: 4, cursor: 'pointer', background: isChecked ? '#f5f3ff' : 'transparent', color: isChecked ? '#7c3aed' : '#0f172a', fontWeight: isChecked ? 600 : 400 }}>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleOption(opt)}
                  style={{ accentColor: '#7c3aed' }}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ColumnHeaderFilter Component for Pill-Style Single Select Header Dropdown
function ColumnHeaderFilter({ title, options = [], selectedValues, onChange }) {
  const currentValue = Array.isArray(selectedValues)
    ? (selectedValues.length === 1 ? selectedValues[0] : (selectedValues.length > 1 ? selectedValues[0] : 'all'))
    : (selectedValues || 'all');

  return (
    <th style={{ padding: '8px 12px', fontWeight: 600 }}>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <select
          value={currentValue}
          onChange={(e) => {
            const val = e.target.value;
            onChange(val === 'all' ? [] : [val]);
          }}
          style={{
            padding: '6px 28px 6px 12px',
            borderRadius: 10,
            border: currentValue !== 'all' ? '1px solid #7c3aed' : '1px solid #e2e8f0',
            background: currentValue !== 'all' ? '#f5f3ff' : '#ffffff',
            color: currentValue !== 'all' ? '#7c3aed' : '#64748b',
            fontSize: 12,
            fontWeight: 600,
            outline: 'none',
            cursor: 'pointer',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            appearance: 'none',
            WebkitAppearance: 'none',
            MozAppearance: 'none'
          }}
        >
          <option value="all">{title}</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <ChevronDown
          size={13}
          color={currentValue !== 'all' ? '#7c3aed' : '#94a3b8'}
          style={{
            position: 'absolute',
            right: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none'
          }}
        />
      </div>
    </th>
  );
}

export default function KeywordsPage({ user }) {
  const userCanDownload = canDownload(user);
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [keywordsData, setKeywordsData] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRows, setSelectedRows] = useState([]);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 100;

  // Filter List Popover State & Options
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [columnFilters, setColumnFilters] = useState({
    cluster: [],
    category: [],
    type: [],
    targetType: [],
    targetSubtype: [],
    targetGeo: [],
    priority: []
  });

  // Region and date state
  const [selectedRegion, setSelectedRegion] = useState('IN');
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [selectedDate, setSelectedDate] = useState('2026-08-13');

  const COUNTRY_OPTIONS = [
    { code: 'IN', name: 'India' },
    { code: 'US', name: 'United States' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'CA', name: 'Canada' },
    { code: 'AU', name: 'Australia' },
    { code: 'AE', name: 'UAE' },
    { code: 'SG', name: 'Singapore' },
    { code: 'DE', name: 'Germany' },
    { code: 'FR', name: 'France' }
  ];

  const hasActiveFilters = Object.values(columnFilters).some(v => Array.isArray(v) ? v.length > 0 : v !== 'all');

  const resetAllFilters = () => {
    setColumnFilters({
      cluster: [],
      category: [],
      type: [],
      targetType: [],
      targetSubtype: [],
      targetGeo: [],
      priority: []
    });
  };

  // Load active projects on mount
  useEffect(() => {
    let isMounted = true;
    async function loadProjects() {
      try {
        setLoading(true);
        const domains = await fetchDomainRows();
        if (isMounted && domains && domains.length > 0) {
          setProjects(domains);
          const savedSlug = localStorage.getItem('bd_selected_project');
          const target = (savedSlug && domains.find(p => p.slug === savedSlug)) || domains[0];
          setActiveProject(target);
          await loadKeywordDataForProject(target);
        }
      } catch (err) {
        console.error('[KeywordsPage] Error loading projects:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadProjects();
    return () => { isMounted = false; };
  }, []);

  // Fetch keywords for active project
  const loadKeywordDataForProject = async (proj) => {
    if (!proj?.slug) return;
    try {
      setLoading(true);
      const fetchedKws = await fetchKeywordRows(proj.slug).catch(() => []);
      const normalizedKws = (fetchedKws || []).map((k, idx) => {
        const rawSv = Number(String(k.sv || k.search_volume || k.volume || 0).replace(/[^0-9.]/g, '')) || 0;
        const rawKd = Number(String(k.kd || k.kw_diff || k.difficulty || 0).replace(/[^0-9.]/g, '')) || null;
        const rawRank = Number(k.rank || k.position || k.rank_pos || k.intentRank || 0) || 0;

        return {
          id: k.id || `kw-${idx}`,
          kw: k.kw || k.keyword || k.name || 'Keyword',
          sv: rawSv,
          kd: rawKd,
          cluster: k.cluster || k.group || 'General',
          category: k.category || k.cat || 'General',
          type: k.type || k.intent || k.search_intent || 'Informational',
          targetType: k.targetType || k.target_type || k.page_type || 'Landing Page',
          targetSubtype: k.targetSubtype || k.target_category || k.targetCategory || k.subtype || 'Informational',
          targetGeo: k.targetGeo || k.geo || k.country || proj.country || 'India',
          priority: k.priority || k.prio || 'Medium',
          landingPage: k.landingPage || k.url || k.landing_page || '',
          rank: rawRank
        };
      });

      setKeywordsData(normalizedKws);
      setSelectedRows([]);
    } catch (err) {
      console.error('[KeywordsPage] Error loading keywords data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Handle Project Switch
  const handleSelectProject = async (proj) => {
    setActiveProject(proj);
    localStorage.setItem('bd_selected_project', proj.slug);
    setProjectMenuOpen(false);
    await loadKeywordDataForProject(proj);
  };

  // Unique values for dropdown filters
  const uniqueClusters = Array.from(new Set(keywordsData.map(k => k.cluster).filter(Boolean))).sort();
  const uniqueCategories = Array.from(new Set(keywordsData.map(k => k.category).filter(Boolean))).sort();
  const uniqueTypes = Array.from(new Set(keywordsData.map(k => k.type).filter(Boolean))).sort();
  const uniqueTargetTypes = Array.from(new Set(keywordsData.map(k => k.targetType).filter(Boolean))).sort();
  const uniqueTargetSubtypes = Array.from(new Set(keywordsData.map(k => k.targetSubtype).filter(Boolean))).sort();
  const uniqueTargetGeos = Array.from(new Set(keywordsData.map(k => k.targetGeo).filter(Boolean))).sort();
  const uniquePriorities = Array.from(new Set(keywordsData.map(k => k.priority).filter(Boolean))).sort();

  // Filtered rows based on Search and Column Dropdown Filters
  const filteredKeywords = keywordsData.filter(k => {
    const matchSearch = searchQuery === '' ||
      k.kw.toLowerCase().includes(searchQuery.toLowerCase()) ||
      k.cluster.toLowerCase().includes(searchQuery.toLowerCase()) ||
      k.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      k.landingPage.toLowerCase().includes(searchQuery.toLowerCase());

    const matchCluster = !columnFilters.cluster || columnFilters.cluster.length === 0 || columnFilters.cluster.includes(k.cluster);
    const matchCategory = !columnFilters.category || columnFilters.category.length === 0 || columnFilters.category.includes(k.category);
    const matchType = !columnFilters.type || columnFilters.type.length === 0 || columnFilters.type.includes(k.type);
    const matchTargetType = !columnFilters.targetType || columnFilters.targetType.length === 0 || columnFilters.targetType.includes(k.targetType);
    const matchTargetSubtype = !columnFilters.targetSubtype || columnFilters.targetSubtype.length === 0 || columnFilters.targetSubtype.includes(k.targetSubtype);
    const matchTargetGeo = !columnFilters.targetGeo || columnFilters.targetGeo.length === 0 || columnFilters.targetGeo.includes(k.targetGeo);
    const matchPriority = !columnFilters.priority || columnFilters.priority.length === 0 || columnFilters.priority.includes(k.priority);

    return matchSearch && matchCluster && matchCategory && matchType && matchTargetType && matchTargetSubtype && matchTargetGeo && matchPriority;
  });

  const pageCount = Math.max(1, Math.ceil(filteredKeywords.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedKeywords = filteredKeywords.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Calculate Metrics
  const totalKeywordsCount = keywordsData.length;

  // Calculate Rank Buckets (Top 1, Top 3, Top 10)
  const top1Count = keywordsData.filter(k => k.rank === 1).length;
  const top3Count = keywordsData.filter(k => k.rank > 0 && k.rank <= 3).length;
  const top10Count = keywordsData.filter(k => k.rank > 0 && k.rank <= 10).length;

  // Calculate Unique Landing Pages
  const totalPagesCount = new Set(keywordsData.map(k => k.landingPage).filter(Boolean)).size;

  // Calculate Average Volume
  const totalVolumeSum = keywordsData.reduce((acc, k) => acc + (k.sv || 0), 0);
  const avgVolume = keywordsData.length > 0 ? Math.round(totalVolumeSum / keywordsData.length) : 0;

  // Checkbox handlers
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedRows(filteredKeywords.map(k => k.id));
    } else {
      setSelectedRows([]);
    }
  };

  const handleSelectRow = (id) => {
    setSelectedRows(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Export CSV Handler
  const handleExportCSV = () => {
    if (!filteredKeywords || filteredKeywords.length === 0) return;
    const headers = ['Keyword', 'Rank', 'Search Volume', 'KW Diff', 'Cluster', 'Category', 'Type', 'Target Type', 'Target Subtype', 'Target Geo', 'Priority', 'Landing Page'];
    const rows = filteredKeywords.map(k => [
      `"${k.kw || ''}"`,
      k.rank || '',
      k.sv || 0,
      k.kd || '',
      `"${k.cluster || ''}"`,
      `"${k.category || ''}"`,
      `"${k.type || ''}"`,
      `"${k.targetType || ''}"`,
      `"${k.targetSubtype || ''}"`,
      `"${k.targetGeo || ''}"`,
      `"${k.priority || ''}"`,
      `"${k.landingPage || ''}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `keywords_${activeProject?.slug || 'export'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, background: '#f8fafc', minHeight: '100vh' }}>

      {/* ─── HEADER BAR: Dashboard: domain.com v [Link] 🇮🇳 India v 📅 Date ───── */}
      {(() => {
        const currentDomainDisplay = activeProject?.domain || activeProject?.name || 'Select Domain';
        const activeCountry = COUNTRY_OPTIONS.find(c => c.code === selectedRegion) || COUNTRY_OPTIONS[0];
        const filteredCountries = COUNTRY_OPTIONS.filter(c =>
          c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
          c.code.toLowerCase().includes(countrySearch.toLowerCase())
        );

        return (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            background: '#ffffff',
            padding: '16px 20px',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
          }}>
            {/* Left Side: Dashboard: domain.com v */}
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <h1 style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
                fontSize: 20,
                fontWeight: 800,
                color: '#0f172a',
                margin: 0
              }}>
                <span>Project:</span>
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <button
                    onClick={() => setProjectMenuOpen(!projectMenuOpen)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      fontSize: 20,
                      fontWeight: 800,
                      color: '#7c3aed',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    {currentDomainDisplay}
                    <ChevronDown size={18} style={{ transform: projectMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                  </button>

                  {projectMenuOpen && (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      marginTop: 6,
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: 8,
                      boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
                      zIndex: 1000,
                      minWidth: 200,
                      padding: '4px 0',
                      display: 'flex',
                      flexDirection: 'column'
                    }}>
                      {projects.map(p => (
                        <button
                          key={p.slug}
                          onClick={() => handleSelectProject(p)}
                          style={{
                            padding: '8px 14px',
                            fontSize: 13.5,
                            fontWeight: activeProject?.slug === p.slug ? 700 : 500,
                            color: activeProject?.slug === p.slug ? '#7c3aed' : '#1e293b',
                            backgroundColor: activeProject?.slug === p.slug ? '#f5f3ff' : 'transparent',
                            border: 'none',
                            textAlign: 'left',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            transition: 'background 0.12s'
                          }}
                        >
                          {p.domain || p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <a
                  href={`https://${currentDomainDisplay}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#7c3aed', display: 'inline-flex', alignItems: 'center', marginLeft: 4 }}
                >
                  <ExternalLink size={16} />
                </a>
              </h1>
            </div>

            {/* Right Side: Country Selector & Date Picker */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 12,
              fontSize: 13,
              color: '#64748b',
              fontWeight: 500
            }}>
              {/* Country Selector */}
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <button
                  onClick={() => {
                    setCountryMenuOpen(!countryMenuOpen);
                    setCountrySearch('');
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#2563eb',
                    cursor: 'pointer',
                    outline: 'none',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <img
                    src={`https://flagcdn.com/16x12/${activeCountry.code.toLowerCase()}.png`}
                    width="16"
                    height="12"
                    alt={activeCountry.name}
                    style={{ borderRadius: 1.5, objectFit: 'cover' }}
                  />
                  <span style={{ textDecoration: 'underline', textUnderlineOffset: '3px' }}>{activeCountry.name}</span>
                  <ChevronDown size={14} style={{ color: '#2563eb', transform: countryMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                </button>

                {countryMenuOpen && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 6,
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 10,
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08)',
                    zIndex: 1000,
                    width: 220,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                  }}>
                    <div style={{ padding: '8px 8px 6px 8px', borderBottom: '1px solid #f1f5f9' }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background: '#ffffff',
                        border: '1.5px solid #818cf8',
                        borderRadius: 8,
                        padding: '4px 8px'
                      }}>
                        <Search size={14} style={{ color: '#64748b' }} />
                        <input
                          type="text"
                          placeholder="Search"
                          value={countrySearch}
                          onChange={e => setCountrySearch(e.target.value)}
                          autoFocus
                          style={{
                            border: 'none',
                            outline: 'none',
                            background: 'transparent',
                            fontSize: 12.5,
                            fontWeight: 500,
                            color: '#0f172a',
                            width: '100%'
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ overflowY: 'auto', maxHeight: 210, padding: '4px 0' }}>
                      {filteredCountries.map((c) => (
                        <button
                          key={c.code}
                          onClick={() => {
                            setSelectedRegion(c.code);
                            setCountryMenuOpen(false);
                          }}
                          style={{
                            width: '100%',
                            padding: '7px 12px',
                            fontSize: 13,
                            fontWeight: c.code === selectedRegion ? 700 : 500,
                            color: '#0f172a',
                            backgroundColor: c.code === selectedRegion ? '#eff6ff' : 'transparent',
                            border: 'none',
                            textAlign: 'left',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10
                          }}
                        >
                          <img
                            src={`https://flagcdn.com/16x12/${c.code.toLowerCase()}.png`}
                            width="16"
                            height="12"
                            alt={c.name}
                            style={{ borderRadius: 1.5, objectFit: 'cover' }}
                          />
                          <span>{c.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Date Picker Button */}
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <button
                  onClick={() => {
                    const hiddenInput = document.getElementById('kw_header_date_picker');
                    if (hiddenInput) hiddenInput.showPicker ? hiddenInput.showPicker() : hiddenInput.click();
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#2563eb',
                    cursor: 'pointer',
                    outline: 'none',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <span>📅</span>
                  <span style={{ textDecoration: 'underline', textUnderlineOffset: '3px' }}>
                    {new Date(selectedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </button>
                <input
                  id="kw_header_date_picker"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
                />
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── SUMMARY CARDS GRID (4 Cards) ─────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>

        {/* CARD 1: Total Keywords */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          padding: '16px 20px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center'
        }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>Total Keywords</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>{totalKeywordsCount.toLocaleString()}</div>
        </div>

        {/* CARD 2: Ranks (Top 1, Top 3, Top 10) Column/Row-wise Layout */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          padding: '14px 20px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>
            Top Keywords in Ranks
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Top 1</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: '#16a34a' }}>{top1Count}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid #e2e8f0', paddingLeft: 8 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Top 3</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: '#eab308' }}>{top3Count}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid #e2e8f0', paddingLeft: 8 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Top 10</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: '#7c3aed' }}>{top10Count}</span>
            </div>
          </div>
        </div>

        {/* CARD 3: Total Pages */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          padding: '16px 20px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center'
        }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>Total Pages</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>{totalPagesCount.toLocaleString()}</div>
        </div>

        {/* CARD 4: Avg. Volume */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          padding: '16px 20px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center'
        }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>Avg. Volume</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>{avgVolume.toLocaleString()}</div>
        </div>

      </div>

      {/* ─── SEARCH & ACTION BAR WITH FILTER LIST POPUP ───────────────────── */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap'
      }}>
          {/* Search Box */}
          <div style={{ position: 'relative', flex: 1, maxWidth: 280 }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="text"
              placeholder="Search keywords, cluster, category, landing page..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 14px 9px 36px',
                fontSize: 13,
                borderRadius: 12,
                border: '1.5px solid #e2e8f0',
                background: '#f8fafc',
                outline: 'none',
                color: '#0f172a'
              }}
            />
          </div>

          {/* Download CSV Button */}
          {userCanDownload && (
            <button
              onClick={handleExportCSV}
              title="Export CSV Data"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#f8fafc',
                color: '#64748b',
                border: '1.5px solid #e2e8f0',
                borderRadius: 12,
                padding: '9px 14px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#334155'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.color = '#64748b'; }}
            >
              <Download size={16} />
            </button>
          )}

          {/* Filter List Popover Button */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setFilterMenuOpen(!filterMenuOpen)}
              title="Filter List"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                background: hasActiveFilters ? '#f5f3ff' : '#f8fafc',
                color: hasActiveFilters ? '#7c3aed' : '#64748b',
                border: hasActiveFilters ? '1.5px solid #7c3aed' : '1.5px solid #e2e8f0',
                borderRadius: 12,
                padding: '9px 14px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => {
                if (!hasActiveFilters) { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#334155'; }
              }}
              onMouseLeave={e => {
                if (!hasActiveFilters) { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.color = '#64748b'; }
              }}
            >
              <Filter size={16} />
            </button>

            {/* Filter List Dropdown Panel */}
            {filterMenuOpen && (
              <div style={{
                position: 'absolute',
                right: 0,
                top: '110%',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
                zIndex: 100,
                padding: 16,
                width: 320,
                display: 'flex',
                flexDirection: 'column',
                gap: 12
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Filter Keywords</span>
                  {hasActiveFilters && (
                    <button
                      onClick={resetAllFilters}
                      style={{ fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                    >
                      Reset All
                    </button>
                  )}
                </div>

                {/* Filter Options Grid */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 300, overflowY: 'auto', paddingRight: 4 }}>
                  {/* Cluster */}
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 }}>CLUSTER</label>
                    <select
                      value={columnFilters.cluster}
                      onChange={e => setColumnFilters({ ...columnFilters, cluster: e.target.value })}
                      style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', outline: 'none' }}
                    >
                      <option value="all">All Clusters</option>
                      {uniqueClusters.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                  {/* Category */}
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 }}>CATEGORY</label>
                    <select
                      value={columnFilters.category}
                      onChange={e => setColumnFilters({ ...columnFilters, category: e.target.value })}
                      style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', outline: 'none' }}
                    >
                      <option value="all">All Categories</option>
                      {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                  {/* Type */}
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 }}>TYPE</label>
                    <select
                      value={columnFilters.type}
                      onChange={e => setColumnFilters({ ...columnFilters, type: e.target.value })}
                      style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', outline: 'none' }}
                    >
                      <option value="all">All Types</option>
                      {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>

                  {/* Target Type */}
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 }}>TARGET TYPE</label>
                    <select
                      value={columnFilters.targetType}
                      onChange={e => setColumnFilters({ ...columnFilters, targetType: e.target.value })}
                      style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', outline: 'none' }}
                    >
                      <option value="all">All Target Types</option>
                      {uniqueTargetTypes.map(tt => <option key={tt} value={tt}>{tt}</option>)}
                    </select>
                  </div>

                  {/* Target Subtype */}
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 }}>TARGET SUBTYPE</label>
                    <select
                      value={columnFilters.targetSubtype}
                      onChange={e => setColumnFilters({ ...columnFilters, targetSubtype: e.target.value })}
                      style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', outline: 'none' }}
                    >
                      <option value="all">All Subtypes</option>
                      {uniqueTargetSubtypes.map(ts => <option key={ts} value={ts}>{ts}</option>)}
                    </select>
                  </div>

                  {/* Target Geo */}
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 }}>TARGET GEO</label>
                    <select
                      value={columnFilters.targetGeo}
                      onChange={e => setColumnFilters({ ...columnFilters, targetGeo: e.target.value })}
                      style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', outline: 'none' }}
                    >
                      <option value="all">All Geos</option>
                      {uniqueTargetGeos.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>

                  {/* Priority */}
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 }}>PRIORITY</label>
                    <select
                      value={columnFilters.priority}
                      onChange={e => setColumnFilters({ ...columnFilters, priority: e.target.value })}
                      style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', outline: 'none' }}
                    >
                      <option value="all">All Priorities</option>
                      {uniquePriorities.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>

                <button
                  onClick={() => setFilterMenuOpen(false)}
                  style={{
                    width: '100%',
                    padding: '6px',
                    fontSize: 12,
                    fontWeight: 700,
                    color: '#ffffff',
                    background: '#7c3aed',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    marginTop: 4
                  }}
                >
                  Close
                </button>
              </div>
            )}
          </div>
      </div>

      {/* ─── KEYWORDS DATA TABLE ───────────────────────────────────────────── */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>

                {/* CHECKBOX */}
                <th style={{ padding: '12px 14px', width: 36, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    onChange={handleSelectAll}
                    checked={selectedRows.length === filteredKeywords.length && filteredKeywords.length > 0}
                    style={{ cursor: 'pointer' }}
                  />
                </th>

                <th style={{ padding: '12px 14px', fontWeight: 700 }}>KW</th>
                <th style={{ padding: '12px 14px', fontWeight: 700 }}>RANK</th>
                <th style={{ padding: '12px 14px', fontWeight: 700 }}>SV</th>
                <th style={{ padding: '12px 14px', fontWeight: 700 }}>KW DIFF</th>
                <th style={{ padding: '12px 14px', fontWeight: 700 }}>CLUSTER</th>
                <th style={{ padding: '12px 14px', fontWeight: 700 }}>CATEGORY</th>
                <ColumnHeaderFilter
                  title="Type"
                  options={uniqueTypes}
                  selectedValues={columnFilters.type}
                  onChange={val => setColumnFilters({ ...columnFilters, type: val })}
                />
                <ColumnHeaderFilter
                  title="Target Type"
                  options={uniqueTargetTypes}
                  selectedValues={columnFilters.targetType}
                  onChange={val => setColumnFilters({ ...columnFilters, targetType: val })}
                />
                <ColumnHeaderFilter
                  title="Target Subtype"
                  options={uniqueTargetSubtypes}
                  selectedValues={columnFilters.targetSubtype}
                  onChange={val => setColumnFilters({ ...columnFilters, targetSubtype: val })}
                />
                <th style={{ padding: '12px 14px', fontWeight: 700 }}>TARGET GEO</th>
                <th style={{ padding: '12px 14px', fontWeight: 700 }}>PRIORITY</th>
                <th style={{ padding: '12px 14px', fontWeight: 700 }}>LANDING PAGE</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={13} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
                    Loading keywords for {activeProject?.domain || activeProject?.name}...
                  </td>
                </tr>
              ) : filteredKeywords.length === 0 ? (
                <tr>
                  <td colSpan={13} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
                    No matching keywords found under Project Setup for {activeProject?.domain || activeProject?.name}.
                  </td>
                </tr>
              ) : (
                pagedKeywords.map(row => (
                  <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9', background: selectedRows.includes(row.id) ? '#f5f3ff' : 'transparent', whiteSpace: 'nowrap' }}>

                    {/* CHECKBOX */}
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedRows.includes(row.id)}
                        onChange={() => handleSelectRow(row.id)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>

                    {/* KW */}
                    <td style={{ padding: '12px 14px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>
                      {row.kw}
                    </td>

                    {/* RANK */}
                    <td style={{ padding: '12px 14px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
                      {row.rank > 0 ? row.rank : <span style={{ color: '#94a3b8', fontWeight: 400 }}>—</span>}
                    </td>

                    {/* SV */}
                    <td style={{ padding: '12px 14px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
                      {row.sv.toLocaleString()}
                    </td>

                    {/* KW DIFF */}
                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {row.kd !== null ? (
                          <>
                            <div style={{ width: 36, height: 4, background: '#e2e8f0', borderRadius: 99 }}>
                              <div style={{
                                height: '100%',
                                borderRadius: 99,
                                width: `${Math.min(row.kd, 100)}%`,
                                background: row.kd > 60 ? '#ef4444' : row.kd > 30 ? '#f59e0b' : '#10b981'
                              }} />
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{row.kd}</span>
                          </>
                        ) : (
                          <span style={{ fontSize: 12, color: '#94a3b8' }}>n/a</span>
                        )}
                      </div>
                    </td>

                    {/* CLUSTER */}
                    <td style={{ padding: '12px 14px', color: '#0f172a', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {row.cluster}
                    </td>

                    {/* CATEGORY */}
                    <td style={{ padding: '12px 14px', color: '#0f172a', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {row.category}
                    </td>

                    {/* TYPE */}
                    <td style={{ padding: '12px 14px', color: '#0f172a', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {row.type}
                    </td>

                    {/* TARGET TYPE */}
                    <td style={{ padding: '12px 14px', color: '#0f172a', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {row.targetType}
                    </td>

                    {/* TARGET SUBTYPE */}
                    <td style={{ padding: '12px 14px', color: '#0f172a', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {row.targetSubtype}
                    </td>

                    {/* TARGET GEO */}
                    <td style={{ padding: '12px 14px', color: '#0f172a', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {row.targetGeo}
                    </td>

                    {/* PRIORITY */}
                    <td style={{ padding: '12px 14px', color: '#0f172a', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {row.priority}
                    </td>

                    {/* LANDING PAGE */}
                    <td style={{ padding: '12px 14px', color: '#2563eb', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.landingPage ? (
                        <a
                          href={row.landingPage}
                          target="_blank"
                          rel="noreferrer"
                          title={row.landingPage}
                          style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, maxWidth: '100%' }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.landingPage}
                          </span>
                          <ExternalLink size={12} style={{ flexShrink: 0 }} />
                        </a>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>—</span>
                      )}
                    </td>

                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
          {/* Pagination Controls */}
          {filteredKeywords.length > 0 && (
            <div style={{
              padding: '12px 20px',
              background: '#ffffff',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 13,
              color: '#64748b'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28,
                    height: 28,
                    border: '1px solid #cbd5e1',
                    borderRadius: 6,
                    background: '#ffffff',
                    color: safePage <= 1 ? '#cbd5e1' : '#475569',
                    cursor: safePage <= 1 ? 'default' : 'pointer',
                    opacity: safePage <= 1 ? 0.5 : 1
                  }}
                >
                  <ChevronLeft size={14} />
                </button>
                <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>Page:</span>
                <input
                  type="text"
                  value={safePage}
                  onChange={e => {
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isNaN(n)) setPage(Math.min(Math.max(1, n), pageCount));
                  }}
                  style={{
                    width: 38,
                    height: 28,
                    border: '1px solid #cbd5e1',
                    borderRadius: 6,
                    padding: '2px 4px',
                    textAlign: 'center',
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#0f172a',
                    outline: 'none',
                    background: '#ffffff'
                  }}
                />
                <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>of {pageCount}</span>
                <button
                  onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                  disabled={safePage >= pageCount}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28,
                    height: 28,
                    border: '1px solid #cbd5e1',
                    borderRadius: 6,
                    background: '#ffffff',
                    color: safePage >= pageCount ? '#cbd5e1' : '#475569',
                    cursor: safePage >= pageCount ? 'default' : 'pointer',
                    opacity: safePage >= pageCount ? 0.5 : 1
                  }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
              <div style={{ fontSize: 12.5, color: '#94a3b8', fontWeight: 500 }}>
                100 per page
              </div>
            </div>
          )}
      </div>

    </div>
  );
}
