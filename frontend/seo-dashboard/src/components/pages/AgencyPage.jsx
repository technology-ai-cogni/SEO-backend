import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Upload,
  FileText,
  FileSpreadsheet,
  Trash2,
  Edit3,
  X,
  ChevronRight,
  ChevronDown,
  Building,
  ExternalLink,
  Receipt,
  CornerDownRight
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

// Reusable PDF Upload Dropzone Box Component
function PdfUploadBox({ label, fileName, onFileSelect, onRemove }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
        {label}
      </label>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        style={{ display: 'none' }}
        onChange={e => {
          if (e.target.files && e.target.files[0]) {
            onFileSelect(e.target.files[0]);
          }
        }}
      />

      {fileName ? (
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderRadius: 10,
          border: '1.5px solid #10b981',
          background: '#ecfdf5',
          gap: 8,
          transition: 'all 0.15s ease'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flex: 1, minWidth: 0 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
              <FileText size={15} color="#059669" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                display: 'block',
                fontSize: 11.5,
                fontWeight: 700,
                color: '#065f46',
                wordBreak: 'break-all',
                overflowWrap: 'anywhere',
                lineHeight: 1.35
              }}>
                {fileName}
              </span>
              <span style={{ fontSize: 10.5, color: '#047857', fontWeight: 600, display: 'block', marginTop: 2 }}>
                ✓ PDF Loaded
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onRemove}
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              border: 'none',
              background: '#fecdd3',
              color: '#be123c',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              flexShrink: 0,
              marginLeft: 4,
              marginTop: 1
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <div
          onClick={() => inputRef.current && inputRef.current.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
          onDrop={e => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
              onFileSelect(e.dataTransfer.files[0]);
            }
          }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px 12px',
            borderRadius: 10,
            border: dragOver ? '2px dashed #4f46e5' : '1.5px dashed #cbd5e1',
            background: dragOver ? '#eef2ff' : '#f8fafc',
            cursor: 'pointer',
            textAlign: 'center',
            transition: 'all 0.15s ease'
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.background = '#f5f3ff'; }}
          onMouseLeave={e => { if (!dragOver) { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.background = '#f8fafc'; } }}
        >
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
            <Upload size={16} color="#4f46e5" />
          </div>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#334155' }}>
            Click or drop PDF here
          </span>
        </div>
      )}
    </div>
  );
}

