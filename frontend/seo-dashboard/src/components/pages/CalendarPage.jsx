import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Bookmark,
  Clock,
  CheckCircle2,
  Search,
  FolderOpen,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Plus,
  FileSpreadsheet,
  Edit3,
  Trash2,
  X,
  Sparkles,
  Download,
  Check,
  Info,
  Calendar as CalendarIcon,
  TrendingUp,
  TrendingDown,
  Minus,
  Sliders,
  ExternalLink,
  HelpCircle,
  User as UserIcon,
  AlertCircle,
  Globe,
  Bot,
  DollarSign,
  Send,
  Eye,
  Layers
} from 'lucide-react';
import {
  fetchDomainRows,
  listCalendarActivitiesApi,
  createCalendarActivityApi,
  updateCalendarActivityApi,
  deleteCalendarActivityApi,
  fetchCalendarPotentialKeywordsApi,
  analyzeCalendarAiPushPotentialApi,
  fetchCalendarUsersApi,
  listCalendarAiRunsApi,
  getCalendarAiRunApi
} from '../../lib/projectsApi';
import BrandInfinityLoader from '../common/BrandInfinityLoader';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const PERIOD_YEARS = [2025, 2026, 2027, 2028];

// Lightweight hover tooltip (instant, styled) — used for the Manual mode POC name
function HoverTip({ label, tip }) {
  const [show, setShow] = useState(false);
  return (
    <span
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {label}
      {show && tip && (
        <span style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 1200,
          background: '#0f172a', color: '#ffffff', fontSize: 11.5, fontWeight: 600,
          padding: '5px 9px', borderRadius: 6, whiteSpace: 'nowrap',
          boxShadow: '0 6px 18px rgba(15,23,42,0.28)', pointerEvents: 'none'
        }}>
          {tip}
        </span>
      )}
    </span>
  );
}

