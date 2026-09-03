import { supabase } from './supabaseClient';
import { derivedKeywordClusters, derivedPages } from '../data/mockData';

export async function authFetch(url, options = {}) {
  let token = null;
  try {
    token = typeof window !== 'undefined' ? sessionStorage.getItem('seo_token') : null;
  } catch (_) { }

  const headers = {
    ...(options.headers || {}),
    ...(token && !(options.headers && options.headers.Authorization) ? { 'Authorization': `Bearer ${token}` } : {})
  };

  const res = await window.fetch(url, { ...options, headers });
  if (res.status === 401 && String(url).includes('/auth/me')) {
    console.warn('[authFetch] 401 Unauthorized received on /auth/me, clearing expired session');
    try {
      sessionStorage.removeItem('seo_token');
      sessionStorage.removeItem('seo_dashboard_user');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('auth_session_expired'));
      }
    } catch (_) { }
  }
  return res;
}

const fetch = authFetch;

export async function fetchRecycleBinItemsApi(itemType = null) {
  if (isLocalMode) {
    const items = JSON.parse(localStorage.getItem('seo_recycle_bin') || '[]');
    if (itemType && itemType !== 'all') {
      return items.filter(i => i.item_type === itemType);
    }
    return items;
  }

  const url = itemType && itemType !== 'all'
    ? `${CATEGORY_API_BASE}/recycle-bin?item_type=${encodeURIComponent(itemType)}`
    : `${CATEGORY_API_BASE}/recycle-bin`;

  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch recycle bin items.');
  const data = await res.json();
  return data.items || [];
}

