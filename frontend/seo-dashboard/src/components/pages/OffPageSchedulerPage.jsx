import { useState, useEffect, useRef } from 'react';
import { Calendar, UploadCloud, Clock, Trash2, Play, CheckCircle, AlertCircle, FileSpreadsheet, X, Upload, ChevronDown, Filter, Pencil, Save } from 'lucide-react';
import { 
  fetchDomainRows, 
  fetchMonthlyImportsApi, 
  createMonthlyImportApi, 
  updateMonthlyImportApi, 
  deleteMonthlyImportApi, 
  fetchScheduledActivitiesApi, 
  createScheduledActivityApi, 
  deleteScheduledActivityApi 
} from '../../lib/projectsApi';

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
    outline: { background: '#fff', color: '#0f1523', border: '1.5px solid #d1d5db' },
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
    updatedDate: findVal(['updateddate', 'updated']),
    lastActivity: findVal(['lastactivity', 'activity'])
  };
}

export default function OffPageSchedulerPage() {
  const [activeTab, setActiveTab] = useState('import'); // 'import' or 'scheduler'
  
  // Modals & Details Visibility
  const [showImportModal, setShowImportModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedDataset, setSelectedDataset] = useState(null);
  const [datasetSearch, setDatasetSearch] = useState('');
  const [filterActivity, setFilterActivity] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [showFilterPopover, setShowFilterPopover] = useState(false);
  const [showActionsDropdown, setShowActionsDropdown] = useState(false);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkEditActivity, setBulkEditActivity] = useState('');
  const [bulkEditStatus, setBulkEditStatus] = useState('');
  const [selectedRowIndices, setSelectedRowIndices] = useState([]);
  const [dbProjects, setDbProjects] = useState([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [savingState, setSavingState] = useState(''); // '', 'saving', 'saved', 'error'

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

  const projectList = (dbProjects.length > 0 ? dbProjects : mockProjects).filter(p => p.status !== 'Inactive' && p.isActive !== false);

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

  // Load monthly operations data from DB on mount
  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        const [dbImports, dbSchedules] = await Promise.all([
          fetchMonthlyImportsApi().catch(() => null),
          fetchScheduledActivitiesApi().catch(() => null)
        ]);
        if (isMounted) {
          if (dbImports && dbImports.length > 0) setImports(dbImports);
          if (dbSchedules && dbSchedules.length > 0) setSchedules(dbSchedules);
        }
      } catch (err) {
        console.warn('[OffPageSchedulerPage] Failed to load DB monthly operations:', err);
      }
    }
    loadData();
    return () => { isMounted = false; };
  }, []);

  // Persist local backup
  useEffect(() => {
    localStorage.setItem('seo_imported_datasets', JSON.stringify(imports));
  }, [imports]);

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
    if (!['csv', 'json'].includes(ext)) {
      setImportMsg({ type: 'error', text: 'Unsupported format. Please upload CSV or JSON data.' });
      setImportFile(null);
      return;
    }
    setImportFile(file);
  };

  // CSV/JSON File Parser & DB Sync
  const handleUploadSubmit = async () => {
    if (!importFile) {
      setImportMsg({ type: 'error', text: 'Please choose or drag a file to import.' });
      return;
    }

    try {
      const text = await importFile.text();
      let rowsData = [];
      const filenameLower = importFile.name.toLowerCase();

      if (filenameLower.endsWith('.json')) {
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        rowsData = list.map(item => normalizeRow(item));
      } else {
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
      'Content Doc', 'Status', 'Publisher', 'PG Site Domain', 
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

    const chosenTime = new Date(scheduleDate).getTime();
    if (chosenTime < Date.now()) {
      setSchedMsg({ type: 'error', text: 'Cannot schedule events in the past. Choose an upcoming date.' });
      return;
    }

    const newSchedule = {
      id: Date.now(),
      action: scheduleAction,
      project: selectedSchedProject,
      datetime: scheduleDate,
      frequency: scheduleFreq,
      status: 'Scheduled'
    };

    // Sync to DB
    createScheduledActivityApi(newSchedule).then(res => {
      if (res && res.id) {
        setSchedules(current => current.map(item => item.id === newSchedule.id ? { ...item, id: res.id } : item));
      }
    }).catch(err => console.warn('Failed to create schedule in DB:', err));

    const updated = [...schedules, newSchedule].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    setSchedules(updated);
    setScheduleDate('');
    setSchedMsg({ type: '', text: '' });
    setShowScheduleModal(false);
  };

  const handleDeleteSchedule = (id) => {
    setSchedules(schedules.filter(sch => sch.id !== id));
    deleteScheduledActivityApi(id).catch(err => console.warn('Failed to delete schedule from DB:', err));
  };

  const handleRunNow = (id) => {
    setSchedules(schedules.map(sch => {
      if (sch.id === id) {
        return { ...sch, status: 'Completed' };
      }
      return sch;
    }));
  };

  const handleRowChange = (datasetId, rowIndex, field, value) => {
    let updatedRows = [];
    setImports(prevImports => 
      prevImports.map(imp => {
        if (imp.id !== datasetId) return imp;
        const newRowsData = [...imp.rowsData];
        newRowsData[rowIndex] = { ...newRowsData[rowIndex], [field]: value };
        updatedRows = newRowsData;
        return { ...imp, rowsData: newRowsData };
      })
    );
    if (selectedDataset && selectedDataset.id === datasetId) {
      setSelectedDataset(prev => {
        const newRowsData = [...prev.rowsData];
        newRowsData[rowIndex] = { ...newRowsData[rowIndex], [field]: value };
        return { ...prev, rowsData: newRowsData };
      });
    }
    setHasUnsavedChanges(true);
    setSavingState('');
    // Sync row edit to backend DB
    if (datasetId && typeof datasetId === 'number' && datasetId < 1000000000000) {
      updateMonthlyImportApi(datasetId, { 
        project: selectedDataset?.project || selectedDataset?.project_name,
        filename: selectedDataset?.filename,
        rowsData: updatedRows 
      }).catch(err => console.warn('Failed to save row update to DB:', err));
    }
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
    setHasUnsavedChanges(true);
    setSavingState('');

    updateMonthlyImportApi(datasetId, { 
      project: selectedDataset?.project || selectedDataset?.project_name,
      filename: selectedDataset?.filename,
      rows: remainingRows.length, 
      rowsData: remainingRows 
    }).catch(err => console.warn('Failed to save bulk delete to DB:', err));
  };

  const handleBulkEditField = (field, value) => {
    if (!selectedDataset || selectedRowIndices.length === 0 || !value) return;

    const currentRows = selectedDataset.rowsData || [];
    const updatedRows = currentRows.map((r, idx) => {
      if (selectedRowIndices.includes(idx)) {
        return { ...r, [field]: value };
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
    setHasUnsavedChanges(true);
    setSavingState('');

    updateMonthlyImportApi(datasetId, { 
      project: selectedDataset?.project || selectedDataset?.project_name,
      filename: selectedDataset?.filename,
      rowsData: updatedRows 
    }).catch(err => console.warn('Failed to save bulk edit to DB:', err));
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
      setHasUnsavedChanges(false);
      setSavingState('saved');
      setTimeout(() => setSavingState(''), 3500);
    } catch (err) {
      console.error('Failed to save changes DB:', err);
      setSavingState('error');
    }
  };

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
        (r.contentSpoc || '').toLowerCase().includes(datasetSearch.toLowerCase());

      const matchActivity = filterActivity === 'ALL' || (r.activityName || '') === filterActivity;
      const matchStatus = filterStatus === 'ALL' || (r.status || '') === filterStatus;

      return matchSearch && matchActivity && matchStatus;
    });

    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* Back Link */}
        <div style={{ marginBottom: 16 }}>
          <button 
            onClick={() => { 
              setSelectedDataset(null); 
              setDatasetSearch(''); 
              setFilterActivity('ALL');
              setFilterStatus('ALL');
              setShowFilterPopover(false);
              setSelectedRowIndices([]);
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
            ← Back to Import Logs
          </button>
        </div>

        {/* Header Title info & Save Changes Button */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
              {selectedDataset.filename}
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: 0 }}>
              Associated Project: <strong>{selectedDataset.project}</strong> · Total Rows: <strong>{rows.length}</strong> · Imported on {selectedDataset.date}
            </p>
          </div>

          {/* Save Changes Button with Supabase Sync */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {hasUnsavedChanges && (
              <span style={{ fontSize: 12.5, fontWeight: 600, color: '#d97706', background: '#fef3c7', padding: '5px 12px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #fde68a' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#d97706' }} /> Unsaved changes
              </span>
            )}
            
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
              placeholder="Search keywords, landing pages, publishers..."
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
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  border: (filterActivity !== 'ALL' || filterStatus !== 'ALL') ? '1.5px solid var(--accent)' : '1.5px solid #cbd5e1',
                  background: (filterActivity !== 'ALL' || filterStatus !== 'ALL') ? '#eff6ff' : '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  transition: 'all 0.15s ease',
                  position: 'relative'
                }}
                onMouseEnter={e => {
                  if (filterActivity === 'ALL' && filterStatus === 'ALL') {
                    e.currentTarget.style.background = '#f8fafc';
                    e.currentTarget.style.borderColor = '#94a3b8';
                  }
                }}
                onMouseLeave={e => {
                  if (filterActivity === 'ALL' && filterStatus === 'ALL') {
                    e.currentTarget.style.background = '#ffffff';
                    e.currentTarget.style.borderColor = '#cbd5e1';
                  }
                }}
              >
                <Filter size={18} color={(filterActivity !== 'ALL' || filterStatus !== 'ALL') ? 'var(--accent)' : '#64748b'} style={{ strokeWidth: 1.8 }} />
                
                {/* Active filter dot indicator */}
                {(filterActivity !== 'ALL' || filterStatus !== 'ALL') && (
                  <span style={{
                    position: 'absolute',
                    top: -3,
                    right: -3,
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    border: '1.5px solid #ffffff'
                  }} />
                )}
              </button>

              {/* Popover Options Menu */}
              {showFilterPopover && (
                <div style={{
                  position: 'absolute',
                  top: 46,
                  left: 0,
                  zIndex: 100,
                  width: 250,
                  background: '#ffffff',
                  borderRadius: 12,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.05)',
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Filter size={14} color="#64748b" /> Filter
                    </span>
                    {(filterActivity !== 'ALL' || filterStatus !== 'ALL') && (
                      <button
                        onClick={() => { setFilterActivity('ALL'); setFilterStatus('ALL'); }}
                        style={{ border: 'none', background: 'none', color: 'var(--accent)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}
                      >
                        Reset
                      </button>
                    )}
                  </div>

                  {/* Filter by Activity Name */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Activity Name</label>
                    <select
                      value={filterActivity}
                      onChange={(e) => setFilterActivity(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        fontSize: 12.5,
                        fontWeight: 600,
                        borderRadius: 8,
                        border: '1.5px solid #cbd5e1',
                        background: '#ffffff',
                        color: '#0f172a',
                        outline: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="ALL">All Activities</option>
                      <option value="Forum Quora">Forum Quora</option>
                      <option value="Forum Reddit">Forum Reddit</option>
                      <option value="Paid Guest Post">Paid Guest Post</option>
                      <option value="Business Listing">Business Listing</option>
                      <option value="Brand Mention">Brand Mention</option>
                    </select>
                  </div>

                  {/* Filter by Status */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Status</label>
                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        fontSize: 12.5,
                        fontWeight: 600,
                        borderRadius: 8,
                        border: '1.5px solid #cbd5e1',
                        background: '#ffffff',
                        color: '#0f172a',
                        outline: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="ALL">All Statuses</option>
                      <option value="Audited-LQ">Audited-LQ</option>
                      <option value="Audited-Indexed">Audited-Indexed</option>
                      <option value="Published-Indexed">Published-Indexed</option>
                      <option value="Published Non-Indexed">Published Non-Indexed</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Actions Button & Dropdown matching screenshot */}
          {selectedRowIndices.length > 0 ? (
            <div ref={actionsRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setShowActionsDropdown(!showActionsDropdown)}
                style={{
                  background: '#0f172a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 14,
                  padding: '9px 18px',
                  fontSize: 13.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.18)',
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
          <div style={{ overflowX: 'auto', maxHeight: '60vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 2600 }}>
              <thead>
                <tr style={{ background: '#f8f9fb', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 10 }}>
                  <th style={{ padding: '12px 16px', width: 44, textAlign: 'center' }}>
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
                      style={{ cursor: 'pointer', width: 16, height: 16, accentColor: 'var(--accent)' }}
                    />
                  </th>
                  {[
                    'UID', 'Period', 'Scheduled Date', 'Keyword 1', 'Keyword 2', 'Cluster', 
                    'KW Category', 'Activity Name', 'Word Count', 'Content SPOC', 'Topic', 
                    'Content Doc', 'Status', 'Publisher', 'PG Site Domain', 
                    'Live Link', 'Remarks', 'Solution', 'Last Activity', 'Updated Date'
                  ].map((col, idx) => (
                    <th key={idx} style={{ 
                      padding: '12px 16px', 
                      textAlign: 'left', 
                      fontSize: 12, 
                      fontWeight: 700, 
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={21} style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                      No matching records found in this dataset.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, rIdx) => (
                    <tr key={rIdx} style={{ borderBottom: '1px solid var(--border)', background: selectedRowIndices.includes(rIdx) ? '#f0f9ff' : 'transparent' }}
                      onMouseEnter={e => e.currentTarget.style.background = selectedRowIndices.includes(rIdx) ? '#e0f2fe' : '#fafbfc'}
                      onMouseLeave={e => e.currentTarget.style.background = selectedRowIndices.includes(rIdx) ? '#f0f9ff' : 'transparent'}>
                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
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
                          style={{ cursor: 'pointer', width: 16, height: 16, accentColor: 'var(--accent)' }}
                        />
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12.5, fontFamily: 'monospace', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {row.uid || `MO-${(rIdx + 1).toString().padStart(4, '0')}`}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{row.period || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.scheduledDate || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: '#2563eb', fontWeight: 600, whiteSpace: 'nowrap' }}>
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
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.keyword2 || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.cluster || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.kwCategory || 'N/A'}</td>
                      <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
                        <select
                          value={['Forum Quora', 'Forum Reddit', 'Paid Guest Post', 'Business Listing', 'Brand Mention'].includes(row.activityName) ? row.activityName : 'Forum Quora'}
                          onChange={(e) => handleRowChange(selectedDataset.id, rIdx, 'activityName', e.target.value)}
                          style={{
                            padding: '5px 10px',
                            fontSize: 12.5,
                            fontWeight: 600,
                            borderRadius: 6,
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#0f172a',
                            outline: 'none',
                            cursor: 'pointer'
                          }}
                        >
                          {['Forum Quora', 'Forum Reddit', 'Paid Guest Post', 'Business Listing', 'Brand Mention'].map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.wordCount || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.contentSpoc || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.topic}>
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
                      <td style={{ padding: '14px 16px', fontSize: 13.5, whiteSpace: 'nowrap' }}>
                        {row.contentDoc ? (
                          <a href={formatUrl(row.contentDoc)} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                            Google Doc ↗
                          </a>
                        ) : 'N/A'}
                      </td>
                      <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
                        <select
                          value={['Audited-LQ', 'Audited-Indexed', 'Published-Indexed', 'Published Non-Indexed'].includes(row.status) ? row.status : 'Published-Indexed'}
                          onChange={(e) => handleRowChange(selectedDataset.id, rIdx, 'status', e.target.value)}
                          style={{
                            padding: '5px 10px',
                            fontSize: 12,
                            fontWeight: 700,
                            borderRadius: 6,
                            border: '1px solid #cbd5e1',
                            background: row.status === 'Published-Indexed' ? '#ecfdf5' : row.status === 'Audited-Indexed' ? '#eff6ff' : row.status === 'Audited-LQ' ? '#fef2f2' : '#fff7ed',
                            color: row.status === 'Published-Indexed' ? '#047857' : row.status === 'Audited-Indexed' ? '#1d4ed8' : row.status === 'Audited-LQ' ? '#b91c1c' : '#c2410c',
                            outline: 'none',
                            cursor: 'pointer'
                          }}
                        >
                          {['Audited-LQ', 'Audited-Indexed', 'Published-Indexed', 'Published Non-Indexed'].map(opt => (
                            <option key={opt} value={opt} style={{ background: '#fff', color: '#0f172a', fontWeight: 500 }}>{opt}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.publisher || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: '#2563eb', whiteSpace: 'nowrap' }} title={row.pgSiteDomain}>
                        {row.pgSiteDomain ? (
                          <a href={formatUrl(row.pgSiteDomain)} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                            {formatTruncatedDomain(row.pgSiteDomain, 15)} ↗
                          </a>
                        ) : 'N/A'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, whiteSpace: 'nowrap' }}>
                        {row.liveLink ? (
                          <a href={formatUrl(row.liveLink)} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                            View Link ↗
                          </a>
                        ) : 'N/A'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.remarks}>{row.remarks || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.solution || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.lastActivity || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{row.updatedDate || 'N/A'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Bulk Edit Modal */}
        <Modal
          open={showBulkEditModal}
          onClose={() => setShowBulkEditModal(false)}
          title={`Bulk Edit ${selectedRowIndices.length} Selected Rows`}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => setShowBulkEditModal(false)}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (bulkEditActivity) handleBulkEditField('activityName', bulkEditActivity);
                  if (bulkEditStatus) handleBulkEditField('status', bulkEditStatus);
                  setShowBulkEditModal(false);
                  setBulkEditActivity('');
                  setBulkEditStatus('');
                }}
                style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}
              >
                Apply Changes
              </button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '10px 0' }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              Select fields to update across all <strong>{selectedRowIndices.length}</strong> selected rows:
            </p>

            {/* Activity Name */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>Activity Name</label>
              <select
                value={bulkEditActivity}
                onChange={(e) => setBulkEditActivity(e.target.value)}
                style={{ padding: '9px 12px', fontSize: 13, borderRadius: 8, border: '1.5px solid var(--border)', outline: 'none' }}
              >
                <option value="">-- No Change --</option>
                <option value="Forum Quora">Forum Quora</option>
                <option value="Forum Reddit">Forum Reddit</option>
                <option value="Paid Guest Post">Paid Guest Post</option>
                <option value="Business Listing">Business Listing</option>
                <option value="Brand Mention">Brand Mention</option>
              </select>
            </div>

            {/* Status */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>Status</label>
              <select
                value={bulkEditStatus}
                onChange={(e) => setBulkEditStatus(e.target.value)}
                style={{ padding: '9px 12px', fontSize: 13, borderRadius: 8, border: '1.5px solid var(--border)', outline: 'none' }}
              >
                <option value="">-- No Change --</option>
                <option value="Audited-LQ">Audited-LQ</option>
                <option value="Audited-Indexed">Audited-Indexed</option>
                <option value="Published-Indexed">Published-Indexed</option>
                <option value="Published Non-Indexed">Published Non-Indexed</option>
              </select>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header Panel with Title & Top-Right Button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
            Monthly Operations
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>
            Automate audits, import data sheets, and schedule link outreach actions.
          </p>
        </div>
        
        {activeTab === 'import' ? (
          <Btn variant="accent" onClick={() => { setImportMsg({ type: '', text: '' }); setImportFile(null); setShowImportModal(true); }}>
            <UploadCloud size={16} /> Import Data
          </Btn>
        ) : (
          <Btn variant="accent" onClick={() => { setSchedMsg({ type: '', text: '' }); setScheduleDate(''); setShowScheduleModal(true); }}>
            <Calendar size={16} /> Schedule Activity
          </Btn>
        )}
      </div>

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
        <button
          onClick={() => setActiveTab('scheduler')}
          style={{
            padding: '12px 20px',
            fontSize: 14.5,
            fontWeight: 600,
            color: activeTab === 'scheduler' ? 'var(--accent)' : 'var(--text-muted)',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'scheduler' ? '2.5px solid var(--accent)' : '2.5px solid transparent',
            cursor: 'pointer',
            transition: 'all 0.15s',
            outline: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}
        >
          <Calendar size={16} />
          Scheduler Calendar
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
          {imports.length === 0 ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
              No spreadsheets imported yet. Click <strong>+ Import Data</strong> to get started.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8f9fb', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Dataset Filename</th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Associated Project</th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 120 }}>Records</th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 180 }}>Import Date</th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 120 }}>Status</th>
                    <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 100 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map(imp => (
                    <tr key={imp.id} style={{ borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 500 }}>
                        <button
                          onClick={() => setSelectedDataset(imp)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--accent)',
                            fontWeight: 600,
                            cursor: 'pointer',
                            padding: 0,
                            textAlign: 'left'
                          }}
                          onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                          onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                        >
                          {imp.filename}
                        </button>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)' }}>{imp.project}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)' }}>{imp.rows} rows</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-muted)' }}>{imp.date}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13 }}>
                        <span style={{
                          background: 'var(--green-bg)',
                          color: 'var(--green)',
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: 11.5,
                          fontWeight: 600
                        }}>
                          {imp.status}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <button
                          onClick={() => handleDeleteImport(imp.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#dc2626',
                            fontSize: 12.5,
                            fontWeight: 600,
                            cursor: 'pointer',
                            padding: '4px 8px',
                            borderRadius: 4
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        >
                          Delete
                        </button>
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

            {schedules.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                No scheduled activities found. Click <strong>+ Schedule Activity</strong> to get started.
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
                    {schedules.map(sch => (
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

            {schedules.filter(sch => sch.status === 'Scheduled').length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13.5 }}>
                No upcoming activities scheduled.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {schedules.filter(sch => sch.status === 'Scheduled').slice(0, 3).map((sch, idx, arr) => (
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
              Import Keywords
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
            <button
              type="button"
              onClick={downloadTemplateCSV}
              style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}
            >
              Download sample template
            </button>
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
    </div>
  );
}
