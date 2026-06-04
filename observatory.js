/* ──────────────────────────────────────────────────────────────
   Observatory — Emmaus Bird Observatory front end

   A thin reader over birdstation (https://birds.alansbrain.com), the
   home box that runs BirdNET acoustic detection and an FFT train-noise
   detector. This page reads the box's GET endpoints once on load and
   renders two tabs:

     🐦 Birds  — headline stats, today's species (grouped), the life list.
     🚂 Trains — event stats and recent events with playable WAV clips.

   Confidence gate — three tiers. The box *preserves* detections ≥ 0.60 (cutting
   the worst noise while keeping sub-85% diagnostics), this page's *display* floor
   is MIN_CONFIDENCE (0.85) so only confident birds show in the grid/stats, and the
   *life list* adds a count rule on top (box-side): a new species joins only after
   3 detections at ≥ 0.85 within a rolling 24 hours, or a single ~100% detection.
   The bird-card "recent hits" list reaches down to the preserve floor on purpose,
   so you can see the lower hits that explain why a species isn't yet a lifer. We
   pass ?min_confidence to the API (honored once birdstation is redeployed with the
   param; harmlessly ignored before that) AND filter client-side, so the page is
   correct in both states.

   Every section fetches independently: one endpoint failing (or the box
   being offline) degrades that section to an offline/empty state without
   taking down the others.

   POC: load-once with a manual ↻ refresh, no auto-polling.
   ────────────────────────────────────────────────────────────── */

const API_BASE = 'https://birds.alansbrain.com';

// Only birds at/above this confidence land on the page grid/stats — the display
// floor. The box preserves down to 0.60 (so the bird card can show lower
// diagnostic hits), and the life list adds a count rule on top (3 hits at ≥ 0.85
// within 24h, or one ~100% hit). Display, preserve, and life-list are decoupled.
const MIN_CONFIDENCE = 0.85;

const EP = {
  lifetime:     API_BASE + '/api/lifetime',
  trainStats:   API_BASE + '/api/trains/stats',
  // Privacy: only events a human has explicitly approved (verdict=train) are
  // ever shown publicly. We ask the API for approved-only AND filter again
  // client-side, so an un-reviewed clip (which could contain conversation
  // picked up by the mic) can never surface on the public page.
  trainsRecent: API_BASE + '/api/trains/recent?limit=30&approved=1',
};

const MAX_TRAINS = 30;   // matches the recent-events query limit

// Cross-section bird state — stats are derived from the active period + life
// together, so we stash both and recompute the stat cards as each arrives.
// `periodLabel` mirrors the selected period for the stat-card labels; the period
// grid's "latest" species is stashed in `periodLatest` for the Latest card.
const state = { life: [], periodGroups: [], period: 'today', periodLabel: 'today', periodLatest: null, searchQuery: '', periodSort: 'recent', lifeSort: 'recent', onlyPerfect: false,
  // Analytics tab — lazy-loaded on first open, scoped by its own period selector.
  an: { period: 'week', data: null, loaded: false } };

// A detection "reads as 100%" when it rounds to 100% — i.e. >= 0.995, the same
// threshold the box uses to instant-add a lifer. The 100%-only filter keeps
// species whose best confidence in the period clears this.
const PERFECT_CONFIDENCE = 0.995;

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

