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
  // Privacy: only events a human has explicitly approved (verdict=train) are
  // ever shown publicly. We ask the API for approved-only AND filter again
  // client-side, so an un-reviewed clip (which could contain conversation
  // picked up by the mic) can never surface on the public page.
  trainsRecent: API_BASE + '/api/trains/recent?limit=30&approved=1',
};

const MAX_TRAINS = 30;   // matches the recent-events query limit

// Cross-section bird state — stats are derived from today + life together,
// so we stash both and recompute the stat cards as each arrives.
const state = { today: [], life: [], periodGroups: [], period: 'today', searchQuery: '', periodSort: 'recent', lifeSort: 'recent' };

/* ── Helpers ── */

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : s;
  return d.innerHTML;
}

function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
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

// Return up to 3 sentences of Wikipedia extract text, capped at ~500 chars.
function truncateExtract(text) {
  if (!text) return '';
  const MAX = 500;
  let pos = 0;
  let count = 0;
  while (count < 3) {
    const next = text.indexOf('. ', pos);
    if (next === -1 || next >= MAX) break;
    pos = next + 1;  // include the period
    count++;
  }
  if (pos > 30) return text.slice(0, pos);
  if (text.length <= MAX) return text;
  const cut = text.lastIndexOf(' ', MAX);
  return (cut > 100 ? text.slice(0, cut) : text.slice(0, MAX)) + '…';
}

function confPill(conf) {
  return '<span class="obs-conf ' + confClass(conf) + '">' +
           Math.round((conf || 0) * 100) + '%</span>';
}

// Render a row of stat cards from [{label, value, action?}] into a container.
// Cards with an `action` string get .obs-stat-btn + data-action for delegation.
function renderStats(el, cards) {
  if (!el) return;
  el.innerHTML = cards.map((c) => {
    const clickable = !!c.action;
    const cls = 'obs-stat' + (clickable ? ' obs-stat-btn' : '');
    const attrs = clickable
      ? ' data-action="' + escapeAttr(c.action) + '" role="button" tabindex="0"'
      : '';
    return '<div class="' + cls + '"' + attrs + '>' +
      '<div class="obs-stat-value' + (c.small ? ' obs-stat-value-sm' : '') + '">' +
        escapeHtml(String(c.value)) + '</div>' +
      '<div class="obs-stat-label">' + escapeHtml(c.label) + '</div>' +
    '</div>';
  }).join('');
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

/* ── Period utilities ── */

// Find the UTC ms timestamp for midnight Eastern (America/New_York) on the given
// Eastern date. Probes UTC hours 3–6 on that date (covers both EDT = UTC-4 and
// EST = UTC-5) using Intl; falls back to EDT if the probe window misses.
function easternMidnightUtcMs(y, m, d) {
  for (let h = 3; h <= 6; h++) {
    const probe = new Date(Date.UTC(y, m - 1, d, h, 0, 0));
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: OBS_TZ,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(probe);
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    if (get('year') === y && get('month') === m && get('day') === d &&
        get('hour') % 24 === 0 && get('minute') === 0) {
      return probe.getTime();
    }
  }
  return Date.UTC(y, m - 1, d, 4, 0, 0);  // fallback: EDT
}

function fmtUtcTs(ms) {
  const dt = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate()) +
         ' ' + pad(dt.getUTCHours()) + ':00:00';
}

// Groups raw detection rows into the same shape returned by /api/detections/grouped.
function groupDetections(rows) {
  const map = new Map();
  rows.forEach((r) => {
    let g = map.get(r.common_name);
    if (!g) {
      g = { common_name: r.common_name, scientific_name: r.scientific_name,
            count: 0, best_confidence: 0, first_heard: r.timestamp, last_heard: r.timestamp };
      map.set(r.common_name, g);
    }
    g.count++;
    if ((r.confidence || 0) > g.best_confidence) g.best_confidence = r.confidence;
    const ms = parseTime(r.timestamp);
    if (ms != null) {
      if (parseTime(g.first_heard) == null || ms < parseTime(g.first_heard)) g.first_heard = r.timestamp;
      if (parseTime(g.last_heard)  == null || ms > parseTime(g.last_heard))  g.last_heard  = r.timestamp;
    }
  });
  return [...map.values()]
    .sort((a, b) => (parseTime(b.last_heard) || 0) - (parseTime(a.last_heard) || 0));
}

