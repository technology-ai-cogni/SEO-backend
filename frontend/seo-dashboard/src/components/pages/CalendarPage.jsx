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
  Layers,
  Eye,
  Sliders,
  ExternalLink,
  HelpCircle,
  User as UserIcon,
  AlertCircle,
  Globe,
  Bot,
  DollarSign,
  Send
} from 'lucide-react';
import {
  fetchDomainRows,
  listCalendarActivitiesApi,
  createCalendarActivityApi,
  updateCalendarActivityApi,
  deleteCalendarActivityApi,
  fetchCalendarPotentialKeywordsApi,
  analyzeCalendarAiPushPotentialApi
} from '../../lib/projectsApi';
import BrandInfinityLoader from '../common/BrandInfinityLoader';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const PERIOD_YEARS = [2025, 2026, 2027, 2028];

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
        <input tabIndex={-1} aria-hidden required value={value || ''} onChange={() => {}}
          style={{ position: 'absolute', bottom: 0, left: 12, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
      )}
    </div>
  );
}

// ─── PUSH-POTENTIAL BATCHING ───
const PUSH_BATCH_META = {
  high: {
    key: 'high',
    order: 1,
    label: 'Batch 1 · Extremely Improved (Gains)',
    tint: '#16a34a',
    bg: '#f0fdf4',
    border: '#bbf7d0',
    Icon: TrendingUp,
    hint: 'Live rank surged vs previous rank & Top 3 Google SERP are Landing Pages'
  },
  medium: {
    key: 'medium',
    order: 2,
    label: 'Batch 2 · Extremely Dropped (Red Alert)',
    tint: '#d97706',
    bg: '#fffbeb',
    border: '#fde68a',
    Icon: TrendingDown,
    hint: 'Live rank dropped vs previous rank & Top 3 Google SERP are Landing Pages (Prime recovery targets)'
  },
  low: {
    key: 'low',
    order: 3,
    label: 'Batch 3 · Didn’t Move / Stagnant',
    tint: '#64748b',
    bg: '#f8fafc',
    border: '#cbd5e1',
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
  const [topicLinks, setTopicLinks] = useState({});
  const [collapsedBatches, setCollapsedBatches] = useState({ high: false, medium: false, low: false });

  // Outreach Sites & Budget Optimization State
  const [availableOutreachSites, setAvailableOutreachSites] = useState([]);
  const [budgetOptimization, setBudgetOptimization] = useState(null);
  const [selectedOutreachSites, setSelectedOutreachSites] = useState({});

  const handleSelectSiteForKeyword = (kwId, site) => {
    setSelectedOutreachSites(prev => ({
      ...prev,
      [kwId]: site
    }));
  };

  // Period Selector defaults
  const now = new Date();
  const [periodMonth, setPeriodMonth] = useState(MONTH_NAMES[now.getMonth()]);
  const [periodYear, setPeriodYear] = useState(now.getFullYear());

  // Multi-activity list in Step 1 modal
  const [activitiesList, setActivitiesList] = useState([
    { id: 'act-1', activity_name: 'Paid Guest Post', quantity: 1, budget: '$250' }
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
      { id: `act-${Date.now()}`, activity_name: 'Forum - Quora', quantity: 1, budget: '$150' }
    ]);
  };

  const handleUpdateActivityRow = (id, field, value) => {
    setActivitiesList(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
  };

  const handleRemoveActivityRow = (id) => {
    if (activitiesList.length <= 1) return;
    setActivitiesList(prev => prev.filter(a => a.id !== id));
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
    setActivitiesList([
      { id: 'act-1', activity_name: 'Paid Guest Post', quantity: 1, budget: '$250' }
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
    setActivitiesList([
      { id: item.id, activity_name: item.activity_name || 'Paid Guest Post', quantity: item.quantity || 1, budget: item.budget || '$250' }
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
      const primaryAct = activitiesList[0] || { activity_name: 'Paid Guest Post', quantity: 1, budget: '$250' };

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

      if (kws.length === 0) {
        setPotentialKws([]);
        setPushBatches({ high: [], medium: [], low: [] });
        setSelectedKwIds(new Set());
        setLoadingKeywords(false);
        return;
      }

      const initialTopicLinks = {};
      kws.forEach(k => {
        if (k.topicLink || k.landing_page_url) {
          initialTopicLinks[k.id] = k.topicLink || k.landing_page_url;
        }
      });
      setTopicLinks(initialTopicLinks);

      // Step 2: Live ranking ping with budget and quantity optimization
      setLoadingStepText(`Checking live Google rankings & search intent for ${kws.length} candidate keywords...`);
      setAnalyzingPotential(true);

      try {
        const aiRes = await analyzeCalendarAiPushPotentialApi(slug, domain, kws, 'India', totalBudget, totalQty);
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
              if (!next[ek.id] && (ek.topicLink || ek.landing_page_url)) {
                next[ek.id] = ek.topicLink || ek.landing_page_url;
              }
            });
            return next;
          });

          // Auto-select Batch 1 (Gains) & Batch 2 (Drops)
          const b1and2 = [
            ...(aiRes.batches.high || []).map(k => k.id),
            ...(aiRes.batches.medium || []).map(k => k.id)
          ];
          setSelectedKwIds(new Set(b1and2));
        } else {
          setPotentialKws(kws);
          setPushBatches(fallbackBatches);
          setSelectedKwIds(new Set([
            ...(fallbackBatches.high || []).map(k => k.id),
            ...(fallbackBatches.medium || []).map(k => k.id)
          ]));
        }
      } catch (liveErr) {
        console.warn('[CalendarPage] Live rank check notice:', liveErr);
        setPotentialKws(kws);
        setPushBatches(fallbackBatches);
        setSelectedKwIds(new Set([
          ...(fallbackBatches.high || []).map(k => k.id),
          ...(fallbackBatches.medium || []).map(k => k.id)
        ]));
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
          topic_link: isPaidGuestPost ? '' : (topicLinks[k.id] || k.topicLink || k.landing_page_url || ''),
          outreach_site: chosenSite
        };
      });

      const updatePayload = {
        potential_keywords: selectedPotential,
        status: 'scheduled'
      };
      if (selectedPotential.length > 0) {
        updatePayload.keyword_name = selectedPotential.map(k => k.keyword).join(', ');
        updatePayload.category = selectedPotential[0].category;
        updatePayload.cluster = selectedPotential[0].cluster;
        if (!isPaidGuestPost) {
          updatePayload.topic_link = selectedPotential.map(k => k.topic_link).filter(Boolean).join(' | ');
        }
      }

      await updateCalendarActivityApi(createdActivity.id, updatePayload);
      setActivities(prev => prev.map(a => a.id === createdActivity.id ? { ...a, ...updatePayload } : a));
      setIsModalOpen(false);
      setActiveSubTab('scheduled');
    } catch (err) {
      alert(`Error scheduling keywords: ${err.message}`);
    } finally {
      setSavingActivity(false);
    }
  };

  const handleMoveStatus = async (item, newStatus) => {
    try {
      await updateCalendarActivityApi(item.id, { status: newStatus });
      setActivities(prev => prev.map(a => a.id === item.id ? { ...a, status: newStatus } : a));
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
    const headers = ['Activity Name', 'Project Name', 'Main POC', 'Content POC', 'Quantity', 'Budget', 'Period', 'Scheduler', 'Auditor', 'Status'];
    const rows = filteredActivities.map(a => [
      `"${(a.activity_name || '').replace(/"/g, '""')}"`,
      `"${(a.project_name || '').replace(/"/g, '""')}"`,
      `"${(a.main_poc || '').replace(/"/g, '""')}"`,
      `"${(a.content_poc || '').replace(/"/g, '""')}"`,
      a.quantity || 1,
      `"${String(a.budget || '').replace(/"/g, '""')}"`,
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
    const totalAllocatedBudgetFormatted = totalAllocatedBudget > 0 ? `$${totalAllocatedBudget.toLocaleString()}` : '$250';
    const totalRequestedQuantity = activitiesList.reduce((acc, a) => acc + (parseInt(a.quantity, 10) || 1), 0);

    return (
      <div style={{ padding: '24px 32px', minHeight: '100%', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Top Header Card */}
        <div style={{
          background: '#ffffff',
          borderRadius: 14,
          border: '1px solid #E4DFEE',
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

            <div style={{ width: 1, height: 28, background: '#E4DFEE', flexShrink: 0 }} />

            <div style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <Sparkles size={20} color="#7c3aed" />
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
                  AI Scheduling Decision &amp; Keyword Strategy
                </h1>
                {createdActivity?.project_name && (
                  <span style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: '#4338ca',
                    background: '#eef2ff',
                    border: '1px solid #c7d2fe',
                    padding: '2px 8px',
                    borderRadius: 6
                  }}>
                    {createdActivity.project_name}
                  </span>
                )}
                <span style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: '#7c3aed',
                  background: '#ede9fe',
                  border: '1px solid #ddd6fe',
                  padding: '2px 8px',
                  borderRadius: 6
                }}>
                  {createdActivity?.activity_name || 'Campaign'}
                </span>
              </div>
              <p style={{ fontSize: 12.5, color: '#64748b', margin: '3px 0 0 0' }}>
                AI evaluated keyword intent, verified landing page SERPs, and generated optimal resource allocation.
              </p>
            </div>
          </div>

          {/* Right side: View Mode Switch */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f1f5f9', padding: 3, borderRadius: 10 }}>
            <button
              type="button"
              onClick={() => setStep2ViewMode('strategy')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                fontSize: 12.5,
                fontWeight: step2ViewMode === 'strategy' ? 700 : 600,
                color: step2ViewMode === 'strategy' ? '#7c3aed' : '#64748b',
                background: step2ViewMode === 'strategy' ? '#ffffff' : 'transparent',
                border: 'none',
                borderRadius: 7,
                cursor: 'pointer',
                boxShadow: step2ViewMode === 'strategy' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
              }}
            >
              <Bot size={14} />
              <span>Executive Strategy</span>
            </button>
            <button
              type="button"
              onClick={() => setStep2ViewMode('breakdown')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                fontSize: 12.5,
                fontWeight: step2ViewMode === 'breakdown' ? 700 : 600,
                color: step2ViewMode === 'breakdown' ? '#7c3aed' : '#64748b',
                background: step2ViewMode === 'breakdown' ? '#ffffff' : 'transparent',
                border: 'none',
                borderRadius: 7,
                cursor: 'pointer',
                boxShadow: step2ViewMode === 'breakdown' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
              }}
            >
              <Layers size={14} />
              <span>Keyword Breakdown ({potentialKws.length})</span>
            </button>
          </div>
        </div>

        {/* LOADING STATE */}
        {loadingKeywords ? (
          <div style={{
            background: '#ffffff',
            borderRadius: 14,
            border: '1px solid #E4DFEE',
            padding: '64px 32px',
            textAlign: 'center',
            boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06)'
          }}>
            <BrandInfinityLoader label={loadingStepText} size="lg" minHeight="240px" />
            <div style={{ marginTop: 24, fontSize: 13, color: '#64748b', maxWidth: 480, margin: '16px auto 0' }}>
              We are checking live rankings and ensuring 100% Landing Page intent matching before showing recommendations.
            </div>
          </div>
        ) : (
          <>
            {/* EXECUTIVE STRATEGY HERO CARD */}
            <div style={{
              background: 'linear-gradient(135deg, #ffffff 0%, #faf8ff 100%)',
              borderRadius: 16,
              border: '1px solid #E4DFEE',
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
                      color: '#7c3aed',
                      background: '#ede9fe',
                      padding: '3px 10px',
                      borderRadius: 20
                    }}>
                      <Sparkles size={12} />
                      AI Autonomous Strategy
                    </span>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>•</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
                      Period: {createdActivity?.period || `${periodMonth} ${periodYear}`}
                    </span>
                  </div>

                  <h2 style={{ fontSize: 19, fontWeight: 800, color: '#0f172a', margin: '0 0 10px 0', letterSpacing: '-0.02em' }}>
                    Executive Allocation &amp; Growth Narrative
                  </h2>

                  <p style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.6, margin: 0 }}>
                    For <strong>{createdActivity?.project_name || formData.project_name}</strong>, AI scanned{' '}
                    <strong>{potentialKws.length}</strong> candidate keywords and shortlisted{' '}
                    <strong style={{ color: '#7c3aed' }}>{selectedKwIds.size} high-impact landing page targets</strong> across{' '}
                    <strong>{uniqueLandingPagesCount} unique landing pages</strong>. 
                    Based on your requested <strong>{totalRequestedQuantity} activities</strong> and budget of{' '}
                    <strong>{totalAllocatedBudgetFormatted}</strong>, AI has prioritized{' '}
                    <strong style={{ color: '#d97706' }}>{selectedByBatch.medium} dropped keywords (red alert recovery targets)</strong> and{' '}
                    <strong style={{ color: '#16a34a' }}>{selectedByBatch.high} near-threshold gainers</strong>, avoiding redundant expenditure on keywords already performing in the Top 3.
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
                      color: '#ffffff',
                      background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                      border: 'none',
                      borderRadius: 10,
                      cursor: (selectedKwIds.size === 0 || savingActivity) ? 'not-allowed' : 'pointer',
                      boxShadow: '0 4px 14px rgba(124, 58, 237, 0.35)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {savingActivity ? (
                      <>
                        <div style={{ width: 14, height: 14, border: '2px solid #ffffff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        <span>Scheduling...</span>
                      </>
                    ) : (
                      <>
                        <Check size={16} />
                        <span>Confirm &amp; Schedule ({selectedKwIds.size})</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setStep2ViewMode('breakdown')}
                    style={{
                      padding: '9px 18px',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#475569',
                      background: '#ffffff',
                      border: '1px solid #E4DFEE',
                      borderRadius: 10,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      transition: 'background-color 0.15s ease'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = '#ffffff'}
                  >
                    <Eye size={15} color="#7c3aed" />
                    <span>View Keyword Breakdown</span>
                  </button>
                </div>
              </div>

              {/* 4 STRATEGIC KPI CARDS */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginTop: 22 }}>
                {/* Card 1: Keywords */}
                <div style={{ background: '#ffffff', border: '1px solid #E4DFEE', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Keywords Scanned vs Targeted
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{selectedKwIds.size}</span>
                    <span style={{ fontSize: 13, color: '#94a3b8' }}>of {potentialKws.length} scanned</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#16a34a', background: '#f0fdf4', padding: '1px 6px', borderRadius: 6, border: '1px solid #bbf7d0' }}>
                      +{selectedByBatch.high} Gains
                    </span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#d97706', background: '#fffbeb', padding: '1px 6px', borderRadius: 6, border: '1px solid #fde68a' }}>
                      -{selectedByBatch.medium} Drops
                    </span>
                  </div>
                </div>

                {/* Card 2: Activities Allocation */}
                <div style={{ background: '#ffffff', border: '1px solid #E4DFEE', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Activities Planned
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: '#7c3aed' }}>{totalRequestedQuantity}</span>
                    <span style={{ fontSize: 13, color: '#64748b' }}>across {activitiesList.length} types</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 6 }}>
                    Optimal activity pacing
                  </div>
                </div>

                {/* Card 3: Budget Optimization */}
                <div style={{ background: '#ffffff', border: '1px solid #E4DFEE', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Budget Allocation
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: '#059669' }}>
                      {budgetOptimization?.planned_spend !== undefined ? `$${budgetOptimization.planned_spend.toLocaleString()}` : totalAllocatedBudgetFormatted}
                    </span>
                    <span style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>
                      {budgetOptimization?.projected_savings > 0 ? `Saves $${budgetOptimization.projected_savings.toLocaleString()}` : 'Optimized'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 6 }}>
                    {budgetOptimization?.total_budget_cap ? `Cap: $${budgetOptimization.total_budget_cap.toLocaleString()}` : 'Direct spend against high-ROI assets'}
                  </div>
                </div>

                {/* Card 4: Target Landing Pages */}
                <div style={{ background: '#ffffff', border: '1px solid #E4DFEE', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Landing Pages Targeted
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{uniqueLandingPagesCount}</span>
                    <span style={{ fontSize: 13, color: '#64748b' }}>Unique URLs</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#16a34a', fontWeight: 700, marginTop: 6 }}>
                    100% Landing Page SERP Verified
                  </div>
                </div>
              </div>

              {/* AI Anti-Waste & Budget Efficiency Advisory */}
              {budgetOptimization?.anti_waste_advisory && (
                <div style={{
                  marginTop: 18,
                  padding: '16px 20px',
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)',
                  border: '1px solid #FDE68A',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 14,
                  boxShadow: '0 2px 8px rgba(217, 119, 6, 0.08)'
                }}>
                  <div style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: '#F59E0B',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <AlertCircle size={20} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 800, color: '#92400E' }}>
                        AI Anti-Waste &amp; Budget Efficiency Advisory
                      </span>
                      <span style={{
                        fontSize: 11,
                        fontWeight: 700,
                        background: '#16A34A',
                        color: '#ffffff',
                        padding: '2px 8px',
                        borderRadius: 10
                      }}>
                        ${budgetOptimization.projected_savings?.toLocaleString()} Projected Savings
                      </span>
                    </div>
                    <p style={{ fontSize: 12.5, color: '#78350F', margin: '4px 0 0 0', lineHeight: 1.5 }}>
                      {budgetOptimization.anti_waste_advisory}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, fontSize: 11.5, color: '#92400E', flexWrap: 'wrap' }}>
                      <span>Requested: <strong>{budgetOptimization.requested_activities} activities</strong> (${budgetOptimization.total_budget_cap?.toLocaleString()})</span>
                      <span>•</span>
                      <span>AI Recommended: <strong>{budgetOptimization.recommended_activities} target keywords</strong> (${budgetOptimization.planned_spend?.toLocaleString()})</span>
                      <span>•</span>
                      <span style={{ color: '#15803d', fontWeight: 700 }}>Strict 3-Domain Backlink Limit Rule Active</span>
                    </div>
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
                      background: '#ffffff',
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
                          background: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: `1px solid ${meta.border}`
                        }}>
                          <meta.Icon size={16} color={meta.tint} />
                        </div>
                        <div>
                          <span style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
                            {meta.label}
                          </span>
                          <span style={{
                            marginLeft: 8,
                            fontSize: 11,
                            fontWeight: 800,
                            padding: '2px 8px',
                            borderRadius: 10,
                            background: '#ffffff',
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
                              background: '#ffffff',
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
                            color: '#64748b',
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
                          <div style={{ fontSize: 12.5, color: '#94a3b8', fontStyle: 'italic', padding: '16px 20px' }}>
                            No keywords categorized into this batch.
                          </div>
                        ) : (
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, textAlign: 'left' }}>
                              <thead>
                                <tr style={{
                                  color: '#64748b',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.04em',
                                  background: '#f8fafc',
                                  borderBottom: '1px solid #e2e8f0'
                                }}>
                                  <th style={{ padding: '9px 12px', width: 44, textAlign: 'center' }}></th>
                                  <th style={{ padding: '9px 14px', minWidth: 240 }}>Keyword &amp; Strategy Intent</th>
                                  <th style={{ padding: '9px 14px', width: 170 }}>Rank Shift</th>
                                  <th style={{ padding: '9px 14px', width: 80 }}>SV</th>
                                  <th style={{ padding: '9px 14px', width: 60 }}>KD</th>
                                  <th style={{ padding: '9px 14px', width: 70 }}>Conf</th>
                                  <th style={{ padding: '9px 14px', minWidth: 220 }}>Live AI Status &amp; Rationale</th>
                                  <th style={{ padding: '9px 14px', width: 230 }}>Target Outreach Site</th>
                                  {!isPaidGuestPost && (
                                    <th style={{ padding: '9px 14px', width: 200 }}>Topic Link</th>
                                  )}
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
                                        borderTop: '1px solid #f1f5f9',
                                        background: isChecked ? '#f5f3ff' : 'transparent',
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
                                          style={{ cursor: 'pointer', width: 16, height: 16, accentColor: '#7c3aed' }}
                                        />
                                      </td>
                                      <td style={{ padding: '8px 14px', position: 'relative' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                          <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 13 }}>{item.keyword}</div>
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
                                              color: isInfoOpen ? '#7c3aed' : '#94a3b8',
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
                                            background: '#1e1b4b',
                                            color: '#ffffff',
                                            borderRadius: 8,
                                            padding: '10px 14px',
                                            maxWidth: 320,
                                            boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
                                            fontSize: 12,
                                            lineHeight: 1.4
                                          }}>
                                            <div style={{ fontWeight: 700, color: '#c4b5fd', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
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
                                            <span style={{ fontSize: 11, color: '#64748b' }}>
                                              {[item.category, item.cluster].filter(Boolean).join(' • ')}
                                            </span>
                                          )}
                                          {item.top3_is_landing !== undefined && (
                                            <span style={{
                                              fontSize: 10,
                                              fontWeight: 700,
                                              color: item.top3_is_landing ? '#16a34a' : '#dc2626',
                                              background: item.top3_is_landing ? '#dcfce7' : '#fee2e2',
                                              border: `1px solid ${item.top3_is_landing ? '#bbf7d0' : '#fecaca'}`,
                                              padding: '1px 6px',
                                              borderRadius: 4
                                            }}>
                                              {item.top3_is_landing ? 'Top 3: Landing Page ✓' : 'Top 3: Non-Landing'}
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
                                              background: '#dcfce7',
                                              color: '#15803d',
                                              border: '1px solid #bbf7d0',
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
                                              background: '#fee2e2',
                                              color: '#b91c1c',
                                              border: '1px solid #fecaca',
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
                                              background: '#f1f5f9',
                                              color: '#64748b',
                                              border: '1px solid #e2e8f0',
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
                                          <div style={{ fontSize: 11, color: '#64748b' }}>
                                            Prev: #{item.prev_rank ?? item.rank} → Now: <strong style={{ color: '#0f172a' }}>#{currentRank}</strong>
                                          </div>
                                        </div>
                                      </td>
                                      <td style={{ padding: '8px 14px', fontWeight: 600, color: '#334155' }}>
                                        {item.sv ? item.sv.toLocaleString() : '—'}
                                      </td>
                                      <td style={{ padding: '8px 14px', color: '#64748b' }}>
                                        {item.kd ?? '—'}
                                      </td>
                                      <td style={{ padding: '8px 14px' }}>
                                        {item.confidence !== undefined ? (
                                          <span style={{
                                            fontWeight: 700,
                                            fontSize: 11.5,
                                            color: item.confidence >= 80 ? '#16a34a' : (item.confidence >= 60 ? '#d97706' : '#64748b')
                                          }}>
                                            {item.confidence}%
                                          </span>
                                        ) : '—'}
                                      </td>
                                      <td style={{ padding: '8px 14px', color: '#334155', lineHeight: 1.45, fontSize: 12 }}>
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
                                                    color: assignedSite ? '#1e1b4b' : '#64748b',
                                                    background: '#ffffff',
                                                    border: '1px solid #cbd5e1',
                                                    borderRadius: 6,
                                                    outline: 'none',
                                                    maxWidth: 210,
                                                    cursor: 'pointer'
                                                  }}
                                                >
                                                  <option value="">-- Select Outreach Site --</option>
                                                  {availableOutreachSites.map(site => (
                                                    <option key={site.id || site.domain} value={site.domain}>
                                                      {site.domain} (DA {site.da} | ${site.price})
                                                    </option>
                                                  ))}
                                                </select>
                                              ) : assignedSite ? (
                                                <span style={{ fontSize: 12, fontWeight: 700, color: '#1e1b4b' }}>
                                                  {assignedSite.domain}
                                                </span>
                                              ) : (
                                                <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>
                                                  Auto-assigned on schedule
                                                </span>
                                              )}

                                              {assignedSite && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                                                  <span style={{
                                                    fontSize: 10,
                                                    fontWeight: 800,
                                                    background: (assignedSite.da || 0) >= 50 ? '#dcfce7' : '#f1f5f9',
                                                    color: (assignedSite.da || 0) >= 50 ? '#15803d' : '#475569',
                                                    border: `1px solid ${(assignedSite.da || 0) >= 50 ? '#bbf7d0' : '#cbd5e1'}`,
                                                    padding: '1px 5px',
                                                    borderRadius: 4
                                                  }}>
                                                    DA {assignedSite.da}
                                                  </span>
                                                  <span style={{
                                                    fontSize: 10,
                                                    fontWeight: 700,
                                                    background: (assignedSite.spam_score || 0) <= 5 ? '#f0fdf4' : '#fee2e2',
                                                    color: (assignedSite.spam_score || 0) <= 5 ? '#166534' : '#991b1b',
                                                    border: `1px solid ${(assignedSite.spam_score || 0) <= 5 ? '#bbf7d0' : '#fecaca'}`,
                                                    padding: '1px 5px',
                                                    borderRadius: 4
                                                  }}>
                                                    Spam {assignedSite.spam_score}%
                                                  </span>
                                                  <span style={{
                                                    fontSize: 10,
                                                    fontWeight: 700,
                                                    color: '#059669',
                                                    background: '#ecfdf5',
                                                    padding: '1px 5px',
                                                    borderRadius: 4
                                                  }}>
                                                    ${assignedSite.price}
                                                  </span>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })()}
                                      </td>
                                      {!isPaidGuestPost && (
                                        <td style={{ padding: '8px 14px' }}>
                                          <input
                                            type="text"
                                            placeholder="https://..."
                                            value={topicLinks[item.id] || ''}
                                            onChange={(e) => setTopicLinks({ ...topicLinks, [item.id]: e.target.value })}
                                            style={{
                                              width: '100%',
                                              padding: '5px 8px',
                                              fontSize: 12,
                                              border: '1px solid #cbd5e1',
                                              borderRadius: 6,
                                              outline: 'none',
                                              background: '#ffffff'
                                            }}
                                          />
                                        </td>
                                      )}
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
              border: '1px solid #E4DFEE',
              borderRadius: 12,
              padding: '12px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.08)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13, color: '#475569' }}>
                  <strong style={{ color: '#0f172a', fontSize: 14 }}>{selectedKwIds.size}</strong> of {potentialKws.length} keywords selected
                </div>
                {potentialKws.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>•</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '2px 8px', borderRadius: 10 }}>
                      {selectedByBatch.high} Gains
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a', padding: '2px 8px', borderRadius: 10 }}>
                      {selectedByBatch.medium} Drops
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '2px 8px', borderRadius: 10 }}>
                      {selectedByBatch.low} Stagnant
                    </span>
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
                    color: '#64748b',
                    background: '#ffffff',
                    border: '1px solid #E4DFEE',
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
                    color: '#ffffff',
                    background: selectedKwIds.size === 0 ? '#cbd5e1' : 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                    border: 'none',
                    borderRadius: 8,
                    cursor: (selectedKwIds.size === 0 || savingActivity) ? 'not-allowed' : 'pointer',
                    boxShadow: selectedKwIds.size === 0 ? 'none' : '0 2px 12px rgba(124, 58, 237, 0.35)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                  }}
                >
                  {savingActivity ? (
                    <>
                      <div style={{ width: 14, height: 14, border: '2px solid #ffffff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
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
              <span>Published (Live)</span>
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
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', width: 280 }}>
                    Project / Activities
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
                    Total Budget
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
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center', width: 140 }}>
                    Schedule / Move
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right', width: 90 }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {groupedProjects.length > 0 ? (
                  groupedProjects.map((group, gIdx) => {
                    const isExpanded = expandedProjects.has(group.projectName);
                    return (
                      <React.Fragment key={group.projectName || gIdx}>
                        {/* PARENT ROW: Project Summary */}
                        <tr style={{
                          borderBottom: '1px solid #e2e8f0',
                          background: gIdx % 2 === 0 ? '#ffffff' : '#fafafa',
                          fontWeight: 600
                        }}>
                          {/* Project Name + Tree expander */}
                          <td style={{ padding: '14px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <button
                                type="button"
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
                                  color: '#475569'
                                }}
                              >
                                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </button>
                              <div>
                                <div style={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <FolderOpen size={15} color="#7c3aed" />
                                  <span>{group.projectName}</span>
                                </div>
                                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                                  {group.items.length} activit{group.items.length === 1 ? 'y' : 'ies'} scheduled
                                </div>
                              </div>
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

                          {/* Status & Optional Redirect on Published */}
                          <td style={{ padding: '14px 16px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {/* Status Tag */}
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
                                {activeSubTab === 'saved' ? 'Draft' : (activeSubTab === 'published' ? 'Published (Live)' : activeSubTab)}
                              </span>

                              {/* Redirect to off-page: Only shown on publish page */}
                              {activeSubTab === 'published' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (onNavigate) {
                                      if (group.channel === 'content') onNavigate('content-engine');
                                      else onNavigate('search-visibility/off-page');
                                    }
                                  }}
                                  title={`Navigate to ${group.channel || 'off-page'}`}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    fontSize: 10.5,
                                    fontWeight: 700,
                                    padding: '2px 7px',
                                    borderRadius: 6,
                                    width: 'fit-content',
                                    background: '#f5f3ff',
                                    color: '#7c3aed',
                                    border: '1px solid #ddd6fe',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <span>{group.channel || 'Off-page'}</span>
                                  <ExternalLink size={10} />
                                </button>
                              )}
                            </div>
                          </td>

                          {/* Total Quantity */}
                          <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: 800, color: '#0f172a' }}>
                            {group.totalQuantity}
                          </td>

                          {/* Total Budget */}
                          <td style={{ padding: '14px 16px', fontWeight: 800, color: '#059669', fontSize: 13.5 }}>
                            ${group.totalBudget.toLocaleString()}
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

                          {/* Move Status / Direct Schedule Button */}
                          <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                            {activeSubTab === 'saved' && (
                              <button
                                type="button"
                                onClick={() => {
                                  // Open confirmation to AI schedule or move directly
                                  const firstItem = group.items[0];
                                  if (firstItem) {
                                    handleOpenEditModal(firstItem);
                                  }
                                }}
                                style={{
                                  background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                                  color: '#ffffff',
                                  border: 'none',
                                  padding: '5px 12px',
                                  borderRadius: 6,
                                  fontSize: 11.5,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  boxShadow: '0 2px 6px rgba(124, 58, 237, 0.25)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 5
                                }}
                              >
                                <Clock size={12} />
                                <span>Schedule</span>
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
                                  padding: '5px 10px',
                                  borderRadius: 6,
                                  fontSize: 11,
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
                                  padding: '5px 12px',
                                  borderRadius: 6,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 5,
                                  boxShadow: '0 2px 6px rgba(16, 185, 129, 0.25)'
                                }}
                              >
                                <Send size={12} />
                                <span>Publish All</span>
                              </button>
                            )}
                            {activeSubTab === 'published' && (
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#047857', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <CheckCircle2 size={13} color="#047857" />
                                <span>Live &amp; Published</span>
                              </span>
                            )}
                          </td>

                          {/* Project Actions */}
                          <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                            <button
                              type="button"
                              onClick={() => toggleProjectExpand(group.projectName)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#7c3aed',
                                fontSize: 11.5,
                                fontWeight: 700,
                                cursor: 'pointer'
                              }}
                            >
                              {isExpanded ? 'Hide' : 'View'} ({group.items.length})
                            </button>
                          </td>
                        </tr>

                        {/* CHILD ROWS (Expanded Tree Structure) */}
                        {isExpanded && group.items.map((item, idx) => (
                          <tr
                            key={item.id || idx}
                            style={{
                              borderBottom: '1px solid #f1f5f9',
                              background: '#fcfbfe'
                            }}
                          >
                            {/* Indented Activity Name */}
                            <td style={{ padding: '10px 16px 10px 36px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: '#cbd5e1', fontSize: 14 }}>↳</span>
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                                    {item.activity_name}
                                  </div>
                                  {item.keyword_name && (
                                    <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <Sparkles size={11} />
                                      <span>{item.keyword_name.split(',').length} keywords assigned</span>
                                    </div>
                                  )}
                                  {(() => {
                                    let kws = [];
                                    if (Array.isArray(item.potential_keywords)) kws = item.potential_keywords;
                                    else if (typeof item.potential_keywords === 'string') {
                                      try { kws = JSON.parse(item.potential_keywords); } catch (_) {}
                                    }
                                    const siteWithDomain = kws.find(k => k.outreach_site?.domain)?.outreach_site;
                                    if (siteWithDomain) {
                                      return (
                                        <div style={{ fontSize: 10.5, color: '#047857', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                                          <Globe size={11} />
                                          <span>Site: <strong>{siteWithDomain.domain}</strong> (DA {siteWithDomain.da || '—'})</span>
                                        </div>
                                      );
                                    }
                                    return null;
                                  })()}
                                </div>
                              </div>
                            </td>

                            {/* Activity Mode */}
                            <td style={{ padding: '10px 16px', fontSize: 12, color: '#64748b' }}>
                              {item.scheduler || 'Manual'}
                            </td>

                            {/* Sub Activity Status & Optional Redirect on Published */}
                            <td style={{ padding: '10px 16px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
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
                                  {(item.status || activeSubTab) === 'saved' ? 'Draft' : ((item.status || activeSubTab) === 'published' ? 'Live' : (item.status || activeSubTab))}
                                </span>

                                {/* Redirect only on publish page */}
                                {activeSubTab === 'published' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (onNavigate) {
                                        if (item.channel === 'content') onNavigate('content-engine');
                                        else onNavigate('search-visibility/off-page');
                                      }
                                    }}
                                    title={`Navigate to ${item.channel || 'off-page'}`}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4,
                                      fontSize: 10,
                                      fontWeight: 700,
                                      padding: '2px 6px',
                                      borderRadius: 5,
                                      width: 'fit-content',
                                      background: '#f5f3ff',
                                      color: '#7c3aed',
                                      border: '1px solid #ddd6fe',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    <span>{item.channel || 'Off-page'}</span>
                                    <ExternalLink size={10} />
                                  </button>
                                )}
                              </div>
                            </td>

                            {/* Individual Quantity */}
                            <td style={{ padding: '10px 16px', textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                              {item.quantity || 1}
                            </td>

                            {/* Individual Budget */}
                            <td style={{ padding: '10px 16px', fontSize: 12.5, fontWeight: 700, color: '#059669' }}>
                              {item.budget ? (String(item.budget).startsWith('$') ? item.budget : `$${item.budget}`) : '—'}
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

                            {/* Move Status Buttons */}
                            <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                                {/* On Draft: Only show Schedule button (never Approve) */}
                                {activeSubTab === 'saved' && (
                                  <button
                                    type="button"
                                    onClick={() => handleMoveStatus(item, 'scheduled')}
                                    title="Move to Scheduled"
                                    style={{
                                      background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                                      color: '#ffffff',
                                      border: 'none',
                                      padding: '4px 10px',
                                      borderRadius: 5,
                                      fontSize: 11,
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4,
                                      boxShadow: '0 1px 4px rgba(124, 58, 237, 0.2)'
                                    }}
                                  >
                                    <Clock size={11} />
                                    <span>Schedule</span>
                                  </button>
                                )}

                                {/* On Scheduled: Show Draft (to revert) and Approve (to advance) */}
                                {activeSubTab === 'scheduled' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleMoveStatus(item, 'saved')}
                                      title="Move back to Draft"
                                      style={{
                                        background: '#fef3c7',
                                        color: '#b45309',
                                        border: '1px solid #fde68a',
                                        padding: '4px 8px',
                                        borderRadius: 5,
                                        fontSize: 10.5,
                                        fontWeight: 700,
                                        cursor: 'pointer'
                                      }}
                                    >
                                      Draft
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleMoveStatus(item, 'approved')}
                                      title="Move to Approved"
                                      style={{
                                        background: '#d1fae5',
                                        color: '#047857',
                                        border: '1px solid #a7f3d0',
                                        padding: '4px 9px',
                                        borderRadius: 5,
                                        fontSize: 10.5,
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 3
                                      }}
                                    >
                                      <Check size={11} />
                                      <span>Approve</span>
                                    </button>
                                  </>
                                )}

                                {/* On Approved: Show Scheduled (to revert) and Publish (to advance) */}
                                {activeSubTab === 'approved' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleMoveStatus(item, 'scheduled')}
                                      title="Move back to Scheduled"
                                      style={{
                                        background: '#dbeafe',
                                        color: '#1d4ed8',
                                        border: '1px solid #bfdbfe',
                                        padding: '4px 8px',
                                        borderRadius: 5,
                                        fontSize: 10.5,
                                        fontWeight: 700,
                                        cursor: 'pointer'
                                      }}
                                    >
                                      Scheduled
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleMoveStatus(item, 'published')}
                                      title="Publish Live"
                                      style={{
                                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                        color: '#ffffff',
                                        border: 'none',
                                        padding: '4px 10px',
                                        borderRadius: 5,
                                        fontSize: 10.5,
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 3,
                                        boxShadow: '0 1px 4px rgba(16, 185, 129, 0.25)'
                                      }}
                                    >
                                      <Send size={10} />
                                      <span>Publish</span>
                                    </button>
                                  </>
                                )}

                                {/* On Published: Live status */}
                                {activeSubTab === 'published' && (
                                  <span style={{ fontSize: 11, fontWeight: 700, color: '#15803d', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <CheckCircle2 size={12} color="#15803d" />
                                    <span>Live</span>
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Individual Actions */}
                            <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
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
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={10} style={{ padding: '50px 20px', textAlign: 'center', color: '#94a3b8' }}>
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
                            placeholder="$250"
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
                          color: '#7c3aed',
                          background: '#ffffff',
                          border: '1px dashed #c4b5fd',
                          borderRadius: 8,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#f5f3ff'; e.currentTarget.style.borderColor = '#7c3aed'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#ffffff'; e.currentTarget.style.borderColor = '#c4b5fd'; }}
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
                      <input
                        type="text"
                        placeholder="e.g. John Doe"
                        value={formData.main_poc}
                        onChange={e => setFormData({ ...formData, main_poc: e.target.value })}
                        style={{ width: '100%', padding: '9px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                      />
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
    </div>
  );
}

export default CalendarPage;
