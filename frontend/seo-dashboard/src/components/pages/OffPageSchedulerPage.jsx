import { useState, useEffect } from 'react';
import { Calendar, UploadCloud, Clock, Trash2, Play, CheckCircle, AlertCircle, FileSpreadsheet, X, Eye } from 'lucide-react';
import { isReadOnlyUser, canRunActions } from '../../lib/permissions';

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
          <div style={{ padding: '16px 28px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'flex-end', gap: 10, borderRadius: '0 0 16px 16px' }}>
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
function normalizeRow(item) {
  const findVal = (keys) => {
    for (const key of keys) {
      const matchKey = Object.keys(item).find(k => k.toLowerCase().replace(/[\s_\-]/g, '') === key.toLowerCase().replace(/[\s_\-]/g, ''));
      if (matchKey && item[matchKey] !== undefined && String(item[matchKey]).trim() !== '') {
        return String(item[matchKey]).trim();
      }
    }
    return '';
  };

  return {
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

export default function OffPageSchedulerPage({ user }) {
  const isReadOnly = isReadOnlyUser(user);
  const userCanRunActions = canRunActions(user);
  const isVendor = user?.role?.toUpperCase() === 'VENDOR' || isReadOnly;
  const [activeTab, setActiveTab] = useState('import'); // 'import' or 'scheduler'

  useEffect(() => {
    if (!userCanRunActions && activeTab !== 'import') {
      setActiveTab('import');
    }
  }, [userCanRunActions, activeTab]);

  // Modals & Details Visibility
  const [showImportModal, setShowImportModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedDataset, setSelectedDataset] = useState(null);
  const [datasetSearch, setDatasetSearch] = useState('');

  // Default mock projects
  const mockProjects = [
    { slug: 'owis', name: 'One World International School', domain: 'owis.org' },
    { slug: 'sais', name: 'Stamford American', domain: 'sais.edu.sg' },
    { slug: 'testing308', name: 'testing308', domain: 'testing308.com' }
  ];

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
          activityName: 'Backlink Outreach',
          wordCount: 1200,
          contentSpoc: 'Sarah Chen',
          topic: 'Best International Schools in SG',
          contentDoc: 'https://docs.google.com/document/d/mock-1',
          status: 'Live',
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
          activityName: 'Guest Blogging',
          wordCount: 1400,
          contentSpoc: 'John Doe',
          topic: 'Academics & Secondary Education in SG',
          contentDoc: 'https://docs.google.com/document/d/mock-2',
          status: 'Live',
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
          activityName: 'Directory Submission',
          wordCount: 950,
          contentSpoc: 'Alice Wong',
          topic: 'Primary School Options for Expats',
          contentDoc: 'https://docs.google.com/document/d/mock-3',
          status: 'In Progress',
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
    } catch (e) { }
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
    } catch (e) { }
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

  // Persist states
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

  // CSV/JSON File Parser
  const handleUploadSubmit = () => {
    if (!importFile) {
      setImportMsg({ type: 'error', text: 'Please choose or drag a file to import.' });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
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

        const newImport = {
          id: Date.now(),
          filename: importFile.name,
          project: selectedImportProject,
          rows: rowsData.length,
          date: formattedDate,
          status: 'Success',
          rowsData: rowsData
        };

        setImports([newImport, ...imports]);
        setImportFile(null);
        setImportMsg({ type: '', text: '' });
        setShowImportModal(false);
      } catch (err) {
        setImportMsg({ type: 'error', text: `Failed to parse file: ${err.message}` });
      }
    };
    reader.readAsText(importFile);
  };

  // CSV Template download utility
  const downloadTemplateCSV = () => {
    const headers = [
      'Period', 'Scheduled Date', 'Keyword 1', 'Landing Page', 'Cluster',
      'KW Category', 'Activity Name', 'Word Count', 'Content SPOC', 'Topic',
      'Content Doc', 'Status', 'Publisher', 'PG Site Domain', 'Domain Utilization for KW',
      'Live Link', 'Remarks', 'Solution', 'Keyword 2', 'Updated Date', 'Last Activity'
    ];
    // Example row containing empty fields to show N/A
    const row1 = [
      'Q3 2026', '2026-08-10', 'school fees', '/fees', 'Fees',
      'Commercial', 'Outreach', '1200', 'Sarah Chen', 'SG School Fees Guide',
      'https://docs.google.com/document/d/1', 'Live', 'SgSchoolFinder', 'sgschoolfinder.com', '15%',
      '', 'Secured high DA link', 'Editorial Placement', 'education cost', '2026-08-04', 'Link validated'
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

    const updated = [...schedules, newSchedule].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    setSchedules(updated);
    setScheduleDate('');
    setSchedMsg({ type: '', text: '' });
    setShowScheduleModal(false);
  };

  const handleDeleteSchedule = (id) => {
    setSchedules(schedules.filter(sch => sch.id !== id));
  };

  const handleRunNow = (id) => {
    setSchedules(schedules.map(sch => {
      if (sch.id === id) {
        return { ...sch, status: 'Completed' };
      }
      return sch;
    }));
  };

  // --- Render Dataset Detail full page ---
  if (selectedDataset) {
    const rows = selectedDataset.rowsData || [];
    const filteredRows = rows.filter(r =>
      (r.keyword1 || '').toLowerCase().includes(datasetSearch.toLowerCase()) ||
      (r.landingPage || '').toLowerCase().includes(datasetSearch.toLowerCase()) ||
      (r.publisher || '').toLowerCase().includes(datasetSearch.toLowerCase())
    );

    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* Back Link */}
        <div style={{ marginBottom: 16 }}>
          <button
            onClick={() => { setSelectedDataset(null); setDatasetSearch(''); }}
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

        {/* Header Title info */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
              {selectedDataset.filename}
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: 0 }}>
              Associated Project: <strong>{selectedDataset.project}</strong> · Total Rows: <strong>{rows.length}</strong> · Imported on {selectedDataset.date}
            </p>
          </div>

          <Btn variant="outline" onClick={() => alert('Exporting dataset records as CSV...')} style={{ fontSize: 13, padding: '8px 16px' }}>
            Export CSV
          </Btn>
        </div>

        {/* Search bar */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderBottom: 'none',
          borderTopLeftRadius: 'var(--radius)',
          borderTopRightRadius: 'var(--radius)',
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <input
            type="text"
            placeholder="Search keywords, landing pages, publishers..."
            value={datasetSearch}
            onChange={(e) => setDatasetSearch(e.target.value)}
            style={{
              width: 320,
              padding: '8px 12px',
              fontSize: 13.5,
              background: 'var(--surface-2)',
              border: '1.5px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text-primary)',
              outline: 'none'
            }}
          />
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            Showing {filteredRows.length} of {rows.length} records
          </span>
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
                  {[
                    'Period', 'Scheduled Date', 'Keyword 1', 'Landing Page', 'Cluster',
                    'KW Category', 'Activity Name', 'Word Count', 'Content SPOC', 'Topic',
                    'Content Doc', 'Status', 'Publisher', 'PG Site Domain', 'Domain Utilization for KW',
                    'Live Link', 'Remarks', 'Solution', 'Keyword 2', 'Updated Date', 'Last Activity'
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
                    <tr key={rIdx} style={{ borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{row.period || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.scheduledDate || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.keyword1 || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{row.landingPage || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.cluster || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.kwCategory || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.activityName || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.wordCount || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.contentSpoc || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-primary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.topic}>{row.topic || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, whiteSpace: 'nowrap' }}>
                        {row.contentDoc ? (
                          <a href={row.contentDoc} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}
                            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                            Google Doc ↗
                          </a>
                        ) : 'N/A'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13, whiteSpace: 'nowrap' }}>
                        <span style={{
                          background: row.status === 'Live' ? 'var(--green-bg)' : '#fef3c7',
                          color: row.status === 'Live' ? 'var(--green)' : '#d97706',
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: 11.5,
                          fontWeight: 700
                        }}>
                          {row.status || 'N/A'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.publisher || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.pgSiteDomain || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.domainUtilizationForKw || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, whiteSpace: 'nowrap' }}>
                        {row.liveLink ? (
                          <a href={row.liveLink} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}
                            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                            View Link ↗
                          </a>
                        ) : 'N/A'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.remarks}>{row.remarks || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.solution || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'nowrap' }}>{row.keyword2 || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{row.updatedDate || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.lastActivity || 'N/A'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Vendor Read-Only Notice Banner */}
      {isVendor && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          background: '#eff6ff',
          color: '#1e40af',
          border: '1px solid #bfdbfe',
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 20
        }}>
          <Eye size={18} />
          <span>Vendor Access Mode: You have read-only access to view Monthly Operations. Action and edit permissions are disabled.</span>
        </div>
      )}

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

        {userCanRunActions && (
          activeTab === 'import' ? (
            <Btn variant="accent" onClick={() => { setImportMsg({ type: '', text: '' }); setImportFile(null); setShowImportModal(true); }}>
              <UploadCloud size={16} /> Import Data
            </Btn>
          ) : (
            <Btn variant="accent" onClick={() => { setSchedMsg({ type: '', text: '' }); setScheduleDate(''); setShowScheduleModal(true); }}>
              <Calendar size={16} /> Schedule Activity
            </Btn>
          )
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
          Import Data
        </button>
        {userCanRunActions && (
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
        )}
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
                        {!isVendor ? (
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
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>View Only</span>
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
                          {!isVendor ? (
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              {sch.status === 'Scheduled' && (
                                <button
                                  onClick={() => handleRunNow(sch.id)}
                                  title="Run now manually"
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
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>View Only</span>
                          )}
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
        title="Import Dataset"
        footer={<>
          <Btn variant="outline" onClick={downloadTemplateCSV} style={{ marginRight: 'auto' }}>Download CSV Template</Btn>
          <Btn variant="primary" onClick={handleUploadSubmit}>Confirm Import</Btn>
          <Btn variant="outline" onClick={() => setShowImportModal(false)}>Cancel</Btn>
        </>}
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
          {/* Target Project */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              Associate with Target Project *
            </label>
            <select
              value={selectedImportProject}
              onChange={(e) => setSelectedImportProject(e.target.value)}
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
              {mockProjects.map(p => (
                <option key={p.slug} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Drag Uploader */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              Upload Spreadsheet File *
            </label>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{
                border: isDragging ? '2px dashed var(--accent)' : '2px dashed var(--border)',
                background: isDragging ? 'var(--accent-light)' : 'var(--surface-2)',
                borderRadius: 12,
                padding: '30px 16px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease-in-out'
              }}
            >
              <input
                type="file"
                id="modal-import-file-picker"
                onChange={handleFileSelect}
                accept=".csv,.json"
                style={{ display: 'none' }}
              />
              <label htmlFor="modal-import-file-picker" style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', border: '1px solid var(--border)' }}>
                  <FileSpreadsheet size={20} color="var(--accent)" />
                </div>
                <div>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', display: 'block' }}>
                    {importFile ? importFile.name : 'Click to choose file or drag it here'}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    Supports CSV or JSON templates (values mapped dynamically)
                  </span>
                </div>
              </label>
            </div>
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
              {mockProjects.map(p => (
                <option key={p.slug} value={p.name}>{p.name}</option>
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
