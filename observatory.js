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
  trainsAnalytics: API_BASE + '/api/trains/analytics',
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
const state = { life: [], lifeLoaded: false, periodGroups: [], period: 'today', periodLabel: 'today', periodLatest: null, searchQuery: '', periodSort: 'recent', lifeSort: 'recent', onlyPerfect: false, lifeOnlyPerfect: false,
  // "Almost a lifer" shelf — rolling-24h grouped species, filtered against the
  // life list at render time (so it tracks whichever of the two loads last).
  almost: [],
  // Analytics tab — lazy-loaded on first open, scoped by its own period selector.
  // `mode` is the dataset switch (🐦 birds / 🚂 trains); each keeps its own last
  // response so toggling back doesn't necessarily refetch. `data` mirrors the
  // active mode's data for the chart-detail popout.
  an: { period: 'week', mode: 'birds', data: null, loaded: false,
        birds: { data: null }, trains: { data: null } } };

// A detection "reads as 100%" when it rounds to 100% — i.e. >= 0.995, the same
// threshold the box uses to instant-add a lifer. The 100%-only filter keeps
// species whose best confidence in the period clears this.
const PERFECT_CONFIDENCE = 0.995;

// Life-list qualification, mirrored from birdstation's birdnet_pipeline: a *new*
// species joins after LIFE_LIST_MIN_HITS detections at ≥ the display floor (0.85)
// within a rolling LIFE_LIST_WINDOW_HOURS window, or a single ~100%
// (≥ PERFECT_CONFIDENCE) hit. The "Almost a lifer" shelf surfaces the species
// partway there — 1..MIN_HITS-1 qualifying hits, not yet listed.
const LIFE_LIST_MIN_HITS = 3;
const LIFE_LIST_WINDOW_HOURS = 24;
// Cumulative-evidence path (mirrors birdnet_pipeline): a species also lists once it
// has LIFE_LIST_CUMULATIVE_HITS detections at ≥ LIFE_LIST_CUMULATIVE_CONFIDENCE
// all-time, no time window — so a persistent moderate-confidence bird earns a spot.
const LIFE_LIST_CUMULATIVE_HITS = 8;
const LIFE_LIST_CUMULATIVE_CONFIDENCE = 0.70;

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
  return '<span class="obs-conf ' + confClass(conf) + '" title="BirdNET confidence">' +
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

// Like fmtUtcTs but keeps minutes/seconds — a full "YYYY-MM-DD HH:MM:SS" UTC
// string. The period windows floor to the hour; the rolling-24h "almost a lifer"
// window needs the exact instant so it tracks the box's life-list rule
// (datetime('now','-24 hours')) precisely rather than to the nearest hour.
function fmtUtcTsFull(ms) {
  const dt = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate()) +
         ' ' + pad(dt.getUTCHours()) + ':' + pad(dt.getUTCMinutes()) + ':' + pad(dt.getUTCSeconds());
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
    // Life list: all-time total; clickable → opens the life-list popout.
    { label: 'Life list',        value: state.life.length,
      action: state.life.length > 0 ? 'open-life' : null },
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

// Lowercased set of life-list names (common + scientific) so the species grid can
// tag the birds that are already on the life list ("Lifer" at a glance). Rebuilt
// from state.life on each render — cheap (N = lifer count).
function lifeNameSet() {
  const s = new Set();
  state.life.forEach((sp) => {
    if (sp.common_name)     s.add(sp.common_name.toLowerCase());
    if (sp.scientific_name) s.add(sp.scientific_name.toLowerCase());
  });
  return s;
}

// Is this period-group species on the life list? Matches common OR scientific name.
function isLiferGroup(g, lifers) {
  return lifers.has((g.common_name || '').toLowerCase()) ||
    (g.scientific_name ? lifers.has(g.scientific_name.toLowerCase()) : false);
}

function renderPeriodGroups() {
  const el      = document.getElementById('obs-today');
  const countEl = document.getElementById('obs-period-count');
  const q      = state.searchQuery.trim().toLowerCase();
  const lifers = lifeNameSet();
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
  // "N of M on the life list" summary for the current filtered set. Only shown once
  // the life list has loaded (so it doesn't briefly read "0 of M"); respects the
  // search + 100%-only filters because it counts the already-filtered `groups`.
  const lifersEl = document.getElementById('obs-period-lifers');
  if (lifersEl) {
    lifersEl.textContent = (state.lifeLoaded && groups.length)
      ? '★ ' + groups.filter((g) => isLiferGroup(g, lifers)).length +
        ' of ' + groups.length + ' on the life list'
      : '';
  }
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
    const isLifer = isLiferGroup(g, lifers);
    return '<div class="obs-species" role="button" tabindex="0"' +
        ' data-name="' + escapeAttr(g.common_name) + '" data-sci="' + escapeAttr(g.scientific_name || '') + '">' +
        '<div class="obs-species-top">' +
          '<span class="obs-species-name">' + escapeHtml(g.common_name) + '</span>' +
          '<span class="obs-species-meta">' +
            '<span class="obs-species-count">×' + g.count + '</span>' +
            (isLifer ? '<span class="obs-lifer-star" title="On the life list" aria-label="On the life list">★</span>' : '') +
          '</span>' +
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
  const countEl = document.getElementById('obs-life-count');
  if (!el) return;
  if (state.life.length === 0) {
    if (countEl) countEl.textContent = '';
    setMsg(el, 'obs-empty', 'No lifers logged yet.');
    return;
  }
  // 100%-only filter — keep lifers whose best-ever confidence reads as 100%
  // (≥ PERFECT_CONFIDENCE), mirroring the species grid's toggle.
  let list = state.life;
  if (state.lifeOnlyPerfect) {
    list = list.filter((s) => (s.best_confidence || 0) >= PERFECT_CONFIDENCE);
  }
  if (countEl) countEl.textContent = list.length ? '(' + list.length + ')' : '';
  if (list.length === 0) {
    setMsg(el, 'obs-empty', 'No lifers heard at 100% yet.');
    return;
  }
  const sorted = sortLifeList(list, state.lifeSort);
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
  state.lifeLoaded = true;
  renderBirdStats();
  renderLife();          // owns the life-list count (reflects the 100%-only filter)
  // Re-tag the species grid now that the life list is known — but only if the
  // period data has already landed (otherwise loadPeriod is still loading and will
  // render with tags itself; re-rendering here would clobber its loading state).
  if (state.periodGroups.length) renderPeriodGroups();
  renderAlmost();        // the shelf excludes listed species, so refresh it once life is known
}

/* ── Birds: "Almost a lifer" shelf ──
   Species heard at the display floor (≥ 0.85) within the rolling life-list window
   but not yet listed and short of the hit count — i.e. on the cusp. Turns the
   life-list rule into a progress game. Computed entirely client-side from the
   grouped endpoint (a rolling-24h window) minus the loaded life list, so it needs
   no box change. Independent of the period selector — the rule is always rolling-24h. */