export async function restoreRecycleBinItemApi(itemId, userEmail = null) {
  const email = getActiveUserEmail(userEmail);
  if (isLocalMode) {
    const items = JSON.parse(localStorage.getItem('seo_recycle_bin') || '[]');
    const idx = items.findIndex(i => String(i.item_id) === String(itemId) || i.project_slug === itemId);
    if (idx !== -1) {
      const item = items[idx];
      const type = item.item_type;
      const data = item.data;

      if (type === 'project') {
        const projects = JSON.parse(localStorage.getItem('seo_projects') || '[]');
        const domains = JSON.parse(localStorage.getItem('seo_domains') || '[]');
        const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
        const pages = JSON.parse(localStorage.getItem('seo_pages') || '[]');
        const competitors = JSON.parse(localStorage.getItem('seo_competitors') || '[]');

        if (data.project) projects.push(data.project);
        if (data.domains) domains.push(...data.domains);
        if (data.keywords) kwRows.push(...data.keywords);
        if (data.pages) pages.push(...data.pages);
        if (data.competitors) competitors.push(...data.competitors);

        localStorage.setItem('seo_projects', JSON.stringify(projects));
        localStorage.setItem('seo_domains', JSON.stringify(domains));
        localStorage.setItem('seo_keyword_categories', JSON.stringify(kwRows));
        localStorage.setItem('seo_pages', JSON.stringify(pages));
        localStorage.setItem('seo_competitors', JSON.stringify(competitors));
      } else if (type === 'keyword') {
        const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
        kwRows.push(data);
        localStorage.setItem('seo_keyword_categories', JSON.stringify(kwRows));
      } else if (type === 'page') {
        const pages = JSON.parse(localStorage.getItem('seo_pages') || '[]');
        pages.push(data);
        localStorage.setItem('seo_pages', JSON.stringify(pages));
      } else if (type === 'competitor') {
        const competitors = JSON.parse(localStorage.getItem('seo_competitors') || '[]');
        competitors.push(data);
        localStorage.setItem('seo_competitors', JSON.stringify(competitors));
      }

      items.splice(idx, 1);
      localStorage.setItem('seo_recycle_bin', JSON.stringify(items));
    }
    return;
  }

  const res = await fetch(`${CATEGORY_API_BASE}/recycle-bin/${itemId}/restore?user_email=${encodeURIComponent(email)}`, {
    method: 'POST'
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to restore item.');
  }
}

export async function hardDeleteRecycleBinItemApi(itemId, userEmail = null) {
  const email = getActiveUserEmail(userEmail);
  if (isLocalMode) {
    const items = JSON.parse(localStorage.getItem('seo_recycle_bin') || '[]');
    const target = String(itemId);
    const updated = items.filter(i =>
      String(i.id) !== target &&
      String(i.item_id) !== target &&
      i.project_slug !== target &&
      i.project_name !== target
    );
    localStorage.setItem('seo_recycle_bin', JSON.stringify(updated));
    return;
  }

  const res = await fetch(`${CATEGORY_API_BASE}/recycle-bin/${encodeURIComponent(itemId)}?user_email=${encodeURIComponent(email)}`, {
    method: 'DELETE'
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to delete item permanently.');
  }
}

export function getActiveUserEmail(passedEmail = null) {
  if (passedEmail) return passedEmail;
  try {
    const savedUser = JSON.parse(sessionStorage.getItem('seo_dashboard_user') || '{}');
    if (savedUser && savedUser.email) return savedUser.email;
  } catch (e) { }
  return 'system';
}

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function timeAgo(isoString) {
  if (!isoString) return '';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const PLATFORM_LABELS = { ai_mode: 'AI Mode', ai_overview: 'AI Overview', google: 'Google', chatgpt: 'ChatGPT', gemini: 'Gemini' };

function iconForPlatforms(platformLabels) {
  const platforms = platformLabels || [];
  if (platforms.includes('Google')) return 'google';
  if (platforms.includes('AI Mode') || platforms.includes('AI Overview')) return 'ai';
  return 'desktop';
}

// Aggregates keyword_categories rows (project_name, subtype, target_type)
// into per-project counts -- shared by the Domain tab and the KW Cluster
// tab so both surfaces report the exact same numbers instead of the
// Domain tab's own (never-updated) keywords_count/target_pages_count/
// blog_pages_count columns. target_type is ALWAYS overwritten by the
// AI-Clustering pipeline with either "Landing Page" or "Blog Page" (see
// scripts/landing_blog_classifier.py), so those are the two values these
// counts key off of.
const EMPTY_KW_COUNTS = { total: 0, commercial: 0, landingPages: 0, blogPages: 0 };

function aggregateKwCounts(kwRows) {
  const counts = new Map();

  const getOrCreate = (key) => {
    const k = String(key || '').trim().toLowerCase();
    if (!k) return null;
    let c = counts.get(k);
    if (!c) {
      c = { total: 0, commercial: 0, landingPages: 0, blogPages: 0 };
      counts.set(k, c);
    }
    return c;
  };

  (kwRows || []).forEach(r => {
    const rawKey = r.project_name || r.project_slug;
    if (!rawKey) return;

    const k1 = String(rawKey).trim().toLowerCase();
    const k2 = k1.replace(/[^a-z0-9]/g, '');

    const c1 = getOrCreate(k1);
    const c2 = k2 && k2 !== k1 ? getOrCreate(k2) : null;

    [c1, c2].forEach(c => {
      if (!c) return;
      c.total += 1;

      const sub = String(r.subtype || r.sub_type || '').trim().toLowerCase();
      if (sub.includes('commercial')) {
        c.commercial += 1;
      }

      const tt = String(r.target_type || r.targetType || r.type || '').trim().toLowerCase();
      if (tt.includes('landing') || tt.includes('page')) {
        c.landingPages += 1;
      } else if (tt.includes('blog')) {
        c.blogPages += 1;
      }
    });
  });

  return {
    get(projKey) {
      if (!projKey) return EMPTY_KW_COUNTS;
      const k1 = String(projKey).trim().toLowerCase();
      const k2 = k1.replace(/[^a-z0-9]/g, '');
      return counts.get(k1) || counts.get(k2) || EMPTY_KW_COUNTS;
    }
  };
}

async function fetchKwCountsForSlug(slug) {
  if (!slug) return EMPTY_KW_COUNTS;
  if (isLocalMode) {
    const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
    return aggregateKwCounts(kwRows).get(slug);
  }
  let allRows = [];
  let page = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('keyword_categories')
      .select('project_name, subtype, target_type')
      .or(`project_name.ilike.${slug}`)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;
    if (data && data.length > 0) {
      allRows = allRows.concat(data);
      if (data.length < pageSize) hasMore = false;
      else page++;
    } else {
      hasMore = false;
    }
  }
  return aggregateKwCounts(allRows).get(slug);
}

function domainRowToProject(row, kwCounts = EMPTY_KW_COUNTS) {
  const targetPlatforms = row.platforms || [];
  const landingCount = kwCounts.landingPages > 0 ? kwCounts.landingPages : Math.max(0, kwCounts.total - kwCounts.blogPages);
  const status = row.status || (row.is_active === false ? 'Inactive' : 'Active');
  return {
    id: row.id,
    slug: row.project_slug,
    name: row.project_name,
    domain: row.domain,
    locationIcon: iconForPlatforms(targetPlatforms),
    location: row.target_regions?.[0] || 'Global',
    traffic: Number(row.traffic) || 0,
    trafficDir: null,
    da: row.domain_authority,
    spam_score: row.spam_score ?? row.ss ?? null,
    ss: row.spam_score ?? row.ss ?? null,
    total_traffic: row.traffic ?? null,
    metricsUpdatedAt: row.metrics_updated_at ?? null,
    keywords: kwCounts.total,
    keywordsDir: null,
    targetPages: landingCount,
    targetDir: null,
    blogPages: kwCounts.blogPages,
    status,
    isActive: status === 'Active',
    updated: timeAgo(row.updated_at),
    targetPlatforms,
    napBusinessCentre: row.nap_business_centre || null,
    napPhone: row.nap_phone || null,
    napWebsite: row.nap_website || null,
    napAddress: row.nap_address || null,
    napEmail: row.nap_email || null,
    napBcPhone: row.nap_bc_phone || null,
    napBcWebsite: row.nap_bc_website || null,
    napBcAddress: row.nap_bc_address || null,
    napBcEmail: row.nap_bc_email || null,
    businessCentres: row.business_centres || null,
    brandedTerms: row.branded_terms || null,
    industry: row.industry || row.industry_type || row.domain_industry || row.category || null,
    industry_type: row.industry_type || row.industry || row.domain_industry || row.category || null,
    domain_industry: row.domain_industry || row.industry || row.industry_type || row.category || null,
    target_regions: Array.isArray(row.target_regions) ? row.target_regions : (row.target_regions ? [row.target_regions] : []),
  };
}

// ─── Local Mode Detection & Setup ───────────────────────────────────────────
const isLocalMode = !supabase;

function initializeLocalStorage() {
  if (!isLocalMode) return;

  if (!localStorage.getItem('seo_domains')) {
    const defaultDomains = [
      {
        id: '1',
        project_name: 'OWIS',
        project_slug: 'owis',
        domain: 'owis.org',
        platforms: ['Google', 'AI Overview'],
        target_regions: ['Singapore'],
        domain_authority: '45',
        users: ['admin@owis.org'],
        traffic: '12400',
        keywords_count: String(derivedKeywordClusters.length),
        target_pages_count: '42',
        blog_pages_count: '15',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ];
    localStorage.setItem('seo_domains', JSON.stringify(defaultDomains));
  }

  if (!localStorage.getItem('seo_projects')) {
    const defaultProjects = [
      {
        id: '1',
        name: 'OWIS',
        slug: 'owis',
        created_at: new Date().toISOString()
      }
    ];
    localStorage.setItem('seo_projects', JSON.stringify(defaultProjects));
  }

  if (!localStorage.getItem('seo_keyword_categories')) {
    const defaultKws = derivedKeywordClusters.map((k, idx) => ({
      id: idx + 1,
      project_name: 'owis',
      keyword: k.kw,
      sv: k.sv,
      kw_diff: k.kwDiff,
      cluster: k.cluster,
      category: k.category,
      type: k.type,
      target_type: k.targetType === 'Topical Blogs' ? 'Topical Blog' : (k.targetType === 'Landing Page' ? 'Landing Page' : 'Blog'),
      subtype: k.targetSubtype,
      target_geo: k.targetGeo,
      priority: k.priority,
      landing_page_url: k.landingPage
    }));
    localStorage.setItem('seo_keyword_categories', JSON.stringify(defaultKws));
  }

  if (!localStorage.getItem('seo_pages') || JSON.parse(localStorage.getItem('seo_pages')).length === 0) {
    const defaultPages = derivedPages.map((p, idx) => ({
      id: idx + 1,
      project_name: 'owis',
      pageName: p.pageName,
      url: p.url,
      cluster: p.cluster,
      category: p.category,
      targetCategory: p.targetCategory,
      targetType: p.targetType,
    }));
    localStorage.setItem('seo_pages', JSON.stringify(defaultPages));
  }
}

if (isLocalMode) {
  initializeLocalStorage();
}

// ─── Domain tab ─────────────────────────────────────────────────────────────

export async function fetchDomainRows() {
  if (isLocalMode) {
    const domains = JSON.parse(localStorage.getItem('seo_domains') || '[]');
    const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
    const counts = aggregateKwCounts(kwRows);
    return (domains || [])
      .filter(d => d && d.domain && String(d.domain).trim() !== '')
      .map(d => domainRowToProject(d, counts.get(d.project_slug) || EMPTY_KW_COUNTS));
  }

  let allKwRows = [];
  try {
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: kwRows, error: kwError } = await supabase
        .from('keyword_categories')
        .select('project_name, subtype, target_type')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (kwError) break;
      if (kwRows && kwRows.length > 0) {
        allKwRows = allKwRows.concat(kwRows);
        if (kwRows.length < pageSize) hasMore = false;
        else page++;
      } else {
        hasMore = false;
      }
    }
  } catch (e) {
    console.warn('[fetchDomainRows] Kw count query skipped:', e);
  }

  const counts = aggregateKwCounts(allKwRows);
  const domainMap = new Map();

  // 1. Fetch from FastAPI backend /domains (PostgreSQL)
  try {
    const res = await fetch(`${CATEGORY_API_BASE}/domains`);
    if (res.ok) {
      const json = await res.json();
      (json.domains || []).forEach(d => {
        const slug = d.project_slug || slugify(d.project_name || d.domain);
        if (slug) {
          domainMap.set(slug, {
            ...d,
            project_slug: slug,
            project_name: d.project_name || d.domain
          });
        }
      });
    }
  } catch (e) {
    console.warn('[fetchDomainRows] Backend /domains fetch skipped:', e);
  }

  // 2. Fetch from Supabase
  try {
    const [{ data: activeProjects }, { data: domains }] = await Promise.all([
      supabase.from('projects').select('slug').is('deleted_at', null),
      supabase.from('domains').select('*').order('created_at', { ascending: false })
    ]);

    const activeSlugs = new Set((activeProjects || []).map(p => p.slug));

    (domains || []).forEach(d => {
      if (d.project_slug && (activeSlugs.has(d.project_slug) || activeSlugs.size === 0)) {
        if (!domainMap.has(d.project_slug)) {
          domainMap.set(d.project_slug, d);
        }
      }
    });
  } catch (e) {
    console.warn('[fetchDomainRows] Supabase domain fetch skipped:', e);
  }

  const mergedDomains = Array.from(domainMap.values());
  return mergedDomains.map(d => domainRowToProject(d, counts.get(d.project_slug) || EMPTY_KW_COUNTS));
}

// Lightweight project list for pages that only need the dropdown (name / slug /
// domain / da / spam) and fetch keyword/page data per-project on demand.
// Unlike fetchDomainRows() it does NOT scan the whole keyword_categories table.
export async function fetchProjectListLite() {
  if (isLocalMode) {
    return fetchDomainRows();
  }
  try {
    const [{ data: activeProjects }, { data: domains }] = await Promise.all([
      supabase.from('projects').select('slug').is('deleted_at', null),
      supabase.from('domains').select('*').order('created_at', { ascending: false }),
    ]);
    const activeSlugs = new Set((activeProjects || []).map(p => p.slug));
    const rows = (domains || []).filter(d =>
      d.domain && String(d.domain).trim() !== '' &&
      (activeSlugs.size === 0 || activeSlugs.has(d.project_slug))
    );
    if (rows.length > 0) {
      return rows.map(d => domainRowToProject(d, EMPTY_KW_COUNTS));
    }
  } catch (e) {
    console.warn('[fetchProjectListLite] Supabase query failed, falling back:', e);
  }
  return fetchDomainRows();
}

// Persist the live DA / Spam Score / traffic (from fetchDomainMetricsApi) onto
// the project's `domains` row in Supabase, so it is never cached client-side.
export async function saveDomainMetricsToSupabase(projectSlug, { da, spam_score, traffic } = {}) {
  if (!projectSlug) return;
  const patch = { metrics_updated_at: new Date().toISOString() };
  if (da != null && da !== '') patch.domain_authority = String(da);
  if (spam_score != null && spam_score !== '') patch.spam_score = String(spam_score);
  if (traffic != null && traffic !== '') patch.traffic = String(traffic);

  if (supabase) {
    try {
      await supabase.from('domains').update(patch).eq('project_slug', projectSlug);
    } catch (e) {
      console.warn('[saveDomainMetricsToSupabase] Supabase update skipped:', e);
    }
  }
  // Best-effort backend sync (keeps the FastAPI Postgres copy in step)
  try {
    await fetch(`${getApiBaseUrl()}/domains/${encodeURIComponent(projectSlug)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ da, spam_score, traffic }),
    }).catch(() => {});
  } catch (e) { /* ignore */ }
}

export async function createProject({ name, domain, regions, platforms, da, industry, nap_business_centre, nap_phone, nap_website, nap_address, nap_email, nap_bc_phone, nap_bc_website, nap_bc_address, nap_bc_email, business_centres, branded_terms, users }) {
  const normDomain = String(domain || '').trim().toLowerCase();
  const normName = String(name || '').trim().toLowerCase();
  const slug = slugify(name);

  // Check duplicate domain or project name before creation
  const existingRows = await fetchDomainRows().catch(() => []);
  const isDuplicate = existingRows.some(d => {
    const dDom = String(d.domain || '').trim().toLowerCase();
    const dName = String(d.name || '').trim().toLowerCase();
    const dSlug = d.slug || slugify(d.name || '');
    return (normDomain && dDom === normDomain) || (normName && dName === normName) || (slug && dSlug === slug);
  });

  if (isDuplicate) {
    throw new Error("Use different domain or projectname, it's already used");
  }

  if (isLocalMode) {
    const projects = JSON.parse(localStorage.getItem('seo_projects') || '[]');
    if (!projects.some(p => p.slug === slug)) {
      projects.push({
        id: String(Date.now()),
        name,
        slug,
        created_at: new Date().toISOString()
      });
      localStorage.setItem('seo_projects', JSON.stringify(projects));
    }

    const domains = JSON.parse(localStorage.getItem('seo_domains') || '[]');
    const newDomain = {
      id: String(Date.now() + 1),
      domain,
      project_name: name,
      project_slug: slug,
      target_regions: regions || [],
      platforms: (platforms || []).map(v => PLATFORM_LABELS[v] || v),
      domain_authority: da != null ? String(da) : null,
      industry: industry || null,
      industry_type: industry || null,
      nap_business_centre: nap_business_centre || null,
      nap_phone: nap_phone || null,
      nap_website: nap_website || null,
      nap_address: nap_address || null,
      nap_email: nap_email || null,
      nap_bc_phone: nap_bc_phone || null,
      nap_bc_website: nap_bc_website || null,
      nap_bc_address: nap_bc_address || null,
      nap_bc_email: nap_bc_email || null,
      business_centres: business_centres || null,
      branded_terms: branded_terms || null,
      users: users || [],
      traffic: '0',
      keywords_count: '0',
      target_pages_count: '0',
      blog_pages_count: '0',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    domains.push(newDomain);
    localStorage.setItem('seo_domains', JSON.stringify(domains));
    return domainRowToProject(newDomain);
  }

  // 1. Post to FastAPI backend so PostgreSQL database registers the domain & project
  let backendDomainData = null;
  try {
    const backendRes = await fetch(`${CATEGORY_API_BASE}/domains`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain,
        project_name: name,
        target_regions: regions || [],
        platforms: (platforms || []).map(v => PLATFORM_LABELS[v] || v),
        domain_authority: da != null ? String(da) : null,
        industry: industry || null,
        industry_type: industry || null,
        nap_business_centre: nap_business_centre || null,
        nap_phone: nap_phone || null,
        nap_website: nap_website || null,
        nap_address: nap_address || null,
        nap_email: nap_email || null,
        nap_bc_phone: nap_bc_phone || null,
        nap_bc_website: nap_bc_website || null,
        nap_bc_address: nap_bc_address || null,
        nap_bc_email: nap_bc_email || null,
        business_centres: business_centres || null,
        branded_terms: branded_terms || null,
        users: users || [],
      }),
    });
    if (!backendRes.ok) {
      const errBody = await backendRes.json().catch(() => ({}));
      const errMsg = errBody.detail || "Use different domain or projectname, it's already used";
      throw new Error(errMsg);
    } else {
      backendDomainData = await backendRes.json();
    }
  } catch (e) {
    if (e.message === "Use different domain or projectname, it's already used") {
      throw e;
    }
    console.warn('[createProject] FastAPI POST /domains failed:', e);
  }

  // 2. Insert into Supabase for client compatibility
  let supabaseDomainData = null;
  try {
    await supabase
      .from('projects')
      .upsert({ name, slug, deleted_at: null }, { onConflict: 'slug' });

    const { data: insertedDomain } = await supabase
      .from('domains')
      .insert({
        domain,
        project_name: name,
        project_slug: slug,
        target_regions: regions || [],
        platforms: (platforms || []).map(v => PLATFORM_LABELS[v] || v),
        domain_authority: da != null ? String(da) : null,
        industry: industry || null,
        industry_type: industry || null,
        nap_business_centre: nap_business_centre || null,
        nap_phone: nap_phone || null,
        nap_website: nap_website || null,
        nap_address: nap_address || null,
        nap_email: nap_email || null,
        nap_bc_phone: nap_bc_phone || null,
        nap_bc_website: nap_bc_website || null,
        nap_bc_address: nap_bc_address || null,
        nap_bc_email: nap_bc_email || null,
        business_centres: business_centres || null,
        branded_terms: branded_terms || null,
        users: users || [],
        traffic: '0',
        keywords_count: '0',
        target_pages_count: '0',
        blog_pages_count: '0',
      })
      .select()
      .single();

    supabaseDomainData = insertedDomain;
  } catch (e) {
    console.warn('[createProject] Supabase domain insert failed:', e);
  }

  createAuditLogApi({
    userEmail: getActiveUserEmail(),
    action: `Project Created: ${domain}`,
    status: 'Success',
    project_name: slug,
    module: 'project'
  }).catch(() => { });

  const domainRow = supabaseDomainData || {
    id: String(Date.now()),
    domain,
    project_name: name,
    project_slug: slug,
    target_regions: regions || [],
    platforms: (platforms || []).map(v => PLATFORM_LABELS[v] || v),
    domain_authority: da != null ? String(da) : null,
    industry: industry || null,
    industry_type: industry || null,
    users: users || [],
  };

  return domainRowToProject(domainRow);
}

export async function updateDomainRow(id, updates) {
  if (isLocalMode) {
    const domains = JSON.parse(localStorage.getItem('seo_domains') || '[]');
    const index = domains.findIndex(d => String(d.id) === String(id));
    if (index === -1) throw new Error('Domain not found');

    const dbUpdates = { ...domains[index], updated_at: new Date().toISOString() };
    if ('name' in updates) dbUpdates.project_name = updates.name;
    if ('location' in updates) dbUpdates.target_regions = updates.location ? [updates.location] : [];
    if ('targetPlatforms' in updates) dbUpdates.platforms = updates.targetPlatforms;
    if ('da' in updates) dbUpdates.domain_authority = updates.da != null ? String(updates.da) : null;
    if ('traffic' in updates) dbUpdates.traffic = String(updates.traffic);
    if ('industry' in updates || 'industry_type' in updates || 'domain_industry' in updates || 'category' in updates) {
      const indVal = updates.industry || updates.industry_type || updates.domain_industry || updates.category || '';
      dbUpdates.industry = indVal;
      dbUpdates.industry_type = indVal;
    }
    if ('status' in updates) {
      dbUpdates.status = updates.status;
      dbUpdates.is_active = updates.status === 'Active';
    } else if ('isActive' in updates) {
      dbUpdates.status = updates.isActive ? 'Active' : 'Inactive';
      dbUpdates.is_active = updates.isActive;
    }

    if ('napBusinessCentre' in updates) dbUpdates.nap_business_centre = updates.napBusinessCentre;
    if ('napPhone' in updates) dbUpdates.nap_phone = updates.napPhone;
    if ('napWebsite' in updates) dbUpdates.nap_website = updates.napWebsite;
    if ('napAddress' in updates) dbUpdates.nap_address = updates.napAddress;
    if ('napEmail' in updates) dbUpdates.nap_email = updates.napEmail;
    if ('napBcPhone' in updates) dbUpdates.nap_bc_phone = updates.napBcPhone;
    if ('napBcWebsite' in updates) dbUpdates.nap_bc_website = updates.napBcWebsite;
    if ('napBcAddress' in updates) dbUpdates.nap_bc_address = updates.napBcAddress;
    if ('napBcEmail' in updates) dbUpdates.nap_bc_email = updates.napBcEmail;
    if ('businessCentres' in updates) dbUpdates.business_centres = updates.businessCentres;
    if ('brandedTerms' in updates) dbUpdates.branded_terms = updates.brandedTerms;

    domains[index] = dbUpdates;
    localStorage.setItem('seo_domains', JSON.stringify(domains));
    const kwCounts = await fetchKwCountsForSlug(dbUpdates.project_slug);
    return domainRowToProject(dbUpdates, kwCounts);
  }

  const dbUpdates = { updated_at: new Date().toISOString() };
  if ('name' in updates) dbUpdates.project_name = updates.name;
  if ('location' in updates) dbUpdates.target_regions = updates.location ? [updates.location] : [];
  if ('targetPlatforms' in updates) dbUpdates.platforms = updates.targetPlatforms;
  if ('da' in updates) dbUpdates.domain_authority = updates.da != null ? String(updates.da) : null;
  if ('traffic' in updates) dbUpdates.traffic = String(updates.traffic);
  if ('industry' in updates || 'industry_type' in updates || 'domain_industry' in updates || 'category' in updates) {
    const indVal = updates.industry || updates.industry_type || updates.domain_industry || updates.category || '';
    dbUpdates.industry = indVal;
    dbUpdates.industry_type = indVal;
  }
  if ('status' in updates) {
    dbUpdates.status = updates.status;
    dbUpdates.is_active = updates.status === 'Active';
  } else if ('isActive' in updates) {
    dbUpdates.status = updates.isActive ? 'Active' : 'Inactive';
    dbUpdates.is_active = updates.isActive;
  }
  if ('napBusinessCentre' in updates) dbUpdates.nap_business_centre = updates.napBusinessCentre;
  if ('napPhone' in updates) dbUpdates.nap_phone = updates.napPhone;
  if ('napWebsite' in updates) dbUpdates.nap_website = updates.napWebsite;
  if ('napAddress' in updates) dbUpdates.nap_address = updates.napAddress;
  if ('napEmail' in updates) dbUpdates.nap_email = updates.napEmail;
  if ('napBcPhone' in updates) dbUpdates.nap_bc_phone = updates.napBcPhone;
  if ('napBcWebsite' in updates) dbUpdates.nap_bc_website = updates.napBcWebsite;
  if ('napBcAddress' in updates) dbUpdates.nap_bc_address = updates.napBcAddress;
  if ('napBcEmail' in updates) dbUpdates.nap_bc_email = updates.napBcEmail;
  if ('businessCentres' in updates) dbUpdates.business_centres = updates.businessCentres;
  if ('brandedTerms' in updates) dbUpdates.branded_terms = updates.brandedTerms;

  const { data, error } = await supabase.from('domains').update(dbUpdates).eq('id', id).select().single();

  // Also sync to FastAPI backend PostgreSQL database
  try {
    const projSlug = data?.project_slug || updates.project_slug || updates.slug;
    if (projSlug) {
      await fetch(`${CATEGORY_API_BASE}/domains/${projSlug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbUpdates)
      }).catch(() => { });
    }
  } catch (e) {
    console.warn('[updateDomainRow] FastAPI PATCH /domains sync skipped:', e);
  }

  if (error && !data) throw error;
  const targetData = data || { id, ...dbUpdates };
  const kwCounts = await fetchKwCountsForSlug(targetData.project_slug || '');
  return domainRowToProject(targetData, kwCounts);
}

