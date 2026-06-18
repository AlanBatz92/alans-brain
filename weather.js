/* ══════════════════════════════════════
   MY WEEK — Weather Outlook Engine
   Alan's Brain
   ══════════════════════════════════════ */

// ⚡ CONFIGURATION
var WEATHER_CONFIG = {
  proxyBase: '/api/weather',             // Vercel serverless proxy (holds the OWM key server-side)
  units: 'imperial',                     // 'imperial' (°F, mph) or 'metric' (°C, m/s)
  cacheTTL: 2 * 60 * 60 * 1000          // 2 hours in ms
};

// 📍 LOCATIONS — add, remove, or reorder as needed
var WEATHER_LOCATIONS = [
  { name: 'Emmaus',     lat: 40.5393, lon: -75.4969 },
  { name: 'Allentown',  lat: 40.6084, lon: -75.4902 },
  { name: 'Bethlehem',  lat: 40.6259, lon: -75.3705 },
  { name: 'Easton',     lat: 40.6910, lon: -75.2210 },
  { name: 'Kutztown',   lat: 40.5176, lon: -75.7774 }
];

// 🎛 THRESHOLDS — tweak these to adjust scoring sensitivity
// Each array entry: [min, max, points]  (higher points = better conditions)
var THRESHOLDS = {

  // ── Running ──
  // Driven by feels-like (apparent temp — which already folds in humidity & wind chill),
  // precipitation, wind, and *dew point* (the runner's real "mugginess" metric — far more
  // telling than raw RH). Bands are deliberately gentle at the comfortable end (no cliff
  // at ~75°F). Max points: feels 40 · precip 25 · wind 18 · dew 17 = 100. UV is NOT scored
  // for running (it doesn't make a run bad — that's a sunscreen note, not a quality hit).
  // Heat + humidity is captured twice on purpose where it should be: a muggy 85° reads as a
  // higher *feels-like* (lower temp pts) AND a higher dew point (lower dew pts); a dry 85°
  // does not. Sources: dew-point comfort scale (≤55°F dry … ≥70°F oppressive) used widely in
  // running guidance; apparent-temperature (NWS heat index / wind chill) for feels-like.
  run_feelsLike: [[50, 68, 40], [45, 49, 36], [69, 73, 36], [40, 44, 30], [74, 78, 32],
                  [35, 39, 22], [79, 82, 24], [83, 86, 14], [30, 34, 12], [87, 90, 7], [91, 95, 3]],
  run_pop:       [[0, 10, 25], [11, 25, 18], [26, 50, 10], [51, 75, 4], [76, 100, 1]],  // precipitation %
  run_wind:      [[0, 7, 18], [8, 12, 15], [13, 18, 11], [19, 24, 6], [25, 99, 2]],     // mph
  run_dewPoint:  [[-50, 54, 17], [55, 59, 13], [60, 64, 9], [65, 69, 5], [70, 74, 2], [75, 130, 0]],  // °F, lower = drier
  run_rainCap:   50,            // cap when it's actively precipitating
  run_hotCapAt:  92, run_hotCap: 30,    // dangerous heat → no better than Poor
  run_coldCapAt: 24, run_coldCap: 45,   // bitter cold → no better than Fair

  // ── Tanning ──  UV is what actually tans you, so it leads; then clear skies (direct
  // sun), warmth (comfortable to lie out), and a calm-ish breeze. Higher UV tans faster —
  // and burns faster, hence the "wear sunscreen" note in the explainer. Sources: UV-index
  // meaning (WHO/EPA) + sunbathing comfort temps. Max: UV 35 · clouds 25 · temp 25 · wind 15.
  tan_uvi:    [[6, 20, 35], [4, 5.9, 26], [2.5, 3.9, 14], [1, 2.4, 5]],
  tan_clouds: [[0, 15, 25], [16, 35, 17], [36, 60, 8], [61, 80, 3], [81, 100, 0]],   // cloud cover %
  tan_temp:   [[78, 92, 25], [72, 77, 18], [93, 97, 16], [66, 71, 9], [98, 103, 6], [60, 65, 3]],
  tan_wind:   [[0, 8, 15], [9, 14, 10], [15, 20, 5], [21, 99, 1]],
  tan_rainCap:   12,            // rain → no tanning
  tan_coldCapAt: 58, tan_coldCap: 30,   // too cold to comfortably lie out

  // ── Drone ──  Wind & gusts dominate (consumer drones resist ~20–24 mph, Beaufort 5);
  // drones aren't waterproof (rain), need visual line-of-sight (fog) + daylight, and run
  // LiPo batteries that fade in cold / overheat in extreme heat. Sources: DJI wind-resistance
  // specs + Beaufort scale; FAA VLOS/daylight rules. Max: wind 35 · gust 25 · precip 25 · temp 15.
  drone_wind:    [[0, 7, 35], [8, 12, 28], [13, 17, 18], [18, 23, 8], [24, 99, 2]],   // mph
  drone_gust:    [[0, 12, 25], [13, 18, 18], [19, 24, 10], [25, 31, 3], [32, 99, 0]],
  drone_pop:     [[0, 5, 25], [6, 15, 15], [16, 30, 6], [31, 100, 1]],
  drone_temp:    [[50, 85, 15], [40, 49, 10], [86, 95, 10], [32, 39, 5], [96, 104, 4]],  // LiPo range
  drone_rainCap: 15,            // not waterproof
  drone_fogCap:  35,            // must keep visual line-of-sight
  drone_lowVis:  5000,          // metres (hourly visibility) below which VLOS is a concern
  drone_highWindCap: 30,
  drone_highWindThreshold: 22,  // sustained wind (mph) near small-drone limits
  drone_coldCapAt: 33, drone_coldCap: 75,   // below freezing → batteries fade (fly, but not "Perfect")

  // ── Rating cutoffs ──
  perfect: 85,
  good:    65,
  fair:    45
};

var weatherCache = null;

// Location timezone offset (seconds), from the API's `timezone_offset`, refreshed on
// each render. Hour/day bucketing uses these so the "best window" times and day labels
// read in the *forecast location's* clock — not whatever timezone the visitor is in.
var tzOffsetSec = 0;
function locHour(dt)       { return new Date((dt + tzOffsetSec) * 1000).getUTCHours(); }
function locDow(dt)        { return new Date((dt + tzOffsetSec) * 1000).getUTCDay(); }
function locDateStr(dt)    { return new Date((dt + tzOffsetSec) * 1000).toISOString().slice(0, 10); }
function locTodayDateStr() { return locDateStr(Math.floor(Date.now() / 1000)); }

/* ── CUSTOM WEATHER ICONS ─────────────── */

var WEATHER_ICONS = {
  storm:        { file: 'storm.png',         emoji: '⛈' },
  rain:         { file: 'rain.png',          emoji: '🌧' },
  snow:         { file: 'snow.png',          emoji: '🌨' },
  fog:          { file: 'fog.png',           emoji: '🌫' },
  clear:        { file: 'clear.png',         emoji: '☀️' },
  partlyCloudy: { file: 'partly-cloudy.png', emoji: '🌤' },
  mostlyCloudy: { file: 'mostly-cloudy.png', emoji: '⛅' },
  overcast:     { file: 'overcast.png',      emoji: '☁️' }
};

var ICON_BASE = 'img/Icons/icons/Weather/';
var iconAvailability = {};

function probeIcons() {
  Object.keys(WEATHER_ICONS).forEach(function(key) {
    var img = new Image();
    var src = ICON_BASE + WEATHER_ICONS[key].file;
    img.onload = function() { iconAvailability[key] = true; };
    img.onerror = function() { iconAvailability[key] = false; };
    img.src = src;
  });
}

