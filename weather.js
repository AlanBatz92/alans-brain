/* ══════════════════════════════════════
   MY WEEK — Weather Outlook Engine
   Alan's Brain
   ══════════════════════════════════════ */

// ⚡ CONFIGURATION
var WEATHER_CONFIG = {
  apiKey: '9eb0ce0243cfaab90e67250e1a55863e',
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
  // Clear cache so next fetch uses new location
  localStorage.removeItem('ab_weather_cache');
  localStorage.removeItem('ab_weather_ts');
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
      showCustomLocationPrompt();
    } else {
      var loc = WEATHER_LOCATIONS[parseInt(val, 10)];
      setSelectedLocation(loc);
      fetchWeather(true);
    }
  });
}

function showCustomLocationPrompt() {
  var input = prompt('Enter location as "Name, Lat, Lon"\nExample: Jim Thorpe, 40.876, -75.732');
  if (!input) {
    // Reset dropdown to current
    restoreLocationDropdown();
    return;
  }
  var parts = input.split(',');
  if (parts.length >= 3) {
    var name = parts[0].trim();
    var lat = parseFloat(parts[1].trim());
    var lon = parseFloat(parts[2].trim());
    if (name && !isNaN(lat) && !isNaN(lon)) {
      setSelectedLocation({ name: name, lat: lat, lon: lon });
      // Update dropdown label
      var select = document.getElementById('wLocationSelect');
      var customOpt = select.querySelector('option[value="custom"]');
      customOpt.textContent = name;
      customOpt.selected = true;
      fetchWeather(true);
      return;
    }
  }
  alert('Invalid format. Use: Name, Lat, Lon');
  restoreLocationDropdown();
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
  var url = 'https://api.openweathermap.org/data/3.0/onecall'
    + '?lat=' + loc.lat
    + '&lon=' + loc.lon
    + '&units=' + WEATHER_CONFIG.units
    + '&exclude=minutely,alerts'
    + '&appid=' + WEATHER_CONFIG.apiKey;

  fetch(url)
    .then(function(r) {
      if (!r.ok) throw new Error('API ' + r.status);
      return r.json();
    })
    .then(function(data) {
      // Save yesterday's data before overwriting cache
      saveYesterdayData(cached);

      weatherCache = data;
      localStorage.setItem('ab_weather_cache', JSON.stringify(data));
      localStorage.setItem('ab_weather_ts', String(Date.now()));
      renderWeather(data);
      updateTimestamp(Date.now());
      showLoading(false);
    })
    .catch(function(err) {
      showLoading(false);
      document.getElementById('wError').style.display = 'block';
      document.getElementById('wError').textContent = 'Could not load weather: ' + err.message;
    });
}

/* ── YESTERDAY COMPARISON ────────────── */

function saveYesterdayData(previousCacheStr) {
  if (!previousCacheStr) return;
  try {
    var prev = JSON.parse(previousCacheStr);
    if (prev.daily && prev.daily.length > 0) {
      // Save today's entry from the previous cache as "yesterday"
      var todayEntry = prev.daily[0];
      localStorage.setItem('ab_weather_yesterday', JSON.stringify(todayEntry));
    }
  } catch (e) { /* ignore */ }
}

function getYesterdayData() {
  try {
    var raw = localStorage.getItem('ab_weather_yesterday');
    if (!raw) return null;
    var data = JSON.parse(raw);
    // Verify it's actually from yesterday (within ~48 hours to be safe)
    var age = Date.now() - (data.dt * 1000);
    if (age > 48 * 60 * 60 * 1000) return null; // too old
    return data;
  } catch (e) { return null; }
}

