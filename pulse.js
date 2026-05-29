/* ──────────────────────────────────────────────────────────────
   Pulse — Lehigh Valley news feed

   Thin reader. birdstation (https://birds.alansbrain.com) fetches,
   dedupes, stores, and AI-enriches every source on a timer, then
   serves the merged result from a single endpoint. This page reads
   it once and renders: headlines with an AI category + one-sentence
   summary, a per-source health strip, and client-side filter/search
   (instant, no refetch).

   Items may arrive before enrichment has run, so category/ai_summary
   are treated as optional throughout.

   To add or remove a source you no longer touch this file: it's a row
   in birdstation's `feed_sources` table.
   ────────────────────────────────────────────────────────────── */

const FEED_URL = 'https://birds.alansbrain.com/api/feed?limit=200';
const DIGEST_URL = 'https://birds.alansbrain.com/api/digest';
const MAX_ITEMS = 120;

// Canonical category order (mirrors birdstation's pulse_enrich.py taxonomy)
// so the filter chips render in a stable, sensible order.
const TAXONOMY = [
  'Government & Politics', 'Public Safety & Crime', 'Business & Economy',
  'Education', 'Health', 'Weather & Environment', 'Transportation',
  'Sports', 'Arts & Culture', 'Community', 'Other'
];

const state = {
  items: [],
  sources: [],
  category: 'all',   // 'all' or a category string
  source: null,      // null or a sourceKey
  query: ''          // search text (lowercased)
};

/* ── Relative time ── */
function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.round(hrs / 24);
  if (days < 7) return days + 'd ago';
  return new Date(ts).toLocaleDateString();
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : s;
  return d.innerHTML;
}

/* ── Per-source health strip (doubles as a source filter) ── */
function renderStatus() {
  const strip = document.getElementById('pulse-status');
  if (!strip) return;
  strip.innerHTML = state.sources.map((s) => {
    const ok = s.last_status === 'ok';
    const cls = ok ? 'pulse-src-ok' : 'pulse-src-err';
    const active = state.source === s.key ? ' pulse-src-active' : '';
    const detail = ok ? ((s.last_count || 0) + ' items') : (s.last_status || 'no data yet');
    return '<button class="pulse-src ' + cls + active + '" data-src="' + escapeHtml(s.key) +
             '" title="' + escapeHtml(detail) + ' — click to filter">' +
             '<span class="pulse-src-dot"></span>' + escapeHtml(s.label) +
             ' <span class="pulse-src-meta">' + escapeHtml(detail) + '</span>' +
           '</button>';
  }).join('');
  strip.querySelectorAll('.pulse-src').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-src');
      state.source = state.source === key ? null : key;  // toggle
      renderStatus();
      renderArticles();
    });
  });
}

/* ── Category filter chips (only categories actually present) ── */
function renderFilters() {
  const bar = document.getElementById('pulse-filters');
  if (!bar) return;
  const present = new Set(state.items.map((it) => it.category).filter(Boolean));
  if (present.size === 0) { bar.innerHTML = ''; return; }  // nothing enriched yet
  const chips = ['all'].concat(TAXONOMY.filter((c) => present.has(c)));
  bar.innerHTML = chips.map((c) => {
    const active = state.category === c ? ' pulse-chip-active' : '';
    const label = c === 'all' ? 'All' : c;
    return '<button class="pulse-chip' + active + '" data-cat="' + escapeHtml(c) + '">' +
             escapeHtml(label) + '</button>';
  }).join('');
  bar.querySelectorAll('.pulse-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.category = btn.getAttribute('data-cat');
      renderFilters();
      renderArticles();
    });
  });
}

/* ── Apply active filters + search ── */
function filteredItems() {
  return state.items.filter((it) => {
    if (state.category !== 'all' && it.category !== state.category) return false;
    if (state.source && it.sourceKey !== state.source) return false;
    if (state.query) {
      const hay = ((it.title || '') + ' ' + (it.ai_summary || '') + ' ' + (it.source || '')).toLowerCase();
      if (hay.indexOf(state.query) === -1) return false;
    }
    return true;
  });
}