function conditionKey(id) {
  if (id >= 200 && id < 300) return 'storm';
  if (id >= 300 && id < 600) return 'rain';
  if (id >= 600 && id < 700) return 'snow';
  if (id >= 700 && id < 800) return 'fog';
  if (id === 800) return 'clear';
  if (id === 801) return 'partlyCloudy';
  if (id === 802) return 'mostlyCloudy';
  if (id >= 803) return 'overcast';
  return 'clear';
}

function weatherIcon(id) {
  var key = conditionKey(id);
  var entry = WEATHER_ICONS[key];
  if (iconAvailability[key]) {
    return '<img class="w-condition-icon" src="' + ICON_BASE + entry.file + '" alt="' + key + '" width="32" height="32">';
  }
  return '<span class="w-condition-emoji">' + entry.emoji + '</span>';
}

/* ── LOCATION MANAGEMENT ─────────────── */

function getSelectedLocation() {
  var saved = localStorage.getItem('ab_weather_location');
  if (saved) {
    try {
      var loc = JSON.parse(saved);
      if (loc.lat && loc.lon && loc.name) return loc;
    } catch (e) { /* fall through */ }
  }
  return WEATHER_LOCATIONS[0]; // default: Emmaus
}

function setSelectedLocation(loc) {
  localStorage.setItem('ab_weather_location', JSON.stringify(loc));
  // Clear cache so the next fetch uses the new location — both the forecast and the
  // (location-keyed) yesterday comparison, so nothing stale lingers after a switch.
  localStorage.removeItem('ab_weather_cache');
  localStorage.removeItem('ab_weather_ts');
  localStorage.removeItem('ab_weather_yesterday');
}

function initLocationSelector() {
  var select = document.getElementById('wLocationSelect');
  if (!select) return;

  var current = getSelectedLocation();

  // Build options
  var html = '';
  var foundCurrent = false;
  for (var i = 0; i < WEATHER_LOCATIONS.length; i++) {
    var loc = WEATHER_LOCATIONS[i];
    var selected = (loc.name === current.name) ? ' selected' : '';
    if (selected) foundCurrent = true;
    html += '<option value="' + i + '"' + selected + '>' + loc.name + '</option>';
  }
  html += '<option value="custom"' + (!foundCurrent ? ' selected' : '') + '>Custom...</option>';
  select.innerHTML = html;

  select.addEventListener('change', function() {
    var val = select.value;
    if (val === 'custom') {
      showCustomLocationForm();
    } else {
      hideCustomLocationForm();
      var loc = WEATHER_LOCATIONS[parseInt(val, 10)];
      setSelectedLocation(loc);
      fetchWeather(true);
    }
  });

  // Inline custom-location form wiring (replaces the old prompt()/alert()).
  var saveBtn = document.getElementById('wCustomSave');
  var cancelBtn = document.getElementById('wCustomCancel');
  if (saveBtn)   saveBtn.addEventListener('click', saveCustomLocation);
  if (cancelBtn) cancelBtn.addEventListener('click', function() {
    hideCustomLocationForm();
    restoreLocationDropdown();
  });
  ['wCustomName', 'wCustomLat', 'wCustomLon'].forEach(function(id) {
    var inp = document.getElementById(id);
    if (inp) inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); saveCustomLocation(); }
    });
  });
}

function showCustomLocationForm() {
  var form = document.getElementById('wCustomLoc');
  if (!form) return;
  // Prefill with the current location if it's already a custom one (not a preset).
  var current = getSelectedLocation();
  var isPreset = WEATHER_LOCATIONS.some(function(l) { return l.name === current.name; });
  document.getElementById('wCustomName').value = isPreset ? '' : current.name;
  document.getElementById('wCustomLat').value  = isPreset ? '' : current.lat;
  document.getElementById('wCustomLon').value  = isPreset ? '' : current.lon;
  setCustomError('');
  form.hidden = false;
  document.getElementById('wCustomName').focus();
}

function hideCustomLocationForm() {
  var form = document.getElementById('wCustomLoc');
  if (form) form.hidden = true;
}

function setCustomError(msg) {
  var err = document.getElementById('wCustomErr');
  if (!err) return;
  err.textContent = msg || '';
  err.hidden = !msg;
}

function saveCustomLocation() {
  var name = (document.getElementById('wCustomName').value || '').trim();
  var lat = parseFloat((document.getElementById('wCustomLat').value || '').trim());
  var lon = parseFloat((document.getElementById('wCustomLon').value || '').trim());

  if (!name) { setCustomError('Enter a name.'); return; }
  if (isNaN(lat) || lat < -90 || lat > 90)   { setCustomError('Latitude must be between -90 and 90.'); return; }
  if (isNaN(lon) || lon < -180 || lon > 180) { setCustomError('Longitude must be between -180 and 180.'); return; }

  setSelectedLocation({ name: name, lat: lat, lon: lon });
  // Update the dropdown's "Custom..." option to show the chosen name.
  var customOpt = document.getElementById('wLocationSelect').querySelector('option[value="custom"]');
  if (customOpt) { customOpt.textContent = name; customOpt.selected = true; }
  hideCustomLocationForm();
  fetchWeather(true);
}

function restoreLocationDropdown() {
  var current = getSelectedLocation();
  var select = document.getElementById('wLocationSelect');
  for (var i = 0; i < WEATHER_LOCATIONS.length; i++) {
    if (WEATHER_LOCATIONS[i].name === current.name) {
      select.value = String(i);
      return;
    }
  }
  select.value = 'custom';
}

/* ── API FETCH + CACHE ────────────────── */

function fetchWeather(force) {
  var loc = getSelectedLocation();
  var cached = localStorage.getItem('ab_weather_cache');
  var ts = parseInt(localStorage.getItem('ab_weather_ts') || '0', 10);
  var now = Date.now();

  if (!force && cached && (now - ts) < WEATHER_CONFIG.cacheTTL) {
    try {
      weatherCache = JSON.parse(cached);
      renderWeather(weatherCache);
      updateTimestamp(ts);
      return;
    } catch (e) { /* stale cache, refetch */ }
  }

  showLoading(true);
  var url = WEATHER_CONFIG.proxyBase
    + '?endpoint=onecall'
    + '&lat=' + loc.lat
    + '&lon=' + loc.lon
    + '&units=' + WEATHER_CONFIG.units
    + '&exclude=minutely,alerts';

  fetch(url)
    .then(function(r) {
      if (!r.ok) throw new Error('API ' + r.status);
      return r.json();
    })
    .then(function(data) {
      weatherCache = data;
      localStorage.setItem('ab_weather_cache', JSON.stringify(data));
      localStorage.setItem('ab_weather_ts', String(Date.now()));
      renderWeather(data);
      updateTimestamp(Date.now());
      showLoading(false);
      // Real yesterday comparison (historical day-summary; cached per day/location).
      // Re-renders the Today card's comparison line once it lands — never blocks.
      ensureYesterdayData(loc, data);
    })
    .catch(function(err) {
      showLoading(false);
      document.getElementById('wError').style.display = 'block';
      document.getElementById('wError').textContent = 'Could not load weather: ' + err.message;
    });
}

/* ── YESTERDAY COMPARISON (real historical data) ──
   Uses the OpenWeatherMap One Call 3.0 day-summary endpoint (via the proxy) for
   *actual* yesterday weather, not a relabeled cached forecast. Cached in
   localStorage keyed by location + the location-local yesterday date, so it costs
   ~one extra API call per day per location and auto-invalidates on date/loc change. */

