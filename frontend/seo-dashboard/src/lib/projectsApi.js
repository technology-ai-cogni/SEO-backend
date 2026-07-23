import { supabase } from './supabaseClient';
import { derivedKeywordClusters } from '../data/mockData';

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
  (kwRows || []).forEach(r => {
    const c = counts.get(r.project_name) || { total: 0, commercial: 0, landingPages: 0, blogPages: 0 };
    c.total += 1;
    if (r.subtype === 'Commercial') c.commercial += 1;
    if (r.target_type === 'Landing Page') c.landingPages += 1;
    if (r.target_type === 'Blog Page') c.blogPages += 1;
    counts.set(r.project_name, c);
  });
  return counts;
}

async function fetchKwCountsForSlug(slug) {
  if (isLocalMode) {
    const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
    return aggregateKwCounts(kwRows.filter(r => r.project_name === slug)).get(slug) || EMPTY_KW_COUNTS;
  }
  const { data, error } = await supabase.from('keyword_categories').select('project_name, subtype, target_type').eq('project_name', slug);
  if (error) throw error;
  return aggregateKwCounts(data).get(slug) || EMPTY_KW_COUNTS;
}

function domainRowToProject(row, kwCounts = EMPTY_KW_COUNTS) {
  const targetPlatforms = row.platforms || [];
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
    keywords: kwCounts.total,
    keywordsDir: null,
    targetPages: kwCounts.landingPages,
    targetDir: null,
    blogPages: kwCounts.blogPages,
    updated: timeAgo(row.updated_at),
    targetPlatforms,
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
    return domains.map(d => domainRowToProject(d, counts.get(d.project_slug) || EMPTY_KW_COUNTS));
  }
  const [{ data: domains, error: domainsError }, { data: kwRows, error: kwError }] = await Promise.all([
    supabase.from('domains').select('*').order('created_at', { ascending: false }),
    supabase.from('keyword_categories').select('project_name, subtype, target_type'),
  ]);
  if (domainsError) throw domainsError;
  if (kwError) throw kwError;
  const counts = aggregateKwCounts(kwRows);
  return (domains || []).map(d => domainRowToProject(d, counts.get(d.project_slug) || EMPTY_KW_COUNTS));
}

export async function createProject({ name, domain, regions, platforms, da, users }) {
  const slug = slugify(name);
  
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

  const { error: projectError } = await supabase
    .from('projects')
    .upsert({ name, slug }, { onConflict: 'slug', ignoreDuplicates: true });
  if (projectError) throw projectError;

  const { data, error } = await supabase
    .from('domains')
    .insert({
      domain,
      project_name: name,
      project_slug: slug,
      target_regions: regions || [],
      platforms: (platforms || []).map(v => PLATFORM_LABELS[v] || v),
      domain_authority: da != null ? String(da) : null,
      users: users || [],
      traffic: '0',
      keywords_count: '0',
      target_pages_count: '0',
      blog_pages_count: '0',
    })
    .select()
    .single();
  if (error) throw error;
  return domainRowToProject(data);
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

  const { data, error } = await supabase.from('domains').update(dbUpdates).eq('id', id).select().single();
  if (error) throw error;
  const kwCounts = await fetchKwCountsForSlug(data.project_slug);
  return domainRowToProject(data, kwCounts);
}

export async function deleteDomainRow(id) {
  if (isLocalMode) {
    const domains = JSON.parse(localStorage.getItem('seo_domains') || '[]');
    const updated = domains.filter(d => String(d.id) !== String(id));
    localStorage.setItem('seo_domains', JSON.stringify(updated));
    return;
  }

  const { error } = await supabase.from('domains').delete().eq('id', id);
  if (error) throw error;
}

// ─── KW Cluster tab ─────────────────────────────────────────────────────────

