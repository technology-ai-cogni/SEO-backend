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

function domainRowToProject(row) {
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
    keywords: Number(row.keywords_count) || 0,
    keywordsDir: null,
    targetPages: Number(row.target_pages_count) || 0,
    targetDir: null,
    blogPages: Number(row.blog_pages_count) || 0,
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
      target_subtype: k.targetSubtype,
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
    return domains.map(domainRowToProject);
  }
  const { data, error } = await supabase.from('domains').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(domainRowToProject);
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
    if ('keywords' in updates) dbUpdates.keywords_count = String(updates.keywords);
    if ('targetPages' in updates) dbUpdates.target_pages_count = String(updates.targetPages);
    if ('blogPages' in updates) dbUpdates.blog_pages_count = String(updates.blogPages);
    
    domains[index] = dbUpdates;
    localStorage.setItem('seo_domains', JSON.stringify(domains));
    return domainRowToProject(dbUpdates);
  }

  const dbUpdates = { updated_at: new Date().toISOString() };
  if ('name' in updates) dbUpdates.project_name = updates.name;
  if ('location' in updates) dbUpdates.target_regions = updates.location ? [updates.location] : [];
  if ('targetPlatforms' in updates) dbUpdates.platforms = updates.targetPlatforms;
  if ('da' in updates) dbUpdates.domain_authority = updates.da != null ? String(updates.da) : null;
  if ('traffic' in updates) dbUpdates.traffic = String(updates.traffic);
  if ('keywords' in updates) dbUpdates.keywords_count = String(updates.keywords);
  if ('targetPages' in updates) dbUpdates.target_pages_count = String(updates.targetPages);
  if ('blogPages' in updates) dbUpdates.blog_pages_count = String(updates.blogPages);

  const { data, error } = await supabase.from('domains').update(dbUpdates).eq('id', id).select().single();
  if (error) throw error;
  return domainRowToProject(data);
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
      const c = counts.get(r.project_name) || { total: 0, commercial: 0 };
      c.total += 1;
      if (r.target_subtype === 'Commercial') c.commercial += 1;
      counts.set(r.project_name, c);
    });

    return (projects || []).map(p => {
      const domainRow = domainBySlug.get(p.slug);
      const c = counts.get(p.slug) || { total: 0, commercial: 0 };
      return {
        slug: p.slug,
        name: p.name,
        domain: domainRow?.domain || '',
        locationIcon: iconForPlatforms(domainRow?.platforms),
        location: domainRow?.target_regions?.[0] || 'Global',
        totalPages: c.total,
        commercialPct: `${c.commercial}/${c.total}`,
        blogPages: 0,
        blogDir: null,
        keywords: c.total,
        keywordsDir: null,
        updated: timeAgo(domainRow?.updated_at || p.created_at),
      };
    });
  }

  const [{ data: projects, error: projectsError }, { data: domains, error: domainsError }, { data: kwRows, error: kwError }] = await Promise.all([
    supabase.from('projects').select('*'),
    supabase.from('domains').select('*'),
    supabase.from('keyword_categories').select('project_name, target_subtype'),
  ]);
  if (projectsError) throw projectsError;
  if (domainsError) throw domainsError;
  if (kwError) throw kwError;

  const domainBySlug = new Map();
  (domains || []).forEach(d => { if (!domainBySlug.has(d.project_slug)) domainBySlug.set(d.project_slug, d); });

  const counts = new Map();
  (kwRows || []).forEach(r => {
    const c = counts.get(r.project_name) || { total: 0, commercial: 0 };
    c.total += 1;
    if (r.target_subtype === 'Commercial') c.commercial += 1;
    counts.set(r.project_name, c);
  });

  return (projects || []).map(p => {
    const domainRow = domainBySlug.get(p.slug);
    const c = counts.get(p.slug) || { total: 0, commercial: 0 };
    return {
      slug: p.slug,
      name: p.name,
      domain: domainRow?.domain || '',
      locationIcon: iconForPlatforms(domainRow?.platforms),
      location: domainRow?.target_regions?.[0] || 'Global',
      totalPages: c.total,
      commercialPct: `${c.commercial}/${c.total}`,
      blogPages: 0,
      blogDir: null,
      keywords: c.total,
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
    targetSubtype: row.target_subtype,
    targetGeo: row.target_geo,
    priority: row.priority,
    landingPage: row.landing_page_url,
    rank: row.rank,
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
    target_subtype: r.targetSubtype || null,
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
  targetSubtype: 'target_subtype',
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