function readYesterdayCache() {
  try {
    var raw = localStorage.getItem('ab_weather_yesterday');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

// Yesterday's date (YYYY-MM-DD) in the *location's* timezone, from timezone_offset.
function yesterdayDateStr(data) {
  var tz = (data && typeof data.timezone_offset === 'number') ? data.timezone_offset : 0;
  // Shift "now" into the location's local time, step back a day, read the UTC Y-M-D
  // of that shifted instant (offset already applied).
  var local = new Date((Math.floor(Date.now() / 1000) + tz - 86400) * 1000);
  var y = local.getUTCFullYear();
  var m = local.getUTCMonth() + 1;
  var d = local.getUTCDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
}

function yesterdayCacheKey(loc, dateStr) {
  return loc.lat + ',' + loc.lon + ',' + dateStr;
}

// Returns yesterday's day-summary for the current loc/date if cached, else null.
function getYesterdayData(loc, data) {
  var want = yesterdayCacheKey(loc, yesterdayDateStr(data));
  var cached = readYesterdayCache();
  return (cached && cached.key === want) ? cached.data : null;
}

// Fetch + cache yesterday's day-summary if we don't already have it, then re-render
// so the Today card picks up the comparison. Silent on failure (a bonus line).
function ensureYesterdayData(loc, data) {
  var dateStr = yesterdayDateStr(data);
  var want = yesterdayCacheKey(loc, dateStr);
  var cached = readYesterdayCache();
  if (cached && cached.key === want) return; // already have it (already rendered)

  var url = WEATHER_CONFIG.proxyBase
    + '?endpoint=day_summary'
    + '&lat=' + loc.lat
    + '&lon=' + loc.lon
    + '&date=' + dateStr
    + '&units=' + WEATHER_CONFIG.units;

  fetch(url)
    .then(function(r) { if (!r.ok) throw new Error('hist ' + r.status); return r.json(); })
    .then(function(summary) {
      localStorage.setItem('ab_weather_yesterday', JSON.stringify({ key: want, data: summary }));
      if (weatherCache) renderWeather(weatherCache); // re-render so the comparison shows
    })
    .catch(function() { /* bonus line — skip silently if history is unavailable */ });
}

function yesterdayComparisonHTML(todayDay, yData) {
  if (!yData || !yData.temperature) return '';

  // Compare daytime temps: yesterday's afternoon (≈ today's `temp.day`), max as fallback.
  var yTemp = (yData.temperature.afternoon != null) ? yData.temperature.afternoon : yData.temperature.max;
  if (yTemp == null) return '';
  var diff = Math.round(todayDay.temp.day - yTemp);

  if (diff === 0) return '<div class="w-yesterday">Same as yesterday</div>';

  var arrow = diff > 0 ? '↑' : '↓';
  var cls = diff > 0 ? 'warmer' : 'cooler';
  return '<div class="w-yesterday ' + cls + '">' + arrow + Math.abs(diff) + '° ' + cls + ' than yesterday</div>';
}

function showLoading(on) {
  document.getElementById('wLoading').style.display = on ? 'flex' : 'none';
  ['wHero', 'wBest', 'wWeek'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = on ? 'none' : '';
  });
}

function updateTimestamp(ts) {
  var d = new Date(ts);
  var h = d.getHours();
  var ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  var min = d.getMinutes();
  var minStr = min < 10 ? '0' + min : String(min);
  document.getElementById('wUpdated').textContent = 'Updated ' + h + ':' + minStr + ampm;
}

function manualWeatherRefresh() {
  fetchWeather(true);
}

/* ── HOURLY SCORING ───────────────────── */

// Dew point (°F) from temp (°F) + relative humidity (%), Magnus-Tetens. Used only as a
// fallback — OpenWeatherMap already provides `dew_point` on daily + hourly.
function dewPointF(tempF, rh) {
  if (rh == null || tempF == null) return null;
  var tc = (tempF - 32) * 5 / 9;
  var a = 17.27, b = 237.7;
  var g = (a * tc) / (b + tc) + Math.log(Math.max(1, rh) / 100);
  var dpC = (b * g) / (a - g);
  return dpC * 9 / 5 + 32;
}
// Prefer the API's dew_point; fall back to computing it from temp + humidity.
function getDewPoint(o, tempF) {
  if (o && typeof o.dew_point === 'number') return o.dew_point;
  return dewPointF(tempF, o ? o.humidity : null);
}

// Shared running score (0–100) for a day or an hour, so the daily card and the hourly
// "best window" bars agree. feels-like + precip + wind + dew point; UV is intentionally
// ignored (see THRESHOLDS). Dangerous-heat / bitter-cold caps keep an otherwise-okay
// wind/precip line from reading as a good run when the temperature alone rules it out.
function computeRunScore(feels, wind, pop, dewPt, isRaining) {
  var score = scoreRange(feels, THRESHOLDS.run_feelsLike)
            + scoreRange(pop, THRESHOLDS.run_pop)
            + scoreRange(wind, THRESHOLDS.run_wind)
            + (dewPt != null ? scoreRange(dewPt, THRESHOLDS.run_dewPoint) : THRESHOLDS.run_dewPoint[0][2]);
  if (isRaining) score = Math.min(score, THRESHOLDS.run_rainCap);
  if (feels >= THRESHOLDS.run_hotCapAt)       score = Math.min(score, THRESHOLDS.run_hotCap);
  else if (feels <= THRESHOLDS.run_coldCapAt) score = Math.min(score, THRESHOLDS.run_coldCap);
  return Math.max(0, Math.round(score));
}

function scoreRunningHour(hr) {
  var feels = hr.feels_like;
  var isRaining = hr.weather[0].id < 700;
  var dewPt = getDewPoint(hr, hr.temp);
  return computeRunScore(feels, hr.wind_speed, (hr.pop || 0) * 100, dewPt, isRaining);
}

// Shared tanning score (day + hourly): UV + clear sky + warmth + calm. Rain caps it;
// too-cold caps it (no comfortable tanning while shivering).
function computeTanScore(uvi, clouds, temp, wind, isRaining) {
  var score = scoreRange(uvi, THRESHOLDS.tan_uvi)
            + scoreRange(clouds, THRESHOLDS.tan_clouds)
            + scoreRange(temp, THRESHOLDS.tan_temp)
            + scoreRange(wind, THRESHOLDS.tan_wind);
  if (isRaining) score = Math.min(score, THRESHOLDS.tan_rainCap);
  if (temp < THRESHOLDS.tan_coldCapAt) score = Math.min(score, THRESHOLDS.tan_coldCap);
  return Math.max(0, Math.round(score));
}

// Shared drone score (day + hourly): wind + gusts + dry + battery-friendly temp. Rain,
// fog/low-visibility, and near-limit sustained wind each cap it. Hourly also gates to
// daylight (FAA) and can use real visibility; the daily forecast has no visibility, so it
// assumes clear unless the condition code is fog.
function computeDroneScore(wind, gust, pop, temp, isRaining, isFoggy, lowVis) {
  var score = scoreRange(wind, THRESHOLDS.drone_wind)
            + scoreRange(gust, THRESHOLDS.drone_gust)
            + scoreRange(pop, THRESHOLDS.drone_pop)
            + scoreRange(temp, THRESHOLDS.drone_temp);
  if (isRaining) score = Math.min(score, THRESHOLDS.drone_rainCap);
  if (isFoggy || lowVis) score = Math.min(score, THRESHOLDS.drone_fogCap);
  if (wind > THRESHOLDS.drone_highWindThreshold) score = Math.min(score, THRESHOLDS.drone_highWindCap);
  if (temp < THRESHOLDS.drone_coldCapAt) score = Math.min(score, THRESHOLDS.drone_coldCap);
  return Math.max(0, Math.round(score));
}

function scoreTanningHour(hr) {
  var isRaining = hr.weather[0].id < 700;
  return computeTanScore(hr.uvi || 0, hr.clouds || 0, hr.temp, hr.wind_speed, isRaining);
}

function scoreDroneHour(hr, sunrise, sunset) {
  if (hr.dt < sunrise || hr.dt > sunset) return 0;   // daylight only
  var id = hr.weather[0].id;
  var lowVis = (hr.visibility != null) && hr.visibility < THRESHOLDS.drone_lowVis;
  return computeDroneScore(hr.wind_speed, hr.wind_gust || hr.wind_speed, (hr.pop || 0) * 100,
    hr.temp, id < 700, id >= 700 && id < 800, lowVis);
}

/* ── OPTIMAL WINDOW FINDER ────────────── */

function findOptimalWindow(hours, scoreFn, sunrise, sunset) {
  if (!hours || hours.length === 0) return null;

  var scores = [];
  for (var i = 0; i < hours.length; i++) {
    scores.push({ dt: hours[i].dt, hour: locHour(hours[i].dt), score: scoreFn(hours[i], sunrise, sunset) });
  }

  var bestStart = -1;
  var bestEnd = -1;
  var bestAvg = 0;

  for (var start = 0; start < scores.length; start++) {
    if (scores[start].score < 30) continue;
    var sum = 0;
    var count = 0;
    for (var end = start; end < scores.length; end++) {
      if (scores[end].score < 30) break;
      sum += scores[end].score;
      count++;
      var avg = sum / count;
      var quality = avg * Math.min(count, 4);
      var bestQuality = bestAvg * Math.min(bestEnd - bestStart + 1, 4);
      if (count >= 1 && quality > bestQuality) {
        bestStart = start;
        bestEnd = end;
        bestAvg = avg;
      }
    }
  }

  if (bestStart === -1) {
    var peakIdx = 0;
    for (var k = 1; k < scores.length; k++) {
      if (scores[k].score > scores[peakIdx].score) peakIdx = k;
    }
    if (scores[peakIdx].score < 10) return null;
    return {
      startHour: scores[peakIdx].hour,
      endHour: (scores[peakIdx].hour + 1) % 24,
      avgScore: scores[peakIdx].score,
      rating: scoreToRating(scores[peakIdx].score),
      hourScores: scores
    };
  }

  return {
    startHour: scores[bestStart].hour,
    endHour: (scores[bestEnd].hour + 1) % 24,
    avgScore: Math.round(bestAvg),
    rating: scoreToRating(Math.round(bestAvg)),
    hourScores: scores
  };
}

function getHoursForDay(hourly, dayDt) {
  var dayDate = locDateStr(dayDt);  // group by the location's calendar day
  var result = [];
  for (var i = 0; i < hourly.length; i++) {
    if (locDateStr(hourly[i].dt) === dayDate) {
      result.push(hourly[i]);
    }
  }
  return result;
}

function estimateWindow(day, type) {
  if (type === 'run') {
    var tempDay = day.temp.day;
    if (tempDay > 75) return { label: 'Early AM', startHour: 6, endHour: 9 };
    if (tempDay > 65) return { label: 'Morning', startHour: 7, endHour: 10 };
    if (tempDay < 40) return { label: 'Afternoon', startHour: 12, endHour: 15 };
    return { label: 'Morning', startHour: 8, endHour: 11 };
  } else {
    if (day.wind_speed > 18) return { label: 'Early AM', startHour: 7, endHour: 9 };
    return { label: 'Mid-morning', startHour: 9, endHour: 12 };
  }
}

function formatHour(h) {
  if (h === 0 || h === 24) return '12am';
  if (h === 12) return '12pm';
  if (h < 12) return h + 'am';
  return (h - 12) + 'pm';
}

/* ── SCORING: DAILY (for overall day rating) ── */

function scoreRunning(day) {
  var feels = day.feels_like ? day.feels_like.day : day.temp.day;
  var wind = day.wind_speed;
  var pop = (day.pop || 0) * 100;
  var isRaining = day.weather[0].id < 700;
  var dewPt = getDewPoint(day, day.temp.day);
  var score = computeRunScore(feels, wind, pop, dewPt, isRaining);

  return {
    score: score,
    rating: scoreToRating(score),
    factors: {
      feels: Math.round(feels), wind: Math.round(wind), pop: Math.round(pop),
      humidity: day.humidity, dew: dewPt != null ? Math.round(dewPt) : null, uvi: day.uvi || 0
    }
  };
}

function scoreTanning(day) {
  var temp = day.temp.day;
  var uvi = day.uvi || 0;
  var clouds = day.clouds || 0;
  var wind = day.wind_speed;
  var isRaining = day.weather[0].id < 700;
  var score = computeTanScore(uvi, clouds, temp, wind, isRaining);
  return {
    score: score,
    rating: scoreToRating(score),
    factors: { temp: Math.round(temp), uvi: uvi, clouds: clouds, wind: Math.round(wind), pop: Math.round((day.pop || 0) * 100) }
  };
}

function scoreDrone(day) {
  var temp = day.temp.day;
  var wind = day.wind_speed;
  var gust = day.wind_gust || wind;
  var pop = (day.pop || 0) * 100;
  var id = day.weather[0].id;
  var isFoggy = id >= 700 && id < 800;
  // Daily forecast carries no visibility → assume clear unless the condition code is fog.
  var score = computeDroneScore(wind, gust, pop, temp, id < 700, isFoggy, false);
  return {
    score: score,
    rating: scoreToRating(score),
    factors: { wind: Math.round(wind), gust: Math.round(gust), pop: Math.round(pop), temp: Math.round(temp) }
  };
}

/* ── SCORING HELPERS ──────────────────── */

// Band lookup: returns the points for the band `val` falls in, else 0. "Lower is
// better" factors (rain %, clouds, UV) just encode that in their band tables — small
// ranges carry the high points — so they use this same function (no separate inverse).
function scoreRange(val, bands) {
  for (var i = 0; i < bands.length; i++) {
    if (val >= bands[i][0] && val <= bands[i][1]) return bands[i][2];
  }
  return 0;
}

function scoreToRating(score) {
  if (score >= THRESHOLDS.perfect) return 'perfect';
  if (score >= THRESHOLDS.good) return 'good';
  if (score >= THRESHOLDS.fair) return 'fair';
  return 'poor';
}

var RATING_LABELS = { perfect: 'Perfect', good: 'Good', fair: 'Fair', poor: 'Poor' };

/* ── UV INDEX INFO ───────────────────── */

var UV_LEVELS = [
  { min: 0,  max: 2,  label: 'Low',       color: '#4ade80', advice: 'Minimal risk. Sunscreen optional for most people.' },
  { min: 3,  max: 5,  label: 'Moderate',   color: '#facc15', advice: 'Wear sunscreen SPF 30+. Seek shade during midday.' },
  { min: 6,  max: 7,  label: 'High',       color: '#f97316', advice: 'Sunburn risk in 15–25 min. SPF 30+, hat, and sunglasses recommended.' },
  { min: 8,  max: 10, label: 'Very High',  color: '#ef4444', advice: 'Burn risk in under 15 min. Limit midday sun. SPF 50+, protective clothing.' },
  { min: 11, max: 20, label: 'Extreme',    color: '#c084fc', advice: 'Burn possible in minutes. Avoid sun 10am–4pm. Full protection essential.' }
];

function uvLevelFor(uvi) {
  var rounded = Math.round(uvi);
  for (var i = 0; i < UV_LEVELS.length; i++) {
    if (rounded >= UV_LEVELS[i].min && rounded <= UV_LEVELS[i].max) return UV_LEVELS[i];
  }
  return UV_LEVELS[UV_LEVELS.length - 1];
}

function uvExpandableHTML(uvi) {
  var current = uvLevelFor(uvi);
  var html = '<div class="w-uv-expandable" onclick="toggleUvDetails(this)">'
    + '<div class="w-drawer-row" style="border-bottom:0;padding-bottom:0">'
      + '<span>UV Index <span class="w-uv-badge" style="background:' + current.color + '">' + current.label + '</span>'
      + ' <span class="w-score-hint">(tap for info)</span></span>'
      + '<span>' + uvi + '</span>'
    + '</div>'
    + '<div class="w-uv-details" style="max-height:0;overflow:hidden;transition:max-height 0.3s ease,padding 0.3s ease;padding:0">';

  for (var i = 0; i < UV_LEVELS.length; i++) {
    var lvl = UV_LEVELS[i];
    var isCurrent = lvl.label === current.label;
    html += '<div class="w-uv-level' + (isCurrent ? ' current' : '') + '">'
      + '<span class="w-uv-dot" style="background:' + lvl.color + '"></span>'
      + '<span class="w-uv-range">' + lvl.min + '–' + lvl.max + '</span>'
      + '<span class="w-uv-label">' + lvl.label + '</span>'
      + '<span class="w-uv-advice">' + lvl.advice + '</span>'
      + '</div>';
  }

  html += '</div></div>';
  return html;
}

function toggleUvDetails(el) {
  var details = el.querySelector('.w-uv-details');
  var isOpen = details.style.maxHeight !== '0px' && details.style.maxHeight !== '';
  if (isOpen) {
    details.style.maxHeight = '0px';
    details.style.padding = '0';
  } else {
    details.style.maxHeight = '300px';
    details.style.padding = '6px 0 8px';
  }
}

/* ── RENDER ────────────────────────────── */

function renderWeather(data) {
  tzOffsetSec = (typeof data.timezone_offset === 'number') ? data.timezone_offset : 0;
  var daily = data.daily.slice(0, 7);
  var hourly = data.hourly || [];
  var todayDate = locDateStr(data.daily[0].dt);
  var yesterday = getYesterdayData(getSelectedLocation(), data);

  var dayData = buildDayData(daily, hourly, todayDate, yesterday);
  renderedDays['wStrip'] = dayData;

  renderHero(dayData[0]);
  renderBestOfWeek(dayData);
  renderWeek(dayData);
  wireDayTaps();

  showLoading(false);
}

var renderedDays = {};

// Capitalize the first letter of the OWM condition text ("clear sky" → "Clear sky").
function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Short best-window string for an activity on a day: "7–10am" from the optimal window
// when we have hourly data, a coarse estimate label when we don't, or '' when the day
// is poor for that activity (nothing worth pointing at).
function windowStr(win, result, day, type) {
  if (win) return formatHour(win.startHour) + '–' + formatHour(win.endHour);
  if (result.rating === 'poor') return '';
  if (type === 'tan') return 'Midday';
  return estimateWindow(day, type).label;
}

// Compute everything the hero / week rows / drawer need — once, for all 7 days.
function buildDayData(days, hourly, todayDate, yesterday) {
  var dayData = [];
  for (var i = 0; i < days.length; i++) {
    var day = days[i];
    // Read each day in the location's timezone so labels/dates match the forecast clock.
    var d = new Date((day.dt + tzOffsetSec) * 1000);
    var isToday = locDateStr(day.dt) === todayDate;
    var dayName = isToday ? 'Today' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
    var fullDayName = isToday ? 'Today' : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()];
    var dateStr = (d.getUTCMonth() + 1) + '/' + d.getUTCDate();

    var runResult = scoreRunning(day);
    var droneResult = scoreDrone(day);
    var tanResult = scoreTanning(day);
    var icon = weatherIcon(day.weather[0].id);

    var hours = getHoursForDay(hourly, day.dt);
    var runWin = null, droneWin = null, tanWin = null;
    if (hours.length >= 4) {
      runWin = findOptimalWindow(hours, scoreRunningHour, day.sunrise, day.sunset);
      droneWin = findOptimalWindow(hours, scoreDroneHour, day.sunrise, day.sunset);
      tanWin = findOptimalWindow(hours, scoreTanningHour, day.sunrise, day.sunset);
    }

    dayData.push({
      day: day, isToday: isToday,
      runResult: runResult, droneResult: droneResult, tanResult: tanResult,
      runWin: runWin, droneWin: droneWin, tanWin: tanWin,
      runWinStr: windowStr(runWin, runResult, day, 'run'),
      droneWinStr: windowStr(droneWin, droneResult, day, 'drone'),
      tanWinStr: windowStr(tanWin, tanResult, day, 'tan'),
      dayName: dayName, fullDayName: fullDayName, dateStr: dateStr,
      icon: icon, hours: hours, yesterday: isToday ? yesterday : null
    });
  }
  return dayData;
}

