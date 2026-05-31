/* ──────────────────────────────────────────────────────────────
   Observatory — Emmaus Bird Observatory front end

   A thin reader over birdstation (https://birds.alansbrain.com), the
   home box that runs BirdNET acoustic detection and an FFT train-noise
   detector. This page reads the box's GET endpoints once on load and
   renders two tabs:

     🐦 Birds  — headline stats, today's detections, the life list.
     🚂 Trains — event stats and recent events with playable WAV clips.

   Every section fetches independently: one endpoint failing (or the
   box being offline) degrades that section to an offline/empty state
   without taking down the others. Same spirit as pulse.js.

   POC: load-once with a manual ↻ refresh, no auto-polling.
   ────────────────────────────────────────────────────────────── */

const API_BASE = 'https://birds.alansbrain.com';

const EP = {
  birdStats:    API_BASE + '/api/stats',
  today:        API_BASE + '/api/today',
  lifetime:     API_BASE + '/api/lifetime',
  trainStats:   API_BASE + '/api/trains/stats',
  trainsRecent: API_BASE + '/api/trains/recent?limit=30',
};

const MAX_TODAY  = 200;   // today's feed is already a single day; cap defensively
const MAX_TRAINS = 30;    // matches the recent-events query limit

/* ── Helpers ── */

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : s;
  return d.innerHTML;
}

// Detections write a local ISO timestamp (no offset); train events write a
// UTC ISO timestamp (with offset). new Date() handles both — return ms or null.
function parseTime(s) {
  if (!s) return null;
  const t = new Date(s).getTime();
  return isNaN(t) ? null : t;
}

function relativeTime(ms) {
  if (ms == null) return '';
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.round(hrs / 24);
  if (days < 7) return days + 'd ago';
  return new Date(ms).toLocaleDateString();
}

