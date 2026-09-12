import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  getCalendarAiRunApi,
  generateForumStrategyApi
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

// ─── DYNAMIC CHANNEL CONFIG & NORMALIZATION ───
export function mapActivityToChannelKey(name = '') {
  const lower = String(name || '').toLowerCase();
  if (lower.includes('quora')) return 'quora';
  if (lower.includes('reddit')) return 'reddit';
  if (lower.includes('brand')) return 'brand_mention';
  return 'guest_post';
}

export const CHANNEL_CONFIG = {
  guest_post: { id: 'guest_post', label: 'Paid Guest Post', shortLabel: 'Guest Post' },
  quora: { id: 'quora', label: 'Quora', shortLabel: 'Quora' },
  reddit: { id: 'reddit', label: 'Reddit', shortLabel: 'Reddit' },
  brand_mention: { id: 'brand_mention', label: 'Brand Mention', shortLabel: 'Brand Mention' }
};

// ─── PUSH-POTENTIAL BATCHING (Hariba.ai Brand Palette) ───

export const formatRankBadge = (val) => {
  if (val == null) return '—';
  const num = Number(val);
  if (isNaN(num)) return String(val);
  return `#${num}`;
};

export const formatShiftSpots = (prev, curr, delta) => {
  const p = prev != null ? Number(prev) : null;
  const c = curr != null ? Number(curr) : null;
  const has101 = (p != null && p >= 101) || (c != null && c >= 101);
  if (has101) return '30+';
  const d = delta != null ? Math.abs(delta) : (p != null && c != null ? Math.abs(p - c) : null);
  if (d == null || d === 0) return '0 spots';
  if (d >= 30) return '30+';
  return `${d} spot${d > 1 ? 's' : ''}`;
};

export const cleanReasonSpots = (reasonText) => {
  if (!reasonText || typeof reasonText !== 'string') return reasonText;
  return reasonText
    .replace(/(?:[3-9]\d|\d{3,})\s+spots?/gi, '30+')
    .replace(/\+8\d\b/g, '+30+')
    .replace(/-8\d\b/g, '-30+');
};