// The three scored activities, in display order.
var W_ACTIVITIES = [
  { key: 'run',   icon: '🏃', name: 'Run' },
  { key: 'drone', icon: '🛸', name: 'Drone' },
  { key: 'tan',   icon: '☀️', name: 'Tan' }
];
function actResult(d, key) {
  return key === 'run' ? d.runResult : (key === 'drone' ? d.droneResult : d.tanResult);
}
function actWinStr(d, key) {
  return key === 'run' ? d.runWinStr : (key === 'drone' ? d.droneWinStr : d.tanWinStr);
}

/* ── HERO (today) ── */

function renderHero(d) {
  var el = document.getElementById('wHero');
  if (!el || !d) return;
  var day = d.day;
  var feels = day.feels_like ? Math.round(day.feels_like.day) : Math.round(day.temp.day);
  var cond = capitalize((day.weather[0] && day.weather[0].description) || '');

  var acts = W_ACTIVITIES.map(function(a) {
    var r = actResult(d, a.key);
    var win = actWinStr(d, a.key);
    return '<div class="w-act ' + r.rating + '">'
      + '<div class="w-act-icon">' + a.icon + '</div>'
      + '<div class="w-act-name">' + a.name + '</div>'
      + '<div class="w-act-rating ' + r.rating + '">' + RATING_LABELS[r.rating] + '</div>'
      + '<div class="w-act-win">' + (win || '—') + '</div>'
      + '</div>';
  }).join('');

  var yest = d.yesterday ? yesterdayComparisonHTML(day, d.yesterday) : '';

  el.innerHTML =
    '<div class="w-hero-top" data-idx="0" role="button" tabindex="0">'
      + '<div class="w-hero-icon">' + d.icon + '</div>'
      + '<div class="w-hero-main">'
        + '<div class="w-hero-day">Today <span class="w-hero-date">' + d.dateStr + '</span></div>'
        + '<div class="w-hero-temp">' + Math.round(day.temp.day) + '°</div>'
        + '<div class="w-hero-cond">' + cond + ' · feels ' + feels + '°</div>'
        + '<div class="w-hero-meta">'
          + '<span>H ' + Math.round(day.temp.max) + '° L ' + Math.round(day.temp.min) + '°</span>'
          + '<span>💨 ' + Math.round(day.wind_speed) + ' mph</span>'
          + (day.humidity != null ? '<span>💧 ' + day.humidity + '%</span>' : '')
        + '</div>'
        + yest
      + '</div>'
    + '</div>'
    + sunMoonHTML(day)
    + '<div class="w-hero-acts" data-idx="0" role="button" tabindex="0">' + acts + '</div>';
}

