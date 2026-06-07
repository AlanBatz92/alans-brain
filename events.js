/* ──────────────────────────────────────────────────────────────
   What's On — local events aggregator

   Reads two sources and merges them:
     1. a hand-curated data/events.json — the two bot-walled venues
        (Shankweiler's → TicketLeap, the Emmaus Theatre → Eventbrite, both 403 a
        server fetch so they can't be auto-scraped). Ships with the site; edit the
        JSON to add a venue/event. Always available, even if the box is down.
     2. GET /api/events on birdstation — the *automated* buckets (Ticketmaster
        events near Allentown, Allentown/Emmaus civic meetings, election dates),
        served in the same {updated, venues[], events[]} shape.
   Both are fetched independently (Promise.allSettled); either failing degrades to
   the other rather than breaking the page (the box offline → curated-only).

   ID/class prefix: `ev-` (distinct from pulse-/obs-/sl-).
   ────────────────────────────────────────────────────────────── */

const EVENTS_URL = 'data/events.json';
const API_EVENTS_URL = 'https://birds.alansbrain.com/api/events?upcoming=1';
const EV_TZ = 'America/New_York';   // venues are Eastern; "today" is computed there

// Accent colors a venue may declare in JSON (maps to a theme var). Anything
// else falls back to teal, so a typo can never inject an arbitrary value.
const EV_COLORS = ['teal', 'blue', 'purple', 'pink', 'green', 'yellow', 'red'];

const state = {
  venues: [],
  events: [],         // upcoming only, sorted soonest-first
  byKey: {},          // venue key -> venue object
  venue: 'all',       // 'all' or a venue key
  query: ''           // lowercased search text
};

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : s;
  return d.innerHTML;
}

function accentVar(color) {
  return 'var(--' + (EV_COLORS.indexOf(color) === -1 ? 'teal' : color) + ')';
}

/* ── Dates ──
   Events carry a naive local date (YYYY-MM-DD) for an Eastern venue. We
   compare against "today in Eastern" as a string so an all-day event stays
   visible through its own day regardless of the viewer's clock/zone, and we
   build badges/diffs at UTC-noon to dodge any DST/off-by-one. */
function easternToday() {
  // en-CA renders as YYYY-MM-DD
  return new Date().toLocaleDateString('en-CA', { timeZone: EV_TZ });
}

function ymdToUTC(ymd) {
  const p = (ymd || '').split('-');
  return Date.UTC(+p[0], (+p[1] || 1) - 1, +p[2] || 1, 12, 0, 0);
}

function dayDiff(ymd, todayYmd) {
  return Math.round((ymdToUTC(ymd) - ymdToUTC(todayYmd)) / 86400000);
}

function dateBadge(ymd) {
  const d = new Date(ymdToUTC(ymd));
  const opt = { timeZone: 'UTC' };
  return {
    mon: d.toLocaleDateString('en-US', Object.assign({ month: 'short' }, opt)).toUpperCase(),
    day: d.toLocaleDateString('en-US', Object.assign({ day: 'numeric' }, opt)),
    dow: d.toLocaleDateString('en-US', Object.assign({ weekday: 'short' }, opt))
  };
}

// A short relative hint shown next to the date ("Today", "in 3 days", …).
function relativeWhen(diff) {
  if (diff < 0) return '';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 7) return 'in ' + diff + ' days';
  if (diff < 14) return 'next week';
  if (diff < 31) return 'in ' + Math.round(diff / 7) + ' weeks';
  if (diff < 45) return 'in a month';
  return 'in ' + Math.round(diff / 30) + ' months';
}

/* ── Upcoming + sorted ── */
function computeUpcoming(events, todayYmd) {
  return events
    .filter((e) => e && e.date && (e.end || e.date) >= todayYmd)
    .sort((a, b) => (a.date === b.date
      ? (a.title || '').localeCompare(b.title || '')
      : (a.date < b.date ? -1 : 1)));
}

