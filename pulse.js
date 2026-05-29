/* ──────────────────────────────────────────────────────────────
   Pulse — Lehigh Valley news feed

   Thin reader. birdstation (https://birds.alansbrain.com) fetches,
   dedupes, and stores every source on a systemd timer, then serves
   the merged result from a single endpoint. This page just reads it:
   one fetch, render the items, render per-source health.

   The health strip comes from the API's `sources` array — the web
   surface of the runbook's `manage.py list-sources` (each source's
   last_status / last_count / last_fetch).

   To add or remove a source you no longer touch this file: it's a row
   in birdstation's `feed_sources` table.
   ────────────────────────────────────────────────────────────── */

const FEED_URL = 'https://birds.alansbrain.com/api/feed';
const MAX_ITEMS = 80;

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

/* ── Render per-source health ── */
function renderStatus(sources) {
  const strip = document.getElementById('pulse-status');
  if (!strip) return;
  strip.innerHTML = sources.map((s) => {
    const ok = s.last_status === 'ok';
    const cls = ok ? 'pulse-src-ok' : 'pulse-src-err';
    const detail = ok ? ((s.last_count || 0) + ' items') : (s.last_status || 'no data yet');
    return '<span class="pulse-src ' + cls + '" title="' + escapeHtml(detail) + '">' +
             '<span class="pulse-src-dot"></span>' + escapeHtml(s.label) +
             ' <span class="pulse-src-meta">' + escapeHtml(detail) + '</span>' +
           '</span>';
  }).join('');
}

/* ── Render articles ── */
function renderArticles(items) {
  const list = document.getElementById('pulse-list');
  if (items.length === 0) {
    list.innerHTML = '<div class="pulse-empty">No headlines yet — check the source status above. ' +
                     'Feeds with errors need their URL fixed or removed in birdstation.</div>';
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

  const items = data.items || [];
  const sources = data.sources || [];

  renderStatus(sources);
  renderArticles(items);

  const okCount = sources.filter((s) => s.last_status === 'ok').length;
  updated.textContent = items.length + ' headlines · ' + okCount + '/' + sources.length +
                        ' sources · ' + new Date().toLocaleTimeString();
}

function initPulse() {
  const btn = document.getElementById('pulse-refresh');
  if (btn) btn.addEventListener('click', loadPulse);
  loadPulse();
}

document.addEventListener('DOMContentLoaded', initPulse);