/* ── BEST DAY THIS WEEK (per activity) ── */

function renderBestOfWeek(dayData) {
  var el = document.getElementById('wBest');
  if (!el) return;
  var chips = W_ACTIVITIES.map(function(a) {
    var bestIdx = -1, bestScore = -1;
    for (var i = 0; i < dayData.length; i++) {
      var s = actResult(dayData[i], a.key).score;
      if (s > bestScore) { bestScore = s; bestIdx = i; }
    }
    if (bestIdx < 0) return '';
    var d = dayData[bestIdx];
    var r = actResult(d, a.key);
    var win = actWinStr(d, a.key);
    return '<div class="w-best-chip ' + r.rating + '" data-idx="' + bestIdx + '" role="button" tabindex="0">'
      + '<span class="w-best-act">' + a.icon + '</span>'
      + '<span class="w-best-day">' + d.dayName + '</span>'
      + (win ? '<span class="w-best-win">' + win + '</span>' : '')
      + '</div>';
  }).join('');
  el.innerHTML = '<span class="w-best-label">Best this week</span>' + chips;
}

/* ── 6-DAY LIST (rows after today) ── */

function renderWeek(dayData) {
  var el = document.getElementById('wWeek');
  if (!el) return;
  var html = '';
  for (var i = 1; i < dayData.length; i++) {
    var d = dayData[i];
    var day = d.day;
    var dots = W_ACTIVITIES.map(function(a) {
      var r = actResult(d, a.key);
      return '<span class="w-row-act" title="' + a.name + ': ' + RATING_LABELS[r.rating] + '">'
        + '<span class="w-row-act-i">' + a.icon + '</span>'
        + '<span class="w-dot ' + r.rating + '"></span></span>';
    }).join('');
    html += '<div class="w-row" data-idx="' + i + '" role="button" tabindex="0">'
      + '<span class="w-row-when"><span class="w-row-day">' + d.dayName + '</span>'
        + '<span class="w-row-date">' + d.dateStr + '</span></span>'
      + '<span class="w-row-icon">' + d.icon + '</span>'
      + '<span class="w-row-temp"><span class="w-row-hi">' + Math.round(day.temp.max) + '°</span>'
        + '<span class="w-row-lo">' + Math.round(day.temp.min) + '°</span></span>'
      + '<span class="w-row-acts">' + dots + '</span>'
      + '</div>';
  }
  el.innerHTML = html;
}