// Returns {start, end, label} for a period key.
// start/end are UTC datetime strings ("YYYY-MM-DD HH:00:00") bracketing the Eastern
// calendar day(s). The pipeline writes UTC naive timestamps, so a 10PM Eastern
// detection (2AM UTC next day) must be captured by a UTC-aligned window, not a
// date() comparison on the raw timestamp.
function periodDates(period) {
  const now = new Date();
  const e   = new Date(now.toLocaleString('en-US', { timeZone: OBS_TZ }));
  const pad = (n) => String(n).padStart(2, '0');
  const fmtE = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = fmtE(e);

  let startE, endE, label;
  if (period === 'yesterday') {
    const y = new Date(e); y.setDate(y.getDate() - 1);
    const ys = fmtE(y); startE = endE = ys; label = 'yesterday';
  } else if (period === 'week') {
    const dow = e.getDay();
    const mon = new Date(e); mon.setDate(mon.getDate() - (dow === 0 ? 6 : dow - 1));
    startE = fmtE(mon); endE = today; label = 'this week';
  } else if (period === 'month') {
    startE = e.getFullYear() + '-' + pad(e.getMonth() + 1) + '-01';
    endE = today; label = 'this month';
  } else {
    startE = endE = today; label = 'today';
  }

  const [sy, sm, sd] = startE.split('-').map(Number);
  const startUtcMs = easternMidnightUtcMs(sy, sm, sd);

  // Exclusive end = midnight Eastern of the day after endE in UTC
  const [ey, em, ed] = endE.split('-').map(Number);
  const nextDayUtc = new Date(Date.UTC(ey, em - 1, ed + 1));
  const endUtcMs = easternMidnightUtcMs(nextDayUtc.getUTCFullYear(), nextDayUtc.getUTCMonth() + 1, nextDayUtc.getUTCDate());

  return { start: fmtUtcTs(startUtcMs), end: fmtUtcTs(endUtcMs), label };
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
    // Life list: clickable → smooth-scroll to the life list section
    { label: 'Life list',     value: state.life.length,
      action: state.life.length > 0 ? 'scroll-life' : null },
    // Latest bird: clickable → opens bird card modal
    { label: 'Latest',        value: latest ? latest.common_name : '—', small: true,
      action: latest ? 'open-latest' : null },
  ]);
}

/* ── Birds: today's raw detections (for stat cards) + initial period render ── */
async function loadToday() {
  if (state.period === 'today') {
    setMsg(document.getElementById('obs-today'), 'obs-loading', 'Listening…');
  }
  let d;
  try {
    d = await fetchJson(EP.today);
  } catch (err) {
    if (state.period === 'today') {
      setMsg(document.getElementById('obs-today'), 'obs-empty',
        'Couldn\'t reach the observatory — it may be offline.');
    }
    return;
  }
  // Defensive client-side confidence gate (keeps page correct before box redeploys).
  state.today = (d.detections || []).filter((r) => (r.confidence || 0) >= MIN_CONFIDENCE);
  renderBirdStats();
  if (state.period === 'today') {
    state.periodGroups = groupDetections(state.today);
    renderPeriodGroups();
  }
}

function sortGroups(groups, sortKey) {
  const copy = groups.slice();
  if (sortKey === 'most')  return copy.sort((a, b) => b.count - a.count);
  if (sortKey === 'least') return copy.sort((a, b) => a.count - b.count);
  return copy.sort((a, b) => (parseTime(b.last_heard) || 0) - (parseTime(a.last_heard) || 0));
}

function sortLifeList(species, sortKey) {
  const copy = species.slice();
  if (sortKey === 'most')  return copy.sort((a, b) => (b.total_detections || 0) - (a.total_detections || 0));
  if (sortKey === 'least') return copy.sort((a, b) => (a.total_detections || 0) - (b.total_detections || 0));
  return copy.sort((a, b) => (parseTime(b.first_seen) || 0) - (parseTime(a.first_seen) || 0));
}

