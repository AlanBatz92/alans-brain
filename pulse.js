/* ──────────────────────────────────────────────────────────────
   Pulse — Lehigh Valley news feed (Phase 0)

   Live client-side fetch: for each source we hit the api/pulse-feed
   proxy (CORS workaround), parse the RSS/Atom XML with DOMParser,
   normalize to a common shape, merge, sort newest-first, and render.

   No storage, no AI yet — this phase just proves the pipeline and
   surfaces which feeds are healthy (per-source status, the web
   equivalent of the runbook's `manage.py list-sources`).

   To add a source: add an entry here AND allow-list its host in
   api/pulse-feed.js.
   ────────────────────────────────────────────────────────────── */

const PULSE_SOURCES = [
  { key: 'lehighvalleynews', label: 'LehighValleyNews',  url: 'https://www.lehighvalleynews.com/index.rss' },
  { key: 'lehighvalleylive', label: 'lehighvalleylive',  url: 'https://www.lehighvalleylive.com/arc/outboundfeeds/rss/?outputType=xml' },
  { key: 'wfmz',             label: 'WFMZ 69 News',       url: 'https://www.wfmz.com/search/?f=rss&t=article&c=news&l=50&s=start_time&sd=desc' },
  { key: 'morningcall',      label: 'The Morning Call',   url: 'https://www.mcall.com/feed/' },
  { key: 'pa-governor',      label: 'PA Governor',        url: 'https://www.governor.pa.gov/feed/' },
  { key: 'fema-pa',          label: 'FEMA',               url: 'https://www.fema.gov/about/news-multimedia/press-releases/rss' }
];

const PROXY = '/api/pulse-feed?url=';
const MAX_ITEMS = 80;

/* ── Fetch + parse one source ── */
async function fetchSource(source) {
  const resp = await fetch(PROXY + encodeURIComponent(source.url));
  if (!resp.ok) {
    let detail = 'HTTP ' + resp.status;
    try {
      const j = await resp.json();
      if (j && j.error) detail = j.error;
    } catch (e) { /* not JSON, keep the status */ }
    throw new Error(detail);
  }

  const text = await resp.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');

  if (doc.querySelector('parsererror')) {
    throw new Error('Could not parse feed (not valid XML)');
  }

  // RSS uses <item>; Atom uses <entry>.
  let nodes = Array.from(doc.querySelectorAll('item'));
  const isAtom = nodes.length === 0;
  if (isAtom) nodes = Array.from(doc.querySelectorAll('entry'));

  if (nodes.length === 0) throw new Error('Feed had no items');

  return nodes.map((node) => parseItem(node, isAtom, source));
}

function text(node, selector) {
  const el = node.querySelector(selector);
  return el ? el.textContent.trim() : '';
}

function parseItem(node, isAtom, source) {
  const title = text(node, 'title') || '(untitled)';

  // Atom links live in <link href="...">; RSS links are text content.
  let link = '';
  if (isAtom) {
    const linkEl = node.querySelector('link[rel="alternate"]') || node.querySelector('link');
    link = linkEl ? (linkEl.getAttribute('href') || linkEl.textContent.trim()) : '';
  } else {
    link = text(node, 'link');
  }

  const rawDate = text(node, 'pubDate') || text(node, 'published') || text(node, 'updated') || text(node, 'date');
  const ts = rawDate ? Date.parse(rawDate) : NaN;

  return {
    title: title,
    link: link,
    source: source.label,
    sourceKey: source.key,
    published: isNaN(ts) ? null : ts
  };
}

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
  d.textContent = s;
  return d.innerHTML;
}

/* ── Render ── */
function renderStatus(results) {
  const strip = document.getElementById('pulse-status');
  strip.innerHTML = results.map((r) => {
    const ok = r.status === 'ok';
    const cls = ok ? 'pulse-src-ok' : 'pulse-src-err';
    const detail = ok ? (r.count + ' items') : r.error;
    return '<span class="pulse-src ' + cls + '" title="' + escapeHtml(detail) + '">' +
             '<span class="pulse-src-dot"></span>' + escapeHtml(r.source.label) +
             ' <span class="pulse-src-meta">' + escapeHtml(detail) + '</span>' +
           '</span>';
  }).join('');
}

function renderArticles(items) {
  const list = document.getElementById('pulse-list');
  if (items.length === 0) {
    list.innerHTML = '<div class="pulse-empty">No headlines yet — check the source status above. ' +
                     'Feeds with errors need their URL fixed or removed.</div>';
    return;
  }
  list.innerHTML = items.slice(0, MAX_ITEMS).map((it) => {
    const when = relativeTime(it.published);
    const safeLink = it.link ? escapeHtml(it.link) : '#';
    return '<a class="pulse-item" href="' + safeLink + '" target="_blank" rel="noopener">' +
             '<div class="pulse-item-main">' +
               '<span class="pulse-item-title">' + escapeHtml(it.title) + '</span>' +
             '</div>' +
             '<div class="pulse-item-meta">' +
               '<span class="pulse-item-source">' + escapeHtml(it.source) + '</span>' +
               (when ? '<span class="pulse-item-time">' + escapeHtml(when) + '</span>' : '') +
             '</div>' +
           '</a>';
  }).join('');
}

/* ── Orchestrate ── */
async function loadPulse() {
  const updated = document.getElementById('pulse-updated');
  const list = document.getElementById('pulse-list');
  updated.textContent = 'Loading…';
  list.innerHTML = '<div class="pulse-loading">Reading the wires…</div>';

  const settled = await Promise.all(PULSE_SOURCES.map(async (source) => {
    try {
      const items = await fetchSource(source);
      return { source: source, status: 'ok', count: items.length, items: items };
    } catch (err) {
      return { source: source, status: 'error', error: err.message, items: [] };
    }
  }));

  renderStatus(settled);

  const all = [];
  settled.forEach((r) => { if (r.status === 'ok') all.push.apply(all, r.items); });

  // Newest first; undated items sink to the bottom.
  all.sort((a, b) => (b.published || 0) - (a.published || 0));

  renderArticles(all);

  const okCount = settled.filter((r) => r.status === 'ok').length;
  updated.textContent = all.length + ' headlines · ' + okCount + '/' + settled.length +
                        ' sources · ' + new Date().toLocaleTimeString();
}

function initPulse() {
  const btn = document.getElementById('pulse-refresh');
  if (btn) btn.addEventListener('click', loadPulse);
  loadPulse();
}

document.addEventListener('DOMContentLoaded', initPulse);