// Tap the hero, any week row, or a best-of-week chip → open that day's detail drawer
// (the drawer is the single detail surface now, on every screen width).
function wireDayTaps() {
  function bind(node) {
    if (!node) return;
    node.addEventListener('click', function() {
      var idx = parseInt(node.getAttribute('data-idx'), 10);
      if (!isNaN(idx)) openWeatherDrawer(idx);
    });
    node.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        var idx = parseInt(node.getAttribute('data-idx'), 10);
        if (!isNaN(idx)) openWeatherDrawer(idx);
      }
    });
  }
  bind(document.querySelector('#wHero .w-hero-top'));
  bind(document.querySelector('#wHero .w-hero-acts'));
  document.querySelectorAll('#wWeek .w-row').forEach(bind);
  document.querySelectorAll('#wBest .w-best-chip').forEach(bind);
}

/* ── SUN & MOON ───────────────────────── */

// Clock time (e.g. "6:02a") for a unix-seconds instant, read in the forecast location's tz.
function locClock(dt) {
  var d = new Date((dt + tzOffsetSec) * 1000);
  var h = d.getUTCHours(), m = d.getUTCMinutes();
  var ampm = h >= 12 ? 'p' : 'a';
  h = h % 12 || 12;
  return h + ':' + (m < 10 ? '0' + m : m) + ampm;
}

// Moon phase (OWM `moon_phase` 0–1: 0/1 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last).
function moonPhaseInfo(p) {
  if (p < 0.03 || p > 0.97) return { emoji: '🌑', name: 'New moon' };
  if (p < 0.22) return { emoji: '🌒', name: 'Waxing crescent' };
  if (p < 0.28) return { emoji: '🌓', name: 'First quarter' };
  if (p < 0.47) return { emoji: '🌔', name: 'Waxing gibbous' };
  if (p < 0.53) return { emoji: '🌕', name: 'Full moon' };
  if (p < 0.72) return { emoji: '🌖', name: 'Waning gibbous' };
  if (p < 0.78) return { emoji: '🌗', name: 'Last quarter' };
  return { emoji: '🌘', name: 'Waning crescent' };
}

function sunMoonHTML(day) {
  if (!day || day.sunrise == null) return '';
  var moon = (day.moon_phase != null) ? moonPhaseInfo(day.moon_phase) : null;
  return '<div class="w-sunmoon">'
    + '<span class="w-sunmoon-item">🌅 ' + locClock(day.sunrise) + '</span>'
    + '<span class="w-sunmoon-item">🌇 ' + locClock(day.sunset) + '</span>'
    + (moon ? '<span class="w-sunmoon-item">' + moon.emoji + ' ' + moon.name + '</span>' : '')
    + '</div>';
}

/* ── HOUR-BY-HOUR METRIC CHART ────────────
   One chart in the drawer; pick a weather metric (rain, UV, temp, …) and see its value
   for every upcoming hour — so you can see *at a glance* when it rains or when UV peaks.
   Replaces the old per-activity score bars (which were hard to read). */

var WX_SERIES = [
  { key: 'rain',     chip: '🌧',  label: 'Rain',     noun: 'Rain chance', color: '#38bdf8', max: 100,
    val: function(h) { return Math.round((h.pop || 0) * 100); }, fmt: function(v) { return v + '%'; } },
  { key: 'uv',       chip: '☀️', label: 'UV',       noun: 'UV index',    color: '#f59e0b', max: 11,
    val: function(h) { return Math.round((h.uvi || 0) * 10) / 10; }, fmt: function(v) { return String(v); } },
  { key: 'temp',     chip: '🌡', label: 'Temp',     noun: 'Temperature', color: '#fb7185', dyn: true,
    val: function(h) { return Math.round(h.feels_like != null ? h.feels_like : h.temp); }, fmt: function(v) { return v + '°'; } },
  { key: 'wind',     chip: '💨', label: 'Wind',     noun: 'Wind',        color: '#2dd4bf', dyn: true,
    val: function(h) { return Math.round(h.wind_speed); }, fmt: function(v) { return v + ' mph'; } },
  { key: 'clouds',   chip: '☁️', label: 'Cloud',    noun: 'Cloud cover', color: '#94a3b8', max: 100,
    val: function(h) { return Math.round(h.clouds || 0); }, fmt: function(v) { return v + '%'; } },
  { key: 'humidity', chip: '💧', label: 'Humidity', noun: 'Humidity',    color: '#60a5fa', max: 100,
    val: function(h) { return Math.round(h.humidity || 0); }, fmt: function(v) { return v + '%'; } }
];

var wxState = { hours: [], metric: 'rain' };

function seriesByKey(key) {
  for (var i = 0; i < WX_SERIES.length; i++) if (WX_SERIES[i].key === key) return WX_SERIES[i];
  return WX_SERIES[0];
}

function hourlyChartHTML(series) {
  var hours = wxState.hours;
  if (!hours || hours.length < 3) {
    return '<div class="w-hr-empty">Hour-by-hour detail isn’t available this far out — the forecast only carries hourly data for the next couple of days.</div>';
  }
  var vals = hours.map(series.val);
  var maxVal = vals.reduce(function(m, v) { return Math.max(m, v); }, 0);
  // %/UV metrics use a fixed scale; temp/wind scale to the day's own range (with headroom).
  var scaleMax = series.dyn ? Math.max(1, Math.ceil(maxVal * 1.15)) : series.max;
  var peakIdx = 0;
  for (var i = 1; i < vals.length; i++) if (vals[i] > vals[peakIdx]) peakIdx = i;

  var bars = '';
  for (var j = 0; j < hours.length; j++) {
    var v = vals[j];
    var pct = scaleMax > 0 ? Math.round(v / scaleMax * 100) : 0;
    var hr = locHour(hours[j].dt);
    var isPeak = (j === peakIdx && maxVal > 0);
    bars += '<div class="w-hr-col">'
      + '<div class="w-hr-track">'
        + (isPeak ? '<span class="w-hr-peak">' + series.fmt(v) + '</span>' : '')
        + '<div class="w-hr-bar' + (isPeak ? ' peak' : '') + '" style="height:' + Math.max(2, pct) + '%;background:' + series.color + '"></div>'
      + '</div>'
      + '<div class="w-hr-axis">' + (hr % 3 === 0 ? formatHour(hr) : '') + '</div>'
    + '</div>';
  }

  var caption;
  if (series.key === 'rain' && maxVal === 0) {
    caption = 'No rain expected today.';
  } else {
    caption = series.noun + ' peaks at <strong>' + series.fmt(vals[peakIdx])
            + '</strong> around <strong>' + formatHour(locHour(hours[peakIdx].dt)) + '</strong>.';
  }
  return '<div class="w-hr-chart">' + bars + '</div>'
    + '<div class="w-hr-caption">' + caption + '</div>';
}