function renderPeriodGroups() {
  const el      = document.getElementById('obs-today');
  const countEl = document.getElementById('obs-period-count');
  const q      = state.searchQuery.trim().toLowerCase();
  const sorted = sortGroups(state.periodGroups, state.periodSort);
  const groups = q
    ? sorted.filter((g) =>
        g.common_name.toLowerCase().includes(q) ||
        (g.scientific_name || '').toLowerCase().includes(q))
    : sorted;
  if (countEl) countEl.textContent = groups.length ? '(' + groups.length + ')' : '';
  if (groups.length === 0) {
    setMsg(el, 'obs-empty',
      q ? 'No species match "' + q + '".'
        : 'Nothing detected in this period yet — quiet skies.');
    return;
  }
  el.innerHTML = groups.map((g) => {
    const pct    = Math.round((g.best_confidence || 0) * 100);
    const lastMs = parseTime(g.last_heard);
    return '<div class="obs-species" role="button" tabindex="0"' +
        ' data-name="' + escapeAttr(g.common_name) + '" data-sci="' + escapeAttr(g.scientific_name || '') + '">' +
        '<div class="obs-species-top">' +
          '<span class="obs-species-name">' + escapeHtml(g.common_name) + '</span>' +
          '<span class="obs-species-count">×' + g.count + '</span>' +
        '</div>' +
        (g.scientific_name ? '<div class="obs-species-sci">' + escapeHtml(g.scientific_name) + '</div>' : '') +
        '<div class="obs-bar"><div class="obs-bar-fill ' + confClass(g.best_confidence) +
          '-bar" style="width:' + pct + '%"></div></div>' +
        '<div class="obs-species-foot">' +
          confPill(g.best_confidence) +
          (lastMs != null
            ? '<span class="obs-species-last" title="' + escapeHtml(relativeTime(lastMs)) +
                '">last ' + escapeHtml(clockTime(lastMs)) + '</span>'
            : '') +
        '</div>' +
      '</div>';
  }).join('');
}

/* ── Birds: life list ── */
function renderLife() {
  const el = document.getElementById('obs-life');
  if (!el) return;
  if (state.life.length === 0) {
    setMsg(el, 'obs-empty', 'No lifers logged yet.');
    return;
  }
  const sorted = sortLifeList(state.life, state.lifeSort);
  el.innerHTML = sorted.map((s) => {
    const ms = parseTime(s.first_seen);
    const since = ms != null ? '<span class="obs-lifer-since">since ' + escapeHtml(shortDate(ms)) + '</span>' : '';
    const count = s.total_detections
      ? '<span class="obs-lifer-count">×' + escapeHtml(String(s.total_detections)) + '</span>'
      : '';
    return '<div class="obs-lifer" role="button" tabindex="0"' +
        ' data-name="' + escapeAttr(s.common_name) + '" data-sci="' + escapeAttr(s.scientific_name || '') + '">' +
        '<div class="obs-lifer-main">' +
          '<span class="obs-lifer-name">' + escapeHtml(s.common_name) + '</span>' +
          (s.scientific_name ? '<span class="obs-lifer-sci">' + escapeHtml(s.scientific_name) + '</span>' : '') +
        '</div>' +
        '<div class="obs-lifer-meta">' + count + since + '</div>' +
      '</div>';
  }).join('');
}

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
  renderLife();
}