export async function fetchKwProjects() {
  if (isLocalMode) {
    const projects = JSON.parse(localStorage.getItem('seo_projects') || '[]');
    const domains = JSON.parse(localStorage.getItem('seo_domains') || '[]');
    const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
    
    const domainBySlug = new Map();
    (domains || []).forEach(d => { if (!domainBySlug.has(d.project_slug)) domainBySlug.set(d.project_slug, d); });

    const counts = new Map();
    (kwRows || []).forEach(r => {
      const c = counts.get(r.project_name) || { total: 0, commercial: 0, landingPages: 0, blogPages: 0 };
      c.total += 1;
      if (r.subtype === 'Commercial') c.commercial += 1;
      if (r.target_type === 'Landing Page') c.landingPages += 1;
      if (r.target_type === 'Blog Page') c.blogPages += 1;
      counts.set(r.project_name, c);
    });

    return (projects || []).map(p => {
      const domainRow = domainBySlug.get(p.slug);
      const c = counts.get(p.slug) || { total: 0, commercial: 0, landingPages: 0, blogPages: 0 };
      return {
        slug: p.slug,
        name: p.name,
        domain: domainRow?.domain || '',
        locationIcon: iconForPlatforms(domainRow?.platforms),
        location: domainRow?.target_regions?.[0] || 'Global',
        totalPages: c.total,
        commercialPct: `${c.commercial}/${c.total}`,
        blogPages: c.blogPages,
        blogDir: null,
        keywords: c.landingPages,
        keywordsDir: null,
        updated: timeAgo(domainRow?.updated_at || p.created_at),
      };
    });
  }

  const [{ data: projects, error: projectsError }, { data: domains, error: domainsError }, { data: kwRows, error: kwError }] = await Promise.all([
    supabase.from('projects').select('*'),
    supabase.from('domains').select('*'),
    supabase.from('keyword_categories').select('project_name, subtype, target_type'),
  ]);
  if (projectsError) throw projectsError;
  if (domainsError) throw domainsError;
  if (kwError) throw kwError;

  const domainBySlug = new Map();
  (domains || []).forEach(d => { if (!domainBySlug.has(d.project_slug)) domainBySlug.set(d.project_slug, d); });

  const counts = new Map();
  (kwRows || []).forEach(r => {
    const c = counts.get(r.project_name) || { total: 0, commercial: 0, landingPages: 0, blogPages: 0 };
    c.total += 1;
    if (r.subtype === 'Commercial') c.commercial += 1;
    if (r.target_type === 'Landing Page') c.landingPages += 1;
    if (r.target_type === 'Blog Page') c.blogPages += 1;
    counts.set(r.project_name, c);
  });

  return (projects || []).map(p => {
    const domainRow = domainBySlug.get(p.slug);
    const c = counts.get(p.slug) || { total: 0, commercial: 0, landingPages: 0, blogPages: 0 };
    return {
      slug: p.slug,
      name: p.name,
      domain: domainRow?.domain || '',
      locationIcon: iconForPlatforms(domainRow?.platforms),
      location: domainRow?.target_regions?.[0] || 'Global',
      totalPages: c.total,
      commercialPct: `${c.commercial}/${c.total}`,
      blogPages: c.blogPages,
      blogDir: null,
      keywords: c.landingPages,
      keywordsDir: null,
      updated: timeAgo(domainRow?.updated_at || p.created_at),
    };
  });
}