function renderHourlyMetric() {
  var el = document.getElementById('wHourly');
  if (!el) return;
  var series = seriesByKey(wxState.metric);
  var chips = WX_SERIES.map(function(s) {
    return '<button type="button" class="w-hr-chip' + (s.key === wxState.metric ? ' active' : '')
      + '" data-metric="' + s.key + '">' + s.chip + ' ' + s.label + '</button>';
  }).join('');
  el.innerHTML = '<div class="w-hr-head">Hour by hour</div>'
    + '<div class="w-hr-metrics">' + chips + '</div>'
    + hourlyChartHTML(series);
  el.querySelectorAll('.w-hr-chip').forEach(function(c) {
    c.addEventListener('click', function() {
      wxState.metric = c.getAttribute('data-metric');
      renderHourlyMetric();
    });
  });
}

/* ── WEATHER DETAIL DRAWER ────────────── */

function openWeatherDrawer(idx) {
  var data = renderedDays['wStrip'][idx];
  var day = data.day;

  // Build header
  var headerHTML = '<div class="w-drawer-day-row">'
    + '<div class="w-drawer-icon">' + data.icon + '</div>'
    + '<div class="w-drawer-title">'
      + '<div class="w-drawer-day-name">' + data.fullDayName + ' <span class="w-drawer-date">' + data.dateStr + '</span></div>'
      + '<div class="w-drawer-temp">' + Math.round(day.temp.day) + '° <span class="w-drawer-temp-range-inline">(' + Math.round(day.temp.min) + '°–' + Math.round(day.temp.max) + '°)</span></div>'
    + '</div>'
    + '</div>';

  // Yesterday comparison in drawer
  if (data.yesterday) {
    headerHTML += yesterdayComparisonHTML(day, data.yesterday);
  }

  // Sun & moon for the day
  headerHTML += sunMoonHTML(day);

  // Summary from API
  if (day.summary) {
    headerHTML += '<div class="w-drawer-summary">' + day.summary + '</div>';
  }

  document.getElementById('wDrawerHeader').innerHTML = headerHTML;

  // Build body — shared Conditions, then the selectable hour-by-hour weather chart, then
  // each activity (rating + best window + tappable score breakdown). Raw numbers live in
  // Conditions / the chart; the activities don't repeat them.
  var bodyHTML = conditionsHTML(day, data);
  bodyHTML += '<div id="wHourly" class="w-hourly"></div>';
  bodyHTML += renderDrawerActivity('🏃 Running', data.runResult, data.runWin, data.hours, buildScoreBreakdown('run', data.runResult));
  bodyHTML += renderDrawerActivity('🛸 Drone',   data.droneResult, data.droneWin, data.hours, buildScoreBreakdown('drone', data.droneResult));
  bodyHTML += renderDrawerActivity('☀️ Tanning', data.tanResult, data.tanWin, data.hours, buildScoreBreakdown('tan', data.tanResult));

  document.getElementById('wDrawerBody').innerHTML = bodyHTML;

  // Default the hour-by-hour chart to Rain when rain is in play (the "when does it rain?"
  // case), otherwise Temp; then render it into its placeholder.
  wxState.hours = data.hours || [];
  wxState.metric = wxState.hours.some(function(h) { return (h.pop || 0) > 0; }) ? 'rain' : 'temp';
  renderHourlyMetric();

  document.getElementById('wDrawerBackdrop').classList.add('open');
  document.getElementById('wDrawer').classList.add('open');
}

// Shared metrics for the day, shown ONCE above the activities (so temp/wind/rain/etc.
// aren't repeated in every activity section). The UV expandable lives here too.
function conditionsHTML(day, data) {
  var rf = data.runResult.factors;
  var items = [
    ['Feels like', rf.feels + '°F'],
    ['Wind', Math.round(day.wind_speed) + ' mph'],
    ['Gusts', Math.round(day.wind_gust || day.wind_speed) + ' mph'],
    ['Humidity', day.humidity + '%']
  ];
  if (rf.dew != null)        items.push(['Dew point', rf.dew + '°F']);
  if (day.clouds != null)    items.push(['Cloud cover', day.clouds + '%']);
  items.push(['Rain chance', Math.round((day.pop || 0) * 100) + '%']);
  items.push(['Daylight', ((day.sunset - day.sunrise) / 3600).toFixed(1) + ' hrs']);

  var grid = '';
  for (var i = 0; i < items.length; i++) {
    grid += '<div class="w-cond-item"><span class="w-cond-label">' + items[i][0] + '</span>'
          + '<span class="w-cond-val">' + items[i][1] + '</span></div>';
  }
  return '<div class="w-cond-title">Conditions</div>'
       + '<div class="w-cond-grid">' + grid + '</div>'
       + uvExpandableHTML(day.uvi || 0);
}

function renderDrawerActivity(title, result, win, hours, breakdownHTML) {
  var html = '<div class="w-drawer-activity-header">'
    + '<span>' + title + '</span>'
    + '<span class="w-rating ' + result.rating + '" style="font-size:0.75rem;padding:3px 10px">'
      + RATING_LABELS[result.rating]
    + '</span>'
    + '</div>';

  if (win) {
    // Best window + what it'll be like during it (window-specific, not a day repeat).
    var winMetrics = windowMetrics(hours, win.startHour, win.endHour);
    html += '<div class="w-drawer-window ' + win.rating + '">'
      + 'Best window: <strong>' + formatHour(win.startHour) + '–' + formatHour(win.endHour) + '</strong>'
      + (winMetrics ? '<div class="w-window-metrics">' + winMetrics + '</div>' : '')
      + '</div>';
  }

  // Tappable score with breakdown (this is where the per-activity factor detail lives now)
  html += '<div class="w-drawer-row w-score-row" onclick="this.classList.toggle(\'open\')">'
    + '<span>Score <span class="w-score-hint">(tap for details)</span></span>'
    + '<span>' + result.score + ' / 100</span>'
    + '</div>'
    + '<div class="w-score-breakdown">' + breakdownHTML + '</div>';

  return html;
}

function windowMetrics(hours, startHour, endHour) {
  if (!hours || hours.length === 0) return '';
  var windowHours = [];
  for (var i = 0; i < hours.length; i++) {
    var h = locHour(hours[i].dt);
    // Handle windows that wrap midnight (unlikely but safe)
    if (startHour < endHour) {
      if (h >= startHour && h < endHour) windowHours.push(hours[i]);
    } else {
      if (h >= startHour || h < endHour) windowHours.push(hours[i]);
    }
  }
  if (windowHours.length === 0) return '';

  var avgTemp = 0, maxWind = 0, maxPop = 0;
  for (var j = 0; j < windowHours.length; j++) {
    var hr = windowHours[j];
    avgTemp += (hr.feels_like || hr.temp);
    if (hr.wind_speed > maxWind) maxWind = hr.wind_speed;
    var pop = (hr.pop || 0) * 100;
    if (pop > maxPop) maxPop = pop;
  }
  avgTemp = Math.round(avgTemp / windowHours.length);

  // Temp/wind/rain *during the window* — distinct from the day-level Conditions block
  // (humidity dropped here; it lives in Conditions).
  return '<span>' + avgTemp + '°F</span>'
    + '<span>💨 ' + Math.round(maxWind) + 'mph</span>'
    + '<span>🌧 ' + Math.round(maxPop) + '%</span>';
}