// ─── INTERACTIVE SERP SPARKLINE ON HOVER (PORTAL BASED - NEVER CLIPPED BY BATCH OR HEADER) ───
function RankSparklineHover({ initialRank, prevRank, liveRank, delta, gainPctStr, history = [] }) {
  const [hovered, setHovered] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);

  const initNum = initialRank != null ? Number(initialRank) : (prevRank != null ? Number(prevRank) : null);
  const pNum = prevRank != null ? Number(prevRank) : initNum;
  const lNum = liveRank != null ? Number(liveRank) : null;
  const has101 = (initNum != null && initNum >= 101) || (pNum != null && pNum >= 101) || (lNum != null && lNum >= 101);
  const isUp = (pNum != null && lNum != null && pNum > lNum) || (delta > 0) || (pNum != null && pNum >= 101 && lNum != null && lNum < 101);
  const isDrop = (pNum != null && lNum != null && pNum < lNum) || (delta < 0) || (lNum != null && lNum >= 101 && pNum != null && pNum < 101);

  // Build points array showing: Initial -> Last Check -> Now
  let points = [];
  if (Array.isArray(history) && history.length >= 3) {
    points = history.map((h, i) => {
      const isFirst = i === 0;
      const isLast = i === history.length - 1;
      const isSecondToLast = i === history.length - 2;
      return {
        rank: Number(h.rank ?? h.new_rank ?? 10),
        label: isFirst ? 'Initial' : (isLast ? 'Now' : (isSecondToLast ? 'Last Check' : (h.date || `Hit ${i + 1}`)))
      };
    });
    // Ensure Initial rank is at start if distinct
    if (initNum != null && points[0].rank !== initNum) {
      points.unshift({ rank: initNum, label: 'Initial' });
    } else {
      points[0].label = 'Initial';
    }
    // Ensure last point is Now
    if (lNum != null && points[points.length - 1].rank !== lNum) {
      points.push({ rank: lNum, label: 'Now' });
    } else {
      points[points.length - 1].label = 'Now';
    }
  } else {
    // 3 distinct stages: Initial -> Last Check -> Now
    points = [
      { rank: initNum ?? pNum ?? 10, label: 'Initial' },
      { rank: pNum ?? initNum ?? 10, label: 'Last Check' },
      { rank: lNum ?? pNum ?? 10, label: 'Now' }
    ];
  }

  const strokeColor = isUp ? '#00BFA2' : (isDrop ? '#D4007A' : '#8A8A9A');
  const fillColor = isUp ? '#E6FAF6' : (isDrop ? '#FDEBF4' : '#F5F5F5');
  const borderColor = isUp ? '#A7F3D0' : (isDrop ? '#F8B4D9' : '#E2DBEC');

  // Dynamic chart dimensions
  const chartWidth = Math.max(130, Math.min(210, points.length * 38));
  const chartHeight = 32;
  const padX = 12;

  const calcY = (r) => {
    if (r == null || isNaN(r)) return 16;
    const clamped = Math.max(1, Math.min(100, r));
    // Invert Y so rank 1 is highest on chart (Y=6) and rank 100 is at bottom (Y=28)
    return Math.round(28 - ((100 - clamped) * 0.22));
  };

  const getX = (idx) => {
    if (points.length <= 1) return chartWidth / 2;
    return Math.round(padX + (idx * ((chartWidth - (2 * padX)) / (points.length - 1))));
  };

  // Generate SVG path (smooth curve or polyline)
  const pathD = points.length === 2
    ? `M ${getX(0)},${calcY(points[0].rank)} Q ${(getX(0) + getX(1)) / 2},${Math.max(4, Math.min(28, (calcY(points[0].rank) + calcY(points[1].rank)) / 2 + (isUp ? -4 : (isDrop ? 4 : 0))))} ${getX(1)},${calcY(points[1].rank)}`
    : points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx)},${calcY(p.rank)}`).join(' ');

  const handleMouseEnter = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const popoverHeight = 115;
      const popoverWidth = chartWidth + 24;
      const spaceBelow = window.innerHeight - rect.bottom;
      const placeAbove = spaceBelow < popoverHeight && rect.top > popoverHeight;

      setCoords({
        top: placeAbove ? (rect.top - popoverHeight - 6) : (rect.bottom + 6),
        left: Math.max(10, Math.min(window.innerWidth - popoverWidth - 10, rect.left))
      });
    }
    setHovered(true);
  };

  const badgeShiftText = has101 ? '30+' : (gainPctStr || `${Math.abs(delta || 0)}`);

  return (
    <>
      <div
        ref={triggerRef}
        style={{ position: 'relative', display: 'inline-block' }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setHovered(false)}
      >
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          background: fillColor,
          color: strokeColor,
          border: `1px solid ${borderColor}`,
          padding: '2px 8px',
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 800,
          cursor: 'pointer',
          transition: 'all 0.15s ease'
        }}>
          <span>{isUp ? `↑ ${badgeShiftText}` : (isDrop ? `↓ ${badgeShiftText}` : '— 0%')}</span>
          <span style={{ fontSize: 9.5, opacity: 0.9 }}>{isUp ? 'GAIN' : (isDrop ? 'DROP' : 'STEADY')}</span>
        </div>
      </div>

      {hovered && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed',
          top: coords.top,
          left: coords.left,
          zIndex: 999999,
          background: '#0F172A',
          color: '#FFFFFF',
          borderRadius: 8,
          padding: '9px 12px',
          boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
          minWidth: chartWidth + 24,
          pointerEvents: 'none',
          border: '1px solid #334155'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 9.5, fontWeight: 800, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Historical Pattern
            </span>
            <span style={{ fontSize: 9, color: '#64748B', fontWeight: 600 }}>
              {points.length} {points.length === 1 ? 'Check' : 'Checks'}
            </span>
          </div>

          <svg width={chartWidth} height={chartHeight} style={{ overflow: 'visible', display: 'block', margin: '0 auto' }}>
            <path
              d={pathD}
              fill="none"
              stroke={strokeColor}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {points.map((p, idx) => {
              const isLast = idx === points.length - 1;
              return (
                <circle
                  key={idx}
                  cx={getX(idx)}
                  cy={calcY(p.rank)}
                  r={isLast ? 3.5 : 2.5}
                  fill={isLast ? strokeColor : '#FFFFFF'}
                  stroke={strokeColor}
                  strokeWidth="1.5"
                />
              );
            })}
          </svg>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, fontWeight: 600, color: '#CBD5E1', marginTop: 4, gap: 8 }}>
            {points.length <= 4 ? (
              points.map((p, idx) => (
                <div key={idx} style={{ textAlign: idx === 0 ? 'left' : (idx === points.length - 1 ? 'right' : 'center') }}>
                  <div style={{ fontSize: 8.5, color: '#64748B' }}>{p.label}</div>
                  <div style={{ fontWeight: 800, color: idx === points.length - 1 ? strokeColor : '#E2E8F0' }}>
                    {formatRankBadge(p.rank)}
                  </div>
                </div>
              ))
            ) : (
              <>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 8.5, color: '#64748B' }}>{points[0].label}</div>
                  <div style={{ fontWeight: 800, color: '#E2E8F0' }}>{formatRankBadge(points[0].rank)}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 8.5, color: '#64748B' }}>Mid</div>
                  <div style={{ fontWeight: 800, color: '#E2E8F0' }}>{formatRankBadge(points[Math.floor(points.length / 2)].rank)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 8.5, color: '#64748B' }}>{points[points.length - 1].label}</div>
                  <div style={{ fontWeight: 800, color: strokeColor }}>{formatRankBadge(points[points.length - 1].rank)}</div>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ─── COMPACT RATIONALE BUTTON WITH FULL HOVER POPOVER (PORTAL BASED - NEVER CLIPPED) ───
function RationaleTooltip({ item }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);

  const conf = item.confidence != null ? Number(item.confidence) : 85;
  const confColor = conf >= 80 ? '#00BFA2' : (conf >= 60 ? '#D4007A' : '#8A8A9A');

  const handleMouseEnter = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const popoverHeight = 160;
      const popoverWidth = 310;
      const spaceBelow = window.innerHeight - rect.bottom;
      const placeAbove = spaceBelow < popoverHeight && rect.top > popoverHeight;

      setCoords({
        top: placeAbove ? (rect.top - popoverHeight - 6) : (rect.bottom + 6),
        left: Math.max(10, Math.min(window.innerWidth - popoverWidth - 10, rect.left))
      });
    }
    setOpen(true);
  };

  return (
    <>
      <div
        ref={triggerRef}
        style={{ position: 'relative', display: 'inline-block' }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setOpen(false)}
      >
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: open ? '#EDE9FE' : '#F6EEFD',
            border: '1px solid #E5CCF7',
            color: '#7B2FBE',
            borderRadius: 6,
            padding: '2px 8px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          <span>Rationale</span>
          <span style={{ fontSize: 10, opacity: 0.7 }}>...</span>
        </button>
      </div>

      {open && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed',
          top: coords.top,
          left: coords.left,
          zIndex: 999999,
          background: '#1E1B4B',
          color: '#FFFFFF',
          borderRadius: 10,
          padding: '12px 14px',
          width: 310,
          boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
          fontSize: 12,
          lineHeight: 1.45,
          border: '1px solid #4338CA',
          pointerEvents: 'none'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.12)', paddingBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#C7D2FE', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Sparkles size={12} /> AI Strategy Rationale
            </span>
            <span style={{
              fontSize: 10,
              fontWeight: 800,
              background: conf >= 80 ? '#059669' : '#D97706',
              color: '#FFFFFF',
              padding: '1px 6px',
              borderRadius: 4
            }}>
              {conf}% Confidence
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8, background: 'rgba(255,255,255,0.06)', padding: '6px 8px', borderRadius: 6 }}>
            <div>
              <span style={{ fontSize: 10, color: '#94A3B8' }}>Search Vol: </span>
              <strong style={{ color: '#FFFFFF' }}>{item.sv ? item.sv.toLocaleString() : '—'}</strong>
            </div>
            <div>
              <span style={{ fontSize: 10, color: '#94A3B8' }}>Difficulty: </span>
              <strong style={{ color: '#FFFFFF' }}>{item.kd ?? '—'}</strong>
            </div>
          </div>
          <p style={{ margin: 0, color: '#E0E7FF', fontSize: 11.5, lineHeight: 1.5 }}>
            {item.reason || 'Optimal candidate for top-3 rankings based on verified landing page search intent and SERP competitive gap.'}
          </p>
        </div>,
        document.body
      )}
    </>
  );
}

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
  const [noDataModalOpen, setNoDataModalOpen] = useState(false);
  const [noDataModalMsg, setNoDataModalMsg] = useState("There's no data to schedule");

  const showNoDataPopup = (msg = "There's no data to schedule") => {
    setNoDataModalMsg(msg);
    setNoDataModalOpen(true);
  };

  const renderNoDataModal = () => {
    if (!noDataModalOpen) return null;
    return (
      <div
        onClick={() => setNoDataModalOpen(false)}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999,
          padding: 20
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            background: '#ffffff',
            borderRadius: 16,
            width: '100%',
            maxWidth: 440,
            padding: '28px 24px 22px 24px',
            boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.35)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            border: '1px solid #fee2e2'
          }}
        >
          <div style={{
            width: 54,
            height: 54,
            borderRadius: '50%',
            background: '#FEE2E2',
            color: '#DC2626',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16
          }}>
            <AlertCircle size={30} />
          </div>

          <h4 style={{
            fontSize: 18,
            fontWeight: 800,
            color: '#0f172a',
            margin: '0 0 10px 0',
            letterSpacing: '-0.01em'
          }}>
            There's no data to schedule
          </h4>

          <p style={{
            fontSize: 13.5,
            color: '#64748b',
            lineHeight: 1.55,
            margin: '0 0 22px 0'
          }}>
            {noDataModalMsg || "There's no data to schedule. Please ensure all required fields and keywords are configured."}
          </p>

          <button
            type="button"
            onClick={() => setNoDataModalOpen(false)}
            style={{
              width: '100%',
              padding: '11px 18px',
              fontSize: 13.5,
              fontWeight: 700,
              color: '#ffffff',
              background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
              border: 'none',
              borderRadius: 9,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              boxShadow: '0 4px 12px rgba(15, 23, 42, 0.2)'
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.9'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
          >
            Okay, Got it
          </button>
        </div>
      </div>
    );
  };
  // Abandon-AI-run confirmation: shown when the user clicks "Back to Calendar"
  // from the AI review screen. The activities backing this run were already
  // created (status 'saved') before the review screen loaded -- if the user
  // confirms leaving, those get deleted so nothing empty/orphaned is left in
  // the DB; if they cancel, nothing changes and they stay on the review screen.
  const [abandonConfirmOpen, setAbandonConfirmOpen] = useState(false);
  const [abandonDeleting, setAbandonDeleting] = useState(false);

  const handleBackToCalendarClick = () => setAbandonConfirmOpen(true);
  const handleCancelAbandon = () => setAbandonConfirmOpen(false);

  const handleConfirmAbandon = async () => {
    setAbandonDeleting(true);
    try {
      const toDelete = (createdActivitiesList && createdActivitiesList.length > 0)
        ? createdActivitiesList
        : (createdActivity ? [createdActivity] : []);
      if (toDelete.length > 0) {
        await Promise.all(toDelete.map(a => deleteCalendarActivityApi(a.id).catch(() => { })));
        const deletedIds = new Set(toDelete.map(a => a.id));
        setActivities(prev => prev.filter(a => !deletedIds.has(a.id)));
      }
    } finally {
      setAbandonDeleting(false);
      setAbandonConfirmOpen(false);
      setCreatedActivity(null);
      setCreatedActivitiesList([]);
      setIsModalOpen(false);
      setModalStep('form');
    }
  };

  const renderAbandonConfirmModal = () => {
    if (!abandonConfirmOpen) return null;
    return (
      <div
        onClick={handleCancelAbandon}
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100000, padding: 20
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            background: '#ffffff', borderRadius: 16, width: '100%', maxWidth: 440,
            padding: '28px 24px 22px 24px', boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.35)',
            textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center',
            border: '1px solid #FDE68A'
          }}
        >
          <div style={{
            width: 54, height: 54, borderRadius: '50%', background: '#FEF3C7', color: '#D97706',
            display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16
          }}>
            <AlertCircle size={30} />
          </div>
          <h4 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: '0 0 10px 0', letterSpacing: '-0.01em' }}>

          </h4>
          <p style={{ fontSize: 13.5, color: '#64748b', lineHeight: 1.55, margin: '0 0 22px 0' }}>
            The AI-researched and shortlisted keywords for this run will no longer be here if you go back now --
            nothing will be scheduled, and this in-progress activity won't be saved.
          </p>
          <div style={{ display: 'flex', gap: 10, width: '100%' }}>
            <button
              type="button"
              onClick={handleCancelAbandon}
              disabled={abandonDeleting}
              style={{
                flex: 1, padding: '11px 18px', fontSize: 13.5, fontWeight: 700, color: '#334155',
                background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 9,
                cursor: abandonDeleting ? 'not-allowed' : 'pointer'
              }}
            >
              Stay &amp; keep working
            </button>
            <button
              type="button"
              onClick={handleConfirmAbandon}
              disabled={abandonDeleting}
              style={{
                flex: 1, padding: '11px 18px', fontSize: 13.5, fontWeight: 700, color: '#ffffff',
                background: abandonDeleting ? '#94a3b8' : 'linear-gradient(135deg, #DC2626 0%, #B91C1C 100%)',
                border: 'none', borderRadius: 9, cursor: abandonDeleting ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
              }}
            >
              {abandonDeleting && <div style={{ width: 13, height: 13, border: '2px solid #FFFFFF', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
              <span>{abandonDeleting ? 'Discarding…' : 'Yes, go back'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  const [modalStep, setModalStep] = useState('form'); // 'form' | 'keywords_prompt'
  const [createdActivity, setCreatedActivity] = useState(null);
  const [savingActivity, setSavingActivity] = useState(false);
  const [loadingKeywords, setLoadingKeywords] = useState(false);
  const [loadingStepText, setLoadingStepText] = useState('Scanning database & checking live rankings…');

  // Step 2 view state
  const [step2ViewMode, setStep2ViewMode] = useState('strategy');
  const [activeChannelTab, setActiveChannelTab] = useState('guest_post'); // 'guest_post' | 'quora' | 'reddit' | 'brand_mention'
  const [forumStrategies, setForumStrategies] = useState({ quora: null, reddit: null });
  const [selectedForumThreads, setSelectedForumThreads] = useState({ quora: new Set(), reddit: new Set() });
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
  const [selectedBrandMentionSites, setSelectedBrandMentionSites] = useState({}); // kwId -> chosen site (when brand_mention_sites has multiple options)
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
          loadedKeywords = kws.map((k, idx) => {
            const pRank = k.prev_rank || k.rank;
            const lRank = k.new_rank || k.rank;
            const pNum = pRank != null ? Number(pRank) : null;
            const lNum = lRank != null ? Number(lRank) : null;
            const isGoing101 = lNum != null && lNum >= 101 && (pNum != null && pNum < 101);
            const isCame101 = pNum != null && pNum >= 101 && (lNum != null && lNum < 101);
            const d = k.delta !== undefined ? k.delta : (pNum != null && lNum != null ? (pNum - lNum) : 0);
            return {
              id: k.id || `k-${idx}`,
              keyword: k.keyword,
              category: k.category,
              cluster: k.cluster,
              batch: k.push_batch || (isGoing101 ? 'medium' : (isCame101 ? 'high' : (d > 0 ? 'high' : (d < 0 ? 'medium' : 'low')))),
              live_rank: lRank,
              prev_rank: pRank,
              delta: d,
              sv: k.sv,
              kd: k.kd,
              confidence: k.push_confidence || k.confidence || 80,
              reason: k.push_reason || k.reason || 'Strategic candidate with verified domain metrics',
              outreach_site: k.outreach_site,
              landing_page_url: k.landing_page_url || (k.topic_link && !k.topic_link.includes('quora.com') && !k.topic_link.includes('reddit.com') ? k.topic_link : '') || (k.topicLink && !k.topicLink.includes('quora.com') && !k.topicLink.includes('reddit.com') ? k.topicLink : '') || '',
              topic_link: k.topic_link || (k.landing_page_url && (k.landing_page_url.includes('quora.com') || k.landing_page_url.includes('reddit.com')) ? k.landing_page_url : '') || (k.topicLink && (k.topicLink.includes('quora.com') || k.topicLink.includes('reddit.com')) ? k.topicLink : '') || activityItem.topic_link || '',
              calendar_rank_history: k.calendar_rank_history || k.history || [],
              budget_summary: bSum,
              selected: true
            };
          });
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
            landing_page_url: activityItem.landing_page_url || (activityItem.topic_link && !activityItem.topic_link.includes('quora.com') && !activityItem.topic_link.includes('reddit.com') ? activityItem.topic_link : '') || '',
            topic_link: activityItem.topic_link || '',
            calendar_rank_history: [],
            budget_summary: bSum,
            selected: true
          }));
        }

        const isItemManual = !activityItem.ai_run_id && !/ai/i.test(String(activityItem.scheduler || ''));
        if (!runMeta) {
          runMeta = {
            run_id: activityItem.ai_run_id || `activity-${activityItem.id}`,
            summary: activityItem.ai_summary || (isItemManual ? `Manual activity campaign for ${activityItem.activity_name}` : `Scheduled activities and keywords for ${activityItem.activity_name}`),
            ai_advisory: activityItem.ai_advisory,
            budget_summary: bSum,
            budget_used: activityItem.budget,
            quantity_requested: activityItem.quantity,
            created_at: activityItem.created_at,
            total_keywords: loadedKeywords.length || kws.length,
            is_manual: isItemManual
          };
        } else {
          runMeta.is_manual = isItemManual;
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

  // Brand Mentions can find MULTIPLE vetted outreach-table matches for one
  // keyword -- unlike Paid Guest Post there's no 4-keywords-per-domain reuse
  // limit here (each keyword's listing site is picked independently), so no
  // capacity check is needed, just remember which one the user picked.
  const handleSelectBrandMentionSite = (kwId, site) => {
    setSelectedBrandMentionSites(prev => ({
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
    content_poc: '',
    auditor: '',
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

  const currentActivitiesList = useMemo(() => {
    return (createdActivitiesList && createdActivitiesList.length > 0) ? createdActivitiesList : activitiesList;
  }, [createdActivitiesList, activitiesList]);

  const availableChannels = useMemo(() => {
    const set = new Set();
    (currentActivitiesList || []).forEach(a => {
      const key = mapActivityToChannelKey(a.activity_name);
      set.add(key);
    });
    if (set.size === 0) set.add('guest_post');
    return Array.from(set).map(k => CHANNEL_CONFIG[k] || { id: k, label: k });
  }, [currentActivitiesList]);

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
    setForumStrategies({ quora: null, reddit: null });
    setSelectedForumThreads({ quora: new Set(), reddit: new Set() });
    setActivitiesList([
      { id: 'act-1', activity_name: 'Paid Guest Post', quantity: 1, budget: '₹250' }
    ]);
    setFormData({
      project_name: activeProject?.name || activeProject?.domain || (projects[0]?.name || projects[0]?.domain || ''),
      main_poc: '',
      content_poc: '',
      auditor: '',
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
      content_poc: item.content_poc || '',
      auditor: item.auditor || '',
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
    const hasEmptyField = !formData.project_name?.trim()
      || !formData.content_poc?.trim()
      || !formData.auditor?.trim()
      || !activitiesList || activitiesList.length === 0
      || activitiesList.some(a => !a.activity_name?.trim() || !String(a.quantity || '').trim() || !String(a.budget || '').trim() || parseInt(a.quantity, 10) <= 0);

    if (hasEmptyField) {
      setConfirmAiModalOpen(false);
      showNoDataPopup("There's no data to schedule. Please fill in all required activity details, POC roles, and budget.");
      return;
    }
    setConfirmAiModalOpen(false);
    setSavingActivity(true);

    try {
      const formattedPeriod = `${periodMonth} ${periodYear}`;

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
          content_poc: formData.content_poc,
          auditor: formData.auditor,
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

      // Determine requested channels
      const requestedChannels = new Set(activitiesList.map(a => mapActivityToChannelKey(a.activity_name)));
      const hasGuestPost = requestedChannels.has('guest_post');
      const hasQuora = requestedChannels.has('quora');
      const hasReddit = requestedChannels.has('reddit');

      // Set default active tab to the first selected channel
      const firstTab = mapActivityToChannelKey(activitiesList[0]?.activity_name || 'guest_post');
      setActiveChannelTab(firstTab);

      // Transition to Step 2
      setModalStep('keywords_prompt');
      setStep2ViewMode('strategy');
      setSavingActivity(false);
      setLoadingKeywords(true);
      setLoadingStepText('Scanning database & generating channel strategies...');

      const matchedProj = projects.find(p => (p.name || p.domain) === formData.project_name);
      const slug = matchedProj?.slug || formData.project_name.toLowerCase().replace(/\s+/g, '');
      const domain = matchedProj?.domain || '';

      // Step 1: Query master candidate keywords for the project across all activities
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

      // Step 2: Run single live rank check for candidate keywords
      setLoadingStepText(`Analyzing & live ranking keywords...`);
      setAnalyzingPotential(true);

      let evaluatedKws = kws;
      try {
        const aiRes = await analyzeCalendarAiPushPotentialApi(slug, domain, kws, 'India', totalBudget, totalQty, primaryCreated?.id, activitiesList.map(a => a.activity_name));
        if (aiRes?.run_id) setLatestAiRunId(aiRes.run_id);
        if (aiRes?.summary) setLatestAiSummary(aiRes.summary);
        if (aiRes?.batches) {
          setPushBatches(aiRes.batches);
          evaluatedKws = (aiRes.evaluated_keywords && aiRes.evaluated_keywords.length > 0)
            ? aiRes.evaluated_keywords
            : kws;
          setPotentialKws(evaluatedKws);

          if (aiRes.available_outreach_sites) {
            setAvailableOutreachSites(aiRes.available_outreach_sites);
          }
          if (aiRes.budget_optimization) {
            setBudgetOptimization(aiRes.budget_optimization);
          }

          setSelectedOutreachSites(prev => {
            const next = { ...prev };
            evaluatedKws.forEach(ek => {
              if (ek.outreach_site && !next[ek.id]) {
                next[ek.id] = ek.outreach_site;
              }
            });
            return next;
          });

          // Auto-select keywords equal to or less than the quantity selected for the activity
          const maxAutoSelect = totalQty || 1;
          const evaluatedSelected = evaluatedKws.filter(k => k.selected).map(k => k.id).slice(0, maxAutoSelect);
          if (evaluatedSelected.length > 0) {
            setSelectedKwIds(new Set(evaluatedSelected));
          } else {
            const highQuota = Math.max(1, Math.round(maxAutoSelect * 0.6));
            const dropQuota = Math.max(0, maxAutoSelect - highQuota);
            const highPicked = (aiRes.batches.high || []).slice(0, highQuota).map(k => k.id);
            const otherCandidates = [...(aiRes.batches.medium || []), ...(aiRes.batches.low || [])];
            const otherPicked = otherCandidates.slice(0, dropQuota).map(k => k.id);
            const combined = [...highPicked, ...otherPicked].slice(0, maxAutoSelect);
            setSelectedKwIds(new Set(combined));
          }
        } else {
          setPotentialKws(kws);
          setPushBatches(fallbackBatches);
          const maxAutoSelect = totalQty || 1;
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
        const maxAutoSelect = totalQty || 1;
        const liveFallbackList = [
          ...(fallbackBatches.high || []).map(k => k.id),
          ...(fallbackBatches.medium || []).map(k => k.id)
        ].slice(0, maxAutoSelect);
        setSelectedKwIds(new Set(liveFallbackList));
      } finally {
        setAnalyzingPotential(false);
      }

      // Step 3: Discover Quora & Reddit topic links concurrently for all candidate keywords
      const forumPromises = [];
      if (hasQuora) {
        const quoraActs = activitiesList.filter(a => mapActivityToChannelKey(a.activity_name) === 'quora');
        const qQty = quoraActs.reduce((acc, a) => acc + (parseInt(a.quantity, 10) || 1), 0);
        const qBudget = quoraActs.reduce((acc, a) => acc + (parseFloat(String(a.budget || '0').replace(/[^0-9.]/g, '')) || 0), 0);
        const p = generateForumStrategyApi(slug, 'quora', qBudget, qQty).then(qRes => {
          if (qRes && (Array.isArray(qRes.threads) || qRes.batches)) {
            setForumStrategies(prev => ({ ...prev, quora: qRes }));
            const qThreads = qRes.threads || [];
            const nextLinks = {};
            qThreads.forEach(t => {
              if (t.topic_link) {
                nextLinks[`quora_${t.id}`] = t.topic_link;
                nextLinks[`quora_${t.keyword}`] = t.topic_link;
                nextLinks[t.id] = t.topic_link;
              }
            });
            setTopicLinks(prev => ({ ...prev, ...nextLinks }));
          }
        }).catch(err => console.warn('[CalendarPage] Quora strategy notice:', err));
        forumPromises.push(p);
      }

      if (hasReddit) {
        const redditActs = activitiesList.filter(a => mapActivityToChannelKey(a.activity_name) === 'reddit');
        const rQty = redditActs.reduce((acc, a) => acc + (parseInt(a.quantity, 10) || 1), 0);
        const rBudget = redditActs.reduce((acc, a) => acc + (parseFloat(String(a.budget || '0').replace(/[^0-9.]/g, '')) || 0), 0);
        const p = generateForumStrategyApi(slug, 'reddit', rBudget, rQty).then(rRes => {
          if (rRes && (Array.isArray(rRes.threads) || rRes.batches)) {
            setForumStrategies(prev => ({ ...prev, reddit: rRes }));
            const rThreads = rRes.threads || [];
            const nextLinks = {};
            rThreads.forEach(t => {
              if (t.topic_link) {
                nextLinks[`reddit_${t.id}`] = t.topic_link;
                nextLinks[`reddit_${t.keyword}`] = t.topic_link;
                nextLinks[t.id] = t.topic_link;
              }
            });
            setTopicLinks(prev => ({ ...prev, ...nextLinks }));
          }
        }).catch(err => console.warn('[CalendarPage] Reddit strategy notice:', err));
        forumPromises.push(p);
      }

      if (forumPromises.length > 0) {
        await Promise.all(forumPromises);
      }
      setLoadingKeywords(false);
    } catch (err) {
      alert(`Error running AI schedule: ${err.message}`);
      setSavingActivity(false);
      setLoadingKeywords(false);
    }
  };

  // ─── CONFIRM & SCHEDULE KEYWORDS FROM STEP 2 ───
  const handleConfirmAddKeywords = async () => {
    if (selectedKwIds.size === 0) {
      showNoDataPopup("There's no data to schedule. Please select at least one keyword.");
      return;
    }

    setSavingActivity(true);
    try {

      const targets = (createdActivitiesList && createdActivitiesList.length > 0)
        ? createdActivitiesList
        : [createdActivity];

      const totalPlannedSpend = (budgetOptimization?.planned_spend !== undefined && budgetOptimization.planned_spend > 0)
        ? budgetOptimization.planned_spend
        : activitiesList.reduce((acc, a) => acc + (parseFloat(String(a.budget || '0').replace(/[^0-9.]/g, '')) || 0), 0) || 250;

      const totalAllocatedBudget = activitiesList.reduce((acc, a) => acc + (parseFloat(String(a.budget || '0').replace(/[^0-9.]/g, '')) || 0), 0);

      let gpKwCursor = 0;
      const updatedTargets = [];

      for (let i = 0; i < targets.length; i++) {
        const tgt = targets[i];
        const actSpec = activitiesList[i] || activitiesList[0] || {};
        const actChannel = mapActivityToChannelKey(tgt.activity_name || actSpec.activity_name);
        const actReqQty = parseInt(actSpec.quantity || tgt.quantity, 10) || 1;
        const actReqBudget = parseFloat(String(actSpec.budget || tgt.budget || '0').replace(/[^0-9.]/g, '')) || (totalAllocatedBudget / (activitiesList.length || 1));
        const budgetWeight = totalAllocatedBudget > 0 ? (actReqBudget / totalAllocatedBudget) : (1 / (activitiesList.length || 1));
        const tgtBudget = Math.round(totalPlannedSpend * budgetWeight) || Math.round(totalPlannedSpend / (activitiesList.length || 1));

        let effectiveKws = [];
        let outreachList = [];

        if (actChannel === 'quora') {
          const gpb = pushBatches || {};
          const allMaster = [...(gpb.high || []), ...(gpb.medium || []), ...(gpb.low || []), ...(potentialKws || [])];
          const chosen = allMaster.filter(k => selectedKwIds.has(k.id));
          const list = chosen.length > 0 ? chosen : allMaster;
          const usedQuoraLinks = new Set();

          effectiveKws = list.map(t => {
            let tLink = t.quora_topic_link || topicLinks[`quora_${t.id}`] || topicLinks[`quora_${t.keyword}`] || forumStrategies.quora?.threads?.find(th => th.keyword === t.keyword || th.id === t.id)?.topic_link || topicLinks[t.id] || t.topic_link || '';
            const norm = String(tLink || '').toLowerCase().trim().replace(/\/+$/, '');
            // Reject any search URLs or duplicate links
            if (norm.includes('/search') || norm.includes('?q=') || norm.includes('search?') || usedQuoraLinks.has(norm)) {
              tLink = '';
            } else if (norm) {
              usedQuoraLinks.add(norm);
            }
            return {
              id: t.id,
              keyword: t.keyword,
              sv: t.sv,
              kd: t.kd,
              rank: t.new_rank || t.rank,
              prev_rank: t.prev_rank || t.rank,
              new_rank: t.new_rank || t.rank,
              delta: t.delta || 0,
              gain_pct_str: t.gain_pct_str,
              calendar_rank_history: t.calendar_rank_history || t.history || [],
              history: t.calendar_rank_history || t.history || [],
              confidence: t.confidence,
              reason: t.reason,
              category: t.category || t.cluster || 'Quora',
              cluster: t.cluster || 'Quora',
              landing_page_url: t.landing_page_url,
              topic_link: tLink,
              search_query: `${t.keyword} + quora`,
              action_type: 'Quora Question & Answer Topic Link',
              channel: 'Forum - Quora',
              thread_budget: t.thread_budget || Math.round(actReqBudget / (list.length || 1))
            };
          });
        } else if (actChannel === 'reddit') {
          const gpb = pushBatches || {};
          const allMaster = [...(gpb.high || []), ...(gpb.medium || []), ...(gpb.low || []), ...(potentialKws || [])];
          const chosen = allMaster.filter(k => selectedKwIds.has(k.id));
          const list = chosen.length > 0 ? chosen : allMaster;
          const usedRedditLinks = new Set();

          effectiveKws = list.map(t => {
            let tLink = t.reddit_topic_link || topicLinks[`reddit_${t.id}`] || topicLinks[`reddit_${t.keyword}`] || forumStrategies.reddit?.threads?.find(th => th.keyword === t.keyword || th.id === t.id)?.topic_link || topicLinks[t.id] || t.topic_link || '';
            const norm = String(tLink || '').toLowerCase().trim().replace(/\/+$/, '');
            // Reject any search URLs or duplicate links
            if (norm.includes('/search') || norm.includes('?q=') || norm.includes('search?') || !norm.includes('/comments/') || usedRedditLinks.has(norm)) {
              tLink = '';
            } else if (norm) {
              usedRedditLinks.add(norm);
            }
            return {
              id: t.id,
              keyword: t.keyword,
              sv: t.sv,
              kd: t.kd,
              rank: t.new_rank || t.rank,
              prev_rank: t.prev_rank || t.rank,
              new_rank: t.new_rank || t.rank,
              delta: t.delta || 0,
              gain_pct_str: t.gain_pct_str,
              calendar_rank_history: t.calendar_rank_history || t.history || [],
              history: t.calendar_rank_history || t.history || [],
              confidence: t.confidence,
              reason: t.reason,
              category: t.category || t.cluster || 'Reddit',
              cluster: t.cluster || 'Reddit',
              landing_page_url: t.landing_page_url,
              topic_link: tLink,
              search_query: `${t.keyword} + reddit`,
              action_type: 'Reddit Subreddit Discussion Link',
              channel: 'Forum - Reddit',
              thread_budget: t.thread_budget || Math.round(actReqBudget / (list.length || 1))
            };
          });
        } else {
          // Paid Guest Post: Only select keywords that have an outreach publisher assigned
          const gpb = pushBatches || {};
          const allGP = [...(gpb.high || []), ...(gpb.medium || []), ...(gpb.low || []), ...(potentialKws || [])];
          const chosen = allGP.filter(k => selectedKwIds.has(k.id));
          const list = chosen.length > 0 ? chosen : allGP;

          const matchedWithOutreach = list.filter(k => {
            const s = selectedOutreachSites[k.id] || k.outreach_site;
            return Boolean(s && (s.domain || s.url));
          });

          const picked = matchedWithOutreach.length > 0 ? matchedWithOutreach : list;
          effectiveKws = picked.map(k => {
            const chosenSite = selectedOutreachSites[k.id] || k.outreach_site || null;
            const lp = k.landing_page_url || (k.topic_link && !k.topic_link.includes('quora.com') && !k.topic_link.includes('reddit.com') ? k.topic_link : '') || (topicLinks[k.id] && !topicLinks[k.id].includes('quora.com') && !topicLinks[k.id].includes('reddit.com') ? topicLinks[k.id] : '') || '';
            return {
              id: k.id,
              keyword: k.keyword,
              category: k.category,
              cluster: k.cluster,
              rank: k.new_rank || k.rank,
              prev_rank: k.prev_rank || k.rank,
              new_rank: k.new_rank || k.rank,
              delta: k.delta || 0,
              gain_pct_str: k.gain_pct_str,
              sv: k.sv,
              kd: k.kd,
              target_type: k.target_type || 'Landing Page',
              top3_is_landing: k.top3_is_landing ?? true,
              push_batch: k.batch || null,
              push_confidence: k.confidence ?? null,
              push_reason: k.reason || '',
              topic_link: null,
              landing_page_url: lp,
              outreach_site: chosenSite
            };
          });
          outreachList = effectiveKws.map(k => k.outreach_site).filter(Boolean);
        }

        const tgtPayload = {
          quantity: effectiveKws.length > 0 ? effectiveKws.length : actReqQty,
          budget: `₹${tgtBudget.toLocaleString()}`,
          status: 'scheduled',
          ai_summary: latestAiSummary || `Scheduled ${effectiveKws.length} targets for ${formData.project_name}`,
          ai_advisory: budgetOptimization?.anti_waste_advisory || '',
          budget_summary: budgetOptimization,
          potential_keywords: effectiveKws,
          outreach_sites: outreachList,
          ai_run_id: latestAiRunId
        };
        if (effectiveKws.length > 0) {
          tgtPayload.keyword_name = effectiveKws.map(k => k.keyword).join(', ');
          tgtPayload.category = effectiveKws[0].category || 'General';
          tgtPayload.cluster = effectiveKws[0].cluster || 'General';
          tgtPayload.landing_page_url = effectiveKws.map(k => k.landing_page_url).filter(Boolean).join(' | ');
          tgtPayload.topic_link = (actChannel === 'quora' || actChannel === 'reddit')
            ? effectiveKws.map(k => k.topic_link).filter(Boolean).join(' | ')
            : null;
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
    const hasEmptyField = !formData.project_name?.trim()
      || !formData.main_poc?.trim()
      || !formData.content_poc?.trim()
      || !formData.auditor?.trim()
      || !activitiesList || activitiesList.length === 0
      || activitiesList.some(a => !a.activity_name?.trim() || !String(a.quantity || '').trim() || !String(a.budget || '').trim() || parseInt(a.quantity, 10) <= 0);

    if (hasEmptyField) {
      showNoDataPopup("There's no data to schedule. Please fill in all required activity details, POC roles, and budget.");
      return;
    }
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

    const rawSelected = potentialKws.filter(k => selectedKwIds.has(k.id));
    if (rawSelected.length === 0) {
      showNoDataPopup("There's no data to schedule. Please select at least one keyword.");
      return;
    }

    setSavingActivity(true);
    try {
      const isForum = activeChannelTab === 'quora' || activeChannelTab === 'reddit';
      const selected = rawSelected.map(k => {
        const lp = k.landing_page_url || (k.topic_link && !k.topic_link.includes('quora.com') && !k.topic_link.includes('reddit.com') ? k.topic_link : '') || (topicLinks[k.id] && !topicLinks[k.id].includes('quora.com') && !topicLinks[k.id].includes('reddit.com') ? topicLinks[k.id] : '') || '';
        const tLink = isForum ? (k.topic_link || topicLinks[k.id] || '') : null;
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
          topic_link: tLink,
          landing_page_url: lp,
          outreach_site: k.outreach_site || null
        };
      });

      const per = Math.max(1, Math.ceil(selected.length / targets.length));
      const updated = [];
      for (let i = 0; i < targets.length; i++) {
        const tgt = targets[i];
        const eff = targets.length === 1 ? selected : selected.slice(i * per, (i + 1) * per);
        const payload = {
          potential_keywords: eff,
          status: 'scheduled',
          scheduler: (tgt.scheduler && !/ai/i.test(tgt.scheduler)) ? tgt.scheduler : (formData.main_poc || 'Manual Scheduler'),
          ai_run_id: null,
          ai_summary: null,
          ai_advisory: null
        };
        if (eff.length > 0) {
          payload.keyword_name = eff.map(k => k.keyword).join(', ');
          payload.category = eff[0].category;
          payload.cluster = eff[0].cluster;
          payload.landing_page_url = eff.map(k => k.landing_page_url).filter(Boolean).join(' | ');
          payload.topic_link = isForum ? eff.map(k => k.topic_link).filter(Boolean).join(' | ') : null;
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
    if (newStatus === 'scheduled') {
      let pk = [];
      if (Array.isArray(item.potential_keywords)) pk = item.potential_keywords;
      else if (typeof item.potential_keywords === 'string') {
        try { pk = JSON.parse(item.potential_keywords); } catch (_) { pk = []; }
      }

      const hasKeywords = (Array.isArray(pk) && pk.length > 0) || Boolean(item.keyword_name && String(item.keyword_name).trim());
      const hasActivityName = Boolean(item.activity_name && String(item.activity_name).trim());
      const hasProject = Boolean(item.project_name && String(item.project_name).trim());

      if (!hasKeywords || !hasActivityName || !hasProject) {
        showNoDataPopup("There's no data to schedule. Please ensure keywords and activity details are configured before scheduling.");
        return;
      }
    }
    try {
      const res = await updateCalendarActivityApi(item.id, { status: newStatus });
      const updatedAct = res?.activity || {};
      const firstUid = updatedAct.first_uid || (updatedAct.synced_uids && updatedAct.synced_uids[0]) || item.activity_uid || '';

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

  const handleScheduleAll = (group) => {
    const invalidItems = (group.items || []).filter(item => {
      let pk = [];
      if (Array.isArray(item.potential_keywords)) pk = item.potential_keywords;
      else if (typeof item.potential_keywords === 'string') {
        try { pk = JSON.parse(item.potential_keywords); } catch (_) { pk = []; }
      }
      const hasKeywords = (Array.isArray(pk) && pk.length > 0) || Boolean(item.keyword_name && String(item.keyword_name).trim());
      const hasActivityName = Boolean(item.activity_name && String(item.activity_name).trim());
      const hasProject = Boolean(item.project_name && String(item.project_name).trim());
      return !hasKeywords || !hasActivityName || !hasProject;
    });

    if (invalidItems.length === (group.items || []).length) {
      showNoDataPopup("There's no data to schedule for these activities. Please assign keywords before scheduling.");
      return;
    }

    const validItems = (group.items || []).filter(item => !invalidItems.includes(item));
    if (invalidItems.length > 0) {
      showNoDataPopup(`Scheduled ${validItems.length} activity(ies). ${invalidItems.length} activity(ies) were kept as draft because there's no data to schedule.`);
    }
    validItems.forEach(it => handleMoveStatus(it, 'scheduled'));
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

    // Dynamic Multi-Channel definitions
    const channelPills = availableChannels.map(ac => {
      let count = 0;
      if (ac.id === 'guest_post') count = selectedKwIds.size;
      else if (ac.id === 'quora') count = selectedForumThreads.quora?.size ?? (forumStrategies.quora?.threads?.length || 0);
      else if (ac.id === 'reddit') count = selectedForumThreads.reddit?.size ?? (forumStrategies.reddit?.threads?.length || 0);
      return { ...ac, count };
    });

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
              onClick={handleBackToCalendarClick}
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
                <h1 style={{ fontSize: 19, fontWeight: 800, color: '#1A1A1A', margin: 0, letterSpacing: '-0.02em' }}>
                  AI Calendar Organic
                </h1>
                {createdActivity?.period && (
                  <span style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: '#7B2FBE',
                    background: '#F6EEFD',
                    border: '1px solid #E5CCF7',
                    padding: '2px 8px',
                    borderRadius: 6
                  }}>
                    {createdActivity.period}
                  </span>
                )}
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
              </div>

              {/* Activities Row Tags */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#8A8A9A' }}>Activities:</span>
                {channelPills.map(cp => (
                  <span
                    key={cp.id}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#4A1A8C',
                      background: '#F6EEFD',
                      border: '1px solid #E5CCF7',
                      padding: '2px 8px',
                      borderRadius: 6,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    <span>{cp.label}</span>
                    {cp.id === 'guest_post' && selectedKwIds.size > 0 && (
                      <span style={{ color: '#7B2FBE', fontWeight: 800 }}>({selectedKwIds.size})</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Sticky Top Confirm & Schedule Button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {(() => {
              const hasGuestPost = availableChannels.some(c => c.id === 'guest_post');
              const hasQuora = availableChannels.some(c => c.id === 'quora');
              const hasReddit = availableChannels.some(c => c.id === 'reddit');
              const canConfirm = (
                (hasGuestPost && selectedKwIds.size > 0) ||
                (hasQuora && (selectedForumThreads.quora?.size > 0 || (forumStrategies.quora?.threads?.length || 0) > 0)) ||
                (hasReddit && (selectedForumThreads.reddit?.size > 0 || (forumStrategies.reddit?.threads?.length || 0) > 0))
              ) && !savingActivity;
              return (
                <button
                  type="button"
                  disabled={!canConfirm}
                  onClick={handleConfirmAddKeywords}
              style={{
                padding: '10px 22px',
                fontSize: 13,
                fontWeight: 700,
                color: '#FFFFFF',
                background: (selectedKwIds.size === 0 || savingActivity) ? '#8A8A9A' : 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 100%)',
                border: 'none',
                borderRadius: 8,
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
                  <span>Confirm Schedule ({selectedKwIds.size})</span>
                </>
              )}
            </button>
              );
            })()}
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
                <>Scanning database and dividing <strong>{totalAllocatedBudgetFormatted}</strong> budget and <strong>{totalRequestedQuantity} activities</strong> across <strong>{activitiesList.length} activity channels</strong>...</>
              ) : (
                <>We are checking live rankings and calculating growth trajectory before showing recommendations.</>
              )}
            </div>
          </div>
        ) : (availableChannels.some(c => c.id === 'guest_post') && potentialKws.length === 0 && !forumStrategies.quora?.threads?.length && !forumStrategies.reddit?.threads?.length) ? (
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
              onClick={handleConfirmAbandon}
              disabled={abandonDeleting}
              style={{
                marginTop: 8,
                padding: '10px 24px',
                fontSize: 13.5,
                fontWeight: 700,
                background: abandonDeleting ? '#94a3b8' : 'linear-gradient(135deg, #CB196B 0%, #D4007A 100%)',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 10,
                cursor: abandonDeleting ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 12px rgba(212, 0, 122, 0.25)'
              }}
            >
              {/* No AI-researched keywords exist yet in this error state (the
                  search found nothing), so just clean up the empty activity
                  this run already created -- no confirm prompt needed here. */}
              {abandonDeleting ? 'Discarding…' : 'Back to Calendar'}
            </button>
          </div>
        ) : (
          <>
            {/* EXECUTIVE STRATEGY HERO CARD & 4 STRUCTURED NARRATIVE BLOCKS */}
            <div style={{
              background: '#FFFFFF',
              borderRadius: 16,
              border: '1px solid #E2DBEC',
              padding: '24px 28px',
              boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                    <Sparkles size={14} />
                    AI Recommended Strategy
                  </span>
                  <span style={{ fontSize: 12, color: '#8A8A9A' }}>•</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#2D2D44' }}>
                    Period: {createdActivity?.period || `${periodMonth} ${periodYear}`}
                  </span>
                </div>

                {budgetOptimization?.projected_savings > 0 && (
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    background: '#E6FAF6',
                    color: '#00BFA2',
                    border: '1px solid #A7F3D0',
                    padding: '3px 10px',
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

              {/* 4 STRATEGIC KPI CARDS (SHOWN FIRST) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, margin: '18px 0 18px 0' }}>
                {/* Card 1: Keywords */}
                <div style={{ background: '#FFFFFF', border: '1px solid #E2DBEC', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#8A8A9A', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Keywords Scanned vs Targeted
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: '#7B2FBE' }}>{selectedKwIds.size}</span>
                    <span style={{ fontSize: 13, color: '#8A8A9A' }}>of {potentialKws.length} scanned</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#7B2FBE', background: '#F6EEFD', padding: '1px 6px', borderRadius: 6, border: '1px solid #E5CCF7' }}>
                      +{selectedByBatch.high} Gains
                    </span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#7B2FBE', background: '#F6EEFD', padding: '1px 6px', borderRadius: 6, border: '1px solid #E5CCF7' }}>
                      -{selectedByBatch.medium} Drops
                    </span>
                  </div>
                </div>

                {/* Card 2: Activities Allocation */}
                <div style={{ background: '#FFFFFF', border: '1px solid #E2DBEC', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#8A8A9A', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Planned vs AI Recommended
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: '#7B2FBE' }}>
                      {budgetOptimization?.recommended_quantity || budgetOptimization?.recommended_activities || selectedKwIds.size}
                    </span>
                    <span style={{ fontSize: 13, color: '#8A8A9A' }}>vs {totalRequestedQuantity} planned</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#7B2FBE', fontWeight: 600, marginTop: 6 }}>
                    {(() => {
                      const rec = budgetOptimization?.recommended_quantity || budgetOptimization?.recommended_activities || selectedKwIds.size;
                      const plan = totalRequestedQuantity;
                      if (rec === plan) return '100% Target Fulfilled';
                      if (rec < plan) return `${plan - rec} Redundant Slot${plan - rec > 1 ? 's' : ''} Saved`;
                      return 'High-Impact Target Allocation';
                    })()}
                  </div>
                </div>

                {/* Card 3: Budget Allocation */}
                <div style={{ background: '#FFFFFF', border: '1px solid #E2DBEC', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#8A8A9A', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Budget Allocation
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: '#7B2FBE' }}>
                      {budgetOptimization?.planned_spend !== undefined ? `₹${budgetOptimization.planned_spend.toLocaleString()}` : totalAllocatedBudgetFormatted}
                    </span>
                    <span style={{ fontSize: 12, color: '#7B2FBE', fontWeight: 600 }}>
                      {budgetOptimization?.projected_savings > 0 ? `Saves ₹${budgetOptimization.projected_savings.toLocaleString()}` : 'Optimized'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#8A8A9A', marginTop: 6 }}>
                    Cap: ₹{(budgetOptimization?.total_budget_cap || budgetOptimization?.budget_cap || totalAllocatedBudget).toLocaleString()}
                  </div>
                </div>

                {/* Card 4: Target Landing Pages */}
                <div style={{ background: '#FFFFFF', border: '1px solid #E2DBEC', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#8A8A9A', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Landing Pages Targeted
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: '#7B2FBE' }}>{uniqueLandingPagesCount}</span>
                    <span style={{ fontSize: 13, color: '#8A8A9A' }}>Unique URLs</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#7B2FBE', fontWeight: 700, marginTop: 6 }}>
                    100% Landing Page SERP Verified
                  </div>
                </div>
              </div>

              {/* 4 STRUCTURED NARRATIVE BLOCKS (SHOWN SECOND) */}
              <div style={{
                background: '#FAFAFD',
                border: '1px solid #E2DBEC',
                borderRadius: 12,
                padding: '18px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 14
              }}>
                {/* Block 1: General Strategy Summary */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                    <Sparkles size={14} color="#7B2FBE" />
                    <strong style={{ fontSize: 13.5, color: '#1A1A1A', fontWeight: 800 }}>
                      General Strategy &amp; Growth Narrative
                    </strong>
                  </div>
                  <p style={{ fontSize: 13, color: '#2D2D44', lineHeight: 1.6, margin: 0 }}>
                    {budgetOptimization?.general_strategy_summary || (
                      <>
                        I analyzed <strong>{budgetOptimization?.total_db_keywords || potentialKws.length} keywords</strong> from the database for <strong>{createdActivity?.project_name || formData.project_name}</strong>. Out of them, I have picked <strong>{potentialKws.length} candidate keywords</strong> with verified landing pages across <strong>{uniqueLandingPagesCount} unique landing pages</strong> (Rank 5+), and out of those, I suggest you to work on these <strong style={{ color: '#7B2FBE' }}>{selectedKwIds.size} high-impact target keywords</strong> for your campaign.
                      </>
                    )}
                  </p>
                </div>

                {/* Thin Dotted Separator */}
                <div style={{ borderTop: '1px dashed #E2DBEC', width: '100%' }} />

                {/* Block 2: Keyword Exclusion Summary */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                    <Info size={14} color="#8A8A9A" />
                    <strong style={{ fontSize: 13, color: '#1A1A1A', fontWeight: 800 }}>
                      Keyword &amp; SERP Exclusion Logic
                    </strong>
                  </div>
                  <p style={{ fontSize: 12.5, color: '#64748B', lineHeight: 1.55, margin: 0 }}>
                    {budgetOptimization?.keyword_exclusion_summary || (
                      <>
                        The database contained <strong>{budgetOptimization?.total_db_keywords || potentialKws.length} keywords</strong> in total for this project. From these, I evaluated <strong>{potentialKws.length} candidate keywords</strong> with verified landing pages (Rank 5+), selected <strong style={{ color: '#7B2FBE' }}>{selectedKwIds.size} priority targets</strong> matching your campaign criteria, and excluded <strong>{Math.max(0, potentialKws.length - selectedKwIds.size)} keywords</strong> to respect your budget ceiling, preserve keywords already ranking in Top 3, and filter out queries without matching outreach publisher inventory.
                      </>
                    )}
                  </p>
                </div>

                {/* Thin Dotted Separator */}
                <div style={{ borderTop: '1px dashed #E2DBEC', width: '100%' }} />

                {/* Block 3: Budget Allocation & Savings Advisory */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5, flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <DollarSign size={14} color="#00BFA2" />
                      <strong style={{ fontSize: 13, color: '#1A1A1A', fontWeight: 800 }}>
                        Budget Allocation &amp; Publisher Value Advisory
                      </strong>
                    </div>

                    {/* Domain Criteria Tags */}
                    
                  </div>
                  <p style={{ fontSize: 12.5, color: '#2D2D44', lineHeight: 1.55, margin: 0 }}>
                    {budgetOptimization?.budget_allocation_advisory || budgetOptimization?.anti_waste_advisory || (
                      "I've allocated spend strictly to publishers offering the highest domain authority per rupee with verified regional traffic, eliminating low-ROI links and optimizing your budget."
                    )}
                  </p>
                </div>

                {/* Block 4: Domain Constraints & Alerts (Only shown when outreach publishers are limited) */}
                {Boolean(
                  budgetOptimization?.domain_constraints_alert ||
                  (availableOutreachSites && availableOutreachSites.length > 0 && availableOutreachSites.length < Math.ceil(selectedKwIds.size / 4))
                ) && (
                  <>
                    <div style={{ borderTop: '1px dashed #E2DBEC', width: '100%' }} />
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <AlertCircle size={13} color="#7B2FBE" />
                        <strong style={{ fontSize: 12.5, color: '#1A1A1A', fontWeight: 800 }}>
                          Domain Constraints &amp; Publisher Availability
                        </strong>
                      </div>
                      <p style={{ fontSize: 12, color: '#8A8A9A', lineHeight: 1.5, margin: 0 }}>
                        {budgetOptimization?.domain_constraints_alert || (
                          "Our available outreach publisher pool is currently limited for this project's target volume. I've enforced a strict guardrail of maximum 3-to-4 keywords per publisher domain to maintain natural backlink velocity."
                        )}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* MULTI-CHANNEL SUB-TABS (Guest Post, Quora, Reddit, Brand Mention) */}
            <div style={{
              background: '#FFFFFF',
              borderRadius: 14,
              border: '1px solid #E2DBEC',
              padding: '6px 8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {channelPills.map(tab => {
                  const isActive = activeChannelTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveChannelTab(tab.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 16px',
                        borderRadius: 8,
                        border: isActive ? '1px solid #E5CCF7' : '1px solid transparent',
                        background: isActive ? '#F6EEFD' : 'transparent',
                        color: isActive ? '#7B2FBE' : '#64748B',
                        fontSize: 13,
                        fontWeight: isActive ? 800 : 600,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <span>{tab.label}</span>
                      {(() => {
                        let count = 0;
                        const masterIds = new Set([...(pushBatches.high || []), ...(pushBatches.medium || []), ...(pushBatches.low || [])].map(r => r.id));
                        count = [...selectedKwIds].filter(id => masterIds.has(id)).length;
                        if (count <= 0) return null;
                        return (
                          <span style={{
                            background: isActive ? '#E5CCF7' : '#F1F5F9',
                            color: isActive ? '#4A1A8C' : '#64748B',
                            fontSize: 11,
                            fontWeight: 800,
                            padding: '1px 7px',
                            borderRadius: 10
                          }}>
                            {count}
                          </span>
                        );
                      })()}
                    </button>
                  );
                })}
              </div>

              
            </div>

            {/* UNIFIED TAB CONTENT ACROSS ALL ACTIVITIES (Paid Guest Post, Quora, Reddit) */}
            {activeChannelTab !== 'brand_mention' ? (() => {
              // Master batches produced from the single live rank check
              const masterBatches = pushBatches || { high: [], medium: [], low: [] };
              let channelLabel = 'Paid Guest Post';
              let isForum = false;

              if (activeChannelTab === 'quora') {
                channelLabel = 'Forum - Quora';
                isForum = true;
              } else if (activeChannelTab === 'reddit') {
                channelLabel = 'Forum - Reddit';
                isForum = true;
              }

              // Enrich each batch row with channel-specific topic link or outreach data
              const currentBatches = {
                high: (masterBatches.high || []).map(item => {
                  const qTopic = item.quora_topic_link || topicLinks[`quora_${item.id}`] || topicLinks[`quora_${item.keyword}`] || forumStrategies.quora?.threads?.find(t => t.keyword === item.keyword || t.id === item.id)?.topic_link;
                  const rTopic = item.reddit_topic_link || topicLinks[`reddit_${item.id}`] || topicLinks[`reddit_${item.keyword}`] || forumStrategies.reddit?.threads?.find(t => t.keyword === item.keyword || t.id === item.id)?.topic_link;
                  return {
                    ...item,
                    topic_link: activeChannelTab === 'quora' ? (qTopic || item.topic_link || '') : (activeChannelTab === 'reddit' ? (rTopic || item.topic_link || '') : (item.topic_link || ''))
                  };
                }),
                medium: (masterBatches.medium || []).map(item => {
                  const qTopic = item.quora_topic_link || topicLinks[`quora_${item.id}`] || topicLinks[`quora_${item.keyword}`] || forumStrategies.quora?.threads?.find(t => t.keyword === item.keyword || t.id === item.id)?.topic_link;
                  const rTopic = item.reddit_topic_link || topicLinks[`reddit_${item.id}`] || topicLinks[`reddit_${item.keyword}`] || forumStrategies.reddit?.threads?.find(t => t.keyword === item.keyword || t.id === item.id)?.topic_link;
                  return {
                    ...item,
                    topic_link: activeChannelTab === 'quora' ? (qTopic || item.topic_link || '') : (activeChannelTab === 'reddit' ? (rTopic || item.topic_link || '') : (item.topic_link || ''))
                  };
                }),
                low: (masterBatches.low || []).map(item => {
                  const qTopic = item.quora_topic_link || topicLinks[`quora_${item.id}`] || topicLinks[`quora_${item.keyword}`] || forumStrategies.quora?.threads?.find(t => t.keyword === item.keyword || t.id === item.id)?.topic_link;
                  const rTopic = item.reddit_topic_link || topicLinks[`reddit_${item.id}`] || topicLinks[`reddit_${item.keyword}`] || forumStrategies.reddit?.threads?.find(t => t.keyword === item.keyword || t.id === item.id)?.topic_link;
                  return {
                    ...item,
                    topic_link: activeChannelTab === 'quora' ? (qTopic || item.topic_link || '') : (activeChannelTab === 'reddit' ? (rTopic || item.topic_link || '') : (item.topic_link || ''))
                  };
                })
              };

              const isChannelLoading = loadingKeywords && (!masterBatches.high?.length && !masterBatches.medium?.length && !masterBatches.low?.length);

              if (isChannelLoading) {
                return (
                  <div style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2DBEC', padding: '48px 24px', textAlign: 'center' }}>
                    <BrandInfinityLoader label={`Analyzing & ranking ${channelLabel} keyword batches...`} size="md" minHeight="160px" />
                  </div>
                );
              }

              const totalBatchRows = (currentBatches.high?.length || 0) + (currentBatches.medium?.length || 0) + (currentBatches.low?.length || 0);
              if (totalBatchRows === 0 && !loadingKeywords) {
                return (
                  <div style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E2DBEC', padding: '36px 24px', textAlign: 'center' }}>
                    <Sparkles size={24} color="#7B2FBE" style={{ margin: '0 auto 10px' }} />
                    <h4 style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A', margin: '0 0 6px 0' }}>
                      No {channelLabel} targets found
                    </h4>
                    <p style={{ fontSize: 12.5, color: '#64748B', margin: 0 }}>
                      Ensure candidate landing pages and rank 5+ keywords exist in project dataset.
                    </p>
                  </div>
                );
              }

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {['high', 'medium', 'low'].map(batchKey => {
                    const meta = PUSH_BATCH_META[batchKey];
                    const rows = currentBatches[batchKey] || [];
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
                                      <th style={{ padding: '9px 14px', minWidth: 220 }}>
                                        {activeChannelTab === 'guest_post' ? ' Keyword' : (activeChannelTab === 'quora' ? 'Keyword' : 'Keyword')}
                                      </th>
                                      <th style={{ padding: '9px 14px', width: 180 }}>Rank Shift</th>
                                      <th style={{ padding: '9px 14px', width: 75 }}>SV</th>
                                      <th style={{ padding: '9px 14px', width: 60 }}>KD</th>
                                      <th style={{ padding: '9px 14px', width: 85 }}>Confidence</th>
                                      <th style={{ padding: '9px 14px', minWidth: 260 }}>Rationale</th>
                                      {activeChannelTab === 'guest_post' ? (
                                        <th style={{ padding: '9px 14px', width: 230 }}>PG Site</th>
                                      ) : (
                                        <th style={{ padding: '9px 14px', width: 240 }}>
                                          Topic Link ({activeChannelTab === 'quora' ? 'Quora' : 'Reddit'})
                                        </th>
                                      )}
                                      <th style={{ padding: '9px 14px', minWidth: 220 }}>Landing Page</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows.map(item => {
                                      const isChecked = selectedKwIds.has(item.id);
                                      const prevRankVal = item.prev_rank ?? item.rank;
                                      const currentRank = item.new_rank ?? item.rank;

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
                                          <td style={{ padding: '8px 14px' }}>
                                            <div style={{ fontWeight: 700, color: '#1A1A1A', fontSize: 13 }}>{item.keyword}</div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                                              {item.category && (
                                                <div style={{ fontSize: 11, color: '#64748B' }}>
                                                  <strong style={{ color: '#475569', fontWeight: 700 }}>Category:</strong> {item.category}
                                                </div>
                                              )}
                                              {item.cluster && (
                                                <div style={{ fontSize: 11, color: '#64748B' }}>
                                                  <strong style={{ color: '#475569', fontWeight: 700 }}>Cluster:</strong> {item.cluster}
                                                </div>
                                              )}
                                            </div>
                                          </td>
                                          <td style={{ padding: '8px 14px' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                              <RankSparklineHover
                                                initialRank={item.initial_rank ?? prevRankVal}
                                                prevRank={prevRankVal}
                                                liveRank={currentRank}
                                                delta={item.delta}
                                                gainPctStr={item.gain_pct_str}
                                                history={item.calendar_rank_history || item.history || []}
                                              />
                                              <div style={{ fontSize: 10.5, color: '#8A8A9A' }}>
                                                {formatRankBadge(prevRankVal)} → <strong style={{ color: '#1A1A1A' }}>{formatRankBadge(currentRank)}</strong>
                                                {item.delta ? ` (${formatShiftSpots(prevRankVal, currentRank, item.delta)})` : ''}
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
                                                fontWeight: 800,
                                                fontSize: 11.5,
                                                color: item.confidence >= 80 ? '#00BFA2' : (item.confidence >= 60 ? '#D4007A' : '#8A8A9A')
                                              }}>
                                                {item.confidence}%
                                              </span>
                                            ) : '—'}
                                          </td>
                                          <td style={{ padding: '8px 14px', minWidth: 260, maxWidth: 360 }}>
                                            <div style={{ fontSize: 12, color: '#2D2D44', lineHeight: 1.45 }}>
                                              {cleanReasonSpots(item.reason) || (
                                                item.delta > 0
                                                  ? `I've selected this keyword because its historical rank surged from ${formatRankBadge(prevRankVal)} to ${formatRankBadge(currentRank)} (+${formatShiftSpots(prevRankVal, currentRank, item.delta)}${item.gain_pct_str ? `, ${item.gain_pct_str}` : ''}) with ${item.sv ? item.sv.toLocaleString() : 'high'} monthly search volume and verified landing page intent.`
                                                  : item.delta < 0
                                                    ? `I've selected this keyword because its historical rank dropped from ${formatRankBadge(prevRankVal)} to ${formatRankBadge(currentRank)} (-${formatShiftSpots(prevRankVal, currentRank, item.delta)}) despite strong ${item.sv ? item.sv.toLocaleString() : 'high'} monthly search volume, making it a prime recovery target.`
                                                    : `I've selected this keyword because historical rank has held steady at ${formatRankBadge(currentRank)} (0% shift) with ${item.sv ? item.sv.toLocaleString() : 'steady'} monthly search volume, ready for an authority push.`
                                              )}
                                            </div>
                                          </td>

                                          {/* Channel Specific Column: Outreach Site for Guest Post VS Discovered Topic Link for Quora / Reddit */}
                                          {activeChannelTab === 'guest_post' ? (
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
                                                            {assignedSite.country_traffic} Traffic
                                                          </span>
                                                        )}
                                                      </div>
                                                    )}
                                                  </div>
                                                );
                                              })()}
                                            </td>
                                          ) : (
                                            <td style={{ padding: '8px 14px' }}>
                                              {(() => {
                                                const tLink = item.topic_link || topicLinks[item.id] || '';
                                                const isInvalidSearchUrl = tLink.includes('/search') || tLink.includes('?q=') || tLink.includes('search?');
                                                if (!tLink || isInvalidSearchUrl) {
                                                  return (
                                                    <span style={{ fontSize: 11.5, color: '#8A8A9A', fontStyle: 'italic' }}>
                                                      Topic thread matching on schedule
                                                    </span>
                                                  );
                                                }
                                                return (
                                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                                    <a
                                                      href={tLink}
                                                      target="_blank"
                                                      rel="noreferrer"
                                                      title={tLink}
                                                      style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: 4,
                                                        fontSize: 12,
                                                        fontWeight: 700,
                                                        color: '#7B2FBE',
                                                        textDecoration: 'none',
                                                        maxWidth: 220,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap'
                                                      }}
                                                      onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
                                                      onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
                                                    >
                                                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {tLink.replace(/^https?:\/\/(www\.)?/, '')}
                                                      </span>
                                                      <ExternalLink size={11} color="#7B2FBE" style={{ flexShrink: 0 }} />
                                                    </a>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                      <span style={{
                                                        fontSize: 9.5,
                                                        fontWeight: 800,
                                                        color: '#00BFA2',
                                                        background: '#E6FAF6',
                                                        border: '1px solid #A7F3D0',
                                                        padding: '1px 5px',
                                                        borderRadius: 4
                                                      }}>
                                                        {activeChannelTab === 'quora' ? 'Quora Thread' : 'Reddit Thread'}
                                                      </span>
                                                      {item.thread_budget && (
                                                        <span style={{
                                                          fontSize: 9.5,
                                                          fontWeight: 700,
                                                          color: '#4A1A8C',
                                                          background: '#F6EEFD',
                                                          border: '1px solid #E5CCF7',
                                                          padding: '1px 5px',
                                                          borderRadius: 4
                                                        }}>
                                                          ₹{item.thread_budget}
                                                        </span>
                                                      )}
                                                    </div>
                                                  </div>
                                                );
                                              })()}
                                            </td>
                                          )}

                                          {/* Client Target Landing Page */}
                                          <td style={{ padding: '8px 14px' }}>
                                            {(() => {
                                              const currentLp = item.landing_page_url || (activeChannelTab === 'guest_post' ? (item.topicLink || item.topic_link || topicLinks[item.id]) : '') || '';
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
                                                    maxWidth: 240,
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
              );
            })() : (
              /* TAB CONTENT: BRAND MENTION -- same AI-scheduled keyword batches as
                Paid Guest Post, same table UI, with Brand Mentions column. */
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
                                    <th style={{ padding: '9px 14px', minWidth: 220 }}>Keyword</th>
                                    <th style={{ padding: '9px 14px', width: 180 }}>Rank Shift</th>
                                    <th style={{ padding: '9px 14px', width: 75 }}>SV</th>
                                    <th style={{ padding: '9px 14px', width: 60 }}>KD</th>
                                    <th style={{ padding: '9px 14px', width: 85 }}>Confidence</th>
                                    <th style={{ padding: '9px 14px', width: 130 }}>VI Rationale</th>
                                    <th style={{ padding: '9px 14px', width: 230 }}>Brand Mentions</th>
                                    <th style={{ padding: '9px 14px', minWidth: 220 }}>Target Landing Page</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {rows.map(item => {
                                    const isChecked = selectedKwIds.has(item.id);
                                    const prevRankVal = item.prev_rank ?? item.rank;
                                    const currentRank = item.new_rank ?? item.rank;

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
                                        <td style={{ padding: '8px 14px' }}>
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
                                          </div>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                                            {(item.category || item.cluster) && (
                                              <span style={{ fontSize: 11, color: '#8A8A9A' }}>
                                                {[item.category, item.cluster].filter(Boolean).join(' • ')}
                                              </span>
                                            )}
                                          </div>
                                        </td>
                                        <td style={{ padding: '8px 14px' }}>
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                            <RankSparklineHover
                                              initialRank={item.initial_rank ?? prevRankVal}
                                              prevRank={prevRankVal}
                                              liveRank={currentRank}
                                              delta={item.delta}
                                              gainPctStr={item.gain_pct_str}
                                              history={item.calendar_rank_history || item.history || []}
                                            />
                                            <div style={{ fontSize: 10.5, color: '#8A8A9A' }}>
                                              {prevRankVal != null ? `#${prevRankVal}` : '—'} → <strong style={{ color: '#1A1A1A' }}>{currentRank != null ? `#${currentRank}` : '—'}</strong>
                                              {item.delta ? ` (${Math.abs(item.delta)} spot${Math.abs(item.delta) > 1 ? 's' : ''})` : ''}
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
                                              fontWeight: 800,
                                              fontSize: 11.5,
                                              color: item.confidence >= 80 ? '#00BFA2' : (item.confidence >= 60 ? '#D4007A' : '#8A8A9A')
                                            }}>
                                              {item.confidence}%
                                            </span>
                                          ) : '—'}
                                        </td>
                                        <td style={{ padding: '8px 14px' }}>
                                          <RationaleTooltip item={item} />
                                        </td>
                                        <td style={{ padding: '8px 14px' }}>
                                          {(() => {
                                            // brand_mention_sites = every domain FETCHED by the live search (raw, up to 8).
                                            // brand_mention_site  = the ALLOCATED ones -- fetched domains that are both
                                            // in the outreach table AND pass DA>25 / spam<3% -- this is what drives the UI.
                                            const fetchedSites = Array.isArray(item.brand_mention_sites) ? item.brand_mention_sites : [];
                                            const allMatches = Array.isArray(item.brand_mention_site) ? item.brand_mention_site : (item.brand_mention_site ? [item.brand_mention_site] : []);
                                            if (allMatches.length === 0) {
                                              return (
                                                <span style={{ fontSize: 12, color: '#8A8A9A', fontStyle: 'italic' }} title={fetchedSites.map(s => s.domain).join(', ')}>
                                                  {fetchedSites.length > 0
                                                    ? `${fetchedSites.length} site(s) found, none passed outreach/DA/SS`
                                                    : 'No listing sites found'}
                                                </span>
                                              );
                                            }
                                            // Best (highest-scored) allocated site by default; user can pick any of the others
                                            const chosen = selectedBrandMentionSites[item.id] || allMatches[0];
                                            const bmUrl = chosen.url || `https://${chosen.domain}`;
                                            return (
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                {allMatches.length > 1 ? (
                                                  <select
                                                    value={chosen.domain || ''}
                                                    onChange={(e) => {
                                                      const matchedSite = allMatches.find(s => s.domain === e.target.value);
                                                      handleSelectBrandMentionSite(item.id, matchedSite || null);
                                                    }}
                                                    style={{
                                                      padding: '4px 8px',
                                                      fontSize: 12,
                                                      fontWeight: 600,
                                                      color: '#1A1A1A',
                                                      background: '#FFFFFF',
                                                      border: '1px solid #E2DBEC',
                                                      borderRadius: 6,
                                                      outline: 'none',
                                                      maxWidth: 210,
                                                      cursor: 'pointer'
                                                    }}
                                                  >
                                                    {allMatches.map(s => (
                                                      <option key={s.id || s.domain} value={s.domain}>
                                                        {s.domain} (DA {s.da} | Spam {s.ss})
                                                      </option>
                                                    ))}
                                                  </select>
                                                ) : (
                                                  <a
                                                    href={bmUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    title={bmUrl}
                                                    style={{ fontSize: 12, fontWeight: 700, color: '#7B2FBE', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                                    onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
                                                    onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
                                                  >
                                                    <span>{chosen.domain}</span>
                                                    <ExternalLink size={10} color="#7B2FBE" style={{ flexShrink: 0 }} />
                                                  </a>
                                                )}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                                                  {chosen.da !== undefined && (
                                                    <span style={{ fontSize: 10, fontWeight: 800, background: '#E6FAF6', color: '#00BFA2', border: '1px solid #A7F3D0', padding: '1px 5px', borderRadius: 4 }}>
                                                      DA {chosen.da}
                                                    </span>
                                                  )}
                                                  {chosen.ss !== undefined && (
                                                    <span style={{ fontSize: 10, fontWeight: 700, background: '#FDEBF4', color: '#D4007A', border: '1px solid #F8B4D9', padding: '1px 5px', borderRadius: 4 }}>
                                                      Spam {chosen.ss}
                                                    </span>
                                                  )}
                                                  {allMatches.length > 1 && (
                                                    <span style={{ fontSize: 10, fontWeight: 700, color: '#7B2FBE' }}>
                                                      {allMatches.length} matches
                                                    </span>
                                                  )}
                                                  {allMatches.length > 1 && (
                                                    <a
                                                      href={bmUrl}
                                                      target="_blank"
                                                      rel="noreferrer"
                                                      title={bmUrl}
                                                      style={{ color: '#7B2FBE', display: 'inline-flex', alignItems: 'center' }}
                                                    >
                                                      <ExternalLink size={11} />
                                                    </a>
                                                  )}
                                                </div>
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
                                                  maxWidth: 250,
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
            )}

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
                <span style={{ fontSize: 11.5, color: '#8A8A9A', fontStyle: 'italic', display: 'none', '@media (min-width: 900px)': { display: 'inline' } }}>
                  Rankings tracked up to 40th pos
                </span>

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
                  disabled={!(
                    (availableChannels.some(c => c.id === 'guest_post') && selectedKwIds.size > 0) ||
                    (availableChannels.some(c => c.id === 'quora') && (selectedForumThreads.quora?.size > 0 || (forumStrategies.quora?.threads?.length || 0) > 0)) ||
                    (availableChannels.some(c => c.id === 'reddit') && (selectedForumThreads.reddit?.size > 0 || (forumStrategies.reddit?.threads?.length || 0) > 0))
                  ) || savingActivity}
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
        {renderNoDataModal()}
        {renderAbandonConfirmModal()}
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
        {renderNoDataModal()}
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
                              <span>{group.items[0]?.content_poc || '—'}</span>
                            </div>
                          </td>

                          {/* Auditor */}
                          <td style={{ padding: '14px 16px', fontSize: 12.5, color: '#334155', fontWeight: 600 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <UserIcon size={13} color="#059669" />
                              <span>{group.items[0]?.auditor || '—'}</span>
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
                                onClick={() => handleScheduleAll(group)}
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
                                  const allUids = [];
                                  (group.items || []).forEach(it => {
                                    if (Array.isArray(it.synced_uids) && it.synced_uids.length > 0) {
                                      allUids.push(...it.synced_uids);
                                    }
                                    if (it.first_uid) allUids.push(it.first_uid);
                                    if (it.activity_uid) allUids.push(it.activity_uid);
                                    if (it.uid) allUids.push(it.uid);
                                    if (it.id) allUids.push(String(it.id));
                                  });
                                  const uniqueUids = [...new Set(allUids.filter(Boolean))];
                                  sessionStorage.setItem('offpage_target_project', group.projectName || '');
                                  if (uniqueUids.length > 0) {
                                    sessionStorage.setItem('offpage_target_row_uid', uniqueUids.join(','));
                                  } else {
                                    sessionStorage.removeItem('offpage_target_row_uid');
                                  }
                                  if (onNavigate) {
                                    if (group.channel === 'content') onNavigate('content-engine');
                                    else onNavigate('search-visibility/off-page-scheduler');
                                  }
                                }}
                                title="Redirect to Off-Page under this project and highlight activities"
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
                            || Boolean(item.ai_run_id);
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
                                  <button
                                    onClick={() => openAiRunModal({ projectName: group.projectName, activityId: item.id, activityName: item.activity_name, activityItem: item })}
                                    title={isAiActivity ? "View AI analysis and outreach data" : "View activity details and keywords"}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 5,
                                      background: '#F5F3FF', border: '1px solid #DDD6FE', color: '#7c3aed',
                                      fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
                                      transition: 'all 0.15s ease'
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = '#EDE9FE'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = '#F5F3FF'; }}
                                  >
                                    <Eye size={13} />
                                    <span>View</span>
                                  </button>
                                  {activeSubTab === 'saved' && (
                                    <button
                                      onClick={() => handleOpenEditModal(item)}
                                      title="Edit Activity"
                                      style={{ background: 'transparent', border: 'none', color: '#6366f1', cursor: 'pointer', padding: 4 }}
                                    >
                                      <Edit3 size={14} />
                                    </button>
                                  )}
                                  {(activeSubTab === 'saved' || activeSubTab === 'published') && (
                                    <button
                                      onClick={() => handleDeleteItem(item)}
                                      title="Delete Activity"
                                      style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', padding: 4 }}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
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
                                        const allUids = [];
                                        if (Array.isArray(item.synced_uids) && item.synced_uids.length > 0) {
                                          allUids.push(...item.synced_uids);
                                        }
                                        if (item.first_uid) allUids.push(item.first_uid);
                                        if (item.activity_uid) allUids.push(item.activity_uid);
                                        if (item.uid) allUids.push(item.uid);
                                        if (item.id) allUids.push(String(item.id));
                                        const uniqueUids = [...new Set(allUids.filter(Boolean))];
                                        sessionStorage.setItem('offpage_target_project', item.project_name || group.projectName || '');
                                        if (uniqueUids.length > 0) {
                                          sessionStorage.setItem('offpage_target_row_uid', uniqueUids.join(','));
                                        } else {
                                          sessionStorage.removeItem('offpage_target_row_uid');
                                        }
                                        if (onNavigate) {
                                          if (item.channel === 'content') onNavigate('content-engine');
                                          else onNavigate('search-visibility/off-page-scheduler');
                                        }
                                      }}
                                      title={`Redirect to Off-Page under ${item.project_name || group.projectName} and highlight row`}
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
                            options={['Paid Guest Post', 'Forum - Quora', 'Forum - Reddit', 'Business Listing', 'Classified Ads', 'Brand Mentions']}
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
                        <option value="">Select Scheduler...</option>
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
                    <select
                      value={formData.content_poc}
                      onChange={e => setFormData({ ...formData, content_poc: e.target.value })}
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
                      <option value="">Select Content POC...</option>
                      {usersList.map(u => {
                        const displayVal = u.name || u.email;
                        return (
                          <option key={u.id || u.email} value={displayVal}>
                            {u.name ? `${u.name} (${u.email})` : u.email}
                          </option>
                        );
                      })}
                      {formData.content_poc && !usersList.some(u => (u.name === formData.content_poc || u.email === formData.content_poc)) && (
                        <option value={formData.content_poc}>{formData.content_poc}</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                      Auditor
                    </label>
                    <select
                      value={formData.auditor}
                      onChange={e => setFormData({ ...formData, auditor: e.target.value })}
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
                      <option value="">Select Auditor...</option>
                      {usersList.map(u => {
                        const displayVal = u.name || u.email;
                        return (
                          <option key={u.id || u.email} value={displayVal}>
                            {u.name ? `${u.name} (${u.email})` : u.email}
                          </option>
                        );
                      })}
                      {formData.auditor && !usersList.some(u => (u.name === formData.auditor || u.email === formData.auditor)) && (
                        <option value={formData.auditor}>{formData.auditor}</option>
                      )}
                    </select>
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
                          const hasEmptyField = !formData.project_name?.trim()
                            || !formData.content_poc?.trim()
                            || !formData.auditor?.trim()
                            || !activitiesList || activitiesList.length === 0
                            || activitiesList.some(a => !a.activity_name?.trim() || !String(a.quantity || '').trim() || !String(a.budget || '').trim() || parseInt(a.quantity, 10) <= 0);

                          if (hasEmptyField) {
                            showNoDataPopup("There's no data to schedule. Please fill in all required activity details, POC roles, and budget.");
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
            {(() => {
              const isModalManual = Boolean(
                !aiRunModalProject?.activityItem?.ai_run_id &&
                !/ai/i.test(String(aiRunModalProject?.activityItem?.scheduler || ''))
              );
              return (
                <div style={{
                  padding: '16px 22px', borderBottom: '1px solid #EEE9F7',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                  background: 'linear-gradient(135deg, #ffffff 0%, #faf8ff 100%)', flexShrink: 0
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: isModalManual ? 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)' : 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      {isModalManual ? <UserIcon size={18} color="#2563eb" /> : <Sparkles size={18} color="#7c3aed" />}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15.5, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span> {aiRunModalProject?.activityName || aiRunModalProject?.name || ''}</span>
                        <span style={{
                          fontSize: 10.5, fontWeight: 800,
                          background: isModalManual ? '#eff6ff' : '#f5f3ff',
                          color: isModalManual ? '#2563eb' : '#7c3aed',
                          border: `1px solid ${isModalManual ? '#bfdbfe' : '#ddd6fe'}`,
                          borderRadius: 6, padding: '2px 8px', textTransform: 'uppercase'
                        }}>
                          {isModalManual ? 'Manual' : 'AI Scheduler'}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, color: '#475569' }}>
                          {aiRunModalProject?.name || ''}
                        </span>
                        {aiRunModalProject?.activityItem?.activity_uid && (
                          <>
                            <span>•</span>
                            <span style={{ fontWeight: 700, color: isModalManual ? '#2563eb' : '#7c3aed' }}>
                              {aiRunModalProject.activityItem.activity_uid}
                            </span>
                          </>
                        )}
                        {aiRunModalProject?.activityItem?.channel && (
                          <>
                            <span>•</span>
                            <span style={{ textTransform: 'capitalize' }}>
                              Channel: {aiRunModalProject.activityItem.channel}
                            </span>
                          </>
                        )}
                        {aiRunModalProject?.activityItem?.status && (
                          <>
                            <span>•</span>
                            <span style={{
                              textTransform: 'uppercase', fontSize: 10.5, fontWeight: 700,
                              color: aiRunModalProject.activityItem.status === 'published' ? '#059669' : (aiRunModalProject.activityItem.status === 'approved' ? '#047857' : (aiRunModalProject.activityItem.status === 'scheduled' ? '#d97706' : '#64748b'))
                            }}>
                              {aiRunModalProject.activityItem.status}
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
              );
            })()}

            {/* Body */}
            <div style={{ overflowY: 'auto', padding: '20px 22px', background: 'var(--bg)' }}>
              {aiRunLoading ? (
                <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                  <BrandInfinityLoader label={(!aiRunModalProject?.activityItem?.ai_run_id && !/ai/i.test(String(aiRunModalProject?.activityItem?.scheduler || ''))) ? "Loading activity details…" : "Loading saved analysis…"} size="md" minHeight="200px" />
                </div>
              ) : (aiRunList.length === 0 && aiRunKeywords.length === 0) ? (
                <div style={{ padding: '52px 20px', textAlign: 'center' }}>
                  {(!aiRunModalProject?.activityItem?.ai_run_id && !/ai/i.test(String(aiRunModalProject?.activityItem?.scheduler || ''))) ? (
                    <>
                      <UserIcon size={34} color="#cbd5e1" style={{ marginBottom: 8 }} />
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>No saved keywords for this manual activity</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                        This activity was created manually without assigned keywords yet.
                      </div>
                    </>
                  ) : (
                    <>
                      <Sparkles size={34} color="#cbd5e1" style={{ marginBottom: 8 }} />
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>No saved AI analysis for this project</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                        An analysis is saved automatically each time an AI schedule is launched for this project.
                      </div>
                    </>
                  )}
                </div>
              ) : (() => {
                const activeRunMeta = aiRunList.find(r => r.run_id === aiRunActiveId) || aiRunList[0];
                const isItemManual = Boolean(
                  activeRunMeta?.is_manual ||
                  (!aiRunModalProject?.activityItem?.ai_run_id && !/ai/i.test(String(aiRunModalProject?.activityItem?.scheduler || '')))
                );
                const runBatches = { high: [], medium: [], low: [] };
                aiRunKeywords.forEach(k => {
                  const pNum = k.prev_rank != null ? Number(k.prev_rank) : null;
                  const lNum = k.live_rank != null ? Number(k.live_rank) : null;
                  const isGoing101 = lNum != null && lNum >= 101 && (pNum != null && pNum < 101);
                  const isCame101 = pNum != null && pNum >= 101 && (lNum != null && lNum < 101);
                  const b = k.batch || (isGoing101 ? 'medium' : (isCame101 ? 'high' : (k.delta > 0 ? 'high' : (k.delta < 0 ? 'medium' : 'low'))));
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
                  || (isItemManual ? `Manual activity campaign with ${aiRunKeywords.length} keywords attached.` : `Analyzed ${aiRunKeywords.length} keywords: ${runBatches.high.length} improved (Batch 1), ${runBatches.medium.length} dropped (Batch 2), ${runBatches.low.length} stagnant / non-landing (Batch 3).`);
                return (
                  <>
                    {/* Activity Specifications Bar */}
                    <div style={{
                      background: '#ffffff', border: '1px solid #E4DFEE', borderRadius: 12, padding: '12px 16px', marginBottom: 16,
                      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12
                    }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Activity UID</div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>{aiRunModalProject?.activityItem?.activity_uid || '—'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Scheduler POC</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>{aiRunModalProject?.activityItem?.main_poc || aiRunModalProject?.activityItem?.scheduler || (isItemManual ? 'Manual Scheduler' : 'AI Auto-Scheduler')}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Content POC</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>{aiRunModalProject?.activityItem?.content_poc || '—'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Auditor</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>{aiRunModalProject?.activityItem?.auditor || '—'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Quantity</div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: '#7c3aed' }}>{aiRunModalProject?.activityItem?.quantity ?? activeRunMeta?.quantity_requested ?? '—'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Budget</div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: '#059669' }}>
                          {aiRunModalProject?.activityItem?.budget ? (String(aiRunModalProject.activityItem.budget).startsWith('₹') ? aiRunModalProject.activityItem.budget : `₹${aiRunModalProject.activityItem.budget}`) : (activeRunMeta?.budget_used ? `₹${Number(activeRunMeta.budget_used).toLocaleString()}` : '—')}
                        </div>
                      </div>
                    </div>

                    {/* Executive Strategy & Budget Allocation Banner (Identical to Step 2 UI) */}
                    <div style={{
                      background: '#FFFFFF',
                      border: '1px solid #E2DBEC',
                      borderRadius: 14,
                      padding: '20px 22px',
                      marginBottom: 16,
                      boxShadow: '0 2px 10px rgba(0,0,0,0.02)'
                    }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 12,
                        marginBottom: 16
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            background: '#F6EEFD',
                            border: '1px solid #E5CCF7',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            <Sparkles size={16} color="#7B2FBE" />
                          </div>
                          <div>
                            <h3 style={{ fontSize: 15, fontWeight: 800, color: '#1A1A1A', margin: 0, letterSpacing: '-0.01em' }}>
                              {isItemManual ? 'Manual Activity Details & Allocation' : 'Executive AI Strategy & Budget Allocation'}
                            </h3>
                            <span style={{ fontSize: 11.5, color: '#8A8A9A' }}>
                              {isItemManual ? 'Target Keywords & Campaign Distribution' : 'Live SERP Velocity & Balanced Quota Engine'}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: '#4A1A8C',
                            background: '#F6EEFD',
                            border: '1px solid #E5CCF7',
                            padding: '3px 10px',
                            borderRadius: 20
                          }}>
                            Period: {aiRunModalProject?.activityItem?.period || 'Current'}
                          </span>

                          {bSum?.projected_savings > 0 && (
                            <span style={{
                              fontSize: 11,
                              fontWeight: 700,
                              background: '#E6FAF6',
                              color: '#00BFA2',
                              border: '1px solid #A7F3D0',
                              padding: '3px 10px',
                              borderRadius: 20,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4
                            }}>
                              <TrendingDown size={12} />
                              ₹{Number(bSum.projected_savings).toLocaleString()} Projected Savings
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 4 STRATEGIC KPI CARDS (SHOWN FIRST) */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, margin: '18px 0 18px 0' }}>
                        {/* Card 1: Keywords */}
                        <div style={{ background: '#FFFFFF', border: '1px solid #E2DBEC', borderRadius: 12, padding: '14px 18px' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#8A8A9A', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                            Keywords Scanned vs Targeted
                          </div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                            <span style={{ fontSize: 22, fontWeight: 800, color: '#7B2FBE' }}>{selCount || aiRunKeywords.length}</span>
                            <span style={{ fontSize: 13, color: '#8A8A9A' }}>of {aiRunKeywords.length} scanned</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#7B2FBE', background: '#F6EEFD', padding: '1px 6px', borderRadius: 6, border: '1px solid #E5CCF7' }}>
                              +{runBatches.high.length} Gains
                            </span>
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#7B2FBE', background: '#F6EEFD', padding: '1px 6px', borderRadius: 6, border: '1px solid #E5CCF7' }}>
                              -{runBatches.medium.length} Drops
                            </span>
                          </div>
                        </div>

                        {/* Card 2: Activities Allocation */}
                        <div style={{ background: '#FFFFFF', border: '1px solid #E2DBEC', borderRadius: 12, padding: '14px 18px' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#8A8A9A', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                            Planned vs AI Recommended
                          </div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                            <span style={{ fontSize: 22, fontWeight: 800, color: '#7B2FBE' }}>
                              {bSum?.recommended_quantity || bSum?.recommended_activities || selCount || aiRunKeywords.length}
                            </span>
                            <span style={{ fontSize: 13, color: '#8A8A9A' }}>vs {aiRunModalProject?.activityItem?.quantity ?? activeRunMeta?.quantity_requested ?? '1'} planned</span>
                          </div>
                          <div style={{ fontSize: 11.5, color: '#7B2FBE', fontWeight: 600, marginTop: 6 }}>
                            {(() => {
                              const rec = bSum?.recommended_quantity || bSum?.recommended_activities || selCount || aiRunKeywords.length;
                              const plan = Number(aiRunModalProject?.activityItem?.quantity ?? activeRunMeta?.quantity_requested ?? 1);
                              if (rec === plan) return '100% Target Fulfilled';
                              if (rec < plan) return `${plan - rec} Redundant Slot${plan - rec > 1 ? 's' : ''} Saved`;
                              return 'High-Impact Target Allocation';
                            })()}
                          </div>
                        </div>

                        {/* Card 3: Budget Optimization */}
                        <div style={{ background: '#FFFFFF', border: '1px solid #E2DBEC', borderRadius: 12, padding: '14px 18px' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#8A8A9A', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                            Budget Allocation
                          </div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                            <span style={{ fontSize: 22, fontWeight: 800, color: '#7B2FBE' }}>
                              {bSum?.planned_spend !== undefined ? `₹${Number(bSum.planned_spend).toLocaleString()}` : (activeRunMeta?.budget_used != null ? `₹${Number(activeRunMeta.budget_used).toLocaleString()}` : (aiRunModalProject?.activityItem?.budget ? (String(aiRunModalProject.activityItem.budget).startsWith('₹') ? aiRunModalProject.activityItem.budget : `₹${aiRunModalProject.activityItem.budget}`) : '₹0'))}
                            </span>
                            <span style={{ fontSize: 12, color: '#7B2FBE', fontWeight: 600 }}>
                              {bSum?.projected_savings > 0 ? `Saves ₹${Number(bSum.projected_savings).toLocaleString()}` : 'Optimized'}
                            </span>
                          </div>
                          <div style={{ fontSize: 11.5, color: '#8A8A9A', marginTop: 6 }}>
                            Cap: ₹{Number(bSum?.total_budget_cap || bSum?.budget_cap || activeRunMeta?.budget_used || aiRunModalProject?.activityItem?.budget || 0).toLocaleString()}
                          </div>
                        </div>

                        {/* Card 4: Target Landing Pages */}
                        <div style={{ background: '#FFFFFF', border: '1px solid #E2DBEC', borderRadius: 12, padding: '14px 18px' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#8A8A9A', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                            Target Landing Pages
                          </div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                            <span style={{ fontSize: 22, fontWeight: 800, color: '#7B2FBE' }}>
                              {new Set(aiRunKeywords.map(k => k.landing_page_url || k.topicLink).filter(Boolean)).size || 1}
                            </span>
                            <span style={{ fontSize: 13, color: '#8A8A9A' }}>unique URLs</span>
                          </div>
                          <div style={{ fontSize: 11.5, color: '#7B2FBE', fontWeight: 600, marginTop: 6 }}>
                            {bSum?.target_industry || 'Target Niche'}
                          </div>
                        </div>
                      </div>

                      {/* 4 STRUCTURED NARRATIVE BLOCKS (SHOWN SECOND) */}
                      <div style={{
                        background: '#FAFAFD',
                        border: '1px solid #E2DBEC',
                        borderRadius: 12,
                        padding: '18px 20px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 14
                      }}>
                        {/* Block 1: General Strategy Summary */}
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                            <Sparkles size={14} color="#7B2FBE" />
                            <strong style={{ fontSize: 13.5, color: '#1A1A1A', fontWeight: 800 }}>
                              {isItemManual ? 'Manual Strategy Summary' : 'General Strategy & Growth Narrative'}
                            </strong>
                          </div>
                          <p style={{ fontSize: 13, color: '#2D2D44', lineHeight: 1.6, margin: 0 }}>
                            {bSum?.general_strategy_summary || (
                              <>
                                I analyzed <strong>{bSum?.total_db_keywords || aiRunKeywords.length} keywords</strong> from the database for <strong>{aiRunModalProject?.name || ''}</strong>. Out of them, I have picked <strong>{aiRunKeywords.length} candidate keywords</strong> with verified landing pages across <strong>{new Set(aiRunKeywords.map(k => k.landing_page_url || k.topicLink).filter(Boolean)).size || 1} unique landing pages</strong> (Rank 5+), and out of those, I suggest you to work on these <strong style={{ color: '#7B2FBE' }}>{selCount || aiRunKeywords.length} high-impact target keywords</strong> for your campaign.
                              </>
                            )}
                          </p>
                        </div>

                        {!isItemManual && (
                          <>
                            {/* Thin Dotted Separator */}
                            <div style={{ borderTop: '1px dashed #E2DBEC', width: '100%' }} />

                            {/* Block 2: Keyword Exclusion Summary */}
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                                <Info size={14} color="#8A8A9A" />
                                <strong style={{ fontSize: 13, color: '#1A1A1A', fontWeight: 800 }}>
                                  Keyword &amp; SERP Exclusion Logic
                                </strong>
                              </div>
                              <p style={{ fontSize: 12.5, color: '#64748B', lineHeight: 1.55, margin: 0 }}>
                                {bSum?.keyword_exclusion_summary || "I've excluded low-confidence drop queries and non-landing SERPs where intent is purely informational or saturated in Top 3, avoiding wasted spend and ensuring maximum link relevance."}
                              </p>
                            </div>

                            {/* Thin Dotted Separator */}
                            <div style={{ borderTop: '1px dashed #E2DBEC', width: '100%' }} />

                            {/* Block 3: Budget Allocation & Savings Advisory */}
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5, flexWrap: 'wrap', gap: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <DollarSign size={14} color="#00BFA2" />
                                  <strong style={{ fontSize: 13, color: '#1A1A1A', fontWeight: 800 }}>
                                    Budget Allocation &amp; Publisher Value Advisory
                                  </strong>
                                </div>

                                {/* Domain Criteria Tags */}
                                
                              </div>
                              <p style={{ fontSize: 12.5, color: '#2D2D44', lineHeight: 1.55, margin: 0 }}>
                                {bSum?.budget_allocation_advisory || bSum?.anti_waste_advisory || advisoryText || "I've allocated spend strictly to publishers offering the highest domain authority per rupee with verified regional traffic, eliminating low-ROI links and optimizing your budget."}
                              </p>
                            </div>

                            {/* Block 4: Domain Constraints & Alerts (Only shown when outreach publishers are limited) */}
                            {Boolean(bSum?.domain_constraints_alert) && (
                              <>
                                <div style={{ borderTop: '1px dashed #E2DBEC', width: '100%' }} />
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                    <AlertCircle size={13} color="#7B2FBE" />
                                    <strong style={{ fontSize: 12.5, color: '#1A1A1A', fontWeight: 800 }}>
                                      Domain Constraints &amp; Publisher Availability
                                    </strong>
                                  </div>
                                  <p style={{ fontSize: 12, color: '#8A8A9A', lineHeight: 1.5, margin: 0 }}>
                                    {bSum.domain_constraints_alert}
                                  </p>
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>

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
                                      <th style={{ padding: '8px 14px', minWidth: 240 }}>Rationale</th>
                                      {(() => {
                                        const modalChannel = String(aiRunModalProject?.activityItem?.channel || aiRunModalProject?.activityItem?.activity_name || aiRunModalProject?.activityName || '').toLowerCase();
                                        const isQuoraModal = modalChannel.includes('quora');
                                        const isRedditModal = modalChannel.includes('reddit');
                                        if (isQuoraModal || isRedditModal) {
                                          return (
                                            <th style={{ padding: '8px 14px', minWidth: 240 }}>
                                              Topic Link ({isQuoraModal ? 'Quora' : 'Reddit'})
                                            </th>
                                          );
                                        }
                                        return <th style={{ padding: '8px 14px', minWidth: 180 }}>PG Site</th>;
                                      })()}
                                      <th style={{ padding: '8px 14px', minWidth: 180 }}>Landing Page</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows.map((k, ri) => {
                                      const site = k.outreach_site || null;
                                      const delta = k.delta;
                                      const modalChannel = String(aiRunModalProject?.activityItem?.channel || aiRunModalProject?.activityItem?.activity_name || aiRunModalProject?.activityName || '').toLowerCase();
                                      const isQuoraModal = modalChannel.includes('quora');
                                      const isRedditModal = modalChannel.includes('reddit');
                                      const isForumModal = isQuoraModal || isRedditModal;
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
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                                              {k.category && (
                                                <div style={{ fontSize: 11, color: '#64748b' }}>
                                                  <strong style={{ color: '#475569', fontWeight: 700 }}>Category:</strong> {k.category}
                                                </div>
                                              )}
                                              {k.cluster && (
                                                <div style={{ fontSize: 11, color: '#64748b' }}>
                                                  <strong style={{ color: '#475569', fontWeight: 700 }}>Cluster:</strong> {k.cluster}
                                                </div>
                                              )}
                                            </div>
                                          </td>
                                          <td style={{ padding: '8px 14px' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                              <RankSparklineHover
                                                initialRank={k.initial_rank ?? k.prev_rank}
                                                prevRank={k.prev_rank}
                                                liveRank={k.live_rank}
                                                delta={k.delta}
                                                gainPctStr={k.gain_pct_str}
                                                history={k.calendar_rank_history || k.history || []}
                                              />
                                              <div style={{ fontSize: 10.5, color: '#8A8A9A' }}>
                                                {formatRankBadge(k.prev_rank)} → <strong style={{ color: '#1A1A1A' }}>{formatRankBadge(k.live_rank)}</strong>
                                                {k.delta ? ` (${formatShiftSpots(k.prev_rank, k.live_rank, k.delta)})` : ''}
                                              </div>
                                            </div>
                                          </td>
                                          <td style={{ padding: '8px 14px', fontWeight: 600, color: '#334155' }}>{k.sv ? Number(k.sv).toLocaleString() : '—'}</td>
                                          <td style={{ padding: '8px 14px', color: '#64748b' }}>{k.kd ?? '—'}</td>
                                          <td style={{ padding: '8px 14px', fontWeight: 700, color: (k.confidence ?? 0) >= 80 ? '#16a34a' : ((k.confidence ?? 0) >= 60 ? '#d97706' : '#64748b') }}>
                                            {k.confidence != null ? `${k.confidence}%` : '—'}
                                          </td>
                                          <td style={{ padding: '8px 14px', minWidth: 260, maxWidth: 360 }}>
                                            <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.45 }}>
                                              {cleanReasonSpots(k.reason) || (
                                                k.delta > 0
                                                  ? `I've selected this keyword because its historical rank surged from ${formatRankBadge(k.prev_rank)} to ${formatRankBadge(k.live_rank)} (+${formatShiftSpots(k.prev_rank, k.live_rank, k.delta)}${k.gain_pct_str ? `, ${k.gain_pct_str}` : ''}) with ${k.sv ? Number(k.sv).toLocaleString() : 'high'} monthly search volume and verified landing page intent.`
                                                  : k.delta < 0
                                                    ? `I've selected this keyword because its historical rank dropped from ${formatRankBadge(k.prev_rank)} to ${formatRankBadge(k.live_rank)} (-${formatShiftSpots(k.prev_rank, k.live_rank, k.delta)}) despite strong ${k.sv ? Number(k.sv).toLocaleString() : 'high'} monthly search volume, making it a prime recovery target.`
                                                    : `I've selected this keyword because historical rank has held steady at ${formatRankBadge(k.live_rank)} (0% shift) with ${k.sv ? Number(k.sv).toLocaleString() : 'steady'} monthly search volume, ready for an authority push.`
                                              )}
                                            </div>
                                          </td>
                                          {isForumModal ? (
                                            <td style={{ padding: '8px 14px' }}>
                                              {(() => {
                                                const tLink = k.topic_link || (k.landing_page_url && (k.landing_page_url.includes('quora.com') || k.landing_page_url.includes('reddit.com')) ? k.landing_page_url : '') || aiRunModalProject?.activityItem?.topic_link || '';
                                                const isInvalidSearch = tLink.includes('/search') || tLink.includes('?q=') || tLink.includes('search?');
                                                if (!tLink || isInvalidSearch) {
                                                  return (
                                                    <span style={{ fontSize: 11.5, color: '#94a3b8', fontStyle: 'italic' }}>
                                                      Topic thread matching on schedule
                                                    </span>
                                                  );
                                                }
                                                return (
                                                  <a
                                                    href={tLink}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{
                                                      display: 'inline-flex',
                                                      alignItems: 'center',
                                                      gap: 5,
                                                      fontSize: 11.5,
                                                      fontWeight: 600,
                                                      color: '#7c3aed',
                                                      textDecoration: 'none',
                                                      background: '#f5f3ff',
                                                      border: '1px solid #ddd6fe',
                                                      padding: '3px 8px',
                                                      borderRadius: 6,
                                                      maxWidth: 240
                                                    }}
                                                    title={tLink}
                                                  >
                                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                      {tLink.replace(/^https?:\/\/(www\.)?/, '')}
                                                    </span>
                                                    <ExternalLink size={11} style={{ flexShrink: 0 }} />
                                                  </a>
                                                );
                                              })()}
                                            </td>
                                          ) : (
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
                                          )}
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
      {renderNoDataModal()}
    </div>
  );
}

export default CalendarPage;