function yesterdayComparisonHTML(today, yesterday) {
  if (!yesterday) return '';

  var todayFeels = today.feels_like ? today.feels_like.day : today.temp.day;
  var yesterdayFeels = yesterday.feels_like ? yesterday.feels_like.day : yesterday.temp.day;
  var diff = Math.round(todayFeels - yesterdayFeels);

  if (diff === 0) return '<div class="w-yesterday">Same as yesterday</div>';

  var arrow = diff > 0 ? '↑' : '↓';
  var cls = diff > 0 ? 'warmer' : 'cooler';
  var label = diff > 0 ? 'warmer' : 'cooler';
  return '<div class="w-yesterday ' + cls + '">' + arrow + Math.abs(diff) + '° ' + label + ' than yesterday</div>';
}

function showLoading(on) {
  document.getElementById('wLoading').style.display = on ? 'flex' : 'none';
  document.getElementById('wStrip').style.display = on ? 'none' : '';
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
  score += scoreInverse(pop, THRESHOLDS.run_pop);
  score += scoreRange(humidity, THRESHOLDS.run_humidity);
  score += scoreInverse(uvi, THRESHOLDS.run_uvi);

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
  score += scoreInverse(clouds, THRESHOLDS.tan_clouds);
  score += scoreRange(wind, THRESHOLDS.tan_wind);
  score += scoreInverse(pop, THRESHOLDS.tan_pop);

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
  score += scoreInverse(pop, THRESHOLDS.drone_pop);
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
    scores.push({ dt: hours[i].dt, hour: new Date(hours[i].dt * 1000).getHours(), score: scoreFn(hours[i], sunrise, sunset) });
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
  var dayDate = new Date(dayDt * 1000).toDateString();
  var result = [];
  for (var i = 0; i < hourly.length; i++) {
    if (new Date(hourly[i].dt * 1000).toDateString() === dayDate) {
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
  score += scoreInverse(pop, THRESHOLDS.run_pop);
  score += scoreRange(humidity, THRESHOLDS.run_humidity);
  score += scoreInverse(uvi, THRESHOLDS.run_uvi);

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
  score += scoreInverse(clouds, THRESHOLDS.tan_clouds);
  score += scoreRange(wind, THRESHOLDS.tan_wind);
  score += scoreInverse(pop, THRESHOLDS.tan_pop);

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
  score += scoreInverse(pop, THRESHOLDS.drone_pop);
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
    factors: { wind: Math.round(wind), gust: Math.round(gust), pop: Math.round(pop), temp: Math.round(temp), daylight: daylight }
  };
}

/* ── SCORING HELPERS ──────────────────── */

function scoreRange(val, bands) {
  for (var i = 0; i < bands.length; i++) {
    if (val >= bands[i][0] && val <= bands[i][1]) return bands[i][2];
  }
  return 0;
}

function scoreInverse(val, bands) {
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
var RATING_ICONS = { perfect: '◆', good: '●', fair: '▲', poor: '✕' };

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
  var daily = data.daily.slice(0, 7);
  var hourly = data.hourly || [];
  var todayDate = new Date(data.daily[0].dt * 1000).toDateString();
  var yesterday = getYesterdayData();

  renderUnifiedStrip(daily, hourly, todayDate, yesterday);

  // Summary badges
  var runBest = findBestDay(daily, scoreRunning);
  var droneBest = findBestDay(daily, scoreDrone);
  var tanBest = findBestDay(daily, scoreTanning);
  document.getElementById('wSummary').innerHTML =
    summaryHTML(runBest, 'run', daily, hourly)
    + summaryHTML(droneBest, 'drone', daily, hourly)
    + summaryHTML(tanBest, 'tan', daily, hourly);

  showLoading(false);
}

var renderedDays = {};

function isMobile() {
  return window.innerWidth <= 600;
}

function renderUnifiedStrip(days, hourly, todayDate, yesterday) {
  var el = document.getElementById('wStrip');
  var html = '';
  var dayData = [];

  for (var i = 0; i < days.length; i++) {
    var day = days[i];
    var d = new Date(day.dt * 1000);
    var isToday = d.toDateString() === todayDate;
    var dayName = isToday ? 'Today' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    var fullDayName = isToday ? 'Today' : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
    var dateStr = (d.getMonth() + 1) + '/' + d.getDate();

    var runResult = scoreRunning(day);
    var droneResult = scoreDrone(day);
    var tanResult = scoreTanning(day);
    var icon = weatherIcon(day.weather[0].id);

    // Optimal windows
    var hours = getHoursForDay(hourly, day.dt);
    var runWin = null;
    var droneWin = null;
    var tanWin = null;
    var runWindowHTML = '';
    var droneWindowHTML = '';
    var tanWindowHTML = '';

    if (hours.length >= 4) {
      runWin = findOptimalWindow(hours, scoreRunningHour, day.sunrise, day.sunset);
      droneWin = findOptimalWindow(hours, scoreDroneHour, day.sunrise, day.sunset);
      tanWin = findOptimalWindow(hours, scoreTanningHour, day.sunrise, day.sunset);
      if (runWin) {
        runWindowHTML = formatHour(runWin.startHour) + '–' + formatHour(runWin.endHour);
      }
      if (droneWin) {
        droneWindowHTML = formatHour(droneWin.startHour) + '–' + formatHour(droneWin.endHour);
      }
      if (tanWin) {
        tanWindowHTML = formatHour(tanWin.startHour) + '–' + formatHour(tanWin.endHour);
      }
    } else {
      var runEst = estimateWindow(day, 'run');
      var droneEst = estimateWindow(day, 'drone');
      if (runResult.rating !== 'poor') runWindowHTML = runEst.label;
      if (droneResult.rating !== 'poor') droneWindowHTML = droneEst.label;
      if (tanResult.rating !== 'poor') tanWindowHTML = 'Midday';
    }

    // Yesterday comparison (only on Today card)
    var yesterdayHTML = '';
    if (isToday && yesterday) {
      yesterdayHTML = yesterdayComparisonHTML(day, yesterday);
    }

    // Store for drawer
    dayData.push({
      day: day, runResult: runResult, droneResult: droneResult, tanResult: tanResult,
      runWin: runWin, droneWin: droneWin, tanWin: tanWin,
      dayName: dayName, fullDayName: fullDayName, dateStr: dateStr,
      icon: icon, hours: hours, yesterday: isToday ? yesterday : null
    });

    html += '<div class="w-day' + (isToday ? ' today' : '') + '" data-idx="' + i + '">'
      + '<div class="w-day-name">' + dayName + '</div>'
      + '<div class="w-day-date">' + dateStr + '</div>'
      + '<div class="w-day-icon">' + icon + '</div>'
      + '<div class="w-day-temp">' + Math.round(day.temp.day) + '°</div>'
      + yesterdayHTML
      + '<div class="w-day-ratings">'
        + '<div class="w-day-activity">'
          + '<span class="w-activity-label">🏃</span>'
          + '<span class="w-rating ' + runResult.rating + '">'
            + RATING_LABELS[runResult.rating]
          + '</span>'
        + '</div>'
        + '<div class="w-day-activity">'
          + '<span class="w-activity-label">🛸</span>'
          + '<span class="w-rating ' + droneResult.rating + '">'
            + RATING_LABELS[droneResult.rating]
          + '</span>'
        + '</div>'
        + '<div class="w-day-activity">'
          + '<span class="w-activity-label">☀️</span>'
          + '<span class="w-rating ' + tanResult.rating + '">'
            + RATING_LABELS[tanResult.rating]
          + '</span>'
        + '</div>'
      + '</div>'
      + '<div class="w-day-wind">' + Math.round(day.wind_speed) + ' mph</div>'
      + '<div class="w-detail" id="detail-wStrip-' + i + '">'
        + renderUnifiedDetail(runResult, droneResult, tanResult, day, runWin, droneWin, tanWin)
      + '</div>'
      + '</div>';
  }
  el.innerHTML = html;
  renderedDays['wStrip'] = dayData;

  el.querySelectorAll('.w-day').forEach(function(card) {
    card.addEventListener('click', function() {
      var idx = parseInt(card.getAttribute('data-idx'), 10);
      if (isMobile()) {
        openWeatherDrawer(idx);
      } else {
        card.classList.toggle('expanded');
      }
    });
  });
}

/* ── UNIFIED DETAIL (inline desktop) ──── */

function renderUnifiedDetail(runResult, droneResult, tanResult, day, runWin, droneWin, tanWin) {
  var html = '';

  // Running section
  html += '<div class="w-detail-section">🏃 Running</div>';
  if (runWin && runWin.hourScores) {
    html += renderHourlyMini(runWin.hourScores);
  }
  var rf = runResult.factors;
  html += '<div class="w-detail-row"><span>Feels like</span><span>' + rf.feels + '°F</span></div>'
    + '<div class="w-detail-row"><span>Wind</span><span>' + rf.wind + ' mph</span></div>'
    + '<div class="w-detail-row"><span>Rain chance</span><span>' + rf.pop + '%</span></div>'
    + '<div class="w-detail-row"><span>Humidity</span><span>' + rf.humidity + '%</span></div>'
    + '<div class="w-detail-row"><span>UV Index</span><span>' + rf.uvi + '</span></div>'
    + '<div class="w-detail-row"><span>Score</span><span>' + runResult.score + '/100</span></div>';

  // Drone section
  html += '<div class="w-detail-section" style="margin-top:8px">🛸 Drone</div>';
  if (droneWin && droneWin.hourScores) {
    html += renderHourlyMini(droneWin.hourScores);
  }
  var df = droneResult.factors;
  html += '<div class="w-detail-row"><span>Wind</span><span>' + df.wind + ' mph</span></div>'
    + '<div class="w-detail-row"><span>Gusts</span><span>' + df.gust + ' mph</span></div>'
    + '<div class="w-detail-row"><span>Rain chance</span><span>' + df.pop + '%</span></div>'
    + '<div class="w-detail-row"><span>Temp</span><span>' + df.temp + '°F</span></div>'
    + '<div class="w-detail-row"><span>Daylight</span><span>' + df.daylight + ' hrs</span></div>'
    + '<div class="w-detail-row"><span>Score</span><span>' + droneResult.score + '/100</span></div>';

  // Tanning section
  html += '<div class="w-detail-section" style="margin-top:8px">☀️ Tanning</div>';
  if (tanWin && tanWin.hourScores) {
    html += renderHourlyMini(tanWin.hourScores);
  }
  var tf = tanResult.factors;
  html += '<div class="w-detail-row"><span>Temp</span><span>' + tf.temp + '°F</span></div>'
    + '<div class="w-detail-row"><span>UV Index</span><span>' + tf.uvi + '</span></div>'
    + '<div class="w-detail-row"><span>Cloud cover</span><span>' + tf.clouds + '%</span></div>'
    + '<div class="w-detail-row"><span>Wind</span><span>' + tf.wind + ' mph</span></div>'
    + '<div class="w-detail-row"><span>Rain chance</span><span>' + tf.pop + '%</span></div>'
    + '<div class="w-detail-row"><span>Score</span><span>' + tanResult.score + '/100</span></div>';

  return html;
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
    var h = new Date(hours[i].dt * 1000).getHours();
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
    lines.push(breakdownLine('Rain chance', f.pop + '%', scoreInverse(f.pop, THRESHOLDS.run_pop), 20));
    lines.push(breakdownLine('Humidity', f.humidity + '%', scoreRange(f.humidity, THRESHOLDS.run_humidity), 20));
    lines.push(breakdownLine('UV Index', f.uvi, scoreInverse(f.uvi, THRESHOLDS.run_uvi), 20));
    if (THRESHOLDS.run_heatHumidPenalty && f.feels > 80 && f.humidity > 65) {
      var penalty = Math.round((f.feels - 80) * 0.5 + (f.humidity - 65) * 0.3);
      lines.push('<div class="w-breakdown-row penalty"><span>Heat+humidity penalty</span><span>-' + penalty + '</span></div>');
    }
  } else if (type === 'drone') {
    lines.push(breakdownLine('Wind', f.wind + ' mph', scoreRange(f.wind, THRESHOLDS.drone_wind), 20));
    lines.push(breakdownLine('Gusts', f.gust + ' mph', scoreRange(f.gust, THRESHOLDS.drone_gust), 20));
    lines.push(breakdownLine('Rain chance', f.pop + '%', scoreInverse(f.pop, THRESHOLDS.drone_pop), 20));
    lines.push(breakdownLine('Temp', f.temp + '°F', scoreRange(f.temp, THRESHOLDS.drone_temp), 20));
    lines.push(breakdownLine('Visibility', '—', 20, 20)); // daily doesn't have vis
  } else if (type === 'tan') {
    lines.push(breakdownLine('Temp', f.temp + '°F', scoreRange(f.temp, THRESHOLDS.tan_temp), 20));
    lines.push(breakdownLine('UV Index', f.uvi, scoreRange(f.uvi, THRESHOLDS.tan_uvi), 25));
    lines.push(breakdownLine('Cloud cover', f.clouds + '%', scoreInverse(f.clouds, THRESHOLDS.tan_clouds), 25));
    lines.push(breakdownLine('Wind', f.wind + ' mph', scoreRange(f.wind, THRESHOLDS.tan_wind), 15));
    lines.push(breakdownLine('Rain chance', f.pop + '%', scoreInverse(f.pop, THRESHOLDS.tan_pop), 15));
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

function renderHourlyMini(hourScores) {
  var html = '<div class="w-hourly-mini">';
  for (var i = 0; i < hourScores.length; i++) {
    var s = hourScores[i];
    var rating = scoreToRating(s.score);
    var height = Math.max(4, Math.round(s.score / 100 * 28));
    html += '<div class="w-hourly-bar-wrap" title="' + formatHour(s.hour) + ': ' + s.score + '/100">'
      + '<div class="w-hourly-bar ' + rating + '" style="height:' + height + 'px"></div>'
      + '<div class="w-hourly-label">' + (s.hour % 3 === 0 ? formatHour(s.hour) : '') + '</div>'
      + '</div>';
  }
  html += '</div>';
  return html;
}

function findBestDay(days, scoreFn) {
  var best = null;
  var bestScore = -1;
  for (var i = 0; i < days.length; i++) {
    var r = scoreFn(days[i]);
    if (r.score > bestScore) {
      bestScore = r.score;
      best = { day: days[i], result: r, index: i };
    }
  }
  return best;
}

function summaryHTML(best, type, daily, hourly) {
  if (!best) return '';
  var d = new Date(best.day.dt * 1000);
  var todayStr = new Date().toDateString();
  var dayName = d.toDateString() === todayStr ? 'Today' : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
  var label = type === 'run' ? '🏃 Best run' : (type === 'drone' ? '🛸 Best flight' : '☀️ Best tan');

  var hours = getHoursForDay(hourly, best.day.dt);
  var windowStr = '';
  if (hours.length >= 4) {
    var scoreFn = type === 'run' ? scoreRunningHour : (type === 'drone' ? scoreDroneHour : scoreTanningHour);
    var win = findOptimalWindow(hours, scoreFn, best.day.sunrise, best.day.sunset);
    if (win) {
      windowStr = ' <span class="w-summary-window">' + formatHour(win.startHour) + '–' + formatHour(win.endHour) + '</span>';
    }
  }

  return '<div class="w-summary-line">'
    + '<span class="w-summary-label">' + label + ':</span> '
    + '<span class="w-summary-day ' + best.result.rating + '">' + dayName + '</span>'
    + windowStr + ' '
    + '<span class="w-summary-rating ' + best.result.rating + '">' + RATING_LABELS[best.result.rating] + '</span>'
    + '</div>';
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