// Pure (testable): from the rolling-window grouped species + the life list, return
// the species on the cusp — not yet listed, heard 1..need-1 times at the display
// floor in the window, and not a ~100% instant-add — ordered closest-first.
function computeAlmostLifers(groups, life, need, perfectConf) {
  const listed = new Set();
  (life || []).forEach((s) => {
    if (s.common_name)     listed.add(s.common_name.toLowerCase());
    if (s.scientific_name) listed.add(s.scientific_name.toLowerCase());
  });
  return (groups || []).filter((g) => {
    const c = g.count || 0;
    if (c < 1 || c >= need) return false;                          // none, or already qualified
    if ((g.best_confidence || 0) >= perfectConf) return false;     // a ~100% hit instant-adds
    if (listed.has((g.common_name || '').toLowerCase())) return false;
    if (g.scientific_name && listed.has(g.scientific_name.toLowerCase())) return false;
    return true;
  }).sort((a, b) =>
    (b.count - a.count) ||                                          // closest to the goal first
    ((parseTime(b.last_heard) || 0) - (parseTime(a.last_heard) || 0)));
}

function renderAlmost() {
  const section = document.getElementById('obs-almost-section');
  const el      = document.getElementById('obs-almost');
  const countEl = document.getElementById('obs-almost-count');
  if (!section || !el) return;
  // The shelf hinges on knowing the life list (to exclude listed species). Until
  // it has loaded, keep the bonus shelf hidden rather than risk showing a lifer.
  if (!state.lifeLoaded) { section.hidden = true; return; }

  const need = LIFE_LIST_MIN_HITS;
  const candidates = computeAlmostLifers(state.almost, state.life, need, PERFECT_CONFIDENCE);
  if (candidates.length === 0) { section.hidden = true; return; }   // bonus shelf — hide when nothing's close
  section.hidden = false;
  if (countEl) countEl.textContent = '(' + candidates.length + ')';

  el.innerHTML = candidates.map((g) => {
    const got    = Math.min(g.count || 0, need);
    const pct    = Math.round((got / need) * 100);
    const more   = need - got;
    const lastMs = parseTime(g.last_heard);
    return '<div class="obs-almost-card" role="button" tabindex="0"' +
        ' data-name="' + escapeAttr(g.common_name) + '" data-sci="' + escapeAttr(g.scientific_name || '') + '">' +
        '<div class="obs-almost-top">' +
          '<span class="obs-almost-name">' + escapeHtml(g.common_name) + '</span>' +
          '<span class="obs-almost-progress">' + got + ' of ' + need + '</span>' +
        '</div>' +
        (g.scientific_name ? '<div class="obs-almost-sci">' + escapeHtml(g.scientific_name) + '</div>' : '') +
        '<div class="obs-almost-track"><div class="obs-almost-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="obs-almost-foot">' +
          '<span class="obs-almost-need">' + more + ' more to go</span>' +
          (lastMs != null ? '<span class="obs-almost-last">last ' + escapeHtml(clockTime(lastMs)) + '</span>' : '') +
        '</div>' +
      '</div>';
  }).join('');
}

async function loadAlmost() {
  const now   = Date.now();
  const start = fmtUtcTsFull(now - LIFE_LIST_WINDOW_HOURS * 3600 * 1000);
  const end   = fmtUtcTsFull(now);
  let data;
  try {
    data = await fetchJson(
      API_BASE + '/api/detections/grouped?start=' + encodeURIComponent(start) +
      '&end=' + encodeURIComponent(end) + '&min_confidence=' + MIN_CONFIDENCE
    );
  } catch (err) {
    state.almost = [];
    renderAlmost();  // hides the section (it's a bonus shelf — no error noise if the box is down)
    return;
  }
  state.almost = data.species || [];
  renderAlmost();
}

/* ── Trains: analytics ──
   Train analytics live on the Analytics tab now (🚂 Trains switch), mirroring the
   bird analytics rather than crowding the Trains tab. Counts are TRAINS (passes —
   clips within a few minutes grouped into one), not raw clips, from a single call
   (GET /api/trains/analytics, all-time). `loadAnalytics` calls this when the switch
   is on Trains; it renders the headline cards + the "when" charts into the shared
   analytics containers. Returns false if the box is unreachable (leaves the tab
   unloaded so a refresh retries). */
async function loadTrainAnalytics() {
  setMsg(document.getElementById('obs-train-an-hours'), 'obs-loading', 'Crunching the numbers…');
  let a;
  try {
    a = await fetchJson(EP.trainsAnalytics);
  } catch (err) {
    setMsg(document.getElementById('obs-train-an-hours'), 'obs-empty',
      'Train analytics unavailable — the box may be offline.');
    const statsEl = document.getElementById('obs-an-stats');
    if (statsEl) statsEl.innerHTML = '';
    return false;
  }
  state.an.trains.data = a;
  state.an.data = a;
  const gap = a.median_headway_min;
  const gapLabel = gap == null ? '—'
    : (gap >= 90 ? (gap / 60).toFixed(1) + ' hr' : Math.round(gap) + ' min');
  renderStats(document.getElementById('obs-an-stats'), [
    { label: 'Trains',       value: (a.total_passes || 0).toLocaleString() },
    { label: 'Today',        value: a.passes_today || 0 },
    { label: 'Busiest hour', value: a.busiest_hour == null ? '—' : hourLabel(a.busiest_hour, true), small: true },
    { label: 'Typical gap',  value: gapLabel, small: true },
  ]);
  renderTrainHours(a.by_hour || []);
  renderTrainDaily(a.by_day || {});
  renderTrainDow(a.by_dow_hour || []);
  return true;
}

// Hour-of-day: when do trains pass (Eastern). Reuses the analytics bar styling,
// with a count drawn above each bar and the custom hover tooltip.
function renderTrainHours(byHour) {
  const el = document.getElementById('obs-train-an-hours');
  if (!el) return;
  const max = byHour.reduce((m, n) => Math.max(m, n), 0);
  if (!max) { setMsg(el, 'obs-empty', 'No trains detected yet.'); return; }
  const busiest = byHour.indexOf(max);
  el.innerHTML = hourBarsHtml(byHour, 'train', busiest);
}

// Trains per calendar day (Eastern). by_day is a {date: count} object.
function renderTrainDaily(byDayObj) {
  const section = document.getElementById('obs-train-an-daily-section');
  const el = document.getElementById('obs-train-an-daily');
  if (!el) return;
  const days = Object.keys(byDayObj).sort();
  if (days.length <= 1) { if (section) section.hidden = true; return; }
  if (section) section.hidden = false;
  const items = days.map((d) => ({
    date: d, count: byDayObj[d], tip: ymdLabel(d) + ' — ' + nbCount(byDayObj[d], 'train'),
  }));
  el.innerHTML = dailyChartHtml(items);
}