export default function AgencyPage({ user }) {
  const [vendors, setVendors] = useState([]);
  const [invoices, setInvoices] = useState({}); // { [vendorId]: [invoiceObj, ...] }
  const [expandedVendorIds, setExpandedVendorIds] = useState(new Set());
  const [loading, setLoading] = useState(true);

  // Modals state
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState(null);

  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [activeVendorForInvoice, setActiveVendorForInvoice] = useState(null);

  // Vendor Basic Info Form State
  const [vendorForm, setVendorForm] = useState({
    vendor_name: '',
    city: '',
    country: '',
    gst_number: '',
    gst_pdf: null,
    gst_pdf_name: '',
    agreement_pdf: null,
    agreement_pdf_name: '',
    poc_name: '',
    mobile: '',
    email: ''
  });

  // Invoice Form State
  const [invoiceForm, setInvoiceForm] = useState({
    month: '',
    invoice_number: '',
    amount: '',
    product: '',
    invoice_pdf: null,
    invoice_pdf_name: ''
  });

  const [uploadingPdf, setUploadingPdf] = useState(false);

  // Load Data on Mount
  useEffect(() => {
    fetchAllData();
  }, []);

  const fetchAllData = async () => {
    setLoading(true);
    let loadedVendors = [];
    let loadedInvoices = {};

    try {
      if (supabase) {
        const { data: vData } = await supabase
          .from('activity_vendors')
          .select('*')
          .order('created_at', { ascending: false });

        if (vData) loadedVendors = vData;

        const { data: iData } = await supabase
          .from('activity_invoices')
          .select('*')
          .order('created_at', { ascending: false });

        if (iData) {
          iData.forEach(inv => {
            if (!loadedInvoices[inv.vendor_id]) loadedInvoices[inv.vendor_id] = [];
            loadedInvoices[inv.vendor_id].push(inv);
          });
        }
      }
    } catch (err) {
      console.warn('[AgencyPage] Supabase load notice:', err);
    }

    // Fallback to localStorage if empty
    if (loadedVendors.length === 0) {
      try {
        const savedV = localStorage.getItem('activity_vendors_cache');
        if (savedV) loadedVendors = JSON.parse(savedV);
        const savedI = localStorage.getItem('activity_invoices_cache');
        if (savedI) loadedInvoices = JSON.parse(savedI);
      } catch (e) { }
    }

    setVendors(loadedVendors);
    setInvoices(loadedInvoices);

    // Auto-expand all vendors initially
    const initialExpanded = new Set(loadedVendors.map(v => v.id));
    setExpandedVendorIds(initialExpanded);

    setLoading(false);
  };

  const saveToCache = (updatedVendors, updatedInvoices) => {
    setVendors(updatedVendors);
    setInvoices(updatedInvoices);
    try {
      localStorage.setItem('activity_vendors_cache', JSON.stringify(updatedVendors));
      localStorage.setItem('activity_invoices_cache', JSON.stringify(updatedInvoices));
    } catch (e) { }
  };

  // PDF Upload Handler to Supabase Storage
  const handlePdfFileUpload = async (file, updateFormFn, fieldKey, nameKey) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
      alert('Please upload a valid PDF file.');
      return;
    }

    setUploadingPdf(true);
    const fileName = file.name;
    let finalUrl = null;

    if (supabase) {
      try {
        const filePath = `vendor_docs/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { data: storageData, error: storageErr } = await supabase
          .storage
          .from('vendor_documents')
          .upload(filePath, file, { contentType: 'application/pdf', upsert: true });

        if (!storageErr && storageData) {
          const { data: publicUrlData } = supabase.storage.from('vendor_documents').getPublicUrl(filePath);
          if (publicUrlData?.publicUrl) {
            finalUrl = publicUrlData.publicUrl;
          }
        }
      } catch (storageException) {
        console.warn('[ActivityTable] Supabase Storage upload notice:', storageException);
      }
    }

    if (!finalUrl) {
      const reader = new FileReader();
      reader.onload = (e) => {
        updateFormFn(prev => ({
          ...prev,
          [fieldKey]: e.target.result,
          [nameKey]: fileName
        }));
        setUploadingPdf(false);
      };
      reader.readAsDataURL(file);
    } else {
      updateFormFn(prev => ({
        ...prev,
        [fieldKey]: finalUrl,
        [nameKey]: fileName
      }));
      setUploadingPdf(false);
    }
  };

  // Helper to View Uploaded PDF in New Tab
  const handleOpenPdf = (pdfUrl, pdfName = 'Document.pdf') => {
    if (!pdfUrl) {
      alert('No PDF document uploaded.');
      return;
    }

    if (pdfUrl.startsWith('data:application/pdf')) {
      const win = window.open();
      if (win) {
        win.document.write(`<iframe src="${pdfUrl}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
        win.document.title = pdfName;
      } else {
        alert('Please allow popups to view the PDF document.');
      }
    } else {
      window.open(pdfUrl, '_blank');
    }
  };

  const toggleVendorExpand = (vendorId) => {
    setExpandedVendorIds(prev => {
      const next = new Set(prev);
      if (next.has(vendorId)) next.delete(vendorId);
      else next.add(vendorId);
      return next;
    });
  };

  // ─── VENDOR MODAL HANDLERS ───────────────────────────────────────────────
  const handleOpenAddVendorModal = () => {
    setEditingVendor(null);
    setVendorForm({
      vendor_name: '',
      city: '',
      country: '',
      gst_number: '',
      gst_pdf: null,
      gst_pdf_name: '',
      agreement_pdf: null,
      agreement_pdf_name: '',
      poc_name: '',
      mobile: '',
      email: ''
    });
    setIsVendorModalOpen(true);
  };

  const handleOpenEditVendorModal = (v) => {
    setEditingVendor(v);
    setVendorForm({
      vendor_name: v.vendor_name || '',
      city: v.city || '',
      country: v.country || '',
      gst_number: v.gst_number || '',
      gst_pdf: v.gst_pdf || null,
      gst_pdf_name: v.gst_pdf_name || (v.gst_pdf ? 'GST.pdf' : ''),
      agreement_pdf: v.agreement_pdf || null,
      agreement_pdf_name: v.agreement_pdf_name || (v.agreement_pdf ? 'Agreement.pdf' : ''),
      poc_name: v.poc_name || '',
      mobile: v.mobile || '',
      email: v.email || ''
    });
    setIsVendorModalOpen(true);
  };

  const handleSaveVendor = async (e) => {
    e.preventDefault();
    if (!vendorForm.vendor_name.trim()) {
      alert('Please enter Vendor Name.');
      return;
    }

    const vendorRecord = {
      id: editingVendor ? editingVendor.id : `v_${Date.now()}`,
      vendor_name: vendorForm.vendor_name.trim(),
      city: vendorForm.city.trim(),
      country: vendorForm.country.trim(),
      gst_number: vendorForm.gst_number.trim(),
      gst_pdf: vendorForm.gst_pdf,
      gst_pdf_name: vendorForm.gst_pdf_name,
      agreement_pdf: vendorForm.agreement_pdf,
      agreement_pdf_name: vendorForm.agreement_pdf_name,
      poc_name: vendorForm.poc_name.trim(),
      mobile: vendorForm.mobile.trim(),
      email: vendorForm.email.trim(),
      created_at: editingVendor ? editingVendor.created_at : new Date().toISOString()
    };

    if (supabase) {
      try {
        await supabase.from('activity_vendors').upsert(vendorRecord);
      } catch (err) {
        console.warn('[AgencyPage] Supabase vendor save notice:', err);
      }
    }

    let updatedVendors;
    if (editingVendor) {
      updatedVendors = vendors.map(v => v.id === editingVendor.id ? vendorRecord : v);
    } else {
      updatedVendors = [vendorRecord, ...vendors];
    }

    saveToCache(updatedVendors, invoices);
    setExpandedVendorIds(prev => new Set(prev).add(vendorRecord.id));
    setIsVendorModalOpen(false);
  };

  const handleDeleteVendor = async (vendorId) => {
    if (!window.confirm('Deleting this vendor will also delete all associated invoices. Continue?')) return;

    if (supabase) {
      try {
        await supabase.from('activity_vendors').delete().eq('id', vendorId);
      } catch (e) { }
    }

    const updatedVendors = vendors.filter(v => v.id !== vendorId);
    const updatedInvoices = { ...invoices };
    delete updatedInvoices[vendorId];

    saveToCache(updatedVendors, updatedInvoices);
  };

  // ─── INVOICE MODAL HANDLERS ──────────────────────────────────────────────
  const handleOpenAddInvoiceModal = (vendor) => {
    setActiveVendorForInvoice(vendor);
    setEditingInvoice(null);
    setInvoiceForm({
      month: '',
      invoice_number: '',
      amount: '',
      product: '',
      invoice_pdf: null,
      invoice_pdf_name: ''
    });
    setIsInvoiceModalOpen(true);
  };

  const handleOpenEditInvoiceModal = (vendor, inv) => {
    setActiveVendorForInvoice(vendor);
    setEditingInvoice(inv);
    setInvoiceForm({
      month: inv.month || '',
      invoice_number: inv.invoice_number || '',
      amount: inv.amount || '',
      product: inv.product || '',
      invoice_pdf: inv.invoice_pdf || null,
      invoice_pdf_name: inv.invoice_pdf_name || (inv.invoice_pdf ? 'Invoice.pdf' : '')
    });
    setIsInvoiceModalOpen(true);
  };

  const handleSaveInvoice = async (e) => {
    e.preventDefault();
    if (!activeVendorForInvoice?.id) return;

    const invoiceRecord = {
      id: editingInvoice ? editingInvoice.id : `inv_${Date.now()}`,
      vendor_id: activeVendorForInvoice.id,
      month: invoiceForm.month.trim(),
      invoice_number: invoiceForm.invoice_number.trim(),
      amount: invoiceForm.amount.trim(),
      product: invoiceForm.product.trim(),
      invoice_pdf: invoiceForm.invoice_pdf,
      invoice_pdf_name: invoiceForm.invoice_pdf_name,
      created_at: editingInvoice ? editingInvoice.created_at : new Date().toISOString()
    };

    if (supabase) {
      try {
        await supabase.from('activity_invoices').upsert(invoiceRecord);
      } catch (err) {
        console.warn('[AgencyPage] Supabase invoice save notice:', err);
      }
    }

    const vendorId = activeVendorForInvoice.id;
    const currentVendorInvoices = invoices[vendorId] || [];
    let updatedVendorInvoices;

    if (editingInvoice) {
      updatedVendorInvoices = currentVendorInvoices.map(inv => inv.id === editingInvoice.id ? invoiceRecord : inv);
    } else {
      updatedVendorInvoices = [invoiceRecord, ...currentVendorInvoices];
    }

    const updatedInvoices = {
      ...invoices,
      [vendorId]: updatedVendorInvoices
    };

    saveToCache(vendors, updatedInvoices);
    setExpandedVendorIds(prev => new Set(prev).add(vendorId));
    setIsInvoiceModalOpen(false);
  };

  const handleDeleteInvoice = async (vendorId, invoiceId) => {
    if (!window.confirm('Are you sure you want to delete this invoice?')) return;

    if (supabase) {
      try {
        await supabase.from('activity_invoices').delete().eq('id', invoiceId);
      } catch (e) { }
    }

    const currentVendorInvoices = invoices[vendorId] || [];
    const updatedVendorInvoices = currentVendorInvoices.filter(inv => inv.id !== invoiceId);
    const updatedInvoices = {
      ...invoices,
      [vendorId]: updatedVendorInvoices
    };

    saveToCache(vendors, updatedInvoices);
  };

  return (
    <div style={{ padding: '24px 32px', minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Top Header Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1A1A1A', margin: 0, letterSpacing: '-0.5px' }}>
            Agency
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Vendor records, agreements, and invoice tree repository across SEO operations.
          </p>
        </div>

        <button
          onClick={handleOpenAddVendorModal}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            fontSize: 13.5,
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
          <Plus size={16} />
          <span>Add Basic Info</span>
        </button>
      </div>

      {/* Main Unified Tree Table */}
      <div style={{ background: '#ffffff', borderRadius: 16, border: '1px solid #E4DFEE', boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06), 0 2px 6px -1px rgba(45, 45, 68, 0.03)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b' }}>
            Loading vendor records and activity tree...
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              {/* CLEAN VENDOR TABLE HEADERS */}
              <thead>
                <tr style={{ background: '#FAF8FD', borderBottom: '1px solid #E4DFEE' }}>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Vendor Name</th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>City</th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Country</th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>GST Number</th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Documents</th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>POC Info</th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {vendors.length > 0 ? (
                  vendors.map((vendor) => {
                    const isExpanded = expandedVendorIds.has(vendor.id);
                    const vendorInvoices = invoices[vendor.id] || [];

                    return (
                      <React.Fragment key={vendor.id}>
                        {/* PARENT ROW: VENDOR */}
                        <tr style={{
                          borderBottom: isExpanded ? 'none' : '1px solid #f1f5f9',
                          background: isExpanded ? '#f8fafc' : '#ffffff',
                          transition: 'background 0.15s ease'
                        }}>
                          {/* Col 1: Toggle Icon + Vendor Name */}
                          <td style={{ padding: '14px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <button
                                onClick={() => toggleVendorExpand(vendor.id)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 2, display: 'flex', alignItems: 'center' }}
                              >
                                {isExpanded ? <ChevronDown size={17} color="#4f46e5" /> : <ChevronRight size={17} color="#64748b" />}
                              </button>
                              <span style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
                                {vendor.vendor_name}
                              </span>
                              {vendorInvoices.length > 0 && (
                                <span style={{ fontSize: 10.5, fontWeight: 700, background: '#F6EEFD', color: '#7B2FBE', border: '1px solid #E5CCF7', padding: '2px 7px', borderRadius: 99, marginLeft: 2 }}>
                                  {vendorInvoices.length}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Col 2: City */}
                          <td style={{ padding: '14px 16px', fontSize: 13, color: '#334155' }}>
                            {vendor.city || '—'}
                          </td>

                          {/* Col 3: Country */}
                          <td style={{ padding: '14px 16px', fontSize: 13, color: '#334155' }}>
                            {vendor.country || '—'}
                          </td>

                          {/* Col 4: GST Number */}
                          <td style={{ padding: '14px 16px', fontSize: 12.5, fontWeight: 600, color: '#475569' }}>
                            {vendor.gst_number || '—'}
                          </td>

                          {/* Col 5: Vendor PDF Documents */}
                          <td style={{ padding: '14px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {vendor.gst_pdf && (
                                <button
                                  onClick={() => handleOpenPdf(vendor.gst_pdf, vendor.gst_pdf_name || 'GST.pdf')}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    padding: '4px 9px',
                                    borderRadius: 6,
                                    border: '1px solid #E5CCF7',
                                    background: '#F6EEFD',
                                    color: '#7B2FBE',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer'
                                  }}
                                >
                                  <FileText size={12} color="#7B2FBE" />
                                  <span>GST PDF</span>
                                </button>
                              )}
                              {vendor.agreement_pdf && (
                                <button
                                  onClick={() => handleOpenPdf(vendor.agreement_pdf, vendor.agreement_pdf_name || 'Agreement.pdf')}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    padding: '4px 9px',
                                    borderRadius: 6,
                                    border: '1px solid #E5CCF7',
                                    background: '#F6EEFD',
                                    color: '#7B2FBE',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer'
                                  }}
                                >
                                  <FileText size={12} color="#7B2FBE" />
                                  <span>Agreement PDF</span>
                                </button>
                              )}
                              {!vendor.gst_pdf && !vendor.agreement_pdf && (
                                <span style={{ fontSize: 11.5, color: '#94a3b8', fontStyle: 'italic' }}>—</span>
                              )}
                            </div>
                          </td>

                          {/* Col 6: POC Details */}
                          <td style={{ padding: '14px 16px' }}>
                            <div style={{ fontSize: 12, color: '#334155' }}>
                              {vendor.poc_name && <div style={{ fontWeight: 700, color: '#0f172a' }}>{vendor.poc_name}</div>}
                              {(vendor.mobile || vendor.email) && (
                                <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>
                                  {[vendor.mobile, vendor.email].filter(Boolean).join(' • ')}
                                </div>
                              )}
                              {!vendor.poc_name && !vendor.mobile && !vendor.email && '—'}
                            </div>
                          </td>

                          {/* Col 7: Vendor Actions */}
                          <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                              <button
                                onClick={() => handleOpenAddInvoiceModal(vendor)}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '5px 11px',
                                  borderRadius: 6,
                                  border: 'none',
                                  background: '#1A1A1A',
                                  color: '#ffffff',
                                  fontSize: 11.5,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
                                  transition: 'all 0.15s ease'
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = '#2E2E38'}
                                onMouseLeave={e => e.currentTarget.style.background = '#1A1A1A'}
                              >
                                <Plus size={13} />
                                <span>Add Invoice</span>
                              </button>

                              <button
                                onClick={() => handleOpenEditVendorModal(vendor)}
                                title="Edit Vendor"
                                style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 4 }}
                              >
                                <Edit3 size={15} />
                              </button>

                              <button
                                onClick={() => handleDeleteVendor(vendor.id)}
                                title="Delete Vendor"
                                style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* ─── EXPANDED INVOICE SECTION (SEAMLESS RIGHT-SHIFTED SUB-TABLE) ─── */}
                        {isExpanded && (
                          <tr style={{ background: '#fafafc', borderBottom: '1px solid #e2e8f0' }}>
                            <td colSpan={7} style={{ padding: 0 }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', tableLayout: 'fixed' }}>
                                <thead>
                                  <tr style={{ background: '#f1f5f9', borderTop: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>
                                    <th style={{ width: '20%', padding: '9px 16px 9px 36px', fontSize: 10.5, fontWeight: 800, color: '#4f46e5', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                      Invoice Month
                                    </th>
                                    <th style={{ width: '20%', padding: '9px 16px', fontSize: 10.5, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                      Invoice Number
                                    </th>
                                    <th style={{ width: '15%', padding: '9px 16px', fontSize: 10.5, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                      Amount
                                    </th>
                                    <th style={{ width: '18%', padding: '9px 16px', fontSize: 10.5, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                      Product
                                    </th>
                                    <th style={{ width: '17%', padding: '9px 16px', fontSize: 10.5, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                      Invoice PDF
                                    </th>
                                    <th style={{ width: '10%', padding: '9px 16px', fontSize: 10.5, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>
                                      Actions
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {vendorInvoices.length > 0 ? (
                                    vendorInvoices.map((inv, iIdx) => (
                                      <tr
                                        key={inv.id}
                                        style={{
                                          borderBottom: iIdx === vendorInvoices.length - 1 ? 'none' : '1px dashed #f1f5f9',
                                          background: '#ffffff'
                                        }}
                                      >
                                        {/* Col 1: Month with Arrow shifted right */}
                                        <td style={{ padding: '11px 16px 11px 36px' }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <CornerDownRight size={14} color="#94a3b8" />
                                            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#4338ca' }}>
                                              {inv.month || '—'}
                                            </span>
                                          </div>
                                        </td>

                                        {/* Col 2: Invoice Number */}
                                        <td style={{ padding: '11px 16px', fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                                          {inv.invoice_number || '—'}
                                        </td>

                                        {/* Col 3: Amount */}
                                        <td style={{ padding: '11px 16px', fontSize: 12.5, fontWeight: 700, color: '#059669' }}>
                                          {inv.amount ? (String(inv.amount).startsWith('$') ? inv.amount : `$${inv.amount}`) : '—'}
                                        </td>

                                        {/* Col 4: Product */}
                                        <td style={{ padding: '11px 16px' }}>
                                          {inv.product ? (
                                            <span style={{ background: '#eef2ff', color: '#4f46e5', padding: '3px 8px', borderRadius: 4, fontSize: 11.5, fontWeight: 600 }}>
                                              {inv.product}
                                            </span>
                                          ) : '—'}
                                        </td>

                                        {/* Col 5: Invoice PDF Button */}
                                        <td style={{ padding: '11px 16px' }}>
                                          {inv.invoice_pdf ? (
                                            <button
                                              onClick={() => handleOpenPdf(inv.invoice_pdf, inv.invoice_pdf_name || 'Invoice.pdf')}
                                              style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 4,
                                                padding: '4px 10px',
                                                borderRadius: 6,
                                                border: '1px solid #c7d2fe',
                                                background: '#eef2ff',
                                                color: '#4338ca',
                                                fontSize: 11.5,
                                                fontWeight: 700,
                                                cursor: 'pointer'
                                              }}
                                            >
                                              <FileText size={13} color="#4f46e5" />
                                              <span>View Invoice PDF</span>
                                              <ExternalLink size={10} />
                                            </button>
                                          ) : (
                                            <span style={{ fontSize: 11.5, color: '#94a3b8', fontStyle: 'italic' }}>No PDF</span>
                                          )}
                                        </td>

                                        {/* Col 6: Actions */}
                                        <td style={{ padding: '11px 16px', textAlign: 'right' }}>
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                                            <button
                                              onClick={() => handleOpenEditInvoiceModal(vendor, inv)}
                                              title="Edit Invoice"
                                              style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', padding: 4 }}
                                            >
                                              <Edit3 size={14} />
                                            </button>
                                            <button
                                              onClick={() => handleDeleteInvoice(vendor.id, inv.id)}
                                              title="Delete Invoice"
                                              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }}
                                            >
                                              <Trash2 size={14} />
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    ))
                                  ) : (
                                    <tr style={{ background: '#ffffff' }}>
                                      <td colSpan={5} style={{ padding: '12px 16px 12px 36px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
                                          <CornerDownRight size={14} color="#cbd5e1" />
                                          <span>No invoices added yet for {vendor.vendor_name}.</span>
                                        </div>
                                      </td>
                                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                                        <button
                                          onClick={() => handleOpenAddInvoiceModal(vendor)}
                                          style={{ fontSize: 11, fontWeight: 700, color: '#4f46e5', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}
                                        >
                                          + Add Invoice
                                        </button>
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} style={{ padding: '60px 20px', textAlign: 'center', color: '#94a3b8' }}>
                      <FileSpreadsheet size={40} color="#cbd5e1" style={{ marginBottom: 10 }} />
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#475569' }}>No Vendors Registered</div>
                      <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 4 }}>
                        Click "Add Basic Info" above to register a new vendor.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── MODAL 1: ADD / EDIT VENDOR BASIC INFO ─── */}
      {isVendorModalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.55)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999,
          padding: 20
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 16,
            width: '100%',
            maxWidth: 600,
            padding: 26,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h3 style={{ fontSize: 19, fontWeight: 800, color: '#0f172a', margin: 0 }}>
                  {editingVendor ? 'Edit Vendor Basic Info' : 'Add Vendor Basic Info'}
                </h3>
                <p style={{ fontSize: 12.5, color: '#64748b', margin: '2px 0 0' }}>
                  Register vendor details, GST info, and agreements.
                </p>
              </div>
              <button onClick={() => setIsVendorModalOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveVendor} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Vendor Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Media Agency India"
                    value={vendorForm.vendor_name}
                    onChange={e => setVendorForm({ ...vendorForm, vendor_name: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>City</label>
                  <input
                    type="text"
                    placeholder="e.g. Mumbai"
                    value={vendorForm.city}
                    onChange={e => setVendorForm({ ...vendorForm, city: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, outline: 'none' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Country</label>
                  <input
                    type="text"
                    placeholder="e.g. India"
                    value={vendorForm.country}
                    onChange={e => setVendorForm({ ...vendorForm, country: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>GST Number</label>
                  <input
                    type="text"
                    placeholder="e.g. 27AAAAA0000A1Z5"
                    value={vendorForm.gst_number}
                    onChange={e => setVendorForm({ ...vendorForm, gst_number: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, outline: 'none' }}
                  />
                </div>
              </div>

              {/* POC Details */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#475569', marginBottom: 4 }}>POC Name</label>
                  <input
                    type="text"
                    placeholder="Contact person"
                    value={vendorForm.poc_name}
                    onChange={e => setVendorForm({ ...vendorForm, poc_name: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 12.5, outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Mobile</label>
                  <input
                    type="text"
                    placeholder="+91 9876543210"
                    value={vendorForm.mobile}
                    onChange={e => setVendorForm({ ...vendorForm, mobile: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 12.5, outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Email</label>
                  <input
                    type="email"
                    placeholder="poc@vendor.com"
                    value={vendorForm.email}
                    onChange={e => setVendorForm({ ...vendorForm, email: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 12.5, outline: 'none' }}
                  />
                </div>
              </div>

              {/* PDF Uploads at Bottom */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 4 }}>
                <PdfUploadBox
                  label="Upload GST (PDF)"
                  fileName={vendorForm.gst_pdf_name}
                  onFileSelect={file => handlePdfFileUpload(file, setVendorForm, 'gst_pdf', 'gst_pdf_name')}
                  onRemove={() => setVendorForm(prev => ({ ...prev, gst_pdf: null, gst_pdf_name: '' }))}
                />
                <PdfUploadBox
                  label="Upload Agreement (PDF)"
                  fileName={vendorForm.agreement_pdf_name}
                  onFileSelect={file => handlePdfFileUpload(file, setVendorForm, 'agreement_pdf', 'agreement_pdf_name')}
                  onRemove={() => setVendorForm(prev => ({ ...prev, agreement_pdf: null, agreement_pdf_name: '' }))}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setIsVendorModalOpen(false)}
                  style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={uploadingPdf}
                  style={{
                    padding: '9px 24px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#1A1A1A',
                    color: '#ffffff',
                    fontSize: 13.5,
                    fontWeight: 700,
                    cursor: uploadingPdf ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.22)',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => { if (!uploadingPdf) e.currentTarget.style.background = '#2E2E38'; }}
                  onMouseLeave={e => { if (!uploadingPdf) e.currentTarget.style.background = '#1A1A1A'; }}
                >
                  {uploadingPdf ? 'Uploading PDF...' : 'Done'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL 2: ADD / EDIT INVOICE (PER VENDOR) ─── */}
      {isInvoiceModalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.55)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999,
          padding: 20
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 16,
            width: '100%',
            maxWidth: 540,
            padding: 26,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>
                  {editingInvoice ? 'Edit Invoice' : `Add Invoice for ${activeVendorForInvoice?.vendor_name}`}
                </h3>
                <p style={{ fontSize: 12.5, color: '#64748b', margin: '2px 0 0' }}>
                  Upload invoice details and document.
                </p>
              </div>
              <button onClick={() => setIsInvoiceModalOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveInvoice} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Month</label>
                  <input
                    type="text"
                    placeholder="e.g. August 2026"
                    value={invoiceForm.month}
                    onChange={e => setInvoiceForm({ ...invoiceForm, month: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Invoice Number</label>
                  <input
                    type="text"
                    placeholder="e.g. INV-2026-0801"
                    value={invoiceForm.invoice_number}
                    onChange={e => setInvoiceForm({ ...invoiceForm, invoice_number: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, outline: 'none' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Amount</label>
                  <input
                    type="text"
                    placeholder="e.g. $1,500"
                    value={invoiceForm.amount}
                    onChange={e => setInvoiceForm({ ...invoiceForm, amount: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Product</label>
                  <input
                    type="text"
                    placeholder="e.g. Guest Post"
                    value={invoiceForm.product}
                    onChange={e => setInvoiceForm({ ...invoiceForm, product: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, outline: 'none' }}
                  />
                </div>
              </div>

              {/* Upload Invoice PDF at Bottom */}
              <div style={{ marginTop: 4 }}>
                <PdfUploadBox
                  label="Upload Invoice (PDF) *"
                  fileName={invoiceForm.invoice_pdf_name}
                  onFileSelect={file => handlePdfFileUpload(file, setInvoiceForm, 'invoice_pdf', 'invoice_pdf_name')}
                  onRemove={() => setInvoiceForm(prev => ({ ...prev, invoice_pdf: null, invoice_pdf_name: '' }))}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setIsInvoiceModalOpen(false)}
                  style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={uploadingPdf}
                  style={{
                    padding: '9px 24px',
                    borderRadius: 8,
                    border: '1.5px solid #09060E',
                    background: 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)',
                    color: '#ffffff',
                    fontSize: 13.5,
                    fontWeight: 700,
                    cursor: uploadingPdf ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 16px rgba(123, 47, 190, 0.35)',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => { if (!uploadingPdf) e.currentTarget.style.background = 'linear-gradient(135deg, #581F9E 0%, #8A33D4 45%, #D6237A 80%, #E50C88 100%)'; }}
                  onMouseLeave={e => { if (!uploadingPdf) e.currentTarget.style.background = 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)'; }}
                >
                  {uploadingPdf ? 'Uploading PDF...' : 'Done'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
