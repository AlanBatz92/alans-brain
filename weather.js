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

  // ── Running ──  (sweet spot 50-75°F; drops sharply above 80 especially with humidity)
  run_feelsLike: [[50, 75, 20], [40, 49, 14], [76, 80, 10], [30, 39, 6], [81, 85, 4], [86, 95, 1]],
  run_wind:      [[0, 8, 20],   [9, 15, 14],  [16, 22, 6]],
  run_pop:       [[0, 10, 20],  [11, 30, 14],  [31, 60, 6]],   // precipitation %
  run_humidity:  [[30, 55, 20], [20, 29, 14],  [56, 70, 12], [71, 80, 6], [81, 90, 2]],
  run_uvi:       [[0, 5, 20],   [6, 7, 14],    [8, 9, 6]],     // UV index
  run_rainCap:   35,            // max score if actively raining
  run_heatHumidPenalty: true,   // extra penalty when hot + humid together

  // ── Tanning ──  (80-90°F ideal, clear skies, good UV)
  tan_temp:      [[80, 90, 20], [75, 79, 14], [91, 95, 14], [70, 74, 8], [96, 100, 6]],
  tan_uvi:       [[5, 7, 25],   [3, 4, 15],   [8, 9, 12], [10, 15, 6]],  // moderate-high UV best
  tan_clouds:    [[0, 10, 25],  [11, 25, 18],  [26, 50, 10], [51, 75, 4]],  // cloud cover %
  tan_wind:      [[0, 10, 15],  [11, 18, 10],  [19, 25, 5]],   // light breeze ideal
  tan_pop:       [[0, 5, 15],   [6, 15, 10],   [16, 30, 4]],   // precipitation %
  tan_rainCap:   15,

  // ── Drone ──
  drone_wind:    [[0, 8, 20],   [9, 15, 14],   [16, 20, 6]],
  drone_gust:    [[0, 15, 20],  [16, 25, 14],  [26, 30, 6]],
  drone_pop:     [[0, 0, 20],   [1, 15, 14],   [16, 30, 6]],
  drone_vis:     [[10001, 99999, 20], [5000, 10000, 14], [1000, 4999, 6]],
  drone_temp:    [[50, 85, 20], [35, 49, 14],  [86, 95, 14], [20, 34, 6]],
  drone_rainCap: 25,
  drone_fogCap:  50,
  drone_highWindCap: 35,
  drone_highWindThreshold: 25,  // wind speed (mph) that triggers the cap

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

function scoreRunningHour(hr) {
  var feels = hr.feels_like;
  var wind = hr.wind_speed;
  var pop = (hr.pop || 0) * 100;
  var humidity = hr.humidity;
  var uvi = hr.uvi || 0;
  var weatherId = hr.weather[0].id;
  var isRaining = weatherId < 700;

  // Guard rails: below freezing or above 90 → always poor
  if (feels < 32 || feels > 90) return Math.min(feels < 32 ? 10 : 5, 20);

  var score = 0;
  score += scoreRange(feels, THRESHOLDS.run_feelsLike);
  score += scoreRange(wind, THRESHOLDS.run_wind);
  score += scoreRange(pop, THRESHOLDS.run_pop);
  score += scoreRange(humidity, THRESHOLDS.run_humidity);
  score += scoreRange(uvi, THRESHOLDS.run_uvi);

  // Heat + humidity combo penalty
  if (THRESHOLDS.run_heatHumidPenalty && feels > 80 && humidity > 65) {
    var penalty = Math.round((feels - 80) * 0.5 + (humidity - 65) * 0.3);
    score = Math.max(0, score - penalty);
  }

  if (isRaining) score = Math.min(score, THRESHOLDS.run_rainCap);
  return score;
}

function scoreTanningHour(hr) {
  var temp = hr.temp;
  var uvi = hr.uvi || 0;
  var clouds = hr.clouds || 0;
  var wind = hr.wind_speed;
  var pop = (hr.pop || 0) * 100;
  var weatherId = hr.weather[0].id;
  var isRaining = weatherId < 700;

  // Below 70°F → always poor for tanning
  if (temp < 70) return 0;

  var score = 0;
  score += scoreRange(temp, THRESHOLDS.tan_temp);
  score += scoreRange(uvi, THRESHOLDS.tan_uvi);
  score += scoreRange(clouds, THRESHOLDS.tan_clouds);
  score += scoreRange(wind, THRESHOLDS.tan_wind);
  score += scoreRange(pop, THRESHOLDS.tan_pop);

  if (isRaining) score = Math.min(score, THRESHOLDS.tan_rainCap);
  return score;
}