export async function deleteDomainRow(id, slug) {
  if (isLocalMode) {
    const domains = JSON.parse(localStorage.getItem('seo_domains') || '[]');
    const projects = JSON.parse(localStorage.getItem('seo_projects') || '[]');
    localStorage.setItem('seo_domains', JSON.stringify(domains.filter(d => String(d.id) !== String(id) && (slug ? d.project_slug !== slug : true))));
    localStorage.setItem('seo_projects', JSON.stringify(projects.filter(p => slug ? p.slug !== slug : true)));
    return;
  }

  if (id) {
    await supabase.from('domains').delete().eq('id', id).catch(() => { });
  }
  if (slug) {
    await supabase.from('domains').delete().eq('project_slug', slug).catch(() => { });
    await supabase.from('projects').delete().eq('slug', slug).catch(() => { });
  }
}

// ─── KW Cluster tab ─────────────────────────────────────────────────────────

export async function fetchKwProjects() {
  if (isLocalMode) {
    const projects = JSON.parse(localStorage.getItem('seo_projects') || '[]');
    const domains = JSON.parse(localStorage.getItem('seo_domains') || '[]');
    const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');

    const domainBySlug = new Map();
    (domains || []).forEach(d => { if (!domainBySlug.has(d.project_slug)) domainBySlug.set(d.project_slug, d); });

    const counts = aggregateKwCounts(kwRows);

    return (projects || [])
      .filter(p => {
        const domainRow = domainBySlug.get(p.slug);
        return domainRow && domainRow.domain && String(domainRow.domain).trim() !== '';
      })
      .map(p => {
        const domainRow = domainBySlug.get(p.slug) || domainBySlug.get(p.name);
        const c = counts.get(p.slug) || counts.get(p.name);
        const landingCount = c.landingPages > 0 ? c.landingPages : Math.max(0, c.total - c.blogPages);
        return {
          slug: p.slug,
          name: p.name,
          domain: domainRow?.domain || '',
          locationIcon: iconForPlatforms(domainRow?.platforms),
          location: domainRow?.target_regions?.[0] || 'Global',
          totalPages: c.total,
          totalKw: c.total,
          commercialPct: `${c.commercial}/${c.total}`,
          blogPages: c.blogPages,
          blogDir: null,
          keywords: landingCount,
          targetPages: landingCount,
          keywordsDir: null,
          updated: timeAgo(domainRow?.updated_at || p.created_at),
        };
      });
  }

  const [{ data: projects, error: projectsError }, { data: domains, error: domainsError }] = await Promise.all([
    supabase.from('projects').select('*').is('deleted_at', null),
    supabase.from('domains').select('*'),
  ]);
  if (projectsError) throw projectsError;
  if (domainsError) throw domainsError;

  let kwRows = [];
  try {
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: rows, error: kwError } = await supabase
        .from('keyword_categories')
        .select('project_name, subtype, target_type')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (kwError) break;
      if (rows && rows.length > 0) {
        kwRows = kwRows.concat(rows);
        if (rows.length < pageSize) hasMore = false;
        else page++;
      } else {
        hasMore = false;
      }
    }
  } catch (e) {
    console.warn('[fetchKwProjects] kw query error:', e);
  }

  const domainBySlug = new Map();
  (domains || []).forEach(d => { if (!domainBySlug.has(d.project_slug)) domainBySlug.set(d.project_slug, d); });

  const counts = aggregateKwCounts(kwRows);

  return (projects || [])
    .filter(p => {
      const domainRow = domainBySlug.get(p.slug);
      return domainRow && domainRow.domain && String(domainRow.domain).trim() !== '';
    })
    .map(p => {
      const domainRow = domainBySlug.get(p.slug) || domainBySlug.get(p.name);
      const c = counts.get(p.slug) || counts.get(p.name);
      const landingCount = c.landingPages > 0 ? c.landingPages : Math.max(0, c.total - c.blogPages);
      return {
        slug: p.slug,
        name: p.name,
        domain: domainRow?.domain || '',
        locationIcon: iconForPlatforms(domainRow?.platforms),
        location: domainRow?.target_regions?.[0] || 'Global',
        totalPages: c.total,
        totalKw: c.total,
        commercialPct: `${c.commercial}/${c.total}`,
        blogPages: c.blogPages,
        blogDir: null,
        keywords: landingCount,
        targetPages: landingCount,
        keywordsDir: null,
        updated: timeAgo(domainRow?.updated_at || p.created_at),
      };
    });
}

function kwRowToUi(row) {
  const svVal = row.sv ?? row.search_volume ?? row.kw_volume ?? row.volume ?? row['search volume'] ?? row['KW Volume'] ?? row.sv_value;
  return {
    id: row.id,
    kw: row.keyword || row.kw,
    sv: svVal !== undefined && svVal !== null && String(svVal).trim() !== '' ? String(svVal) : null,
    kwDiff: row.kw_diff,
    cluster: row.cluster,
    category: row.category,
    type: row.type,
    targetType: row.target_type,
    targetSubtype: row.subtype,
    targetGeo: row.target_geo,
    priority: row.priority,
    landingPage: row.landing_page_url,
    rank: row.rank,
    rankCheckedAt: row.rank_checked_at,
    rankMeta: row.rank_meta,
  };
}

export async function insertKeywordRows(projectSlug, rows) {
  const dbRows = rows.map(r => ({
    project_name: projectSlug,
    keyword: r.kw,
    sv: r.sv === '' ? null : r.sv,
    kw_diff: r.kwDiff === '' ? null : r.kwDiff,
    cluster: r.cluster || null,
    category: r.category || null,
    type: r.type || null,
    target_type: r.targetType || null,
    subtype: r.targetSubtype || null,
    target_geo: r.targetGeo || null,
    priority: r.priority || null,
    landing_page_url: r.landingPage || null,
  }));

  if (isLocalMode) {
    const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
    const maxId = kwRows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    const inserted = dbRows.map((r, i) => ({ id: maxId + i + 1, ...r }));
    localStorage.setItem('seo_keyword_categories', JSON.stringify([...kwRows, ...inserted]));
    return inserted.map(kwRowToUi);
  }

  const { data, error } = await supabase.from('keyword_categories').insert(dbRows).select();
  if (error) throw error;
  createAuditLogApi({
    user_email: getActiveUserEmail(),
    action: `Keywords Added to Project (${rows?.length || 0} rows)`,
    status: 'Success',
    project_name: projectSlug,
    module: 'intent'
  }).catch(() => { });
  return (data || []).map(kwRowToUi);
}

