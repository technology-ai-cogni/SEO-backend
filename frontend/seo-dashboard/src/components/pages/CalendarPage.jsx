import React, { useState, useEffect, useMemo } from 'react';
import {
  Bookmark,
  Clock,
  CheckCircle2,
  Search,
  FolderOpen,
  ChevronDown,
  Plus,
  FileSpreadsheet,
  Edit3,
  Trash2,
  X,
  Sparkles,
  Download
} from 'lucide-react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  fetchDomainRows,
  fetchKeywordRows,
  listOffPageActivitiesApi,
  createOffPageActivityApi,
  updateOffPageActivityApi,
  deleteOffPageActivityApi,
  analyzeKeywordPushPotential
} from '../../lib/projectsApi';

// ─── PUSH-POTENTIAL BATCHING ───
// Batch 1 (high): near-certain the keyword can be pushed up in ranking.
// Batch 2 (medium): real potential, less certain.
// Batch 3 (low): unlikely to move meaningfully.
// The backend does this with an LLM; this is the local fallback / instant view.
const PUSH_BATCH_META = {
  high: { key: 'high', order: 1, label: 'Batch 1 · High confidence', tint: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', Icon: TrendingUp, hint: 'Very likely can be pushed up in ranking' },
  medium: { key: 'medium', order: 2, label: 'Batch 2 · Moderate', tint: '#d97706', bg: '#fffbeb', border: '#fde68a', Icon: Minus, hint: 'Some potential, a bit lower confidence' },
  low: { key: 'low', order: 3, label: 'Batch 3 · Low / unlikely', tint: '#dc2626', bg: '#fef2f2', border: '#fecaca', Icon: TrendingDown, hint: "Unlikely to move up with reasonable effort" },
};

function clientHeuristicBatches(potential) {
  const out = { high: [], medium: [], low: [] };
  (potential || []).forEach(k => {
    const rank = Number(k.rank) || 99;
    const kd = Number(k.kd) || 0;
    const sv = Number(k.sv) || 0;
    let batch = 'low', confidence = 30, reason = 'Far from page 1 or a hard SERP.';
    if (rank <= 10 && kd <= 40 && sv > 0) { batch = 'high'; confidence = 80; reason = 'Close to page 1 with manageable difficulty.'; }
    else if (rank <= 15 && kd <= 60) { batch = 'medium'; confidence = 55; reason = 'Moderate distance to page 1 and difficulty.'; }
    out[batch].push({ ...k, batch, confidence, reason });
  });
  return out;
}

// Reconcile the backend's AI batches back onto the local keyword rows (match by
// keyword text). Any keyword the model skipped falls into Batch 3.
function mergeAiBatches(aiBatches, potential) {
  const byKw = new Map((potential || []).map(p => [String(p.keyword || '').toLowerCase(), p]));
  const out = { high: [], medium: [], low: [] };
  const placed = new Set();
  ['high', 'medium', 'low'].forEach(b => {
    (aiBatches?.[b] || []).forEach(row => {
      const kwLower = String(row.keyword || '').toLowerCase();
      const base = byKw.get(kwLower) || row;
      out[b].push({ ...base, batch: b, confidence: row.confidence ?? 50, reason: row.reason || '' });
      placed.add(kwLower);
    });
  });
  (potential || []).forEach(p => {
    if (!placed.has(String(p.keyword || '').toLowerCase())) {
      out.low.push({ ...p, batch: 'low', confidence: 25, reason: 'Not classified by AI.' });
    }
  });
  return out;
}

// ─── POTENTIAL KEYWORD SELECTION ───
// Two rules only:
//   1. Current rank is between 5 and 20 (inclusive).
//   2. Order by search volume, highest first.
function getPotentialKeywordsForProject(kws) {
  if (!kws || !Array.isArray(kws) || kws.length === 0) return [];

  const parseNum = (v) => Number(String(v ?? '').replace(/[^0-9.]/g, '')) || 0;

  const seen = new Set();
  const scored = [];

  kws.forEach(k => {
    // Rule 1: rank 5-20
    const rank = Number(k.rank || k.position || 0);
    if (!(rank >= 5 && rank <= 20)) return;

    const kwText = String(k.kw || k.keyword || '').trim();
    const kwLower = kwText.toLowerCase();
    if (!kwText || seen.has(kwLower)) return;
    seen.add(kwLower);

    const sv = parseNum(k.sv ?? k.search_volume ?? k.kw_volume ?? k.volume);
    // keyword rows from fetchKeywordRows expose difficulty as `kwDiff` (db col kw_diff)
    const kd = parseNum(k.kwDiff ?? k.kw_diff ?? k.kd ?? k.keyword_difficulty ?? k.difficulty);

    scored.push({
      id: k.id || kwText,
      keyword: kwText,
      category: k.category || k.targetSubtype || k.subtype || 'General',
      cluster: k.cluster || k.type || 'General',
      rank: rank,
      sv: sv,
      kd: kd,
      potentialScore: sv,
      topicLink: ''
    });
  });

  // Rule 2: highest search volume first
  return scored.sort((a, b) => b.sv - a.sv);
}

function CalendarPage({ user }) {
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);

  // 3 Sub-tabs: 'saved' | 'scheduled' | 'approved'
  const [activeSubTab, setActiveSubTab] = useState('saved');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Live Supabase / Backend off_page_activities data
  const [activities, setActivities] = useState([]);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [schedulingType, setSchedulingType] = useState('ai'); // 'ai' | 'manual'
    const [modalKeywords, setModalKeywords] = useState([]);
  const [potentialKws, setPotentialKws] = useState([]);
  const [pushBatches, setPushBatches] = useState({ high: [], medium: [], low: [] });
  const [analyzingPotential, setAnalyzingPotential] = useState(false);
  const [selectedKwIds, setSelectedKwIds] = useState(new Set());
  const [topicLinks, setTopicLinks] = useState({});
  const [formData, setFormData] = useState({
    activity_name: '',
    project_name: '',
    main_poc: '',
    content_poc: '',
    quantity: 1,
    budget: '',
    user: user?.name || user?.email || '',
    period: new Date().toISOString().split('T')[0],
    scheduler: '',
    auditor: '',
    status: 'saved'
  });

  // Load Off-Page Activities + Projects from Supabase.
  // The activities table is the actual page content, so unblock the UI as soon
  // as that returns. The project list only feeds the selector dropdown / filter,
  // and fetchDomainRows() runs a slow full-table keyword-count scan, so it's
  // loaded in the background instead of holding up the whole page.
  const loadData = async () => {
    setLoading(true);
    try {
      const offPageList = await listOffPageActivitiesApi().catch(() => []);
      setActivities(offPageList || []);
    } catch (err) {
      console.error('[CalendarPage] Error loading activities:', err);
    } finally {
      setLoading(false);
    }

    try {
      const projs = await fetchDomainRows().catch(() => []);
      setProjects(projs || []);
      if (projs && projs.length > 0) {
        const savedSlug = localStorage.getItem('bd_selected_project');
        const matched = projs.find(p => p.slug === savedSlug) || projs[0];
        setActiveProject(matched);
      }
    } catch (err) {
      console.error('[CalendarPage] Error loading projects:', err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSelectProject = (proj) => {
    setActiveProject(proj);
    localStorage.setItem('bd_selected_project', proj.slug);
    setProjectMenuOpen(false);
  };

  // Normalize status helper: 'saved' | 'scheduled' | 'approved'
  const getNormalizedStatus = (itemStatus) => {
    if (!itemStatus) return 'saved';
    const s = String(itemStatus).toLowerCase().trim();
    if (s.includes('sched') || s.includes('pending')) return 'scheduled';
    if (s.includes('appr') || s.includes('comp') || s.includes('done')) return 'approved';
    return 'saved';
  };

  // Filter activities by active project, active sub-tab, and search query
  const filteredActivities = useMemo(() => {
    return activities.filter(item => {
      // 1. Sub-tab status match
      const normStatus = getNormalizedStatus(item.status);
      if (normStatus !== activeSubTab) return false;

      // 2. Project match (if activeProject selected and item has project_name)
      if (activeProject && item.project_name && item.project_name !== 'General') {
        const itemProj = String(item.project_name).toLowerCase().trim();
        const curProjName = String(activeProject.name || activeProject.domain || '').toLowerCase().trim();
        const curProjSlug = String(activeProject.slug || '').toLowerCase().trim();
        if (itemProj && !curProjName.includes(itemProj) && !curProjSlug.includes(itemProj) && !itemProj.includes(curProjName)) {
          // Keep item if it matches search or general
        }
      }

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = String(item.activity_name || '').toLowerCase().includes(q);
        const matchesProj = String(item.project_name || '').toLowerCase().includes(q);
        const matchesPoc = String(item.main_poc || '').toLowerCase().includes(q) || String(item.content_poc || '').toLowerCase().includes(q);
        const matchesUser = String(item.user || '').toLowerCase().includes(q);
        if (!matchesName && !matchesProj && !matchesPoc && !matchesUser) return false;
      }

      return true;
    });
  }, [activities, activeSubTab, activeProject, searchQuery]);

  // Counts by tab
  const counts = useMemo(() => {
    return {
      saved: activities.filter(a => getNormalizedStatus(a.status) === 'saved').length,
      scheduled: activities.filter(a => getNormalizedStatus(a.status) === 'scheduled').length,
      approved: activities.filter(a => getNormalizedStatus(a.status) === 'approved').length
    };
  }, [activities]);

  // Form Handlers
  const handleOpenAddModal = (defaultStatus = activeSubTab) => {
    setEditingItem(null);
    setSchedulingType('ai');
    setAnalyzingPotential(false);
    setPushBatches({ high: [], medium: [], low: [] });
    setPotentialKws([]);
    setSelectedKwIds(new Set());
    setTopicLinks({});
    setFormData({
      activity_name: 'Guest Post',
      project_name: activeProject?.name || activeProject?.domain || (projects[0]?.name || projects[0]?.domain || ''),
      main_poc: '',
      content_poc: '',
      quantity: 1,
      budget: '$250',
      user: user?.name || user?.email || 'Admin User',
      period: new Date().toISOString().split('T')[0],
      scheduler: 'AI Auto-Scheduler',
      auditor: 'SEO Audit Team',
      status: defaultStatus
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (item) => {
    setEditingItem(item);
    setFormData({
      activity_name: item.activity_name || '',
      project_name: item.project_name || '',
      main_poc: item.main_poc || '',
      content_poc: item.content_poc || '',
      quantity: item.quantity || 1,
      budget: item.budget || '',
      user: item.user || user?.name || user?.email || '',
      period: item.period || new Date().toISOString().split('T')[0],
      scheduler: item.scheduler || '',
      auditor: item.auditor || '',
      status: getNormalizedStatus(item.status)
    });
    setIsModalOpen(true);
  };

  
  // Load project keywords, shortlist Rank 5-20 by search volume, then AI-triage
  // them into 3 push-potential batches.
  useEffect(() => {
    let cancelled = false;
    async function loadModalKws() {
      if (!formData.project_name) {
        setPotentialKws([]);
        setPushBatches({ high: [], medium: [], low: [] });
        setSelectedKwIds(new Set());
        return;
      }
      const matchedProj = projects.find(p => (p.name || p.domain) === formData.project_name);
      const slug = matchedProj?.slug || formData.project_name.toLowerCase().replace(/\s+/g, '');
      try {
        const kws = await fetchKeywordRows(slug);
        if (cancelled) return;
        setModalKeywords(kws || []);
        const potential = getPotentialKeywordsForProject(kws || []);
        setPotentialKws(potential);

        if (potential.length === 0) {
          setPushBatches({ high: [], medium: [], low: [] });
          setSelectedKwIds(new Set());
          return;
        }

        // 1. Instant local heuristic split + pre-select Batch 1.
        const heuristic = clientHeuristicBatches(potential);
        setPushBatches(heuristic);
        setSelectedKwIds(new Set(heuristic.high.map(k => k.id)));

        // 2. Ask the backend AI for a smarter split; replace when it returns.
        setAnalyzingPotential(true);
        try {
          const domain = matchedProj?.domain || '';
          const aiBatches = await analyzeKeywordPushPotential(slug, potential, domain, 'India');
          if (!cancelled && aiBatches) {
            const merged = mergeAiBatches(aiBatches, potential);
            setPushBatches(merged);
            setSelectedKwIds(new Set(merged.high.map(k => k.id)));
          }
        } catch (aiErr) {
          console.warn('[CalendarPage] push-potential AI notice:', aiErr);
        } finally {
          if (!cancelled) setAnalyzingPotential(false);
        }
      } catch (err) {
        console.error('[CalendarPage] Error loading modal keywords:', err);
      }
    }
    if (isModalOpen && schedulingType === 'ai') {
      loadModalKws();
    }
    return () => { cancelled = true; };
  }, [formData.project_name, isModalOpen, schedulingType]);

  const handleSaveForm = async (e) => {
    e.preventDefault();
    try {
      let payload = { ...formData };
      if (schedulingType === 'ai' && !editingItem) {
        const batchById = new Map();
        ['high', 'medium', 'low'].forEach(b => (pushBatches[b] || []).forEach(r => batchById.set(r.id, r)));
        const selectedPotential = potentialKws.filter(k => selectedKwIds.has(k.id)).map(k => {
          const info = batchById.get(k.id) || {};
          return {
            keyword: k.keyword,
            category: k.category,
            cluster: k.cluster,
            rank: k.rank,
            sv: k.sv,
            kd: k.kd,
            push_batch: info.batch || null,
            push_confidence: info.confidence ?? null,
            push_reason: info.reason || '',
            topic_link: topicLinks[k.id] || ''
          };
        });
        payload.potential_keywords = selectedPotential;
        if (selectedPotential.length > 0) {
          payload.keyword_name = selectedPotential.map(k => k.keyword).join(', ');
          payload.category = selectedPotential[0].category;
          payload.cluster = selectedPotential[0].cluster;
          payload.topic_link = selectedPotential.map(k => k.topic_link).filter(Boolean).join(' | ');
        }
      }

      if (editingItem) {
        await updateOffPageActivityApi(editingItem.id, payload);
        setActivities(prev => prev.map(a => a.id === editingItem.id ? { ...a, ...payload } : a));
      } else {
        const created = await createOffPageActivityApi(payload);
        setActivities(prev => [created, ...prev]);
      }
      setIsModalOpen(false);
    } catch (err) {
      alert(`Error saving activity: ${err.message}`);
    }
  };

  const handleMoveStatus = async (item, newStatus) => {
    try {
      await updateOffPageActivityApi(item.id, { status: newStatus });
      setActivities(prev => prev.map(a => a.id === item.id ? { ...a, status: newStatus } : a));
    } catch (err) {
      console.error('[CalendarPage] Error moving status:', err);
    }
  };

  const handleDeleteItem = async (item) => {
    if (!window.confirm(`Are you sure you want to delete "${item.activity_name}"?`)) return;
    try {
      await deleteOffPageActivityApi(item.id);
      setActivities(prev => prev.filter(a => a.id !== item.id));
    } catch (err) {
      alert(`Error deleting item: ${err.message}`);
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    if (filteredActivities.length === 0) {
      alert('No data available to export.');
      return;
    }
    const headers = ['Activity Name', 'Project Name', 'Main POC', 'Content POC', 'Quantity', 'Budget', 'User', 'Period', 'Scheduler', 'Auditor', 'Status'];
    const rows = filteredActivities.map(a => [
      `"${(a.activity_name || '').replace(/"/g, '""')}"`,
      `"${(a.project_name || '').replace(/"/g, '""')}"`,
      `"${(a.main_poc || '').replace(/"/g, '""')}"`,
      `"${(a.content_poc || '').replace(/"/g, '""')}"`,
      a.quantity || 1,
      `"${String(a.budget || '').replace(/"/g, '""')}"`,
      `"${(a.user || '').replace(/"/g, '""')}"`,
      `"${a.period || ''}"`,
      `"${(a.scheduler || '').replace(/"/g, '""')}"`,
      `"${(a.auditor || '').replace(/"/g, '""')}"`,
      `"${getNormalizedStatus(a.status).toUpperCase()}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Off_Page_Activities_${activeSubTab}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ padding: '24px 32px', minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1A1A1A', margin: 0, letterSpacing: '-0.5px' }}>
              Calendar
            </h1>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>          </p>
        </div>

        {/* Right Header Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => handleOpenAddModal(activeSubTab)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 700,
              color: '#ffffff',
              background: 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)',
              border: '1.5px solid #09060E',
              borderRadius: 10,
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(123, 47, 190, 0.35), 0 2px 6px rgba(212, 0, 122, 0.2)',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg, #581F9E 0%, #8A33D4 45%, #D6237A 80%, #E50C88 100%)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)'; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            <Sparkles size={16} />
            <span>Choose Project</span>
          </button>

          <button
            onClick={handleExportCSV}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              color: '#334155',
              background: '#ffffff',
              border: '1px solid #E4DFEE',
              borderRadius: 8,
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(74, 26, 140, 0.04)'
            }}
          >
            <Download size={15} />
            <span>Export CSV</span>
          </button>

          {/* Project Selector */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setProjectMenuOpen(!projectMenuOpen)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: '#ffffff',
                border: '1px solid #E4DFEE',
                borderRadius: 10,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: '#1A1A1A',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(74, 26, 140, 0.04)'
              }}
            >
              <FolderOpen size={16} color="var(--accent)" />
              <span>{activeProject?.name || activeProject?.domain || 'All Projects'}</span>
              <ChevronDown size={14} color="#64748b" />
            </button>

            {projectMenuOpen && (
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 6,
                width: 220,
                background: '#ffffff',
                border: '1px solid #E4DFEE',
                borderRadius: 10,
                boxShadow: '0 10px 25px -5px rgba(74, 26, 140, 0.12)',
                zIndex: 50,
                overflow: 'hidden'
              }}>
                {projects.map(p => (
                  <button
                    key={p.slug}
                    onClick={() => handleSelectProject(p)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 14px',
                      border: 'none',
                      background: activeProject?.slug === p.slug ? '#F6EEFD' : 'transparent',
                      fontSize: 13,
                      fontWeight: activeProject?.slug === p.slug ? 700 : 500,
                      color: activeProject?.slug === p.slug ? '#7B2FBE' : '#334155',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || p.domain}</span>
                    {activeProject?.slug === p.slug && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7B2FBE' }} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Sub-Tab Bar Container */}
      <div style={{
        background: '#ffffff',
        borderRadius: 14,
        border: '1px solid #E4DFEE',
        padding: '16px 20px',
        marginBottom: 20,
        boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06), 0 2px 6px -1px rgba(45, 45, 68, 0.03)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          {/* Sub-Tabs: Saved | Scheduled | Approved */}
          <div style={{ display: 'flex', gap: 8, background: '#F4F1FA', padding: 4, borderRadius: 10 }}>
            {/* 1. Saved Tab */}
            <button
              onClick={() => setActiveSubTab('saved')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 18px',
                borderRadius: 8,
                border: activeSubTab === 'saved' ? '1px solid #E5CCF7' : '1px solid transparent',
                background: activeSubTab === 'saved' ? 'linear-gradient(135deg, #F6EEFD 0%, #FDEBF4 100%)' : 'transparent',
                color: activeSubTab === 'saved' ? '#7B2FBE' : '#64748b',
                fontSize: 13,
                fontWeight: activeSubTab === 'saved' ? 800 : 600,
                cursor: 'pointer',
                boxShadow: activeSubTab === 'saved' ? '0 1px 3px rgba(74, 26, 140, 0.08)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <Bookmark size={15} color={activeSubTab === 'saved' ? '#7B2FBE' : '#64748b'} />
              <span>Saved</span>
              <span style={{
                background: activeSubTab === 'saved' ? '#E5CCF7' : '#E2DBEC',
                color: activeSubTab === 'saved' ? '#4A1A8C' : '#475569',
                fontSize: 11,
                fontWeight: 800,
                padding: '1px 7px',
                borderRadius: 10
              }}>
                {counts.saved}
              </span>
            </button>

            {/* 2. Scheduled Tab */}
            <button
              onClick={() => setActiveSubTab('scheduled')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 18px',
                borderRadius: 8,
                border: activeSubTab === 'scheduled' ? '1px solid #FED7AA' : '1px solid transparent',
                background: activeSubTab === 'scheduled' ? 'linear-gradient(135deg, #FFF7ED 0%, #FEF3C7 100%)' : 'transparent',
                color: activeSubTab === 'scheduled' ? '#D97706' : '#64748b',
                fontSize: 13,
                fontWeight: activeSubTab === 'scheduled' ? 800 : 600,
                cursor: 'pointer',
                boxShadow: activeSubTab === 'scheduled' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <Clock size={15} color={activeSubTab === 'scheduled' ? '#d97706' : '#64748b'} />
              <span>Scheduled</span>
              <span style={{
                background: activeSubTab === 'scheduled' ? '#fef3c7' : '#E2DBEC',
                color: activeSubTab === 'scheduled' ? '#b45309' : '#475569',
                fontSize: 11,
                fontWeight: 800,
                padding: '1px 7px',
                borderRadius: 10
              }}>
                {counts.scheduled}
              </span>
            </button>

            {/* 3. Approved Tab */}
            <button
              onClick={() => setActiveSubTab('approved')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 18px',
                borderRadius: 8,
                border: activeSubTab === 'approved' ? '1px solid #A7F3D0' : '1px solid transparent',
                background: activeSubTab === 'approved' ? 'linear-gradient(135deg, #ECFDF5 0%, #E6FAF6 100%)' : 'transparent',
                color: activeSubTab === 'approved' ? '#008F7A' : '#64748b',
                fontSize: 13,
                fontWeight: activeSubTab === 'approved' ? 800 : 600,
                cursor: 'pointer',
                boxShadow: activeSubTab === 'approved' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <CheckCircle2 size={15} color={activeSubTab === 'approved' ? '#008F7A' : '#64748b'} />
              <span>Approved</span>
              <span style={{
                background: activeSubTab === 'approved' ? '#d1fae5' : '#E2DBEC',
                color: activeSubTab === 'approved' ? '#047857' : '#475569',
                fontSize: 11,
                fontWeight: 800,
                padding: '1px 7px',
                borderRadius: 10
              }}>
                {counts.approved}
              </span>
            </button>
          </div>

          {/* Search & Utility Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ position: 'relative' }}>
              <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                placeholder={`Search ${activeSubTab} activities...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  paddingLeft: 34,
                  paddingRight: 14,
                  paddingTop: 8,
                  paddingBottom: 8,
                  fontSize: 13,
                  border: '1px solid #E4DFEE',
                  borderRadius: 8,
                  outline: 'none',
                  width: 240,
                  background: '#ffffff'
                }}
              />
            </div>

            <button
              onClick={() => handleOpenAddModal(activeSubTab)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)',
                color: '#ffffff',
                border: '1.5px solid #09060E',
                borderRadius: 8,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(123, 47, 190, 0.35), 0 2px 6px rgba(212, 0, 122, 0.2)',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg, #581F9E 0%, #8A33D4 45%, #D6237A 80%, #E50C88 100%)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)'; e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              <Plus size={15} />
              <span>New Entry</span>
            </button>
          </div>
        </div>
      </div>

      {/* Content Table Container - ALWAYS RENDERS TABLE HEADERS REGARDLESS OF EMPTY OR NOT */}
      <div style={{
        background: '#ffffff',
        borderRadius: 14,
        border: '1px solid #E4DFEE',
        overflow: 'hidden',
        boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06), 0 2px 6px -1px rgba(45, 45, 68, 0.03)'
      }}>
        {loading ? (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <Sparkles size={32} className="animate-spin" color="var(--accent)" style={{ marginBottom: 12 }} />
            <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>Fetching off_page_activities from database...</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 1000 }}>
              <thead>
                <tr style={{ background: '#FAF8FD', borderBottom: '1px solid #E4DFEE' }}>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Activity Name
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Project Name
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Main POC
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Content POC
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center' }}>
                    Quantity
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Budget
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    User
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Period
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Scheduler
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Auditor
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center' }}>
                    Move Status
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredActivities.length > 0 ? (
                  filteredActivities.map((item, idx) => (
                    <tr key={item.id || idx} style={{ borderBottom: idx === filteredActivities.length - 1 ? 'none' : '1px solid #f1f5f9', background: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                      <td style={{ padding: '14px 16px', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                        {item.activity_name || '—'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12.5, color: '#475569', fontWeight: 600 }}>
                        <span style={{ background: '#eef2ff', color: '#4338ca', padding: '3px 8px', borderRadius: 6 }}>
                          {item.project_name || '—'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12.5, color: '#334155', fontWeight: 500 }}>
                        {item.main_poc || '—'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12.5, color: '#334155', fontWeight: 500 }}>
                        {item.content_poc || '—'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12.5, color: '#0f172a', fontWeight: 700, textAlign: 'center' }}>
                        {item.quantity ?? 1}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12.5, color: '#059669', fontWeight: 700 }}>
                        {item.budget ? (String(item.budget).startsWith('$') ? item.budget : `$${item.budget}`) : '—'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748b' }}>
                        {item.user || '—'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748b' }}>
                        {item.period || '—'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748b' }}>
                        {item.scheduler || '—'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748b' }}>
                        {item.auditor || '—'}
                      </td>

                      {/* Move Status Buttons */}
                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                          {activeSubTab !== 'saved' && (
                            <button
                              onClick={() => handleMoveStatus(item, 'saved')}
                              title="Move to Saved"
                              style={{ background: '#fef3c7', color: '#b45309', border: 'none', padding: '3px 7px', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                            >
                              Saved
                            </button>
                          )}
                          {activeSubTab !== 'scheduled' && (
                            <button
                              onClick={() => handleMoveStatus(item, 'scheduled')}
                              title="Move to Scheduled"
                              style={{ background: '#dbeafe', color: '#1d4ed8', border: 'none', padding: '3px 7px', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                            >
                              Scheduled
                            </button>
                          )}
                          {activeSubTab !== 'approved' && (
                            <button
                              onClick={() => handleMoveStatus(item, 'approved')}
                              title="Move to Approved"
                              style={{ background: '#d1fae5', color: '#047857', border: 'none', padding: '3px 7px', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                            >
                              Approved
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Actions: Edit / Delete */}
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                          <button
                            onClick={() => handleOpenEditModal(item)}
                            title="Edit Activity"
                            style={{ background: 'transparent', border: 'none', color: '#6366f1', cursor: 'pointer', padding: 4 }}
                          >
                            <Edit3 size={15} />
                          </button>
                          <button
                            onClick={() => handleDeleteItem(item)}
                            title="Delete Activity"
                            style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={12} style={{ padding: '50px 20px', textAlign: 'center', color: '#94a3b8' }}>
                      <FileSpreadsheet size={36} color="#cbd5e1" style={{ marginBottom: 8 }} />
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>
                        No {activeSubTab} activities found in database table
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                        Click "+ New Entry" above to add a new {activeSubTab} activity.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Activity Modal */}
      {isModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 16,
            width: '100%',
            maxWidth: 580,
            padding: 24,
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>
                {editingItem ? 'Edit Activity' : 'Add New Off-Page Activity'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                <X size={20} />
              </button>
            </div>

            {/* 2-Tab Toggles: AI Scheduling | Manual Scheduling */}
            {!editingItem && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                background: '#f1f5f9',
                padding: 4,
                borderRadius: 12,
                marginBottom: 20
              }}>
                <button
                  type="button"
                  onClick={() => setSchedulingType('ai')}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 9,
                    border: 'none',
                    background: schedulingType === 'ai' ? '#ffffff' : 'transparent',
                    color: schedulingType === 'ai' ? '#4f46e5' : '#64748b',
                    fontSize: 13.5,
                    fontWeight: schedulingType === 'ai' ? 700 : 600,
                    cursor: 'pointer',
                    boxShadow: schedulingType === 'ai' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8
                  }}
                >
                  <Sparkles size={16} color={schedulingType === 'ai' ? '#6366f1' : '#64748b'} />
                  <span>AI Scheduling</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSchedulingType('manual')}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 9,
                    border: 'none',
                    background: schedulingType === 'manual' ? '#ffffff' : 'transparent',
                    color: schedulingType === 'manual' ? '#4f46e5' : '#64748b',
                    fontSize: 13.5,
                    fontWeight: schedulingType === 'manual' ? 700 : 600,
                    cursor: 'pointer',
                    boxShadow: schedulingType === 'manual' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8
                  }}
                >
                  <Edit3 size={15} color={schedulingType === 'manual' ? '#6366f1' : '#64748b'} />
                  <span>Manual Scheduling</span>
                </button>
              </div>
            )}

            <form onSubmit={handleSaveForm} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* TAB 1: AI SCHEDULING */}
              {schedulingType === 'ai' && !editingItem ? (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                      Project Name *
                    </label>
                    <select
                      required
                      value={formData.project_name}
                      onChange={e => setFormData({ ...formData, project_name: e.target.value })}
                      style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#ffffff', color: '#0f172a', fontWeight: 600 }}
                    >
                      <option value="">Select Project...</option>
                      {projects.map(p => (
                        <option key={p.slug} value={p.name || p.domain}>
                          {p.name || p.domain}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                      Activity Name *
                    </label>
                    <select
                      required
                      value={formData.activity_name}
                      onChange={e => setFormData({ ...formData, activity_name: e.target.value })}
                      style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#ffffff', color: '#0f172a', fontWeight: 600 }}
                    >
                      <option value="">Select Activity...</option>
                      <option value="Guest Post">Guest Post</option>
                      <option value="Press Release">Press Release</option>
                      <option value="Niche Edit">Niche Edit</option>
                      <option value="Directory Submission">Directory Submission</option>
                      <option value="Social Bookmarking">Social Bookmarking</option>
                      <option value="Web 2.0 Backlink">Web 2.0 Backlink</option>
                      <option value="Forum Discussion">Forum Discussion</option>
                      <option value="PBN Placement">PBN Placement</option>
                      <option value="Quora Answer">Quora Answer</option>
                      <option value="Reddit Promotion">Reddit Promotion</option>
                    </select>
                  </div>

                  {/* AI Push-Potential Analysis -- Rank 5-20 keywords, batched by
                      how confidently each can be pushed UP in ranking. */}
                  {formData.project_name && (
                    <div style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 10,
                      padding: 14,
                      marginTop: 4,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Sparkles size={14} color="#7c3aed" className={analyzingPotential ? 'animate-spin' : ''} />
                          <span style={{ fontSize: 12.5, fontWeight: 800, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                            AI Push-Potential (Rank 5–20)
                          </span>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', background: '#ede9fe', padding: '2px 8px', borderRadius: 12 }}>
                          {analyzingPotential ? 'AI analyzing…' : `${potentialKws.length} keyword${potentialKws.length === 1 ? '' : 's'}`}
                        </span>
                      </div>

                      {potentialKws.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic', padding: 12, textAlign: 'center' }}>
                          No rank 5-20 keywords found for this project yet. Run a rank check first.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {['high', 'medium', 'low'].map(bKey => {
                            const meta = PUSH_BATCH_META[bKey];
                            const rows = pushBatches[bKey] || [];
                            const BIcon = meta.Icon;
                            const batchIds = rows.map(r => r.id);
                            const allSelected = batchIds.length > 0 && batchIds.every(id => selectedKwIds.has(id));
                            return (
                              <div key={bKey} style={{ border: `1px solid ${meta.border}`, borderRadius: 8, overflow: 'hidden', background: '#ffffff' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 10px', background: meta.bg, borderBottom: `1px solid ${meta.border}` }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }} title={meta.hint}>
                                    <BIcon size={14} color={meta.tint} />
                                    <span style={{ fontSize: 11.5, fontWeight: 800, color: meta.tint }}>{meta.label}</span>
                                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', background: '#ffffff', border: `1px solid ${meta.border}`, borderRadius: 10, padding: '0 6px' }}>{rows.length}</span>
                                  </div>
                                  {rows.length > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const next = new Set(selectedKwIds);
                                        if (allSelected) batchIds.forEach(id => next.delete(id));
                                        else batchIds.forEach(id => next.add(id));
                                        setSelectedKwIds(next);
                                      }}
                                      style={{ fontSize: 10.5, fontWeight: 700, color: meta.tint, background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                                    >
                                      {allSelected ? 'Unselect all' : 'Select all'}
                                    </button>
                                  )}
                                </div>

                                {rows.length === 0 ? (
                                  <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic', padding: '8px 10px' }}>None in this batch.</div>
                                ) : (
                                  <div style={{ maxHeight: 190, overflowY: 'auto' }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, textAlign: 'left' }}>
                                    <thead>
                                      <tr style={{ color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        <th style={{ padding: '6px 8px', width: 26, background: '#f8fafc', position: 'sticky', top: 0, zIndex: 1 }}></th>
                                        <th style={{ padding: '6px 8px', background: '#f8fafc', position: 'sticky', top: 0, zIndex: 1 }}>Keyword</th>
                                        <th style={{ padding: '6px 8px', width: 44, background: '#f8fafc', position: 'sticky', top: 0, zIndex: 1 }}>Rank</th>
                                        <th style={{ padding: '6px 8px', width: 54, background: '#f8fafc', position: 'sticky', top: 0, zIndex: 1 }}>SV</th>
                                        <th style={{ padding: '6px 8px', width: 36, background: '#f8fafc', position: 'sticky', top: 0, zIndex: 1 }}>KD</th>
                                        <th style={{ padding: '6px 8px', width: 44, background: '#f8fafc', position: 'sticky', top: 0, zIndex: 1 }}>Conf</th>
                                        <th style={{ padding: '6px 8px', width: 120, background: '#f8fafc', position: 'sticky', top: 0, zIndex: 1 }}>Topic Link</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {rows.map(item => {
                                        const isChecked = selectedKwIds.has(item.id);
                                        return (
                                          <tr key={item.id} style={{ borderTop: '1px solid #f1f5f9', background: isChecked ? '#f5f3ff' : 'transparent' }}>
                                            <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                              <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={(e) => {
                                                  const next = new Set(selectedKwIds);
                                                  if (e.target.checked) next.add(item.id);
                                                  else next.delete(item.id);
                                                  setSelectedKwIds(next);
                                                }}
                                                style={{ cursor: 'pointer' }}
                                              />
                                            </td>
                                            <td style={{ padding: '6px 8px' }} title={item.reason || ''}>
                                              <div style={{ fontWeight: 700, color: '#0f172a' }}>{item.keyword}</div>
                                            </td>
                                            <td style={{ padding: '6px 8px' }}>
                                              <span style={{ background: item.rank <= 10 ? '#dcfce7' : '#e0f2fe', color: item.rank <= 10 ? '#15803d' : '#0369a1', padding: '1px 5px', borderRadius: 4, fontSize: 10, fontWeight: 800 }}>#{item.rank}</span>
                                            </td>
                                            <td style={{ padding: '6px 8px', fontWeight: 600, color: '#334155' }}>{Number(item.sv || 0).toLocaleString()}</td>
                                            <td style={{ padding: '6px 8px', fontWeight: 600, color: (item.kd || 0) > 50 ? '#ef4444' : '#16a34a' }}>{item.kd ?? 0}</td>
                                            <td style={{ padding: '6px 8px', fontWeight: 700, color: meta.tint }}>{item.confidence != null ? `${item.confidence}%` : '–'}</td>
                                            <td style={{ padding: '4px 8px' }}>
                                              <input
                                                type="url"
                                                placeholder="Topic Link…"
                                                value={topicLinks[item.id] || ''}
                                                onChange={(e) => setTopicLinks({ ...topicLinks, [item.id]: e.target.value })}
                                                style={{ width: '100%', padding: '3px 6px', fontSize: 10.5, border: '1px solid #cbd5e1', borderRadius: 4, outline: 'none' }}
                                              />
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                        Status *
                      </label>
                      <select
                        value={formData.status}
                        onChange={e => setFormData({ ...formData, status: e.target.value })}
                        style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#ffffff', color: '#0f172a', fontWeight: 600 }}
                      >
                        <option value="saved">Saved</option>
                        <option value="scheduled">Scheduled</option>
                        <option value="approved">Approved</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                        Quantity
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={formData.quantity}
                        onChange={e => setFormData({ ...formData, quantity: parseInt(e.target.value, 10) || 1 })}
                        style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                      />
                    </div>
                  </div>
                </>
              ) : (
                /* TAB 2: MANUAL SCHEDULING */
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Activity Name *</label>
                    <input
                      type="text"
                      required
                      value={formData.activity_name}
                      onChange={e => setFormData({ ...formData, activity_name: e.target.value })}
                      style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Project Name *</label>
                      <select
                        required
                        value={formData.project_name}
                        onChange={e => setFormData({ ...formData, project_name: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#ffffff', color: '#0f172a', fontWeight: 600 }}
                      >
                        <option value="">Select Project...</option>
                        {projects.map(p => (
                          <option key={p.slug} value={p.name || p.domain}>
                            {p.name || p.domain}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Status *</label>
                      <select
                        value={formData.status}
                        onChange={e => setFormData({ ...formData, status: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#ffffff' }}
                      >
                        <option value="saved">Saved</option>
                        <option value="scheduled">Scheduled</option>
                        <option value="approved">Approved</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Main POC</label>
                      <input
                        type="text"
                        value={formData.main_poc}
                        onChange={e => setFormData({ ...formData, main_poc: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Content POC</label>
                      <input
                        type="text"
                        value={formData.content_poc}
                        onChange={e => setFormData({ ...formData, content_poc: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Quantity</label>
                      <input
                        type="number"
                        min="1"
                        value={formData.quantity}
                        onChange={e => setFormData({ ...formData, quantity: parseInt(e.target.value, 10) || 1 })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Budget</label>
                      <input
                        type="text"
                        value={formData.budget}
                        onChange={e => setFormData({ ...formData, budget: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>User</label>
                      <input
                        type="text"
                        value={formData.user}
                        onChange={e => setFormData({ ...formData, user: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Period / Date</label>
                      <input
                        type="text"
                        value={formData.period}
                        onChange={e => setFormData({ ...formData, period: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Scheduler</label>
                      <input
                        type="text"
                        value={formData.scheduler}
                        onChange={e => setFormData({ ...formData, scheduler: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Auditor</label>
                      <input
                        type="text"
                        value={formData.auditor}
                        onChange={e => setFormData({ ...formData, auditor: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                      />
                    </div>
                  </div>
                </>
              )
              }

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, color: '#64748b', background: '#f1f5f9', border: 'none', borderRadius: 8, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '8px 20px',
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#ffffff',
                    background: 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)',
                    border: '1.5px solid #09060E',
                    borderRadius: 8,
                    cursor: 'pointer',
                    boxShadow: '0 4px 16px rgba(123, 47, 190, 0.35)',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'linear-gradient(135deg, #581F9E 0%, #8A33D4 45%, #D6237A 80%, #E50C88 100%)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)'}
                >
                  {editingItem ? 'Update Activity' : 'Create Activity'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


export default CalendarPage;