function scoreDroneHour(hr, sunrise, sunset) {
  var temp = hr.temp;
  var wind = hr.wind_speed;
  var gust = hr.wind_gust || wind;
  var pop = (hr.pop || 0) * 100;
  var vis = hr.visibility || 10000;
  var weatherId = hr.weather[0].id;
  var isRaining = weatherId < 700;
  var isFoggy = weatherId >= 700 && weatherId < 800;

  if (hr.dt < sunrise || hr.dt > sunset) return 0;

  var score = 0;
  score += scoreRange(wind, THRESHOLDS.drone_wind);
  score += scoreRange(gust, THRESHOLDS.drone_gust);
  score += scoreRange(pop, THRESHOLDS.drone_pop);
  score += scoreRange(vis, THRESHOLDS.drone_vis);
  score += scoreRange(temp, THRESHOLDS.drone_temp);

  if (isRaining) score = Math.min(score, THRESHOLDS.drone_rainCap);
  if (isFoggy) score = Math.min(score, THRESHOLDS.drone_fogCap);
  if (wind > THRESHOLDS.drone_highWindThreshold) score = Math.min(score, THRESHOLDS.drone_highWindCap);

  return score;
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
  var humidity = day.humidity;
  var uvi = day.uvi || 0;
  var weatherId = day.weather[0].id;
  var isRaining = weatherId < 700;

  // Guard rails: below freezing or above 90 → always poor
  if (feels < 32 || feels > 90) {
    var capScore = feels < 32 ? 10 : 5;
    return {
      score: capScore,
      rating: 'poor',
      factors: { feels: Math.round(feels), wind: Math.round(wind), pop: Math.round(pop), humidity: humidity, uvi: uvi }
    };
  }

  var score = 0;
  score += scoreRange(feels, THRESHOLDS.run_feelsLike);
  score += scoreRange(wind, THRESHOLDS.run_wind);
  score += scoreRange(pop, THRESHOLDS.run_pop);
  score += scoreRange(humidity, THRESHOLDS.run_humidity);
  score += scoreRange(uvi, THRESHOLDS.run_uvi);

  // Heat + humidity combo penalty
  if (THRESHOLDS.run_heatHumidPenalty && feels > 80 && humidity > 65) {
    var penalty = Math.round((feels - 80) * 0.5 + (humidity - 65) * 0.3);
    score = Math.max(0, score - penalty);
  }

  if (isRaining) score = Math.min(score, THRESHOLDS.run_rainCap);

  return {
    score: score,
    rating: scoreToRating(score),
    factors: { feels: Math.round(feels), wind: Math.round(wind), pop: Math.round(pop), humidity: humidity, uvi: uvi }
  };
}

function scoreTanning(day) {
  var temp = day.temp.day;
  var uvi = day.uvi || 0;
  var clouds = day.clouds || 0;
  var wind = day.wind_speed;
  var pop = (day.pop || 0) * 100;
  var weatherId = day.weather[0].id;
  var isRaining = weatherId < 700;

  // Below 70°F → always poor for tanning
  if (temp < 70) {
    return {
      score: 0,
      rating: 'poor',
      factors: { temp: Math.round(temp), uvi: uvi, clouds: clouds, wind: Math.round(wind), pop: Math.round(pop) }
    };
  }

  var score = 0;
  score += scoreRange(temp, THRESHOLDS.tan_temp);
  score += scoreRange(uvi, THRESHOLDS.tan_uvi);
  score += scoreRange(clouds, THRESHOLDS.tan_clouds);
  score += scoreRange(wind, THRESHOLDS.tan_wind);
  score += scoreRange(pop, THRESHOLDS.tan_pop);

  if (isRaining) score = Math.min(score, THRESHOLDS.tan_rainCap);

  return {
    score: score,
    rating: scoreToRating(score),
    factors: { temp: Math.round(temp), uvi: uvi, clouds: clouds, wind: Math.round(wind), pop: Math.round(pop) }
  };
}