/* ── Venues being aggregated (data-driven header) ── */
function renderVenues() {
  const box = document.getElementById('ev-venues');
  if (!box) return;
  box.innerHTML = state.venues.map((v) => {
    const accent = accentVar(v.color);
    const counts = state.events.filter((e) => e.venue === v.key).length;
    const meta = counts ? counts + (counts === 1 ? ' event' : ' events') + ' listed' : 'no events listed';
    return '<a class="ev-venue-card" href="' + escapeHtml(v.url || '#') + '"' +
             ' target="_blank" rel="noopener" style="--ev-accent:' + accent + '">' +
             '<span class="ev-venue-emoji">' + escapeHtml(v.emoji || '📍') + '</span>' +
             '<span class="ev-venue-info">' +
               '<span class="ev-venue-name">' + escapeHtml(v.name) + '</span>' +
               '<span class="ev-venue-loc">' + escapeHtml(v.location || '') + '</span>' +
               (v.blurb ? '<span class="ev-venue-blurb">' + escapeHtml(v.blurb) + '</span>' : '') +
               '<span class="ev-venue-meta">' + escapeHtml(meta) + ' · full schedule ↗</span>' +
             '</span>' +
           '</a>';
  }).join('');
}

/* ── Venue filter chips (All + one per venue, with counts) ── */
function renderFilters() {
  const bar = document.getElementById('ev-filters');
  if (!bar) return;
  const chips = [{ key: 'all', label: 'All', count: state.events.length }].concat(
    state.venues.map((v) => ({
      key: v.key,
      label: v.short || v.name,
      count: state.events.filter((e) => e.venue === v.key).length
    }))
  );
  bar.innerHTML = chips.map((c) => {
    const active = state.venue === c.key ? ' ev-chip-active' : '';
    return '<button class="ev-chip' + active + '" data-venue="' + escapeHtml(c.key) + '">' +
             escapeHtml(c.label) + ' <span class="ev-chip-n">' + c.count + '</span>' +
           '</button>';
  }).join('');
  bar.querySelectorAll('.ev-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.venue = btn.getAttribute('data-venue');
      renderFilters();
      renderEvents();
    });
  });
}

/* ── Apply venue filter + search ── */
function filteredEvents() {
  return state.events.filter((e) => {
    if (state.venue !== 'all' && e.venue !== state.venue) return false;
    if (state.query) {
      const v = state.byKey[e.venue];
      const hay = ((e.title || '') + ' ' + (e.detail || '') + ' ' + (e.category || '') + ' ' +
                   (v ? v.name : '')).toLowerCase();
      if (hay.indexOf(state.query) === -1) return false;
    }
    return true;
  });
}

/* ── Render the event cards ── */
function renderEvents() {
  const list = document.getElementById('ev-list');
  if (!list) return;
  const items = filteredEvents();
  const today = easternToday();

  if (items.length === 0) {
    list.innerHTML = '<div class="ev-empty">No upcoming events match — clear a filter or search above.</div>';
    updateMeta(0);
    return;
  }

  list.innerHTML = items.map((e) => {
    const v = state.byKey[e.venue] || { name: e.venue || 'Venue', emoji: '📍', color: 'teal' };
    const accent = accentVar(v.color);
    const b = dateBadge(e.date);
    const when = relativeWhen(dayDiff(e.date, today));
    const href = e.url ? escapeHtml(e.url) : escapeHtml(v.url || '#');
    return '<a class="ev-event" href="' + href + '" target="_blank" rel="noopener"' +
             ' style="--ev-accent:' + accent + '">' +
             '<div class="ev-date">' +
               '<span class="ev-date-mon">' + escapeHtml(b.mon) + '</span>' +
               '<span class="ev-date-day">' + escapeHtml(b.day) + '</span>' +
               '<span class="ev-date-dow">' + escapeHtml(b.dow) + '</span>' +
             '</div>' +
             '<div class="ev-body">' +
               '<div class="ev-title">' + escapeHtml(e.title) + '</div>' +
               (e.detail ? '<div class="ev-detail">' + escapeHtml(e.detail) + '</div>' : '') +
               '<div class="ev-meta">' +
                 '<span class="ev-venue-tag">' + escapeHtml(v.emoji || '📍') + ' ' +
                   escapeHtml(v.name) + '</span>' +
                 (e.category ? '<span class="ev-cat">' + escapeHtml(e.category) + '</span>' : '') +
                 (e.time ? '<span class="ev-time">' + escapeHtml(e.time) + '</span>' : '') +
                 (when ? '<span class="ev-when">' + escapeHtml(when) + '</span>' : '') +
               '</div>' +
             '</div>' +
           '</a>';
  }).join('');

  updateMeta(items.length);
}