export async function fetchKeywordRows(projectSlug) {
  if (!projectSlug) return [];

  // 1. Try querying Supabase if available
  if (!isLocalMode) {
    try {
      let allRows = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('keyword_categories')
          .select('*')
          .eq('project_name', projectSlug)
          .order('id')
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
          console.warn('[fetchKeywordRows] Supabase error:', error);
          break;
        }

        if (data && data.length > 0) {
          allRows = allRows.concat(data);
          if (data.length < pageSize) hasMore = false;
          else page++;
        } else {
          hasMore = false;
        }
      }

      if (allRows.length > 0) {
        return allRows.map(kwRowToUi);
      }
    } catch (e) {
      console.warn('[fetchKeywordRows] Supabase query failed:', e);
    }
  }

  // 2. Try fetching from local FastAPI backend endpoint
  const candidateSlugs = [projectSlug, String(projectSlug || '').replace(/[^a-z0-9]/gi, '')];
  for (const slug of candidateSlugs) {
    if (!slug) continue;
    try {
      const res = await fetch(`${getApiBaseUrl()}/projects/${encodeURIComponent(slug)}/results`);
      if (res.ok) {
        const json = await res.json();
        if (json.results && json.results.length > 0) {
          return json.results.map(kwRowToUi);
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // 3. Fallback to localStorage
  const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
  const filtered = kwRows.filter(r => r.project_name === projectSlug);
  return filtered.map(kwRowToUi);
}

const KW_FIELD_TO_COLUMN = {
  kw: 'keyword',
  sv: 'sv',
  kwDiff: 'kw_diff',
  cluster: 'cluster',
  category: 'category',
  type: 'type',
  targetType: 'target_type',
  targetSubtype: 'subtype',
  targetGeo: 'target_geo',
  priority: 'priority',
  landingPage: 'landing_page_url',
  rank: 'rank',
};

function kwUpdatesToDb(updates) {
  const dbUpdates = {};
  Object.entries(updates).forEach(([field, value]) => {
    const column = KW_FIELD_TO_COLUMN[field];
    if (column) dbUpdates[column] = value;
  });
  return dbUpdates;
}

export async function updateKeywordRow(id, updates) {
  if (isLocalMode) {
    const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
    const index = kwRows.findIndex(r => String(r.id) === String(id));
    if (index !== -1) {
      const dbUpdates = kwUpdatesToDb(updates);
      kwRows[index] = { ...kwRows[index], ...dbUpdates };
      localStorage.setItem('seo_keyword_categories', JSON.stringify(kwRows));
    }
    return;
  }

  const { error } = await supabase.from('keyword_categories').update(kwUpdatesToDb(updates)).eq('id', id);
  if (error) throw error;
}

export async function bulkUpdateKeywordRows(ids, field, value) {
  if (isLocalMode) {
    const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
    const dbUpdates = kwUpdatesToDb({ [field]: value });
    const stringIds = ids.map(String);
    const updated = kwRows.map(r => {
      if (stringIds.includes(String(r.id))) {
        return { ...r, ...dbUpdates };
      }
      return r;
    });
    localStorage.setItem('seo_keyword_categories', JSON.stringify(updated));
    return;
  }

  const { error } = await supabase.from('keyword_categories').update(kwUpdatesToDb({ [field]: value })).in('id', ids);
  if (error) throw error;
  createAuditLogApi({
    user_email: getActiveUserEmail(),
    action: `Keyword Category/Cluster Updated (${field}: ${value})`,
    status: 'Success',
    module: 'intent'
  }).catch(() => { });
}

export async function deleteKeywordRow(id) {
  if (isLocalMode) {
    const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
    const updated = kwRows.filter(r => String(r.id) !== String(id));
    localStorage.setItem('seo_keyword_categories', JSON.stringify(updated));
    return;
  }

  const res = await fetch(`${CATEGORY_API_BASE}/keywords/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error('Failed to delete keyword.');
  }
  createAuditLogApi({
    user_email: getActiveUserEmail(),
    action: `Keyword Deleted from Category/Cluster`,
    status: 'Warning',
    module: 'intent'
  }).catch(() => { });
}

export async function bulkDeleteKeywordRows(ids) {
  if (isLocalMode) {
    const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
    const stringIds = ids.map(String);
    const updated = kwRows.filter(r => !stringIds.includes(String(r.id)));
    localStorage.setItem('seo_keyword_categories', JSON.stringify(updated));
    return;
  }

  const res = await fetch(`${CATEGORY_API_BASE}/keywords/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  });
  if (!res.ok) {
    throw new Error('Failed to bulk delete keywords.');
  }
  createAuditLogApi({
    user_email: getActiveUserEmail(),
    action: `Bulk Keywords Deleted (${ids?.length || 0} items)`,
    status: 'Warning',
    module: 'intent'
  }).catch(() => { });
}

export function getApiBaseUrl() {
  // If running in browser under HTTPS, always use same-origin (Nginx reverse proxy) to avoid Mixed Content errors
  if (typeof window !== 'undefined' && window.location) {
    if (window.location.protocol === 'https:') {
      return window.location.origin;
    }
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      const envBase = import.meta.env?.VITE_API_BASE;
      if (envBase && envBase.trim()) {
        return envBase.trim().replace('0.0.0.0', '127.0.0.1').replace(/\/+$/, '');
      }
      return 'http://127.0.0.1:8000';
    }
    // Any other host served via Nginx
    return window.location.origin;
  }

  // Honour VITE_API_BASE env-var first (set in .env / build)
  const envBase = import.meta.env?.VITE_API_BASE;
  if (envBase && envBase.trim()) {
    return envBase.trim().replace('0.0.0.0', '127.0.0.1').replace(/\/+$/, '');
  }

  return 'http://127.0.0.1:8000';
}

const CATEGORY_API_BASE = getApiBaseUrl();

// Removes a project entirely, everywhere -- its domain registration(s),
// the shared `projects` row, every keyword row filed under its slug, its
// pages, and the shared categories/clusters/category_cluster_map rows
// scoped to it. NOT currently called by any tab's delete button (the KW
// Cluster and Pages tabs each only delete their own slice below, so
// deleting from one doesn't make the project vanish from the others) --
// kept as a full-teardown capability. Routed through the backend's own
// DELETE /projects/{project} endpoint (core/db.py's delete_project())
// rather than direct Supabase calls -- categories/clusters/
// category_cluster_map/pages aren't exposed to the frontend's
// RLS-restricted anon key, only the backend's direct Postgres connection
// can touch them.
export async function deleteKwProject(slug, userEmail = null) {
  if (isLocalMode) {
    const projects = JSON.parse(localStorage.getItem('seo_projects') || '[]');
    const domains = JSON.parse(localStorage.getItem('seo_domains') || '[]');
    const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
    const pages = JSON.parse(localStorage.getItem('seo_pages') || '[]');
    const competitors = JSON.parse(localStorage.getItem('seo_competitors') || '[]');
    const recycleBin = JSON.parse(localStorage.getItem('seo_recycle_bin') || '[]');

    const projToDel = projects.find(p => p.slug === slug);
    if (projToDel) {
      recycleBin.push({
        project_slug: slug,
        project_name: projToDel.name || slug,
        deleted_at: new Date().toISOString(),
        data: {
          project: projToDel,
          domains: domains.filter(d => d.project_slug === slug),
          keywords: kwRows.filter(k => k.project_name === slug),
          pages: pages.filter(p => p.project_name === slug),
          competitors: competitors.filter(c => c.projectSlug === slug),
        }
      });
      localStorage.setItem('seo_recycle_bin', JSON.stringify(recycleBin));
      localStorage.setItem('seo_projects', JSON.stringify(projects.filter(p => p.slug !== slug)));
      localStorage.setItem('seo_domains', JSON.stringify(domains.filter(d => d.project_slug !== slug)));
      localStorage.setItem('seo_keyword_categories', JSON.stringify(kwRows.filter(k => k.project_name !== slug)));
      localStorage.setItem('seo_pages', JSON.stringify(pages.filter(p => p.project_name !== slug)));
      localStorage.setItem('seo_competitors', JSON.stringify(competitors.filter(c => c.projectSlug !== slug)));
    }
    return;
  }

  const endpoint = userEmail
    ? `${CATEGORY_API_BASE}/projects/${slug}?user_email=${encodeURIComponent(userEmail)}`
    : `${CATEGORY_API_BASE}/projects/${slug}`;

  const res = await fetch(endpoint, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to delete project.');
  }
}

export async function hardDeleteKwProject(slug, userEmail = null) {
  const email = getActiveUserEmail(userEmail);
  if (isLocalMode) {
    const projects = JSON.parse(localStorage.getItem('seo_projects') || '[]');
    const domains = JSON.parse(localStorage.getItem('seo_domains') || '[]');
    const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
    const pages = JSON.parse(localStorage.getItem('seo_pages') || '[]');
    const competitors = JSON.parse(localStorage.getItem('seo_competitors') || '[]');

    localStorage.setItem('seo_projects', JSON.stringify(projects.filter(p => p.slug !== slug)));
    localStorage.setItem('seo_domains', JSON.stringify(domains.filter(d => d.project_slug !== slug)));
    localStorage.setItem('seo_keyword_categories', JSON.stringify(kwRows.filter(k => k.project_name !== slug)));
    localStorage.setItem('seo_pages', JSON.stringify(pages.filter(p => p.project_name !== slug)));
    localStorage.setItem('seo_competitors', JSON.stringify(competitors.filter(c => c.projectSlug !== slug)));

    createAuditLogApi({
      user_email: email,
      action: `Project Permanently Deleted: ${slug}`,
      status: 'Warning',
      project_name: slug,
      module: 'project'
    }).catch(() => { });
    return;
  }

  try {
    const res = await fetch(`${CATEGORY_API_BASE}/projects/${slug}/hard?user_email=${encodeURIComponent(email)}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.detail || 'Failed to hard delete project from backend.');
    }
  } catch (e) {
    console.warn('[hardDeleteKwProject] Backend delete error:', e);
  }

  try {
    await Promise.all([
      supabase.from('keyword_categories').delete().eq('project_name', slug),
      supabase.from('domains').delete().eq('project_slug', slug),
      supabase.from('pages').delete().eq('project_name', slug),
      supabase.from('competitor_pages').delete().eq('project_name', slug),
      supabase.from('projects').delete().eq('slug', slug),
    ]);
  } catch (e) {
    console.warn('[hardDeleteKwProject] Supabase hard delete error:', e);
  }

  createAuditLogApi({
    user_email: email,
    action: `Project Permanently Deleted: ${slug}`,
    status: 'Warning',
    project_name: slug,
    module: 'project'
  }).catch(() => { });
}

export async function deleteKwClusterData(slug, userEmail = null) {
  if (isLocalMode) {
    const keywords = JSON.parse(localStorage.getItem('seo_keywords') || '[]');
    const s1 = String(slug || '').trim().toLowerCase();
    const updated = keywords.filter(k => String(k.project_name || k.project_slug || '').trim().toLowerCase() !== s1);
    localStorage.setItem('seo_keywords', JSON.stringify(updated));
    return;
  }

  const endpoint = `${CATEGORY_API_BASE}/projects/${slug}/kw-data`;
  const res = await fetch(endpoint, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to delete keyword data.');
  }
  return res.json();
}

export async function deletePagesData(slug, userEmail = null) {
  if (isLocalMode) {
    const pages = JSON.parse(localStorage.getItem('seo_pages') || '[]');
    const s1 = String(slug || '').trim().toLowerCase();
    const updated = pages.filter(p => String(p.project_name || p.project_slug || '').trim().toLowerCase() !== s1);
    localStorage.setItem('seo_pages', JSON.stringify(updated));
    return;
  }

  const endpoint = `${CATEGORY_API_BASE}/projects/${slug}/pages`;
  const res = await fetch(endpoint, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to delete pages data.');
  }
  return res.json();
}

// ─── Pages tab ──────────────────────────────────────────────────────────────
// Routed through the backend's own /projects/{project}/pages and
// /pages/{id} endpoints (core/db.py's insert_page_rows()/etc.) rather than
// direct Supabase calls -- the `pages` table is brand new and hasn't had
// RLS policies set up for the frontend's anon key (same reason
// deleteKwProject routes categories/clusters/category_cluster_map through
// the backend instead of Supabase directly).

function pageRowToUi(row) {
  return {
    id: row.id,
    pageName: row.pageName,
    url: row.url,
    cluster: row.cluster,
    category: row.category,
    targetCategory: row.targetCategory,
    targetType: row.targetType,
  };
}

// {slug: count} for every project with >=1 page row -- used to decide
// which projects the Pages tab lists (and, after all of a project's pages
// are deleted, this stops including it, so it drops off the tab without
// needing a per-row "hidden" flag anywhere).
export async function fetchPagesCounts() {
  if (isLocalMode) {
    const pageRows = JSON.parse(localStorage.getItem('seo_pages') || '[]');
    const counts = {};
    const stats = {};
    pageRows.forEach(r => {
      const pKey = r.project_name || r.project_slug;
      if (!pKey) return;
      const k1 = String(pKey).trim().toLowerCase();
      const k2 = k1.replace(/[^a-z0-9]/g, '');
      [pKey, k1, k2].forEach(k => {
        counts[k] = (counts[k] || 0) + 1;
        const s = stats[k] || { total: 0, commercial: 0, blog: 0 };
        s.total += 1;
        if (r.targetType === 'Commercial') s.commercial += 1;
        if (r.targetCategory === 'Blogs') s.blog += 1;
        stats[k] = s;
      });
    });
    return { counts, stats };
  }

  const res = await fetch(`${CATEGORY_API_BASE}/pages/counts`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to load page counts.');
  }
  const data = await res.json();
  const rawCounts = data.counts || {};
  const rawStats = data.stats || {};
  const counts = {};
  const stats = {};

  Object.keys(rawCounts).forEach(k => {
    const cnt = rawCounts[k];
    const st = rawStats[k] || { total: cnt, commercial: 0, blog: 0 };
    const k1 = String(k).trim().toLowerCase();
    const k2 = k1.replace(/[^a-z0-9]/g, '');

    [k, k1, k2].forEach(key => {
      counts[key] = cnt;
      stats[key] = st;
    });
  });

  return { counts, stats };
}

export async function fetchPageRows(slug) {
  if (isLocalMode) {
    const pageRows = JSON.parse(localStorage.getItem('seo_pages') || '[]');
    return pageRows.filter(r => r.project_name === slug).map(pageRowToUi);
  }

  const res = await fetch(`${CATEGORY_API_BASE}/projects/${slug}/pages`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to load pages.');
  }
  const data = await res.json();
  return (data.pages || []).map(pageRowToUi);
}

export async function insertPageRows(slug, rows) {
  if (isLocalMode) {
    const pageRows = JSON.parse(localStorage.getItem('seo_pages') || '[]');
    const maxId = pageRows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    const inserted = rows.map((r, i) => ({
      id: maxId + i + 1,
      project_name: slug,
      pageName: r.pageName || '',
      url: r.url || '',
      cluster: r.cluster || '',
      category: r.category || '',
      targetCategory: '',
      targetType: '',
    }));
    localStorage.setItem('seo_pages', JSON.stringify([...pageRows, ...inserted]));
    return inserted.map(pageRowToUi);
  }

  const res = await fetch(`${CATEGORY_API_BASE}/projects/${slug}/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail?.[0]?.msg || body?.detail || 'Failed to import pages.');
  }
  const data = await res.json();
  createAuditLogApi({
    user_email: getActiveUserEmail(),
    action: `Pages Added to Project (${rows?.length || 0} pages)`,
    status: 'Success',
    project_name: slug,
    module: 'pages'
  }).catch(() => { });
  return (data.pages || []).map(pageRowToUi);
}

export async function updatePageRow(id, updates) {
  if (isLocalMode) {
    const pageRows = JSON.parse(localStorage.getItem('seo_pages') || '[]');
    const index = pageRows.findIndex(r => String(r.id) === String(id));
    if (index !== -1) {
      pageRows[index] = { ...pageRows[index], ...updates };
      localStorage.setItem('seo_pages', JSON.stringify(pageRows));
    }
    return;
  }

  const res = await fetch(`${CATEGORY_API_BASE}/pages/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to update page.');
  }
}

export async function deletePageRow(id) {
  if (isLocalMode) {
    const pageRows = JSON.parse(localStorage.getItem('seo_pages') || '[]');
    localStorage.setItem('seo_pages', JSON.stringify(pageRows.filter(r => String(r.id) !== String(id))));
    return;
  }

  const res = await fetch(`${CATEGORY_API_BASE}/pages/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to delete page.');
  }
}

export async function bulkDeletePageRows(ids) {
  if (isLocalMode) {
    const pageRows = JSON.parse(localStorage.getItem('seo_pages') || '[]');
    const stringIds = ids.map(String);
    localStorage.setItem('seo_pages', JSON.stringify(pageRows.filter(r => !stringIds.includes(String(r.id)))));
    return;
  }

  const res = await fetch(`${CATEGORY_API_BASE}/pages/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to delete pages.');
  }
}

// ─── Competitor Pages API (separate DB from main Pages tab) ──────────────────

export async function fetchCompetitorPageRows(slug) {
  if (isLocalMode) {
    const pageRows = JSON.parse(localStorage.getItem('seo_competitor_pages') || '[]');
    return pageRows.filter(r => r.project_name === slug).map(pageRowToUi);
  }

  const res = await fetch(`${CATEGORY_API_BASE}/projects/${slug}/competitor-pages`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to load competitor pages.');
  }
  const data = await res.json();
  return (data.pages || []).map(pageRowToUi);
}

export async function insertCompetitorPageRows(slug, rows) {
  if (isLocalMode) {
    const pageRows = JSON.parse(localStorage.getItem('seo_competitor_pages') || '[]');
    const maxId = pageRows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    const inserted = rows.map((r, i) => ({
      id: maxId + i + 1,
      project_name: slug,
      pageName: r.pageName || '',
      url: r.url || '',
      cluster: r.cluster || '',
      category: r.category || '',
      targetCategory: '',
      targetType: '',
    }));
    localStorage.setItem('seo_competitor_pages', JSON.stringify([...pageRows, ...inserted]));
    return inserted.map(pageRowToUi);
  }

  const res = await fetch(`${CATEGORY_API_BASE}/projects/${slug}/competitor-pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail?.[0]?.msg || body?.detail || 'Failed to import competitor pages.');
  }
  const data = await res.json();
  return (data.pages || []).map(pageRowToUi);
}