function buildScoreBreakdown(type, result) {
  var f = result.factors;
  var lines = [];
  if (type === 'run') {
    lines.push(breakdownLine('Feels like', f.feels + '°F', scoreRange(f.feels, THRESHOLDS.run_feelsLike), 40));
    lines.push(breakdownLine('Rain chance', f.pop + '%', scoreRange(f.pop, THRESHOLDS.run_pop), 25));
    lines.push(breakdownLine('Wind', f.wind + ' mph', scoreRange(f.wind, THRESHOLDS.run_wind), 18));
    if (f.dew != null) {
      lines.push(breakdownLine('Dew point', f.dew + '°F', scoreRange(f.dew, THRESHOLDS.run_dewPoint), 17));
    }
  } else if (type === 'drone') {
    lines.push(breakdownLine('Wind', f.wind + ' mph', scoreRange(f.wind, THRESHOLDS.drone_wind), 35));
    lines.push(breakdownLine('Gusts', f.gust + ' mph', scoreRange(f.gust, THRESHOLDS.drone_gust), 25));
    lines.push(breakdownLine('Rain chance', f.pop + '%', scoreRange(f.pop, THRESHOLDS.drone_pop), 25));
    lines.push(breakdownLine('Temp', f.temp + '°F', scoreRange(f.temp, THRESHOLDS.drone_temp), 15));
  } else if (type === 'tan') {
    lines.push(breakdownLine('UV Index', f.uvi, scoreRange(f.uvi, THRESHOLDS.tan_uvi), 35));
    lines.push(breakdownLine('Cloud cover', f.clouds + '%', scoreRange(f.clouds, THRESHOLDS.tan_clouds), 25));
    lines.push(breakdownLine('Temp', f.temp + '°F', scoreRange(f.temp, THRESHOLDS.tan_temp), 25));
    lines.push(breakdownLine('Wind', f.wind + ' mph', scoreRange(f.wind, THRESHOLDS.tan_wind), 15));
  }
  return lines.join('');
}

function breakdownLine(label, value, pts, max) {
  var pct = max > 0 ? Math.round(pts / max * 100) : 0;
  var cls = pct >= 80 ? 'high' : (pct >= 50 ? 'mid' : 'low');
  return '<div class="w-breakdown-row">'
    + '<span class="w-breakdown-label">' + label + '</span>'
    + '<span class="w-breakdown-val">' + value + '</span>'
    + '<div class="w-breakdown-bar-bg"><div class="w-breakdown-bar ' + cls + '" style="width:' + pct + '%"></div></div>'
    + '<span class="w-breakdown-pts">' + pts + '/' + max + '</span>'
    + '</div>';
}

function closeWeatherDrawer() {
  document.getElementById('wDrawerBackdrop').classList.remove('open');
  document.getElementById('wDrawer').classList.remove('open');
}

/* ── "How these scores work" explainer (reuses the detail-drawer shell) ── */

function infoChip(cls, label) {
  return '<span class="w-rating ' + cls + '" style="font-size:0.7rem;padding:2px 9px">' + label + '</span>';
}

function infoDrawerHTML() {
  return ''
    + '<p class="w-info-lead">Each day gets three 0–100 scores — for <strong>running</strong>, '
      + 'flying a <strong>drone</strong>, and <strong>tanning</strong> — worked out from the forecast. '
      + 'Each score becomes a simple rating:</p>'
    + '<div class="w-info-scale">'
      + '<span class="w-info-scale-item">' + infoChip('perfect', 'Perfect') + ' 85+</span>'
      + '<span class="w-info-scale-item">' + infoChip('good', 'Good') + ' 65+</span>'
      + '<span class="w-info-scale-item">' + infoChip('fair', 'Fair') + ' 45+</span>'
      + '<span class="w-info-scale-item">' + infoChip('poor', 'Poor') + ' under 45</span>'
    + '</div>'

    + '<div class="w-info-act"><div class="w-info-act-head">🏃 Running</div>'
      + '<p class="w-info-act-sub">Best when it’s cool, dry, and calm.</p>'
      + '<ul class="w-info-list">'
        + '<li><strong>Feels-like temperature</strong> (matters most) — the sweet spot is about '
          + '<strong>50–68°F</strong>. It uses the "feels like" number, which already folds in humidity '
          + 'and wind chill.</li>'
        + '<li><strong>Dew point</strong> — how muggy the air actually is. Below ~55°F is dry and '
          + 'comfortable; above ~70°F is oppressive. <em>This is why a dry 80° scores far better than a '
          + 'humid 80°.</em></li>'
        + '<li><strong>Rain and wind</strong> drag it down, and dangerous heat or bitter cold cap it.</li>'
      + '</ul></div>'

    + '<div class="w-info-act"><div class="w-info-act-head">🛸 Drone</div>'
      + '<p class="w-info-act-sub">Built around keeping a small drone safe and legal.</p>'
      + '<ul class="w-info-list">'
        + '<li><strong>Wind &amp; gusts</strong> (matter most) — most consumer drones top out around '
          + '<strong>20–24 mph</strong>; gusts past that get dicey.</li>'
        + '<li><strong>Rain</strong> — drones aren’t waterproof, so any rain tanks the score.</li>'
        + '<li><strong>Fog / low visibility</strong> — you have to keep it in sight.</li>'
        + '<li><strong>Temperature</strong> — batteries fade in the cold and overheat in extreme heat '
          + '(best ~50–85°F). Night hours score zero.</li>'
      + '</ul></div>'

    + '<div class="w-info-act"><div class="w-info-act-head">☀️ Tanning</div>'
      + '<p class="w-info-act-sub">What gets you color, comfortably.</p>'
      + '<ul class="w-info-list">'
        + '<li><strong>UV index</strong> (matters most) — you need real sun, and higher UV tans faster. '
          + '<em>Higher UV also burns faster — wear sunscreen.</em></li>'
        + '<li><strong>Cloud cover</strong> — clear skies mean direct sun.</li>'
        + '<li><strong>Temperature &amp; wind</strong> — warm enough to lie out (best ~78–92°F) with a '
          + 'light breeze; rain rules it out.</li>'
      + '</ul></div>'

    + '<p class="w-info-foot">The <strong>best window</strong> for each activity is simply the run of '
      + 'upcoming hours with the highest scores. Tap any day to see it hour by hour.</p>';
}

function openInfoDrawer() {
  document.getElementById('wDrawerHeader').innerHTML =
    '<div class="w-drawer-day-name">How these scores work</div>'
    + '<div class="w-drawer-summary">Friendly, forecast-based ratings — not a substitute for your own judgment.</div>';
  document.getElementById('wDrawerBody').innerHTML = infoDrawerHTML();
  document.getElementById('wDrawerBackdrop').classList.add('open');
  document.getElementById('wDrawer').classList.add('open');
}

/* ── INIT ──────────────────────────────── */

function initWeather() {
  probeIcons();
  initLocationSelector();
  fetchWeather(false);

  document.getElementById('wDrawerBackdrop').addEventListener('click', closeWeatherDrawer);
  document.getElementById('wDrawer').addEventListener('click', function(e) {
    if (e.target.classList.contains('drawer-handle')) closeWeatherDrawer();
  });
  var infoBtn = document.getElementById('wInfoBtn');
  if (infoBtn) infoBtn.addEventListener('click', openInfoDrawer);
}