// Day-of-week × hour heatmap (one global color scale so volume compares across
// days). by_dow_hour is [7][24], row 0 = Monday (Python weekday()).
function renderTrainDow(dowHour) {
  const el = document.getElementById('obs-train-an-dow');
  if (!el) return;
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let gmax = 0;
  dowHour.forEach((row) => row.forEach((n) => { if (n > gmax) gmax = n; }));
  if (!gmax) { setMsg(el, 'obs-empty', 'Not enough data yet for the weekly view.'); return; }
  let head = '<div class="obs-an-hm-row obs-an-hm-head"><div class="obs-an-hm-label"></div><div class="obs-an-hm-cells">';
  for (let h = 0; h < 24; h++) head += '<div class="obs-an-hm-tick">' + (h % 6 === 0 ? hourLabel(h, false) : '') + '</div>';
  head += '</div></div>';
  const rows = dowHour.map((row, di) => {
    let cells = '';
    for (let h = 0; h < 24; h++) {
      const n = row[h];
      const alpha = n ? (0.14 + 0.86 * (n / gmax)) : 0;
      cells += '<div class="obs-an-hm-cell" data-tip="' +
        escapeAttr(DOW[di] + ' ' + hourLabel(h, true) + ' — ' + nbCount(n, 'train')) + '"' +
        (alpha ? ' style="background:rgba(45,212,191,' + alpha.toFixed(3) + ')"' : '') + '></div>';
    }
    return '<div class="obs-an-hm-row"><div class="obs-an-hm-label">' +
        '<span class="obs-an-hm-name">' + DOW[di] + '</span></div>' +
        '<div class="obs-an-hm-cells">' + cells + '</div></div>';
  }).join('');
  el.innerHTML = head + rows;
}

/* ── Trains: recent events with playable clips ── */
async function loadTrains() {
  const el = document.getElementById('obs-trains');
  setMsg(el, 'obs-loading', 'Checking the tracks…');
  let rows;
  try {
    rows = await fetchJson(EP.trainsRecent);
  } catch (err) {
    const latestEl = document.getElementById('obs-train-latest');
    if (latestEl) latestEl.hidden = true;
    setMsg(el, "obs-empty", "Couldn't reach the observatory — it may be offline.");
    return;
  }
  // Show everything the detector confirmed (verdict='train'), whether auto-detected
  // (reviewed=0) or human-verified (reviewed=1). Struck-off false positives
  // (verdict='false_positive') are excluded. Audio is gated separately (published).
  rows = (rows || []).filter((r) => r.verdict === 'train');
  // Newest first (the API returns this order, but sort defensively so the "last
  // train" card and the feed are correct even if that ever changes).
  rows.sort((a, b) => (parseTime(b.detected_at) || 0) - (parseTime(a.detected_at) || 0));
  rows = rows.slice(0, MAX_TRAINS);
  const latestEl = document.getElementById('obs-train-latest');
  if (rows.length === 0) {
    if (latestEl) latestEl.hidden = true;
    setMsg(el, 'obs-empty', 'No confirmed train events yet.');
    return;
  }

  // Normalize the loudness/duration meters against the shown set so the bars read
  // relative to recent passes (a fuller bar = louder / longer than its neighbors).
  const durs = rows.map((r) => Number(r.duration_s)).filter((n) => !isNaN(n));
  const dbs  = rows.map((r) => Number(r.peak_db)).filter((n) => !isNaN(n));
  const maxDur = durs.length ? Math.max.apply(null, durs) : 0;
  const minDb  = dbs.length ? Math.min.apply(null, dbs) : 0;
  const maxDb  = dbs.length ? Math.max.apply(null, dbs) : 0;

  renderTrainLatest(rows[0]);

  el.innerHTML = rows.map((r) => {
    const ms   = parseTime(r.detected_at);
    const when = ms != null ? shortDate(ms) + ' · ' + clockTime(ms) : '';
    const file = r.clip_path ? r.clip_path.split('/').pop() : '';
    // Audio is shown only for events explicitly published; otherwise the event
    // stands on its own (time/duration/dB) with no audio element and no note —
    // private-by-default is the norm, not worth calling out on every row.
    const clip = (file && r.published)
      ? '<audio class="obs-clip" controls preload="none" src="' +
          API_BASE + '/api/trains/clip/' + encodeURIComponent(file) + '"></audio>'
      : '';
    return '<div class="obs-train">' +
        '<div class="obs-train-head">' +
          (when ? '<span class="obs-train-when">' + escapeHtml(when) + '</span>' : '') +
          renderVerdict(r) +
        '</div>' +
        trainMeters(r, maxDur, minDb, maxDb) +
        clip +
      '</div>';
  }).join('');
}

// The most-recent pass, called out as a highlight card above the feed — answers
// "when did the last train go by?" at a glance (relative time + duration + loudness).
function renderTrainLatest(r) {
  const el = document.getElementById('obs-train-latest');
  if (!el) return;
  const ms = parseTime(r.detected_at);
  if (ms == null) { el.hidden = true; return; }
  const dur = r.duration_s != null ? Number(r.duration_s).toFixed(1) + 's' : null;
  const db  = r.peak_db != null ? Math.round(r.peak_db) + ' dB' : null;
  const chips = [
    dur ? '<span class="obs-tag">⏱ ' + escapeHtml(dur) + '</span>' : '',
    db  ? '<span class="obs-tag">🔊 ' + escapeHtml(db) + '</span>' : '',
    renderVerdict(r),
  ].join('');
  el.innerHTML =
    '<div class="obs-train-latest-label">🚂 Last train</div>' +
    '<div class="obs-train-latest-when">' + escapeHtml(relativeTime(ms)) + '</div>' +
    '<div class="obs-train-latest-sub">' + escapeHtml(shortDate(ms) + ' · ' + clockTime(ms)) + '</div>' +
    '<div class="obs-train-latest-chips">' + chips + '</div>';
  el.hidden = false;
}

// Loudness + duration shown as labeled meters (replaces the plain tags), so the
// feed reads visually. Bars are normalized across the shown set (see loadTrains).
function trainMeters(r, maxDur, minDb, maxDb) {
  const rows = [];
  if (r.peak_db != null && !isNaN(Number(r.peak_db))) {
    const v = Number(r.peak_db);
    // dB across a small recent set is a narrow band, so map min→max to 15–100%
    // (rather than 0) — a quiet pass still shows a visible sliver, not an empty bar.
    const pct = maxDb > minDb ? Math.round(15 + 85 * (v - minDb) / (maxDb - minDb)) : 100;
    rows.push(trainMeterRow('Loudness', Math.round(v) + ' dB', pct));
  }
  if (r.duration_s != null && !isNaN(Number(r.duration_s))) {
    const v = Number(r.duration_s);
    const pct = maxDur > 0 ? Math.round(Math.max(6, 100 * v / maxDur)) : 100;
    rows.push(trainMeterRow('Duration', v.toFixed(1) + 's', pct));
  }
  return rows.length ? '<div class="obs-train-meters">' + rows.join('') + '</div>' : '';
}

function trainMeterRow(label, value, pct) {
  return '<div class="obs-train-meter">' +
      '<span class="obs-train-meter-lbl">' + escapeHtml(label) + '</span>' +
      '<div class="obs-train-meter-track"><div class="obs-train-meter-fill" style="width:' + pct + '%"></div></div>' +
      '<span class="obs-train-meter-val">' + escapeHtml(value) + '</span>' +
    '</div>';
}

function renderVerdict(r) {
  // Only verdict='train' events reach the page. Distinguish auto-detected (the
  // calibrated detector's call) from human-verified.
  if (r.verdict !== 'train') return '';
  return r.reviewed
    ? '<span class="obs-verdict obs-verdict-train">✓ confirmed</span>'
    : '<span class="obs-verdict obs-verdict-auto">● auto-detected</span>';
}