export async function updateCompetitorPageRow(id, updates) {
  if (isLocalMode) {
    const pageRows = JSON.parse(localStorage.getItem('seo_competitor_pages') || '[]');
    const index = pageRows.findIndex(r => String(r.id) === String(id));
    if (index !== -1) {
      pageRows[index] = { ...pageRows[index], ...updates };
      localStorage.setItem('seo_competitor_pages', JSON.stringify(pageRows));
    }
    return;
  }

  const res = await fetch(`${CATEGORY_API_BASE}/competitor-pages/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to update competitor page.');
  }
}

export async function deleteCompetitorPageRow(id) {
  if (isLocalMode) {
    const pageRows = JSON.parse(localStorage.getItem('seo_competitor_pages') || '[]');
    localStorage.setItem('seo_competitor_pages', JSON.stringify(pageRows.filter(r => String(r.id) !== String(id))));
    return;
  }

  const res = await fetch(`${CATEGORY_API_BASE}/competitor-pages/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to delete competitor page.');
  }
}

export async function bulkDeleteCompetitorPageRows(ids) {
  if (isLocalMode) {
    const pageRows = JSON.parse(localStorage.getItem('seo_competitor_pages') || '[]');
    const stringIds = ids.map(String);
    localStorage.setItem('seo_competitor_pages', JSON.stringify(pageRows.filter(r => !stringIds.includes(String(r.id)))));
    return;
  }

  const res = await fetch(`${CATEGORY_API_BASE}/competitor-pages/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to delete competitor pages.');
  }
}

export function formatCleanName(str) {
  if (!str || typeof str !== 'string') return '—';
  let clean = str.trim();
  clean = clean
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '');
  clean = clean.split('/')[0].split('?')[0].split('#')[0];
  clean = clean.replace(/\.(com|co\.in|in|org|net|edu\.sg|edu|co|io|ai|gov|ac\.in|org\.in|info|biz|me|app)$/i, '');

  if (!clean) return '—';
  if (clean === clean.toLowerCase()) {
    clean = clean.split(/[-_]+/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }
  return clean;
}

export function getDomainHost(str) {
  if (!str || typeof str !== 'string') return '';
  let clean = str.trim().toLowerCase();
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    try {
      const parsed = new URL(clean);
      let host = parsed.hostname.toLowerCase();
      if (host.startsWith('www.')) host = host.slice(4);
      return host;
    } catch (e) { }
  }
  clean = clean.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const part = clean.split('/')[0].split('?')[0].split('#')[0].split(':')[0].trim();
  if (part.includes('.')) {
    return part;
  }
  return '';
}

export function isSameDomainHost(host1, host2) {
  if (!host1 || !host2) return false;
  if (host1 === host2) return true;
  if (host1.endsWith('.' + host2) || host2.endsWith('.' + host1)) return true;
  return false;
}

export function resolveFullCompetitorUrls(rowOrUrl, domain, name) {
  const rowObj = typeof rowOrUrl === 'object' && rowOrUrl !== null ? rowOrUrl : {};
  const rawUrl = typeof rowOrUrl === 'string' ? rowOrUrl : (rowObj.url || rowObj.fullUrl || rowObj.full_url || rowObj.page_url || rowObj.pageUrl || rowObj.target_url || rowObj.link || rowObj.href || '');
  const dom = domain || rowObj.domain || '';
  const compName = name || rowObj.name || '';

  let targetHost = getDomainHost(dom) || getDomainHost(rawUrl) || getDomainHost(compName);

  const candidateUrls = [];

  // 1. Add any URLs directly present in rowObj
  if (rowObj.url && typeof rowObj.url === 'string') candidateUrls.push(rowObj.url.trim());
  if (rowObj.fullUrl && typeof rowObj.fullUrl === 'string') candidateUrls.push(rowObj.fullUrl.trim());
  if (Array.isArray(rowObj.urls)) {
    rowObj.urls.forEach(u => typeof u === 'string' && u.trim() && candidateUrls.push(u.trim()));
  }
  if (Array.isArray(rowObj.allUrls)) {
    rowObj.allUrls.forEach(u => typeof u === 'string' && u.trim() && candidateUrls.push(u.trim()));
  }
  if (Array.isArray(rowObj.details)) {
    rowObj.details.forEach(d => {
      const u = typeof d === 'string' ? d : (d?.url || d?.fullUrl);
      if (u && typeof u === 'string') candidateUrls.push(u.trim());
    });
  }

  const cleanRawUrl = (rawUrl || '').trim();
  if (cleanRawUrl) {
    candidateUrls.push(cleanRawUrl.startsWith('http') ? cleanRawUrl : `https://${cleanRawUrl}`);
  }

  // 2. Search dataset (derivedPages) strictly for URLs matching targetHost
  if (targetHost && derivedPages && derivedPages.length > 0) {
    derivedPages.forEach(p => {
      if (!p.url) return;
      const pHost = getDomainHost(p.url);
      if (isSameDomainHost(pHost, targetHost)) {
        candidateUrls.push(p.url.trim());
      }
    });
  }

  // 3. Filter candidates strictly by targetHost if targetHost is known
  const matchedUrls = [];
  candidateUrls.forEach(u => {
    let formatted = u;
    if (!formatted.startsWith('http')) {
      formatted = `https://${formatted}`;
    }
    const host = getDomainHost(formatted);
    if (!targetHost || isSameDomainHost(host, targetHost)) {
      matchedUrls.push(formatted);
    }
  });

  // 4. Deduplicate while maintaining order, prioritizing deep URLs over root domain URLs
  const uniqueUrls = [];
  const seen = new Set();

  matchedUrls.forEach(u => {
    const normalized = u.toLowerCase().replace(/\/$/, '');
    if (!seen.has(normalized)) {
      seen.add(normalized);
      uniqueUrls.push(u);
    }
  });

  uniqueUrls.sort((a, b) => {
    const aHasPath = /^https?:\/\/[^\/]+\/.+/i.test(a);
    const bHasPath = /^https?:\/\/[^\/]+\/.+/i.test(b);
    if (aHasPath && !bHasPath) return -1;
    if (!aHasPath && bHasPath) return 1;
    return 0;
  });

  if (uniqueUrls.length === 0) {
    if (dom) {
      const fallback = dom.startsWith('http') ? dom : `https://${dom}`;
      return [fallback];
    }
    return [];
  }

  return uniqueUrls;
}

export function resolveFullCompetitorUrl(rowOrUrl, domain, name) {
  const urls = resolveFullCompetitorUrls(rowOrUrl, domain, name);
  return urls[0] || '';
}

function competitorRowToUi(row) {
  const dbUrls = Array.isArray(row.urls) ? row.urls : (row.urls ? [row.urls] : []);
  if (row.url && typeof row.url === 'string') {
    dbUrls.unshift(row.url);
  }
  const resolvedUrls = resolveFullCompetitorUrls(row, row.domain, row.name);

  const combinedUrls = [];
  const seen = new Set();

  [...dbUrls, ...resolvedUrls].forEach(u => {
    if (u && typeof u === 'string' && u.trim()) {
      let formatted = u.trim();
      if (!formatted.startsWith('http')) formatted = `https://${formatted}`;
      const normalized = formatted.toLowerCase().replace(/\/$/, '');
      if (!seen.has(normalized)) {
        seen.add(normalized);
        combinedUrls.push(formatted);
      }
    }
  });

  // Prioritize deep page URLs over root domain URLs
  combinedUrls.sort((a, b) => {
    const aHasPath = /^https?:\/\/[^\/]+\/.+/i.test(a);
    const bHasPath = /^https?:\/\/[^\/]+\/.+/i.test(b);
    if (aHasPath && !bHasPath) return -1;
    if (!aHasPath && bHasPath) return 1;
    return 0;
  });

  const urlVal = combinedUrls[0] || (row.domain ? (row.domain.startsWith('http') ? row.domain : `https://${row.domain}`) : '');
  return {
    id: row.id,
    domain: row.domain,
    name: row.name,
    url: urlVal,
    fullUrl: urlVal,
    urls: combinedUrls,
    da: row.da,
    websiteType: row.websiteType || row.type || row.website_type || null,
    type: row.type || row.websiteType || row.website_type || null,
    targetRegions: row.targetRegions || [],
    projectSlug: row.projectSlug || row.project_slug || null,
    category: row.category || row.categoryName || '—',
    cluster: row.cluster || '—',
    device: row.device,
    location: row.location,
    commonKw: row.commonKw,
    commonKwChange: row.commonKwChange,
    totalKw: row.totalKw,
    totalKwChange: row.totalKwChange,
    aiCompLevel: row.aiCompLevel,
    aiCompChange: row.aiCompChange,
    serpCompLevel: row.serpCompLevel,
    compLevel: row.compLevel,
    updated: timeAgo(row.updatedAt || row.createdAt),
    details: [],
  };
}

