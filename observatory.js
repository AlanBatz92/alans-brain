/* ──────────────────────────────────────────────────────────────
   Observatory — Emmaus Bird Observatory front end

   A thin reader over birdstation (https://birds.alansbrain.com), the
   home box that runs BirdNET acoustic detection and an FFT train-noise
   detector. This page reads the box's GET endpoints once on load and
   renders two tabs:

     🐦 Birds  — headline stats, today's species (grouped), the life list.
     🚂 Trains — event stats and recent events with playable WAV clips.

   Confidence gate: the BirdNET pipeline *logs* everything ≥ 0.35 (lots of
   low-confidence noise), but only birds at or above MIN_CONFIDENCE land on
   this page — the same 0.75 floor the box uses to credit a life-list hit. (A
   species joins the life list only after 3 such hits in one day; the page
   still visualizes every confident bird, listed or not.) We pass
   ?min_confidence to the API (honored once birdstation is redeployed with the
   param; harmlessly ignored before that) AND filter client-side, so the page
   is correct in both states.

   Every section fetches independently: one endpoint failing (or the box
   being offline) degrades that section to an offline/empty state without
   taking down the others.

   POC: load-once with a manual ↻ refresh, no auto-polling.
   ────────────────────────────────────────────────────────────── */

const API_BASE = 'https://birds.alansbrain.com';

// Only birds at/above this confidence land on the page. Matches the box's
// LIFE_LIST_MIN_CONFIDENCE — the floor for a hit to count toward a lifer.
const MIN_CONFIDENCE = 0.75;

const EP = {
  today:        API_BASE + '/api/today?min_confidence=' + MIN_CONFIDENCE,   // 0.75
  lifetime:     API_BASE + '/api/lifetime',
  trainStats:   API_BASE + '/api/trains/stats',
  trainsRecent: API_BASE + '/api/trains/recent?limit=30',
};

const MAX_TRAINS = 30;   // matches the recent-events query limit

// Cross-section bird state — stats are derived from today + life together,
// so we stash both and recompute the stat cards as each arrives.
const state = { today: [], life: [] };

/* ── Helpers ── */

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : s;
  return d.innerHTML;
}

// The box runs on UTC and writes *naive* ISO timestamps (no offset) for bird
// detections; train events carry an explicit offset. If a value has no timezone
// marker we treat it as UTC, otherwise it'd be parsed as the viewer's local
// time and read ~4h off. Returns epoch ms, or null.
function parseTime(s) {
  if (!s) return null;
  let str = String(s);
  const hasTime = /\d{2}:\d{2}/.test(str);
  const hasTz = /[zZ]$|[+\-]\d{2}:?\d{2}$/.test(str);
  if (hasTime && !hasTz) str = str.replace(' ', 'T') + 'Z';
  const t = new Date(str).getTime();
  return isNaN(t) ? null : t;
}

// The observatory lives in Emmaus, PA — render all clock/date values in Eastern
// so the page is correct regardless of the viewer's own timezone.
const OBS_TZ = 'America/New_York';

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
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: OBS_TZ });
}

function shortDate(ms) {
  if (ms == null) return '';
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: OBS_TZ });
}

// Confidence (0–1) → bucket class. 0.75 is the page's "confident" floor, so
// everything shown is at least mid; we still grade high vs. mid for color.
function confClass(conf) {
  if (conf >= 0.85) return 'obs-conf-high';
  if (conf >= 0.75) return 'obs-conf-mid';
  return 'obs-conf-low';
}

function confPill(conf) {
  return '<span class="obs-conf ' + confClass(conf) + '">' +
           Math.round((conf || 0) * 100) + '%</span>';
}

// Render a row of stat cards from [{label, value}] into a container.
function renderStats(el, cards) {
  if (!el) return;
  el.innerHTML = cards.map((c) =>
    '<div class="obs-stat">' +
      '<div class="obs-stat-value' + (c.small ? ' obs-stat-value-sm' : '') + '">' +
        escapeHtml(String(c.value)) + '</div>' +
      '<div class="obs-stat-label">' + escapeHtml(c.label) + '</div>' +
    '</div>'
  ).join('');
}

function setMsg(el, cls, text) {
  if (!el) return;
  el.innerHTML = '<div class="' + cls + '">' + escapeHtml(text) + '</div>';
}

async function fetchJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

/* ── Birds: headline stats (derived from today + life list) ── */
function renderBirdStats() {
  const el = document.getElementById('obs-bird-stats');
  if (!el) return;
  const todayN = state.today.length;
  const speciesToday = new Set(state.today.map((r) => r.common_name)).size;
  const latest = state.today[0];   // today is ordered newest-first
  renderStats(el, [
    { label: 'Heard today',   value: todayN.toLocaleString() },
    { label: 'Species today', value: speciesToday },
    { label: 'Life list',     value: state.life.length },
    { label: 'Latest',        value: latest ? latest.common_name : '—', small: true },
  ]);
}

