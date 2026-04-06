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

  // ── Running ──
  run_feelsLike: [[45, 65, 20], [35, 44, 15], [66, 75, 15], [25, 34, 8], [76, 85, 8]],
  run_wind:      [[0, 8, 20],   [9, 15, 14],  [16, 22, 6]],
  run_pop:       [[0, 10, 20],  [11, 30, 14],  [31, 60, 6]],   // precipitation %
  run_humidity:  [[30, 60, 20], [20, 29, 14],  [61, 75, 14], [76, 85, 6]],
  run_uvi:       [[0, 5, 20],   [6, 7, 14],    [8, 9, 6]],     // UV index
  run_rainCap:   35,            // max score if actively raining

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

  var score = 0;
  score += scoreRange(feels, THRESHOLDS.run_feelsLike);
  score += scoreRange(wind, THRESHOLDS.run_wind);
  score += scoreInverse(pop, THRESHOLDS.run_pop);
  score += scoreRange(humidity, THRESHOLDS.run_humidity);
  score += scoreInverse(uvi, THRESHOLDS.run_uvi);

  if (isRaining) score = Math.min(score, THRESHOLDS.run_rainCap);
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

  var score = 0;
  score += scoreRange(feels, THRESHOLDS.run_feelsLike);
  score += scoreRange(wind, THRESHOLDS.run_wind);
  score += scoreInverse(pop, THRESHOLDS.run_pop);
  score += scoreRange(humidity, THRESHOLDS.run_humidity);
  score += scoreInverse(uvi, THRESHOLDS.run_uvi);

  if (isRaining) score = Math.min(score, THRESHOLDS.run_rainCap);

  return {
    score: score,
    rating: scoreToRating(score),
    factors: { feels: Math.round(feels), wind: Math.round(wind), pop: Math.round(pop), humidity: humidity, uvi: uvi }
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
  document.getElementById('wSummary').innerHTML =
    summaryHTML(runBest, 'run', daily, hourly) + summaryHTML(droneBest, 'drone', daily, hourly);

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
    var icon = weatherIcon(day.weather[0].id);

    // Optimal windows
    var hours = getHoursForDay(hourly, day.dt);
    var runWin = null;
    var droneWin = null;
    var runWindowHTML = '';
    var droneWindowHTML = '';

    if (hours.length >= 4) {
      runWin = findOptimalWindow(hours, scoreRunningHour, day.sunrise, day.sunset);
      droneWin = findOptimalWindow(hours, scoreDroneHour, day.sunrise, day.sunset);
      if (runWin) {
        runWindowHTML = formatHour(runWin.startHour) + '–' + formatHour(runWin.endHour);
      }
      if (droneWin) {
        droneWindowHTML = formatHour(droneWin.startHour) + '–' + formatHour(droneWin.endHour);
      }
    } else {
      var runEst = estimateWindow(day, 'run');
      var droneEst = estimateWindow(day, 'drone');
      if (runResult.rating !== 'poor') runWindowHTML = runEst.label;
      if (droneResult.rating !== 'poor') droneWindowHTML = droneEst.label;
    }

    // Yesterday comparison (only on Today card)
    var yesterdayHTML = '';
    if (isToday && yesterday) {
      yesterdayHTML = yesterdayComparisonHTML(day, yesterday);
    }

    // Store for drawer
    dayData.push({
      day: day, runResult: runResult, droneResult: droneResult,
      runWin: runWin, droneWin: droneWin,
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
      + '</div>'
      + '<div class="w-day-wind">' + Math.round(day.wind_speed) + ' mph</div>'
      + '<div class="w-detail" id="detail-wStrip-' + i + '">'
        + renderUnifiedDetail(runResult, droneResult, day, runWin, droneWin)
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

function renderUnifiedDetail(runResult, droneResult, day, runWin, droneWin) {
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

  // Build body — both activities in one view
  var bodyHTML = '';

  // Running
  bodyHTML += '<div class="w-drawer-activity-header">'
    + '<span>🏃 Running</span>'
    + '<span class="w-rating ' + data.runResult.rating + '" style="font-size:0.75rem;padding:3px 10px">'
      + RATING_LABELS[data.runResult.rating]
    + '</span>'
    + '</div>';

  if (data.runWin) {
    bodyHTML += '<div class="w-drawer-window ' + data.runWin.rating + '">'
      + 'Best window: <strong>' + formatHour(data.runWin.startHour) + '–' + formatHour(data.runWin.endHour) + '</strong>'
      + '</div>';
  }
  if (data.runWin && data.runWin.hourScores) {
    bodyHTML += renderDrawerHourly(data.runWin.hourScores);
  }

  var rf = data.runResult.factors;
  bodyHTML += drawerRow('Feels like', rf.feels + '°F')
    + drawerRow('Wind', rf.wind + ' mph')
    + drawerRow('Rain chance', rf.pop + '%')
    + drawerRow('Humidity', rf.humidity + '%')
    + drawerRow('UV Index', rf.uvi)
    + drawerRow('Score', data.runResult.score + ' / 100');

  // Drone
  bodyHTML += '<div class="w-drawer-activity-header" style="margin-top:16px">'
    + '<span>🛸 Drone</span>'
    + '<span class="w-rating ' + data.droneResult.rating + '" style="font-size:0.75rem;padding:3px 10px">'
      + RATING_LABELS[data.droneResult.rating]
    + '</span>'
    + '</div>';

  if (data.droneWin) {
    bodyHTML += '<div class="w-drawer-window ' + data.droneWin.rating + '">'
      + 'Best window: <strong>' + formatHour(data.droneWin.startHour) + '–' + formatHour(data.droneWin.endHour) + '</strong>'
      + '</div>';
  }
  if (data.droneWin && data.droneWin.hourScores) {
    bodyHTML += renderDrawerHourly(data.droneWin.hourScores);
  }

  var df = data.droneResult.factors;
  bodyHTML += drawerRow('Wind', df.wind + ' mph')
    + drawerRow('Gusts', df.gust + ' mph')
    + drawerRow('Rain chance', df.pop + '%')
    + drawerRow('Temp', df.temp + '°F')
    + drawerRow('Daylight', df.daylight + ' hrs')
    + drawerRow('Score', data.droneResult.score + ' / 100');

  document.getElementById('wDrawerBody').innerHTML = bodyHTML;

  document.getElementById('wDrawerBackdrop').classList.add('open');
  document.getElementById('wDrawer').classList.add('open');
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
  var label = type === 'run' ? '🏃 Best run' : '🛸 Best flight';

  var hours = getHoursForDay(hourly, best.day.dt);
  var windowStr = '';
  if (hours.length >= 4) {
    var scoreFn = type === 'run' ? scoreRunningHour : scoreDroneHour;
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