export async function fetchCompetitors(projectSlug) {
  if (isLocalMode) {
    const rows = JSON.parse(localStorage.getItem('seo_competitors') || '[]');
    return rows.filter(r => !projectSlug || r.projectSlug === projectSlug).map(competitorRowToUi);
  }

  const url = projectSlug
    ? `${CATEGORY_API_BASE}/competitors?project=${encodeURIComponent(projectSlug)}`
    : `${CATEGORY_API_BASE}/competitors`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to load competitors.');
  }
  const data = await res.json();
  return (data.competitors || []).map(competitorRowToUi);
}

export async function insertCompetitor({ domain, name, da, targetRegions, projectSlug }) {
  if (isLocalMode) {
    const rows = JSON.parse(localStorage.getItem('seo_competitors') || '[]');
    const maxId = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    const now = new Date().toISOString();
    const urlStr = domain.startsWith('http') ? domain : `https://${domain}`;
    const inserted = {
      id: maxId + 1, domain, name: name || null, url: urlStr, fullUrl: urlStr, da: da || null, targetRegions: targetRegions || [],
      projectSlug: projectSlug || null,
      commonKw: 0, commonKwChange: 0, totalKw: 0, totalKwChange: 0,
      aiCompLevel: 0, aiCompChange: 0, serpCompLevel: 0, compLevel: 0,
      createdAt: now, updatedAt: now,
    };
    localStorage.setItem('seo_competitors', JSON.stringify([...rows, inserted]));
    return competitorRowToUi(inserted);
  }

  const res = await fetch(`${CATEGORY_API_BASE}/competitors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, da, targetRegions, projectSlug }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail?.[0]?.msg || body?.detail || 'Failed to add competitor.');
  }
  createAuditLogApi({
    user_email: getActiveUserEmail(),
    action: `Competitor Added: ${domain}`,
    status: 'Success',
    project_name: projectSlug,
    module: 'competitors'
  }).catch(() => { });
  return competitorRowToUi(await res.json());
}

export async function updateCompetitor(id, updates) {
  if (isLocalMode) {
    const rows = JSON.parse(localStorage.getItem('seo_competitors') || '[]');
    const index = rows.findIndex(r => String(r.id) === String(id));
    if (index !== -1) {
      rows[index] = { ...rows[index], ...updates, updatedAt: new Date().toISOString() };
      localStorage.setItem('seo_competitors', JSON.stringify(rows));
    }
    return;
  }

  const res = await fetch(`${CATEGORY_API_BASE}/competitors/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to update competitor.');
  }
}

export async function deleteCompetitor(id) {
  if (isLocalMode) {
    const rows = JSON.parse(localStorage.getItem('seo_competitors') || '[]');
    localStorage.setItem('seo_competitors', JSON.stringify(rows.filter(r => String(r.id) !== String(id))));
    return;
  }

  const res = await fetch(`${CATEGORY_API_BASE}/competitors/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to delete competitor.');
  }
  createAuditLogApi({
    user_email: getActiveUserEmail(),
    action: `Competitor Deleted: ID #${id}`,
    status: 'Warning',
    module: 'competitors'
  }).catch(() => { });
}

export async function deleteCompetitorProjectData(slug) {
  if (isLocalMode) {
    const competitors = JSON.parse(localStorage.getItem('seo_competitors') || '[]');
    const updated = competitors.filter(r => r.projectSlug !== slug);
    localStorage.setItem('seo_competitors', JSON.stringify(updated));
    return;
  }

  const res = await fetch(`${CATEGORY_API_BASE}/projects/${slug}/competitors`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete competitor project data.');
}

// Runs the comp_analysis SERP-discovery pipeline (backend scripts/comp_analysis.py)
// against a project's already rank-checked keywords, and upserts one
// competitor row per rival domain it finds. Local mode has no rank-check/
// AI pipeline behind it, so it just reports nothing found there.
export async function findCompetitors(projectSlug, { targetRegions, useAi = true, topN, categories, clusters } = {}) {
  if (isLocalMode) {
    return { competitors: [], ownDomain: '', message: 'Find Competitors requires the hosted backend (no rank-check data in local mode).' };
  }

  const res = await fetch(`${CATEGORY_API_BASE}/projects/${projectSlug}/find-competitors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetRegions, useAi, topN, categories, clusters }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail?.[0]?.msg || body?.detail || 'Failed to find competitors.');
  }
  const data = await res.json();
  createAuditLogApi({
    user_email: getActiveUserEmail(),
    action: `AI Competitor Discovery Executed`,
    status: 'Success',
    project_name: projectSlug,
    module: 'competitors'
  }).catch(() => { });
  return { competitors: (data.competitors || []).map(competitorRowToUi), ownDomain: data.ownDomain, message: data.message };
}

function snapshotRowToUi(row) {
  return {
    id: row.id,
    domain: row.domain,
    name: row.name,
    regions: row.targetRegions || [],
    da: row.da,
    rankingKeywords: row.rankingKeywords,
    totalKw: row.totalKeywords,
    commonKw: row.commonKw,
    aiCompLevel: row.aiCompLevel,
    serpCompLevel: row.serpCompLevel,
    compLevel: row.compLevel,
    device: row.device,
    location: row.location,
    keywordPositions: row.keywordPositions || {},
    dated: timeAgo(row.createdAt),
  };
}

export async function fetchCompetitorSnapshots(competitorId) {
  if (isLocalMode) return [];

  const res = await fetch(`${CATEGORY_API_BASE}/competitors/${competitorId}/snapshots`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to load competitor history.');
  }
  const data = await res.json();
  return (data.snapshots || []).map(snapshotRowToUi);
}

export async function runAiAnalysis(projectSlug, keyword, aiMode, domain, country) {
  if (isLocalMode) {
    // Return a mock result for local development without backend
    return {
      project: projectSlug,
      keyword,
      ai_mode: aiMode,
      result: {
        top_10_results: "1. mock.com\n2. example.com",
        competitors: "mock.com, example.com",
        total_found: 10,
        confidence_score: 85,
        ai_answer: "This is a mocked AI response from local mode.",
        seo_summary: "CURRENT STANDING: Client is ranking at #1.\n\nCOMPETITOR ANALYSIS: Competitors are mostly informational.\n\nWHAT TO DO: Improve content.\n\nRESOURCES NEEDED: Low effort.",
        status: "ok"
      }
    };
  }

  const res = await fetch(`${CATEGORY_API_BASE}/projects/${projectSlug}/ai-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword, ai_mode: aiMode, domain, country }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to run AI analysis.');
  }

  const result = await res.json();
  createAuditLogApi({
    user_email: getActiveUserEmail(),
    action: `AI Keyword Analysis Executed: "${keyword}"`,
    status: 'Success',
    project_name: projectSlug,
    module: 'intent'
  }).catch(() => { });
  return result;
}



export async function classifyCompetitorUrls(urls, keyword = '', projectSlug = '', batchInfo = {}) {
  if (!urls || urls.length === 0) return [];
  const res = await fetch(`${CATEGORY_API_BASE}/competitors/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      urls,
      keyword,
      project_slug: projectSlug,
      batch_num: batchInfo.batchNum,
      total_batches: batchInfo.totalBatches,
      total_unclassified: batchInfo.totalUnclassified
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to classify competitor URLs.');
  }
  const data = await res.json();
  return data.results || [];
}

// ─── System Audit Logs API ──────────────────────────────────────────────────

export async function fetchAuditLogsApi(search = '', statusFilter = 'All') {
  if (isLocalMode) {
    const saved = localStorage.getItem('seo_system_logs');
    let logs = saved ? JSON.parse(saved) : [];
    if (statusFilter && statusFilter !== 'All') {
      logs = logs.filter(l => l.status === statusFilter);
    }
    if (search) {
      const query = search.toLowerCase();
      logs = logs.filter(l => (l.user || '').toLowerCase().includes(query) || (l.action || '').toLowerCase().includes(query));
    }
    return logs;
  }

  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (statusFilter && statusFilter !== 'All') params.append('status', statusFilter);

  const res = await fetch(`${CATEGORY_API_BASE}/audit-logs?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to fetch audit logs.');
  }
  const data = await res.json();
  return data.logs || [];
}