/* ── Trains: stats ── */
async function loadTrainStats() {
  const el = document.getElementById('obs-train-stats');
  try {
    const d = await fetchJson(EP.trainStats);
    // Show only confirmed-train counts publicly (the API exposes approved_*
    // alongside the raw totals; fall back gracefully on an older box build).
    const confirmed = d.approved_total != null ? d.approved_total : d.total_events;
    const today     = d.approved_today != null ? d.approved_today : d.today_count;
    renderStats(el, [
      { label: 'Confirmed trains', value: (confirmed || 0).toLocaleString() },
      { label: 'Today',            value: today || 0 },
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
    setMsg(el, "obs-empty", "Couldn't reach the observatory — it may be offline.");
    return;
  }
  // Defense in depth: even if the API hands back un-approved rows (older box
  // build that ignores ?approved=1), never render anything not explicitly
  // marked verdict=train. Default-deny — nothing un-vetted reaches the page.
  rows = (rows || []).filter((r) => r.reviewed && r.verdict === 'train');
  rows = rows.slice(0, MAX_TRAINS);
  if (rows.length === 0) {
    setMsg(el, 'obs-empty', 'No confirmed train events yet.');
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

/* ── Bird card quick-view ── */

function birdCardSkeleton() {
  return '<div class="obs-bcard-skeleton">' +
    '<div class="obs-bcard-skel-photo"></div>' +
    '<div class="obs-bcard-skel-line obs-bcard-skel-title"></div>' +
    '<div class="obs-bcard-skel-line obs-bcard-skel-sub"></div>' +
    '<div class="obs-bcard-skel-line obs-bcard-skel-text"></div>' +
    '<div class="obs-bcard-skel-line obs-bcard-skel-text2"></div>' +
  '</div>';
}

function birdCardContent(commonName, scientificName, wiki, hist) {
  const hasPhoto = wiki && wiki.photo;
  let html = '';

  // Photo — wrapped in a link to Wikipedia if available
  if (hasPhoto) {
    const img = '<img class="obs-bcard-photo" src="' + escapeAttr(wiki.photo) +
      '" alt="' + escapeAttr(commonName) + '">';
    html += wiki && wiki.url
      ? '<a class="obs-bcard-photo-link" href="' + escapeAttr(wiki.url) +
          '" target="_blank" rel="noopener">' + img + '</a>'
      : img;
  }

  html += '<div class="obs-bcard-body' + (hasPhoto ? '' : ' obs-bcard-body--nophoto') + '">';
  html += '<div class="obs-bcard-name">' + escapeHtml(commonName) + '</div>';
  if (scientificName) {
    html += '<div class="obs-bcard-sci">' + escapeHtml(scientificName) + '</div>';
  }
  // Wikipedia link near the top — easy to tap on mobile, not buried at the bottom
  if (wiki && wiki.url) {
    html += '<a class="obs-bcard-wiki-link" href="' + escapeAttr(wiki.url) +
      '" target="_blank" rel="noopener">↗ Wikipedia</a>';
  }
  // Skip generic descriptions like "species of bird" or "species of owl"
  if (wiki && wiki.description && !/^species of /i.test(wiki.description)) {
    html += '<div class="obs-bcard-desc">' + escapeHtml(wiki.description) + '</div>';
  }
  // Up to 3 sentences — naturally surfaces range, habitat, and behavior facts
  if (wiki && wiki.extract) {
    const snippet = truncateExtract(wiki.extract);
    if (snippet) html += '<p class="obs-bcard-extract">' + escapeHtml(snippet) + '</p>';
  }

  // Comic-book character-profile stats grid
  if (hist && hist.total_detections != null) {
    const bestConf = hist.confidence_series && hist.confidence_series.length > 0
      ? Math.round(hist.confidence_series.reduce((m, v) => Math.max(m, v), 0) * 100) + '%'
      : '—';
    const firstMs = parseTime(hist.first_heard);
    const lastMs  = parseTime(hist.last_heard);
    const stats = [
      { lbl: 'Heard Here',  val: '×' + hist.total_detections },
      { lbl: 'Best ID',     val: bestConf },
      { lbl: 'First Heard', val: firstMs ? shortDate(firstMs) : '—' },
      { lbl: 'Last Heard',  val: lastMs  ? shortDate(lastMs) + ' · ' + clockTime(lastMs) : '—' },
    ];
    html += '<div class="obs-bcard-stats">' +
      stats.map((s) =>
        '<div class="obs-bcard-stat">' +
          '<div class="obs-bcard-stat-val">' + escapeHtml(s.val) + '</div>' +
          '<div class="obs-bcard-stat-lbl">' + escapeHtml(s.lbl) + '</div>' +
        '</div>'
      ).join('') +
    '</div>';
  }

  html += '</div>';
  return html;
}

async function openBirdCard(commonName, scientificName) {
  const modal   = document.getElementById('obs-bird-modal');
  const content = document.getElementById('obs-bcard-content');
  if (!modal || !content) return;

  content.innerHTML = birdCardSkeleton();
  modal.classList.add('obs-bcard-open');
  document.body.style.overflow = 'hidden';

  const wikiPromise = typeof BirdInfo !== 'undefined'
    ? BirdInfo.get(scientificName, commonName)
    : Promise.resolve(null);
  const histPromise = fetchJson(API_BASE + '/api/species/' + encodeURIComponent(commonName))
    .catch(() => null);

  const [wikiResult, histResult] = await Promise.allSettled([wikiPromise, histPromise]);
  const wiki = wikiResult.status === 'fulfilled' ? wikiResult.value : null;
  const hist = histResult.status === 'fulfilled' ? histResult.value : null;
  content.innerHTML = birdCardContent(commonName, scientificName, wiki, hist);
}

function closeBirdCard() {
  const modal = document.getElementById('obs-bird-modal');
  if (modal) modal.classList.remove('obs-bcard-open');
  document.body.style.overflow = '';
}

const TAGLINES = {
  birds:  'What is the source of all that chirping?!',
  trains: 'I like trains.',
};

/* ── Tabs ── */
function initTabs() {
  const tabs = document.querySelectorAll('.obs-tab');
  const taglineEl = document.querySelector('.page-hero-tagline');
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
      if (taglineEl && TAGLINES[which]) taglineEl.textContent = TAGLINES[which];
    });
  });
}