/* ── Trains: "How these are detected" methodology panel ──
   Reads data/train-method.json (a static, JSON-driven record kept in sync with
   birdstation/DETECTION-METHODS.md) so the page states exactly how detection
   works, the active parameters, measured accuracy, and the caveats. A bonus
   panel — it fails silently if the file is missing. */
async function loadTrainMethod() {
  const body = document.getElementById('obs-train-method-body');
  if (!body) return;
  let m;
  try { m = await fetchJson('data/train-method.json'); }
  catch (err) { return; }
  let html = '';
  if (m.summary) html += '<p class="obs-method-summary">' + escapeHtml(m.summary) + '</p>';
  if (Array.isArray(m.method)) {
    html += '<ol class="obs-method-steps">' +
      m.method.map((s) => '<li>' + escapeHtml(s) + '</li>').join('') + '</ol>';
  }
  if (m.parameters) {
    html += '<h4 class="obs-method-h">Parameters</h4><table class="obs-method-params">' +
      Object.entries(m.parameters).map(([k, v]) =>
        '<tr><td>' + escapeHtml(k.replace(/_/g, ' ')) + '</td><td>' +
        escapeHtml(String(v)) + '</td></tr>').join('') + '</table>';
  }
  if (m.accuracy) {
    html += '<h4 class="obs-method-h">Accuracy</h4><p>' + escapeHtml(
      (m.accuracy.passes_caught || '') + ' of train passes caught, ' +
      (m.accuracy.precision || '') + ' precision. ' + (m.accuracy.note || '')) + '</p>';
  }
  if (Array.isArray(m.caveats)) {
    html += '<h4 class="obs-method-h">Caveats</h4><ul class="obs-method-caveats">' +
      m.caveats.map((c) => '<li>' + escapeHtml(c) + '</li>').join('') + '</ul>';
  }
  if (m.updated) {
    html += '<p class="obs-method-updated">Method updated ' + escapeHtml(m.updated) +
      '. <a href="https://github.com/AlanBatz92/alans-brain/blob/main/birdstation/DETECTION-METHODS.md"' +
      ' target="_blank" rel="noopener">Full methodology ↗</a></p>';
  }
  body.innerHTML = html;
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

// Glue a count to its unit with a non-breaking space ("188 detections"), so a
// wrapping tooltip never strands the number on its own line away from "detections".
function nbCount(n, singular, plural) {
  return n.toLocaleString() + '\u00A0' + (n === 1 ? singular : (plural || singular + 's'));
}

// A short label for a number drawn directly on a bar, so a big count (1,284) stays
// legible in a narrow column: 1k+ collapses to "1.3k" / "12k". Tooltips and the
// chart-detail popout still show the full number; this is just the inline label.
function compactNum(n) {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (k >= 10 ? Math.round(k) : (Math.round(k * 10) / 10)) + 'k';
}

// Bar charts scale to this share of the track height (not the full 100%), leaving
// a top band for the number printed above each bar so the tallest one never clips.
const BAR_HEADROOM_PCT = 86;

/* \u2500\u2500 Dawn-chorus shading \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   The hour-chart caption talks about "the dawn chorus and the quiet hours"; this
   shades the 24 columns by Emmaus' real day/night cycle so you can *see* it. Sun
   times come from a trimmed SunCalc (Vladimir Agafonkin, MIT \u2014 pure vanilla, no
   deps), computed for the selected period's midpoint date and read in Eastern. */
const OBS_LAT = 40.5409;   // Emmaus, PA
const OBS_LON = -75.4976;

// Sunrise/sunset for a date+location \u2192 { sunrise: Date, sunset: Date } (UTC
// epoch), or null when the sun never crosses the horizon (polar day/night).
function sunTimes(date, lat, lng) {
  const rad = Math.PI / 180, dayMs = 86400000, J1970 = 2440588, J2000 = 2451545;
  const e = rad * 23.4397, J0 = 0.0009;
  const toDays = (d) => d.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const fromJulian = (j) => new Date((j + 0.5 - J1970) * dayMs);
  const lw = rad * -lng, phi = rad * lat, d = toDays(date);
  const n  = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M  = rad * (357.5291 + 0.98560028 * ds);
  const L  = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) +
             rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const h0 = -0.833 * rad;   // standard sunrise/sunset altitude (refraction + disc)
  const cosw = (Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosw < -1 || cosw > 1) return null;
  const w = Math.acos(cosw);
  const aTransit = J0 + (w + lw) / (2 * Math.PI) + n;
  const Jset  = J2000 + aTransit + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const Jrise = Jnoon - (Jset - Jnoon);
  return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset) };
}