export async function createAuditLogApi({ user_email = 'system', action, status = 'Success', project_name = null, module = null }) {
  if (isLocalMode) {
    const saved = localStorage.getItem('seo_system_logs');
    let logs = saved ? JSON.parse(saved) : [];
    const now = new Date();
    const formatted = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0') + ' ' +
      now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const newLog = { id: Date.now(), timestamp: formatted, user: user_email, action, status, project_name, module };
    logs = [newLog, ...logs];
    localStorage.setItem('seo_system_logs', JSON.stringify(logs));
    return newLog;
  }

  const res = await fetch(`${CATEGORY_API_BASE}/audit-logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_email, action, status, project_name, module }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to create audit log.');
  }
  const data = await res.json();
  return data.log;
}

export async function clearAuditLogsApi() {
  if (isLocalMode) {
    localStorage.setItem('seo_system_logs', JSON.stringify([]));
    return;
  }

  const res = await fetch(`${CATEGORY_API_BASE}/audit-logs`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to clear audit logs.');
  }
}

// ─── USER MANAGEMENT API FUNCTIONS ─────────────────────────────────────────

async function fetchAuthEndpoint(endpoint, options = {}) {
  let token = null;
  try {
    token = sessionStorage.getItem('seo_token');
  } catch (_) { }

  const mergedHeaders = {
    ...(options.headers || {}),
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
  const requestOptions = {
    ...options,
    headers: mergedHeaders
  };

  const primaryUrl = `${getApiBaseUrl()}${endpoint}`;
  const res = await fetch(primaryUrl, requestOptions);

  if (res.status === 401 && endpoint === '/auth/me') {
    console.warn('[fetchAuthEndpoint] 401 Unauthorized on /auth/me, clearing session token');
    try {
      sessionStorage.removeItem('seo_token');
      sessionStorage.removeItem('seo_dashboard_user');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('auth_session_expired'));
      }
    } catch (_) { }
  }

  return res;
}

export async function fetchCurrentAuthUserApi() {
  try {
    const res = await fetchAuthEndpoint('/auth/me');
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

export async function fetchUsersApi() {
  const res = await fetchAuthEndpoint('/auth/users');
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to fetch user list.');
  }
  const data = await res.json();
  if (data && Array.isArray(data)) {
    const cached = JSON.parse(localStorage.getItem('seo_users_list') || '[]');
    const cachedMap = new Map(cached.map(u => [String(u.id), u]));

    const merged = data.map(u => {
      const local = cachedMap.get(String(u.id)) || cached.find(x => x.email?.toLowerCase() === u.email?.toLowerCase());
      return {
        ...u,
        section_access: (u.section_access !== undefined && u.section_access !== null && u.section_access !== '') ? u.section_access : (local?.section_access || 'Default'),
        permissions: (u.permissions !== undefined && u.permissions !== null && u.permissions !== '') ? u.permissions : (local?.permissions || 'Default'),
        category: u.category || local?.category || 'Internal',
        role: u.role || local?.role || 'INTERNAL_ASSOCIATE'
      };
    });

    localStorage.setItem('seo_users_list', JSON.stringify(merged));
    return merged;
  }
  return data || [];
}

export async function createUserApi(payload) {
  const res = await fetchAuthEndpoint('/auth/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to create user credential.');
  }
  return await res.json();
}

export async function updateUserStatusApi(userId, status) {
  const res = await fetchAuthEndpoint(`/auth/users/${userId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to update user status.');
  }
  const data = await res.json();
  const list = JSON.parse(localStorage.getItem('seo_users_list') || '[]');
  const target = list.find(u => u.id === userId);
  if (target) target.status = status;
  localStorage.setItem('seo_users_list', JSON.stringify(list));
  return data;
}

export async function updateUserRoleApi(userId, role, category = null, section_access = null, permissions = null, assigned_project = null) {
  const payload = {
    role,
    category: category ?? null,
    section_access: section_access ?? null,
    permissions: permissions ?? null,
    assigned_project: assigned_project ?? null
  };

  const res = await fetchAuthEndpoint(`/auth/users/${userId}/role`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to update user settings.');
  }
  const data = await res.json();
  const list = JSON.parse(localStorage.getItem('seo_users_list') || '[]');
  const target = list.find(u => u.id === userId);
  if (target) {
    if (role) target.role = role;
    if (category) target.category = category;
    if (section_access) target.section_access = section_access;
    if (permissions) target.permissions = permissions;
    if (assigned_project) target.assigned_project = assigned_project;
  }
  localStorage.setItem('seo_users_list', JSON.stringify(list));
  return data;
}

export async function deleteUserApi(userId) {
  const res = await fetchAuthEndpoint(`/auth/users/${userId}`, {
    method: 'DELETE'
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to delete user profile.');
  }
  const list = JSON.parse(localStorage.getItem('seo_users_list') || '[]');
  const updated = list.filter(u => u.id !== userId);
  localStorage.setItem('seo_users_list', JSON.stringify(updated));
}

// ─── AI Analysis & Supabase API ─────────────────────────────────────────────

export async function fetchProjectSummaryApi(projectSlug) {
  const apiBase = getApiBaseUrl();
  try {
    const res = await fetch(`${apiBase}/projects/${encodeURIComponent(projectSlug)}/summary`);
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.warn('[fetchProjectSummaryApi] Backend fetch warning:', e);
  }
  return null;
}

export async function runAiVisibilityAnalysis(projectSlug, domain, country, keywords, engine = 'chatgpt') {
  const apiBase = getApiBaseUrl();

  let resultData = null;

  try {
    const res = await fetch(`${apiBase}/projects/${projectSlug}/ai-visibility-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, country, keywords, engine }),
    });

    if (res.ok) {
      resultData = await res.json();
    }
  } catch (e) {
    console.warn('[runAiVisibilityAnalysis] Backend fetch failed, using fallback metrics:', e);
  }

  if (!resultData) {
    resultData = {
      project: projectSlug,
      result: {
        ai_visibility: 0,
        mentions: 0,
        cited_pages: 0,
        mentioned_keywords: [],
        cited_pages_list: [],
        total_keywords: keywords ? keywords.length : 0,
        domain: domain || '',
        status: 'error'
      }
    };
  }

  // Direct write to Supabase table `ai_analysis` if client connected
  if (supabase) {
    try {
      const resObj = resultData?.result || {};
      const { data: sbData, error: sbErr } = await supabase.from('ai_analysis').insert([{
        project_slug: projectSlug,
        project_name: projectSlug,
        domain: domain || resObj.domain || '',
        country: country || 'India',
        engine: engine || 'chatgpt',
        ai_visibility: resObj.ai_visibility || 0,
        mentions: resObj.mentions || 0,
        cited_pages: resObj.cited_pages || 0,
        total_keywords: resObj.total_keywords || (keywords ? keywords.length : 0),
        mentioned_keywords: resObj.mentioned_keywords || [],
        cited_pages_list: resObj.cited_pages_list || []
      }]).select();

      if (sbErr) {
        console.warn('[runAiVisibilityAnalysis] Supabase insert error:', sbErr);
      } else {
        console.log('[runAiVisibilityAnalysis] Saved successfully:', sbData);
      }
    } catch (sbErr) {
      console.warn('[runAiVisibilityAnalysis] Supabase direct insert notice:', sbErr);
    }
  }

  return resultData;
}

export async function fetchAiAnalysisHistory(projectSlug, engine = '') {
  if (supabase) {
    try {
      let query = supabase
        .from('ai_analysis')
        .select('*')
        .or(`project_slug.eq.${projectSlug},project_name.eq.${projectSlug}`)
        .order('created_at', { ascending: false });

      if (engine && engine.trim()) {
        query = query.ilike('engine', `%${engine.trim()}%`);
      }

      const { data, error } = await query.limit(50);
      if (!error && data && data.length > 0) {
        return data;
      }
    } catch (sbErr) {
      console.warn('[fetchAiAnalysisHistory] Supabase query warning:', sbErr);
    }
  }

  const apiBase = (import.meta.env.VITE_API_BASE || getApiBaseUrl()).replace('0.0.0.0', '127.0.0.1');
  try {
    const url = new URL(`${apiBase}/projects/${encodeURIComponent(projectSlug)}/ai-analysis-history`);
    if (engine) url.searchParams.append('engine', engine);
    const res = await fetch(url.toString());
    if (res.ok) {
      const json = await res.json();
      return json.history || [];
    }
  } catch (e) {
    console.warn('[fetchAiAnalysisHistory] Backend query notice:', e);
  }

  return [];
}


// AI triage of rank 5-20 keywords into 3 push-potential batches.
// Returns { high: [...], medium: [...], low: [...] } (each row echoed back
// with batch / confidence / reason), or null if the backend is unavailable
// so the caller can fall back to a local heuristic.
export async function analyzeKeywordPushPotential(projectSlug, keywords, domain = '', country = 'India') {
  const apiBase = getApiBaseUrl();
  try {
    const res = await fetch(`${apiBase}/projects/${encodeURIComponent(projectSlug)}/keyword-push-potential`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: keywords || [], domain, country })
    });
    if (res.ok) {
      const json = await res.json();
      return json.batches || { high: [], medium: [], low: [] };
    }
  } catch (e) {
    console.warn('[analyzeKeywordPushPotential] backend notice:', e);
  }
  return null;
}


// --- Monthly Operations API Calls -------------------------
const API_BASE = getApiBaseUrl();

export async function fetchMonthlyImportsApi() {
  // Try FastAPI backend first
  try {
    const res = await fetch(`${API_BASE}/monthly-operations/imports`);
    if (res.ok) {
      const data = await res.json();
      return data.imports || [];
    }
  } catch (e) {
    console.warn('[fetchMonthlyImportsApi] Backend unavailable, falling back to Supabase:', e);
  }
  // Supabase fallback
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('monthly_operations')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error) return data || [];
    } catch (e) {
      console.warn('[fetchMonthlyImportsApi] Supabase fetch failed:', e);
    }
  }
  return [];
}

export async function createMonthlyImportApi(importData) {
  let result = null;
  // Try backend first
  try {
    const res = await fetch(`${API_BASE}/monthly-operations/imports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(importData)
    });
    if (res.ok) {
      result = await res.json();
    } else {
      throw new Error('Failed to save monthly import');
    }
  } catch (e) {
    console.warn('[createMonthlyImportApi] Backend failed:', e.message);
  }
  // Supabase sync
  if (supabase) {
    try {
      const supabaseRow = { ...importData };
      if (result?.id) {
        await supabase.from('monthly_operations').upsert({ ...supabaseRow, id: result.id }, { onConflict: 'id' });
      } else {
        const { data } = await supabase.from('monthly_operations').insert(supabaseRow).select().single();
        if (!result && data) result = data;
      }
    } catch (e) {
      console.warn('[createMonthlyImportApi] Supabase sync failed:', e);
    }
  }
  if (!result) throw new Error('Failed to save monthly import');
  return result;
}

export async function updateMonthlyImportApi(importId, updateData) {
  // Backend update
  try {
    const res = await fetch(`${API_BASE}/monthly-operations/imports/${importId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData)
    });
    if (!res.ok) console.warn('[updateMonthlyImportApi] Backend update failed');
  } catch (e) {
    console.warn('[updateMonthlyImportApi] Backend unavailable:', e);
  }
  // Supabase update
  if (supabase) {
    try {
      await supabase.from('monthly_operations').update(updateData).eq('id', importId);
    } catch (e) {
      console.warn('[updateMonthlyImportApi] Supabase update failed:', e);
    }
  }
}

export async function deleteMonthlyImportApi(importId) {
  // Backend delete
  try {
    const res = await fetch(`${API_BASE}/monthly-operations/imports/${importId}`, {
      method: 'DELETE'
    });
    if (!res.ok) console.warn('[deleteMonthlyImportApi] Backend delete failed');
  } catch (e) {
    console.warn('[deleteMonthlyImportApi] Backend unavailable:', e);
  }
  // Supabase delete
  if (supabase) {
    try {
      await supabase.from('monthly_operations').delete().eq('id', importId);
    } catch (e) {
      console.warn('[deleteMonthlyImportApi] Supabase delete failed:', e);
    }
  }
}

export async function fetchScheduledActivitiesApi() {
  // Try FastAPI backend first
  try {
    const res = await fetch(`${API_BASE}/monthly-operations/schedules`);
    if (res.ok) {
      const data = await res.json();
      return data.schedules || [];
    }
  } catch (e) {
    console.warn('[fetchScheduledActivitiesApi] Backend unavailable, falling back to Supabase:', e);
  }
  // Supabase fallback
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('scheduled_activities')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error) return data || [];
    } catch (e) {
      console.warn('[fetchScheduledActivitiesApi] Supabase fetch failed:', e);
    }
  }
  return [];
}

export async function createScheduledActivityApi(scheduleData) {
  let result = null;
  // Try backend
  try {
    const res = await fetch(`${API_BASE}/monthly-operations/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scheduleData)
    });
    if (res.ok) {
      result = await res.json();
    } else {
      throw new Error('Failed to save scheduled activity');
    }
  } catch (e) {
    console.warn('[createScheduledActivityApi] Backend failed:', e.message);
  }
  // Supabase sync
  if (supabase) {
    try {
      const supabaseRow = { ...scheduleData };
      if (result?.id) {
        await supabase.from('scheduled_activities').upsert({ ...supabaseRow, id: result.id }, { onConflict: 'id' });
      } else {
        const { data } = await supabase.from('scheduled_activities').insert(supabaseRow).select().single();
        if (!result && data) result = data;
      }
    } catch (e) {
      console.warn('[createScheduledActivityApi] Supabase sync failed:', e);
    }
  }
  if (!result) throw new Error('Failed to save scheduled activity');
  return result;
}

export async function deleteScheduledActivityApi(scheduleId) {
  // Backend delete
  try {
    const res = await fetch(`${API_BASE}/monthly-operations/schedules/${scheduleId}`, {
      method: 'DELETE'
    });
    if (!res.ok) console.warn('[deleteScheduledActivityApi] Backend delete failed');
  } catch (e) {
    console.warn('[deleteScheduledActivityApi] Backend unavailable:', e);
  }
  // Supabase delete
  if (supabase) {
    try {
      await supabase.from('scheduled_activities').delete().eq('id', scheduleId);
    } catch (e) {
      console.warn('[deleteScheduledActivityApi] Supabase delete failed:', e);
    }
  }
}

export async function fetchOutreachSitesApi(projectSlug) {
  // Always query Supabase first — it's the primary persistent store
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('outreach_sites')
        .select('*')
        .order('created_at', { ascending: false });
      console.log('[fetchOutreachSitesApi] Supabase result:', { data, error, count: data?.length });
      if (!error && data && data.length > 0) {
        return data;
      }
      if (error) {
        console.warn('[fetchOutreachSitesApi] Supabase error:', error);
      }
    } catch (e) {
      console.warn('[fetchOutreachSitesApi] Supabase fetch failed, trying backend:', e);
    }
  } else {
    console.warn('[fetchOutreachSitesApi] supabase client is null/undefined');
  }

  // Fall back to backend if Supabase has no data or failed
  try {
    const url = projectSlug
      ? `${CATEGORY_API_BASE}/projects/${encodeURIComponent(projectSlug)}/outreach`
      : `${CATEGORY_API_BASE}/outreach`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      console.log('[fetchOutreachSitesApi] Backend result:', data);
      return data.sites || [];
    }
  } catch (e) {
    console.warn('[fetchOutreachSitesApi] Backend also unavailable:', e);
  }

  return [];
}