function kwRowToUi(row) {
  return {
    id: row.id,
    kw: row.keyword,
    sv: row.sv,
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
  return (data || []).map(kwRowToUi);
}

export async function fetchKeywordRows(projectSlug) {
  if (isLocalMode) {
    const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
    const filtered = kwRows.filter(r => r.project_name === projectSlug);
    return filtered.map(kwRowToUi);
  }

  const { data, error } = await supabase
    .from('keyword_categories')
    .select('*')
    .eq('project_name', projectSlug)
    .order('id');
  if (error) throw error;
  return (data || []).map(kwRowToUi);
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
}

export async function deleteKeywordRow(id) {
  if (isLocalMode) {
    const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
    const updated = kwRows.filter(r => String(r.id) !== String(id));
    localStorage.setItem('seo_keyword_categories', JSON.stringify(updated));
    return;
  }

  const { error } = await supabase.from('keyword_categories').delete().eq('id', id);
  if (error) throw error;
}

export async function bulkDeleteKeywordRows(ids) {
  if (isLocalMode) {
    const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
    const stringIds = ids.map(String);
    const updated = kwRows.filter(r => !stringIds.includes(String(r.id)));
    localStorage.setItem('seo_keyword_categories', JSON.stringify(updated));
    return;
  }

  const { error } = await supabase.from('keyword_categories').delete().in('id', ids);
  if (error) throw error;
}

const CATEGORY_API_BASE = import.meta.env.VITE_API_BASE || 'http://54.196.75.9:8000';

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
export async function deleteKwProject(slug) {
  if (isLocalMode) {
    const domains = JSON.parse(localStorage.getItem('seo_domains') || '[]');
    localStorage.setItem('seo_domains', JSON.stringify(domains.filter(d => d.project_slug !== slug)));

    const projects = JSON.parse(localStorage.getItem('seo_projects') || '[]');
    localStorage.setItem('seo_projects', JSON.stringify(projects.filter(p => p.slug !== slug)));

    const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
    localStorage.setItem('seo_keyword_categories', JSON.stringify(kwRows.filter(r => r.project_name !== slug)));

    const pageRows = JSON.parse(localStorage.getItem('seo_pages') || '[]');
    localStorage.setItem('seo_pages', JSON.stringify(pageRows.filter(r => r.project_name !== slug)));
    return;
  }

  const res = await fetch(`${CATEGORY_API_BASE}/projects/${slug}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to delete project.');
  }
}

// Removes just this project's KW Cluster data (keyword_categories,
// categories, clusters, category_cluster_map) -- leaves the project, its
// domain registration, and its pages intact, so it still shows up on the
// Domain and Pages tabs afterward. This is what the KW Cluster tab's
// delete button calls.
export async function deleteKwClusterData(slug) {
  if (isLocalMode) {
    const kwRows = JSON.parse(localStorage.getItem('seo_keyword_categories') || '[]');
    localStorage.setItem('seo_keyword_categories', JSON.stringify(kwRows.filter(r => r.project_name !== slug)));
    return;
  }

  const res = await fetch(`${CATEGORY_API_BASE}/projects/${slug}/kw-data`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to delete keyword data.');
  }
}

// Removes just this project's page rows (Add Pages uploads) -- leaves the
// project, its domain registration, and its KW Cluster data intact, so it
// still shows up on the Domain and KW Cluster tabs afterward. This is
// what the Pages tab's delete button calls.
export async function deletePagesData(slug) {
  if (isLocalMode) {
    const pageRows = JSON.parse(localStorage.getItem('seo_pages') || '[]');
    localStorage.setItem('seo_pages', JSON.stringify(pageRows.filter(r => r.project_name !== slug)));
    return;
  }

  const res = await fetch(`${CATEGORY_API_BASE}/projects/${slug}/pages`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to delete pages.');
  }
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
      counts[r.project_name] = (counts[r.project_name] || 0) + 1;
      const s = stats[r.project_name] || { total: 0, commercial: 0, blog: 0 };
      s.total += 1;
      if (r.targetType === 'Commercial') s.commercial += 1;
      if (r.targetCategory === 'Blogs') s.blog += 1;
      stats[r.project_name] = s;
    });
    return { counts, stats };
  }

  const res = await fetch(`${CATEGORY_API_BASE}/pages/counts`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to load page counts.');
  }
  const data = await res.json();
  return { counts: data.counts || {}, stats: data.stats || {} };
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

// ─── Competitors tab ────────────────────────────────────────────────────────
// Each competitor is tracked against one project (projectSlug) -- routed
// through the backend (new table, same RLS-not-set-up-yet reasoning as
// pages) rather than Supabase directly.

function competitorRowToUi(row) {
  return {
    id: row.id,
    domain: row.domain,
    name: row.name,
    da: row.da,
    targetRegions: row.targetRegions || [],
    projectSlug: row.projectSlug || row.project_slug || null,
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
    const inserted = {
      id: maxId + 1, domain, name: name || null, da: da || null, targetRegions: targetRegions || [],
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
}

// Runs the comp_analysis SERP-discovery pipeline (backend scripts/comp_analysis.py)
// against a project's already rank-checked keywords, and upserts one
// competitor row per rival domain it finds. Local mode has no rank-check/
// AI pipeline behind it, so it just reports nothing found there.
export async function findCompetitors(projectSlug, { targetRegions, useAi = true, topN } = {}) {
  if (isLocalMode) {
    return { competitors: [], ownDomain: '', message: 'Find Competitors requires the hosted backend (no rank-check data in local mode).' };
  }

  const res = await fetch(`${CATEGORY_API_BASE}/projects/${projectSlug}/find-competitors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetRegions, useAi, topN }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail?.[0]?.msg || body?.detail || 'Failed to find competitors.');
  }
  const data = await res.json();
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

export async function runAiAnalysis(projectSlug, keyword, aiMode, domain) {
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
    body: JSON.stringify({ keyword, ai_mode: aiMode, domain }),
  });
  
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to run AI analysis.');
  }
  
  return await res.json();
}