// A UTC Date \u2192 its Eastern wall-clock time as a decimal hour (e.g. 5.55 = 5:33 AM),
// so sun times line up with the chart's Eastern hour buckets. null if invalid.
function easternDecimalHour(date) {
  if (!date || isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: OBS_TZ, hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return (get('hour') % 24) + get('minute') / 60;
}

// Build a left\u2192right CSS gradient for the chart background, mapping the 24-hour
// span to one continuous "sky": night \u2192 a soft dawn glow around sunrise \u2192 clear
// day \u2192 a warm dusk near sunset \u2192 night. sr/ss are Eastern decimal hours. Smooth
// transitions read as a sky band rather than the blocky per-column tints we had.
function sunGradient(sr, ss) {
  const NIGHT = 'rgba(2,6,23,0.5)';
  const DAWN  = 'rgba(255,190,92,0.22)';
  const DAY   = 'rgba(255,255,255,0)';
  const DUSK  = 'rgba(255,140,100,0.15)';
  const pct = (h) => Math.max(0, Math.min(100, (h / 24) * 100));
  const a = pct(sr - 1.0);   // night holds until ~an hour before sunrise
  const b = pct(sr + 0.5);   // dawn glow peaks just after sunrise
  const c = pct(sr + 2.0);   // faded to clear day
  const d = pct(ss - 2.0);   // clear day holds until ~2h before sunset
  const e = pct(ss - 0.3);   // dusk warmth peaks near sunset
  const f = pct(ss + 1.0);   // back to night ~an hour after sunset
  return 'linear-gradient(to right,' +
    NIGHT + ' 0%,' + NIGHT + ' ' + a + '%,' +
    DAWN  + ' ' + b + '%,' + DAY + ' ' + c + '%,' +
    DAY   + ' ' + d + '%,' + DUSK + ' ' + e + '%,' +
    NIGHT + ' ' + f + '%,' + NIGHT + ' 100%)';
}

/* Custom hover tooltip for the analytics charts. Native `title` is slow (≈1s
   delay), unstyled, and never fires on touch; this instant, themed bubble reads
   each element's `data-tip` text and tracks the cursor. All the figures it shows
   (per-hour totals, per-cell species×hour counts, per-day totals) come straight
   from the period-scoped /api/analytics response, so they respect the active
   filter context (Today / Yesterday / This week / …). */
let anTipEl = null;
function ensureTip() {
  if (!anTipEl) {
    anTipEl = document.createElement('div');
    anTipEl.className = 'obs-an-tip';
    anTipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(anTipEl);
  }
  return anTipEl;
}
function positionTip(x, y) {
  const t = anTipEl;
  if (!t) return;
  const r = t.getBoundingClientRect();
  let left = x + 14;
  let top  = y + 16;
  if (left + r.width  > window.innerWidth  - 8) left = x - r.width  - 14;
  if (left < 8) left = 8;
  if (top  + r.height > window.innerHeight - 8) top  = y - r.height - 16;
  t.style.left = left + 'px';
  t.style.top  = top + 'px';
}
function showTip(text, x, y) {
  const t = ensureTip();
  t.textContent = text;
  t.classList.add('obs-an-tip-show');
  positionTip(x, y);
}
function hideTip() {
  if (anTipEl) anTipEl.classList.remove('obs-an-tip-show');
}
// Wire delegated hover tooltips on the chart containers (they persist across
// re-renders, so one listener each survives every period change).
function initAnTooltips() {
  ['obs-an-hours', 'obs-an-heatmap', 'obs-an-daily',
   'obs-train-an-hours', 'obs-train-an-daily', 'obs-train-an-dow',
   'obs-chart-body'].forEach((id) => {
    const c = document.getElementById(id);
    if (!c) return;
    c.addEventListener('mousemove', (e) => {
      const el = e.target.closest('[data-tip]');
      if (!el) { hideTip(); return; }
      showTip(el.getAttribute('data-tip'), e.clientX, e.clientY);
    });
    c.addEventListener('mouseleave', hideTip);
  });
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

// Shared inner markup for the 24-bar hour-of-day charts (birds + trains): a count
// printed above each bar (compact so it stays legible in a narrow column) and the
// custom hover tooltip. Bars scale to BAR_HEADROOM_PCT so the top number can't clip.
function hourBarsHtml(byHour, unit, peak) {
  const max = byHour.reduce((m, n) => Math.max(m, n), 0) || 1;
  let html = '';
  for (let h = 0; h < 24; h++) {
    const n = byHour[h];
    const pct = Math.round((n / max) * BAR_HEADROOM_PCT);
    const tip = hourLabel(h, true) + ' — ' + nbCount(n, unit);
    html += '<div class="obs-an-hbar-wrap" data-tip="' + escapeAttr(tip) + '">' +
        '<div class="obs-an-hbar-track">' +
          '<div class="obs-an-hbar' + (h === peak ? ' obs-an-hbar-peak' : '') +
            '" style="height:' + pct + '%">' +
            (n > 0 ? '<span class="obs-an-bar-num">' + escapeHtml(compactNum(n)) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="obs-an-haxis">' + (h % 6 === 0 ? hourLabel(h, false) : '') + '</div>' +
      '</div>';
  }
  return html;
}

// Shared per-day bar chart (birds + trains). items: [{date, count, tip}]. Numbers
// are drawn above each bar only when there are ≤ 31 of them, so a month-or-less
// reads cleanly while a year's worth stays uncluttered (the detail popout labels all).
function dailyChartHtml(items) {
  const max = items.reduce((m, it) => Math.max(m, it.count), 0) || 1;
  const showNums = items.length <= 31;
  const bars = items.map((it) => {
    const pct = Math.round((it.count / max) * BAR_HEADROOM_PCT);
    return '<div class="obs-an-dbar-wrap" data-tip="' + escapeAttr(it.tip) + '">' +
        '<div class="obs-an-dbar-track"><div class="obs-an-dbar" style="height:' + pct + '%">' +
          (showNums && it.count > 0 ? '<span class="obs-an-bar-num">' + escapeHtml(compactNum(it.count)) + '</span>' : '') +
        '</div></div>' +
      '</div>';
  }).join('');
  return '<div class="obs-an-daily-bars">' + bars + '</div>' +
    '<div class="obs-an-daily-axis"><span>' + escapeHtml(ymdLabel(items[0].date)) + '</span><span>' +
      escapeHtml(ymdLabel(items[items.length - 1].date)) + '</span></div>';
}

// Hour-of-day activity — 24 vertical bars, the busiest hour highlighted, over a
// continuous day/night "sky" gradient (dawn glow at sunrise, warm dusk at sunset).
function renderHourChart(byHour) {
  const el = document.getElementById('obs-an-hours');
  const sunEl = document.getElementById('obs-an-suninfo');
  if (!el) return;
  const max = byHour.reduce((m, n) => Math.max(m, n), 0);
  if (!max) {
    setMsg(el, 'obs-empty', 'No detections in this period.');
    if (sunEl) sunEl.innerHTML = '';
    return;
  }
  // Sun times for the period midpoint (Eastern). Absent/invalid → no shading.
  const sun = state.an.sun;
  const sr  = sun ? easternDecimalHour(sun.sunrise) : null;
  const ss  = sun ? easternDecimalHour(sun.sunset)  : null;
  const shade = sr != null && ss != null;
  const busiest = byHour.indexOf(max);
  // One continuous gradient layer behind all the columns, rather than per-column
  // tints (which read as gappy blocks). The bars sit above it (z-index in CSS).
  const bg = shade
    ? '<div class="obs-an-hours-bg" style="background:' + sunGradient(sr, ss) + '"></div>'
    : '';
  el.innerHTML = bg + hourBarsHtml(byHour, 'detection', busiest);
  if (sunEl) {
    sunEl.innerHTML = shade
      ? '<span class="obs-an-suninfo-item">🌅 ' + escapeHtml(clockTime(sun.sunrise.getTime())) + '</span>' +
        '<span class="obs-an-suninfo-item">🌇 ' + escapeHtml(clockTime(sun.sunset.getTime())) + '</span>'
      : '';
  }
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
        nbCount(n, 'detection'));
      cells += '<div class="obs-an-hm-cell" data-tip="' + tip + '"' +
        (alpha ? ' style="background:rgba(45,212,191,' + alpha.toFixed(3) + ')"' : '') +
        '></div>';
    }
    return '<div class="obs-an-hm-row">' +
        '<div class="obs-an-hm-label" role="button" tabindex="0"' +
          ' title="' + escapeAttr(s.common_name) + '"' +
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
  const items = byDay.map((d) => ({
    date: d.date, count: d.count,
    tip: ymdLabel(d.date) + ' — ' + nbCount(d.count, 'detection') + ', ' +
      nbCount(d.species, 'species', 'species'),
  }));
  el.innerHTML = dailyChartHtml(items);
}

// Switch the analytics dataset (🐦 birds / 🚂 trains). Toggles the mode buttons,
// shows the matching section set + note, hides the bird-only period bar for trains
// (the train endpoint is all-time), and (re)loads that dataset.
function setAnMode(mode) {
  if (mode !== 'trains') mode = 'birds';
  state.an.mode = mode;
  state.an.data = mode === 'trains' ? state.an.trains.data : state.an.birds.data;

  document.querySelectorAll('#obs-an-modes .obs-an-mode').forEach((b) => {
    const on = b.getAttribute('data-mode') === mode;
    b.classList.toggle('obs-an-mode-active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const birdsWrap = document.getElementById('obs-an-birds');
  const trainsWrap = document.getElementById('obs-an-trains');
  if (birdsWrap)  birdsWrap.hidden  = mode !== 'birds';
  if (trainsWrap) trainsWrap.hidden = mode !== 'trains';

  // Trains analytics are all-time (the box endpoint isn't period-scoped), so the
  // period selector only applies to birds — hide it (and reframe the note) on trains.
  const periodBar = document.getElementById('obs-an-period-bar');
  if (periodBar) periodBar.hidden = mode === 'trains';
  const note = document.getElementById('obs-an-note');
  if (note) {
    note.textContent = mode === 'trains'
      ? 'All times in Eastern (Emmaus, PA). Counted as passes — clips within a few minutes are one train. All-time.'
      : 'All times in Eastern (Emmaus, PA). Only detections at 85%+ confidence are counted.';
  }

  loadAnalytics(state.an.period);
}

async function loadAnalytics(period) {
  if (state.an.mode === 'trains') {
    const ok = await loadTrainAnalytics();
    if (ok) state.an.loaded = true;
    return;
  }

  const { start, end, label } = periodDates(period);
  state.an.period = period;
  state.an.label  = label;
  // Sun times for the period's midpoint date, used to shade the hour chart. For
  // multi-day periods this is representative (the chart aggregates all the days).
  const midMs = (parseTime(start) + parseTime(end)) / 2;
  state.an.sun = isNaN(midMs) ? null : sunTimes(new Date(midMs), OBS_LAT, OBS_LON);

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
  state.an.birds.data = a;
  state.an.data = a;
  state.an.loaded = true;
  renderAnStats(a);
  renderHourChart(a.by_hour || []);
  renderHeatmap(a.species_hours || []);
  renderLeaderboard(a.top_species || []);
  renderDaily(a.by_day || []);
}

/* ── Chart detail popout ──────────────────────────────────────
   Tapping any analytics chart (or its ⤢ button) opens an enlarged, fully-labeled
   version: every axis tick, a number on each bar, and the full (un-truncated) list
   for the heatmaps / leaderboard. This is the on-touch path too — the hover tooltip
   never fires on a phone, so this is how mobile reads the per-bar numbers. */

// Build a big, horizontally-scrollable bar chart for the detail popout. items:
// [{label, count, tip}]; every bar is numbered and every column labeled.
function detailBars(items, peakIdx) {
  const max = items.reduce((m, it) => Math.max(m, it.count), 0) || 1;
  const colW = items.length > 40 ? 22 : 34;   // narrower columns when there are many
  const bars = items.map((it, i) => {
    const pct = Math.round((it.count / max) * BAR_HEADROOM_PCT);
    return '<div class="obs-an-hbar-wrap" data-tip="' + escapeAttr(it.tip) + '">' +
        '<div class="obs-an-hbar-track"><div class="obs-an-hbar' +
          (i === peakIdx ? ' obs-an-hbar-peak' : '') + '" style="height:' + pct + '%">' +
          (it.count > 0 ? '<span class="obs-an-bar-num">' + escapeHtml(it.count.toLocaleString()) + '</span>' : '') +
        '</div></div>' +
        '<div class="obs-an-haxis obs-an-haxis-all">' + escapeHtml(it.label) + '</div>' +
      '</div>';
  }).join('');
  return '<div class="obs-chart-scroll"><div class="obs-an-hours obs-an-hours-detail" style="min-width:' +
    (items.length * colW) + 'px">' + bars + '</div></div>';
}

// Heatmap (species×hour or dow×hour) for the popout — larger cells, optional count
// printed in each cell. rows: [{label, sub, cells:[24], rowMax|globalMax}].
function detailHeatmap(rows, globalMax, showCellNums) {
  let head = '<div class="obs-an-hm-row obs-an-hm-head"><div class="obs-an-hm-label"></div><div class="obs-an-hm-cells">';
  for (let h = 0; h < 24; h++) head += '<div class="obs-an-hm-tick">' + hourLabel(h, false) + '</div>';
  head += '</div></div>';
  const body = rows.map((r) => {
    const max = globalMax || r.cells.reduce((m, n) => Math.max(m, n), 0) || 1;
    let cells = '';
    for (let h = 0; h < 24; h++) {
      const n = r.cells[h];
      const alpha = n ? (0.14 + 0.86 * (n / max)) : 0;
      cells += '<div class="obs-an-hm-cell" data-tip="' + escapeAttr(r.label + ' · ' + hourLabel(h, true) + ' — ' + nbCount(n, 'count')) + '"' +
        (alpha ? ' style="background:rgba(45,212,191,' + alpha.toFixed(3) + ')"' : '') + '>' +
        (showCellNums && n > 0 ? '<span class="obs-an-hm-num">' + n + '</span>' : '') + '</div>';
    }
    return '<div class="obs-an-hm-row"><div class="obs-an-hm-label">' +
        '<span class="obs-an-hm-name">' + escapeHtml(r.label) + '</span>' +
        (r.sub ? '<span class="obs-an-hm-total">' + escapeHtml(r.sub) + '</span>' : '') +
      '</div><div class="obs-an-hm-cells">' + cells + '</div></div>';
  }).join('');
  return '<div class="obs-chart-scroll"><div class="obs-an-heatmap obs-an-heatmap-detail">' + head + body + '</div></div>';
}

const DOW_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Open the popout for one chart, built from the active mode's cached data.
function openChartDetail(key) {
  const modal = document.getElementById('obs-chart-modal');
  const titleEl = document.getElementById('obs-chart-title');
  const subEl = document.getElementById('obs-chart-sub');
  const body = document.getElementById('obs-chart-body');
  if (!modal || !body) return;
  const a = state.an.data;
  if (!a) return;
  let title = '', sub = '', html = '';

  if (key === 'hours' || key === 'train-hours') {
    const byHour = a.by_hour || [];
    const unit = key === 'train-hours' ? 'train' : 'detection';
    const max = byHour.reduce((m, n) => Math.max(m, n), 0);
    const items = byHour.map((n, h) => ({
      label: hourLabel(h, false), count: n, tip: hourLabel(h, true) + ' — ' + nbCount(n, unit),
    }));
    title = key === 'train-hours' ? 'When trains pass' : 'When the birds sing';
    sub = 'By hour of day, Eastern' + (max ? ' · busiest ' + hourLabel(byHour.indexOf(max), true) : '');
    html = max ? detailBars(items, byHour.indexOf(max)) : '<p class="obs-empty">No data yet.</p>';

  } else if (key === 'daily' || key === 'train-daily') {
    const unit = key === 'train-daily' ? 'train' : 'detection';
    let items;
    if (key === 'train-daily') {
      const obj = a.by_day || {};
      items = Object.keys(obj).sort().map((d) => ({
        label: ymdLabel(d), count: obj[d], tip: ymdLabel(d) + ' — ' + nbCount(obj[d], unit),
      }));
    } else {
      items = (a.by_day || []).map((d) => ({
        label: ymdLabel(d.date), count: d.count,
        tip: ymdLabel(d.date) + ' — ' + nbCount(d.count, unit) +
          (d.species != null ? ', ' + nbCount(d.species, 'species', 'species') : ''),
      }));
    }
    title = key === 'train-daily' ? 'Trains per day' : 'Activity over time';
    sub = items.length + ' days';
    const peak = items.reduce((pi, it, i, arr) => it.count > arr[pi].count ? i : pi, 0);
    html = items.length ? detailBars(items, peak) : '<p class="obs-empty">No data yet.</p>';

  } else if (key === 'heatmap') {
    const sh = a.species_hours || [];
    title = 'Who sings when';
    sub = sh.length + ' species · each row shaded to its own busiest hour';
    html = sh.length
      ? detailHeatmap(sh.map((s) => ({ label: s.common_name, sub: '×' + s.total, cells: s.hours })), null, false)
      : '<p class="obs-empty">Not enough data yet.</p>';

  } else if (key === 'train-dow') {
    const dh = a.by_dow_hour || [];
    let gmax = 0;
    dh.forEach((row) => row.forEach((n) => { if (n > gmax) gmax = n; }));
    title = 'When across the week';
    sub = 'Day-of-week × hour · numbers shown where trains passed';
    html = gmax
      ? detailHeatmap(dh.map((row, di) => ({ label: DOW_NAMES[di], cells: row })), gmax, true)
      : '<p class="obs-empty">Not enough data yet for the weekly view.</p>';

  } else if (key === 'leaderboard') {
    const top = a.top_species || [];
    title = 'Most heard';
    sub = top.length + ' species';
    if (!top.length) {
      html = '<p class="obs-empty">No species in this period.</p>';
    } else {
      const max = top[0].count || 1;
      html = '<div class="obs-an-leaderboard obs-an-leaderboard-detail">' + top.map((s, i) => {
        const pct = Math.round((s.count / max) * 100);
        return '<div class="obs-an-lb-row" role="button" tabindex="0"' +
            ' data-name="' + escapeAttr(s.common_name) + '" data-sci="' + escapeAttr(s.scientific_name || '') + '">' +
            '<span class="obs-an-lb-rank">' + (i + 1) + '</span>' +
            '<div class="obs-an-lb-main"><div class="obs-an-lb-top">' +
              '<span class="obs-an-lb-name">' + escapeHtml(s.common_name) + '</span>' +
              '<span class="obs-an-lb-count">' + s.count.toLocaleString() + '</span>' +
            '</div><div class="obs-an-lb-track"><div class="obs-an-lb-fill" style="width:' + pct + '%"></div></div></div>' +
          '</div>';
      }).join('') + '</div>';
    }
  } else {
    return;
  }

  titleEl.textContent = title;
  subEl.textContent = sub;
  body.innerHTML = html;
  body.scrollTop = 0;
  modal.classList.add('obs-chart-open');
  document.body.style.overflow = 'hidden';
}

function closeChartDetail() {
  const modal = document.getElementById('obs-chart-modal');
  if (modal) modal.classList.remove('obs-chart-open');
  // Don't unlock the page if a bird card is open on top (leaderboard → card).
  const card = document.getElementById('obs-bird-modal');
  if (!(card && card.classList.contains('obs-bcard-open'))) document.body.style.overflow = '';
}

function chartModalOpen() {
  const m = document.getElementById('obs-chart-modal');
  return m && m.classList.contains('obs-chart-open');
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

// qualified_via codes the box records on the lifetime row → a human phrase for the
// card. 'grandfathered' (joined before the current rules) is handled separately.
const VIA_LABEL = {
  instant_100:   'a single ~100% detection',
  burst_24h:     '3 detections at 85%+ within 24 hours',
  cumulative_70: '8 detections at 70%+ over time',
};

// The three ways onto the life list, with this bird's standing in each (the count
// it has and whether that path's bar is met). Answers "how it makes the life list"
// and surfaces a per-method count, as asked. The 24h figure is the live rolling
// window; the ~100% and 70%+ figures are all-time. Derived from data /api/species
// already returns (no box change): ~100% hits come from confidence_series, the 24h
// and cumulative counts from hits_24h / hits_cumulative.
function lifeListBreakdown(hist) {
  const need    = hist.life_list_min_hits || LIFE_LIST_MIN_HITS;
  const cumNeed = hist.life_list_cumulative_hits || LIFE_LIST_CUMULATIVE_HITS;
  const cumPct  = Math.round((hist.life_list_cumulative_confidence || LIFE_LIST_CUMULATIVE_CONFIDENCE) * 100);
  const dispPct = Math.round(MIN_CONFIDENCE * 100);  // 85
  const hits100 = (hist.confidence_series || []).filter((c) => c >= PERFECT_CONFIDENCE).length;
  const hits24h = hist.hits_24h || 0;
  const hitsCum = hist.hits_cumulative || 0;
  const onList  = !!hist.on_life_list;
  const via     = hist.qualified_via || null;

  const methods = [
    { met: hits100 >= 1,       got: hits100, need: 1,
      label: 'One detection at ~100%',                       note: 'an unmistakable single hit' },
    { met: hits24h >= need,    got: hits24h, need: need,
      label: need + ' detections at ' + dispPct + '%+ in 24h', note: 'a confident burst in one day' },
    { met: hitsCum >= cumNeed, got: hitsCum, need: cumNeed,
      label: cumNeed + ' detections at ' + cumPct + '%+, all-time', note: 'weight of evidence over time' },
  ];

  const rows = methods.map((m) => {
    const mark = m.met
      ? '<span class="obs-bcard-method-mark obs-bcard-method-mark--met">✓</span>'
      : '<span class="obs-bcard-method-mark">·</span>';
    // Met → show the actual count (✓ implies the bar is cleared); not yet → "got / need".
    const val = m.met ? String(m.got) : m.got + ' / ' + m.need;
    return '<div class="obs-bcard-method' + (m.met ? ' obs-bcard-method--met' : '') + '">' +
        mark +
        '<span class="obs-bcard-method-label">' + escapeHtml(m.label) +
          '<span class="obs-bcard-method-note">' + escapeHtml(m.note) + '</span>' +
        '</span>' +
        '<span class="obs-bcard-method-count">' + escapeHtml(val) + '</span>' +
      '</div>';
  }).join('');

  const metCount = methods.filter((m) => m.met).length;
  let head, caption;
  if (onList) {
    head = '<div class="obs-bcard-status obs-bcard-status--on">✓ On the life list</div>';
    if (via === 'grandfathered') {
      // The Grackle case: joined under an earlier, lower bar, so it meets none of the
      // current paths. State the history instead of showing three "failed" rows.
      caption = 'On the list from before the current rules — it joined under an earlier, ' +
        'lower confidence bar. Its standing under today’s three paths:';
    } else if (via && VIA_LABEL[via]) {
      // Box recorded exactly how it qualified.
      const qMs  = parseTime(hist.qualified_at);
      const when = qMs != null ? ' on ' + shortDate(qMs) : '';
      caption = 'Made the life list by ' + VIA_LABEL[via] + when +
        '. Its standing under today’s three paths:';
    } else {
      // No durable record yet (DB not backfilled / older API) — infer from standing.
      caption = metCount > 0
        ? 'Currently meets the path' + (metCount > 1 ? 's' : '') + ' marked ✓ below.'
        : 'It qualified earlier — the counts below are its current standing.';
    }
  } else {
    head = '<div class="obs-bcard-status">Not yet a lifer</div>';
    caption = 'Any one of these three paths earns a spot:';
  }

  return '<div class="obs-bcard-hits-head">How it makes the life list</div>' +
    head +
    '<div class="obs-bcard-method-cap">' + escapeHtml(caption) + '</div>' +
    '<div class="obs-bcard-methods">' + rows + '</div>';
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

  // How it makes the life list — the three qualifying paths, this bird's count in
  // each, and which it currently meets (✓). Replaces the old single-line status.
  // Followed by recent hits — the last 10 detections (newest first) with confidence
  // + time, reaching down to the 0.60 preserve floor so the lower diagnostic hits
  // that explain a not-yet-lifer are visible.
  if (hist && Array.isArray(hist.recent) && hist.recent.length > 0) {
    html += lifeListBreakdown(hist);

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
      // Grounds the percentages as "confidence" right where they're listed, so a
      // visitor who meets the word cold elsewhere on the page has the context.
      '<div class="obs-bcard-hits-note">Each detection’s confidence — how sure BirdNET was — newest first.</div>' +
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

function lifeModalOpen() {
  const m = document.getElementById('obs-life-modal');
  return !!(m && m.classList.contains('obs-life-open'));
}

function closeBirdCard() {
  const modal = document.getElementById('obs-bird-modal');
  if (modal) modal.classList.remove('obs-bcard-open');
  // A bird card can layer over the open life list or the chart popout (its
  // leaderboard rows open cards); only release the page scroll lock if nothing else
  // is still up.
  document.body.style.overflow = (lifeModalOpen() || chartModalOpen()) ? 'hidden' : '';
}

/* ── Life list popout ──
   The full life list lives in a bottom-sheet/centered modal (no inline section),
   opened from the "Life list" stat card. renderLife() already populates #obs-life
   and the count inside it; opening just reveals the modal. */
function openLifeModal() {
  const modal = document.getElementById('obs-life-modal');
  if (!modal) return;
  modal.classList.add('obs-life-open');
  document.body.style.overflow = 'hidden';
  const body = modal.querySelector('.obs-life-modal-body');
  if (body) body.scrollTop = 0;
}

function closeLifeModal() {
  const modal = document.getElementById('obs-life-modal');
  if (modal) modal.classList.remove('obs-life-open');
  // Don't unlock the page if a bird card is still open on top of the list.
  const card = document.getElementById('obs-bird-modal');
  const cardOpen = card && card.classList.contains('obs-bcard-open');
  if (!cardOpen) document.body.style.overflow = '';
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
  // loadPeriod now — one consistent Eastern-aligned path. The Trains tab is the raw
  // feed (recent events + method); train *analytics* live on the Analytics tab.
  // Analytics is only refreshed if it's already been opened (it lazy-loads on first
  // open) — and then in whichever mode (birds/trains) is active.
  const refreshes = [loadPeriod(state.period), loadLife(), loadAlmost(), loadTrains(), loadTrainMethod()];
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

  // Analytics dataset switch (🐦 Birds / 🚂 Trains)
  document.querySelectorAll('#obs-an-modes .obs-an-mode').forEach((btn) => {
    btn.addEventListener('click', () => setAnMode(btn.getAttribute('data-mode')));
  });

  // Tap any chart (or its ⤢ button) to open the enlarged detail popout. Delegated on
  // the whole analytics panel so it survives every re-render; the ⤢ buttons and the
  // tappable hour/daily charts both carry data-chart. (Heatmap rows / leaderboard
  // rows keep their own data-name → bird-card click, so we only open the detail from
  // an explicit [data-chart] target, never a stray tap inside the heatmap.)
  const anPanel = document.getElementById('obs-panel-analytics');
  if (anPanel) {
    anPanel.addEventListener('click', (e) => {
      const t = e.target.closest('[data-chart]');
      if (t) openChartDetail(t.getAttribute('data-chart'));
    });
    anPanel.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target.closest('.obs-an-tappable[data-chart], .obs-an-expand[data-chart]');
      if (t) { e.preventDefault(); openChartDetail(t.getAttribute('data-chart')); }
    });
  }

  // Chart detail popout: backdrop / × close; leaderboard rows inside still open cards
  const chartModal = document.getElementById('obs-chart-modal');
  if (chartModal) {
    chartModal.querySelector('.obs-chart-backdrop').addEventListener('click', closeChartDetail);
    chartModal.querySelector('.obs-chart-modal-close').addEventListener('click', closeChartDetail);
  }
  const chartBody = document.getElementById('obs-chart-body');
  if (chartBody) {
    chartBody.addEventListener('click', handleCardActivate);
    chartBody.addEventListener('keydown', handleCardActivate);
  }

  // Instant hover tooltips on the analytics charts (hour bars, heatmap cells, daily
  // bars) — birds, trains, and the detail popout body.
  initAnTooltips();

  // Species search (client-side filter, no refetch)
  const searchEl = document.getElementById('obs-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      state.searchQuery = searchEl.value;
      renderPeriodGroups();
    });
  }

  // 100%-only filter toggle (species grid)
  const perfectEl = document.getElementById('obs-perfect');
  if (perfectEl) {
    perfectEl.addEventListener('click', () => {
      state.onlyPerfect = !state.onlyPerfect;
      perfectEl.setAttribute('aria-pressed', state.onlyPerfect ? 'true' : 'false');
      renderPeriodGroups();
    });
  }

  // 100%-only filter toggle (life list) — same affordance as the species grid
  const lifePerfectEl = document.getElementById('obs-life-perfect');
  if (lifePerfectEl) {
    lifePerfectEl.addEventListener('click', () => {
      state.lifeOnlyPerfect = !state.lifeOnlyPerfect;
      lifePerfectEl.setAttribute('aria-pressed', state.lifeOnlyPerfect ? 'true' : 'false');
      renderLife();
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
    if (action === 'open-life') {
      openLifeModal();
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
  const cardContainers = ['obs-today', 'obs-life', 'obs-almost', 'obs-an-heatmap', 'obs-an-top'];
  cardContainers.forEach((id) => {
    const c = document.getElementById(id);
    if (c) {
      c.addEventListener('click',   handleCardActivate);
      c.addEventListener('keydown', handleCardActivate);
    }
  });

  // Bird card modal: backdrop click or × button closes
  const modal = document.getElementById('obs-bird-modal');
  if (modal) {
    modal.querySelector('.obs-bcard-backdrop').addEventListener('click', closeBirdCard);
    modal.querySelector('.obs-bcard-close').addEventListener('click', closeBirdCard);
  }

  // Life list modal: backdrop click or × button closes
  const lifeModal = document.getElementById('obs-life-modal');
  if (lifeModal) {
    lifeModal.querySelector('.obs-life-backdrop').addEventListener('click', closeLifeModal);
    lifeModal.querySelector('.obs-life-modal-close').addEventListener('click', closeLifeModal);
  }

  // Escape closes the topmost open modal (bird card layers over the life list /
  // chart popout)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const card = document.getElementById('obs-bird-modal');
    if (card && card.classList.contains('obs-bcard-open')) closeBirdCard();
    else if (chartModalOpen()) closeChartDetail();
    else if (lifeModalOpen()) closeLifeModal();
  });

  const btn = document.getElementById('obs-refresh');
  if (btn) btn.addEventListener('click', loadAll);
  loadAll();
}

document.addEventListener('DOMContentLoaded', initObservatory);