// Custom single-select whose option list always opens BELOW the control
function PlainSelect({ value, onChange, options, placeholder = 'Select...', required }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const norm = (options || []).map(o => (o && typeof o === 'object') ? o : { value: o, label: o });
  const current = norm.find(o => o.value === value);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #cbd5e1',
          borderRadius: 8, outline: 'none', background: '#ffffff',
          color: current ? '#0f172a' : '#94a3b8', fontWeight: 600, textAlign: 'left',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown size={15} color="#64748b" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 8,
          boxShadow: '0 10px 24px rgba(0,0,0,0.14)', zIndex: 1100, maxHeight: 220, overflowY: 'auto', padding: 4
        }}>
          {norm.map(o => {
            const sel = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 12.5,
                  border: 'none', background: sel ? '#f5f3ff' : 'transparent',
                  color: sel ? '#7c3aed' : '#0f172a', fontWeight: sel ? 700 : 500,
                  borderRadius: 6, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}

      {required && (
        <input tabIndex={-1} aria-hidden required value={value || ''} onChange={() => { }}
          style={{ position: 'absolute', bottom: 0, left: 12, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
      )}
    </div>
  );
}

// ─── PUSH-POTENTIAL BATCHING (Hariba.ai Brand Palette) ───
const PUSH_BATCH_META = {
  high: {
    key: 'high',
    order: 1,
    label: 'Batch 1 · Extremely Improved (Gains)',
    tint: '#00BFA2',
    bg: '#E6FAF6',
    border: '#A7F3D0',
    Icon: TrendingUp,
    hint: 'Live rank surged vs previous rank & Top 3 Google SERP are Landing Pages'
  },
  medium: {
    key: 'medium',
    order: 2,
    label: 'Batch 2 · Extremely Dropped (Red Alert)',
    tint: '#D4007A',
    bg: '#FDEBF4',
    border: '#F8B4D9',
    Icon: TrendingDown,
    hint: 'Live rank dropped vs previous rank & Top 3 Google SERP are Landing Pages (Prime recovery targets)'
  },
  low: {
    key: 'low',
    order: 3,
    label: 'Batch 3 · Didn’t Move / Stagnant',
    tint: '#8A8A9A',
    bg: '#F5F5F5',
    border: '#E2DBEC',
    Icon: Minus,
    hint: 'Rank didn’t move or Top 3 Google SERP shifted away from Landing Pages'
  },
};

function CalendarPage({ user, onNavigate }) {
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);

  // 3 Sub-tabs: 'saved' | 'scheduled' | 'approved'
  const [activeSubTab, setActiveSubTab] = useState('saved');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Live activities data
  const [activities, setActivities] = useState([]);

  // Tree Table state (which project rows are expanded)
  const [expandedProjects, setExpandedProjects] = useState(new Set());

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [aiSchedulingEnabled, setAiSchedulingEnabled] = useState(true);
  const [confirmAiModalOpen, setConfirmAiModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState('form'); // 'form' | 'keywords_prompt'
  const [createdActivity, setCreatedActivity] = useState(null);
  const [savingActivity, setSavingActivity] = useState(false);
  const [loadingKeywords, setLoadingKeywords] = useState(false);
  const [loadingStepText, setLoadingStepText] = useState('Scanning database & checking live rankings…');

  // Step 2 view state
  const [step2ViewMode, setStep2ViewMode] = useState('strategy'); // 'strategy' | 'breakdown'
  const [activeInfoKwId, setActiveInfoKwId] = useState(null);
  const [potentialKws, setPotentialKws] = useState([]);
  const [pushBatches, setPushBatches] = useState({ high: [], medium: [], low: [] });
  const [analyzingPotential, setAnalyzingPotential] = useState(false);
  const [selectedKwIds, setSelectedKwIds] = useState(new Set());
  const [keywordSearch, setKeywordSearch] = useState(''); // manual keyword-picker search
  const [topicLinks, setTopicLinks] = useState({});
  const [collapsedBatches, setCollapsedBatches] = useState({ high: false, medium: false, low: false });

  // Outreach Sites & Budget Optimization State
  const [availableOutreachSites, setAvailableOutreachSites] = useState([]);
  const [budgetOptimization, setBudgetOptimization] = useState(null);
  const [selectedOutreachSites, setSelectedOutreachSites] = useState({});
  const [latestAiRunId, setLatestAiRunId] = useState(null);
  const [latestAiSummary, setLatestAiSummary] = useState('');
  const [createdActivitiesList, setCreatedActivitiesList] = useState([]);

  // ─── Saved AI-run viewer (read-only popup) ───
  const [aiRunModalOpen, setAiRunModalOpen] = useState(false);
  const [aiRunModalProject, setAiRunModalProject] = useState(null);
  const [aiRunList, setAiRunList] = useState([]);
  const [aiRunActiveId, setAiRunActiveId] = useState(null);
  const [aiRunKeywords, setAiRunKeywords] = useState([]);
  const [aiRunLoading, setAiRunLoading] = useState(false);

  const loadAiRunKeywords = async (runId) => {
    setAiRunActiveId(runId);
    setAiRunLoading(true);
    try {
      const data = await getCalendarAiRunApi(runId);
      setAiRunKeywords(Array.isArray(data?.keywords) ? data.keywords : []);
      if (data?.budget_summary || data?.summary) {
        setAiRunList(prev => prev.map(r => r.run_id === runId ? {
          ...r,
          summary: data.summary || r.summary,
          budget_summary: data.budget_summary || r.budget_summary,
          budget_used: data.budget_used ?? r.budget_used,
          quantity_requested: data.quantity_requested ?? r.quantity_requested
        } : r));
      }
    } catch (e) {
      console.warn('[CalendarPage] loadAiRunKeywords error:', e);
      setAiRunKeywords([]);
    } finally {
      setAiRunLoading(false);
    }
  };

  const openAiRunModal = async ({ projectName, activityId = null, activityName = '', activityItem = null }) => {
    const proj = (projects || []).find(p => p.name === projectName || p.domain === projectName) || null;
    const slug = proj?.slug || String(projectName || '').toLowerCase().replace(/\s+/g, '');
    setAiRunModalProject({ name: projectName, slug, activityId, activityName, activityItem });
    setAiRunModalOpen(true);
    setAiRunLoading(true);
    setAiRunList([]);
    setAiRunKeywords([]);
    setAiRunActiveId(null);
    try {
      let loadedKeywords = [];
      let runMeta = null;

      // 1. If activity has an ai_run_id, fetch that exact AI run executed when it was hit
      if (activityItem?.ai_run_id) {
        try {
          const data = await getCalendarAiRunApi(activityItem.ai_run_id);
          if (data && Array.isArray(data.keywords) && data.keywords.length > 0) {
            loadedKeywords = data.keywords;
            runMeta = {
              run_id: activityItem.ai_run_id,
              summary: data.summary || activityItem.ai_summary,
              budget_summary: data.budget_summary || activityItem.budget_summary,
              budget_used: data.budget_used ?? activityItem.budget,
              quantity_requested: data.quantity_requested ?? activityItem.quantity,
              created_at: activityItem.created_at,
              total_keywords: data.keywords.length
            };
          }
        } catch (err) {
          console.warn('[CalendarPage] Error loading by ai_run_id:', err);
        }
      }

      // 2. If not found by ai_run_id, query run strictly linked to this specific activityId
      if (loadedKeywords.length === 0 && activityId) {
        try {
          const r = await listCalendarAiRunsApi(null, activityId, 1);
          const matchedRun = (r?.runs || []).find(x => String(x.activity_id) === String(activityId)) || (r?.runs || [])[0];
          if (matchedRun?.run_id) {
            const data = await getCalendarAiRunApi(matchedRun.run_id);
            if (data && Array.isArray(data.keywords) && data.keywords.length > 0) {
              loadedKeywords = data.keywords;
              runMeta = {
                run_id: matchedRun.run_id,
                summary: data.summary || matchedRun.summary || activityItem?.ai_summary,
                budget_summary: data.budget_summary || matchedRun.budget_summary || activityItem?.budget_summary,
                budget_used: data.budget_used ?? matchedRun.budget_used ?? activityItem?.budget,
                quantity_requested: data.quantity_requested ?? matchedRun.quantity_requested ?? activityItem?.quantity,
                created_at: matchedRun.created_at || activityItem?.created_at,
                total_keywords: data.keywords.length
              };
            }
          }
        } catch (err) {
          console.warn('[CalendarPage] Error loading by activityId:', err);
        }
      }

      // 3. Directly load saved snapshot from activityItem (off_page_activities record when hit)
      if (activityItem) {
        let kws = [];
        if (Array.isArray(activityItem.potential_keywords)) {
          kws = activityItem.potential_keywords;
        } else if (typeof activityItem.potential_keywords === 'string') {
          try { kws = JSON.parse(activityItem.potential_keywords); } catch (_) { }
        }

        let bSum = activityItem.budget_summary;
        if (typeof bSum === 'string') {
          try { bSum = JSON.parse(bSum); } catch (_) { }
        }

        const pickedKws = new Set(kws.map(k => String(k.keyword || '').trim().toLowerCase()));
        if (pickedKws.size > 0 && loadedKeywords.length > 0) {
          loadedKeywords = loadedKeywords.map(k => ({
            ...k,
            selected: k.selected || pickedKws.has(String(k.keyword || '').trim().toLowerCase())
          }));
        }

        // If loadedKeywords from run is empty, construct from the activity's saved keywords
        if (loadedKeywords.length === 0 && kws.length > 0) {
          loadedKeywords = kws.map((k, idx) => ({
            id: k.id || `k-${idx}`,
            keyword: k.keyword,
            category: k.category,
            cluster: k.cluster,
            batch: k.push_batch || (k.delta > 0 ? 'high' : (k.delta < 0 ? 'medium' : 'low')),
            live_rank: k.new_rank || k.rank,
            prev_rank: k.prev_rank || k.rank,
            delta: k.delta || 0,
            sv: k.sv,
            kd: k.kd,
            confidence: k.push_confidence || k.confidence || 80,
            reason: k.push_reason || k.reason || 'Strategic candidate with verified domain metrics',
            outreach_site: k.outreach_site,
            landing_page_url: k.landing_page_url || k.topic_link || k.topicLink,
            budget_summary: bSum,
            selected: true
          }));
        } else if (loadedKeywords.length === 0 && activityItem.keyword_name) {
          const kwNames = String(activityItem.keyword_name).split(',').map(s => s.trim()).filter(Boolean);
          loadedKeywords = kwNames.map((kw, idx) => ({
            id: `k-${idx}`,
            keyword: kw,
            category: activityItem.category || 'General',
            cluster: activityItem.cluster || 'General',
            batch: 'high',
            live_rank: 5,
            prev_rank: 5,
            delta: 0,
            sv: 0,
            kd: 0,
            confidence: 80,
            reason: 'Scheduled keyword for off-page activity',
            outreach_site: (Array.isArray(activityItem.outreach_sites) && activityItem.outreach_sites[idx]) || null,
            landing_page_url: activityItem.topic_link || '',
            budget_summary: bSum,
            selected: true
          }));
        }

        if (!runMeta) {
          runMeta = {
            run_id: activityItem.ai_run_id || `activity-${activityItem.id}`,
            summary: activityItem.ai_summary || `Scheduled activities and keywords for ${activityItem.activity_name}`,
            ai_advisory: activityItem.ai_advisory,
            budget_summary: bSum,
            budget_used: activityItem.budget,
            quantity_requested: activityItem.quantity,
            created_at: activityItem.created_at,
            total_keywords: loadedKeywords.length || kws.length
          };
        } else {
          if (!runMeta.budget_summary && bSum) runMeta.budget_summary = bSum;
          if (!runMeta.ai_advisory && activityItem.ai_advisory) runMeta.ai_advisory = activityItem.ai_advisory;
          if (!runMeta.summary && activityItem.ai_summary) runMeta.summary = activityItem.ai_summary;
        }
      }

      if (runMeta) {
        setAiRunList([runMeta]);
        setAiRunActiveId(runMeta.run_id);
      }
      setAiRunKeywords(loadedKeywords);
    } catch (e) {
      console.warn('[CalendarPage] openAiRunModal error:', e);
      setAiRunKeywords([]);
      setAiRunList([]);
    } finally {
      setAiRunLoading(false);
    }
  };

  const closeAiRunModal = () => {
    setAiRunModalOpen(false);
    setAiRunModalProject(null);
    setAiRunList([]);
    setAiRunKeywords([]);
    setAiRunActiveId(null);
  };

  const handleSelectSiteForKeyword = (kwId, site) => {
    if (site && site.domain) {
      const alreadyAssignedCount = Object.entries(selectedOutreachSites).filter(
        ([id, s]) => String(id) !== String(kwId) && s?.domain === site.domain
      ).length;
      if (alreadyAssignedCount >= 4) {
        alert(`Only 4 keywords can be assigned to one outreach site (${site.domain}). Please pick a different site.`);
        return;
      }
    }
    setSelectedOutreachSites(prev => ({
      ...prev,
      [kwId]: site
    }));
  };

  // Period Selector defaults
  const now = new Date();
  const [periodMonth, setPeriodMonth] = useState(MONTH_NAMES[now.getMonth()]);
  const [periodYear, setPeriodYear] = useState(now.getFullYear());

  // Users list from DB for Scheduler dropdown
  const [usersList, setUsersList] = useState([]);
  const [landingPageErrorNotice, setLandingPageErrorNotice] = useState(null);

  // Multi-activity list in Step 1 modal
  const [activitiesList, setActivitiesList] = useState([
    { id: 'act-1', activity_name: 'Paid Guest Post', quantity: 1, budget: '₹250' }
  ]);

  // Form POC and metadata state
  const [formData, setFormData] = useState({
    project_name: '',
    main_poc: '',
    content_poc: 'Content Lead',
    auditor: 'SEO Audit Team',
    channel: 'off-page'
  });

  const toggleBatchCollapse = (key) => {
    setCollapsedBatches(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleProjectExpand = (pName) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(pName)) next.delete(pName);
      else next.add(pName);
      return next;
    });
  };

  const selectedByBatch = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    ['high', 'medium', 'low'].forEach(bKey => {
      (pushBatches[bKey] || []).forEach(item => {
        if (selectedKwIds.has(item.id)) counts[bKey]++;
      });
    });
    return counts;
  }, [pushBatches, selectedKwIds]);

  const uniqueLandingPagesCount = useMemo(() => {
    const set = new Set();
    potentialKws.forEach(k => {
      const lp = k.landing_page_url || k.topicLink || topicLinks[k.id];
      if (lp) set.add(lp);
    });
    return Math.max(1, set.size);
  }, [potentialKws, topicLinks]);

  // Load Off-Page Activities + Projects + Notifications
  const loadData = async () => {
    setLoading(true);
    try {
      const res = await listCalendarActivitiesApi().catch(() => ({ activities: [] }));
      const loaded = res.activities || [];
      setActivities(loaded);
      // Auto-expand all unique projects initially so tree structure is visible
      const projsInActivities = new Set(loaded.map(a => a.project_name || 'General'));
      setExpandedProjects(projsInActivities);
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
    fetchCalendarUsersApi()
      .then(users => {
        if (Array.isArray(users) && users.length > 0) {
          setUsersList(users);
        }
      })
      .catch(err => console.warn('[CalendarPage] Error loading users for scheduler:', err));
  }, []);

  const handleSelectProject = (proj) => {
    setActiveProject(proj);
    localStorage.setItem('bd_selected_project', proj.slug);
    setProjectMenuOpen(false);
  };

  // Normalize status helper: 'saved' | 'scheduled' | 'approved' | 'published'
  const getNormalizedStatus = (itemStatus) => {
    if (!itemStatus) return 'saved';
    const s = String(itemStatus).toLowerCase().trim();
    if (s.includes('pub') || s.includes('live')) return 'published';
    if (s.includes('sched') || s.includes('pending')) return 'scheduled';
    if (s.includes('appr') || s.includes('comp') || s.includes('done')) return 'approved';
    return 'saved';
  };

  // Filter activities by active project, active sub-tab, and search query
  const filteredActivities = useMemo(() => {
    return activities.filter(item => {
      const normStatus = getNormalizedStatus(item.status);
      if (normStatus !== activeSubTab) return false;

      if (activeProject && item.project_name && item.project_name !== 'General') {
        const itemProj = String(item.project_name).toLowerCase().trim();
        const curProjName = String(activeProject.name || activeProject.domain || '').toLowerCase().trim();
        const curProjSlug = String(activeProject.slug || '').toLowerCase().trim();
        if (itemProj && !curProjName.includes(itemProj) && !curProjSlug.includes(itemProj) && !itemProj.includes(curProjName)) {
          // keep if general or matches search
        }
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = String(item.activity_name || '').toLowerCase().includes(q);
        const matchesProj = String(item.project_name || '').toLowerCase().includes(q);
        const matchesPoc = String(item.main_poc || '').toLowerCase().includes(q) || String(item.content_poc || '').toLowerCase().includes(q);
        const matchesScheduler = String(item.scheduler || '').toLowerCase().includes(q);
        if (!matchesName && !matchesProj && !matchesPoc && !matchesScheduler) return false;
      }

      return true;
    });
  }, [activities, activeSubTab, activeProject, searchQuery]);

  // Group filtered activities by project for Tree Structure display
  const groupedProjects = useMemo(() => {
    const map = new Map();
    filteredActivities.forEach(act => {
      const pName = act.project_name || 'General';
      if (!map.has(pName)) {
        map.set(pName, {
          projectName: pName,
          items: [],
          totalBudget: 0,
          totalQuantity: 0,
          hasAi: false,
          period: act.period || `${periodMonth} ${periodYear}`,
          channel: act.channel || 'off-page',
          primaryActivityId: act.id
        });
      }
      const entry = map.get(pName);
      entry.items.push(act);
      entry.totalQuantity += parseInt(act.quantity || 1, 10);
      const bNum = parseFloat(String(act.budget || '0').replace(/[^0-9.]/g, '')) || 0;
      entry.totalBudget += bNum;
      if (act.is_ai_scheduled || String(act.scheduler || '').toLowerCase().includes('ai')) {
        entry.hasAi = true;
      }
    });
    return Array.from(map.values());
  }, [filteredActivities, periodMonth, periodYear]);

  // Counts by tab
  const counts = useMemo(() => {
    return {
      saved: activities.filter(a => getNormalizedStatus(a.status) === 'saved').length,
      scheduled: activities.filter(a => getNormalizedStatus(a.status) === 'scheduled').length,
      approved: activities.filter(a => getNormalizedStatus(a.status) === 'approved').length,
      published: activities.filter(a => getNormalizedStatus(a.status) === 'published').length
    };
  }, [activities]);

  // Multi-activity row helpers
  const handleAddActivityRow = () => {
    setActivitiesList(prev => [
      ...prev,
      { id: `act-${Date.now()}`, activity_name: 'Forum - Quora', quantity: 1, budget: '₹150' }
    ]);
  };

  const handleUpdateActivityRow = (id, field, value) => {
    setActivitiesList(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
  };

  const handleRemoveActivityRow = (id) => {
    if (activitiesList.length <= 1) return;
    setActivitiesList(prev => prev.filter(a => a.id !== id));
  };

  const handleDivideBudgetAndQuantityEvenly = () => {
    if (activitiesList.length <= 1) return;
    const totalB = activitiesList.reduce((acc, a) => acc + (parseFloat(String(a.budget || '0').replace(/[^0-9.]/g, '')) || 0), 0) || 500;
    const totalQ = activitiesList.reduce((acc, a) => acc + (parseInt(a.quantity, 10) || 1), 0) || activitiesList.length;
    
    const count = activitiesList.length;
    const perActBudget = Math.round(totalB / count);
    const baseQty = Math.floor(totalQ / count) || 1;
    const remQty = totalQ % count;

    setActivitiesList(prev => prev.map((a, idx) => ({
      ...a,
      quantity: baseQty + (idx < remQty ? 1 : 0),
      budget: `₹${perActBudget.toLocaleString()}`
    })));
  };

  // Form Handlers
  const handleOpenAddModal = () => {
    setEditingItem(null);
    setModalStep('form');
    setAiSchedulingEnabled(true);
    setConfirmAiModalOpen(false);
    setSavingActivity(false);
    setLoadingKeywords(false);
    setAnalyzingPotential(false);
    setStep2ViewMode('strategy');
    setPushBatches({ high: [], medium: [], low: [] });
    setCollapsedBatches({ high: false, medium: false, low: false });
    setPotentialKws([]);
    setSelectedKwIds(new Set());
    setTopicLinks({});
    setCreatedActivity(null);
    setAvailableOutreachSites([]);
    setBudgetOptimization(null);
    setSelectedOutreachSites({});
    setLandingPageErrorNotice(null);
    setActivitiesList([
      { id: 'act-1', activity_name: 'Paid Guest Post', quantity: 1, budget: '₹250' }
    ]);
    setFormData({
      project_name: activeProject?.name || activeProject?.domain || (projects[0]?.name || projects[0]?.domain || ''),
      main_poc: '',
      content_poc: 'Content Lead',
      auditor: 'SEO Audit Team',
      channel: 'off-page'
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (item) => {
    setEditingItem(item);
    setModalStep('form');
    setAiSchedulingEnabled(Boolean(item.is_ai_scheduled || String(item.scheduler || '').toLowerCase().includes('ai')));
    setSavingActivity(false);
    setCreatedActivity(null);
    setLandingPageErrorNotice(null);
    setActivitiesList([
      { id: item.id, activity_name: item.activity_name || 'Paid Guest Post', quantity: item.quantity || 1, budget: item.budget || '₹250' }
    ]);
    if (item.period) {
      const parts = String(item.period).split(' ');
      if (parts.length >= 2 && MONTH_NAMES.includes(parts[0])) {
        setPeriodMonth(parts[0]);
        setPeriodYear(parseInt(parts[1], 10) || now.getFullYear());
      }
    }
    setFormData({
      project_name: item.project_name || '',
      main_poc: item.main_poc || '',
      content_poc: item.content_poc || 'Content Lead',
      auditor: item.auditor || 'SEO Audit Team',
      channel: item.channel || 'off-page'
    });
    setIsModalOpen(true);
  };

  // ─── SAVE AS DRAFT (Manual or Direct Draft) ───
  const handleSaveAsDraft = async (e) => {
    if (e) e.preventDefault();
    if (!formData.project_name) {
      alert('Please select a Project Name');
      return;
    }

    setSavingActivity(true);
    try {
      const formattedPeriod = `${periodMonth} ${periodYear}`;

      if (editingItem) {
        const primaryAct = activitiesList[0] || {};
        const payload = {
          activity_name: primaryAct.activity_name,
          quantity: parseInt(primaryAct.quantity, 10) || 1,
          budget: primaryAct.budget,
          project_name: formData.project_name,
          main_poc: formData.main_poc,
          content_poc: formData.content_poc,
          auditor: formData.auditor,
          period: formattedPeriod,
          channel: formData.channel || 'off-page',
          scheduler: aiSchedulingEnabled ? 'AI Auto-Scheduler' : (formData.main_poc || 'Manual Scheduler'),
          status: 'saved'
        };
        await updateCalendarActivityApi(editingItem.id, payload);
        setActivities(prev => prev.map(a => a.id === editingItem.id ? { ...a, ...payload } : a));
        setIsModalOpen(false);
        setSavingActivity(false);
        setActiveSubTab('saved');
        return;
      }

      // Create each activity in the batch as draft
      const newCreatedList = [];
      for (const act of activitiesList) {
        const payload = {
          activity_name: act.activity_name,
          project_name: formData.project_name,
          main_poc: formData.main_poc,
          content_poc: formData.content_poc,
          auditor: formData.auditor,
          quantity: parseInt(act.quantity, 10) || 1,
          budget: act.budget,
          period: formattedPeriod,
          channel: formData.channel || 'off-page',
          scheduler: aiSchedulingEnabled ? 'AI Auto-Scheduler' : (formData.main_poc || 'Manual Scheduler'),
          status: 'saved'
        };
        const res = await createCalendarActivityApi(payload);
        newCreatedList.push(res);
      }

      setActivities(prev => [...newCreatedList, ...prev]);
      setIsModalOpen(false);
      setSavingActivity(false);
      setActiveSubTab('saved');
    } catch (err) {
      alert(`Error saving activities: ${err.message}`);
      setSavingActivity(false);
    }
  };

  // ─── EXECUTE AI SCHEDULE (Runs scanning & live ranking after confirmation) ───
  const handleExecuteAiSchedule = async () => {
    setConfirmAiModalOpen(false);
    setSavingActivity(true);

    try {
      const formattedPeriod = `${periodMonth} ${periodYear}`;
      const primaryAct = activitiesList[0] || { activity_name: 'Paid Guest Post', quantity: 1, budget: '₹250' };

      // Calculate total requested quantity and budget across multi-activity batch
      let totalQty = 0;
      let totalBudget = 0;
      for (const act of activitiesList) {
        totalQty += parseInt(act.quantity, 10) || 1;
        const b = parseFloat(String(act.budget || '0').replace(/[^0-9.]/g, '')) || 0;
        totalBudget += b;
      }

      // Create base activities in DB
      const newCreatedList = [];
      for (const act of activitiesList) {
        const payload = {
          activity_name: act.activity_name,
          project_name: formData.project_name,
          main_poc: 'AI Auto-Scheduler',
          content_poc: formData.content_poc || 'Content Lead',
          auditor: formData.auditor || 'SEO Audit Team',
          quantity: parseInt(act.quantity, 10) || 1,
          budget: act.budget,
          period: formattedPeriod,
          channel: formData.channel || 'off-page',
          scheduler: 'AI Auto-Scheduler',
          status: 'saved'
        };
        const created = await createCalendarActivityApi(payload);
        newCreatedList.push(created);
      }

      setActivities(prev => [...newCreatedList, ...prev]);
      setCreatedActivitiesList(newCreatedList);
      const primaryCreated = newCreatedList[0];
      setCreatedActivity(primaryCreated);

      // Transition to Step 2
      setModalStep('keywords_prompt');
      setStep2ViewMode('strategy');
      setSavingActivity(false);
      setLoadingKeywords(true);
      setLoadingStepText('Scanning database for candidate Landing Page keywords (Rank 5+)...');

      const matchedProj = projects.find(p => (p.name || p.domain) === formData.project_name);
      const slug = matchedProj?.slug || formData.project_name.toLowerCase().replace(/\s+/g, '');
      const domain = matchedProj?.domain || '';

      // Step 1: Query candidates with budget and quantity optimization
      const res = await fetchCalendarPotentialKeywordsApi(slug, domain, false, totalBudget, totalQty);
      const kws = res.potential_keywords || [];
      const fallbackBatches = res.batches || { high: [], medium: [], low: [] };

      if (res.available_outreach_sites) {
        setAvailableOutreachSites(res.available_outreach_sites);
      }
      if (res.budget_optimization) {
        setBudgetOptimization(res.budget_optimization);
      }

      const initialSites = {};
      kws.forEach(k => {
        if (k.outreach_site) {
          initialSites[k.id] = k.outreach_site;
        }
      });
      setSelectedOutreachSites(initialSites);

      if (res.has_landing_pages === false || kws.length === 0) {
        setPotentialKws([]);
        setPushBatches({ high: [], medium: [], low: [] });
        setSelectedKwIds(new Set());
        setLoadingKeywords(false);
        setLandingPageErrorNotice(res.summary || "Data does not have landing page URLs.");
        return;
      }
      setLandingPageErrorNotice(null);

      const initialTopicLinks = {};
      kws.forEach(k => {
        const lp = k.landing_page_url || k.topicLink || k.topic_link;
        if (lp) {
          initialTopicLinks[k.id] = lp;
        }
      });
      setTopicLinks(initialTopicLinks);

      // Step 2: Live ranking ping with budget and quantity optimization
      setLoadingStepText(`Analyzing Keywords...`);
      setAnalyzingPotential(true);

      try {
        const aiRes = await analyzeCalendarAiPushPotentialApi(slug, domain, kws, 'India', totalBudget, totalQty, primaryCreated?.id);
        if (aiRes?.run_id) setLatestAiRunId(aiRes.run_id);
        if (aiRes?.summary) setLatestAiSummary(aiRes.summary);
        if (aiRes?.batches) {
          setPushBatches(aiRes.batches);
          const evaluated = (aiRes.evaluated_keywords && aiRes.evaluated_keywords.length > 0)
            ? aiRes.evaluated_keywords
            : kws;
          setPotentialKws(evaluated);

          if (aiRes.available_outreach_sites) {
            setAvailableOutreachSites(aiRes.available_outreach_sites);
          }
          if (aiRes.budget_optimization) {
            setBudgetOptimization(aiRes.budget_optimization);
          }

          setSelectedOutreachSites(prev => {
            const next = { ...prev };
            evaluated.forEach(ek => {
              if (ek.outreach_site && !next[ek.id]) {
                next[ek.id] = ek.outreach_site;
              }
            });
            return next;
          });

          setTopicLinks(prev => {
            const next = { ...prev };
            evaluated.forEach(ek => {
              const lp = ek.landing_page_url || ek.topicLink || ek.topic_link;
              if (lp && !next[ek.id]) {
                next[ek.id] = lp;
              }
            });
            return next;
          });

          // Auto-select Batch 1 (Gains) & Batch 2 (Drops) - strictly 4 keywords per outreach site
          const maxAutoSelect = (totalQty || 1) * 4;
          const b1and2 = [
            ...(aiRes.batches.high || []).map(k => k.id),
            ...(aiRes.batches.medium || []).map(k => k.id)
          ].slice(0, maxAutoSelect);
          setSelectedKwIds(new Set(b1and2));
        } else {
          setPotentialKws(kws);
          setPushBatches(fallbackBatches);
          const maxAutoSelect = (totalQty || 1) * 4;
          const fallbackList = [
            ...(fallbackBatches.high || []).map(k => k.id),
            ...(fallbackBatches.medium || []).map(k => k.id)
          ].slice(0, maxAutoSelect);
          setSelectedKwIds(new Set(fallbackList));
        }
      } catch (liveErr) {
        console.warn('[CalendarPage] Live rank check notice:', liveErr);
        setPotentialKws(kws);
        setPushBatches(fallbackBatches);
        const maxAutoSelect = (totalQty || 1) * 4;
        const liveFallbackList = [
          ...(fallbackBatches.high || []).map(k => k.id),
          ...(fallbackBatches.medium || []).map(k => k.id)
        ].slice(0, maxAutoSelect);
        setSelectedKwIds(new Set(liveFallbackList));
      } finally {
        setAnalyzingPotential(false);
        setLoadingKeywords(false);
      }
    } catch (err) {
      alert(`Error running AI schedule: ${err.message}`);
      setSavingActivity(false);
      setLoadingKeywords(false);
    }
  };

  // ─── CONFIRM & SCHEDULE KEYWORDS FROM STEP 2 ───
  const handleConfirmAddKeywords = async () => {
    if (!createdActivity) {
      setIsModalOpen(false);
      return;
    }
    setSavingActivity(true);
    try {
      const isPaidGuestPost = String(createdActivity?.activity_name || '').toLowerCase().includes('guest');
      const batchById = new Map();
      ['high', 'medium', 'low'].forEach(b => (pushBatches[b] || []).forEach(r => batchById.set(r.id, r)));

      const selectedPotential = potentialKws.filter(k => selectedKwIds.has(k.id)).map(k => {
        const info = batchById.get(k.id) || {};
        const chosenSite = selectedOutreachSites[k.id] || k.outreach_site || null;
        const lp = (topicLinks[k.id] !== undefined && topicLinks[k.id] !== '')
          ? topicLinks[k.id]
          : (k.topic_link || k.landing_page_url || k.topicLink || '');
        return {
          keyword: k.keyword,
          category: k.category,
          cluster: k.cluster,
          rank: k.new_rank || k.rank,
          prev_rank: k.prev_rank || k.rank,
          new_rank: k.new_rank || k.rank,
          delta: k.delta || 0,
          sv: k.sv,
          kd: k.kd,
          target_type: k.target_type || 'Landing Page',
          top3_is_landing: k.top3_is_landing ?? info.top3_is_landing ?? true,
          push_batch: info.batch || null,
          push_confidence: info.confidence ?? null,
          push_reason: info.reason || '',
          topic_link: lp,
          landing_page_url: lp,
          outreach_site: chosenSite
        };
      });

      const updatePayload = {
        potential_keywords: selectedPotential,
        status: 'scheduled',
        ai_summary: latestAiSummary || `Analyzed ${potentialKws.length} keywords for ${formData.project_name}`,
        ai_advisory: budgetOptimization?.anti_waste_advisory || '',
        budget_summary: budgetOptimization,
        outreach_sites: selectedPotential.map(k => k.outreach_site).filter(Boolean),
        ai_run_id: latestAiRunId
      };
      if (selectedPotential.length > 0) {
        updatePayload.keyword_name = selectedPotential.map(k => k.keyword).join(', ');
        updatePayload.category = selectedPotential[0].category;
        updatePayload.cluster = selectedPotential[0].cluster;
        updatePayload.topic_link = selectedPotential.map(k => k.topic_link || k.landing_page_url).filter(Boolean).join(' | ');
      }

      const targets = (createdActivitiesList && createdActivitiesList.length > 0)
        ? createdActivitiesList
        : [createdActivity];

      const totalPlannedSpend = (budgetOptimization?.planned_spend !== undefined && budgetOptimization.planned_spend > 0)
        ? budgetOptimization.planned_spend
        : activitiesList.reduce((acc, a) => acc + (parseFloat(String(a.budget || '0').replace(/[^0-9.]/g, '')) || 0), 0) || 250;

      const totalAllocatedBudget = activitiesList.reduce((acc, a) => acc + (parseFloat(String(a.budget || '0').replace(/[^0-9.]/g, '')) || 0), 0);

      let kwCursor = 0;
      const updatedTargets = [];
      for (let i = 0; i < targets.length; i++) {
        const tgt = targets[i];
        const actSpec = activitiesList[i] || activitiesList[0] || {};
        const actReqQty = parseInt(actSpec.quantity || tgt.quantity, 10) || 1;
        const actReqBudget = parseFloat(String(actSpec.budget || tgt.budget || '0').replace(/[^0-9.]/g, '')) || (totalAllocatedBudget / (activitiesList.length || 1));
        const budgetWeight = totalAllocatedBudget > 0 ? (actReqBudget / totalAllocatedBudget) : (1 / (activitiesList.length || 1));
        const tgtBudget = Math.round(totalPlannedSpend * budgetWeight) || Math.round(totalPlannedSpend / (activitiesList.length || 1));

        const tgtMaxKws = actReqQty * 4;
        const tgtKws = selectedPotential.slice(kwCursor, kwCursor + tgtMaxKws);
        kwCursor += tgtMaxKws;

        const effectiveKws = tgtKws.length > 0 ? tgtKws : selectedPotential.slice(0, tgtMaxKws);
        const tgtPayload = {
          ...updatePayload,
          quantity: actReqQty,
          budget: `₹${tgtBudget.toLocaleString()}`,
          potential_keywords: effectiveKws,
          outreach_sites: effectiveKws.map(k => k.outreach_site).filter(Boolean)
        };
        if (effectiveKws.length > 0) {
          tgtPayload.keyword_name = effectiveKws.map(k => k.keyword).join(', ');
          tgtPayload.category = effectiveKws[0].category;
          tgtPayload.cluster = effectiveKws[0].cluster;
          tgtPayload.topic_link = effectiveKws.map(k => k.topic_link || k.landing_page_url).filter(Boolean).join(' | ');
        }
        await updateCalendarActivityApi(tgt.id, tgtPayload);
        updatedTargets.push({ id: tgt.id, payload: tgtPayload });
      }
      setActivities(prev => prev.map(a => {
        const found = updatedTargets.find(t => t.id === a.id);
        return found ? { ...a, ...found.payload } : a;
      }));
      setIsModalOpen(false);
      setActiveSubTab('scheduled');
    } catch (err) {
      alert(`Error scheduling keywords: ${err.message}`);
    } finally {
      setSavingActivity(false);
    }
  };

  // ─── MANUAL SCHEDULING: same hard gates as AI (Landing Page + rank 5+),
  //     then the user picks keywords themselves (no AI analysis) ───
  const handleManualChooseKeywords = async (e) => {
    if (e) e.preventDefault();
    if (!formData.project_name) { alert('Please select a Project Name'); return; }
    setSavingActivity(true);
    try {
      const formattedPeriod = `${periodMonth} ${periodYear}`;
      let totalQty = 0;
      let totalBudget = 0;
      for (const act of activitiesList) {
        totalQty += parseInt(act.quantity, 10) || 1;
        totalBudget += parseFloat(String(act.budget || '0').replace(/[^0-9.]/g, '')) || 0;
      }

      const newCreatedList = [];
      for (const act of activitiesList) {
        const payload = {
          activity_name: act.activity_name,
          project_name: formData.project_name,
          main_poc: formData.main_poc,
          content_poc: formData.content_poc,
          auditor: formData.auditor,
          quantity: parseInt(act.quantity, 10) || 1,
          budget: act.budget,
          period: formattedPeriod,
          channel: formData.channel || 'off-page',
          scheduler: formData.main_poc || 'Manual Scheduler',
          status: 'saved'
        };
        const res = await createCalendarActivityApi(payload);
        newCreatedList.push(res);
      }
      setActivities(prev => [...newCreatedList, ...prev]);
      setCreatedActivitiesList(newCreatedList);
      setCreatedActivity(newCreatedList[0]);

      setModalStep('manual_keywords');
      setSavingActivity(false);
      setLoadingKeywords(true);
      setKeywordSearch('');
      setLoadingStepText('Scanning for keywords...');

      const matchedProj = projects.find(p => (p.name || p.domain) === formData.project_name);
      const slug = matchedProj?.slug || formData.project_name.toLowerCase().replace(/\s+/g, '');
      const domain = matchedProj?.domain || '';

      const res = await fetchCalendarPotentialKeywordsApi(slug, domain, false, totalBudget, totalQty);
      const kws = res.potential_keywords || [];
      if (res.has_landing_pages === false) {
        setPotentialKws([]);
        setLandingPageErrorNotice(res.summary || 'Data does not have landing page URLs.');
      } else {
        setLandingPageErrorNotice(null);
        setPotentialKws(kws);
      }
      setSelectedKwIds(new Set());
      const links = {};
      kws.forEach(k => {
        const lp = k.landing_page_url || k.topic_link || k.topicLink;
        if (lp) links[k.id] = lp;
      });
      setTopicLinks(links);
      setLoadingKeywords(false);
    } catch (err) {
      alert(`Error loading keywords: ${err.message}`);
      setSavingActivity(false);
      setLoadingKeywords(false);
    }
  };

  const handleConfirmManualKeywords = async () => {
    const targets = (createdActivitiesList && createdActivitiesList.length > 0)
      ? createdActivitiesList
      : (createdActivity ? [createdActivity] : []);
    if (targets.length === 0) { setIsModalOpen(false); setModalStep('form'); return; }

    setSavingActivity(true);
    try {
      const selected = potentialKws.filter(k => selectedKwIds.has(k.id)).map(k => {
        const lp = (topicLinks[k.id] !== undefined && topicLinks[k.id] !== '')
          ? topicLinks[k.id]
          : (k.landing_page_url || k.topic_link || k.topicLink || '');
        return {
          keyword: k.keyword,
          category: k.category,
          cluster: k.cluster,
          rank: k.rank,
          prev_rank: k.prev_rank ?? k.rank,
          new_rank: k.new_rank ?? k.rank,
          delta: k.delta ?? 0,
          sv: k.sv,
          kd: k.kd,
          target_type: k.target_type || 'Landing Page',
          topic_link: lp,
          landing_page_url: lp,
          outreach_site: k.outreach_site || null
        };
      });

      const per = Math.max(1, Math.ceil(selected.length / targets.length));
      const updated = [];
      for (let i = 0; i < targets.length; i++) {
        const tgt = targets[i];
        const eff = targets.length === 1 ? selected : selected.slice(i * per, (i + 1) * per);
        const payload = { potential_keywords: eff, status: 'scheduled' };
        if (eff.length > 0) {
          payload.keyword_name = eff.map(k => k.keyword).join(', ');
          payload.category = eff[0].category;
          payload.cluster = eff[0].cluster;
          payload.topic_link = eff.map(k => k.topic_link || k.landing_page_url).filter(Boolean).join(' | ');
        }
        await updateCalendarActivityApi(tgt.id, payload);
        updated.push({ id: tgt.id, payload });
      }
      setActivities(prev => prev.map(a => {
        const f = updated.find(t => t.id === a.id);
        return f ? { ...a, ...f.payload } : a;
      }));
      setIsModalOpen(false);
      setModalStep('form');
      setActiveSubTab('scheduled');
    } catch (err) {
      alert(`Error scheduling keywords: ${err.message}`);
    } finally {
      setSavingActivity(false);
    }
  };

  const handleMoveStatus = async (item, newStatus) => {
    try {
      const res = await updateCalendarActivityApi(item.id, { status: newStatus });
      const updatedAct = res?.activity || {};
      const firstUid = updatedAct.first_uid || (updatedAct.synced_uids && updatedAct.synced_uids[0]) || `${item.activity_uid || 'ACT'}-KW1`;

      setActivities(prev => prev.map(a => a.id === item.id ? {
        ...a,
        status: newStatus,
        first_uid: firstUid,
        synced_uids: updatedAct.synced_uids || a.synced_uids
      } : a));
    } catch (err) {
      console.error('[CalendarPage] Error moving status:', err);
    }
  };

  const handleDeleteItem = async (item) => {
    if (!window.confirm(`Are you sure you want to delete "${item.activity_name}"?`)) return;
    try {
      await deleteCalendarActivityApi(item.id);
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
    const headers = ['Activity UID', 'Activity Name', 'Project Name', 'Main POC', 'Content POC', 'Quantity', 'Budget (₹)', 'Period', 'Scheduler', 'Auditor', 'Status'];
    const rows = filteredActivities.map(a => [
      `"${(a.activity_uid || '').replace(/"/g, '""')}"`,
      `"${(a.activity_name || '').replace(/"/g, '""')}"`,
      `"${(a.project_name || '').replace(/"/g, '""')}"`,
      `"${(a.main_poc || '').replace(/"/g, '""')}"`,
      `"${(a.content_poc || '').replace(/"/g, '""')}"`,
      a.quantity || 1,
      `"${String(a.budget || '').replace(/[$]/g, '₹').replace(/"/g, '""')}"`,
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

  // ─────────────────────────────────────────────────────────────
  // STEP 2: AI STRATEGIC DECISION & KEYWORD EVALUATION VIEW
  // ─────────────────────────────────────────────────────────────
  if (isModalOpen && modalStep === 'keywords_prompt') {
    const isPaidGuestPost = String(createdActivity?.activity_name || formData.activity_name || '').toLowerCase().includes('guest');
    const totalAllocatedBudget = activitiesList.reduce((acc, a) => acc + (parseFloat(String(a.budget || '0').replace(/[^0-9.]/g, '')) || 0), 0);
    const totalAllocatedBudgetFormatted = totalAllocatedBudget > 0 ? `₹${totalAllocatedBudget.toLocaleString()}` : '₹250';
    const totalRequestedQuantity = activitiesList.reduce((acc, a) => acc + (parseInt(a.quantity, 10) || 1), 0);

    const totalPlannedSpend = (budgetOptimization?.planned_spend !== undefined && budgetOptimization.planned_spend > 0)
      ? budgetOptimization.planned_spend
      : totalAllocatedBudget;

    const selectedPotential = potentialKws.filter(k => selectedKwIds.has(k.id));

    // Multi-activity division calculations
    let divKwCursor = 0;
    const activityDivisions = activitiesList.map((act, idx) => {
      const actReqQty = parseInt(act.quantity, 10) || 1;
      const actReqBudget = parseFloat(String(act.budget || '0').replace(/[^0-9.]/g, '')) || (totalAllocatedBudget / (activitiesList.length || 1));
      const budgetWeight = totalAllocatedBudget > 0 ? (actReqBudget / totalAllocatedBudget) : (1 / (activitiesList.length || 1));
      const allocatedBudget = Math.round(totalPlannedSpend * budgetWeight) || Math.round(totalPlannedSpend / (activitiesList.length || 1));

      const actKwsCapacity = actReqQty * 4;
      const assignedKeywords = selectedPotential.slice(divKwCursor, divKwCursor + actKwsCapacity);
      divKwCursor += actKwsCapacity;

      const assignedSites = assignedKeywords.map(k => selectedOutreachSites[k.id] || k.outreach_site).filter(Boolean);
      const uniqueSites = Array.from(new Map(assignedSites.map(s => [s.domain, s])).values());

      return {
        id: act.id,
        activity_name: act.activity_name,
        allocatedQuantity: actReqQty,
        allocatedBudget,
        allocatedBudgetFormatted: `₹${allocatedBudget.toLocaleString()}`,
        assignedKeywords,
        assignedSites,
        uniqueSites,
        keywordCount: assignedKeywords.length,
        kwsCapacity: actKwsCapacity
      };
    });

    const keywordToActivityMap = {};
    if (activitiesList.length > 1) {
      activityDivisions.forEach(div => {
        div.assignedKeywords.forEach(k => {
          keywordToActivityMap[k.id] = div.activity_name;
        });
      });
    }

    return (
      <div style={{ padding: '24px 32px', minHeight: '100%', background: '#F5F5F5', display: 'flex', flexDirection: 'column', gap: 20, fontFamily: "'Outfit', sans-serif" }}>
        {/* Top Header Card */}
        <div style={{
          background: '#FFFFFF',
          borderRadius: 14,
          border: '1px solid #E2DBEC',
          padding: '16px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          boxShadow: '0 2px 8px rgba(74, 26, 140, 0.04)'
        }}>
          {/* Left side: Back to Calendar button, Icon, Titles */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
            <button
              type="button"
              onClick={() => { setIsModalOpen(false); setModalStep('form'); }}
              title="Return to Calendar"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: '#F6EEFD',
                border: '1px solid #E5CCF7',
                color: '#7B2FBE',
                borderRadius: 8,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                flexShrink: 0
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#EDE0FA'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#F6EEFD'; }}
            >
              <ArrowLeft size={16} />
              <span>Back to Calendar</span>
            </button>

            <div style={{ width: 1, height: 28, background: '#E2DBEC', flexShrink: 0 }} />

            <div style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <Sparkles size={20} color="#FFFFFF" />
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: 18, fontWeight: 800, color: '#1A1A1A', margin: 0, letterSpacing: '-0.02em' }}>
                  AI Scheduling Decision &amp; Keyword Strategy
                </h1>
                {createdActivity?.project_name && (
                  <span style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: '#4A1A8C',
                    background: '#F6EEFD',
                    border: '1px solid #E5CCF7',
                    padding: '2px 8px',
                    borderRadius: 6
                  }}>
                    {createdActivity.project_name}
                  </span>
                )}
                {activitiesList.length > 1 ? (
                  activitiesList.map((act, i) => (
                    <span key={act.id || i} style={{
                      fontSize: 11.5,
                      fontWeight: 700,
                      color: '#7B2FBE',
                      background: '#F6EEFD',
                      border: '1px solid #E5CCF7',
                      padding: '2px 8px',
                      borderRadius: 6
                    }}>
                      {act.activity_name} ({act.quantity} qty · {activityDivisions[i]?.allocatedBudgetFormatted || act.budget})
                    </span>
                  ))
                ) : (
                  <span style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: '#7B2FBE',
                    background: '#F6EEFD',
                    border: '1px solid #E5CCF7',
                    padding: '2px 8px',
                    borderRadius: 6
                  }}>
                    {createdActivity?.activity_name || 'Campaign'}
                  </span>
                )}
              </div>
              <p style={{ fontSize: 12.5, color: '#8A8A9A', margin: '3px 0 0 0' }}>
                AI evaluated keyword intent, verified landing page SERPs, and divided optimal budget &amp; quantity across activities.
              </p>
            </div>
          </div>

        </div>

        {/* LOADING STATE */}
        {loadingKeywords ? (
          <div style={{
            background: '#FFFFFF',
            borderRadius: 14,
            border: '1px solid #E2DBEC',
            padding: '64px 32px',
            textAlign: 'center',
            boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06)'
          }}>
            <BrandInfinityLoader label={loadingStepText} size="lg" minHeight="240px" />
            <div style={{ marginTop: 24, fontSize: 13, color: '#8A8A9A', maxWidth: 520, margin: '16px auto 0' }}>
              {activitiesList.length > 1 ? (
                <>Scanning database and dividing <strong>₹{totalAllocatedBudgetFormatted}</strong> budget and <strong>{totalRequestedQuantity} activities</strong> across <strong>{activitiesList.length} activity channels</strong>...</>
              ) : (
                <>We are checking live rankings before showing recommendations.</>
              )}
            </div>
          </div>
        ) : potentialKws.length === 0 ? (
          <div style={{
            background: '#FFFFFF',
            borderRadius: 16,
            border: '1px solid #F8B4D9',
            padding: '56px 32px',
            textAlign: 'center',
            boxShadow: '0 4px 20px -2px rgba(212, 0, 122, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16
          }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: '#FDEBF4',
              color: '#D4007A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #F8B4D9'
            }}>
              <AlertCircle size={30} />
            </div>
            <div>
              <h3 style={{ fontSize: 19, fontWeight: 800, color: '#D4007A', margin: '0 0 8px 0' }}>
                {landingPageErrorNotice || "Data does not have landing page URLs."}
              </h3>

            </div>
            <button
              type="button"
              onClick={() => { setModalStep('form'); setIsModalOpen(false); }}
              style={{
                marginTop: 8,
                padding: '10px 24px',
                fontSize: 13.5,
                fontWeight: 700,
                background: 'linear-gradient(135deg, #CB196B 0%, #D4007A 100%)',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 10,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(212, 0, 122, 0.25)'
              }}
            >
              Back to Calendar
            </button>
          </div>
        ) : (
          <>
            {/* EXECUTIVE STRATEGY HERO CARD */}
            <div style={{
              background: '#FFFFFF',
              borderRadius: 16,
              border: '1px solid #E2DBEC',
              padding: '24px 28px',
              boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06)'
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 280 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: '#7B2FBE',
                      background: '#F6EEFD',
                      border: '1px solid #E5CCF7',
                      padding: '3px 10px',
                      borderRadius: 20
                    }}>
                      <Sparkles size={12} />
                      AI Autonomous Strategy
                    </span>
                    <span style={{ fontSize: 12, color: '#8A8A9A' }}>•</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#2D2D44' }}>
                      Period: {createdActivity?.period || `${periodMonth} ${periodYear}`}
                    </span>
                  </div>

                  <h2 style={{ fontSize: 19, fontWeight: 800, color: '#1A1A1A', margin: '0 0 10px 0', letterSpacing: '-0.02em' }}>
                    Executive Allocation &amp; Growth Narrative
                  </h2>

                  <p style={{ fontSize: 13.5, color: '#2D2D44', lineHeight: 1.6, margin: 0 }}>
                    For <strong>{createdActivity?.project_name || formData.project_name}</strong>, AI scanned{' '}
                    <strong>{potentialKws.length}</strong> candidate keywords and shortlisted{' '}
                    <strong style={{ color: '#7B2FBE' }}>{selectedKwIds.size} high-impact landing page targets</strong> across{' '}
                    <strong>{uniqueLandingPagesCount} unique landing pages</strong>.
                    {activitiesList.length > 1 ? (
                      <>
                        {' '}Budget and target volume are divided across <strong>{activitiesList.length} activities</strong>:{' '}
                        {activityDivisions.map(d => `${d.activity_name} (${d.allocatedQuantity} qty · ${d.allocatedBudgetFormatted} · ${d.keywordCount} kws)`).join(', ')}.
                      </>
                    ) : null}{' '}
                    Based on your requested <strong>{totalRequestedQuantity} activities</strong> and budget of{' '}
                    <strong>{totalAllocatedBudgetFormatted}</strong>, AI has prioritized{' '}
                    <strong style={{ color: '#D4007A' }}>{selectedByBatch.medium} dropped keywords (red alert recovery targets)</strong> and{' '}
                    <strong style={{ color: '#00BFA2' }}>{selectedByBatch.high} near-threshold gainers</strong>, avoiding redundant expenditure on keywords already performing in the Top 3.
                  </p>
                </div>

                {/* Primary Decision Action Buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 200 }}>
                  <button
                    type="button"
                    disabled={selectedKwIds.size === 0 || savingActivity}
                    onClick={handleConfirmAddKeywords}
                    style={{
                      padding: '11px 22px',
                      fontSize: 13.5,
                      fontWeight: 700,
                      color: '#FFFFFF',
                      background: (selectedKwIds.size === 0 || savingActivity) ? '#8A8A9A' : 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 100%)',
                      border: 'none',
                      borderRadius: 10,
                      cursor: (selectedKwIds.size === 0 || savingActivity) ? 'not-allowed' : 'pointer',
                      boxShadow: (selectedKwIds.size === 0 || savingActivity) ? 'none' : '0 4px 14px rgba(74, 26, 140, 0.35)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {savingActivity ? (
                      <>
                        <div style={{ width: 14, height: 14, border: '2px solid #FFFFFF', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        <span>Scheduling...</span>
                      </>
                    ) : (
                      <>
                        <Check size={16} />
                        <span>Confirm &amp; Schedule ({selectedKwIds.size})</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* 4 STRATEGIC KPI CARDS */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginTop: 22 }}>
                {/* Card 1: Keywords */}
                <div style={{ background: '#FFFFFF', border: '1px solid #E2DBEC', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8A8A9A', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Keywords Scanned vs Targeted
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: '#1A1A1A' }}>{selectedKwIds.size}</span>
                    <span style={{ fontSize: 13, color: '#8A8A9A' }}>of {potentialKws.length} scanned</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#00BFA2', background: '#E6FAF6', padding: '1px 6px', borderRadius: 6, border: '1px solid #A7F3D0' }}>
                      +{selectedByBatch.high} Gains
                    </span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#D4007A', background: '#FDEBF4', padding: '1px 6px', borderRadius: 6, border: '1px solid #F8B4D9' }}>
                      -{selectedByBatch.medium} Drops
                    </span>
                  </div>
                </div>

                {/* Card 2: Activities Allocation */}
                <div style={{ background: '#FFFFFF', border: '1px solid #E2DBEC', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8A8A9A', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Activities Planned
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: '#7B2FBE' }}>{totalRequestedQuantity}</span>
                    <span style={{ fontSize: 13, color: '#8A8A9A' }}>across {activitiesList.length} types</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#8A8A9A', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    {activitiesList.length > 1 ? (
                      activityDivisions.map((d, i) => (
                        <span key={i} style={{ color: '#4A1A8C', fontWeight: 600 }}>
                          {d.activity_name}: {d.allocatedQuantity}
                          {i < activityDivisions.length - 1 ? ' • ' : ''}
                        </span>
                      ))
                    ) : (
                      'Optimal activity pacing'
                    )}
                  </div>
                </div>

                {/* Card 3: Budget Optimization */}
                <div style={{ background: '#FFFFFF', border: '1px solid #E2DBEC', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8A8A9A', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Budget Allocation
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: '#00BFA2' }}>
                      {budgetOptimization?.planned_spend !== undefined ? `₹${budgetOptimization.planned_spend.toLocaleString()}` : totalAllocatedBudgetFormatted}
                    </span>
                    <span style={{ fontSize: 12, color: '#00BFA2', fontWeight: 600 }}>
                      {budgetOptimization?.projected_savings > 0 ? `Saves ₹${budgetOptimization.projected_savings.toLocaleString()}` : 'Optimized'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#8A8A9A', marginTop: 6 }}>
                    {activitiesList.length > 1 ? (
                      `Divided: ₹${Math.round(totalPlannedSpend / activitiesList.length).toLocaleString()} avg / activity`
                    ) : (
                      budgetOptimization?.total_budget_cap ? `Cap: ₹${budgetOptimization.total_budget_cap.toLocaleString()}` : 'Direct spend against high-ROI assets'
                    )}
                  </div>
                </div>

                {/* Card 4: Target Landing Pages */}
                <div style={{ background: '#FFFFFF', border: '1px solid #E2DBEC', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8A8A9A', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Landing Pages Targeted
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: '#1A1A1A' }}>{uniqueLandingPagesCount}</span>
                    <span style={{ fontSize: 13, color: '#8A8A9A' }}>Unique URLs</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#00BFA2', fontWeight: 700, marginTop: 6 }}>
                    100% Landing Page SERP Verified
                  </div>
                </div>
              </div>

              {/* AI Budget Allocation Advisory */}
              {budgetOptimization?.anti_waste_advisory && (
                <div style={{
                  marginTop: 18,
                  padding: '16px 20px',
                  borderRadius: 12,
                  background: '#FFFFFF',
                  border: '1px solid #E2DBEC',
                  borderLeft: '4px solid #7B2FBE',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 14,
                  boxShadow: '0 1px 3px rgba(26, 26, 26, 0.04), 0 4px 12px rgba(74, 26, 140, 0.03)'
                }}>
                  <div style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: '#F6EEFD',
                    color: '#7B2FBE',
                    border: '1px solid #E5CCF7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <Sparkles size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#1A1A1A', letterSpacing: '-0.01em' }}>
                        AI Budget Allocation Advisory
                      </span>
                      {budgetOptimization.projected_savings > 0 && (
                        <span style={{
                          fontSize: 11,
                          fontWeight: 700,
                          background: '#E6FAF6',
                          color: '#00BFA2',
                          border: '1px solid #A7F3D0',
                          padding: '2px 8px',
                          borderRadius: 20,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4
                        }}>
                          <TrendingDown size={12} />
                          ₹{budgetOptimization.projected_savings.toLocaleString()} Projected Savings
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 13, color: '#2D2D44', margin: '6px 0 0 0', lineHeight: 1.55 }}>
                      {budgetOptimization.anti_waste_advisory}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                      <div style={{
                        fontSize: 11.5,
                        color: '#2D2D44',
                        background: '#F5F5F5',
                        border: '1px solid #E2DBEC',
                        borderRadius: 6,
                        padding: '4px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5
                      }}>
                        <span style={{ color: '#8A8A9A' }}>Requested:</span>
                        <strong style={{ color: '#1A1A1A' }}>{budgetOptimization.requested_activities || budgetOptimization.requested_quantity} activities</strong>
                        <span style={{ color: '#8A8A9A' }}>(₹{(budgetOptimization.total_budget_cap || budgetOptimization.budget_cap)?.toLocaleString()})</span>
                      </div>
                      <div style={{
                        fontSize: 11.5,
                        color: '#2D2D44',
                        background: '#F6EEFD',
                        border: '1px solid #E5CCF7',
                        borderRadius: 6,
                        padding: '4px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5
                      }}>
                        <span style={{ color: '#4A1A8C', fontWeight: 600 }}>AI Recommended:</span>
                        <strong style={{ color: '#7B2FBE' }}>{budgetOptimization.recommended_activities || budgetOptimization.recommended_quantity} target keywords</strong>
                        <span style={{ color: '#4A1A8C' }}>(₹{budgetOptimization.planned_spend?.toLocaleString()})</span>
                      </div>
                      {budgetOptimization.target_country && (
                        <div style={{
                          fontSize: 11.5,
                          color: '#2D2D44',
                          background: '#F5F5F5',
                          border: '1px solid #E2DBEC',
                          borderRadius: 6,
                          padding: '4px 10px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5
                        }}>
                          <span style={{ color: '#8A8A9A' }}>Target:</span>
                          <strong style={{ color: '#1A1A1A' }}>{budgetOptimization.target_country}</strong>
                        </div>
                      )}
                      {budgetOptimization.target_industry && (
                        <div style={{
                          fontSize: 11.5,
                          color: '#2D2D44',
                          background: '#F5F5F5',
                          border: '1px solid #E2DBEC',
                          borderRadius: 6,
                          padding: '4px 10px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5
                        }}>
                          <span style={{ color: '#8A8A9A' }}>Industry Type:</span>
                          <strong style={{ color: '#1A1A1A' }}>{budgetOptimization.target_industry}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* DEDICATED MULTI-ACTIVITY BUDGET & QUANTITY DIVISION PANEL */}
              {activitiesList.length > 1 && (
                <div style={{
                  marginTop: 18,
                  background: '#FFFFFF',
                  border: '1px solid #E2DBEC',
                  borderRadius: 14,
                  padding: '18px 22px',
                  boxShadow: '0 2px 10px rgba(74, 26, 140, 0.04)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: '#F6EEFD',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '1px solid #E5CCF7'
                      }}>
                        <Layers size={17} color="#7B2FBE" />
                      </div>
                      <div>
                        <h3 style={{ fontSize: 15, fontWeight: 800, color: '#1A1A1A', margin: 0, letterSpacing: '-0.01em' }}>
                          Multi-Activity Budget &amp; Quantity Division
                        </h3>
                        <p style={{ fontSize: 12, color: '#8A8A9A', margin: '2px 0 0 0' }}>
                          AI divided total budget ({budgetOptimization?.planned_spend ? `₹${budgetOptimization.planned_spend.toLocaleString()}` : totalAllocatedBudgetFormatted}) and volume across {activitiesList.length} activity tracks (strictly 4 keywords per outreach site).
                        </p>
                      </div>
                    </div>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#00BFA2',
                      background: '#E6FAF6',
                      border: '1px solid #A7F3D0',
                      padding: '3px 10px',
                      borderRadius: 20
                    }}>
                      {activitiesList.length} Tracks Balanced
                    </span>
                  </div>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(auto-fit, minmax(280px, 1fr))`,
                    gap: 14
                  }}>
                    {activityDivisions.map((div, idx) => (
                      <div
                        key={div.id || idx}
                        style={{
                          background: '#F5F5F5',
                          border: '1px solid #E2DBEC',
                          borderRadius: 12,
                          padding: 16,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span style={{
                              fontSize: 10.5,
                              fontWeight: 800,
                              background: '#4A1A8C',
                              color: '#FFFFFF',
                              padding: '2px 7px',
                              borderRadius: 6
                            }}>
                              Track {idx + 1}
                            </span>
                            <strong style={{ fontSize: 14, color: '#1A1A1A', fontWeight: 800 }}>
                              {div.activity_name}
                            </strong>
                          </div>
                          <span style={{
                            fontSize: 11,
                            fontWeight: 800,
                            color: '#7B2FBE',
                            background: '#F6EEFD',
                            border: '1px solid #E5CCF7',
                            padding: '2px 8px',
                            borderRadius: 6
                          }}>
                            {div.keywordCount} / {div.kwsCapacity} kws
                          </span>
                        </div>

                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: 8,
                          background: '#FFFFFF',
                          border: '1px solid #E2DBEC',
                          borderRadius: 8,
                          padding: '10px 12px'
                        }}>
                          <div>
                            <div style={{ fontSize: 11, color: '#8A8A9A', fontWeight: 600 }}>Divided Budget</div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: '#00BFA2', marginTop: 2 }}>
                              {div.allocatedBudgetFormatted}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: '#8A8A9A', fontWeight: 600 }}>Divided Quantity</div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: '#7B2FBE', marginTop: 2 }}>
                              {div.allocatedQuantity} <span style={{ fontSize: 12, fontWeight: 600, color: '#8A8A9A' }}>act ({div.allocatedQuantity * 4} kws)</span>
                            </div>
                          </div>
                        </div>

                        {div.uniqueSites.length > 0 && (
                          <div style={{ fontSize: 11.5, color: '#2D2D44' }}>
                            <span style={{ color: '#8A8A9A' }}>Outreach Partner: </span>
                            <strong>{div.uniqueSites.map(s => s.domain).join(', ')}</strong>
                            <span style={{ color: '#00BFA2', marginLeft: 5, fontWeight: 700 }}>
                              (DA {div.uniqueSites[0].da} · {div.uniqueSites[0].price})
                            </span>
                          </div>
                        )}

                        {div.assignedKeywords.length > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            {div.assignedKeywords.slice(0, 3).map(ak => (
                              <span
                                key={ak.id}
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: 600,
                                  color: '#2D2D44',
                                  background: '#FFFFFF',
                                  border: '1px solid #E2DBEC',
                                  padding: '2px 7px',
                                  borderRadius: 5,
                                  maxWidth: 160,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}
                                title={ak.keyword}
                              >
                                {ak.keyword}
                              </span>
                            ))}
                            {div.assignedKeywords.length > 3 && (
                              <span style={{ fontSize: 10.5, color: '#8A8A9A' }}>
                                +{div.assignedKeywords.length - 3} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* KEYWORD BATCH TABLES */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {['high', 'medium', 'low'].map(batchKey => {
                const meta = PUSH_BATCH_META[batchKey];
                const rows = pushBatches[batchKey] || [];
                const isCollapsed = collapsedBatches[batchKey];
                const checkedCount = rows.filter(r => selectedKwIds.has(r.id)).length;

                return (
                  <div
                    key={batchKey}
                    style={{
                      background: '#FFFFFF',
                      borderRadius: 14,
                      border: `1px solid ${meta.border}`,
                      overflow: 'hidden',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.03)'
                    }}
                  >
                    {/* Batch Header */}
                    <div style={{
                      padding: '12px 20px',
                      background: meta.bg,
                      borderBottom: isCollapsed ? 'none' : `1px solid ${meta.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 12
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          background: '#FFFFFF',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: `1px solid ${meta.border}`
                        }}>
                          <meta.Icon size={16} color={meta.tint} />
                        </div>
                        <div>
                          <span style={{ fontSize: 14, fontWeight: 800, color: '#1A1A1A' }}>
                            {meta.label}
                          </span>
                          <span style={{
                            marginLeft: 8,
                            fontSize: 11,
                            fontWeight: 800,
                            padding: '2px 8px',
                            borderRadius: 10,
                            background: '#FFFFFF',
                            color: meta.tint,
                            border: `1px solid ${meta.border}`
                          }}>
                            {checkedCount} / {rows.length} selected
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {rows.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const allIds = rows.map(r => r.id);
                              const allChecked = allIds.every(id => selectedKwIds.has(id));
                              const next = new Set(selectedKwIds);
                              if (allChecked) allIds.forEach(id => next.delete(id));
                              else allIds.forEach(id => next.add(id));
                              setSelectedKwIds(next);
                            }}
                            style={{
                              fontSize: 11.5,
                              fontWeight: 700,
                              color: meta.tint,
                              background: '#FFFFFF',
                              border: `1px solid ${meta.border}`,
                              padding: '4px 10px',
                              borderRadius: 6,
                              cursor: 'pointer'
                            }}
                          >
                            {rows.every(r => selectedKwIds.has(r.id)) ? 'Deselect All' : 'Select All'}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => toggleBatchCollapse(batchKey)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#8A8A9A',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 12,
                            fontWeight: 600
                          }}
                        >
                          <span>{isCollapsed ? 'Expand' : 'Collapse'}</span>
                          {isCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
                        </button>
                      </div>
                    </div>

                    {/* Batch Table Body */}
                    {!isCollapsed && (
                      <>
                        {rows.length === 0 ? (
                          <div style={{ fontSize: 12.5, color: '#8A8A9A', fontStyle: 'italic', padding: '16px 20px' }}>
                            No keywords categorized into this batch.
                          </div>
                        ) : (
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, textAlign: 'left' }}>
                              <thead>
                                <tr style={{
                                  color: '#8A8A9A',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.04em',
                                  background: '#F5F5F5',
                                  borderBottom: '1px solid #E2DBEC'
                                }}>
                                  <th style={{ padding: '9px 12px', width: 44, textAlign: 'center' }}></th>
                                  <th style={{ padding: '9px 14px', minWidth: 240 }}>Keyword &amp; Strategy Intent</th>
                                  <th style={{ padding: '9px 14px', width: 170 }}>Rank Shift</th>
                                  <th style={{ padding: '9px 14px', width: 80 }}>SV</th>
                                  <th style={{ padding: '9px 14px', width: 60 }}>KD</th>
                                  <th style={{ padding: '9px 14px', width: 70 }}>Conf</th>
                                  <th style={{ padding: '9px 14px', minWidth: 220 }}>Live AI Status &amp; Rationale</th>
                                  <th style={{ padding: '9px 14px', width: 230 }}>Target Outreach Site</th>
                                  <th style={{ padding: '9px 14px', minWidth: 230 }}>Target Landing Page</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map(item => {
                                  const isChecked = selectedKwIds.has(item.id);
                                  const currentRank = item.new_rank ?? item.rank;
                                  const isInfoOpen = activeInfoKwId === item.id;

                                  return (
                                    <tr
                                      key={item.id}
                                      style={{
                                        borderTop: '1px solid #F5F5F5',
                                        background: isChecked ? '#F6EEFD' : 'transparent',
                                        transition: 'background-color 0.1s ease'
                                      }}
                                    >
                                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={(e) => {
                                            const next = new Set(selectedKwIds);
                                            if (e.target.checked) next.add(item.id);
                                            else next.delete(item.id);
                                            setSelectedKwIds(next);
                                          }}
                                          style={{ cursor: 'pointer', width: 16, height: 16, accentColor: '#7B2FBE' }}
                                        />
                                      </td>
                                      <td style={{ padding: '8px 14px', position: 'relative' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                          <div style={{ fontWeight: 700, color: '#1A1A1A', fontSize: 13 }}>{item.keyword}</div>
                                          {activitiesList.length > 1 && keywordToActivityMap[item.id] && (
                                            <span style={{
                                              fontSize: 10,
                                              fontWeight: 700,
                                              color: '#7B2FBE',
                                              background: '#F6EEFD',
                                              border: '1px solid #E5CCF7',
                                              padding: '1px 6px',
                                              borderRadius: 4,
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: 3
                                            }}>
                                              <Layers size={10} />
                                              <span>{keywordToActivityMap[item.id]}</span>
                                            </span>
                                          )}
                                          {/* Info (i) button with rationale explanation */}
                                          <button
                                            type="button"
                                            onClick={() => setActiveInfoKwId(isInfoOpen ? null : item.id)}
                                            title="View AI Strategy Justification"
                                            style={{
                                              background: 'transparent',
                                              border: 'none',
                                              cursor: 'pointer',
                                              padding: 2,
                                              color: isInfoOpen ? '#7B2FBE' : '#8A8A9A',
                                              display: 'flex',
                                              alignItems: 'center'
                                            }}
                                          >
                                            <Info size={14} />
                                          </button>
                                        </div>

                                        {/* Floating Justification Tooltip Popover */}
                                        {isInfoOpen && (
                                          <div style={{
                                            position: 'absolute',
                                            top: '100%',
                                            left: 14,
                                            zIndex: 60,
                                            background: '#2D2D44',
                                            color: '#FFFFFF',
                                            borderRadius: 8,
                                            padding: '10px 14px',
                                            maxWidth: 320,
                                            boxShadow: '0 10px 25px rgba(0,0,0,0.25)',
                                            fontSize: 12,
                                            lineHeight: 1.4,
                                            border: '1px solid #8A8A9A'
                                          }}>
                                            <div style={{ fontWeight: 700, color: '#00C2FF', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                              <Sparkles size={12} />
                                              <span>AI Selection Rationale</span>
                                            </div>
                                            <div>
                                              This keyword was selected because SERP results are landing pages. It has a high confidence score ({item.confidence || 85}%) to rank in Top 3.
                                              {item.reason ? ` Rationale: ${item.reason}` : ''}
                                            </div>
                                          </div>
                                        )}

                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                                          {(item.category || item.cluster) && (
                                            <span style={{ fontSize: 11, color: '#8A8A9A' }}>
                                              {[item.category, item.cluster].filter(Boolean).join(' • ')}
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td style={{ padding: '8px 14px' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                          {item.delta > 0 && (
                                            <div style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: 4,
                                              background: '#E6FAF6',
                                              color: '#00BFA2',
                                              border: '1px solid #A7F3D0',
                                              padding: '2px 8px',
                                              borderRadius: 6,
                                              fontSize: 11,
                                              fontWeight: 800,
                                              width: 'fit-content'
                                            }}>
                                              <span>↑ +{item.delta}</span>
                                              <span style={{ fontSize: 9.5, letterSpacing: '0.04em' }}>GAIN</span>
                                            </div>
                                          )}
                                          {item.delta < 0 && (
                                            <div style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: 4,
                                              background: '#FDEBF4',
                                              color: '#D4007A',
                                              border: '1px solid #F8B4D9',
                                              padding: '2px 8px',
                                              borderRadius: 6,
                                              fontSize: 11,
                                              fontWeight: 800,
                                              width: 'fit-content'
                                            }}>
                                              <span>↓ {item.delta}</span>
                                              <span style={{ fontSize: 9.5, letterSpacing: '0.04em' }}>DROP</span>
                                            </div>
                                          )}
                                          {(!item.delta || item.delta === 0) && (
                                            <div style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: 4,
                                              background: '#F5F5F5',
                                              color: '#8A8A9A',
                                              border: '1px solid #E2DBEC',
                                              padding: '2px 8px',
                                              borderRadius: 6,
                                              fontSize: 11,
                                              fontWeight: 700,
                                              width: 'fit-content'
                                            }}>
                                              <span>— 0</span>
                                              <span style={{ fontSize: 9.5 }}>STEADY</span>
                                            </div>
                                          )}
                                          <div style={{ fontSize: 11, color: '#8A8A9A' }}>
                                            Prev: #{item.prev_rank ?? item.rank} → Now: <strong style={{ color: '#1A1A1A' }}>#{currentRank}</strong>
                                          </div>
                                        </div>
                                      </td>
                                      <td style={{ padding: '8px 14px', fontWeight: 600, color: '#2D2D44' }}>
                                        {item.sv ? item.sv.toLocaleString() : '—'}
                                      </td>
                                      <td style={{ padding: '8px 14px', color: '#8A8A9A' }}>
                                        {item.kd ?? '—'}
                                      </td>
                                      <td style={{ padding: '8px 14px' }}>
                                        {item.confidence !== undefined ? (
                                          <span style={{
                                            fontWeight: 700,
                                            fontSize: 11.5,
                                            color: item.confidence >= 80 ? '#00BFA2' : (item.confidence >= 60 ? '#CB196B' : '#8A8A9A')
                                          }}>
                                            {item.confidence}%
                                          </span>
                                        ) : '—'}
                                      </td>
                                      <td style={{ padding: '8px 14px', color: '#2D2D44', lineHeight: 1.45, fontSize: 12 }}>
                                        {item.reason || 'Optimal candidate for top-3 rankings based on search intent.'}
                                      </td>
                                      <td style={{ padding: '8px 14px' }}>
                                        {(() => {
                                          const assignedSite = selectedOutreachSites[item.id] || item.outreach_site;
                                          return (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                              {availableOutreachSites && availableOutreachSites.length > 0 ? (
                                                <select
                                                  value={assignedSite?.domain || ''}
                                                  onChange={(e) => {
                                                    const domainVal = e.target.value;
                                                    const matchedSite = availableOutreachSites.find(s => s.domain === domainVal);
                                                    handleSelectSiteForKeyword(item.id, matchedSite || null);
                                                  }}
                                                  style={{
                                                    padding: '4px 8px',
                                                    fontSize: 12,
                                                    fontWeight: 600,
                                                    color: assignedSite ? '#1A1A1A' : '#8A8A9A',
                                                    background: '#FFFFFF',
                                                    border: '1px solid #E2DBEC',
                                                    borderRadius: 6,
                                                    outline: 'none',
                                                    maxWidth: 210,
                                                    cursor: 'pointer'
                                                  }}
                                                >
                                                  <option value="">-- Select Outreach Site --</option>
                                                  {availableOutreachSites.map(site => {
                                                    const currentCount = Object.entries(selectedOutreachSites).filter(
                                                      ([id, s]) => s?.domain === site.domain
                                                    ).length;
                                                    const isCurrent = assignedSite?.domain === site.domain;
                                                    const isFull = currentCount >= 4 && !isCurrent;
                                                    return (
                                                      <option key={site.id || site.domain} value={site.domain} disabled={isFull}>
                                                        {site.domain} (DA {site.da} | {String(site.price).startsWith('₹') ? site.price : (String(site.price).startsWith('$') ? site.price.replace('$', '₹') : `₹${site.price}`)}) {isFull ? '— Full (4/4 assigned)' : `(${currentCount}/4 kws)`}
                                                      </option>
                                                    );
                                                  })}
                                                </select>
                                              ) : assignedSite ? (
                                                <span style={{ fontSize: 12, fontWeight: 700, color: '#1A1A1A' }}>
                                                  {assignedSite.domain}
                                                </span>
                                              ) : (
                                                <span style={{ fontSize: 11, color: '#8A8A9A', fontStyle: 'italic' }}>
                                                  Auto-assigned on schedule
                                                </span>
                                              )}

                                              {assignedSite && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                                                  <span style={{
                                                    fontSize: 10,
                                                    fontWeight: 800,
                                                    background: (assignedSite.da || 0) >= 50 ? '#E6FAF6' : '#F5F5F5',
                                                    color: (assignedSite.da || 0) >= 50 ? '#00BFA2' : '#2D2D44',
                                                    border: `1px solid ${(assignedSite.da || 0) >= 50 ? '#A7F3D0' : '#E2DBEC'}`,
                                                    padding: '1px 5px',
                                                    borderRadius: 4
                                                  }}>
                                                    DA {assignedSite.da}
                                                  </span>
                                                  <span style={{
                                                    fontSize: 10,
                                                    fontWeight: 700,
                                                    background: (assignedSite.spam_score || 0) <= 5 ? '#E6FAF6' : '#FDEBF4',
                                                    color: (assignedSite.spam_score || 0) <= 5 ? '#00BFA2' : '#D4007A',
                                                    border: `1px solid ${(assignedSite.spam_score || 0) <= 5 ? '#A7F3D0' : '#F8B4D9'}`,
                                                    padding: '1px 5px',
                                                    borderRadius: 4
                                                  }}>
                                                    Spam {assignedSite.spam_score}%
                                                  </span>
                                                  <span style={{
                                                    fontSize: 10,
                                                    fontWeight: 700,
                                                    color: '#00BFA2',
                                                    background: '#E6FAF6',
                                                    border: '1px solid #A7F3D0',
                                                    padding: '1px 5px',
                                                    borderRadius: 4
                                                  }}>
                                                    {String(assignedSite.price).startsWith('₹') ? assignedSite.price : (String(assignedSite.price).startsWith('$') ? assignedSite.price.replace('$', '₹') : `₹${assignedSite.price}`)}
                                                  </span>
                                                  {assignedSite.country_traffic && (
                                                    <span style={{
                                                      fontSize: 10,
                                                      fontWeight: 700,
                                                      color: '#00C2FF',
                                                      background: '#E6F8FF',
                                                      border: '1px solid #B3EDFF',
                                                      padding: '1px 5px',
                                                      borderRadius: 4
                                                    }} title="Target Country Organic Traffic">
                                                      {assignedSite.country_traffic}
                                                    </span>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })()}
                                      </td>
                                      <td style={{ padding: '8px 14px' }}>
                                        {(() => {
                                          const currentLp = item.landing_page_url || item.topicLink || item.topic_link || topicLinks[item.id] || '';
                                          if (!currentLp) {
                                            return (
                                              <span style={{ fontSize: 12, color: '#8A8A9A', fontStyle: 'italic' }}>
                                                —
                                              </span>
                                            );
                                          }
                                          return (
                                            <a
                                              href={currentLp}
                                              target="_blank"
                                              rel="noreferrer"
                                              title={currentLp}
                                              style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 4,
                                                fontSize: 12,
                                                fontWeight: 600,
                                                color: '#7B2FBE',
                                                textDecoration: 'none',
                                                maxWidth: 260,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                background: 'transparent',
                                                border: 'none',
                                                padding: 0
                                              }}
                                              onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
                                              onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
                                            >
                                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {currentLp.replace(/^https?:\/\/(www\.)?/, '')}
                                              </span>
                                              <ExternalLink size={11} color="#7B2FBE" style={{ flexShrink: 0 }} />
                                            </a>
                                          );
                                        })()}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* STICKY BOTTOM ACTION BAR */}
            <div style={{
              position: 'sticky',
              bottom: 16,
              zIndex: 30,
              background: 'rgba(255, 255, 255, 0.96)',
              backdropFilter: 'blur(8px)',
              border: '1px solid #E2DBEC',
              borderRadius: 12,
              padding: '12px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.08)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13, color: '#2D2D44' }}>
                  <strong style={{ color: '#1A1A1A', fontSize: 14 }}>{selectedKwIds.size}</strong> of {potentialKws.length} keywords selected
                </div>
                {potentialKws.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: '#8A8A9A' }}>•</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#00BFA2', background: '#E6FAF6', border: '1px solid #A7F3D0', padding: '2px 8px', borderRadius: 10 }}>
                      {selectedByBatch.high} Gains
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#D4007A', background: '#FDEBF4', border: '1px solid #F8B4D9', padding: '2px 8px', borderRadius: 10 }}>
                      {selectedByBatch.medium} Drops
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#8A8A9A', background: '#F5F5F5', border: '1px solid #E2DBEC', padding: '2px 8px', borderRadius: 10 }}>
                      {selectedByBatch.low} Stagnant
                    </span>
                  </div>
                )}
                {activitiesList.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: '#8A8A9A' }}>•</span>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: '#4A1A8C' }}>Division:</span>
                    {activityDivisions.map(d => (
                      <span
                        key={d.id}
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#7B2FBE',
                          background: '#F6EEFD',
                          border: '1px solid #E5CCF7',
                          padding: '2px 8px',
                          borderRadius: 8,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                      >
                        <span>{d.activity_name}:</span>
                        <span style={{ color: '#00BFA2' }}>{d.allocatedBudgetFormatted}</span>
                        <span style={{ color: '#8A8A9A' }}>({d.keywordCount} kws)</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => { setIsModalOpen(false); setModalStep('form'); }}
                  style={{
                    padding: '8px 16px',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#2D2D44',
                    background: '#FFFFFF',
                    border: '1px solid #E2DBEC',
                    borderRadius: 8,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={selectedKwIds.size === 0 || savingActivity}
                  onClick={handleConfirmAddKeywords}
                  style={{
                    padding: '9px 24px',
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#FFFFFF',
                    background: (selectedKwIds.size === 0 || savingActivity) ? '#8A8A9A' : 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 100%)',
                    border: 'none',
                    borderRadius: 8,
                    cursor: (selectedKwIds.size === 0 || savingActivity) ? 'not-allowed' : 'pointer',
                    boxShadow: (selectedKwIds.size === 0 || savingActivity) ? 'none' : '0 2px 12px rgba(74, 26, 140, 0.35)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                  }}
                >
                  {savingActivity ? (
                    <>
                      <div style={{ width: 14, height: 14, border: '2px solid #FFFFFF', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                      <span>Scheduling...</span>
                    </>
                  ) : (
                    <>
                      <Check size={16} />
                      <span>Confirm &amp; Schedule Calendar ({selectedKwIds.size})</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  //  MANUAL KEYWORD PICKER (hard-gated list, user chooses)
  // ─────────────────────────────────────────────────────────────
  if (isModalOpen && modalStep === 'manual_keywords') {
    const q = (keywordSearch || '').toLowerCase().trim();
    const rows = (potentialKws || []).filter(k => {
      if (!q) return true;
      return String(k.keyword || '').toLowerCase().includes(q)
        || String(k.category || '').toLowerCase().includes(q)
        || String(k.cluster || '').toLowerCase().includes(q)
        || String(k.landing_page_url || '').toLowerCase().includes(q);
    });
    const allShownSelected = rows.length > 0 && rows.every(k => selectedKwIds.has(k.id));

    return (
      <div style={{ padding: '24px 32px', minHeight: '100%', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Header */}
        <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #E4DFEE', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button
              type="button"
              onClick={() => { setModalStep('form'); setIsModalOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#F6EEFD', border: '1px solid #E5CCF7', color: '#7B2FBE', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              <ArrowLeft size={16} />
              <span>Back to Calendar</span>
            </button>
            <div style={{ width: 1, height: 28, background: '#E4DFEE' }} />
            <div>
              <h1 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>Choose Keywords · {createdActivity?.project_name || formData.project_name}</h1>
              <p style={{ fontSize: 12.5, color: '#64748b', margin: '3px 0 0 0' }}>
                Only Landing Page keywords ranking #5 or worse are shown. Pick the ones to schedule.
              </p>
            </div>
          </div>
        </div>

        {loadingKeywords ? (
          <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #E4DFEE', padding: '64px 32px', textAlign: 'center' }}>
            <BrandInfinityLoader label={loadingStepText} size="lg" minHeight="200px" />
          </div>
        ) : landingPageErrorNotice ? (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 14, padding: '20px 24px', color: '#92400e', fontSize: 13.5 }}>
            {landingPageErrorNotice}
          </div>
        ) : (
          <>
            <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #E4DFEE', overflow: 'hidden' }}>
              {/* Toolbar */}
              <div style={{ padding: '12px 18px', borderBottom: '1px solid #EEE9F7', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 360 }}>
                  <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                  <input
                    type="text"
                    placeholder="Search keywords…"
                    value={keywordSearch}
                    onChange={e => setKeywordSearch(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px 7px 32px', fontSize: 12.5, border: '1px solid #E4DFEE', borderRadius: 8, outline: 'none' }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = new Set(selectedKwIds);
                    if (allShownSelected) rows.forEach(k => next.delete(k.id));
                    else rows.forEach(k => next.add(k.id));
                    setSelectedKwIds(next);
                  }}
                  style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}
                >
                  {allShownSelected ? 'Deselect all shown' : 'Select all shown'}
                </button>
                <span style={{ fontSize: 12, color: '#64748b', marginLeft: 'auto' }}>
                  {rows.length} keyword{rows.length === 1 ? '' : 's'} · {selectedKwIds.size} selected
                </span>
              </div>

              <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 340px)' }}>
                <table className="ps-sticky-wrap" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, textAlign: 'left', minWidth: 900 }}>
                  <thead>
                    <tr style={{ background: '#FAF8FD', color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '10px 12px', width: 42, textAlign: 'center' }}></th>
                      <th style={{ padding: '10px 14px', minWidth: 220 }}>Keyword</th>
                      <th style={{ padding: '10px 14px', width: 80 }}>SV</th>
                      <th style={{ padding: '10px 14px', width: 60 }}>KD</th>
                      <th style={{ padding: '10px 14px', width: 70 }}>Rank</th>
                      <th style={{ padding: '10px 14px', minWidth: 150 }}>Category</th>
                      <th style={{ padding: '10px 14px', minWidth: 130 }}>Cluster</th>
                      <th style={{ padding: '10px 14px', minWidth: 220 }}>Landing Page</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan={8} style={{ padding: '28px 16px', textAlign: 'center', color: '#94a3b8', fontStyle: 'italic' }}>No Landing Page keywords (Rank 5+) for this project.</td></tr>
                    ) : rows.map(k => {
                      const checked = selectedKwIds.has(k.id);
                      return (
                        <tr key={k.id} style={{ borderTop: '1px solid #f1f5f9', background: checked ? '#f5f3ff' : 'transparent' }}>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = new Set(selectedKwIds);
                                if (e.target.checked) next.add(k.id); else next.delete(k.id);
                                setSelectedKwIds(next);
                              }}
                              style={{ cursor: 'pointer', width: 15, height: 15, accentColor: '#7c3aed' }}
                            />
                          </td>
                          <td style={{ padding: '8px 14px', fontWeight: 700, color: '#0f172a' }}>{k.keyword}</td>
                          <td style={{ padding: '8px 14px', color: '#334155' }}>{k.sv ? Number(k.sv).toLocaleString() : '—'}</td>
                          <td style={{ padding: '8px 14px', color: '#64748b' }}>{k.kd ?? '—'}</td>
                          <td style={{ padding: '8px 14px', color: '#334155' }}>{k.rank != null ? `#${k.rank}` : '—'}</td>
                          <td style={{ padding: '8px 14px', color: '#475569' }}>{k.category || '—'}</td>
                          <td style={{ padding: '8px 14px', color: '#475569' }}>{k.cluster || '—'}</td>
                          <td style={{ padding: '8px 14px' }}>
                            {k.landing_page_url
                              ? <a href={k.landing_page_url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: '#7c3aed', wordBreak: 'break-all' }}>{k.landing_page_url}</a>
                              : <span style={{ fontSize: 11, color: '#94a3b8' }}>—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Sticky action bar */}
            <div style={{ position: 'sticky', bottom: 16, zIndex: 30, background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(8px)', border: '1px solid #E4DFEE', borderRadius: 12, padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, boxShadow: '0 4px 20px -2px rgba(74,26,140,0.08)' }}>
              <div style={{ fontSize: 13, color: '#475569' }}>
                <strong style={{ color: '#0f172a', fontSize: 14 }}>{selectedKwIds.size}</strong> of {potentialKws.length} keywords selected
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => { setModalStep('form'); setIsModalOpen(false); setActiveSubTab('saved'); }}
                  style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, color: '#64748b', background: '#ffffff', border: '1px solid #E4DFEE', borderRadius: 8, cursor: 'pointer' }}
                >
                  Skip (keep as draft)
                </button>
                <button
                  type="button"
                  disabled={selectedKwIds.size === 0 || savingActivity}
                  onClick={handleConfirmManualKeywords}
                  style={{ padding: '9px 24px', fontSize: 13, fontWeight: 700, color: '#ffffff', background: (selectedKwIds.size === 0 || savingActivity) ? '#cbd5e1' : 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)', border: 'none', borderRadius: 8, cursor: (selectedKwIds.size === 0 || savingActivity) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  {savingActivity ? <span>Scheduling…</span> : <><Check size={16} /><span>Confirm &amp; Schedule ({selectedKwIds.size})</span></>}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // MAIN CALENDAR DASHBOARD (Tree Structure)
  // ─────────────────────────────────────────────────────────────
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
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            Plan, schedule, and execute monthly SEO campaigns across off-page, on-page, and content activities.
          </p>
        </div>

        {/* Right Header Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => handleOpenAddModal()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 20px',
              fontSize: 13.5,
              fontWeight: 700,
              color: '#ffffff',
              background: '#2D2D44',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(45, 45, 68, 0.25)',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#1F1F30'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#2D2D44'; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            <span>Create Calendar</span>
          </button>
        </div>
      </div>

      {/* Sub-Tabs: Saved (Draft) | Scheduled | Approved */}
      <div style={{
        background: '#ffffff',
        borderRadius: 14,
        border: '1px solid #E4DFEE',
        padding: '16px 20px',
        marginBottom: 20,
        boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', gap: 8, background: '#F4F1FA', padding: 4, borderRadius: 10 }}>
            {/* 1. Saved (Draft) Tab */}
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
                transition: 'all 0.15s ease'
              }}
            >
              <Bookmark size={15} color={activeSubTab === 'saved' ? '#7B2FBE' : '#64748b'} />
              <span>Draft</span>
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

            {/* 4. Published (Live) Tab */}
            <button
              onClick={() => setActiveSubTab('published')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 18px',
                borderRadius: 8,
                border: activeSubTab === 'published' ? '1px solid #6EE7B7' : '1px solid transparent',
                background: activeSubTab === 'published' ? 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)' : 'transparent',
                color: activeSubTab === 'published' ? '#047857' : '#64748b',
                fontSize: 13,
                fontWeight: activeSubTab === 'published' ? 800 : 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <Send size={15} color={activeSubTab === 'published' ? '#047857' : '#64748b'} />
              <span>Published</span>
              <span style={{
                background: activeSubTab === 'published' ? '#A7F3D0' : '#E2DBEC',
                color: activeSubTab === 'published' ? '#065F46' : '#475569',
                fontSize: 11,
                fontWeight: 800,
                padding: '1px 7px',
                borderRadius: 10
              }}>
                {counts.published}
              </span>
            </button>
          </div>

          {/* Search */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                placeholder={`Search activities...`}
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
                  width: 260,
                  background: '#ffffff'
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* TREE TABLE CONTAINER */}
      <div style={{
        background: '#ffffff',
        borderRadius: 14,
        border: '1px solid #E4DFEE',
        overflow: 'hidden',
        boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06)'
      }}>
        {loading ? (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <BrandInfinityLoader label="Loading calendar activities…" size="md" minHeight="220px" />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 1050 }}>
              <thead>
                <tr style={{ background: '#FAF8FD', borderBottom: '1px solid #E4DFEE' }}>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', width: 130 }}>
                    Activity ID
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', width: 260 }}>
                    Activities
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', width: 140 }}>
                    Mode
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', width: 130 }}>
                    Status
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center', width: 80 }}>
                    Qty
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', width: 120 }}>
                    Total Budget (₹)
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', width: 140 }}>
                    Period
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', width: 140 }}>
                    Content POC
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', width: 140 }}>
                    Auditor
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center', width: 90 }}>
                    Actions
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center', width: 130 }}>
                    {activeSubTab === 'saved' ? 'Schedule' : (activeSubTab === 'scheduled' ? 'Approve' : (activeSubTab === 'approved' ? 'Publish' : 'Off-Page'))}
                  </th>
                </tr>
              </thead>
              <tbody>
                {groupedProjects.length > 0 ? (
                  groupedProjects.map((group, gIdx) => {
                    const isExpanded = expandedProjects.has(group.projectName);
                    const overallUid = (() => {
                      const itemWithUid = group.items.find(it => it.activity_uid);
                      if (itemWithUid && itemWithUid.activity_uid) {
                        const parts = itemWithUid.activity_uid.split('-');
                        if (parts.length >= 2) return `${parts[0]}-${parts[1]}`;
                      }
                      const pLower = (group.projectName || '').toLowerCase();
                      let pCode = 'PR';
                      if (pLower.includes('billabong')) pCode = 'BL';
                      else if (pLower.includes('euroschool')) pCode = 'ES';
                      else if (group.projectName && group.projectName.length >= 2) pCode = group.projectName.substring(0, 2).toUpperCase();
                      const mCode = '09';
                      return `${pCode}-${mCode}`;
                    })();
                    return (
                      <React.Fragment key={group.projectName || gIdx}>
                        {/* PARENT ROW: Project Summary */}
                        <tr style={{
                          borderBottom: '1px solid #e2e8f0',
                          background: gIdx % 2 === 0 ? '#ffffff' : '#fafafa',
                          fontWeight: 600
                        }}>
                          {/* Col 1: expander chevron + project group ID (e.g. BL-09) */}
                          <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <button
                                type="button"
                                title={isExpanded ? 'Collapse activities' : 'Expand activities'}
                                onClick={() => toggleProjectExpand(group.projectName)}
                                style={{
                                  background: '#f1f5f9',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: 6,
                                  width: 24,
                                  height: 24,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                  color: '#475569',
                                  flexShrink: 0
                                }}
                              >
                                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </button>
                              <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>{overallUid}</span>
                            </div>
                          </td>

                          {/* Col 2: Project name */}
                          <td style={{ padding: '14px 16px' }}>
                            <div style={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <FolderOpen size={15} color="#7c3aed" />
                              <span>{group.projectName}</span>
                            </div>
                            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                              {group.items.length} activit{group.items.length === 1 ? 'y' : 'ies'} scheduled
                            </div>
                          </td>

                          {/* AI vs Manual Icon Badge */}
                          <td style={{ padding: '14px 16px' }}>
                            {group.hasAi ? (
                              <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                background: '#f5f3ff',
                                color: '#7c3aed',
                                border: '1px solid #c4b5fd',
                                padding: '3px 8px',
                                borderRadius: 8,
                                fontSize: 11.5,
                                fontWeight: 700
                              }}>
                                <Sparkles size={12} />
                                AI Scheduled
                              </span>
                            ) : (
                              <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                background: '#f8fafc',
                                color: '#475569',
                                border: '1px solid #cbd5e1',
                                padding: '3px 8px',
                                borderRadius: 8,
                                fontSize: 11.5,
                                fontWeight: 700
                              }}>
                                <UserIcon size={12} />
                                Manual
                              </span>
                            )}
                          </td>

                          {/* Status */}
                          <td style={{ padding: '14px 16px' }}>
                            <span style={{
                              display: 'inline-block',
                              fontSize: 10.5,
                              fontWeight: 800,
                              textTransform: 'uppercase',
                              padding: '2px 7px',
                              borderRadius: 6,
                              width: 'fit-content',
                              background: activeSubTab === 'saved' ? '#fef3c7' : (activeSubTab === 'scheduled' ? '#dbeafe' : (activeSubTab === 'approved' ? '#d1fae5' : '#dcfce7')),
                              color: activeSubTab === 'saved' ? '#b45309' : (activeSubTab === 'scheduled' ? '#1d4ed8' : (activeSubTab === 'approved' ? '#047857' : '#15803d')),
                              border: `1px solid ${activeSubTab === 'saved' ? '#fde68a' : (activeSubTab === 'scheduled' ? '#bfdbfe' : (activeSubTab === 'approved' ? '#a7f3d0' : '#bbf7d0'))}`
                            }}>
                              {activeSubTab === 'saved' ? 'Draft' : (activeSubTab === 'published' ? 'Published' : activeSubTab)}
                            </span>
                          </td>

                          {/* Total Quantity */}
                          <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: 800, color: '#0f172a' }}>
                            {group.totalQuantity}
                          </td>

                          {/* Total Budget */}
                          <td style={{ padding: '14px 16px', fontWeight: 800, color: '#059669', fontSize: 13.5 }}>
                            ₹{group.totalBudget.toLocaleString()}
                          </td>

                          {/* Period (Month & Year) */}
                          <td style={{ padding: '14px 16px', fontSize: 12.5, color: '#334155', fontWeight: 600 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <CalendarIcon size={14} color="#64748b" />
                              <span>{group.period}</span>
                            </div>
                          </td>

                          {/* Content POC */}
                          <td style={{ padding: '14px 16px', fontSize: 12.5, color: '#334155', fontWeight: 600 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <UserIcon size={13} color="#7c3aed" />
                              <span>{group.items[0]?.content_poc || 'Content Lead'}</span>
                            </div>
                          </td>

                          {/* Auditor */}
                          <td style={{ padding: '14px 16px', fontSize: 12.5, color: '#334155', fontWeight: 600 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <UserIcon size={13} color="#059669" />
                              <span>{group.items[0]?.auditor || 'SEO Audit Team'}</span>
                            </div>
                          </td>

                          {/* Project Actions (per-activity — see child rows) */}
                          <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                            <span style={{ color: '#cbd5e1', fontSize: 12 }}>—</span>
                          </td>

                          {/* Move Status / Action Button - In the end after Actions */}
                          <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                            {activeSubTab === 'saved' && (
                              <button
                                type="button"
                                onClick={() => group.items.forEach(it => handleMoveStatus(it, 'scheduled'))}
                                style={{
                                  background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                                  color: '#ffffff',
                                  border: 'none',
                                  padding: '6px 14px',
                                  borderRadius: 6,
                                  fontSize: 11.5,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  boxShadow: '0 2px 6px rgba(124, 58, 237, 0.25)'
                                }}
                              >
                                Schedule All
                              </button>
                            )}
                            {activeSubTab === 'scheduled' && (
                              <button
                                type="button"
                                onClick={() => group.items.forEach(it => handleMoveStatus(it, 'approved'))}
                                style={{
                                  background: '#d1fae5',
                                  color: '#047857',
                                  border: '1px solid #a7f3d0',
                                  padding: '6px 14px',
                                  borderRadius: 6,
                                  fontSize: 11.5,
                                  fontWeight: 700,
                                  cursor: 'pointer'
                                }}
                              >
                                Approve All
                              </button>
                            )}
                            {activeSubTab === 'approved' && (
                              <button
                                type="button"
                                onClick={() => group.items.forEach(it => handleMoveStatus(it, 'published'))}
                                style={{
                                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                  color: '#ffffff',
                                  border: 'none',
                                  padding: '6px 14px',
                                  borderRadius: 6,
                                  fontSize: 11.5,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  boxShadow: '0 2px 6px rgba(16, 185, 129, 0.25)'
                                }}
                              >
                                Publish All
                              </button>
                            )}
                            {activeSubTab === 'published' && (
                              <button
                                type="button"
                                onClick={() => {
                                  sessionStorage.setItem('offpage_target_project', group.projectName);
                                  const firstItem = group.items.find(it => it.first_uid || it.activity_uid);
                                  if (firstItem) {
                                    sessionStorage.setItem('offpage_target_row_uid', firstItem.first_uid || `${firstItem.activity_uid}-KW1`);
                                  }
                                  if (onNavigate) {
                                    if (group.channel === 'content') onNavigate('content-engine');
                                    else onNavigate('search-visibility/off-page-scheduler');
                                  }
                                }}
                                title="Redirect to Off-Page under this project"
                                style={{
                                  padding: '6px 14px',
                                  borderRadius: 6,
                                  fontSize: 11.5,
                                  fontWeight: 700,
                                  background: '#F6EEFD',
                                  color: '#7B2FBE',
                                  border: '1px solid #E5CCF7',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 5,
                                  transition: 'all 0.15s ease'
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = '#EDE1F9'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = '#F6EEFD'; }}
                              >
                                <ExternalLink size={12} />
                                <span>Off-Page</span>
                              </button>
                            )}
                          </td>
                        </tr>

                        {/* CHILD ROWS (Expanded Tree Structure) */}
                        {isExpanded && group.items.map((item, idx) => {
                          let _pk = [];
                          if (Array.isArray(item.potential_keywords)) _pk = item.potential_keywords;
                          else if (typeof item.potential_keywords === 'string') { try { _pk = JSON.parse(item.potential_keywords); } catch (_) { } }
                          const isAiActivity = Boolean(item.is_ai_scheduled)
                            || /ai/i.test(String(item.scheduler || ''))
                            || (Array.isArray(_pk) && _pk.length > 0);
                          return (
                            <tr
                              key={item.id || idx}
                              style={{
                                borderBottom: '1px solid #f1f5f9',
                                background: '#fcfbfe'
                              }}
                            >
                              {/* Col 1: sub-arrow + activity ID */}
                              <td style={{ padding: '10px 16px 10px 28px', whiteSpace: 'nowrap', fontSize: 12.5, fontWeight: 600, color: '#475569' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ color: '#cbd5e1', fontSize: 14 }}>↳</span>
                                  <span>{item.activity_uid || '—'}</span>
                                </span>
                              </td>

                              {/* Col 2: Activity Name */}
                              <td style={{ padding: '10px 16px 10px 32px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                                      {item.activity_name}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* Activity Mode */}
                              <td style={{ padding: '10px 16px', fontSize: 12, color: '#64748b' }}>
                                {isAiActivity ? (
                                  'AI Auto-Scheduler'
                                ) : (
                                  <HoverTip label="Manual" tip={`Main POC: ${item.main_poc || item.scheduler || '—'}`} />
                                )}
                              </td>

                              {/* Sub Activity Status */}
                              <td style={{ padding: '10px 16px' }}>
                                <span style={{
                                  display: 'inline-block',
                                  fontSize: 10,
                                  fontWeight: 800,
                                  textTransform: 'uppercase',
                                  padding: '2px 6px',
                                  borderRadius: 5,
                                  width: 'fit-content',
                                  background: (item.status || activeSubTab) === 'saved' ? '#fef3c7' : ((item.status || activeSubTab) === 'scheduled' ? '#dbeafe' : ((item.status || activeSubTab) === 'approved' ? '#d1fae5' : '#dcfce7')),
                                  color: (item.status || activeSubTab) === 'saved' ? '#b45309' : ((item.status || activeSubTab) === 'scheduled' ? '#1d4ed8' : ((item.status || activeSubTab) === 'approved' ? '#047857' : '#15803d')),
                                  border: `1px solid ${(item.status || activeSubTab) === 'saved' ? '#fde68a' : ((item.status || activeSubTab) === 'scheduled' ? '#bfdbfe' : ((item.status || activeSubTab) === 'approved' ? '#a7f3d0' : '#bbf7d0'))}`
                                }}>
                                  {(item.status || activeSubTab) === 'saved' ? 'Draft' : ((item.status || activeSubTab) === 'published' ? 'Published' : (item.status || activeSubTab))}
                                </span>
                              </td>

                              {/* Individual Quantity */}
                              <td style={{ padding: '10px 16px', textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                                {item.quantity || 1}
                              </td>

                              {/* Individual Budget */}
                              <td style={{ padding: '10px 16px', fontSize: 12.5, fontWeight: 700, color: '#059669' }}>
                                {item.budget ? (String(item.budget).startsWith('₹') ? item.budget : (String(item.budget).startsWith('$') ? item.budget.replace('$', '₹') : `₹${item.budget}`)) : '—'}
                              </td>

                              {/* Activity Period */}
                              <td style={{ padding: '10px 16px', fontSize: 12, color: '#64748b' }}>
                                {item.period || group.period}
                              </td>

                              {/* Content POC */}
                              <td style={{ padding: '10px 16px', fontSize: 12, color: '#475569' }}>
                                <span>{item.content_poc || '—'}</span>
                              </td>

                              {/* Auditor */}
                              <td style={{ padding: '10px 16px', fontSize: 12, color: '#475569' }}>
                                <span>{item.auditor || '—'}</span>
                              </td>

                              {/* Individual Actions - In front of status column */}
                              <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                  {(isAiActivity || item.keyword_name || (Array.isArray(_pk) && _pk.length > 0) || item.ai_summary || item.ai_advisory) && (
                                    <button
                                      onClick={() => openAiRunModal({ projectName: group.projectName, activityId: item.id, activityName: item.activity_name, activityItem: item })}
                                      title="View AI analysis and outreach data"
                                      style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 5,
                                        background: '#F5F3FF', border: '1px solid #DDD6FE', color: '#7c3aed',
                                        fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '4px 8px', cursor: 'pointer'
                                      }}
                                      onMouseEnter={e => { e.currentTarget.style.background = '#EDE9FE'; }}
                                      onMouseLeave={e => { e.currentTarget.style.background = '#F5F3FF'; }}
                                    >
                                      <Eye size={13} />
                                      <span>View</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleOpenEditModal(item)}
                                    title="Edit Activity"
                                    style={{ background: 'transparent', border: 'none', color: '#6366f1', cursor: 'pointer', padding: 4 }}
                                  >
                                    <Edit3 size={14} />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteItem(item)}
                                    title="Delete Activity"
                                    style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', padding: 4 }}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </td>

                              {/* Move Status Buttons - In the end after Actions without icons */}
                              <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                                  {/* On Draft: Only show Schedule button */}
                                  {activeSubTab === 'saved' && (
                                    <button
                                      type="button"
                                      onClick={() => handleMoveStatus(item, 'scheduled')}
                                      title="Schedule Activity"
                                      style={{
                                        background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                                        color: '#ffffff',
                                        border: 'none',
                                        padding: '4px 12px',
                                        borderRadius: 5,
                                        fontSize: 11,
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        boxShadow: '0 1px 4px rgba(124, 58, 237, 0.2)'
                                      }}
                                    >
                                      Schedule
                                    </button>
                                  )}

                                  {/* On Scheduled: Approve only */}
                                  {activeSubTab === 'scheduled' && (
                                    <button
                                      type="button"
                                      onClick={() => handleMoveStatus(item, 'approved')}
                                      title="Approve Activity"
                                      style={{
                                        background: '#d1fae5',
                                        color: '#047857',
                                        border: '1px solid #a7f3d0',
                                        padding: '4px 12px',
                                        borderRadius: 5,
                                        fontSize: 10.5,
                                        fontWeight: 700,
                                        cursor: 'pointer'
                                      }}
                                    >
                                      Approve
                                    </button>
                                  )}

                                  {/* On Approved: Publish only */}
                                  {activeSubTab === 'approved' && (
                                    <button
                                      type="button"
                                      onClick={() => handleMoveStatus(item, 'published')}
                                      title="Publish Live"
                                      style={{
                                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                        color: '#ffffff',
                                        border: 'none',
                                        padding: '4px 12px',
                                        borderRadius: 5,
                                        fontSize: 10.5,
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        boxShadow: '0 1px 4px rgba(16, 185, 129, 0.25)'
                                      }}
                                    >
                                      Publish
                                    </button>
                                  )}

                                  {/* On Published: Redirect to off-page */}
                                  {activeSubTab === 'published' && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        sessionStorage.setItem('offpage_target_project', item.project_name);
                                        sessionStorage.setItem('offpage_target_row_uid', item.first_uid || `${item.activity_uid || 'ACT'}-KW1`);
                                        if (onNavigate) {
                                          if (item.channel === 'content') onNavigate('content-engine');
                                          else onNavigate('search-visibility/off-page-scheduler');
                                        }
                                      }}
                                      title={`Redirect to Off-Page under ${item.project_name} for this row`}
                                      style={{
                                        fontSize: 11,
                                        fontWeight: 700,
                                        padding: '4px 12px',
                                        borderRadius: 5,
                                        background: '#F6EEFD',
                                        color: '#7B2FBE',
                                        border: '1px solid #E5CCF7',
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        transition: 'all 0.15s ease'
                                      }}
                                      onMouseEnter={e => { e.currentTarget.style.background = '#EDE1F9'; }}
                                      onMouseLeave={e => { e.currentTarget.style.background = '#F6EEFD'; }}
                                    >
                                      <ExternalLink size={11} />
                                      <span>Off-Page</span>
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={11} style={{ padding: '50px 20px', textAlign: 'center', color: '#94a3b8' }}>
                      <FileSpreadsheet size={36} color="#cbd5e1" style={{ marginBottom: 8 }} />
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>
                        No {activeSubTab} activities found in database table
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                        Click "Create Calendar" above to add new activities to your campaign.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          STEP 1: ADD / EDIT ACTIVITY MODAL
      ───────────────────────────────────────────────────────────── */}
      {isModalOpen && modalStep === 'form' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(4px)',
          padding: 16
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 16,
            width: '100%',
            maxWidth: 640,
            padding: 24,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            maxHeight: '92vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>
                  {editingItem ? 'Edit Activity' : 'Create Calendar'}
                </h3>
                <p style={{ fontSize: 12.5, color: '#64748b', margin: '3px 0 0 0' }}>
                  Configure your monthly calendar campaign activities and scheduling mode.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4, borderRadius: 6 }}
              >
                <X size={20} />
              </button>
            </div>

            {/* TOP AI SCHEDULING TOGGLE (Switch, not a tab) */}
            {!editingItem && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                background: aiSchedulingEnabled ? '#f5f3ff' : '#f8fafc',
                border: aiSchedulingEnabled ? '1px solid #c4b5fd' : '1px solid #e2e8f0',
                borderRadius: 10,
                marginBottom: 16,
                transition: 'all 0.2s ease'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: aiSchedulingEnabled ? '#ede9fe' : '#e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: aiSchedulingEnabled ? '#7c3aed' : '#64748b',
                    flexShrink: 0
                  }}>
                    <Bot size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>AI Scheduling</span>
                      <span style={{
                        fontSize: 9.5,
                        fontWeight: 800,
                        padding: '1px 6px',
                        borderRadius: 8,
                        background: aiSchedulingEnabled ? '#7c3aed' : '#94a3b8',
                        color: '#ffffff',
                        textTransform: 'uppercase'
                      }}>
                        {aiSchedulingEnabled ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 1 }}>
                      {aiSchedulingEnabled
                        ? 'AI will automatically analyze keywords & schedule'
                        : 'Manual calendar scheduling (set custom period & scheduler)'}
                    </div>
                  </div>
                </div>

                {/* Modern Toggle Switch */}
                <div
                  role="switch"
                  aria-checked={aiSchedulingEnabled}
                  onClick={() => setAiSchedulingEnabled(prev => !prev)}
                  title={aiSchedulingEnabled ? 'Click to switch to Manual scheduling' : 'Click to enable AI scheduling'}
                  style={{
                    width: 44,
                    height: 24,
                    borderRadius: 12,
                    background: aiSchedulingEnabled ? '#7c3aed' : '#cbd5e1',
                    padding: 2,
                    cursor: 'pointer',
                    transition: 'background-color 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    flexShrink: 0
                  }}
                >
                  <div style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: '#ffffff',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                    transform: aiSchedulingEnabled ? 'translateX(20px)' : 'translateX(0)',
                    transition: 'transform 0.2s ease'
                  }} />
                </div>
              </div>
            )}

            <div style={{ overflowY: 'auto', flex: 1, paddingRight: 4 }}>
              <form onSubmit={handleSaveAsDraft} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Row 1: Project Name & (if manual) Period Month/Year */}
                <div style={{ display: 'grid', gridTemplateColumns: !aiSchedulingEnabled ? '1fr 1fr' : '1fr', gap: 14 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                      Project Name *
                    </label>
                    <PlainSelect
                      required
                      placeholder="Select Project..."
                      value={formData.project_name}
                      onChange={v => setFormData({ ...formData, project_name: v })}
                      options={projects.map(p => ({ value: p.name || p.domain, label: p.name || p.domain }))}
                    />
                  </div>

                  {/* Period (Month & Year Selector for Manual) */}
                  {!aiSchedulingEnabled && (
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                        Period (Month &amp; Year) *
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 6 }}>
                        <select
                          value={periodMonth}
                          onChange={e => setPeriodMonth(e.target.value)}
                          style={{
                            padding: '10px 10px',
                            fontSize: 13,
                            border: '1px solid #cbd5e1',
                            borderRadius: 8,
                            outline: 'none',
                            background: '#ffffff',
                            fontWeight: 600,
                            color: '#0f172a'
                          }}
                        >
                          {MONTH_NAMES.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                        <select
                          value={periodYear}
                          onChange={e => setPeriodYear(parseInt(e.target.value, 10) || now.getFullYear())}
                          style={{
                            padding: '10px 10px',
                            fontSize: 13,
                            border: '1px solid #cbd5e1',
                            borderRadius: 8,
                            outline: 'none',
                            background: '#ffffff',
                            fontWeight: 600,
                            color: '#0f172a'
                          }}
                        >
                          {PERIOD_YEARS.map(y => (
                            <option key={y} value={y}>{y}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* CAMPAIGN ACTIVITIES LIST (Stack multiple activities) */}
                <div style={{ background: '#fcfbfe', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <label style={{ fontSize: 12, fontWeight: 800, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Campaign Activities &amp; Budgets
                    </label>
                    <span style={{ fontSize: 11, color: '#64748b' }}>
                      {activitiesList.length} activit{activitiesList.length === 1 ? 'y' : 'ies'} in batch
                    </span>
                  </div>

                  {/* Column Headers */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1.2fr auto',
                    gap: 8,
                    padding: '0 9px',
                    marginBottom: 6,
                    color: '#64748b',
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em'
                  }}>
                    <span>Activity</span>
                    <span style={{ textAlign: 'center' }}>Quantity</span>
                    <span>Budget</span>
                    <div style={{ width: 28 }} />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {activitiesList.map((actItem, idx) => (
                      <div
                        key={actItem.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '2fr 1fr 1.2fr auto',
                          gap: 8,
                          alignItems: 'center',
                          background: '#ffffff',
                          padding: 8,
                          borderRadius: 8,
                          border: '1px solid #e2e8f0'
                        }}
                      >
                        {/* Activity Name */}
                        <div>
                          <PlainSelect
                            value={actItem.activity_name}
                            onChange={v => handleUpdateActivityRow(actItem.id, 'activity_name', v)}
                            options={['Paid Guest Post', 'Forum - Quora', 'Forum - Reddit', 'Business Listing', 'Classified Ads']}
                          />
                        </div>

                        {/* Quantity */}
                        <div>
                          <input
                            type="number"
                            min="1"
                            placeholder="Qty"
                            value={actItem.quantity}
                            onChange={e => handleUpdateActivityRow(actItem.id, 'quantity', parseInt(e.target.value, 10) || 1)}
                            style={{
                              width: '100%',
                              padding: '9px 10px',
                              fontSize: 13,
                              border: '1px solid #cbd5e1',
                              borderRadius: 8,
                              outline: 'none',
                              textAlign: 'center',
                              fontWeight: 600
                            }}
                          />
                        </div>

                        {/* Budget */}
                        <div>
                          <input
                            type="text"
                            placeholder="₹250"
                            value={actItem.budget}
                            onChange={e => handleUpdateActivityRow(actItem.id, 'budget', e.target.value)}
                            style={{
                              width: '100%',
                              padding: '9px 10px',
                              fontSize: 13,
                              border: '1px solid #cbd5e1',
                              borderRadius: 8,
                              outline: 'none',
                              fontWeight: 600
                            }}
                          />
                        </div>

                        {/* Remove row button */}
                        <div>
                          {activitiesList.length > 1 && !editingItem ? (
                            <button
                              type="button"
                              onClick={() => handleRemoveActivityRow(actItem.id)}
                              style={{
                                background: '#fee2e2',
                                border: '1px solid #fecaca',
                                color: '#dc2626',
                                borderRadius: 6,
                                width: 28,
                                height: 28,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer'
                              }}
                            >
                              <X size={14} />
                            </button>
                          ) : <div style={{ width: 28 }} />}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Batch Summary & Divide Evenly (if multiple activities) */}
                  {activitiesList.length > 1 && !editingItem && (
                    <div style={{
                      marginTop: 10,
                      padding: '9px 14px',
                      background: '#F6EEFD',
                      border: '1px solid #E5CCF7',
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 8
                    }}>
                      <div style={{ fontSize: 12, color: '#4A1A8C' }}>
                        <strong>Batch Total:</strong> {activitiesList.reduce((acc, a) => acc + (parseInt(a.quantity, 10) || 1), 0)} activities · <strong>₹{activitiesList.reduce((acc, a) => acc + (parseFloat(String(a.budget || '0').replace(/[^0-9.]/g, '')) || 0), 0).toLocaleString()}</strong> budget
                        <span style={{ marginLeft: 6, color: '#7B2FBE', fontSize: 11.5 }}>
                          (AI will divide budget &amp; keywords across all {activitiesList.length} activities)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleDivideBudgetAndQuantityEvenly}
                        style={{
                          padding: '4px 10px',
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: '#7B2FBE',
                          background: '#FFFFFF',
                          border: '1px solid #E5CCF7',
                          borderRadius: 6,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                      >
                        <Sliders size={12} />
                        <span>Divide Evenly</span>
                      </button>
                    </div>
                  )}

                  {/* Centered "+ Add Another Activity" Button */}
                  {!editingItem && (
                    <div style={{ textAlign: 'center', marginTop: 12 }}>
                      <button
                        type="button"
                        onClick={handleAddActivityRow}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '7px 16px',
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: '#7B2FBE',
                          background: '#FFFFFF',
                          border: '1px dashed #E5CCF7',
                          borderRadius: 8,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#F6EEFD'; e.currentTarget.style.borderColor = '#7B2FBE'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#FFFFFF'; e.currentTarget.style.borderColor = '#E5CCF7'; }}
                      >
                        <Plus size={14} />
                        <span>Add Another Activity</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* POC ROLES (Conditional based on Manual vs AI) */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: !aiSchedulingEnabled ? '1fr 1fr 1fr' : '1fr 1fr',
                  gap: 12
                }}>
                  {!aiSchedulingEnabled && (
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                        Scheduler (Main POC)
                      </label>
                      <select
                        value={formData.main_poc}
                        onChange={e => setFormData({ ...formData, main_poc: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '9px 12px',
                          fontSize: 13,
                          border: '1px solid #cbd5e1',
                          borderRadius: 8,
                          outline: 'none',
                          background: '#ffffff',
                          cursor: 'pointer'
                        }}
                      >
                        <option value="">Select Scheduler from users...</option>
                        {usersList.map(u => {
                          const displayVal = u.name || u.email;
                          return (
                            <option key={u.id || u.email} value={displayVal}>
                              {u.name ? `${u.name} (${u.email})` : u.email}
                            </option>
                          );
                        })}
                        {formData.main_poc && !usersList.some(u => (u.name === formData.main_poc || u.email === formData.main_poc)) && (
                          <option value={formData.main_poc}>{formData.main_poc}</option>
                        )}
                      </select>
                    </div>
                  )}

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                      Content POC
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Content Lead"
                      value={formData.content_poc}
                      onChange={e => setFormData({ ...formData, content_poc: e.target.value })}
                      style={{ width: '100%', padding: '9px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                      Auditor
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. SEO Audit Team"
                      value={formData.auditor}
                      onChange={e => setFormData({ ...formData, auditor: e.target.value })}
                      style={{ width: '100%', padding: '9px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                    />
                  </div>
                </div>

                {/* Footer Action Buttons */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 8, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, color: '#64748b', background: '#f1f5f9', border: 'none', borderRadius: 8, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {/* Save as Draft button (always present) */}
                    <button
                      type="submit"
                      disabled={savingActivity}
                      style={{
                        padding: '9px 18px',
                        fontSize: 13,
                        fontWeight: 700,
                        color: '#334155',
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: 8,
                        cursor: savingActivity ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      <Bookmark size={15} color="#64748b" />
                      <span>Save as Draft</span>
                    </button>

                    {/* Manual mode: pick keywords yourself (same Landing Page + rank 5+ gate as AI) */}
                    {!aiSchedulingEnabled && !editingItem && (
                      <button
                        type="button"
                        disabled={savingActivity}
                        onClick={handleManualChooseKeywords}
                        style={{
                          padding: '9px 22px',
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#ffffff',
                          background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                          border: 'none',
                          borderRadius: 8,
                          cursor: savingActivity ? 'not-allowed' : 'pointer',
                          boxShadow: '0 2px 10px rgba(124, 58, 237, 0.35)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8
                        }}
                      >
                        <span>Choose Keywords &amp; Schedule</span>
                      </button>
                    )}

                    {/* Run AI Schedule button (if AI mode is on) */}
                    {aiSchedulingEnabled && !editingItem && (
                      <button
                        type="button"
                        disabled={savingActivity}
                        onClick={() => {
                          if (!formData.project_name) {
                            alert('Please select a Project Name');
                            return;
                          }
                          setConfirmAiModalOpen(true);
                        }}
                        style={{
                          padding: '9px 22px',
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#ffffff',
                          background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                          border: 'none',
                          borderRadius: 8,
                          cursor: savingActivity ? 'not-allowed' : 'pointer',
                          boxShadow: '0 2px 10px rgba(124, 58, 237, 0.35)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8
                        }}
                      >
                        <span>Schedule Calendar</span>
                      </button>
                    )}
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          CONFIRMATION MODAL FOR AI SCHEDULING
      ───────────────────────────────────────────────────────────── */}
      {confirmAiModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1100,
          backdropFilter: 'blur(4px)',
          padding: 16
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 16,
            maxWidth: 440,
            width: '100%',
            padding: 24,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            textAlign: 'center'
          }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#ede9fe', color: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <Bot size={24} />
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 800, color: '#0f172a', margin: '0 0 8px 0' }}>
              Confirm AI Calendar Scheduling
            </h3>
            <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, margin: '0 0 20px 0' }}>
              Are you sure you want to AI schedule for <strong>{formData.project_name}</strong>? This will analyze candidate landing page keywords, ping live SERPs for rank 5+ targets, and formulate an optimized monthly activity distribution.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => setConfirmAiModalOpen(false)}
                style={{ padding: '9px 18px', fontSize: 13, fontWeight: 600, color: '#64748b', background: '#f1f5f9', border: 'none', borderRadius: 8, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteAiSchedule}
                style={{ padding: '9px 22px', fontSize: 13, fontWeight: 700, color: '#ffffff', background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)', border: 'none', borderRadius: 8, cursor: 'pointer', boxShadow: '0 2px 10px rgba(124, 58, 237, 0.35)' }}
              >
                Yes, Run AI Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          SAVED AI-RUN VIEWER (read-only popup — cross to close only)
      ───────────────────────────────────────────────────────────── */}
      {aiRunModalOpen && (
        <div
          onClick={closeAiRunModal}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1100, padding: 24
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 'min(1240px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column',
              background: '#ffffff', borderRadius: 16, overflow: 'hidden',
              boxShadow: '0 24px 70px -12px rgba(15, 23, 42, 0.4)'
            }}
          >
            {/* Header */}
            <div style={{
              padding: '16px 22px', borderBottom: '1px solid #EEE9F7',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
              background: 'linear-gradient(135deg, #ffffff 0%, #faf8ff 100%)', flexShrink: 0
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <Sparkles size={18} color="#7c3aed" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
                    Activity Analysis — {aiRunModalProject?.activityName || aiRunModalProject?.name || ''}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, color: '#475569' }}>
                      {aiRunModalProject?.name || ''}
                    </span>
                    {aiRunModalProject?.activityItem?.activity_uid && (
                      <>
                        <span>•</span>
                        <span style={{ fontWeight: 700, color: '#7c3aed' }}>
                          {aiRunModalProject.activityItem.activity_uid}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={closeAiRunModal}
                  title="Close"
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 34, height: 34, borderRadius: 9, background: '#f1f5f9',
                    border: '1px solid #e2e8f0', color: '#475569', cursor: 'pointer'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div style={{ overflowY: 'auto', padding: '20px 22px', background: 'var(--bg)' }}>
              {aiRunLoading ? (
                <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                  <BrandInfinityLoader label="Loading saved analysis…" size="md" minHeight="200px" />
                </div>
              ) : aiRunList.length === 0 ? (
                <div style={{ padding: '52px 20px', textAlign: 'center' }}>
                  <Sparkles size={34} color="#cbd5e1" style={{ marginBottom: 8 }} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>No saved AI analysis for this project</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                    An analysis is saved automatically each time an AI schedule is launched for this project.
                  </div>
                </div>
              ) : (() => {
                const activeRunMeta = aiRunList.find(r => r.run_id === aiRunActiveId) || aiRunList[0];
                const runBatches = { high: [], medium: [], low: [] };
                aiRunKeywords.forEach(k => {
                  const b = k.batch || (k.delta > 0 ? 'high' : (k.delta < 0 ? 'medium' : 'low'));
                  if (runBatches[b]) runBatches[b].push(k);
                  else runBatches.low.push(k);
                });
                const selCount = aiRunKeywords.filter(k => k.selected).length;
                const fmtRank = (v) => (v == null ? '—' : (Number(v) >= 101 ? '#101' : `#${v}`));
                const money = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
                let bSum = activeRunMeta?.budget_summary || aiRunKeywords.find(k => k.budget_summary)?.budget_summary || null;
                if (typeof bSum === 'string') { try { bSum = JSON.parse(bSum); } catch (_) { bSum = null; } }

                const advisoryText = bSum?.anti_waste_advisory
                  || bSum?.analysis_narrative
                  || activeRunMeta?.ai_advisory
                  || aiRunModalProject?.activityItem?.ai_advisory;

                const summaryText = activeRunMeta?.summary
                  || activeRunMeta?.ai_summary
                  || aiRunModalProject?.activityItem?.ai_summary
                  || `Analyzed ${aiRunKeywords.length} keywords: ${runBatches.high.length} improved (Batch 1), ${runBatches.medium.length} dropped (Batch 2), ${runBatches.low.length} stagnant / non-landing (Batch 3).`;
                return (
                  <>
                    {/* Summary strip */}
                    <div style={{
                      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16
                    }}>
                      {[
                        { label: 'Keywords Analyzed', value: aiRunKeywords.length, color: '#0f172a' },
                        { label: 'Batch 1 · Gains', value: runBatches.high.length, color: '#16a34a' },
                        { label: 'Batch 2 · Drops', value: runBatches.medium.length, color: '#d97706' },
                        { label: 'Batch 3 · Stagnant', value: runBatches.low.length, color: '#64748b' },
                        { label: 'Selected & Scheduled', value: selCount, color: '#7c3aed' },
                        { label: 'Budget', value: activeRunMeta?.budget_used != null ? `₹${Number(activeRunMeta.budget_used).toLocaleString()}` : '—', color: '#059669' }
                      ].map((c, i) => (
                        <div key={i} style={{ background: '#ffffff', border: '1px solid #E4DFEE', borderRadius: 12, padding: '12px 14px' }}>
                          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{c.label}</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: c.color }}>{c.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Strategic AI Budget Advisory & Recommendation */}
                    {advisoryText && (
                      <div style={{
                        background: 'linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)',
                        border: '1px solid #FDE68A', borderRadius: 12, padding: '16px 20px', marginBottom: 16,
                        display: 'flex', alignItems: 'flex-start', gap: 14, boxShadow: '0 2px 8px rgba(217, 119, 6, 0.08)'
                      }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: 8, background: '#F59E0B', color: '#ffffff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                        }}>
                          <Sparkles size={18} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, fontWeight: 800, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span>Strategic AI Budget Advisory &amp; Optimization</span>
                            {bSum?.projected_savings > 0 && (
                              <span style={{ fontSize: 10, fontWeight: 700, background: '#16A34A', color: '#ffffff', padding: '1px 7px', borderRadius: 10 }}>
                                Saves ₹{Number(bSum.projected_savings).toLocaleString()}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 13, color: '#78350F', lineHeight: 1.6, fontWeight: 500 }}>
                            {advisoryText}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* AI Executive Summary */}
                    <div style={{
                      background: 'linear-gradient(135deg, #ffffff 0%, #faf8ff 100%)',
                      border: '1px solid #E4DFEE', borderRadius: 12, padding: '14px 16px', marginBottom: 16
                    }}>
                      <div style={{ fontSize: 10.5, fontWeight: 800, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Sparkles size={12} /> AI Analysis Summary
                      </div>
                      <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
                        {summaryText}
                      </div>
                      <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 6 }}>
                        Run on {activeRunMeta?.created_at ? new Date(activeRunMeta.created_at).toLocaleString() : '—'}
                        {activeRunMeta?.quantity_requested != null ? `  ·  ${activeRunMeta.quantity_requested} activities requested` : ''}
                      </div>
                    </div>

                    {/* Budget Optimization Summary */}
                    {bSum && (
                      <div style={{
                        background: '#ffffff', border: '1px solid #E4DFEE', borderRadius: 12, padding: '14px 16px', marginBottom: 16
                      }}>
                        <div style={{ fontSize: 10.5, fontWeight: 800, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <DollarSign size={12} /> Budget Optimization Summary
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                          {[
                            { label: 'Budget Cap', value: money(bSum.budget_cap), color: '#0f172a' },
                            { label: 'Planned Spend', value: money(bSum.planned_spend), color: '#059669' },
                            { label: 'Projected Savings', value: money(bSum.projected_savings), color: '#16a34a' },
                            { label: 'Avg Cost / Post', value: money(bSum.avg_cost_per_post), color: '#334155' },
                            { label: 'Requested Posts', value: bSum.requested_quantity ?? '—', color: '#334155' },
                            { label: 'AI Recommended', value: bSum.recommended_quantity ?? '—', color: '#7c3aed' },
                            { label: 'Redundant Posts Saved', value: bSum.redundant_posts_saved ?? 0, color: '#d97706' }
                          ].map((c, i) => (
                            <div key={i}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 3 }}>{c.label}</div>
                              <div style={{ fontSize: 16, fontWeight: 800, color: c.color }}>{c.value}</div>
                            </div>
                          ))}
                        </div>
                        {(bSum.projected_savings > 0 || bSum.redundant_posts_saved > 0) && (
                          <div style={{ fontSize: 12, color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 10px', marginTop: 10 }}>
                            AI avoided redundant spend: {bSum.redundant_posts_saved > 0 ? `${bSum.redundant_posts_saved} fewer posts, ` : ''}{money(bSum.projected_savings)} kept under the cap.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Batch tables */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {['high', 'medium', 'low'].map(bk => {
                        const meta = PUSH_BATCH_META[bk];
                        const rows = runBatches[bk];
                        return (
                          <div key={bk} style={{ background: '#ffffff', borderRadius: 14, border: `1px solid ${meta.border}`, overflow: 'hidden' }}>
                            <div style={{ padding: '10px 18px', background: meta.bg, borderBottom: `1px solid ${meta.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                              <meta.Icon size={15} color={meta.tint} />
                              <span style={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a' }}>{meta.label}</span>
                              <span style={{ fontSize: 11, fontWeight: 800, color: meta.tint, background: '#ffffff', border: `1px solid ${meta.border}`, borderRadius: 10, padding: '1px 8px' }}>
                                {rows.length}
                              </span>
                            </div>
                            {rows.length === 0 ? (
                              <div style={{ fontSize: 12.5, color: '#94a3b8', fontStyle: 'italic', padding: '14px 18px' }}>
                                No keywords categorized into this batch.
                              </div>
                            ) : (
                              <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, textAlign: 'left', minWidth: 900 }}>
                                  <thead>
                                    <tr style={{ color: '#64748b', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                      <th style={{ padding: '8px 12px', width: 40, textAlign: 'center' }}></th>
                                      <th style={{ padding: '8px 14px', minWidth: 220 }}>Keyword &amp; Intent</th>
                                      <th style={{ padding: '8px 14px', width: 150 }}>Rank Shift</th>
                                      <th style={{ padding: '8px 14px', width: 70 }}>SV</th>
                                      <th style={{ padding: '8px 14px', width: 55 }}>KD</th>
                                      <th style={{ padding: '8px 14px', width: 60 }}>Conf</th>
                                      <th style={{ padding: '8px 14px', minWidth: 240 }}>Live AI Status &amp; Rationale</th>
                                      <th style={{ padding: '8px 14px', minWidth: 180 }}>Target Outreach Site</th>
                                      <th style={{ padding: '8px 14px', minWidth: 180 }}>Landing Page</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows.map((k, ri) => {
                                      const site = k.outreach_site || null;
                                      const delta = k.delta;
                                      return (
                                        <tr key={ri} style={{ borderTop: '1px solid #f1f5f9', background: k.selected ? '#f5f3ff' : 'transparent' }}>
                                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                            {k.selected ? (
                                              <span title="Selected & scheduled in this run" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: 5, background: '#7c3aed' }}>
                                                <Check size={12} color="#ffffff" />
                                              </span>
                                            ) : (
                                              <span style={{ display: 'inline-block', width: 15, height: 15, borderRadius: 4, border: '1px solid #cbd5e1', background: '#f8fafc' }} />
                                            )}
                                          </td>
                                          <td style={{ padding: '8px 14px' }}>
                                            <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 12.5 }}>{k.keyword}</div>
                                            <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>
                                              {[k.category, k.cluster].filter(Boolean).join(' · ') || '—'}
                                              {k.top3_is_landing ? <span style={{ marginLeft: 6, color: '#15803d', fontWeight: 700 }}></span> : null}
                                            </div>
                                          </td>
                                          <td style={{ padding: '8px 14px' }}>
                                            <span style={{ color: '#334155' }}>{fmtRank(k.prev_rank)} → <strong>{fmtRank(k.live_rank)}</strong></span>
                                            {delta != null && delta !== 0 && (
                                              <span style={{ marginLeft: 6, fontWeight: 700, color: delta > 0 ? '#16a34a' : '#dc2626' }}>
                                                {delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`}
                                              </span>
                                            )}
                                          </td>
                                          <td style={{ padding: '8px 14px', fontWeight: 600, color: '#334155' }}>{k.sv ? Number(k.sv).toLocaleString() : '—'}</td>
                                          <td style={{ padding: '8px 14px', color: '#64748b' }}>{k.kd ?? '—'}</td>
                                          <td style={{ padding: '8px 14px', fontWeight: 700, color: (k.confidence ?? 0) >= 80 ? '#16a34a' : ((k.confidence ?? 0) >= 60 ? '#d97706' : '#64748b') }}>
                                            {k.confidence != null ? `${k.confidence}%` : '—'}
                                          </td>
                                          <td style={{ padding: '8px 14px', color: '#334155', lineHeight: 1.45, fontSize: 12 }}>
                                            {k.reason || '—'}
                                          </td>
                                          <td style={{ padding: '8px 14px' }}>
                                            {site?.domain ? (
                                              <div>
                                                <div style={{ fontWeight: 700, color: '#1e1b4b', fontSize: 12 }}>{site.domain}</div>
                                                <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 1, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                                  {site.da != null ? <span>DA {site.da}</span> : null}
                                                  {(site.spam_score != null || site.ss != null) ? <span>Spam {site.ss || `${site.spam_score}%`}</span> : null}
                                                  {(site.selling_price != null || site.price != null) ? (
                                                    <strong style={{ color: '#059669' }}>
                                                      {String(site.selling_price || site.price).startsWith('₹') ? (site.selling_price || site.price) : `₹${site.selling_price || site.price}`}
                                                    </strong>
                                                  ) : null}
                                                </div>
                                                {site.match_rationale && (
                                                  <div style={{ fontSize: 10, color: '#4338ca', marginTop: 2 }}>
                                                    {site.match_rationale}
                                                  </div>
                                                )}
                                              </div>
                                            ) : (
                                              <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>—</span>
                                            )}
                                          </td>
                                          <td style={{ padding: '8px 14px' }}>
                                            {k.landing_page_url ? (
                                              <a href={k.landing_page_url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: '#7c3aed', wordBreak: 'break-all' }}>
                                                {k.landing_page_url}
                                              </a>
                                            ) : (
                                              <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>—</span>
                                            )}
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
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CalendarPage;