function scoreDrone(day) {
  var temp = day.temp.day;
  var wind = day.wind_speed;
  var gust = day.wind_gust || wind;
  var pop = (day.pop || 0) * 100;
  var vis = 10000;
  var weatherId = day.weather[0].id;
  var isRaining = weatherId < 700;
  var isFoggy = weatherId >= 700 && weatherId < 800;

  var score = 0;
  score += scoreRange(wind, THRESHOLDS.drone_wind);
  score += scoreRange(gust, THRESHOLDS.drone_gust);
  score += scoreRange(pop, THRESHOLDS.drone_pop);
  if (isFoggy) vis = 3000;
  score += scoreRange(vis, THRESHOLDS.drone_vis);
  score += scoreRange(temp, THRESHOLDS.drone_temp);

  if (isRaining) score = Math.min(score, THRESHOLDS.drone_rainCap);
  if (isFoggy) score = Math.min(score, THRESHOLDS.drone_fogCap);
  if (wind > THRESHOLDS.drone_highWindThreshold) score = Math.min(score, THRESHOLDS.drone_highWindCap);

  var daylight = ((day.sunset - day.sunrise) / 3600).toFixed(1);

  return {
    score: score,
    rating: scoreToRating(score),
    // `vis` is assumed (the daily forecast carries no visibility) — clear unless the
    // condition code is fog. Surfaced so the score breakdown can say so honestly.
    factors: { wind: Math.round(wind), gust: Math.round(gust), pop: Math.round(pop), temp: Math.round(temp), daylight: daylight, vis: vis }
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

  // Summary from API
  if (day.summary) {
    headerHTML += '<div class="w-drawer-summary">' + day.summary + '</div>';
  }

  document.getElementById('wDrawerHeader').innerHTML = headerHTML;

  // Build body — all activities in one view
  var bodyHTML = '';

  // Running
  bodyHTML += renderDrawerActivity('🏃 Running', data.runResult, data.runWin, data.hours, scoreRunningHour, day,
    [['Feels like', data.runResult.factors.feels + '°F'],
     ['Wind', data.runResult.factors.wind + ' mph'],
     ['Rain chance', data.runResult.factors.pop + '%'],
     ['Humidity', data.runResult.factors.humidity + '%']],
    buildScoreBreakdown('run', data.runResult),
    data.runResult.factors.uvi);

  // Drone
  bodyHTML += renderDrawerActivity('🛸 Drone', data.droneResult, data.droneWin, data.hours, scoreDroneHour, day,
    [['Wind', data.droneResult.factors.wind + ' mph'],
     ['Gusts', data.droneResult.factors.gust + ' mph'],
     ['Rain chance', data.droneResult.factors.pop + '%'],
     ['Temp', data.droneResult.factors.temp + '°F'],
     ['Daylight', data.droneResult.factors.daylight + ' hrs']],
    buildScoreBreakdown('drone', data.droneResult));

  // Tanning
  bodyHTML += renderDrawerActivity('☀️ Tanning', data.tanResult, data.tanWin, data.hours, scoreTanningHour, day,
    [['Temp', data.tanResult.factors.temp + '°F'],
     ['Cloud cover', data.tanResult.factors.clouds + '%'],
     ['Wind', data.tanResult.factors.wind + ' mph'],
     ['Rain chance', data.tanResult.factors.pop + '%']],
    buildScoreBreakdown('tan', data.tanResult),
    data.tanResult.factors.uvi);

  document.getElementById('wDrawerBody').innerHTML = bodyHTML;

  document.getElementById('wDrawerBackdrop').classList.add('open');
  document.getElementById('wDrawer').classList.add('open');
}

function renderDrawerActivity(title, result, win, hours, scoreFn, day, factorRows, breakdownHTML, uvValue) {
  var html = '<div class="w-drawer-activity-header" style="margin-top:16px">'
    + '<span>' + title + '</span>'
    + '<span class="w-rating ' + result.rating + '" style="font-size:0.75rem;padding:3px 10px">'
      + RATING_LABELS[result.rating]
    + '</span>'
    + '</div>';

  if (win) {
    // Window with inline metrics
    var winMetrics = windowMetrics(hours, win.startHour, win.endHour);
    html += '<div class="w-drawer-window ' + win.rating + '">'
      + 'Best window: <strong>' + formatHour(win.startHour) + '–' + formatHour(win.endHour) + '</strong>'
      + (winMetrics ? '<div class="w-window-metrics">' + winMetrics + '</div>' : '')
      + '</div>';
  }
  if (win && win.hourScores) {
    html += renderDrawerHourly(win.hourScores);
  }

  for (var i = 0; i < factorRows.length; i++) {
    html += drawerRow(factorRows[i][0], factorRows[i][1]);
  }

  // UV Index expandable (if this activity uses UV)
  if (uvValue !== undefined) {
    html += uvExpandableHTML(uvValue);
  }

  // Tappable score with breakdown
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

  var avgTemp = 0, maxWind = 0, maxPop = 0, avgHumidity = 0, avgUvi = 0;
  for (var j = 0; j < windowHours.length; j++) {
    var hr = windowHours[j];
    avgTemp += (hr.feels_like || hr.temp);
    if (hr.wind_speed > maxWind) maxWind = hr.wind_speed;
    var pop = (hr.pop || 0) * 100;
    if (pop > maxPop) maxPop = pop;
    avgHumidity += (hr.humidity || 0);
    avgUvi += (hr.uvi || 0);
  }
  avgTemp = Math.round(avgTemp / windowHours.length);
  avgHumidity = Math.round(avgHumidity / windowHours.length);
  avgUvi = Math.round((avgUvi / windowHours.length) * 10) / 10;

  return '<span>' + avgTemp + '°F</span>'
    + '<span>💨 ' + Math.round(maxWind) + 'mph</span>'
    + '<span>🌧 ' + Math.round(maxPop) + '%</span>'
    + '<span>💧 ' + avgHumidity + '%</span>';
}

function buildScoreBreakdown(type, result) {
  var f = result.factors;
  var lines = [];
  if (type === 'run') {
    lines.push(breakdownLine('Feels like', f.feels + '°F', scoreRange(f.feels, THRESHOLDS.run_feelsLike), 20));
    lines.push(breakdownLine('Wind', f.wind + ' mph', scoreRange(f.wind, THRESHOLDS.run_wind), 20));
    lines.push(breakdownLine('Rain chance', f.pop + '%', scoreRange(f.pop, THRESHOLDS.run_pop), 20));
    lines.push(breakdownLine('Humidity', f.humidity + '%', scoreRange(f.humidity, THRESHOLDS.run_humidity), 20));
    lines.push(breakdownLine('UV Index', f.uvi, scoreRange(f.uvi, THRESHOLDS.run_uvi), 20));
    if (THRESHOLDS.run_heatHumidPenalty && f.feels > 80 && f.humidity > 65) {
      var penalty = Math.round((f.feels - 80) * 0.5 + (f.humidity - 65) * 0.3);
      lines.push('<div class="w-breakdown-row penalty"><span>Heat+humidity penalty</span><span>-' + penalty + '</span></div>');
    }
  } else if (type === 'drone') {
    lines.push(breakdownLine('Wind', f.wind + ' mph', scoreRange(f.wind, THRESHOLDS.drone_wind), 20));
    lines.push(breakdownLine('Gusts', f.gust + ' mph', scoreRange(f.gust, THRESHOLDS.drone_gust), 20));
    lines.push(breakdownLine('Rain chance', f.pop + '%', scoreRange(f.pop, THRESHOLDS.drone_pop), 20));
    lines.push(breakdownLine('Temp', f.temp + '°F', scoreRange(f.temp, THRESHOLDS.drone_temp), 20));
    // Daily forecast has no visibility — assumed clear unless the condition is fog.
    var visLabel = (f.vis != null && f.vis < 10000) ? 'reduced (fog)' : 'clear (assumed)';
    lines.push(breakdownLine('Visibility', visLabel, scoreRange(f.vis != null ? f.vis : 10000, THRESHOLDS.drone_vis), 20));
  } else if (type === 'tan') {
    lines.push(breakdownLine('Temp', f.temp + '°F', scoreRange(f.temp, THRESHOLDS.tan_temp), 20));
    lines.push(breakdownLine('UV Index', f.uvi, scoreRange(f.uvi, THRESHOLDS.tan_uvi), 25));
    lines.push(breakdownLine('Cloud cover', f.clouds + '%', scoreRange(f.clouds, THRESHOLDS.tan_clouds), 25));
    lines.push(breakdownLine('Wind', f.wind + ' mph', scoreRange(f.wind, THRESHOLDS.tan_wind), 15));
    lines.push(breakdownLine('Rain chance', f.pop + '%', scoreRange(f.pop, THRESHOLDS.tan_pop), 15));
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

function drawerRow(label, value) {
  return '<div class="w-drawer-row"><span>' + label + '</span><span>' + value + '</span></div>';
}

function renderDrawerHourly(hourScores) {
  var html = '<div class="w-drawer-hourly">';
  for (var i = 0; i < hourScores.length; i++) {
    var s = hourScores[i];
    var rating = scoreToRating(s.score);
    var height = Math.max(6, Math.round(s.score / 100 * 48));
    html += '<div class="w-drawer-bar-wrap">'
      + '<div class="w-drawer-bar ' + rating + '" style="height:' + height + 'px"></div>'
      + '<div class="w-drawer-bar-label">' + formatHour(s.hour) + '</div>'
      + '</div>';
  }
  html += '</div>';
  return html;
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
}
