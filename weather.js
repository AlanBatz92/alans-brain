/* ══════════════════════════════════════
   MY WEEK — Weather Outlook Engine
   Alan's Brain
   ══════════════════════════════════════ */

// ⚡ CONFIGURATION
var WEATHER_CONFIG = {
  apiKey: '9eb0ce0243cfaab90e67250e1a55863e',
  lat: 40.539543,                             // <-- Your latitude
  lon: -75.496849,                            // <-- Your longitude
  units: 'imperial',                     // 'imperial' (°F, mph) or 'metric' (°C, m/s)
  cacheTTL: 2 * 60 * 60 * 1000          // 2 hours in ms
};

var weatherCache = null;

/* ── CUSTOM WEATHER ICONS ─────────────── */
// Maps OpenWeather condition code ranges to icon filenames.
// Place PNGs in img/Icons/icons/Weather/. Falls back to emoji if image missing.

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
var iconAvailability = {}; // tracks which PNGs exist

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

/* ── API FETCH + CACHE ────────────────── */

function fetchWeather(force) {
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
    + '?lat=' + WEATHER_CONFIG.lat
    + '&lon=' + WEATHER_CONFIG.lon
    + '&units=' + WEATHER_CONFIG.units
    + '&exclude=minutely,alerts'
    + '&appid=' + WEATHER_CONFIG.apiKey;

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
    })
    .catch(function(err) {
      showLoading(false);
      document.getElementById('wError').style.display = 'block';
      document.getElementById('wError').textContent = 'Could not load weather: ' + err.message;
    });
}