// Confidence (0–1) → bucket class. The page grid only shows ≥ 0.85 (all high),
// but the bird card's recent-hits list reaches down to the 0.60 preserve floor,
// so the mid (≥ 0.75) and low (< 0.75) bands colour those diagnostic hits.
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
  } else if (period === 'year') {
    startE = e.getFullYear() + '-01-01';
    endE = today; label = 'this year';
  } else if (period === 'all') {
    // Wide-open range — earlier than any possible data, through today.
    startE = '2000-01-01'; endE = today; label = 'all time';
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

/* ── Birds: headline stats — reflect the selected time period ──
   "Heard / Species / Latest" track whichever period is active (Today, Yesterday,
   This week/month/year); "Life list" is always the all-time total. All three
   period stats derive from state.periodGroups (one row per species, each with a
   count), so a single sum/length gives the right totals for any range and the
   labels switch with the period ("Heard today" → "Heard this month", …). */
function renderBirdStats() {
  const el = document.getElementById('obs-bird-stats');
  if (!el) return;
  const groups = state.periodGroups;
  const label  = state.periodLabel;
  const heardN = groups.reduce((sum, g) => sum + (g.count || 0), 0);
  // Latest = the species heard most recently within the selected period.
  let latest = null, latestMs = -Infinity;
  groups.forEach((g) => {
    const ms = parseTime(g.last_heard);
    if (ms != null && ms > latestMs) { latestMs = ms; latest = g; }
  });
  state.periodLatest = latest;
  renderStats(el, [
    { label: 'Heard ' + label,   value: heardN.toLocaleString() },
    { label: 'Species ' + label, value: groups.length },
    // Life list: all-time total; clickable → smooth-scroll to the life list.
    { label: 'Life list',        value: state.life.length,
      action: state.life.length > 0 ? 'scroll-life' : null },
    // Latest: most recent species this period; clickable → opens its bird card.
    { label: 'Latest',           value: latest ? latest.common_name : '—', small: true,
      action: latest ? 'open-latest' : null },
  ]);
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
  let groups = q
    ? sorted.filter((g) =>
        g.common_name.toLowerCase().includes(q) ||
        (g.scientific_name || '').toLowerCase().includes(q))
    : sorted;
  // 100%-only filter: keep species whose best confidence in the period reads as 100%.
  if (state.onlyPerfect) {
    groups = groups.filter((g) => (g.best_confidence || 0) >= PERFECT_CONFIDENCE);
  }
  if (countEl) countEl.textContent = groups.length ? '(' + groups.length + ')' : '';
  if (groups.length === 0) {
    let msg;
    if (q) msg = 'No species match "' + q + '".';
    else if (state.onlyPerfect) msg = 'No species heard at 100% in this period.';
    else msg = 'Nothing detected in this period yet — quiet skies.';
    setMsg(el, 'obs-empty', msg);
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

/* ── Analytics ───────────────────────────────────────────────
   The Analytics tab visualizes detection *distributions* over a selected period,
   all from a single box-side aggregation (GET /api/analytics, Eastern-bucketed):
   an hour-of-day activity chart (the dawn chorus), a species×hour heatmap
   ("who sings when"), a most-heard leaderboard, and a per-day activity chart.
   The page just draws CSS bars/cells — no chart library (vanilla, per conventions).
   Heatmap rows + leaderboard rows carry data-name/data-sci, so the existing card
   delegation opens a bird card on tap. */

// Format an hour 0–23 as a clock label. `long` → "6 AM"; compact → "6a" / "12p".
function hourLabel(h, long) {
  const suffix = h < 12 ? (long ? ' AM' : 'a') : (long ? ' PM' : 'p');
  let hr = h % 12; if (hr === 0) hr = 12;
  return hr + suffix;
}

// Pretty "Mon D" from an Eastern "YYYY-MM-DD" string the server already computed.
// Build at local noon from the parts so it never reparses/rolls to another day.
function ymdLabel(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderAnStats(a) {
  const el = document.getElementById('obs-an-stats');
  if (!el) return;
  const busiest = a.busiest_hour != null ? hourLabel(a.busiest_hour, true) : '—';
  const peak    = a.peak_day ? ymdLabel(a.peak_day.date) : '—';
  renderStats(el, [
    { label: 'Detections ' + (state.an.label || ''), value: (a.total_detections || 0).toLocaleString() },
    { label: 'Species',      value: a.total_species || 0 },
    { label: 'Busiest hour', value: busiest, small: true },
    { label: 'Peak day',     value: peak, small: true },
  ]);
}

// Hour-of-day activity — 24 vertical bars, the busiest hour highlighted.
function renderHourChart(byHour) {
  const el = document.getElementById('obs-an-hours');
  if (!el) return;
  const max = byHour.reduce((m, n) => Math.max(m, n), 0);
  if (!max) { setMsg(el, 'obs-empty', 'No detections in this period.'); return; }
  const busiest = byHour.indexOf(max);
  let html = '';
  for (let h = 0; h < 24; h++) {
    const n = byHour[h];
    const pct = Math.round((n / max) * 100);
    const tip = hourLabel(h, true) + ' — ' + n.toLocaleString() + ' detection' + (n === 1 ? '' : 's');
    html += '<div class="obs-an-hbar-wrap" title="' + escapeAttr(tip) + '">' +
        '<div class="obs-an-hbar-track">' +
          '<div class="obs-an-hbar' + (h === busiest ? ' obs-an-hbar-peak' : '') +
            '" style="height:' + pct + '%"></div>' +
        '</div>' +
        '<div class="obs-an-haxis">' + (h % 6 === 0 ? hourLabel(h, false) : '') + '</div>' +
      '</div>';
  }
  el.innerHTML = html;
}

// Species × hour heatmap — each row self-normalized to its own busiest hour, so
// the *pattern* (when, not how much) is what shows. A ×total badge conveys volume.
function renderHeatmap(speciesHours) {
  const el = document.getElementById('obs-an-heatmap');
  if (!el) return;
  if (!speciesHours || speciesHours.length === 0) {
    setMsg(el, 'obs-empty', 'Not enough data yet for a heatmap.');
    return;
  }
  let head = '<div class="obs-an-hm-row obs-an-hm-head">' +
    '<div class="obs-an-hm-label"></div><div class="obs-an-hm-cells">';
  for (let h = 0; h < 24; h++) {
    head += '<div class="obs-an-hm-tick">' + (h % 6 === 0 ? hourLabel(h, false) : '') + '</div>';
  }
  head += '</div></div>';

  const rows = speciesHours.map((s) => {
    const max = s.hours.reduce((m, n) => Math.max(m, n), 0) || 1;
    let cells = '';
    for (let h = 0; h < 24; h++) {
      const n = s.hours[h];
      const alpha = n ? (0.14 + 0.86 * (n / max)) : 0;
      const tip = escapeAttr(s.common_name + ' · ' + hourLabel(h, true) + ' — ' +
        n + ' detection' + (n === 1 ? '' : 's'));
      cells += '<div class="obs-an-hm-cell" title="' + tip + '"' +
        (alpha ? ' style="background:rgba(45,212,191,' + alpha.toFixed(3) + ')"' : '') +
        '></div>';
    }
    return '<div class="obs-an-hm-row">' +
        '<div class="obs-an-hm-label" role="button" tabindex="0"' +
          ' data-name="' + escapeAttr(s.common_name) + '" data-sci="' + escapeAttr(s.scientific_name || '') + '">' +
          '<span class="obs-an-hm-name">' + escapeHtml(s.common_name) + '</span>' +
          '<span class="obs-an-hm-total">×' + s.total + '</span>' +
        '</div>' +
        '<div class="obs-an-hm-cells">' + cells + '</div>' +
      '</div>';
  }).join('');
  el.innerHTML = head + rows;
}

// Most-heard leaderboard — top 15, each a clickable row with a proportional bar.
function renderLeaderboard(topSpecies) {
  const el = document.getElementById('obs-an-top');
  const countEl = document.getElementById('obs-an-top-count');
  if (!el) return;
  if (!topSpecies || topSpecies.length === 0) {
    if (countEl) countEl.textContent = '';
    setMsg(el, 'obs-empty', 'No species in this period.');
    return;
  }
  const shown = topSpecies.slice(0, 15);
  if (countEl) {
    countEl.textContent = topSpecies.length > shown.length
      ? '(top ' + shown.length + ' of ' + topSpecies.length + ')' : '(' + shown.length + ')';
  }
  const max = shown[0].count || 1;
  el.innerHTML = shown.map((s, i) => {
    const pct = Math.round((s.count / max) * 100);
    return '<div class="obs-an-lb-row" role="button" tabindex="0"' +
        ' data-name="' + escapeAttr(s.common_name) + '" data-sci="' + escapeAttr(s.scientific_name || '') + '">' +
        '<span class="obs-an-lb-rank">' + (i + 1) + '</span>' +
        '<div class="obs-an-lb-main">' +
          '<div class="obs-an-lb-top">' +
            '<span class="obs-an-lb-name">' + escapeHtml(s.common_name) + '</span>' +
            '<span class="obs-an-lb-count">' + s.count.toLocaleString() + '</span>' +
          '</div>' +
          '<div class="obs-an-lb-track"><div class="obs-an-lb-fill" style="width:' + pct + '%"></div></div>' +
        '</div>' +
      '</div>';
  }).join('');
}

// Per-day activity — only meaningful across multiple days, so Today/Yesterday
// (≤ 1 day) hide the section; the hour-of-day chart already covers a single day.
function renderDaily(byDay) {
  const section = document.getElementById('obs-an-daily-section');
  const el = document.getElementById('obs-an-daily');
  if (!el || !section) return;
  if (!byDay || byDay.length <= 1) { section.hidden = true; return; }
  section.hidden = false;
  const max = byDay.reduce((m, d) => Math.max(m, d.count), 0) || 1;
  const bars = byDay.map((d) => {
    const pct = Math.round((d.count / max) * 100);
    const tip = escapeAttr(ymdLabel(d.date) + ' — ' + d.count.toLocaleString() +
      ' detection' + (d.count === 1 ? '' : 's') + ', ' + d.species + ' species');
    return '<div class="obs-an-dbar-wrap" title="' + tip + '">' +
        '<div class="obs-an-dbar-track"><div class="obs-an-dbar" style="height:' + pct + '%"></div></div>' +
      '</div>';
  }).join('');
  const first = ymdLabel(byDay[0].date);
  const last  = ymdLabel(byDay[byDay.length - 1].date);
  el.innerHTML = '<div class="obs-an-daily-bars">' + bars + '</div>' +
    '<div class="obs-an-daily-axis"><span>' + escapeHtml(first) + '</span><span>' +
      escapeHtml(last) + '</span></div>';
}

async function loadAnalytics(period) {
  const { start, end, label } = periodDates(period);
  state.an.period = period;
  state.an.label  = label;

  // Reflect the active period button
  document.querySelectorAll('#obs-an-periods .obs-period-tab').forEach((t) => {
    const on = t.getAttribute('data-period') === period;
    t.classList.toggle('obs-period-tab-active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  const hoursEl = document.getElementById('obs-an-hours');
  setMsg(hoursEl, 'obs-loading', 'Crunching the numbers…');
  ['obs-an-heatmap', 'obs-an-top'].forEach((id) => {
    const e = document.getElementById(id); if (e) e.innerHTML = '';
  });

  let a;
  try {
    a = await fetchJson(
      API_BASE + '/api/analytics?start=' + encodeURIComponent(start) +
      '&end=' + encodeURIComponent(end) + '&min_confidence=' + MIN_CONFIDENCE
    );
  } catch (err) {
    setMsg(hoursEl, 'obs-empty', 'Couldn\'t reach the observatory — it may be offline.');
    return;  // leave state.an.loaded false so reopening/refresh retries
  }
  state.an.data = a;
  state.an.loaded = true;
  renderAnStats(a);
  renderHourChart(a.by_hour || []);
  renderHeatmap(a.species_hours || []);
  renderLeaderboard(a.top_species || []);
  renderDaily(a.by_day || []);
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

  // Photo — plain image (not a link, so it's not an easy accidental tap-out to
  // Wikipedia; the deliberate "↗ Wikipedia" text link below the name handles that).
  if (hasPhoto) {
    html += '<img class="obs-bcard-photo" src="' + escapeAttr(wiki.photo) +
      '" alt="' + escapeAttr(commonName) + '">';
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

  // Recent hits — the last 10 detections (newest first), each with its confidence
  // and time. Makes the life-list math legible at a glance: a species shown here
  // but not on the life list simply hasn't logged enough qualifying hits within
  // the rolling 24h window yet (e.g. 2 of 3), or its hits are spread too far apart.
  if (hist && Array.isArray(hist.recent) && hist.recent.length > 0) {
    const need = hist.life_list_min_hits || 3;
    let status;
    if (hist.on_life_list) {
      status = '<div class="obs-bcard-status obs-bcard-status--on">✓ On the life list</div>';
    } else {
      const got = Math.min(hist.hits_24h || 0, need);
      status = '<div class="obs-bcard-status">Not yet a lifer — ' + got + ' of ' + need +
        ' qualifying hits (≥85%) in the last 24h</div>';
    }
    const items = hist.recent.map((h) => {
      const ms   = parseTime(h.timestamp);
      const when = ms != null ? shortDate(ms) + ' · ' + clockTime(ms) : '';
      return '<div class="obs-bcard-hit">' +
          confPill(h.confidence) +
          '<span class="obs-bcard-hit-when">' + escapeHtml(when) + '</span>' +
        '</div>';
    }).join('');
    html += '<div class="obs-bcard-hits-head">Recent hits' +
        '<span class="obs-bcard-hits-sub">last ' + hist.recent.length + '</span>' +
      '</div>' +
      status +
      '<div class="obs-bcard-hits">' + items + '</div>';
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
  const histPromise = fetchJson(API_BASE + '/api/species/' + encodeURIComponent(commonName) +
      '?min_confidence=' + MIN_CONFIDENCE)
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
  birds:     'What is the source of all that chirping?!',
  analytics: 'The shape of the chorus.',
  trains:    'I like trains.',
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
      document.getElementById('obs-panel-birds').hidden     = which !== 'birds';
      document.getElementById('obs-panel-analytics').hidden = which !== 'analytics';
      document.getElementById('obs-panel-trains').hidden    = which !== 'trains';
      if (taglineEl && TAGLINES[which]) taglineEl.textContent = TAGLINES[which];
      // Analytics is heavier (a box-side aggregation), so only fetch it the first
      // time the tab is opened — not on every page load.
      if (which === 'analytics' && !state.an.loaded) loadAnalytics(state.an.period);
    });
  });
}

async function loadPeriod(period) {
  const { start, end, label } = periodDates(period);
  state.period      = period;
  state.periodLabel = label;
  state.searchQuery = '';
  const searchEl  = document.getElementById('obs-search');
  if (searchEl) searchEl.value = '';
  const headingEl = document.getElementById('obs-period-heading');
  if (headingEl) headingEl.textContent = 'Heard ' + label;

  // Every period — including Today — uses the same Eastern-aligned grouped query, so
  // the counts are mutually consistent (Today ⊆ This week, etc.). The box stores UTC,
  // so a UTC-day endpoint (/api/today) disagreed with these Eastern day windows after
  // UTC midnight (evening Eastern); routing Today through grouped fixes that.
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
  renderBirdStats();
  renderPeriodGroups();
}

/* ── Orchestrate ── */
function loadAll() {
  const updated = document.getElementById('obs-updated');
  const btn = document.getElementById('obs-refresh');
  if (updated) updated.textContent = 'Loading…';
  if (btn) btn.classList.add('spinning');

  // The bird grid + stats for the active period (Today included) all come from
  // loadPeriod now — one consistent Eastern-aligned path. Analytics is only
  // refreshed if it's already been opened (it lazy-loads on first tab open).
  const refreshes = [loadPeriod(state.period), loadLife(), loadTrainStats(), loadTrains()];
  if (state.an.loaded) refreshes.push(loadAnalytics(state.an.period));

  Promise.allSettled(refreshes).then(() => {
    if (updated) updated.textContent = 'Updated ' + new Date().toLocaleTimeString();
    if (btn) btn.classList.remove('spinning');
  });
}

function initObservatory() {
  initTabs();

  // Period selector tabs (Birds panel only — the Analytics tab has its own set,
  // also class .obs-period-tab, scoped separately below by #obs-an-periods)
  const periodTabs = document.querySelectorAll('#obs-panel-birds .obs-period-tab');
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

  // Analytics period selector (loadAnalytics sets the active button + fetches)
  document.querySelectorAll('#obs-an-periods .obs-period-tab').forEach((tab) => {
    tab.addEventListener('click', () => loadAnalytics(tab.getAttribute('data-period')));
  });

  // Species search (client-side filter, no refetch)
  const searchEl = document.getElementById('obs-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      state.searchQuery = searchEl.value;
      renderPeriodGroups();
    });
  }

  // 100%-only filter toggle
  const perfectEl = document.getElementById('obs-perfect');
  if (perfectEl) {
    perfectEl.addEventListener('click', () => {
      state.onlyPerfect = !state.onlyPerfect;
      perfectEl.setAttribute('aria-pressed', state.onlyPerfect ? 'true' : 'false');
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
  function handleStatAction(action) {
    if (action === 'scroll-life') {
      const lifeEl = document.getElementById('obs-life');
      if (lifeEl) lifeEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (action === 'open-latest') {
      const latest = state.periodLatest;
      if (latest) openBirdCard(latest.common_name, latest.scientific_name || '');
    }
  }
  const birdStatsEl = document.getElementById('obs-bird-stats');
  if (birdStatsEl) {
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
  const cardContainers = ['obs-today', 'obs-life', 'obs-an-heatmap', 'obs-an-top'];
  cardContainers.forEach((id) => {
    const c = document.getElementById(id);
    if (c) {
      c.addEventListener('click',   handleCardActivate);
      c.addEventListener('keydown', handleCardActivate);
    }
  });

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
