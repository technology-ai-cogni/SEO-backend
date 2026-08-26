import { useState, useEffect, useRef, useMemo } from 'react';
import { Calendar, UploadCloud, Clock, Trash2, Play, CheckCircle, AlertCircle, FileSpreadsheet, X, Upload, ChevronDown, Filter, Pencil, Save, ShieldCheck, Users, Sparkles, Download } from 'lucide-react';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { 
  fetchDomainRows, 
  fetchMonthlyImportsApi, 
  createMonthlyImportApi, 
  updateMonthlyImportApi, 
  deleteMonthlyImportApi, 
  runAuditAllocationApi,
  runAiStatusCheckApi,
  runAiStatusCheckStreamApi,
  fetchScheduledActivitiesApi, 
  createScheduledActivityApi, 
  deleteScheduledActivityApi,
  fetchUsersApi
} from '../../lib/projectsApi';
import { isReadOnlyUser, canDownload, canEdit, canUpdate, canDelete } from '../../lib/permissions';

// Reusable Modal Component matching Project Setup style
function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.18)', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 28px 16px' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>{title}</h2>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 6, display: 'flex' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
            <X size={20} />
          </button>
        </div>
        <div style={{ padding: '0 28px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {children}
        </div>
        {footer && (
          <div style={{ padding: '16px 28px 24px', display: 'flex', gap: 12 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// Reusable Button Component matching Project Setup style
function Btn({ children, variant = 'primary', onClick, style = {} }) {
  const styles = {
    primary: { background: '#0f1523', color: '#fff', border: 'none' },
    outline: { background: '#000000ff', color: '#040509ff', border: '1.5px solid #d1d5db' },
    accent: { background: 'var(--accent)', color: '#fff', border: 'none' },
  };
  return (
    <button onClick={onClick} style={{
      ...styles[variant], borderRadius: 10, padding: '10px 22px',
      fontSize: 13.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, ...style
    }}>
      {children}
    </button>
  );
}

// Helper to format any URL string so it opens in a new tab safely
function formatUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string' || urlStr.trim() === '' || urlStr === 'N/A') return null;
  const trimmed = urlStr.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
}

// Helper to truncate long domain display text cleanly
function formatTruncatedDomain(domainStr, maxLen = 15) {
  if (!domainStr || typeof domainStr !== 'string') return '';
  const trimmed = domainStr.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.substring(0, maxLen)}...`;
}

// Helper to check if a string is a URL
function isUrlLike(str) {
  if (!str || typeof str !== 'string') return false;
  const t = str.trim().toLowerCase();
  return t.startsWith('http://') || t.startsWith('https://') || t.startsWith('www.') || t.includes('http://') || t.includes('https://') || (t.includes('.') && !t.includes(' ') && (t.includes('/') || t.endsWith('.com') || t.endsWith('.org') || t.endsWith('.edu') || t.endsWith('.sg') || t.endsWith('.net') || t.endsWith('.io') || t.endsWith('.co')));
}

// Helper to parse a CSV line properly keeping quoted strings intact
function parseCSVLine(text) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map(val => val.replace(/^"|"$/g, '').trim());
}

// Helper to format today's date as YYYY-MM-DD
function getTodayFormatted() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Helper to normalize parsed keys case-insensitively
function normalizeRow(item, index) {
  const findVal = (keys) => {
    for (const key of keys) {
      const matchKey = Object.keys(item).find(k => k.toLowerCase().replace(/[\s_\-]/g, '') === key.toLowerCase().replace(/[\s_\-]/g, ''));
      if (matchKey && item[matchKey] !== undefined && String(item[matchKey]).trim() !== '') {
        return String(item[matchKey]).trim();
      }
    }
    return '';
  };

  const existingUid = findVal(['uid', 'uniqueid', 'id']);
  const defaultUid = existingUid || `MO-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
  const todayStr = getTodayFormatted();
  const rawUpdatedDate = findVal(['updateddate', 'updated_date', 'updated']);

  return {
    uid: defaultUid,
    period: findVal(['period']),
    scheduledDate: findVal(['scheduleddate', 'date', 'scheduled']),
    keyword1: findVal(['keyword1', 'kw1', 'keyword']),
    landingPage: findVal(['landingpage', 'lp', 'page']),
    cluster: findVal(['cluster']),
    kwCategory: findVal(['kwcategory', 'category']),
    activityName: findVal(['activityname', 'activity']),
    wordCount: findVal(['wordcount', 'words']),
    contentSpoc: findVal(['contentspoc', 'spoc', 'contact']),
    topic: findVal(['topic']),
    contentDoc: findVal(['contentdoc', 'doc']),
    status: findVal(['status']),
    publisher: findVal(['publisher']),
    pgSiteDomain: findVal(['pgsitedomain', 'domain', 'site']),
    domainUtilizationForKw: findVal(['domainutilizationforkw', 'utilization']),
    liveLink: findVal(['livelink', 'link']),
    remarks: findVal(['remarks']),
    solution: findVal(['solution']),
    keyword2: findVal(['keyword2', 'kw2']),
    updatedDate: rawUpdatedDate || todayStr,
    updated_date: rawUpdatedDate || todayStr,
    lastActivity: findVal(['lastactivity', 'activity'])
  };
}

export default function OffPageSchedulerPage({ user }) {
  const [activeTab, setActiveTab] = useState('import'); // 'import' or 'scheduler'
  
  // Viewer & User Scoping Filters
  const isViewer = isReadOnlyUser(user);
  const isVendor = user?.category === 'Vendor' || user?.role?.toUpperCase() === 'VENDOR';
  const isAdmin = user?.role?.toUpperCase() === 'ADMIN';
  const vendorProject = !isAdmin && user?.assigned_project && user.assigned_project !== 'All Projects' ? user.assigned_project : null;
  const userCanEdit = canEdit(user);
  const userCanUpdate = canUpdate(user);
  const userCanDelete = canDelete(user);
  const userCanDownload = canDownload(user);
  
  useEffect(() => {
    if (isViewer && activeTab === 'scheduler') {
      setActiveTab('import');
    }
  }, [isViewer, activeTab]);
  
  // Modals & Details Visibility
  const [showImportModal, setShowImportModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedDataset, setSelectedDataset] = useState(null);
  const [datasetSearch, setDatasetSearch] = useState('');
  const [fieldFilters, setFieldFilters] = useState({});
  const [filterActivity, setFilterActivity] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [showFilterPopover, setShowFilterPopover] = useState(false);
  const [showActionsDropdown, setShowActionsDropdown] = useState(false);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkEditActivity, setBulkEditActivity] = useState('');
  const [bulkEditStatus, setBulkEditStatus] = useState('');
  const [bulkEditField, setBulkEditField] = useState('');
  const [bulkEditValue, setBulkEditValue] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [selectedRowIndices, setSelectedRowIndices] = useState([]);
  const [dbProjects, setDbProjects] = useState([]);
  const [originalRowsData, setOriginalRowsData] = useState([]);
  const [isDirty, setIsDirty] = useState(false);
  const originalDatasetIdRef = useRef(null);
  const [savingState, setSavingState] = useState(''); // '', 'saving', 'saved', 'error'
  const [auditAllocating, setAuditAllocating] = useState(false);
  const [aiChecking, setAiChecking] = useState(false);
  const [deleteConfirmImport, setDeleteConfirmImport] = useState(null);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [auditSuccessMsg, setAuditSuccessMsg] = useState('');
  const [showAssocPopover, setShowAssocPopover] = useState(false);
  const [showGlobalAssocPopover, setShowGlobalAssocPopover] = useState(false);
  const assocPopoverRef = useRef(null);
  const globalAssocPopoverRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (assocPopoverRef.current && !assocPopoverRef.current.contains(event.target)) {
        setShowAssocPopover(false);
      }
      if (globalAssocPopoverRef.current && !globalAssocPopoverRef.current.contains(event.target)) {
        setShowGlobalAssocPopover(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const STATUS_PRESET_OPTIONS = useMemo(() => [
    'Audited-Indexed',
    'Audited-LQ',
    'Published-Indexed',
    'Published-LQ',
    'Flagged-Indexation',
    'Published Non-Indexed',
    'Draft',
    'In Progress',
    'Not Found'
  ], []);

  const REMARKS_PRESET_OPTIONS = useMemo(() => [
    'No Issues',
    'Optimized',
    'No/Incorrect Anchor Text',
    '2nd Anchor Text Missing',
    '1st Anchor Text Missing',
    'Wrong url Targeted',
    'Link Replaced',
    'Link Fixed',
    'Flagged-Indexation'
  ], []);

  const SOLUTION_PRESET_OPTIONS = useMemo(() => [
    'fixed',
    'Content Replace',
    'Link Replace',
    'Quora : Reddit- Post New Answer',
    'Quora : Reddit- Add More Upvotes',
    'To Solve With Publisher',
    'Quora : Reddit- Duplicate'
  ], []);

  useEffect(() => {
    if (selectedDataset) {
      if (originalDatasetIdRef.current !== selectedDataset.id) {
        setOriginalRowsData(JSON.parse(JSON.stringify(selectedDataset.rowsData || [])));
        originalDatasetIdRef.current = selectedDataset.id;
        setIsDirty(false);
      }
    } else {
      setOriginalRowsData([]);
      originalDatasetIdRef.current = null;
      setIsDirty(false);
    }
  }, [selectedDataset?.id]);

  const FIELDS_TO_COMPARE = useMemo(() => [
    'uid', 'keyword1', 'keyword2', 'landingPage', 'cluster', 'kwCategory', 
    'activityName', 'wordCount', 'contentSpoc', 'topic', 'contentDoc', 
    'status', 'publisher', 'pgSiteDomain', 'liveLink', 'remarks', 'solution', 
    'lastActivity', 'scheduledDate', 'scheduled_date', 'verified'
  ], []);

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedDataset) return false;
    if (isDirty) return true;
    if (!originalRowsData || originalRowsData.length === 0) return false;
    const currentRows = selectedDataset.rowsData || [];
    if (currentRows.length !== originalRowsData.length) return true;

    for (let i = 0; i < currentRows.length; i++) {
      const cur = currentRows[i] || {};
      const orig = originalRowsData[i] || {};

      for (const key of FIELDS_TO_COMPARE) {
        const getVal = (r, k) => {
          if (k === 'verified') return r.verified === true || r.verified === 'true';
          const v = r[k] ?? r[k.replace(/([A-Z])/g, "_$1").toLowerCase()] ?? '';
          return String(v).trim();
        };
        if (getVal(cur, key) !== getVal(orig, key)) return true;
      }
    }

    return false;
  }, [selectedDataset?.rowsData, originalRowsData, FIELDS_TO_COMPARE, isDirty]);

  const handleAttemptLeaveDataset = (leaveAction) => {
    if (hasUnsavedChanges) {
      setPendingLeaveAction(() => leaveAction);
      setShowUnsavedModal(true);
    } else {
      leaveAction();
    }
  };

  const BULK_EDIT_FIELD_OPTIONS = [
    { key: 'uid', label: 'UID' },
    { key: 'keyword1', label: 'Keyword 1' },
    { key: 'keyword2', label: 'Keyword 2' },
    { key: 'landingPage', label: 'Landing Page' },
    { key: 'cluster', label: 'Cluster' },
    { key: 'kwCategory', label: 'KW Category' },
    { key: 'activityName', label: 'Activity Name' },
    { key: 'wordCount', label: 'Word Count' },
    { key: 'contentSpoc', label: 'Content SPOC' },
    { key: 'topic', label: 'Topic' },
    { key: 'contentDoc', label: 'Content Doc' },
    { key: 'status', label: 'Status' },
    { key: 'publisher', label: 'POC' },
    { key: 'pgSiteDomain', label: 'PG Site Domain' },
    { key: 'liveLink', label: 'Live Link' },
    { key: 'remarks', label: 'Remarks' },
    { key: 'solution', label: 'Solution' },
    { key: 'lastActivity', label: 'Last Activity' },
    { key: 'scheduledDate', label: 'Scheduled Date' },
    { key: 'updatedDate', label: 'Updated Date' },
  ];

  const ALL_FIELD_CONFIGS = [
    { key: 'activityName', label: 'Activity Name' },
    { key: 'status', label: 'Status' },
    { key: 'publisher', label: 'POC' },
    { key: 'contentSpoc', label: 'Content SPOC' },
    { key: 'remarks', label: 'Remarks' },
    { key: 'solution', label: 'Solution' },
  ];

  const activeFieldFilterCount = useMemo(() => {
    let count = Object.values(fieldFilters).filter(v => v && v.trim() !== '').length;
    if (filterStartDate) count += 1;
    if (filterEndDate) count += 1;
    return count;
  }, [fieldFilters, filterStartDate, filterEndDate]);

  const handleResetFieldFilters = () => {
    setFieldFilters({});
    setFilterStartDate('');
    setFilterEndDate('');
    setFilterActivity('ALL');
    setFilterStatus('ALL');
  };

  const handleDownloadRows = async (rowsToExport, datasetName = 'Off-Page') => {
    let exportData = rowsToExport || [];
    
    // Fallback to selectedDataset rows if empty
    if ((!exportData || exportData.length === 0) && selectedDataset && selectedDataset.rowsData) {
      exportData = selectedDataset.rowsData;
    }

    if (!exportData || exportData.length === 0) {
      alert("No records available to download.");
      return;
    }

    const headers = [
      'UID', 'Period', 'Scheduled Date', 'Keyword 1', 'Keyword 2', 'Landing Page', 'Cluster',
      'KW Category', 'Activity Name', 'Word Count', 'Content SPOC', 'Topic',
      'Content Doc', 'POC', 'PG Site Domain', 'Live Link', 'Status',
      'Remarks', 'Solution', 'Verified Status', 'Last Activity', 'Updated Date'
    ];

    try {
      const workbook = new ExcelJS.Workbook();
      const sheetName = String(datasetName || 'Off-Page').replace(/[\\/*?:\[\]]/g, '').substring(0, 31);
      const worksheet = workbook.addWorksheet(sheetName || 'Data');

      worksheet.addRow(headers);
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      headerRow.height = 24;

      exportData.forEach(r => {
        worksheet.addRow([
          r.uid || '',
          r.period || '',
          r.scheduledDate || r.scheduled_date || '',
          r.keyword1 || r.keyword_1 || '',
          r.keyword2 || r.keyword_2 || '',
          r.landingPage || r.landing_page || r.page || '',
          r.cluster || '',
          r.kwCategory || r.kw_category || '',
          r.activityName || r.activity_name || r.activity || '',
          r.wordCount || r.word_count || '',
          r.contentSpoc || r.content_spoc || '',
          r.topic || '',
          r.contentDoc || r.content_doc || '',
          r.publisher || r.poc || '',
          r.pgSiteDomain || r.pg_site_domain || '',
          r.liveLink || r.live_link || r.link || '',
          r.status || '',
          r.remarks || '',
          r.solution || '',
          (r.verified === true || r.verified === 'true') ? 'Verified' : 'Unverified',
          r.lastActivity || r.last_activity || '',
          r.updatedDate || r.updated_date || ''
        ]);
      });

      worksheet.columns.forEach(col => {
        let maxLen = 12;
        col.eachCell({ includeEmpty: true }, cell => {
          const len = cell.value ? String(cell.value).length : 0;
          if (len > maxLen) maxLen = len;
        });
        col.width = Math.min(maxLen + 4, 40);
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const safeName = String(datasetName || 'Monthly-Operations').replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `${safeName}_data.xlsx`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export dataset to Excel:', err);
      alert('Failed to download Excel file.');
    }
  };

  const filterRef = useRef(null);
  const actionsRef = useRef(null);

  // Close filter popover on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setShowFilterPopover(false);
      }
      if (actionsRef.current && !actionsRef.current.contains(event.target)) {
        setShowActionsDropdown(false);
      }
    }
    if (showFilterPopover || showActionsDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showFilterPopover, showActionsDropdown]);

  // Fetch active projects from domains table on mount
  useEffect(() => {
    let isMounted = true;
    async function loadDbProjects() {
      try {
        const domainRows = await fetchDomainRows();
        if (isMounted && domainRows && domainRows.length > 0) {
          const activeDomains = domainRows.filter(p => p.status !== 'Inactive' && p.isActive !== false);
          setDbProjects(activeDomains);
        }
      } catch (err) {
        console.warn('[OffPageSchedulerPage] Failed to fetch domain rows:', err);
      }
    }
    loadDbProjects();
    return () => { isMounted = false; };
  }, []);

  // Default mock projects fallback
  const mockProjects = [
    { slug: 'owis', name: 'One World International School', domain: 'owis.org', status: 'Active' },
    { slug: 'sais', name: 'Stamford American', domain: 'sais.edu.sg', status: 'Active' },
    { slug: 'testing308', name: 'testing308', domain: 'testing308.com', status: 'Active' }
  ];

  const projectList = useMemo(() => {
    const rawList = (dbProjects.length > 0 ? dbProjects : mockProjects).filter(p => p.status !== 'Inactive' && p.isActive !== false);
    if (!vendorProject) return rawList;
    const vProjLower = vendorProject.toLowerCase().trim();
    const filtered = rawList.filter(p => {
      const pName = String(p.name || p.project_name || p.domain || p.slug || '').toLowerCase();
      return pName.includes(vProjLower) || vProjLower.includes(pName);
    });
    return filtered.length > 0 ? filtered : [{ slug: 'vendor-assigned', name: vendorProject, domain: vendorProject, status: 'Active' }];
  }, [dbProjects, vendorProject]);

  // --- Initial Mock Data for Imports ---
  const initialImports = [
    { 
      id: 1, 
      filename: 'backlinks_audit_august.csv', 
      project: 'One World International School', 
      rows: 3, 
      date: '2026-08-01 10:24 AM', 
      status: 'Success',
      rowsData: [
        {
          period: 'Q3 2026',
          scheduledDate: '2026-08-10',
          keyword1: 'one world international school singapore',
          landingPage: '/admissions',
          cluster: 'Admissions',
          kwCategory: 'Commercial',
          activityName: 'Forum Quora',
          wordCount: 1200,
          contentSpoc: 'Sarah Chen',
          topic: 'Best International Schools in SG',
          contentDoc: 'https://docs.google.com/document/d/mock-1',
          status: 'Published-Indexed',
          publisher: 'SgSchoolFinder',
          pgSiteDomain: 'sgschoolfinder.com',
          domainUtilizationForKw: '20%',
          liveLink: 'https://sgschoolfinder.com/best-schools',
          remarks: '', // empty to test N/A fallback
          solution: 'Guest Blog Post',
          keyword2: 'owis fees',
          updatedDate: '2026-08-04',
          lastActivity: 'Link validated'
        },
        {
          period: 'Q3 2026',
          scheduledDate: '2026-08-12',
          keyword1: 'owis admissions',
          landingPage: '/contact-us',
          cluster: 'Academics',
          kwCategory: 'Informational',
          activityName: 'Paid Guest Post',
          wordCount: 1400,
          contentSpoc: 'John Doe',
          topic: 'Academics & Secondary Education in SG',
          contentDoc: 'https://docs.google.com/document/d/mock-2',
          status: 'Audited-Indexed',
          publisher: 'ExpatSingapore',
          pgSiteDomain: 'expatsg.com',
          domainUtilizationForKw: '10%',
          liveLink: 'https://expatsg.com/owis-secondary',
          remarks: 'Backlink indexed',
          solution: 'Editorial Placement',
          keyword2: 'international education sg',
          updatedDate: '2026-08-04',
          lastActivity: 'Indexed'
        },
        {
          period: 'Q3 2026',
          scheduledDate: '2026-08-14',
          keyword1: 'owis primary school',
          landingPage: '/primary-school',
          cluster: 'Primary',
          kwCategory: 'Commercial',
          activityName: 'Business Listing',
          wordCount: 950,
          contentSpoc: 'Alice Wong',
          topic: 'Primary School Options for Expats',
          contentDoc: 'https://docs.google.com/document/d/mock-3',
          status: 'Audited-LQ',
          publisher: 'SchoolReview',
          pgSiteDomain: 'schoolreview.sg',
          domainUtilizationForKw: '5%',
          liveLink: '', // empty to test N/A fallback
          remarks: 'Awaiting publisher indexation',
          solution: 'Directory Link',
          keyword2: 'expat guide sg',
          updatedDate: '2026-08-04',
          lastActivity: 'Sent draft to publisher'
        }
      ]
    },
    { 
      id: 2, 
      filename: 'outreach_leads_sais.xlsx', 
      project: 'Stamford American', 
      rows: 2, 
      date: '2026-08-02 02:15 PM', 
      status: 'Success',
      rowsData: [
        {
          period: 'Q3 2026',
          scheduledDate: '2026-08-15',
          keyword1: 'stamford american international school',
          landingPage: '/curriculum',
          cluster: 'Curriculum',
          kwCategory: 'Commercial',
          activityName: 'Backlink Outreach',
          wordCount: 1500,
          contentSpoc: 'Sarah Chen',
          topic: 'Best US Curriculum Options in SG',
          contentDoc: 'https://docs.google.com/document/d/mock-4',
          status: 'Live',
          publisher: 'SgSchoolFinder',
          pgSiteDomain: 'sgschoolfinder.com',
          domainUtilizationForKw: '15%',
          liveLink: 'https://sgschoolfinder.com/american-curriculum',
          remarks: 'Indexed in US directory',
          solution: 'Guest Post',
          keyword2: 'study in singapore',
          updatedDate: '2026-08-04',
          lastActivity: 'Validated'
        },
        {
          period: 'Q3 2026',
          scheduledDate: '2026-08-18',
          keyword1: 'sais fees',
          landingPage: '/fees',
          cluster: 'Admissions',
          kwCategory: 'Informational',
          activityName: 'Guest Blogging',
          wordCount: 1100,
          contentSpoc: 'Alice Wong',
          topic: 'Comparing Private School Costs in SG',
          contentDoc: 'https://docs.google.com/document/d/mock-5',
          status: 'In Progress',
          publisher: 'ExpatSingapore',
          pgSiteDomain: 'expatsg.com',
          domainUtilizationForKw: '8%',
          liveLink: 'https://expatsg.com/fees-comparison',
          remarks: '', // empty to test N/A fallback
          solution: 'Editorial link',
          keyword2: 'private schools fees sg',
          updatedDate: '2026-08-04',
          lastActivity: 'Review copy sent'
        }
      ]
    }
  ];

  // --- Import Data States ---
  const [imports, setImports] = useState(() => {
    try {
      const saved = localStorage.getItem('seo_imported_datasets');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return initialImports;
  });
  const [selectedImportProject, setSelectedImportProject] = useState(mockProjects[0].name);
  const [isDragging, setIsDragging] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importMsg, setImportMsg] = useState({ type: '', text: '' });

  // --- Scheduler States ---
  const [schedules, setSchedules] = useState(() => {
    try {
      const saved = localStorage.getItem('seo_scheduled_actions');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [
      { id: 1, action: 'Run Backlink Audit', project: 'testing308', datetime: '2026-08-15T09:00', frequency: 'Weekly', status: 'Scheduled' },
      { id: 2, action: 'Trigger Outreach Emails', project: 'One World International School', datetime: '2026-08-20T14:30', frequency: 'One-Time', status: 'Scheduled' }
    ];
  });
  const [scheduleAction, setScheduleAction] = useState('Run Backlink Audit');
  const [selectedSchedProject, setSelectedSchedProject] = useState(mockProjects[0].name);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleFreq, setScheduleFreq] = useState('One-Time');
  const [schedMsg, setSchedMsg] = useState({ type: '', text: '' });

  const [systemAssociates, setSystemAssociates] = useState([]);

  // Load monthly operations data and system associates from DB on mount
  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        const [dbImports, dbSchedules, dbUsers] = await Promise.all([
          fetchMonthlyImportsApi().catch(() => null),
          fetchScheduledActivitiesApi().catch(() => null),
          fetchUsersApi().catch(() => null)
        ]);
        if (isMounted) {
          if (dbImports && dbImports.length > 0) setImports(dbImports);
          if (dbSchedules && dbSchedules.length > 0) setSchedules(dbSchedules);
          if (dbUsers && Array.isArray(dbUsers)) {
            const associates = dbUsers
              .filter(u => {
                const r = (u.role || '').toUpperCase();
                return r.includes('ASSOCIATE');
              })
              .map(u => (u.name || u.email || '').trim())
              .filter(Boolean);
            setSystemAssociates(associates);
          }
        }
      } catch (err) {
        console.warn('[OffPageSchedulerPage] Failed to load DB monthly operations:', err);
      }
    }
    loadData();
    return () => { isMounted = false; };
  }, []);

  // Vendor project scoped datasets & schedules
  const filteredImports = useMemo(() => {
    if (!vendorProject) return imports;
    const vProjLower = vendorProject.toLowerCase().trim();
    return imports.filter(imp => {
      const pName = String(imp.project || imp.project_name || imp.domain || '').toLowerCase();
      return pName.includes(vProjLower) || vProjLower.includes(pName);
    });
  }, [imports, vendorProject]);

  const filteredSchedules = useMemo(() => {
    if (!vendorProject) return schedules;
    const vProjLower = vendorProject.toLowerCase().trim();
    return schedules.filter(sch => {
      const pName = String(sch.project || sch.project_name || sch.domain || '').toLowerCase();
      return pName.includes(vProjLower) || vProjLower.includes(pName);
    });
  }, [schedules, vendorProject]);

  const handleDownloadMonthlyOperations = async () => {
    try {
      const allRows = [];
      (filteredImports || []).forEach(imp => {
        const rows = imp.rowsData || [];
        if (rows.length > 0) {
          rows.forEach(r => {
            allRows.push({
              'Associated Project': imp.project || '',
              'Dataset Filename': imp.filename || '',
              'Import Date': imp.date || '',
              'UID': r.uid || '',
              'Keyword 1': r.keyword1 || r.keyword || '',
              'Keyword 2': r.keyword2 || '',
              'Landing Page': r.landingPage || r.landing_page || r.page || '',
              'Cluster': r.cluster || '',
              'KW Category': r.kwCategory || '',
              'Activity Name': r.activityName || '',
              'Word Count': r.wordCount || '',
              'Content SPOC': r.contentSpoc || '',
              'Topic': r.topic || '',
              'Content Doc': r.contentDoc || '',
              'Status': r.status || '',
              'Publisher / POC': r.publisher || '',
              'PG Site Domain': r.pgSiteDomain || '',
              'Domain Utilization': r.domainUtilizationForKw || '',
              'Live Link': r.liveLink || '',
              'Remarks': r.remarks || '',
              'Solution': r.solution || '',
              'Last Activity': r.lastActivity || '',
              'Scheduled Date': r.scheduledDate || '',
              'Updated Date': r.updatedDate || '',
            });
          });
        } else {
          allRows.push({
            'Associated Project': imp.project || '',
            'Dataset Filename': imp.filename || '',
            'Import Date': imp.date || '',
            'Records Count': imp.rows || 0,
          });
        }
      });

      if (allRows.length === 0) {
        alert('No Off-Page data available to download.');
        return;
      }

      const headers = Object.keys(allRows[0]);
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Off-Page');
      sheet.columns = headers.map(h => ({ header: h, width: Math.max(14, h.length + 4) }));

      const thinBorder = { style: 'thin', color: { argb: 'FFD1D5DB' } };
      const cellBorder = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };

      sheet.getRow(1).eachCell(cell => {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = cellBorder;
      });

      allRows.forEach(r => {
        const row = sheet.addRow(headers.map(h => r[h]));
        row.eachCell(cell => {
          cell.font = { name: 'Calibri', size: 10 };
          cell.border = cellBorder;
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `off-page-db-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export Off-Page data:', err);
    }
  };

  // Persist local backup
  useEffect(() => {
    localStorage.setItem('seo_imported_datasets', JSON.stringify(imports));
  }, [imports]);

  useEffect(() => {
    if (vendorProject) {
      setSelectedImportProject(vendorProject);
      setSelectedSchedProject(vendorProject);
    }
  }, [vendorProject]);

  useEffect(() => {
    if (selectedDataset && filteredImports && filteredImports.length > 0) {
      const isCurrentValid = filteredImports.some(imp => String(imp.id) === String(selectedDataset.id));
      if (!isCurrentValid) {
        setSelectedDataset(null);
      }
    }
  }, [filteredImports]);

  useEffect(() => {
    localStorage.setItem('seo_scheduled_actions', JSON.stringify(schedules));
  }, [schedules]);

  // --- Import Event Handlers ---
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    setImportMsg({ type: '', text: '' });
    const file = e.dataTransfer.files[0];
    if (file) {
      validateAndSetFile(file);
    }
  };

  const handleFileSelect = (e) => {
    setImportMsg({ type: '', text: '' });
    const file = e.target.files[0];
    if (file) {
      validateAndSetFile(file);
    }
  };

  const validateAndSetFile = (file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx', 'xls', 'json', 'tsv'].includes(ext)) {
      setImportMsg({ type: 'error', text: 'Unsupported format. Please upload Excel (.xlsx, .xls), CSV or JSON data.' });
      setImportFile(null);
      return;
    }
    setImportFile(file);
  };

  // CSV/JSON/Excel File Parser & DB Sync
  const handleUploadSubmit = async () => {
    if (!importFile) {
      setImportMsg({ type: 'error', text: 'Please choose or drag a file to import.' });
      return;
    }

    try {
      let rowsData = [];
      const filenameLower = importFile.name.toLowerCase();
      const ext = filenameLower.split('.').pop();

      if (['xlsx', 'xls'].includes(ext)) {
        const arrayBuffer = await importFile.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        rowsData = jsonRows.map(item => normalizeRow(item));
      } else if (filenameLower.endsWith('.json')) {
        const text = await importFile.text();
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        rowsData = list.map(item => normalizeRow(item));
      } else {
        const text = await importFile.text();
        // Parse CSV lines
        const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
        if (lines.length > 1) {
          const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
          for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            const rowObj = {};
            headers.forEach((header, index) => {
              rowObj[header] = values[index] !== undefined ? values[index] : '';
            });
            rowsData.push(normalizeRow(rowObj));
          }
        }
      }

      if (rowsData.length === 0) {
        setImportMsg({ type: 'error', text: 'No valid data rows found. Check your file headers.' });
        return;
      }

      const now = new Date();
      const formattedDate = now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Check if entry for selected project exists
      const existing = imports.find(imp => 
        imp.project && selectedImportProject && 
        imp.project.trim().toLowerCase() === selectedImportProject.trim().toLowerCase()
      );

      if (existing) {
        // Append data to existing project entry
        const mergedRowsData = [...(existing.rowsData || []), ...rowsData];
        let dbId = existing.id;

        const res = await updateMonthlyImportApi(dbId, {
          filename: importFile.name,
          rows: mergedRowsData.length,
          date: formattedDate,
          rowsData: mergedRowsData
        }).catch(() => null);

        if (!res) {
          // If update failed (e.g. ID was local mock ID), create fresh record in DB
          const newRes = await createMonthlyImportApi({
            filename: importFile.name,
            project: selectedImportProject,
            rows: mergedRowsData.length,
            date: formattedDate,
            rowsData: mergedRowsData
          }).catch(err => console.warn('[Upload] Failed to create in DB:', err));
          if (newRes && newRes.id) dbId = newRes.id;
        }

        const updatedItem = {
          ...existing,
          id: dbId,
          filename: importFile.name,
          rows: mergedRowsData.length,
          date: formattedDate,
          rowsData: mergedRowsData
        };

        setImports(prev => prev.map(imp => imp.project.trim().toLowerCase() === selectedImportProject.trim().toLowerCase() ? updatedItem : imp));
      } else {
        // Create new project import record in DB
        const payload = {
          filename: importFile.name,
          project: selectedImportProject,
          rows: rowsData.length,
          date: formattedDate,
          rowsData: rowsData
        };

        let newId = Date.now();
        const dbRes = await createMonthlyImportApi(payload).catch(err => console.warn('[Upload] Failed to save to DB:', err));
        if (dbRes && dbRes.id) newId = dbRes.id;

        const newImport = { ...payload, id: newId, status: 'Success' };
        setImports(prev => [newImport, ...prev]);
      }

      setImportFile(null);
      setImportMsg({ type: '', text: '' });
      setShowImportModal(false);
    } catch (err) {
      setImportMsg({ type: 'error', text: `Failed to parse file: ${err.message}` });
    }
  };

  // CSV Template download utility
  const downloadTemplateCSV = () => {
    const headers = [
      'UID', 'Period', 'Scheduled Date', 'Keyword 1', 'Keyword 2', 'Landing Page', 'Cluster', 
      'KW Category', 'Activity Name', 'Word Count', 'Content SPOC', 'Topic', 
      'Content Doc', 'Status', 'POC', 'PG Site Domain', 
      'Live Link', 'Remarks', 'Solution', 'Last Activity', 'Updated Date'
    ];
    // Example row
    const row1 = [
      'MO-8A3F9B12', 'Q3 2026', '2026-08-10', 'school fees', 'education cost', '/fees', 'Fees', 
      'Commercial', 'Forum Quora', '1200', 'Sarah Chen', 'SG School Fees Guide', 
      'https://docs.google.com/document/d/1', 'Published-Indexed', 'SgSchoolFinder', 'sgschoolfinder.com', 
      'https://sgschoolfinder.com/link', 'Secured high DA link', 'Editorial Placement', 'Link validated', '2026-08-04'
    ];
    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), row1.join(',')].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "offpage_scheduler_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDeleteImport = (id) => {
    setImports(imports.filter(imp => imp.id !== id));
    deleteMonthlyImportApi(id).catch(err => console.warn('Failed to delete import from DB:', err));
  };

  // --- Scheduler Event Handlers ---
  const handleScheduleSubmit = () => {
    setSchedMsg({ type: '', text: '' });

    if (!scheduleDate) {
      setSchedMsg({ type: 'error', text: 'Please pick a schedule date and execution time.' });
      return;
    }

    const newSched = {
      id: Date.now(),
      action: scheduleAction,
      project: selectedSchedProject,
      datetime: scheduleDate,
      frequency: scheduleFreq,
      status: 'Scheduled'
    };

    setSchedules(prev => [newSched, ...prev]);

    createScheduledActivityApi({
      action_name: scheduleAction,
      project: selectedSchedProject,
      datetime_str: scheduleDate,
      frequency: scheduleFreq,
      status: 'Scheduled'
    }).catch(err => console.warn('[Scheduler] Failed to save scheduled activity to DB:', err));

    setShowScheduleModal(false);
  };

  const handleDeleteSchedule = (id) => {
    setSchedules(prev => prev.filter(sch => sch.id !== id));
    deleteScheduledActivityApi(id).catch(err => console.warn('[Scheduler] Failed to delete scheduled activity from DB:', err));
  };

  const handleRunNow = (id) => {
    setSchedules(prev => prev.map(sch => {
      if (sch.id === id) {
        return { ...sch, status: 'Completed' };
      }
      return sch;
    }));
  };

  const handleRowChange = (datasetId, rowIndex, field, value) => {
    const todayStr = getTodayFormatted();
    let updatedRows = null;

    setImports(prevImports => 
      prevImports.map(imp => {
        if (imp.id !== datasetId) return imp;
        const newRowsData = [...imp.rowsData];
        newRowsData[rowIndex] = { 
          ...newRowsData[rowIndex], 
          [field]: value,
          updatedDate: todayStr,
          updated_date: todayStr
        };
        updatedRows = newRowsData;
        return { ...imp, rowsData: newRowsData };
      })
    );
    if (selectedDataset && selectedDataset.id === datasetId) {
      setSelectedDataset(prev => {
        const newRowsData = updatedRows || [...prev.rowsData];
        if (!updatedRows) {
           newRowsData[rowIndex] = { 
            ...newRowsData[rowIndex], 
            [field]: value,
            updatedDate: todayStr,
            updated_date: todayStr
          };
        }
        return { ...prev, rowsData: newRowsData };
      });
    }
    setIsDirty(true);
    setSavingState('');
  };

  const handleBulkDelete = () => {
    if (!selectedDataset || selectedRowIndices.length === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedRowIndices.length} selected row(s)?`)) return;

    const currentRows = selectedDataset.rowsData || [];
    const remainingRows = currentRows.filter((_, idx) => !selectedRowIndices.includes(idx));
    const datasetId = selectedDataset.id;

    setImports(prevImports => 
      prevImports.map(imp => {
        if (imp.id !== datasetId) return imp;
        return { ...imp, rows: remainingRows.length, rowsData: remainingRows };
      })
    );
    setSelectedDataset(prev => ({ ...prev, rows: remainingRows.length, rowsData: remainingRows }));
    setSelectedRowIndices([]);
    setIsDirty(true);
    setSavingState('');
  };

  const handleBulkEditField = (field, value) => {
    if (!selectedDataset || selectedRowIndices.length === 0 || !value) return;
    const todayStr = getTodayFormatted();

    const currentRows = selectedDataset.rowsData || [];
    const updatedRows = currentRows.map((r, idx) => {
      if (selectedRowIndices.includes(idx)) {
        return { 
          ...r, 
          [field]: value,
          updatedDate: todayStr,
          updated_date: todayStr
        };
      }
      return r;
    });

    const datasetId = selectedDataset.id;
    setImports(prevImports => 
      prevImports.map(imp => {
        if (imp.id !== datasetId) return imp;
        return { ...imp, rowsData: updatedRows };
      })
    );
    setSelectedDataset(prev => ({ ...prev, rowsData: updatedRows }));
    setIsDirty(true);
    setSavingState('');
  };

  const handleSaveChanges = async () => {
    if (!selectedDataset) return;
    setSavingState('saving');
    try {
      const datasetId = selectedDataset.id;
      const currentRows = selectedDataset.rowsData || [];
      await updateMonthlyImportApi(datasetId, { 
        project: selectedDataset.project || selectedDataset.project_name,
        filename: selectedDataset.filename,
        rows: currentRows.length, 
        rowsData: currentRows 
      });
      setOriginalRowsData(JSON.parse(JSON.stringify(currentRows)));
      setIsDirty(false);
      setSavingState('saved');
      setTimeout(() => setSavingState(''), 3500);
    } catch (err) {
      console.error('Failed to save changes DB:', err);
      setSavingState('error');
    }
  };

  const handleRunAudit = async () => {
    setAuditAllocating(true);
    try {
      const datasetId = selectedDataset ? selectedDataset.id : null;
      
      const assocMap = new Map();
      (systemAssociates || []).forEach(name => {
        if (name && name.trim() && name.toLowerCase() !== 'unassigned') {
          const key = name.trim().toLowerCase();
          if (!assocMap.has(key)) {
            assocMap.set(key, name.trim());
          }
        }
      });

      if (assocMap.size === 0 && selectedDataset) {
        const currentRows = [...(selectedDataset.rowsData || [])];
        currentRows.forEach(r => {
          const raw = (r.publisher || r.associate || '').trim();
          if (raw && raw.toLowerCase() !== 'unassigned') {
            const key = raw.toLowerCase();
            if (!assocMap.has(key)) {
              assocMap.set(key, raw);
            }
          }
        });
      }

      const activeAssociates = Array.from(assocMap.values());

      if (selectedDataset && activeAssociates.length > 0) {
        const currentRows = [...(selectedDataset.rowsData || [])];
        const updatedRows = currentRows.map((row, idx) => {
          const assignedAssoc = activeAssociates[idx % activeAssociates.length];
          return { ...row, publisher: assignedAssoc };
        });

        setSelectedDataset(prev => ({ ...prev, rowsData: updatedRows }));
        setIsDirty(true);

        await updateMonthlyImportApi(selectedDataset.id, {
          project: selectedDataset.project || selectedDataset.project_name,
          filename: selectedDataset.filename,
          rows: updatedRows.length,
          rowsData: updatedRows
        });
      }

      const res = await runAuditAllocationApi({ dataset_id: datasetId, days: 22, system_associates: activeAssociates });
      const freshImports = await fetchMonthlyImportsApi();
      setImports(freshImports);
      if (selectedDataset) {
        const updatedDs = freshImports.find(imp => String(imp.id) === String(selectedDataset.id));
        if (updatedDs) {
          setSelectedDataset(updatedDs);
        }
        setShowAssocPopover(true);
      } else {
        setShowGlobalAssocPopover(true);
      }
      setAuditSuccessMsg(res.message || 'Equal resource allocation completed across all associates!');
    } catch (err) {
      setAuditSuccessMsg(`Audit allocation notice: ${err.message}`);
    } finally {
      setAuditAllocating(false);
    }
  };

  const handleRunAiStatusCheck = async () => {
    if (!selectedDataset) return;
    setAiChecking(true);
    try {
      const res = await runAiStatusCheckStreamApi(
        {
          dataset_id: selectedDataset.id,
          rows: selectedDataset.rowsData
        },
        ({ index, row }) => {
          if (row && index !== undefined) {
            setSelectedDataset(prev => {
              if (!prev || !prev.rowsData) return prev;
              const newRows = [...prev.rowsData];
              newRows[index] = { ...newRows[index], ...row };
              return { ...prev, rowsData: newRows };
            });
          }
        }
      );

      const freshImports = await fetchMonthlyImportsApi().catch(() => null);
      if (freshImports && freshImports.length > 0) {
        setImports(freshImports);
      }

      setAuditSuccessMsg(res?.message || 'AI Audit Check completed successfully!');
      setTimeout(() => setAuditSuccessMsg(''), 5000);
    } catch (err) {
      setAuditSuccessMsg(`AI Audit Check notice: ${err.message}`);
    } finally {
      setAiChecking(false);
    }
  };

  const activeDatasetRows = selectedDataset ? (selectedDataset.rowsData || []) : [];

  const fieldOptions = useMemo(() => {
    const acc = {};
    ALL_FIELD_CONFIGS.forEach(f => acc[f.key] = new Set());

    (activeDatasetRows || []).forEach(r => {
      ALL_FIELD_CONFIGS.forEach(f => {
        const val = r[f.key] ?? r[f.key.replace(/([A-Z])/g, "_$1").toLowerCase()];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          acc[f.key].add(String(val).trim());
        }
      });
    });

    const sorted = {};
    ALL_FIELD_CONFIGS.forEach(f => {
      sorted[f.key] = Array.from(acc[f.key]).sort();
    });
    return sorted;
  }, [activeDatasetRows]);

  // Render Dataset details view when selected
  if (selectedDataset) {
    const rows = selectedDataset.rowsData || [];

    const filteredRows = rows.filter(r => {
      const matchSearch = !datasetSearch || 
        (r.keyword1 || '').toLowerCase().includes(datasetSearch.toLowerCase()) ||
        (r.keyword2 || '').toLowerCase().includes(datasetSearch.toLowerCase()) ||
        (r.landingPage || '').toLowerCase().includes(datasetSearch.toLowerCase()) ||
        (r.publisher || '').toLowerCase().includes(datasetSearch.toLowerCase()) ||
        (r.topic || '').toLowerCase().includes(datasetSearch.toLowerCase()) ||
        (r.cluster || '').toLowerCase().includes(datasetSearch.toLowerCase()) ||
        (r.kwCategory || '').toLowerCase().includes(datasetSearch.toLowerCase()) ||
        (r.contentSpoc || '').toLowerCase().includes(datasetSearch.toLowerCase()) ||
        (r.uid || '').toLowerCase().includes(datasetSearch.toLowerCase());

      if (!matchSearch) return false;

      // Scheduled Date Range Filter
      const rDate = (r.scheduledDate || r.scheduled_date || '').trim();
      if (filterStartDate && rDate && rDate < filterStartDate) return false;
      if (filterEndDate && rDate && rDate > filterEndDate) return false;
      if ((filterStartDate || filterEndDate) && !rDate) return false;

      // Activity Name filter
      if (filterActivity && filterActivity !== 'ALL') {
        const actVal = String(r.activityName || r.activity || '').trim();
        if (actVal.toLowerCase() !== filterActivity.toLowerCase()) {
          return false;
        }
      }

      // Status filter
      if (filterStatus && filterStatus !== 'ALL') {
        const statusVal = String(r.status || '').trim();
        if (statusVal.toLowerCase() !== filterStatus.toLowerCase()) {
          return false;
        }
      }

      // Field Filters from Filter Popover
      for (const [key, filterVal] of Object.entries(fieldFilters)) {
        if (!filterVal || filterVal === 'ALL') continue;
        const rawVal = String(r[key] ?? r[key.replace(/([A-Z])/g, "_$1").toLowerCase()] ?? '').trim();
        if (rawVal.toLowerCase() !== filterVal.toLowerCase()) {
          return false;
        }
      }

      return true;
    });

    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* Back Link */}
        {!vendorProject && (
          <div style={{ marginBottom: 16 }}>
            <button 
              onClick={() => { 
                handleAttemptLeaveDataset(() => {
                  setSelectedDataset(null); 
                  setDatasetSearch(''); 
                  setFilterActivity('ALL');
                  setFilterStatus('ALL');
                  setShowFilterPopover(false);
                  setSelectedRowIndices([]);
                });
              }}
              style={{ 
                background: 'none', 
                border: 'none', 
                color: 'var(--accent)', 
                fontSize: 13.5, 
                fontWeight: 600, 
                cursor: 'pointer', 
                display: 'flex', 
                alignItems: 'center', 
                gap: 6,
                padding: 0
              }}
              onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
              onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
            >
              ← Back
            </button>
          </div>
        )}
        {/* Header Title info & Save Changes Button */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
              {selectedDataset.project || selectedDataset.project_name}
            </h1>
            
          </div>

          {/* Save Changes & Run Audit Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {!isVendor && userCanUpdate && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={handleRunAudit}
                  disabled={auditAllocating}
                  style={{
                    background: '#ffffff',
                    color: '#0f172a',
                    border: '1.5px solid #cbd5e1',
                    borderRadius: 10,
                    padding: '9px 18px',
                    fontSize: 13.5,
                    fontWeight: 700,
                    cursor: auditAllocating ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = '#ffffff'}
                >
                  <ShieldCheck size={16} color="var(--accent)" />
                  {auditAllocating ? 'Allocating Associates...' : 'Run Audit Allocation'}
                </button>

                {/* People Icon Button with Associate Breakdown Popover */}
                {(() => {
                  const nameMap = new Map();
                  (systemAssociates || []).forEach(name => {
                    if (name && name.trim() && name.toLowerCase() !== 'unassigned') {
                      const key = name.trim().toLowerCase();
                      if (!nameMap.has(key)) {
                        nameMap.set(key, { name: name.trim(), count: 0 });
                      }
                    }
                  });
                  const hasSystemAssocs = systemAssociates && systemAssociates.length > 0;
                  (rows || []).forEach(r => {
                    const raw = r.publisher && r.publisher.trim() !== '' ? r.publisher.trim() : 'Unassigned';
                    const key = raw.toLowerCase();
                    if (nameMap.has(key)) {
                      nameMap.get(key).count += 1;
                    } else if (!hasSystemAssocs) {
                      nameMap.set(key, { name: raw, count: 1 });
                    }
                  });
                  const assocEntries = Array.from(nameMap.values()).map(item => [item.name, item.count]);
                  const assignedCount = assocEntries.filter(([n]) => n.toLowerCase() !== 'unassigned').length;

                  return (
                    <div ref={assocPopoverRef} style={{ position: 'relative', display: 'inline-block' }}>
                      <button
                        onClick={() => setShowAssocPopover(!showAssocPopover)}
                        title="View Associate Resource Allocation"
                        style={{
                          background: showAssocPopover ? '#f1f5f9' : '#ffffff',
                          color: '#0f172a',
                          border: '1.5px solid #cbd5e1',
                          borderRadius: 10,
                          padding: '9px 12px',
                          fontSize: 13.5,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={e => e.currentTarget.style.background = showAssocPopover ? '#f1f5f9' : '#ffffff'}
                      >
                        <Users size={18} color="#2563eb" />
                      </button>

                      {showAssocPopover && (
                        <div style={{
                          position: 'absolute',
                          top: 'calc(100% + 8px)',
                          right: 0,
                          zIndex: 999,
                          width: 320,
                          background: '#ffffff',
                          border: '1.5px solid #e2e8f0',
                          borderRadius: 14,
                          padding: '16px 18px',
                          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.15)'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid #f1f5f9' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <Users size={16} color="#2563eb" />
                              <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: '#0f172a' }}>
                                Associate Allocations
                              </h4>
                            </div>
                            <button 
                              onClick={() => setShowAssocPopover(false)}
                              style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748b', padding: 2 }}
                            >
                              <X size={14} />
                            </button>
                          </div>

                          <p style={{ margin: '0 0 12px 0', fontSize: 12, color: '#64748b' }}>
                            <strong>{assignedCount} Associate(s)</strong> assigned across <strong>{rows.length}</strong> total resources
                          </p>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                            {assocEntries.map(([associateName, count]) => (
                              <div key={associateName} style={{
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                borderRadius: 8,
                                padding: '8px 12px',
                                fontSize: 13,
                                fontWeight: 600,
                                color: '#0f172a',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between'
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: associateName === 'Unassigned' ? '#94a3b8' : '#2563eb' }} />
                                  <span>{associateName}</span>
                                </div>
                                <span style={{
                                  background: associateName === 'Unassigned' ? '#f1f5f9' : '#dbeafe',
                                  color: associateName === 'Unassigned' ? '#475569' : '#1e40af',
                                  padding: '2px 8px',
                                  borderRadius: 6,
                                  fontSize: 12,
                                  fontWeight: 800
                                }}>
                                  {count} {count === 1 ? 'resource' : 'resources'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {!isVendor && userCanUpdate && (
              <button
                onClick={handleRunAiStatusCheck}
                disabled={aiChecking}
                style={{
                  background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 10,
                  padding: '9px 18px',
                  fontSize: 13.5,
                  fontWeight: 700,
                  cursor: aiChecking ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 3px 10px rgba(59, 130, 246, 0.25)',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                <Sparkles size={16} color="#ffffff" />
                {aiChecking ? 'Running AI Audit Check...' : 'AI Audit Check'}
              </button>
            )}

            {hasUnsavedChanges && (
              <span style={{ fontSize: 12.5, fontWeight: 600, color: '#d97706', background: '#fef3c7', padding: '5px 12px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #fde68a' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#d97706' }} /> Unsaved changes
              </span>
            )}
            
            {!isVendor && userCanEdit && (
              <button
                onClick={handleSaveChanges}
                disabled={savingState === 'saving'}
                style={{
                  background: hasUnsavedChanges ? 'var(--accent)' : savingState === 'saved' ? '#16a34a' : 'var(--surface-2)',
                  color: (hasUnsavedChanges || savingState === 'saved') ? '#ffffff' : 'var(--text-secondary)',
                  border: (hasUnsavedChanges || savingState === 'saved') ? 'none' : '1.5px solid var(--border)',
                  borderRadius: 10,
                  padding: '9px 20px',
                  fontSize: 13.5,
                  fontWeight: 700,
                  cursor: savingState === 'saving' ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: hasUnsavedChanges ? '0 4px 14px rgba(37, 99, 235, 0.25)' : 'none',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={e => {
                  if (hasUnsavedChanges) e.currentTarget.style.opacity = '0.9';
                }}
                onMouseLeave={e => {
                  if (hasUnsavedChanges) e.currentTarget.style.opacity = '1';
                }}
              >
                <Save size={16} />
                {savingState === 'saving' ? 'Saving...' : savingState === 'saved' ? 'Saved!' : 'Save Changes'}
              </button>
            )}
          </div>
        </div>



        {/* Search, Filters, and Bulk Actions Bar */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderBottom: 'none',
          borderTopLeftRadius: 'var(--radius)',
          borderTopRightRadius: 'var(--radius)',
          padding: '16px 20px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {/* Search Input */}
            <input 
              type="text"
              placeholder="Search keywords, landing pages, POCs..."
              value={datasetSearch}
              onChange={(e) => setDatasetSearch(e.target.value)}
              style={{
                width: 280,
                padding: '8px 12px',
                fontSize: 13.5,
                background: 'var(--surface-2)',
                border: '1.5px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text-primary)',
                outline: 'none'
              }}
            />

            {/* Filter Icon Button with Popover Dropdown */}
            <div ref={filterRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setShowFilterPopover(!showFilterPopover)}
                title="Filter Records"
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 6,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  transition: 'opacity 0.15s ease',
                  position: 'relative',
                  outline: 'none'
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                <Filter size={19} color={activeFieldFilterCount > 0 ? 'var(--accent)' : '#64748b'} style={{ strokeWidth: 1.8 }} />
                
                {activeFieldFilterCount > 0 && (
                  <span style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: 'var(--accent)'
                  }} />
                )}
              </button>

              {/* All-Fields Popover Options Menu */}
              {showFilterPopover && (
                <div style={{
                  position: 'absolute',
                  top: 46,
                  left: 0,
                  zIndex: 100,
                  width: 540,
                  maxHeight: '75vh',
                  overflowY: 'auto',
                  background: '#ffffff',
                  borderRadius: 14,
                  border: '1px solid #cbd5e1',
                  boxShadow: '0 14px 35px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.05)',
                  padding: 18,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Filter size={16} color="var(--accent)" /> Filter {activeFieldFilterCount > 0 ? `(${activeFieldFilterCount} active)` : ''}
                    </span>
                    {activeFieldFilterCount > 0 && (
                      <button
                        onClick={handleResetFieldFilters}
                        style={{ border: 'none', background: '#fef2f2', color: '#b91c1c', fontSize: 12, fontWeight: 700, borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
                      >
                        Reset All Filters
                      </button>
                    )}
                  </div>

                  {/* Scheduled Date Range Filter (Excludes Sat/Sun) */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: '#f8fafc', padding: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}>
                    <label style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Calendar size={13} color="var(--accent)" /> Scheduled Date Range
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <span style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3 }}>From</span>
                        <input
                          type="date"
                          value={filterStartDate}
                          onChange={(e) => setFilterStartDate(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '6px 10px',
                            fontSize: 12,
                            fontWeight: 600,
                            borderRadius: 8,
                            border: filterStartDate ? '1.5px solid var(--accent)' : '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#0f172a',
                            outline: 'none'
                          }}
                        />
                      </div>
                      <div>
                        <span style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3 }}>To</span>
                        <input
                          type="date"
                          value={filterEndDate}
                          onChange={(e) => setFilterEndDate(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '6px 10px',
                            fontSize: 12,
                            fontWeight: 600,
                            borderRadius: 8,
                            border: filterEndDate ? '1.5px solid var(--accent)' : '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#0f172a',
                            outline: 'none'
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 2-Column Grid for All Field Filters */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                    {ALL_FIELD_CONFIGS.map(f => {
                      const opts = fieldOptions[f.key] || [];
                      const currVal = fieldFilters[f.key] || '';

                      return (
                        <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <label style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            {f.label}
                          </label>
                          <select
                            value={currVal}
                            onChange={(e) => setFieldFilters(prev => ({ ...prev, [f.key]: e.target.value }))}
                            style={{
                              width: '100%',
                              padding: '7px 10px',
                              fontSize: 12.5,
                              fontWeight: 600,
                              borderRadius: 8,
                              border: currVal ? '1.5px solid var(--accent)' : '1px solid #cbd5e1',
                              background: currVal ? '#eff6ff' : '#ffffff',
                              color: currVal ? '#1d4ed8' : '#0f172a',
                              outline: 'none',
                              cursor: 'pointer'
                            }}
                          >
                            <option value="">All {f.label}s ({opts.length})</option>
                            {opts.map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Download Icon Button right near Filter Icon */}
            <button
              onClick={() => handleDownloadRows(filteredRows, selectedDataset?.project || selectedDataset?.project_name || selectedDataset?.name || 'Off-Page')}
              title="Download Excel Data"
              style={{
                background: 'none',
                border: 'none',
                padding: 6,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
                transition: 'opacity 0.15s ease',
                outline: 'none'
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              <Download size={19} color="#64748b" style={{ strokeWidth: 1.8 }} />
            </button>
          </div>

          {/* Actions Button & Dropdown matching screenshot */}
          {(!isVendor && selectedRowIndices.length > 0) ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Actions Dropdown */}
              <div ref={actionsRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowActionsDropdown(!showActionsDropdown)}
                  style={{
                    background: '#0f172a',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '8px 16px',
                    fontSize: 13.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    boxShadow: '0 2px 6px rgba(15, 23, 42, 0.15)',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
                  onMouseLeave={e => e.currentTarget.style.background = '#0f172a'}
                >
                  Actions ({selectedRowIndices.length})
                  <ChevronDown size={14} style={{ transform: showActionsDropdown ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }} />
                </button>

                {/* Actions Popover Dropdown Menu */}
                {showActionsDropdown && (
                  <div style={{
                    position: 'absolute',
                    top: 44,
                    right: 0,
                    zIndex: 100,
                    width: 175,
                    background: '#ffffff',
                    borderRadius: 8,
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 10px 30px -5px rgba(0,0,0,0.12), 0 4px 6px -2px rgba(0,0,0,0.05)',
                    padding: '6px 0',
                    overflow: 'hidden'
                  }}>
                    {/* Bulk Edit Option */}
                    <button
                      onClick={() => {
                        setShowActionsDropdown(false);
                        setShowBulkEditModal(true);
                      }}
                      style={{
                        width: '100%',
                        padding: '10px 16px',
                        background: 'none',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: '#1e293b',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.12s ease'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <Pencil size={15} color="#475569" />
                      Bulk Edit
                    </button>

                    <div style={{ height: 1, background: '#f1f5f9', margin: '4px 0' }} />

                    {/* Bulk Delete Option */}
                    <button
                      onClick={() => {
                        setShowActionsDropdown(false);
                        if (selectedDataset && selectedRowIndices.length > 0) {
                          const selectedRowsSet = new Set(selectedRowIndices.map(idx => filteredRows[idx]).filter(Boolean));
                          const remainingRows = (selectedDataset.rowsData || []).filter(r => !selectedRowsSet.has(r));
                          setSelectedDataset(prev => ({ ...prev, rowsData: remainingRows }));
                          setIsDirty(true);
                          setSelectedRowIndices([]);
                        }
                      }}
                      style={{
                        width: '100%',
                        padding: '10px 16px',
                        background: 'none',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: '#ef4444',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.12s ease'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <Trash2 size={15} color="#ef4444" />
                      Bulk Delete
                    </button>
                  </div>
                )}
              </div>

              {/* Standalone Verify Button on the right of Actions */}
              <button
                onClick={async () => {
                  if (selectedDataset && selectedRowIndices.length > 0) {
                    const todayStr = getTodayFormatted();
                    const updatedRows = [...(selectedDataset.rowsData || [])];
                    selectedRowIndices.forEach(filteredIdx => {
                      const actualRow = filteredRows[filteredIdx];
                      if (actualRow) {
                        const realIdx = updatedRows.indexOf(actualRow);
                        if (realIdx !== -1) {
                          updatedRows[realIdx] = { 
                            ...updatedRows[realIdx], 
                            verified: true,
                            updatedDate: todayStr,
                            updated_date: todayStr
                          };
                        }
                      }
                    });

                    const datasetId = selectedDataset.id;
                    setSelectedDataset(prev => ({ ...prev, rowsData: updatedRows }));
                    setImports(prev => prev.map(imp => imp.id === datasetId ? { ...imp, rowsData: updatedRows } : imp));
                    setOriginalRowsData(JSON.parse(JSON.stringify(updatedRows)));
                    setIsDirty(false);
                    setSelectedRowIndices([]);
                    setSavingState('saving');

                    try {
                      await updateMonthlyImportApi(datasetId, {
                        project: selectedDataset.project || selectedDataset.project_name,
                        filename: selectedDataset.filename,
                        rows: updatedRows.length,
                        rowsData: updatedRows,
                        rows_data: updatedRows
                      });
                      setSavingState('saved');
                      setTimeout(() => setSavingState(''), 3000);
                    } catch (err) {
                      console.error('[Verify] Failed to update DB:', err);
                      setSavingState('error');
                    }
                  }
                }}
                style={{
                  background: '#059669',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 16px',
                  fontSize: 13.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: '0 2px 6px rgba(5, 150, 105, 0.2)',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#047857'}
                onMouseLeave={e => e.currentTarget.style.background = '#059669'}
              >
                <CheckCircle size={15} color="#ffffff" />
                Verify
              </button>

              {/* Actions Popover Dropdown Menu */}
              {showActionsDropdown && (
                <div style={{
                  position: 'absolute',
                  top: 46,
                  right: 0,
                  zIndex: 100,
                  width: 175,
                  background: '#ffffff',
                  borderRadius: 12,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 10px 30px -5px rgba(0,0,0,0.12), 0 4px 6px -2px rgba(0,0,0,0.05)',
                  padding: '6px 0',
                  overflow: 'hidden'
                }}>
                  {/* Bulk Edit Option */}
                  {userCanEdit && (
                    <button
                      onClick={() => {
                        setShowActionsDropdown(false);
                        setShowBulkEditModal(true);
                      }}
                      style={{
                        width: '100%',
                        padding: '10px 16px',
                        background: 'none',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: '#1e293b',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.12s ease'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <Pencil size={15} color="#475569" />
                      Bulk Edit
                    </button>
                  )}

                  {/* Bulk Delete Option */}
                  {userCanDelete && (
                    <>
                      <div style={{ height: 1, background: '#f1f5f9', margin: '4px 0' }} />
                      <button
                        onClick={() => {
                          setShowActionsDropdown(false);
                          handleBulkDelete();
                        }}
                        style={{
                          width: '100%',
                          padding: '10px 16px',
                          background: 'none',
                          border: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: '#ef4444',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'background 0.12s ease'
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      >
                        <Trash2 size={15} color="#ef4444" />
                        Bulk Delete
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              Showing {filteredRows.length} of {rows.length} records
            </span>
          )}
        </div>

        {/* Table View */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderBottomLeftRadius: 'var(--radius)',
          borderBottomRightRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-sm)',
          overflow: 'hidden'
        }}>
          <div style={{ overflowX: 'auto', maxHeight: '75vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 2800 }}>
              <thead>
                <tr style={{ background: '#f8f9fb', borderBottom: '1.5px solid var(--border)', position: 'sticky', top: 0, zIndex: 10 }}>
                  {!isVendor && (userCanEdit || userCanDelete) && (
                    <th style={{ padding: '14px 18px', width: 48, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={filteredRows.length > 0 && filteredRows.every((_, idx) => selectedRowIndices.includes(idx))}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedRowIndices(filteredRows.map((_, idx) => idx));
                          } else {
                            setSelectedRowIndices([]);
                          }
                        }}
                        style={{ cursor: 'pointer', width: 17, height: 17, accentColor: 'var(--accent)' }}
                      />
                    </th>
                  )}
                  {[
                    'UID', 'Period', 'Scheduled Date', 'Keyword 1', 'Keyword 2', 'Cluster', 
                    'KW Category', 'Activity Name', 'Word Count', 'Content SPOC', 'Topic', 
                    'Content Doc', 'POC', 'PG Site Domain', 'Live Link', 'Status', 
                    'Remarks', 'Solution', 'Verified Status', 'Last Activity', 'Updated Date'
                  ].map((col, idx) => (
                    <th key={idx} style={{ 
                      padding: '14px 18px', 
                      textAlign: 'left', 
                      fontSize: 13, 
                      fontWeight: 700, 
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em'
                    }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={(!isVendor && (userCanEdit || userCanDelete)) ? 22 : 21} style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                      No matching records found in this dataset.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, rIdx) => (
                    <tr key={rIdx} style={{ borderBottom: '1px solid var(--border)', background: selectedRowIndices.includes(rIdx) ? '#f0f9ff' : 'transparent' }}
                      onMouseEnter={e => e.currentTarget.style.background = selectedRowIndices.includes(rIdx) ? '#e0f2fe' : '#fafbfc'}
                      onMouseLeave={e => e.currentTarget.style.background = selectedRowIndices.includes(rIdx) ? '#f0f9ff' : 'transparent'}>
                      {!isVendor && (userCanEdit || userCanDelete) && (
                        <td style={{ padding: '16px 18px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={selectedRowIndices.includes(rIdx)}
                            onChange={() => {
                              if (selectedRowIndices.includes(rIdx)) {
                                setSelectedRowIndices(selectedRowIndices.filter(i => i !== rIdx));
                              } else {
                                setSelectedRowIndices([...selectedRowIndices, rIdx]);
                              }
                            }}
                            style={{ cursor: 'pointer', width: 17, height: 17, accentColor: 'var(--accent)' }}
                          />
                        </td>
                      )}
                      <td style={{ padding: '16px 18px', fontSize: 13.5, fontFamily: 'monospace', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {row.uid || `MO-${(rIdx + 1).toString().padStart(4, '0')}`}
                      </td>
                      <td style={{ padding: '16px 18px', fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{row.period || 'N/A'}</td>
                      <td style={{ padding: '16px 18px', fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.scheduledDate || 'N/A'}</td>
                      <td style={{ padding: '16px 18px', fontSize: 14, color: '#2563eb', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {row.keyword1 ? (
                          row.landingPage ? (
                            <a href={formatUrl(row.landingPage)} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                              onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                              title={`Target URL: ${row.landingPage}`}>
                              {row.keyword1} ↗
                            </a>
                          ) : (
                            <span style={{ color: 'var(--text-primary)' }}>{row.keyword1}</span>
                          )
                        ) : 'N/A'}
                      </td>
                      <td style={{ padding: '16px 18px', fontSize: 14, color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.keyword2 || 'N/A'}</td>
                      <td style={{ padding: '16px 18px', fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.cluster || 'N/A'}</td>
                      <td style={{ padding: '16px 18px', fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.kwCategory || 'N/A'}</td>
                      <td style={{ padding: '12px 18px', whiteSpace: 'nowrap' }}>
                        {isVendor ? (
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {row.activityName || 'N/A'}
                          </span>
                        ) : (
                          <select
                            value={['Forum Quora', 'Forum Reddit', 'Paid Guest Post', 'Business Listing', 'Classified Ads'].includes(row.activityName) ? row.activityName : 'Forum Quora'}
                            onChange={(e) => handleRowChange(selectedDataset.id, rIdx, 'activityName', e.target.value)}
                            style={{
                              padding: '7px 12px',
                              fontSize: 13,
                              fontWeight: 600,
                              borderRadius: 8,
                              border: '1px solid #cbd5e1',
                              background: '#ffffff',
                              color: '#0f172a',
                              outline: 'none',
                              cursor: 'pointer'
                            }}
                          >
                            {['Forum Quora', 'Forum Reddit', 'Paid Guest Post', 'Business Listing', 'Classified Ads'].map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td style={{ padding: '16px 18px', fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.wordCount || 'N/A'}</td>
                      <td style={{ padding: '16px 18px', fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.contentSpoc || 'N/A'}</td>
                      <td style={{ padding: '16px 18px', fontSize: 14, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.topic}>
                        {row.topic ? (
                          isUrlLike(row.topic) ? (
                            <a href={formatUrl(row.topic)} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                              onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                              {row.topic} ↗
                            </a>
                          ) : (
                            <span style={{ color: 'var(--text-primary)' }}>{row.topic}</span>
                          )
                        ) : 'N/A'}
                      </td>
                      <td style={{ padding: '16px 18px', fontSize: 14, whiteSpace: 'nowrap' }}>
                        {row.contentDoc ? (
                          <a href={formatUrl(row.contentDoc)} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                            Google Doc ↗
                          </a>
                        ) : 'N/A'}
                      </td>
                      <td style={{ padding: '16px 18px', fontSize: 14, color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {row.publisher || 'Unassigned'}
                      </td>
                      <td style={{ padding: '16px 18px', fontSize: 14, color: '#2563eb', whiteSpace: 'nowrap' }} title={row.pgSiteDomain}>
                        {row.pgSiteDomain ? (
                          <a href={formatUrl(row.pgSiteDomain)} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                            {formatTruncatedDomain(row.pgSiteDomain, 15)} ↗
                          </a>
                        ) : 'N/A'}
                      </td>
                      <td style={{ padding: '16px 18px', fontSize: 14, whiteSpace: 'nowrap' }}>
                        {row.liveLink ? (
                          <a href={formatUrl(row.liveLink)} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                            View Link ↗
                          </a>
                        ) : 'N/A'}
                      </td>
                      <td style={{ padding: '12px 18px', whiteSpace: 'nowrap' }}>
                        {isVendor ? (
                          <span style={{
                            padding: '6px 12px',
                            fontSize: 13,
                            fontWeight: 700,
                            borderRadius: 8,
                            background: row.status === 'Published-Indexed' || row.status === 'Audited-Indexed' ? '#ecfdf5' : row.status === 'Audited-LQ' || row.status === 'Published-LQ' ? '#fff7ed' : row.status === 'Flagged-Indexation' || row.status === 'Not Found' ? '#fef2f2' : '#f8fafc',
                            color: row.status === 'Published-Indexed' || row.status === 'Audited-Indexed' ? '#047857' : row.status === 'Audited-LQ' || row.status === 'Published-LQ' ? '#c2410c' : row.status === 'Flagged-Indexation' || row.status === 'Not Found' ? '#b91c1c' : '#334155',
                          }}>
                            {row.status || 'Published-Indexed'}
                          </span>
                        ) : (
                          <select
                            value={STATUS_PRESET_OPTIONS.includes(row.status) ? row.status : (row.status || 'Published-Indexed')}
                            onChange={(e) => handleRowChange(selectedDataset.id, rIdx, 'status', e.target.value)}
                            style={{
                              padding: '7px 12px',
                              fontSize: 13,
                              fontWeight: 700,
                              borderRadius: 8,
                              border: '1px solid #cbd5e1',
                              background: row.status === 'Published-Indexed' || row.status === 'Audited-Indexed' ? '#ecfdf5' : row.status === 'Audited-LQ' || row.status === 'Published-LQ' ? '#fff7ed' : row.status === 'Flagged-Indexation' || row.status === 'Not Found' ? '#fef2f2' : '#f8fafc',
                              color: row.status === 'Published-Indexed' || row.status === 'Audited-Indexed' ? '#047857' : row.status === 'Audited-LQ' || row.status === 'Published-LQ' ? '#c2410c' : row.status === 'Flagged-Indexation' || row.status === 'Not Found' ? '#b91c1c' : '#334155',
                              outline: 'none',
                              cursor: 'pointer'
                            }}
                          >
                            {row.status && !STATUS_PRESET_OPTIONS.includes(row.status) && (
                              <option value={row.status}>{row.status}</option>
                            )}
                            {STATUS_PRESET_OPTIONS.map(opt => (
                              <option key={opt} value={opt} style={{ background: '#fff', color: '#0f172a', fontWeight: 500 }}>{opt}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td style={{ padding: '12px 18px', whiteSpace: 'nowrap' }}>
                        <select
                          disabled={!userCanEdit}
                          value={REMARKS_PRESET_OPTIONS.includes(row.remarks) ? row.remarks : (row.remarks || 'No Issues')}
                          onChange={(e) => handleRowChange(selectedDataset.id, rIdx, 'remarks', e.target.value)}
                          style={{
                            padding: '7px 12px',
                            fontSize: 13,
                            fontWeight: 600,
                            borderRadius: 8,
                            border: '1px solid #cbd5e1',
                            background: !userCanEdit ? '#f8fafc' : '#ffffff',
                            color: '#0f172a',
                            outline: 'none',
                            cursor: !userCanEdit ? 'not-allowed' : 'pointer',
                            maxWidth: 260
                          }}
                          title={row.remarks}
                        >
                          {row.remarks && !REMARKS_PRESET_OPTIONS.includes(row.remarks) && (
                            <option value={row.remarks}>{row.remarks}</option>
                          )}
                          {REMARKS_PRESET_OPTIONS.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '12px 18px', whiteSpace: 'nowrap' }}>
                        <select
                          disabled={!userCanEdit}
                          value={SOLUTION_PRESET_OPTIONS.includes(row.solution) ? row.solution : (row.solution || 'fixed')}
                          onChange={(e) => handleRowChange(selectedDataset.id, rIdx, 'solution', e.target.value)}
                          style={{
                            padding: '7px 12px',
                            fontSize: 13,
                            fontWeight: 600,
                            borderRadius: 8,
                            border: '1px solid #cbd5e1',
                            background: !userCanEdit ? '#f8fafc' : row.solution === 'fixed' ? '#f0fdf4' : '#ffffff',
                            color: row.solution === 'fixed' ? '#166534' : '#0f172a',
                            outline: 'none',
                            cursor: !userCanEdit ? 'not-allowed' : 'pointer'
                          }}
                          title={row.solution}
                        >
                          {row.solution && !SOLUTION_PRESET_OPTIONS.includes(row.solution) && (
                            <option value={row.solution}>{row.solution}</option>
                          )}
                          {SOLUTION_PRESET_OPTIONS.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13, whiteSpace: 'nowrap' }}>
                        {(row.verified === true || row.verified === 'true') ? (
                          <span style={{ 
                            display: 'inline-flex', 
                            alignItems: 'center', 
                            gap: 4, 
                            padding: '4px 10px', 
                            borderRadius: 6, 
                            fontSize: 11.5, 
                            fontWeight: 700, 
                            background: '#dcfce7', 
                            color: '#15803d',
                            border: '1px solid #bbf7d0'
                          }}>
                            <CheckCircle size={13} /> Verified ✓
                          </span>
                        ) : (
                          <span style={{ 
                            display: 'inline-flex', 
                            alignItems: 'center', 
                            gap: 4, 
                            padding: '4px 10px', 
                            borderRadius: 6, 
                            fontSize: 11.5, 
                            fontWeight: 600, 
                            background: '#f8fafc', 
                            color: '#64748b',
                            border: '1px solid #e2e8f0'
                          }}>
                            Unverified
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.lastActivity || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{row.updatedDate || 'N/A'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Bulk Edit Modal matching screenshot */}
        <Modal
          open={showBulkEditModal}
          onClose={() => {
            setShowBulkEditModal(false);
            setBulkEditField('');
            setBulkEditValue('');
          }}
          title="Bulk Edit"
          footer={
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', marginTop: 12 }}>
              <button
                onClick={() => {
                  if (bulkEditField && bulkEditValue) {
                    handleBulkEditField(bulkEditField, bulkEditValue);
                  }
                  setShowBulkEditModal(false);
                  setBulkEditField('');
                  setBulkEditValue('');
                }}
                disabled={!bulkEditField || !bulkEditValue}
                style={{
                  flex: 1,
                  padding: '12px 20px',
                  fontSize: 14,
                  fontWeight: 700,
                  color: '#ffffff',
                  background: (bulkEditField && bulkEditValue) ? '#0f172a' : '#94a3b8',
                  border: 'none',
                  borderRadius: 12,
                  cursor: (bulkEditField && bulkEditValue) ? 'pointer' : 'not-allowed',
                  boxShadow: (bulkEditField && bulkEditValue) ? '0 4px 12px rgba(15, 23, 42, 0.2)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                Apply to {selectedRowIndices.length} {selectedRowIndices.length === 1 ? 'page' : 'pages'}
              </button>
              <button
                onClick={() => {
                  setShowBulkEditModal(false);
                  setBulkEditField('');
                  setBulkEditValue('');
                }}
                style={{
                  padding: '12px 24px',
                  fontSize: 14,
                  fontWeight: 700,
                  color: '#0f172a',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: 12,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                onMouseLeave={e => e.currentTarget.style.background = '#ffffff'}
              >
                Cancel
              </button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 0 10px 0' }}>
            <p style={{ fontSize: 13.5, color: '#64748b', margin: 0 }}>
              Editing <strong>{selectedRowIndices.length}</strong> selected {selectedRowIndices.length === 1 ? 'page' : 'pages'}
            </p>

            {/* Field to Edit Dropdown */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>Field to edit</label>
              <div style={{ position: 'relative', width: '100%' }}>
                <select
                  value={bulkEditField}
                  onChange={(e) => {
                    setBulkEditField(e.target.value);
                    setBulkEditValue('');
                  }}
                  style={{
                    width: '100%',
                    padding: '11px 36px 11px 14px',
                    fontSize: 14,
                    fontWeight: 500,
                    borderRadius: 10,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: bulkEditField ? '#0f172a' : '#94a3b8',
                    outline: 'none',
                    cursor: 'pointer',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    MozAppearance: 'none'
                  }}
                >
                  <option value="">Choose a field</option>
                  {BULK_EDIT_FIELD_OPTIONS.map(f => (
                    <option key={f.key} value={f.key} style={{ color: '#0f172a' }}>{f.label}</option>
                  ))}
                </select>
                <ChevronDown size={16} color="#64748b" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              </div>
            </div>

            {/* Value Input depending on selected field */}
            {bulkEditField && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>
                  New Value for {BULK_EDIT_FIELD_OPTIONS.find(f => f.key === bulkEditField)?.label}
                </label>
                
                {bulkEditField === 'status' ? (
                  <div style={{ position: 'relative', width: '100%' }}>
                    <select
                      value={bulkEditValue}
                      onChange={(e) => setBulkEditValue(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '11px 36px 11px 14px',
                        fontSize: 14,
                        fontWeight: 500,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        color: '#0f172a',
                        outline: 'none',
                        appearance: 'none',
                        WebkitAppearance: 'none',
                        MozAppearance: 'none'
                      }}
                    >
                      <option value="">Select Status</option>
                      {STATUS_PRESET_OPTIONS.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    <ChevronDown size={16} color="#64748b" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                  </div>
                ) : bulkEditField === 'remarks' ? (
                  <div style={{ position: 'relative', width: '100%' }}>
                    <select
                      value={bulkEditValue}
                      onChange={(e) => setBulkEditValue(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '11px 36px 11px 14px',
                        fontSize: 14,
                        fontWeight: 500,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        color: '#0f172a',
                        outline: 'none',
                        appearance: 'none',
                        WebkitAppearance: 'none',
                        MozAppearance: 'none'
                      }}
                    >
                      <option value="">Select Remarks</option>
                      {REMARKS_PRESET_OPTIONS.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    <ChevronDown size={16} color="#64748b" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                  </div>
                ) : bulkEditField === 'solution' ? (
                  <div style={{ position: 'relative', width: '100%' }}>
                    <select
                      value={bulkEditValue}
                      onChange={(e) => setBulkEditValue(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '11px 36px 11px 14px',
                        fontSize: 14,
                        fontWeight: 500,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        color: '#0f172a',
                        outline: 'none',
                        appearance: 'none',
                        WebkitAppearance: 'none',
                        MozAppearance: 'none'
                      }}
                    >
                      <option value="">Select Solution</option>
                      {SOLUTION_PRESET_OPTIONS.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    <ChevronDown size={16} color="#64748b" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                  </div>
                ) : bulkEditField === 'activityName' ? (
                  <div style={{ position: 'relative', width: '100%' }}>
                    <select
                      value={bulkEditValue}
                      onChange={(e) => setBulkEditValue(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '11px 36px 11px 14px',
                        fontSize: 14,
                        fontWeight: 500,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        color: '#0f172a',
                        outline: 'none',
                        appearance: 'none',
                        WebkitAppearance: 'none',
                        MozAppearance: 'none'
                      }}
                    >
                      <option value="">Select Activity Name</option>
                      <option value="Forum Quora">Forum Quora</option>
                      <option value="Forum Reddit">Forum Reddit</option>
                      <option value="Paid Guest Post">Paid Guest Post</option>
                      <option value="Business Listing">Business Listing</option>
                      <option value="Classified Ads">Classified Ads</option>
                    </select>
                    <ChevronDown size={16} color="#64748b" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                  </div>
                ) : bulkEditField === 'scheduledDate' ? (
                  <input
                    type="date"
                    value={bulkEditValue}
                    onChange={(e) => setBulkEditValue(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      fontSize: 14,
                      fontWeight: 500,
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      outline: 'none'
                    }}
                  />
                ) : (
                  <input
                    type="text"
                    placeholder={`Enter new ${BULK_EDIT_FIELD_OPTIONS.find(f => f.key === bulkEditField)?.label}...`}
                    value={bulkEditValue}
                    onChange={(e) => setBulkEditValue(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      fontSize: 14,
                      fontWeight: 500,
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      outline: 'none'
                    }}
                  />
                )}
              </div>
            )}
          </div>
        </Modal>

        {/* Unsaved Changes Confirmation Modal */}
        <Modal
          open={showUnsavedModal}
          onClose={() => {
            setShowUnsavedModal(false);
            setPendingLeaveAction(null);
          }}
          title="Unsaved Changes"
          footer={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, width: '100%', marginTop: 8 }}>
              <button
                onClick={() => {
                  setShowUnsavedModal(false);
                  setPendingLeaveAction(null);
                }}
                style={{
                  padding: '10px 18px',
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: '#475569',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: 10,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowUnsavedModal(false);
                  try {
                    const freshImports = await fetchMonthlyImportsApi();
                    setImports(freshImports);
                  } catch (e) {
                    console.warn(e);
                  }
                  setIsDirty(false);
                  setSavingState('');
                  if (pendingLeaveAction) pendingLeaveAction();
                  setPendingLeaveAction(null);
                }}
                style={{
                  padding: '10px 18px',
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: '#b91c1c',
                  background: '#fef2f2',
                  border: '1px solid #fca5a5',
                  borderRadius: 10,
                  cursor: 'pointer'
                }}
              >
                No, Discard Changes
              </button>
              <button
                onClick={async () => {
                  setShowUnsavedModal(false);
                  try {
                    await handleSaveChanges();
                  } catch (e) {
                    console.error(e);
                  }
                  setIsDirty(false);
                  if (pendingLeaveAction) pendingLeaveAction();
                  setPendingLeaveAction(null);
                }}
                style={{
                  padding: '10px 20px',
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: '#ffffff',
                  background: '#0f172a',
                  border: 'none',
                  borderRadius: 10,
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(15,23,42,0.2)'
                }}
              >
                Yes, Save Changes
              </button>
            </div>
          }
        >
          <div style={{ padding: '8px 0 12px 0' }}>
            
            <p style={{ fontSize: 13.5, color: '#64748b', margin: 0, lineHeight: 0.1 }}>
              Would you like to save your changes before leaving?
            </p>
          </div>
        </Modal>
      </div>
    );
  }

  if (!isAdmin && !vendorProject) {
    return (
      <div style={{ padding: 40, textAlign: 'center', background: '#f8fafc', minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          maxWidth: 480,
          background: '#ffffff',
          padding: 36,
          borderRadius: 16,
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
        }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: '#fff7ed', color: '#ea580c', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto', border: '1px solid #fed7aa' }}>
            <Lock size={26} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: '0 0 8px 0' }}>No Project Assigned</h2>
          <p style={{ fontSize: 13.5, color: '#64748b', lineHeight: 1.5, margin: 0 }}>
            Off-Page is hidden and restricted until a project is allotted to your account by a system Administrator. Please contact your admin to assign a project from the Users page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header Panel with Title & Top-Right Button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
            Off-Page
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>
            Automate audits, import data sheets, and schedule link outreach actions.
          </p>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {!isVendor && userCanUpdate && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={handleRunAudit}
                disabled={auditAllocating}
                style={{
                  background: '#ffffff',
                  color: '#0f172a',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: 10,
                  padding: '10px 18px',
                  fontSize: 13.5,
                  fontWeight: 700,
                  cursor: auditAllocating ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                onMouseLeave={e => e.currentTarget.style.background = '#ffffff'}
              >
                <ShieldCheck size={16} color="var(--accent)" />
                {auditAllocating ? 'Allocating...' : 'Run Audit Allocation'}
              </button>

              {/* Global People Icon Button with Associate Breakdown Popover */}
              {(() => {
                let totalRes = 0;
                const nameMap = new Map();
                (systemAssociates || []).forEach(name => {
                  if (name && name.trim() && name.toLowerCase() !== 'unassigned') {
                    const key = name.trim().toLowerCase();
                    if (!nameMap.has(key)) {
                      nameMap.set(key, { name: name.trim(), count: 0 });
                    }
                  }
                });
                const hasSystemAssocs = systemAssociates && systemAssociates.length > 0;
                (filteredImports || []).forEach(imp => {
                  (imp.rowsData || []).forEach(r => {
                    totalRes += 1;
                    const raw = r.publisher && r.publisher.trim() !== '' ? r.publisher.trim() : 'Unassigned';
                    const key = raw.toLowerCase();
                    if (nameMap.has(key)) {
                      nameMap.get(key).count += 1;
                    } else if (!hasSystemAssocs) {
                      nameMap.set(key, { name: raw, count: 1 });
                    }
                  });
                });
                const globalEntries = Array.from(nameMap.values()).map(item => [item.name, item.count]);
                const assignedCount = globalEntries.filter(([n]) => n.toLowerCase() !== 'unassigned').length;

                return (
                  <div ref={globalAssocPopoverRef} style={{ position: 'relative', display: 'inline-block' }}>
                    <button
                      onClick={() => setShowGlobalAssocPopover(!showGlobalAssocPopover)}
                      title="View Associate Resource Allocation"
                      style={{
                        background: showGlobalAssocPopover ? '#f1f5f9' : '#ffffff',
                        color: '#0f172a',
                        border: '1.5px solid #cbd5e1',
                        borderRadius: 10,
                        padding: '10px 14px',
                        fontSize: 13.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                        transition: 'all 0.15s ease'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={e => e.currentTarget.style.background = showGlobalAssocPopover ? '#f1f5f9' : '#ffffff'}
                    >
                      <Users size={18} color="#2563eb" />
                    </button>

                    {showGlobalAssocPopover && (
                      <div style={{
                        position: 'absolute',
                        top: 'calc(100% + 8px)',
                        right: 0,
                        zIndex: 999,
                        width: 320,
                        background: '#ffffff',
                        border: '1.5px solid #e2e8f0',
                        borderRadius: 14,
                        padding: '16px 18px',
                        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.15)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid #f1f5f9' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Users size={16} color="#2563eb" />
                            <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: '#0f172a' }}>
                              Associate Allocations
                            </h4>
                          </div>
                          <button 
                            onClick={() => setShowGlobalAssocPopover(false)}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748b', padding: 2 }}
                          >
                            <X size={14} />
                          </button>
                        </div>

                        <p style={{ margin: '0 0 12px 0', fontSize: 12, color: '#64748b' }}>
                          <strong>{assignedCount} Associate(s)</strong> assigned across <strong>{totalRes}</strong> total resources
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                          {globalEntries.map(([associateName, count]) => (
                            <div key={associateName} style={{
                              background: '#f8fafc',
                              border: '1px solid #e2e8f0',
                              borderRadius: 8,
                              padding: '8px 12px',
                              fontSize: 13,
                              fontWeight: 600,
                              color: '#0f172a',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: associateName === 'Unassigned' ? '#94a3b8' : '#2563eb' }} />
                                <span>{associateName}</span>
                              </div>
                              <span style={{
                                background: associateName === 'Unassigned' ? '#f1f5f9' : '#dbeafe',
                                color: associateName === 'Unassigned' ? '#475569' : '#1e40af',
                                padding: '2px 8px',
                                borderRadius: 6,
                                fontSize: 12,
                                fontWeight: 800
                              }}>
                                {count} {count === 1 ? 'resource' : 'resources'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {activeTab === 'import' ? (
            !isVendor && userCanEdit && (
              <Btn variant="accent" onClick={() => { setImportMsg({ type: '', text: '' }); setImportFile(null); setShowImportModal(true); }}>
                <UploadCloud size={16} /> Import Data
              </Btn>
            )
          ) : (
            !isViewer && (
              <Btn variant="accent" onClick={() => { setSchedMsg({ type: '', text: '' }); setScheduleDate(''); setShowScheduleModal(true); }}>
                <Calendar size={16} /> Schedule Activity
              </Btn>
            )
          )}
        </div>
      </div>

      {/* Vendor Project Scope Alert Banner */}
      {vendorProject && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: '#fff7ed',
          border: '1.5px solid #fed7aa',
          padding: '12px 18px',
          borderRadius: 12,
          marginBottom: 20,
          color: '#c2410c',
          boxShadow: '0 2px 4px rgba(249, 115, 22, 0.08)'
        }}>
          <ShieldCheck size={20} color="#ea580c" />
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#9a3412' }}>
              Assigned Project Scope Active
            </div>
            <div style={{ fontSize: 12.5, color: '#c2410c', marginTop: 2 }}>
              Your account is scoped to <strong>"{vendorProject}"</strong>. Showing monthly operations data and datasets for this assigned project only.
            </div>
          </div>
        </div>
      )}

      {/* Modern Tabs Navigation */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        <button
          onClick={() => setActiveTab('import')}
          style={{
            padding: '12px 20px',
            fontSize: 14.5,
            fontWeight: 600,
            color: activeTab === 'import' ? 'var(--accent)' : 'var(--text-muted)',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'import' ? '2.5px solid var(--accent)' : '2.5px solid transparent',
            cursor: 'pointer',
            transition: 'all 0.15s',
            outline: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}
        >
          <UploadCloud size={16} />
          Data
        </button>

      </div>

      {/* CONTENT PANEL */}
      {activeTab === 'import' ? (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-sm)',
          padding: 24
        }}>

          {filteredImports.length === 0 ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
              {vendorProject ? `No datasets found for project "${vendorProject}".` : 'No spreadsheets imported yet. Click + Import Data to get started.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                  <tr style={{ background: '#f8f9fb', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '14px 18px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', width: '25%' }}>Associated Project</th>
                    <th style={{ padding: '14px 18px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', width: '20%' }}>Records</th>
                    <th style={{ padding: '14px 18px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', width: '30%' }}>Dataset Filename</th>
                    <th style={{ padding: '14px 18px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', width: '20%' }}>Import Date</th>
                    <th style={{ padding: '14px 18px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', width: '5%' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredImports.map(imp => (
                    <tr 
                      key={imp.id} 
                      onClick={() => setSelectedDataset(imp)}
                      style={{ 
                        borderBottom: '1px solid var(--border)', 
                        cursor: 'pointer',
                        transition: 'background 0.15s ease' 
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '14px 18px', fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 600 }}>
                        {imp.project}
                      </td>
                      <td style={{ padding: '14px 18px', fontSize: 13.5, color: 'var(--text-secondary)' }}>{imp.rows} rows</td>
                      <td style={{ padding: '14px 18px', fontSize: 13.5, color: 'var(--accent)', fontWeight: 600 }}>
                        {imp.filename}
                      </td>
                      <td style={{ padding: '14px 18px', fontSize: 13.5, color: 'var(--text-muted)' }}>{imp.date}</td>
                      <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                        {!isVendor && userCanDelete && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmImport(imp);
                            }}
                            title="Delete Dataset"
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#ef4444',
                                cursor: 'pointer',
                                padding: '6px',
                                borderRadius: 6,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.15s ease'
                              }}
                              onMouseEnter={e => {
                                e.currentTarget.style.background = '#fef2f2';
                                e.currentTarget.style.color = '#dc2626';
                              }}
                              onMouseLeave={e => {
                                e.currentTarget.style.background = 'none';
                                e.currentTarget.style.color = '#ef4444';
                              }}
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 28, alignItems: 'start' }}>
          {/* Active Scheduler List */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-sm)',
            padding: 24
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>
              Active Scheduler Tasks
            </h2>

            {filteredSchedules.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                {vendorProject ? `No scheduled tasks found for project "${vendorProject}".` : 'No scheduled activities found. Click + Schedule Activity to get started.'}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8f9fb', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Action Trigger</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Project</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 140 }}>Target Date</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 100 }}>Frequency</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 110 }}>Status</th>
                      <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 100 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSchedules.map(sch => (
                      <tr key={sch.id} style={{ borderBottom: '1px solid var(--border)' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 500 }}>{sch.action}</td>
                        <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)' }}>{sch.project}</td>
                        <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-muted)' }}>{new Date(sch.datetime).toLocaleDateString()}</td>
                        <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)' }}>{sch.frequency}</td>
                        <td style={{ padding: '14px 16px', fontSize: 13 }}>
                          <span style={{
                            background: sch.status === 'Completed' ? 'var(--green-bg)' : 'var(--accent-light)',
                            color: sch.status === 'Completed' ? 'var(--green)' : 'var(--accent)',
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700
                          }}>
                            {sch.status}
                          </span>
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                            {sch.status === 'Scheduled' && (
                              <button
                                onClick={() => handleRunNow(sch.id)}
                                title="Execute immediately"
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  padding: '4px',
                                  borderRadius: 4,
                                  color: 'var(--green)',
                                  display: 'flex'
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--green-bg)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'none'}
                              >
                                <Play size={14} fill="var(--green)" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteSchedule(sch.id)}
                              title="Delete scheduler event"
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '4px',
                                borderRadius: 4,
                                color: '#dc2626',
                                display: 'flex'
                              }}
                              onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                              onMouseLeave={e => e.currentTarget.style.background = 'none'}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Timeline View Column */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-sm)',
            padding: 24
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>
              Upcoming Activity Timeline
            </h2>

            {filteredSchedules.filter(sch => sch.status === 'Scheduled').length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13.5 }}>
                No upcoming activities scheduled.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {filteredSchedules.filter(sch => sch.status === 'Scheduled').slice(0, 3).map((sch, idx, arr) => (
                  <div key={sch.id} style={{ display: 'flex', gap: 16, position: 'relative' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        background: 'var(--accent-light)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '1.5px solid var(--accent)'
                      }}>
                        <Clock size={14} color="var(--accent)" />
                      </div>
                      {idx !== arr.length - 1 && (
                        <div style={{ width: 2, flex: 1, background: 'var(--border)', marginTop: 4, minHeight: 40 }} />
                      )}
                    </div>

                    <div style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{sch.action}</span>
                        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600 }}>{sch.frequency}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)' }}>Project: {sch.project}</p>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                        Time: {new Date(sch.datetime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- IMPORT DATA MODAL --- */}
      <Modal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        title="Add Keywords"
        footer={
          <div style={{ display: 'flex', gap: 12, width: '100%' }}>
            <button
              onClick={handleUploadSubmit}
              style={{
                flex: '1 1 70%',
                background: (selectedImportProject && importFile) ? '#0f172a' : '#858c99',
                color: '#ffffff',
                border: 'none',
                borderRadius: 10,
                padding: '12px 16px',
                fontSize: 15,
                fontWeight: 700,
                cursor: (selectedImportProject && importFile) ? 'pointer' : 'default',
                transition: 'all 0.15s'
              }}
            >
              Import Data
            </button>
            <button
              onClick={() => setShowImportModal(false)}
              style={{
                flex: '0 0 28%',
                background: '#ffffff',
                color: '#0f172a',
                border: '1px solid #cbd5e1',
                borderRadius: 10,
                padding: '12px 16px',
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
            >
              Cancel
            </button>
          </div>
        }
      >
        {importMsg.text && (
          <div style={{
            background: importMsg.type === 'error' ? '#fef2f2' : 'var(--green-bg)',
            border: `1px solid ${importMsg.type === 'error' ? '#f87171' : 'var(--green)'}`,
            color: importMsg.type === 'error' ? '#dc2626' : 'var(--green)',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 13,
            fontWeight: 500
          }}>
            {importMsg.text}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Choose Project */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>Choose Project</label>
            <div style={{ position: 'relative', width: '100%' }}>
              <select
                value={selectedImportProject}
                onChange={(e) => setSelectedImportProject(e.target.value)}
                disabled={Boolean(vendorProject)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  fontSize: 13.5,
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: 8,
                  color: selectedImportProject ? '#0f172a' : '#94a3b8',
                  outline: 'none',
                  cursor: 'pointer',
                  appearance: 'none',
                  WebkitAppearance: 'none'
                }}
              >
                <option value="" disabled style={{ color: '#94a3b8' }}>Select a project</option>
                {projectList.map(p => (
                  <option key={p.slug || p.id} value={p.name || p.domain} style={{ color: '#0f172a' }}>{p.name || p.domain}</option>
                ))}
              </select>
              <ChevronDown size={16} color="#94a3b8" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid #e2e8f0', margin: '4px 0 4px' }} />

          {/* Import Keywords Header & Template Link */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>Import Keywords</span>
            {canDownload(user) && (
              <button
                type="button"
                onClick={downloadTemplateCSV}
                style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}
              >
                Download sample template
              </button>
            )}
          </div>

          {/* Drag Uploader */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              border: isDragging ? '1.5px dashed #6366f1' : '1.5px dashed #cbd5e1',
              background: isDragging ? '#e0e7ff' : '#f8fafc',
              borderRadius: 12,
              padding: '32px 16px',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s ease-in-out'
            }}
          >
            <input
              type="file"
              id="modal-import-file-picker"
              onChange={handleFileSelect}
              accept=".csv,.tsv,.xlsx,.xls,.json"
              style={{ display: 'none' }}
            />
            <label htmlFor="modal-import-file-picker" style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <Upload size={24} color="#94a3b8" style={{ strokeWidth: 1.8 }} />
              <div>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                  {importFile ? importFile.name : 'Click to upload or drag a file'}
                </span>
                <span style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.5, display: 'block', maxWidth: 440, margin: '0 auto' }}>
                  CSV, TSV, Excel
                </span>
              </div>
            </label>
          </div>
        </div>
      </Modal>

      {/* --- SCHEDULER MODAL --- */}
      <Modal
        open={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        title="Schedule SEO Activity"
        footer={<>
          <Btn variant="primary" onClick={handleScheduleSubmit}>Schedule Event</Btn>
          <Btn variant="outline" onClick={() => setShowScheduleModal(false)}>Cancel</Btn>
        </>}
      >
        {schedMsg.text && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #f87171',
            color: '#dc2626',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 13,
            fontWeight: 500
          }}>
            {schedMsg.text}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Action Trigger type */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Action Trigger *</label>
            <select
              value={scheduleAction}
              onChange={(e) => setScheduleAction(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 14px',
                fontSize: 13.5,
                background: 'var(--surface)',
                border: '1.5px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text-primary)',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="Run Backlink Audit">Run Backlink Audit</option>
              <option value="Fetch Search Console Data">Fetch Search Console Data</option>
              <option value="Trigger Outreach Emails">Trigger Outreach Emails</option>
              <option value="Request Google Indexing">Request Google Indexing</option>
            </select>
          </div>

          {/* Target Project */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Target Project *</label>
            <select
              value={selectedSchedProject}
              onChange={(e) => setSelectedSchedProject(e.target.value)}
              disabled={Boolean(vendorProject)}
              style={{
                width: '100%',
                padding: '10px 14px',
                fontSize: 13.5,
                background: 'var(--surface)',
                border: '1.5px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text-primary)',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              {projectList.map(p => (
                <option key={p.slug || p.id} value={p.name || p.domain}>{p.name || p.domain}</option>
              ))}
            </select>
          </div>

          {/* DateTime local Calendar Picker */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Date & Execution Time *</label>
            <input
              type="datetime-local"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 14px',
                fontSize: 13.5,
                background: 'var(--surface)',
                border: '1.5px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text-primary)',
                outline: 'none',
                fontFamily: 'var(--font-body)',
                cursor: 'pointer'
              }}
            />
          </div>

          {/* Frequency Pattern */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Recurrence Pattern</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {['One-Time', 'Daily', 'Weekly', 'Monthly'].map(freq => (
                <button
                  key={freq}
                  type="button"
                  onClick={() => setScheduleFreq(freq)}
                  style={{
                    flex: 1,
                    padding: '8px 4px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: '1.5px solid',
                    borderColor: scheduleFreq === freq ? 'var(--accent)' : 'var(--border)',
                    background: scheduleFreq === freq ? 'var(--accent-light)' : 'var(--surface)',
                    color: scheduleFreq === freq ? 'var(--accent)' : 'var(--text-primary)',
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  {freq}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* Delete Dataset Confirmation Modal matching screenshot */}
      <Modal
        open={!!deleteConfirmImport}
        onClose={() => setDeleteConfirmImport(null)}
        title="Confirm delete"
        footer={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', marginTop: 8 }}>
            <button
              onClick={async () => {
                if (deleteConfirmImport) {
                  await handleDeleteImport(deleteConfirmImport.id);
                  setDeleteConfirmImport(null);
                }
              }}
              style={{
                flex: 1,
                padding: '11px 20px',
                fontSize: 14,
                fontWeight: 700,
                color: '#ffffff',
                background: '#dc2626',
                border: 'none',
                borderRadius: 12,
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(220, 38, 38, 0.25)',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#b91c1c'}
              onMouseLeave={e => e.currentTarget.style.background = '#dc2626'}
            >
              Delete
            </button>
            <button
              onClick={() => setDeleteConfirmImport(null)}
              style={{
                padding: '11px 24px',
                fontSize: 14,
                fontWeight: 700,
                color: '#0f172a',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: 12,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
              onMouseLeave={e => e.currentTarget.style.background = '#ffffff'}
            >
              Cancel
            </button>
          </div>
        }
      >
        <div style={{ padding: '8px 0 16px 0' }}>
          <p style={{ fontSize: 14.5, color: '#64748b', margin: 0, lineHeight: 1.6 }}>
            Are you sure you want to delete <strong>this project's Off-Page data (records, scheduled activities)</strong> for <strong>{deleteConfirmImport?.project}</strong>? This action cannot be undone.
f          </p>
        </div>
      </Modal>
      {/* Unsaved Changes Confirmation Modal */}
      <Modal
        open={showUnsavedModal}
        onClose={() => {
          setShowUnsavedModal(false);
          setPendingLeaveAction(null);
        }}
        title="Unsaved Changes"
        footer={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, width: '100%', marginTop: 8 }}>
            <button
              onClick={() => {
                setShowUnsavedModal(false);
                setPendingLeaveAction(null);
              }}
              style={{
                padding: '10px 18px',
                fontSize: 13.5,
                fontWeight: 600,
                color: '#475569',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: 10,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                setShowUnsavedModal(false);
                try {
                  const freshImports = await fetchMonthlyImportsApi();
                  setImports(freshImports);
                } catch (e) {
                  console.warn(e);
                }
                setIsDirty(false);
                setSavingState('');
                if (pendingLeaveAction) pendingLeaveAction();
                setPendingLeaveAction(null);
              }}
              style={{
                padding: '10px 18px',
                fontSize: 13.5,
                fontWeight: 700,
                color: '#b91c1c',
                background: '#fef2f2',
                border: '1px solid #fca5a5',
                borderRadius: 10,
                cursor: 'pointer'
              }}
            >
              No, Discard Changes
            </button>
            <button
              onClick={async () => {
                setShowUnsavedModal(false);
                try {
                  await handleSaveChanges();
                } catch (e) {
                  console.error(e);
                }
                if (pendingLeaveAction) pendingLeaveAction();
                setPendingLeaveAction(null);
              }}
              style={{
                padding: '10px 20px',
                fontSize: 13.5,
                fontWeight: 700,
                color: '#ffffff',
                background: '#0f172a',
                border: 'none',
                borderRadius: 10,
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(15,23,42,0.2)'
              }}
            >
              Yes, Save Changes
            </button>
          </div>
        }
      >
        <div style={{ padding: '8px 0 12px 0' }}>
         
          <p style={{ fontSize: 13.5, color: '#64748b', margin: 0, lineHeight: 0.1 }}>
            Would you like to save your changes to the database before leaving?
          </p>
        </div>
      </Modal>
      {/* Audit Allocation Success Modal */}
      <Modal
        open={!!auditSuccessMsg}
        onClose={() => setAuditSuccessMsg('')}
        title="Audit Allocation"
        footer={null}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '10px 0' }}>
          <div style={{
            width: 42,
            height: 42,
            borderRadius: '50%',
            background: '#dcfce7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <CheckCircle size={22} color="#16a34a" />
          </div>
          <div>
            <h4 style={{ margin: '0 0 6px 0', fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
              Allocation Completed
            </h4>
            <p style={{ margin: 0, fontSize: 13.5, color: '#64748b', lineHeight: 1.5 }}>
              {auditSuccessMsg}
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