function showLoading(on) {
  document.getElementById('wLoading').style.display = on ? 'flex' : 'none';
  document.getElementById('wRunStrip').style.display = on ? 'none' : '';
  document.getElementById('wDroneStrip').style.display = on ? 'none' : '';
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
// Score a single hourly data point for running or drone.
// Hourly objects have: temp, feels_like, humidity, wind_speed, wind_gust, pop, uvi, weather, visibility, dt

function scoreRunningHour(hr) {
  var feels = hr.feels_like;
  var wind = hr.wind_speed;
  var pop = (hr.pop || 0) * 100;
  var humidity = hr.humidity;
  var uvi = hr.uvi || 0;
  var weatherId = hr.weather[0].id;
  var isRaining = weatherId < 700;

  var score = 0;
  score += scoreRange(feels, [[45, 65, 20], [35, 44, 15], [66, 75, 15], [25, 34, 8], [76, 85, 8]]);
  score += scoreRange(wind, [[0, 8, 20], [9, 15, 14], [16, 22, 6]]);
  score += scoreInverse(pop, [[0, 10, 20], [11, 30, 14], [31, 60, 6]]);
  score += scoreRange(humidity, [[30, 60, 20], [20, 29, 14], [61, 75, 14], [76, 85, 6]]);
  score += scoreInverse(uvi, [[0, 5, 20], [6, 7, 14], [8, 9, 6]]);

  if (isRaining) score = Math.min(score, 35);
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

  // Must be daylight
  if (hr.dt < sunrise || hr.dt > sunset) return 0;

  var score = 0;
  score += scoreRange(wind, [[0, 8, 20], [9, 15, 14], [16, 20, 6]]);
  score += scoreRange(gust, [[0, 15, 20], [16, 25, 14], [26, 30, 6]]);
  score += scoreInverse(pop, [[0, 0, 20], [1, 15, 14], [16, 30, 6]]);
  score += scoreRange(vis, [[10001, 99999, 20], [5000, 10000, 14], [1000, 4999, 6]]);
  score += scoreRange(temp, [[50, 85, 20], [35, 49, 14], [86, 95, 14], [20, 34, 6]]);

  if (isRaining) score = Math.min(score, 25);
  if (isFoggy) score = Math.min(score, 50);
  if (wind > 25) score = Math.min(score, 35);

  return score;
}

/* ── OPTIMAL WINDOW FINDER ────────────── */
// Given hourly data for a day, finds the best contiguous window (min 1 hour).
// Returns { startHour, endHour, avgScore, rating } or null.

function findOptimalWindow(hours, scoreFn, sunrise, sunset) {
  if (!hours || hours.length === 0) return null;

  // Score each hour
  var scores = [];
  for (var i = 0; i < hours.length; i++) {
    scores.push({ dt: hours[i].dt, hour: new Date(hours[i].dt * 1000).getHours(), score: scoreFn(hours[i], sunrise, sunset) });
  }

  // Find the best contiguous window where all hours score >= 45 (Fair+)
  var bestStart = -1;
  var bestEnd = -1;
  var bestAvg = 0;

  for (var start = 0; start < scores.length; start++) {
    if (scores[start].score < 30) continue; // skip poor hours as start
    var sum = 0;
    var count = 0;
    for (var end = start; end < scores.length; end++) {
      if (scores[end].score < 30) break; // window broken by a poor hour
      sum += scores[end].score;
      count++;
      var avg = sum / count;
      // Prefer longer windows with higher averages
      var quality = avg * Math.min(count, 4); // diminishing returns after 4 hours
      var bestQuality = bestAvg * Math.min(bestEnd - bestStart + 1, 4);
      if (count >= 1 && quality > bestQuality) {
        bestStart = start;
        bestEnd = end;
        bestAvg = avg;
      }
    }
  }

  if (bestStart === -1) {
    // No good window — pick the single best hour
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

// Get hourly data that falls on a given day (by matching date string)
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

// For days beyond hourly range, estimate window from daily temp curve
function estimateWindow(day, type) {
  if (type === 'run') {
    // Prefer early morning or evening to avoid peak heat/UV
    var tempDay = day.temp.day;
    if (tempDay > 75) return { label: 'Early AM', startHour: 6, endHour: 9 };
    if (tempDay > 65) return { label: 'Morning', startHour: 7, endHour: 10 };
    if (tempDay < 40) return { label: 'Afternoon', startHour: 12, endHour: 15 };
    return { label: 'Morning', startHour: 8, endHour: 11 };
  } else {
    // Drones: mid-morning typically has lowest wind, good light
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
  score += scoreRange(feels, [[45, 65, 20], [35, 44, 15], [66, 75, 15], [25, 34, 8], [76, 85, 8]]);
  score += scoreRange(wind, [[0, 8, 20], [9, 15, 14], [16, 22, 6]]);
  score += scoreInverse(pop, [[0, 10, 20], [11, 30, 14], [31, 60, 6]]);
  score += scoreRange(humidity, [[30, 60, 20], [20, 29, 14], [61, 75, 14], [76, 85, 6]]);
  score += scoreInverse(uvi, [[0, 5, 20], [6, 7, 14], [8, 9, 6]]);

  if (isRaining) score = Math.min(score, 35);

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
  score += scoreRange(wind, [[0, 8, 20], [9, 15, 14], [16, 20, 6]]);
  score += scoreRange(gust, [[0, 15, 20], [16, 25, 14], [26, 30, 6]]);
  score += scoreInverse(pop, [[0, 0, 20], [1, 15, 14], [16, 30, 6]]);
  if (isFoggy) vis = 3000;
  score += scoreRange(vis, [[10001, 99999, 20], [5000, 10000, 14], [1000, 4999, 6]]);
  score += scoreRange(temp, [[50, 85, 20], [35, 49, 14], [86, 95, 14], [20, 34, 6]]);

  if (isRaining) score = Math.min(score, 25);
  if (isFoggy) score = Math.min(score, 50);
  if (wind > 25) score = Math.min(score, 35);

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
  if (score >= 85) return 'perfect';
  if (score >= 65) return 'good';
  if (score >= 45) return 'fair';
  return 'poor';
}

var RATING_LABELS = { perfect: 'Perfect', good: 'Good', fair: 'Fair', poor: 'Poor' };
var RATING_ICONS = { perfect: '◆', good: '●', fair: '▲', poor: '✕' };

/* ── RENDER ────────────────────────────── */

function renderWeather(data) {
  var daily = data.daily.slice(0, 7);
  var hourly = data.hourly || [];
  var todayDate = new Date(data.daily[0].dt * 1000).toDateString();

  renderStrip('wRunStrip', daily, hourly, todayDate, scoreRunning, scoreRunningHour, 'run', renderRunDetail);
  renderStrip('wDroneStrip', daily, hourly, todayDate, scoreDrone, scoreDroneHour, 'drone', renderDroneDetail);

  // Summary badges
  var runBest = findBestDay(daily, scoreRunning);
  var droneBest = findBestDay(daily, scoreDrone);
  document.getElementById('wRunSummary').innerHTML = summaryHTML(runBest, 'run', daily, hourly);
  document.getElementById('wDroneSummary').innerHTML = summaryHTML(droneBest, 'drone', daily, hourly);

  showLoading(false);
}

function renderStrip(containerId, days, hourly, todayDate, dayScoreFn, hourScoreFn, type, detailFn) {
  var el = document.getElementById(containerId);
  var html = '';
  for (var i = 0; i < days.length; i++) {
    var day = days[i];
    var d = new Date(day.dt * 1000);
    var isToday = d.toDateString() === todayDate;
    var dayName = isToday ? 'Today' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    var dateStr = (d.getMonth() + 1) + '/' + d.getDate();
    var result = dayScoreFn(day);
    var icon = weatherIcon(day.weather[0].id);

    // Optimal time window
    var hours = getHoursForDay(hourly, day.dt);
    var window = null;
    var windowHTML = '';
    if (hours.length >= 4) {
      // We have hourly data for this day
      window = findOptimalWindow(hours, hourScoreFn, day.sunrise, day.sunset);
      if (window) {
        windowHTML = '<div class="w-day-window ' + window.rating + '">'
          + formatHour(window.startHour) + '–' + formatHour(window.endHour)
          + '</div>';
      }
    } else {
      // Beyond hourly range — estimate
      var est = estimateWindow(day, type);
      if (result.rating !== 'poor') {
        windowHTML = '<div class="w-day-window estimated">'
          + est.label
          + '</div>';
      }
    }

    html += '<div class="w-day' + (isToday ? ' today' : '') + '" data-idx="' + i + '">'
      + '<div class="w-day-name">' + dayName + '</div>'
      + '<div class="w-day-date">' + dateStr + '</div>'
      + '<div class="w-day-icon">' + icon + '</div>'
      + '<div class="w-day-temp">' + Math.round(day.temp.day) + '°</div>'
      + '<div class="w-rating ' + result.rating + '">'
        + '<span class="w-rating-icon">' + RATING_ICONS[result.rating] + '</span> '
        + RATING_LABELS[result.rating]
      + '</div>'
      + windowHTML
      + '<div class="w-day-wind">' + Math.round(day.wind_speed) + ' mph</div>'
      + '<div class="w-detail" id="detail-' + containerId + '-' + i + '">'
        + detailFn(result, day, window)
      + '</div>'
      + '</div>';
  }
  el.innerHTML = html;

  // Tap to expand detail
  el.querySelectorAll('.w-day').forEach(function(card) {
    card.addEventListener('click', function() {
      card.classList.toggle('expanded');
    });
  });
}

function renderRunDetail(result, day, window) {
  var f = result.factors;
  var html = '';
  if (window && window.hourScores) {
    html += '<div class="w-detail-section">Hour-by-hour</div>';
    html += renderHourlyMini(window.hourScores);
  }
  html += '<div class="w-detail-row"><span>Feels like</span><span>' + f.feels + '°F</span></div>'
    + '<div class="w-detail-row"><span>Wind</span><span>' + f.wind + ' mph</span></div>'
    + '<div class="w-detail-row"><span>Rain chance</span><span>' + f.pop + '%</span></div>'
    + '<div class="w-detail-row"><span>Humidity</span><span>' + f.humidity + '%</span></div>'
    + '<div class="w-detail-row"><span>UV Index</span><span>' + f.uvi + '</span></div>'
    + '<div class="w-detail-row"><span>Score</span><span>' + result.score + '/100</span></div>';
  return html;
}

function renderDroneDetail(result, day, window) {
  var f = result.factors;
  var html = '';
  if (window && window.hourScores) {
    html += '<div class="w-detail-section">Hour-by-hour</div>';
    html += renderHourlyMini(window.hourScores);
  }
  html += '<div class="w-detail-row"><span>Wind</span><span>' + f.wind + ' mph</span></div>'
    + '<div class="w-detail-row"><span>Gusts</span><span>' + f.gust + ' mph</span></div>'
    + '<div class="w-detail-row"><span>Rain chance</span><span>' + f.pop + '%</span></div>'
    + '<div class="w-detail-row"><span>Temp</span><span>' + f.temp + '°F</span></div>'
    + '<div class="w-detail-row"><span>Daylight</span><span>' + f.daylight + ' hrs</span></div>'
    + '<div class="w-detail-row"><span>Score</span><span>' + result.score + '/100</span></div>';
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
  var label = type === 'run' ? 'Best run' : 'Best flight';

  // Find optimal window for best day
  var hours = getHoursForDay(hourly, best.day.dt);
  var windowStr = '';
  if (hours.length >= 4) {
    var scoreFn = type === 'run' ? scoreRunningHour : scoreDroneHour;
    var win = findOptimalWindow(hours, scoreFn, best.day.sunrise, best.day.sunset);
    if (win) {
      windowStr = ' <span class="w-summary-window">' + formatHour(win.startHour) + '–' + formatHour(win.endHour) + '</span>';
    }
  }

  return '<span class="w-summary-label">' + label + ':</span> '
    + '<span class="w-summary-day ' + best.result.rating + '">' + dayName + '</span>'
    + windowStr + ' '
    + '<span class="w-summary-rating ' + best.result.rating + '">' + RATING_LABELS[best.result.rating] + '</span>';
}

/* ── INIT ──────────────────────────────── */

function initWeather() {
  probeIcons();
  fetchWeather(false);
}