function clockTime(ms) {
  if (ms == null) return '';
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function shortDate(ms) {
  if (ms == null) return '';
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Confidence (0–1) → a colored pill. The pipeline logs ≥ 0.35 and only lifes
// a species at ≥ 0.70, so 0.70 is the natural "confident" threshold here.
function confPill(conf) {
  const pct = Math.round((conf || 0) * 100);
  let cls = 'obs-conf-low';
  if (conf >= 0.70) cls = 'obs-conf-high';
  else if (conf >= 0.50) cls = 'obs-conf-mid';
  return '<span class="obs-conf ' + cls + '">' + pct + '%</span>';
}

// Render a row of stat cards from [{label, value}] into a container.
function renderStats(el, cards) {
  el.innerHTML = cards.map((c) =>
    '<div class="obs-stat">' +
      '<div class="obs-stat-value">' + escapeHtml(String(c.value)) + '</div>' +
      '<div class="obs-stat-label">' + escapeHtml(c.label) + '</div>' +
    '</div>'
  ).join('');
}

// Shared loading / empty / offline messaging for a section container.
function setMsg(el, cls, text) {
  el.innerHTML = '<div class="' + cls + '">' + escapeHtml(text) + '</div>';
}

// Fetch JSON with a friendly error. Throws on non-2xx or network failure.
async function fetchJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

/* ── Birds: headline stats ── */
async function loadBirdStats() {
  const el = document.getElementById('obs-bird-stats');
  try {
    const d = await fetchJson(EP.birdStats);
    const latest = d.latest_detection;
    renderStats(el, [
      { label: 'Detections',     value: (d.total_detections || 0).toLocaleString() },
      { label: 'Species (life)', value: d.total_species || 0 },
      { label: 'Today',          value: d.detections_today || 0 },
      { label: 'Latest',         value: latest ? latest.common_name : '—' },
    ]);
  } catch (err) {
    setMsg(el, 'obs-empty', 'Stats unavailable — the box may be offline.');
  }
}

/* ── Birds: today's detections ── */
async function loadToday() {
  const el = document.getElementById('obs-today');
  setMsg(el, 'obs-loading', 'Listening…');
  let d;
  try {
    d = await fetchJson(EP.today);
  } catch (err) {
    setMsg(el, 'obs-empty', 'Couldn’t reach the observatory — it may be offline.');
    return;
  }
  const rows = (d.detections || []).slice(0, MAX_TODAY);
  if (rows.length === 0) {
    setMsg(el, 'obs-empty', 'No detections yet today — quiet skies so far.');
    return;
  }
  el.innerHTML = rows.map((r) => {
    const ms = parseTime(r.timestamp);
    return '<div class="obs-row">' +
        '<div class="obs-row-main">' +
          '<span class="obs-species">' + escapeHtml(r.common_name) + '</span>' +
          (r.scientific_name ? '<span class="obs-sci">' + escapeHtml(r.scientific_name) + '</span>' : '') +
        '</div>' +
        '<div class="obs-row-meta">' +
          confPill(r.confidence) +
          (ms != null ? '<span class="obs-time" title="' + escapeHtml(relativeTime(ms)) + '">' + escapeHtml(clockTime(ms)) + '</span>' : '') +
        '</div>' +
      '</div>';
  }).join('');
}

/* ── Birds: life list ── */
async function loadLifetime() {
  const el = document.getElementById('obs-life');
  const countEl = document.getElementById('obs-life-count');
  setMsg(el, 'obs-loading', 'Tallying lifers…');
  let d;
  try {
    d = await fetchJson(EP.lifetime);
  } catch (err) {
    if (countEl) countEl.textContent = '';
    setMsg(el, 'obs-empty', 'Life list unavailable — the box may be offline.');
    return;
  }
  const species = d.species || [];
  if (countEl) countEl.textContent = species.length ? '(' + species.length + ')' : '';
  if (species.length === 0) {
    setMsg(el, 'obs-empty', 'No lifers logged yet.');
    return;
  }
  el.innerHTML = species.map((s) => {
    const ms = parseTime(s.first_seen);
    const since = ms != null ? '<span class="obs-lifer-since">since ' + escapeHtml(shortDate(ms)) + '</span>' : '';
    const count = s.total_detections
      ? '<span class="obs-lifer-count">×' + escapeHtml(String(s.total_detections)) + '</span>'
      : '';
    return '<div class="obs-lifer">' +
        '<span class="obs-lifer-name">' + escapeHtml(s.common_name) + '</span>' +
        '<span class="obs-lifer-meta">' + count + since + '</span>' +
      '</div>';
  }).join('');
}

/* ── Trains: stats ── */
async function loadTrainStats() {
  const el = document.getElementById('obs-train-stats');
  try {
    const d = await fetchJson(EP.trainStats);
    renderStats(el, [
      { label: 'Events',     value: (d.total_events || 0).toLocaleString() },
      { label: 'Today',      value: d.today_count || 0 },
      { label: 'Unreviewed', value: d.unreviewed || 0 },
    ]);
  } catch (err) {
    setMsg(el, 'obs-empty', 'Train stats unavailable — the box may be offline.');
  }
}

/* ── Trains: recent events with playable clips ── */
async function loadTrains() {
  const el = document.getElementById('obs-trains');
  setMsg(el, 'obs-loading', 'Checking the tracks…');
  let rows;
  try {
    rows = await fetchJson(EP.trainsRecent);
  } catch (err) {
    setMsg(el, 'obs-empty', 'Couldn’t reach the observatory — it may be offline.');
    return;
  }
  rows = (rows || []).slice(0, MAX_TRAINS);
  if (rows.length === 0) {
    setMsg(el, 'obs-empty', 'No train events recorded yet.');
    return;
  }
  el.innerHTML = rows.map((r) => {
    const ms   = parseTime(r.detected_at);
    const when = ms != null ? shortDate(ms) + ' · ' + clockTime(ms) : '';
    const dur  = r.duration_s != null ? Number(r.duration_s).toFixed(1) + 's' : '';
    const db   = r.peak_db    != null ? Math.round(r.peak_db) + ' dB' : '';
    const file = r.clip_path ? r.clip_path.split('/').pop() : '';
    const clip = file
      ? '<audio class="obs-clip" controls preload="none" src="' +
          API_BASE + '/api/trains/clip/' + encodeURIComponent(file) + '"></audio>'
      : '<div class="obs-clip-missing">clip unavailable</div>';
    const verdict = renderVerdict(r);
    return '<div class="obs-train">' +
        '<div class="obs-train-head">' +
          (when ? '<span class="obs-train-when">' + escapeHtml(when) + '</span>' : '') +
          (dur  ? '<span class="obs-tag">' + escapeHtml(dur) + '</span>' : '') +
          (db   ? '<span class="obs-tag">' + escapeHtml(db) + '</span>' : '') +
          verdict +
        '</div>' +
        clip +
      '</div>';
  }).join('');
}

// Review verdict badge — only shown once a clip has been judged on the box.
function renderVerdict(r) {
  if (!r.reviewed) return '';
  const map = {
    train:          { cls: 'obs-verdict-train', text: '✓ train' },
    false_positive: { cls: 'obs-verdict-false', text: '✗ false' },
    unsure:         { cls: 'obs-verdict-unsure', text: '? unsure' },
  };
  const v = map[r.verdict];
  if (!v) return '';
  return '<span class="obs-verdict ' + v.cls + '">' + v.text + '</span>';
}

/* ── Tabs ── */
function initTabs() {
  const tabs = document.querySelectorAll('.obs-tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const which = tab.getAttribute('data-tab');
      tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle('obs-tab-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      document.getElementById('obs-panel-birds').hidden  = which !== 'birds';
      document.getElementById('obs-panel-trains').hidden = which !== 'trains';
    });
  });
}

/* ── Orchestrate ── */
function loadAll() {
  const updated = document.getElementById('obs-updated');
  const btn = document.getElementById('obs-refresh');
  if (updated) updated.textContent = 'Loading…';
  if (btn) btn.classList.add('spinning');

  // All sections load independently — one failure never blocks the others.
  Promise.allSettled([
    loadBirdStats(), loadToday(), loadLifetime(),
    loadTrainStats(), loadTrains(),
  ]).then(() => {
    if (updated) updated.textContent = 'Updated ' + new Date().toLocaleTimeString();
    if (btn) btn.classList.remove('spinning');
  });
}

function initObservatory() {
  initTabs();
  const btn = document.getElementById('obs-refresh');
  if (btn) btn.addEventListener('click', loadAll);
  loadAll();
}

document.addEventListener('DOMContentLoaded', initObservatory);