/* ── Render articles ── */
function renderArticles() {
  const list = document.getElementById('pulse-list');
  const items = filteredItems();

  if (items.length === 0) {
    list.innerHTML = '<div class="pulse-empty">No headlines match — clear a filter or search above.</div>';
    updateMeta(0);
    return;
  }

  list.innerHTML = items.slice(0, MAX_ITEMS).map((it) => {
    const when = relativeTime(it.published);
    const safeLink = it.link ? escapeHtml(it.link) : '#';
    const summary = it.ai_summary
      ? '<span class="pulse-item-summary">' + escapeHtml(it.ai_summary) + '</span>'
      : '';
    const cat = it.category
      ? '<span class="pulse-cat">' + escapeHtml(it.category) + '</span>'
      : '';
    return '<a class="pulse-item" href="' + safeLink + '" target="_blank" rel="noopener">' +
             '<div class="pulse-item-main">' +
               '<span class="pulse-item-title">' + escapeHtml(it.title) + '</span>' +
               summary +
             '</div>' +
             '<div class="pulse-item-meta">' +
               cat +
               '<span class="pulse-item-source">' + escapeHtml(it.source) + '</span>' +
               (when ? '<span class="pulse-item-time">' + escapeHtml(when) + '</span>' : '') +
             '</div>' +
           '</a>';
  }).join('');

  updateMeta(items.length);
}

function updateMeta(shown) {
  const updated = document.getElementById('pulse-updated');
  if (!updated) return;
  const total = state.items.length;
  const okCount = state.sources.filter((s) => s.last_status === 'ok').length;
  const headline = (shown === total ? total : shown + '/' + total) + ' headlines';
  updated.textContent = headline + ' · ' + okCount + '/' + state.sources.length +
                        ' sources · ' + new Date().toLocaleTimeString();
}

/* ── Orchestrate ── */
async function loadPulse() {
  const updated = document.getElementById('pulse-updated');
  const list = document.getElementById('pulse-list');
  updated.textContent = 'Loading…';
  list.innerHTML = '<div class="pulse-loading">Reading the wires…</div>';

  let data;
  try {
    const resp = await fetch(FEED_URL);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    data = await resp.json();
  } catch (err) {
    list.innerHTML = '<div class="pulse-empty">Couldn’t reach the feed service — ' +
                     escapeHtml(err.message) + '. The birdstation box may be offline.</div>';
    updated.textContent = 'Offline';
    return;
  }

  state.items = data.items || [];
  state.sources = data.sources || [];

  renderStatus();
  renderFilters();
  renderArticles();
}

/* ── Daily AI brief (independent of the feed) ── */
async function loadDigest() {
  const card = document.getElementById('pulse-brief');
  if (!card) return;

  let d;
  try {
    const resp = await fetch(DIGEST_URL);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    d = await resp.json();
  } catch (err) {
    card.hidden = true;   // no brief yet, or box offline — just don't show it
    return;
  }

  if (!d || !d.headline || !Array.isArray(d.sections) || d.sections.length === 0) {
    card.hidden = true;
    return;
  }

  const sections = d.sections.map((s) =>
    '<div class="pulse-brief-section">' +
      '<h3 class="pulse-brief-heading">' + escapeHtml(s.heading) + '</h3>' +
      '<p class="pulse-brief-body">' + escapeHtml(s.body) + '</p>' +
    '</div>'
  ).join('');

  card.innerHTML =
    '<div class="pulse-brief-label">📰 Morning Brief' +
      (d.date ? ' · ' + escapeHtml(d.date) : '') + '</div>' +
    '<p class="pulse-brief-lead">' + escapeHtml(d.headline) + '</p>' +
    sections;
  card.hidden = false;
}

function initPulse() {
  const btn = document.getElementById('pulse-refresh');
  if (btn) btn.addEventListener('click', () => { loadPulse(); loadDigest(); });

  const search = document.getElementById('pulse-search');
  if (search) {
    search.addEventListener('input', () => {
      state.query = search.value.trim().toLowerCase();
      renderArticles();
    });
  }

  loadPulse();
  loadDigest();
}

document.addEventListener('DOMContentLoaded', initPulse);