/* ── Birds: today's detections, grouped by species ── */
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
  // Defensive client-side gate (in case the box hasn't been redeployed with
  // the ?min_confidence param yet), still newest-first.
  state.today = (d.detections || []).filter((r) => (r.confidence || 0) >= MIN_CONFIDENCE);
  renderBirdStats();
  renderToday();
}

function renderToday() {
  const el = document.getElementById('obs-today');
  if (state.today.length === 0) {
    setMsg(el, 'obs-empty', 'No confident detections yet today — quiet skies so far.');
    return;
  }
  // Group by species: count, best confidence, most-recent time.
  const groups = new Map();
  state.today.forEach((r) => {
    const ms = parseTime(r.timestamp);
    let g = groups.get(r.common_name);
    if (!g) {
      g = { name: r.common_name, sci: r.scientific_name, count: 0, best: 0, lastMs: ms };
      groups.set(r.common_name, g);
    }
    g.count += 1;
    if ((r.confidence || 0) > g.best) g.best = r.confidence || 0;
    if (ms != null && (g.lastMs == null || ms > g.lastMs)) g.lastMs = ms;
  });
  const species = [...groups.values()].sort((a, b) => (b.lastMs || 0) - (a.lastMs || 0));

  el.innerHTML = species.map((g) => {
    const pct = Math.round((g.best || 0) * 100);
    return '<div class="obs-species">' +
        '<div class="obs-species-top">' +
          '<span class="obs-species-name">' + escapeHtml(g.name) + '</span>' +
          '<span class="obs-species-count">×' + g.count + '</span>' +
        '</div>' +
        (g.sci ? '<div class="obs-species-sci">' + escapeHtml(g.sci) + '</div>' : '') +
        '<div class="obs-bar"><div class="obs-bar-fill ' + confClass(g.best) +
          '-bar" style="width:' + pct + '%"></div></div>' +
        '<div class="obs-species-foot">' +
          confPill(g.best) +
          (g.lastMs != null
            ? '<span class="obs-species-last" title="' + escapeHtml(relativeTime(g.lastMs)) +
                '">last ' + escapeHtml(clockTime(g.lastMs)) + '</span>'
            : '') +
        '</div>' +
      '</div>';
  }).join('');
}

/* ── Birds: life list ── */
async function loadLife() {
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
  state.life = d.species || [];
  renderBirdStats();
  if (countEl) countEl.textContent = state.life.length ? '(' + state.life.length + ')' : '';
  if (state.life.length === 0) {
    setMsg(el, 'obs-empty', 'No lifers logged yet.');
    return;
  }
  el.innerHTML = state.life.map((s) => {
    const ms = parseTime(s.first_seen);
    const since = ms != null ? '<span class="obs-lifer-since">since ' + escapeHtml(shortDate(ms)) + '</span>' : '';
    const count = s.total_detections
      ? '<span class="obs-lifer-count">×' + escapeHtml(String(s.total_detections)) + '</span>'
      : '';
    return '<div class="obs-lifer">' +
        '<div class="obs-lifer-main">' +
          '<span class="obs-lifer-name">' + escapeHtml(s.common_name) + '</span>' +
          (s.scientific_name ? '<span class="obs-lifer-sci">' + escapeHtml(s.scientific_name) + '</span>' : '') +
        '</div>' +
        '<div class="obs-lifer-meta">' + count + since + '</div>' +
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
    return '<div class="obs-train">' +
        '<div class="obs-train-head">' +
          (when ? '<span class="obs-train-when">' + escapeHtml(when) + '</span>' : '') +
          (dur  ? '<span class="obs-tag">' + escapeHtml(dur) + '</span>' : '') +
          (db   ? '<span class="obs-tag">' + escapeHtml(db) + '</span>' : '') +
          renderVerdict(r) +
        '</div>' +
        clip +
      '</div>';
  }).join('');
}

function renderVerdict(r) {
  if (!r.reviewed) return '';
  const map = {
    train:          { cls: 'obs-verdict-train', text: '✓ train' },
    false_positive: { cls: 'obs-verdict-false', text: '✗ false' },
    unsure:         { cls: 'obs-verdict-unsure', text: '? unsure' },
  };
  const v = map[r.verdict];
  return v ? '<span class="obs-verdict ' + v.cls + '">' + v.text + '</span>' : '';
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

  Promise.allSettled([
    loadToday(), loadLife(), loadTrainStats(), loadTrains(),
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