function updateMeta(shown) {
  const meta = document.getElementById('ev-updated');
  if (!meta) return;
  const total = state.events.length;
  const head = (shown === total ? total : shown + '/' + total) +
               (total === 1 ? ' event' : ' events');
  const upd = state.updated ? ' · updated ' + state.updated : '';
  meta.textContent = head + upd;
}

/* ── Orchestrate ── */
function fetchJson(url) {
  return fetch(url, { cache: 'no-cache' }).then((resp) => {
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
  });
}

/* Merge the curated + live payloads (each {venues[], events[]}). Venues dedupe by
   key (curated wins); events dedupe by venue|date|title (the curated venues and the
   box buckets are disjoint, so this only guards against an accidental overlap). */
function mergeSources(curated, api) {
  const venues = [];
  const seenV = {};
  [curated, api].forEach((d) => {
    if (d && Array.isArray(d.venues)) {
      d.venues.forEach((v) => {
        if (v && v.key && !seenV[v.key]) { seenV[v.key] = 1; venues.push(v); }
      });
    }
  });
  const seenE = {};
  const events = [].concat(
    curated && Array.isArray(curated.events) ? curated.events : [],
    api && Array.isArray(api.events) ? api.events : []
  ).filter((e) => {
    if (!e) return false;
    const k = (e.venue || '') + '|' + (e.date || '') + '|' + (e.title || '');
    if (seenE[k]) return false;
    seenE[k] = 1;
    return true;
  });
  return { venues: venues, events: events };
}

async function loadEvents() {
  const list = document.getElementById('ev-list');
  const meta = document.getElementById('ev-updated');
  if (meta) meta.textContent = 'Loading…';
  if (list) list.innerHTML = '<div class="ev-loading">Gathering the local calendar…</div>';

  const [curatedR, apiR] = await Promise.allSettled([
    fetchJson(EVENTS_URL),
    fetchJson(API_EVENTS_URL)
  ]);
  const curated = curatedR.status === 'fulfilled' ? curatedR.value : null;
  const api = apiR.status === 'fulfilled' ? apiR.value : null;

  if (!curated && !api) {
    if (list) {
      const msg = curatedR.reason ? curatedR.reason.message : 'unavailable';
      list.innerHTML = '<div class="ev-empty">Couldn’t load the events list — ' +
                       escapeHtml(msg) + '.</div>';
    }
    if (meta) meta.textContent = 'Offline';
    return;
  }

  const merged = mergeSources(curated, api);
  state.venues = merged.venues;
  state.byKey = {};
  state.venues.forEach((v) => { state.byKey[v.key] = v; });
  state.updated = (curated && curated.updated) || (api && api.updated) || '';
  state.events = computeUpcoming(merged.events, easternToday());

  const noteEl = document.getElementById('ev-note');
  if (noteEl && curated && curated.note) noteEl.textContent = curated.note;

  renderVenues();
  renderFilters();
  renderEvents();
}

function initEvents() {
  const search = document.getElementById('ev-search');
  if (search) {
    search.addEventListener('input', () => {
      state.query = search.value.trim().toLowerCase();
      renderEvents();
    });
  }
  loadEvents();
}

document.addEventListener('DOMContentLoaded', initEvents);