async function loadPeriod(period) {
  const { start, end, label } = periodDates(period);
  state.period      = period;
  state.searchQuery = '';
  const searchEl  = document.getElementById('obs-search');
  if (searchEl) searchEl.value = '';
  const headingEl = document.getElementById('obs-period-heading');
  if (headingEl) headingEl.textContent = 'Heard ' + label;

  if (period === 'today') {
    // Reuse already-loaded raw data — no extra fetch.
    state.periodGroups = groupDetections(state.today);
    renderPeriodGroups();
    return;
  }

  const el = document.getElementById('obs-today');
  setMsg(el, 'obs-loading', 'Checking the skies…');
  let data;
  try {
    data = await fetchJson(
      API_BASE + '/api/detections/grouped?start=' + encodeURIComponent(start) +
      '&end=' + encodeURIComponent(end) + '&min_confidence=' + MIN_CONFIDENCE
    );
  } catch (err) {
    setMsg(el, 'obs-empty', 'Couldn\'t reach the observatory — it may be offline.');
    return;
  }
  state.periodGroups = data.species || [];
  renderPeriodGroups();
}

/* ── Orchestrate ── */
function loadAll() {
  const updated = document.getElementById('obs-updated');
  const btn = document.getElementById('obs-refresh');
  if (updated) updated.textContent = 'Loading…';
  if (btn) btn.classList.add('spinning');

  const refreshes = [loadToday(), loadLife(), loadTrainStats(), loadTrains()];
  // When viewing a historical period, also refresh that grid on manual reload.
  if (state.period !== 'today') refreshes.push(loadPeriod(state.period));

  Promise.allSettled(refreshes).then(() => {
    if (updated) updated.textContent = 'Updated ' + new Date().toLocaleTimeString();
    if (btn) btn.classList.remove('spinning');
  });
}

function initObservatory() {
  initTabs();

  // Period selector tabs
  const periodTabs = document.querySelectorAll('.obs-period-tab');
  periodTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      periodTabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle('obs-period-tab-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      loadPeriod(tab.getAttribute('data-period'));
    });
  });

  // Species search (client-side filter, no refetch)
  const searchEl = document.getElementById('obs-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      state.searchQuery = searchEl.value;
      renderPeriodGroups();
    });
  }

  // Sort selects
  const periodSortEl = document.getElementById('obs-period-sort');
  if (periodSortEl) {
    periodSortEl.addEventListener('change', () => {
      state.periodSort = periodSortEl.value;
      renderPeriodGroups();
    });
  }
  const lifeSortEl = document.getElementById('obs-life-sort');
  if (lifeSortEl) {
    lifeSortEl.addEventListener('change', () => {
      state.lifeSort = lifeSortEl.value;
      renderLife();
    });
  }

  // Stat card click delegation (Life list → scroll, Latest → bird card)
  const birdStatsEl = document.getElementById('obs-bird-stats');
  if (birdStatsEl) {
    function handleStatAction(action) {
      if (action === 'scroll-life') {
        const lifeEl = document.getElementById('obs-life');
        if (lifeEl) lifeEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (action === 'open-latest') {
        const latest = state.today[0];
        if (latest) openBirdCard(latest.common_name, latest.scientific_name || '');
      }
    }
    birdStatsEl.addEventListener('click', (e) => {
      const card = e.target.closest('[data-action]');
      if (card) handleStatAction(card.getAttribute('data-action'));
    });
    birdStatsEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('[data-action]');
      if (card) { e.preventDefault(); handleStatAction(card.getAttribute('data-action')); }
    });
  }

  // Delegate tap/click and keyboard activation on species + lifer cards
  function handleCardActivate(e) {
    const card = e.target.closest('[data-name]');
    if (!card) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    if (e.type === 'keydown') e.preventDefault();
    openBirdCard(card.dataset.name, card.dataset.sci || '');
  }
  const todayEl = document.getElementById('obs-today');
  const lifeEl  = document.getElementById('obs-life');
  if (todayEl) {
    todayEl.addEventListener('click',   handleCardActivate);
    todayEl.addEventListener('keydown', handleCardActivate);
  }
  if (lifeEl) {
    lifeEl.addEventListener('click',   handleCardActivate);
    lifeEl.addEventListener('keydown', handleCardActivate);
  }

  // Modal: backdrop click or × button closes; Escape anywhere closes
  const modal = document.getElementById('obs-bird-modal');
  if (modal) {
    modal.querySelector('.obs-bcard-backdrop').addEventListener('click', closeBirdCard);
    modal.querySelector('.obs-bcard-close').addEventListener('click', closeBirdCard);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBirdCard(); });

  const btn = document.getElementById('obs-refresh');
  if (btn) btn.addEventListener('click', loadAll);
  loadAll();
}

document.addEventListener('DOMContentLoaded', initObservatory);