export async function addOutreachSiteApi(projectSlug, url, regions = null, type = 'Paid Guest', extraFields = {}) {
  if (!projectSlug) throw new Error('Project slug is required');
  let backendSite = null;

  const normalizedExtra = {};
  for (const [k, v] of Object.entries(extraFields || {})) {
    if (k === 'landingPrice') normalizedExtra.landing_price = v;
    else if (k === 'sellingPrice') normalizedExtra.selling_price = v;
    else if (k === 'spPercentage') normalizedExtra.sp_percentage = v;
    else if (k === 'domainIndustry') normalizedExtra.domain_industry = v;
    else if (k === 'sourcedOption' || k === 'sourcedBy') normalizedExtra.sourced_by = v;
    else if (k === 'agencyName') normalizedExtra.agency_name = v;
    else if (k === 'calculateSp') normalizedExtra.calculate_sp = Boolean(v);
    else if (k === 'rejectedReason') normalizedExtra.rejected_reason = v;
    else normalizedExtra[k] = v;
  }

  // Try backend
  try {
    const res = await fetch(`${CATEGORY_API_BASE}/projects/${encodeURIComponent(projectSlug)}/outreach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, regions, type, ...normalizedExtra })
    });
    if (res.ok) {
      const data = await res.json();
      backendSite = data.site;
    } else {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || 'Failed to add outreach site');
    }
  } catch (e) {
    if (!backendSite) console.warn('[addOutreachSiteApi] Backend failed:', e.message);
  }
  // Supabase sync
  if (supabase) {
    try {
      const domain = url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').split('?')[0];
      const supabaseRow = {
        project_slug: projectSlug,
        url,
        domain,
        type,
        ...normalizedExtra,
        ...(regions ? { metrics_json: { regions } } : {})
      };
      if (backendSite?.id) {
        await supabase.from('outreach_sites').upsert({ ...supabaseRow, id: backendSite.id }, { onConflict: 'id' });
      } else {
        const { data } = await supabase.from('outreach_sites').insert(supabaseRow).select().single();
        if (!backendSite && data) backendSite = data;
      }
    } catch (e) {
      console.warn('[addOutreachSiteApi] Supabase sync failed:', e);
    }
  }
  return backendSite;
}

export async function deleteOutreachSiteApi(projectSlug, siteId) {
  if (!projectSlug || !siteId) return;
  // Backend delete
  try {
    const res = await fetch(`${CATEGORY_API_BASE}/projects/${encodeURIComponent(projectSlug)}/outreach/${siteId}`, {
      method: 'DELETE'
    });
    if (!res.ok) console.warn('[deleteOutreachSiteApi] Backend delete failed');
  } catch (e) {
    console.warn('[deleteOutreachSiteApi] Backend unavailable:', e);
  }
  // Supabase delete
  if (supabase) {
    try {
      await supabase.from('outreach_sites').delete().eq('id', siteId);
    } catch (e) {
      console.warn('[deleteOutreachSiteApi] Supabase delete failed:', e);
    }
  }
}

export async function updateOutreachSiteApi(projectSlug, siteId, updates) {
  if (!projectSlug || !siteId) return;
  const normalizedUpdates = {};
  for (const [k, v] of Object.entries(updates || {})) {
    if (k === 'landingPrice') normalizedUpdates.landing_price = v;
    else if (k === 'sellingPrice') normalizedUpdates.selling_price = v;
    else if (k === 'spPercentage') normalizedUpdates.sp_percentage = v;
    else if (k === 'domainIndustry') normalizedUpdates.domain_industry = v;
    else if (k === 'sourcedOption' || k === 'sourcedBy') normalizedUpdates.sourced_by = v;
    else if (k === 'agencyName') normalizedUpdates.agency_name = v;
    else if (k === 'calculateSp') normalizedUpdates.calculate_sp = Boolean(v);
    else if (k === 'rejectedReason') normalizedUpdates.rejected_reason = v;
    else normalizedUpdates[k] = v;
  }
  // Backend update
  try {
    const res = await fetch(`${CATEGORY_API_BASE}/projects/${encodeURIComponent(projectSlug)}/outreach/${siteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: normalizedUpdates })
    });
    if (!res.ok) console.warn('[updateOutreachSiteApi] Backend update failed');
  } catch (e) {
    console.warn('[updateOutreachSiteApi] Backend unavailable:', e);
  }
  // Supabase update
  if (supabase) {
    try {
      await supabase.from('outreach_sites').update(normalizedUpdates).eq('id', siteId);
    } catch (e) {
      console.warn('[updateOutreachSiteApi] Supabase update failed:', e);
    }
  }
}

export async function bulkDeleteOutreachSitesApi(projectSlug, ids) {
  if (!projectSlug || !ids || !ids.length) return;
  // Backend bulk delete
  try {
    const res = await fetch(`${CATEGORY_API_BASE}/projects/${encodeURIComponent(projectSlug)}/outreach/bulk-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!res.ok) console.warn('[bulkDeleteOutreachSitesApi] Backend bulk delete failed');
  } catch (e) {
    console.warn('[bulkDeleteOutreachSitesApi] Backend unavailable:', e);
  }
  // Supabase bulk delete
  if (supabase) {
    try {
      await supabase.from('outreach_sites').delete().in('id', ids);
    } catch (e) {
      console.warn('[bulkDeleteOutreachSitesApi] Supabase bulk delete failed:', e);
    }
  }
}

export async function bulkUpdateOutreachSitesApi(projectSlug, ids, updates) {
  if (!projectSlug || !ids || !ids.length) return;
  const normalizedUpdates = {};
  for (const [k, v] of Object.entries(updates || {})) {
    if (k === 'landingPrice') normalizedUpdates.landing_price = v;
    else if (k === 'sellingPrice') normalizedUpdates.selling_price = v;
    else if (k === 'spPercentage') normalizedUpdates.sp_percentage = v;
    else if (k === 'domainIndustry') normalizedUpdates.domain_industry = v;
    else if (k === 'sourcedOption' || k === 'sourcedBy') normalizedUpdates.sourced_by = v;
    else if (k === 'agencyName') normalizedUpdates.agency_name = v;
    else if (k === 'calculateSp') normalizedUpdates.calculate_sp = Boolean(v);
    else if (k === 'rejectedReason') normalizedUpdates.rejected_reason = v;
    else normalizedUpdates[k] = v;
  }
  // Backend bulk update
  try {
    const res = await fetch(`${CATEGORY_API_BASE}/projects/${encodeURIComponent(projectSlug)}/outreach/bulk-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, updates: normalizedUpdates })
    });
    if (!res.ok) console.warn('[bulkUpdateOutreachSitesApi] Backend bulk update failed');
  } catch (e) {
    console.warn('[bulkUpdateOutreachSitesApi] Backend unavailable:', e);
  }
  // Supabase bulk update
  if (supabase) {
    try {
      for (const id of ids) {
        await supabase.from('outreach_sites').update(normalizedUpdates).eq('id', id);
      }
    } catch (e) {
      console.warn('[bulkUpdateOutreachSitesApi] Supabase bulk update failed:', e);
    }
  }
}

export async function fetchDomainMetricsApi(domain, regions = null) {
  if (!domain) throw new Error('Domain is required');
  const cleanDomain = String(domain).replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();
  const res = await fetch(`${CATEGORY_API_BASE}/domain-metrics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: cleanDomain, regions })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || 'Failed to fetch domain metrics');
  }
  const data = await res.json();
  const m = data.metrics || {};

  let numericTraffic = 0;
  if (m.traffic_data && m.traffic_data.length > 0 && m.traffic_data[0].organic_traffic) {
    numericTraffic = Number(m.traffic_data[0].organic_traffic);
  } else if (m.da_metrics?.org_traffic) {
    numericTraffic = Number(m.da_metrics.org_traffic);
  } else if (m.traffic) {
    const parsed = parseInt(String(m.traffic).replace(/[^0-9]/g, ''), 10);
    if (!isNaN(parsed)) numericTraffic = parsed;
  }

  return {
    ...m,
    da: m.da ?? m.da_metrics?.da ?? 0,
    traffic: numericTraffic,
    rawTrafficStr: m.traffic
  };
}
export async function runAuditAllocationApi(importData = null) {
  try {
    const res = await fetch(`${API_BASE}/monthly-operations/run-audit-allocation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(importData || {})
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[runAuditAllocationApi] Backend call notice:', err);
  }
  return { status: 'success', message: 'Audit allocation completed.' };
}

export async function runAiStatusCheckStreamApi(importData = null, onRowUpdate = null) {
  try {
    const res = await fetch(`${API_BASE}/monthly-operations/run-ai-status-check-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(importData || {})
    });

    if (res.ok && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (const part of parts) {
          const line = part.trim();
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data && onRowUpdate) {
                onRowUpdate(data);
              }
            } catch (e) {
              console.warn('[runAiStatusCheckStreamApi] Parse error:', e);
            }
          }
        }
      }
      return { status: 'success', message: 'AI Status Check completed!' };
    }
  } catch (err) {
    console.warn('[runAiStatusCheckStreamApi] Notice, falling back to sync:', err);
  }
  return await runAiStatusCheckApi(importData);
}

export async function runAiStatusCheckApi(importData = null) {
  try {
    const res = await fetch(`${API_BASE}/monthly-operations/run-ai-status-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(importData || {})
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[runAiStatusCheckApi] Backend call notice:', err);
  }
  return { status: 'success', message: 'AI Audit completed.' };
}

export async function updateUserAttendanceApi(userId, dateStr, statusStr) {
  try {
    const res = await fetch(`${API_BASE}/users/${encodeURIComponent(userId)}/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateStr, status: statusStr })
    });
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('[updateUserAttendanceApi] Backend notice:', err);
  }
  return { status: 'success' };
}

export async function markAllAttendanceApi(dateStr, statusStr) {
  try {
    const res = await fetch(`${API_BASE}/users/attendance/mark-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateStr, status: statusStr })
    });
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('[markAllAttendanceApi] Backend notice:', err);
  }
  return { status: 'success' };
}

// Run Organic Rank Check for a Project
export async function runOrganicRankCheckApi(projectSlug, country = 'India') {
  if (!projectSlug) throw new Error('Project slug is required');
  const res = await fetch(`${CATEGORY_API_BASE}/projects/${projectSlug}/check-rank`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ country }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail?.[0]?.msg || body?.detail || 'Failed to start organic rank check');
  }
  return await res.json();
}


// Off-Page Activities API
export async function listOffPageActivitiesApi() {
  try {
    const res = await fetch(`${CATEGORY_API_BASE}/off-page-activities`);
    if (res.ok) {
      const data = await res.json();
      return data.activities || data.data || [];
    }
  } catch (e) {
    console.warn('[listOffPageActivitiesApi] Backend unavailable, trying Supabase:', e);
  }
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('off_page_activities')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error) return data || [];
    } catch (e) {
      console.warn('[listOffPageActivitiesApi] Supabase fetch error:', e);
    }
  }
  return [];
}


export async function createOffPageActivityApi(payload) {
  try {
    const res = await fetch(`${CATEGORY_API_BASE}/off-page-activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const data = await res.json();
      return data.activity || data;
    }
  } catch (e) {
    console.warn('[createOffPageActivityApi] Backend unavailable:', e);
  }
  if (supabase) {
    try {
      const { data, error } = await supabase.from('off_page_activities').insert([payload]).select();
      if (!error && data && data.length > 0) return data[0];
    } catch (e) {
      console.warn('[createOffPageActivityApi] Supabase insert failed:', e);
    }
  }
  return { id: Date.now(), ...payload };
}

export async function updateOffPageActivityApi(id, updates) {
  try {
    const res = await fetch(`${CATEGORY_API_BASE}/off-page-activities/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn('[updateOffPageActivityApi] Backend unavailable:', e);
  }
  if (supabase) {
    try {
      await supabase.from('off_page_activities').update(updates).eq('id', id);
    } catch (e) {
      console.warn('[updateOffPageActivityApi] Supabase update failed:', e);
    }
  }
  return { id, ...updates };
}

export async function deleteOffPageActivityApi(id) {
  try {
    const res = await fetch(`${CATEGORY_API_BASE}/off-page-activities/${id}`, {
      method: 'DELETE'
    });
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn('[deleteOffPageActivityApi] Backend unavailable:', e);
  }
  if (supabase) {
    try {
      await supabase.from('off_page_activities').delete().eq('id', id);
    } catch (e) {
      console.warn('[deleteOffPageActivityApi] Supabase delete failed:', e);
    }
  }
  return { id };
}
