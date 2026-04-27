/* ══════════════════════════════════════
   SETLIST TO SPOTIFY — App Engine
   Alan's Brain
   ══════════════════════════════════════ */

// ⚡ CONFIGURATION

var SL_CONFIG = {
  // Setlist.fm API doesn't support CORS — requests go through /api/setlist serverless proxy
  setlistProxyUrl: '/api/setlist',
  setlistBaseUrl: 'https://api.setlist.fm/rest/1.0',
  spotifyAuthUrl: 'https://accounts.spotify.com/authorize',
  spotifyTokenUrl: 'https://accounts.spotify.com/api/token',
  spotifyApiUrl: 'https://api.spotify.com/v1',
  spotifyScopes: 'playlist-modify-public playlist-modify-private',
  redirectUri: window.location.origin + window.location.pathname,

  // Default API keys — override via the Setup section if needed
  defaultSetlistKey: 'vyNcQzeLTe_xV5pVtKlrt3EmJo2v8WzCB0xM',
  defaultSpotifyClientId: '735092c51ee34dd7836615fe4c067edb'
};

/* ── KEY MANAGEMENT ──────────────────── */

function getSetlistKey() {
  return localStorage.getItem('ab_setlist_key') || SL_CONFIG.defaultSetlistKey;
}

function getSpotifyClientId() {
  return localStorage.getItem('ab_spotify_client_id') || SL_CONFIG.defaultSpotifyClientId;
}

function getSpotifyToken() {
  var token = localStorage.getItem('ab_spotify_token');
  var expiry = parseInt(localStorage.getItem('ab_spotify_token_expiry') || '0', 10);
  if (token && Date.now() < expiry) return token;
  return null;
}

function saveSpotifyToken(token, expiresIn) {
  localStorage.setItem('ab_spotify_token', token);
  localStorage.setItem('ab_spotify_token_expiry', String(Date.now() + (expiresIn * 1000) - 60000));
}

/* ── SPOTIFY PKCE OAuth ──────────────── */

function generateRandomString(length) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  var arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  var result = '';
  for (var i = 0; i < length; i++) result += chars[arr[i] % chars.length];
  return result;
}

function sha256(plain) {
  var encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(plain));
}

function base64urlEncode(buffer) {
  var bytes = new Uint8Array(buffer);
  var str = '';
  for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function startSpotifyAuth() {
  var clientId = getSpotifyClientId();
  if (!clientId) {
    showError('slCreateError', 'Please set your Spotify Client ID in the Setup section below.');
    return;
  }

  var verifier = generateRandomString(64);
  sessionStorage.setItem('sl_pkce_verifier', verifier);

  // Save app state so we can restore after redirect
  sessionStorage.setItem('sl_pending_state', JSON.stringify(appState));

  sha256(verifier).then(function(hash) {
    var challenge = base64urlEncode(hash);
    var state = generateRandomString(16);
    sessionStorage.setItem('sl_oauth_state', state);

    var params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: SL_CONFIG.redirectUri,
      scope: SL_CONFIG.spotifyScopes,
      state: state,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      show_dialog: 'true'
    });

    window.location.href = SL_CONFIG.spotifyAuthUrl + '?' + params.toString();
  });
}

function handleOAuthCallback() {
  var params = new URLSearchParams(window.location.search);
  var code = params.get('code');
  var state = params.get('state');
  var error = params.get('error');

  if (error) {
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
    showError('slCreateError', 'Spotify authorization was denied.');
    return Promise.resolve(false);
  }

  if (!code) return Promise.resolve(false);

  var savedState = sessionStorage.getItem('sl_oauth_state');
  if (state !== savedState) {
    window.history.replaceState({}, '', window.location.pathname);
    showError('slCreateError', 'OAuth state mismatch. Please try again.');
    return Promise.resolve(false);
  }

  var verifier = sessionStorage.getItem('sl_pkce_verifier');
  var clientId = getSpotifyClientId();

  // Clean URL immediately
  window.history.replaceState({}, '', window.location.pathname);

  return fetch(SL_CONFIG.spotifyTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: SL_CONFIG.redirectUri,
      client_id: clientId,
      code_verifier: verifier
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.access_token) {
      saveSpotifyToken(data.access_token, data.expires_in);
      if (data.scope) {
        localStorage.setItem('ab_spotify_scope', data.scope);
      }
      sessionStorage.removeItem('sl_pkce_verifier');
      sessionStorage.removeItem('sl_oauth_state');
      return true;
    }
    showError('slCreateError', 'Token exchange failed: ' + (data.error_description || data.error));
    return false;
  })
  .catch(function(err) {
    showError('slCreateError', 'Token exchange error: ' + err.message);
    return false;
  });
}

/* ── SETLIST.FM URL PARSING ──────────── */

function parseSetlistUrl(input) {
  // Matches URLs like https://www.setlist.fm/setlist/health/2026/vogue-theatre-vancouver-bc-canada-5b76a314.html
  var match = input.match(/setlist\.fm\/setlist\/[^\/]+\/\d{4}\/[^\/]+-([0-9a-f]+)\.html/i);
  if (match) return match[1]; // return the setlist ID
  // Also match short form like setlist.fm/setlist/5b76a314
  var shortMatch = input.match(/setlist\.fm\/setlist\/([0-9a-f]+)/i);
  if (shortMatch) return shortMatch[1];
  return null;
}

function fetchSetlistById(setlistId) {
  var proxyUrl = SL_CONFIG.setlistProxyUrl + '?path=' + encodeURIComponent('/setlist/' + setlistId);
  return fetch(proxyUrl)
    .then(function(r) {
      if (r.status === 404) throw new Error('Setlist not found. Check the URL and try again.');
      if (!r.ok) throw new Error('Could not fetch setlist: ' + r.status);
      return r.json();
    });
}

/* ── SETLIST.FM API ──────────────────── */

function searchArtists(query) {
  var proxyUrl = SL_CONFIG.setlistProxyUrl + '?path=' + encodeURIComponent('/search/artists')
    + '&artistName=' + encodeURIComponent(query) + '&p=1&sort=relevance';
  return fetch(proxyUrl)
  .then(function(r) {
    if (r.status === 403) throw new Error('Invalid Setlist.fm API key');
    if (r.status === 404) return { artist: [] };
    if (!r.ok) throw new Error('Setlist.fm API error: ' + r.status);
    return r.json();
  })
  .then(function(data) {
    return data.artist || [];
  });
}

function getArtistSetlists(mbid) {
  var proxyUrl = SL_CONFIG.setlistProxyUrl + '?path=' + encodeURIComponent('/artist/' + mbid + '/setlists') + '&p=1';
  return fetch(proxyUrl)
  .then(function(r) {
    if (!r.ok) throw new Error('Could not fetch setlists');
    return r.json();
  })
  .then(function(data) {
    // Filter to setlists that actually have songs
    var setlists = data.setlist || [];
    return setlists.filter(function(s) {
      return s.sets && s.sets.set && s.sets.set.length > 0 &&
        s.sets.set.some(function(set) { return set.song && set.song.length > 0; });
    });
  });
}

function extractSongs(setlist, artistName, artistMbid) {
  var songs = [];
  if (!setlist.sets || !setlist.sets.set) return songs;
  // Default to the setlist.fm artist on the setlist if none was passed in
  var defaultArtist = artistName || (setlist.artist && setlist.artist.name) || '';
  var defaultMbid = artistMbid || (setlist.artist && setlist.artist.mbid) || '';
  setlist.sets.set.forEach(function(set) {
    if (set.song) {
      set.song.forEach(function(song) {
        if (song.name && !song.tape) {
          songs.push({
            name: song.name,
            cover: song.cover ? song.cover.name : null,
            artist: defaultArtist,
            mbid: defaultMbid
          });
        }
      });
    }
  });
  return songs;
}

/* ── SONG STATISTICS (Setlist.fm) ────── */

// Cache aggregated stats per artist mbid so we don't refetch on dedup toggles
var statsCache = {};

function fetchSetlistsPage(mbid, page) {
  var proxyUrl = SL_CONFIG.setlistProxyUrl + '?path=' + encodeURIComponent('/artist/' + mbid + '/setlists') + '&p=' + page;
  return fetch(proxyUrl).then(function(r) {
    if (!r.ok) return null;
    return r.json();
  }).catch(function() { return null; });
}

// Aggregate song stats from multiple pages of setlists.
// Default 5 pages = up to 100 recent shows — enough for meaningful stats
// without hammering the setlist.fm rate limit. We also capture `total`
// (lifetime setlist count from the API) so we can tell whether the
// fetched window covers the artist's full history.
function buildSongStats(mbid, pages) {
  if (!mbid) return Promise.resolve(null);
  if (statsCache[mbid]) return Promise.resolve(statsCache[mbid]);

  var pageCount = pages || 5;
  var promises = [];
  for (var p = 1; p <= pageCount; p++) promises.push(fetchSetlistsPage(mbid, p));

  return Promise.all(promises).then(function(pagesData) {
    var stats = {};
    var totalShows = 0;        // shows actually scanned (with songs)
    var lifetimeTotal = null;  // setlist.fm's reported total for this artist
    var itemsPerPage = 20;

    pagesData.forEach(function(data) {
      if (!data) return;
      if (lifetimeTotal === null && typeof data.total === 'number') {
        lifetimeTotal = data.total;
        if (typeof data.itemsPerPage === 'number' && data.itemsPerPage > 0) {
          itemsPerPage = data.itemsPerPage;
        }
      }
      if (!data.setlist) return;
      data.setlist.forEach(function(sl) {
        if (!sl.sets || !sl.sets.set) return;
        var hasSongs = sl.sets.set.some(function(set) { return set.song && set.song.length > 0; });
        if (!hasSongs) return;
        totalShows++;

        var date = sl.eventDate || ''; // dd-MM-yyyy
        var sortable = date.split('-').reverse().join('-'); // yyyy-MM-dd for comparison
        var venue = sl.venue ? sl.venue.name : '';
        var city = (sl.venue && sl.venue.city) ? sl.venue.city.name : '';
        var country = (sl.venue && sl.venue.city && sl.venue.city.country) ? sl.venue.city.country.code : '';
        var info = { date: date, sortable: sortable, venue: venue, city: city, country: country };

        sl.sets.set.forEach(function(set) {
          if (!set.song) return;
          set.song.forEach(function(song) {
            if (!song.name || song.tape) return;
            var key = normalizeSongName(song.name);
            if (!stats[key]) stats[key] = { name: song.name, count: 0, lastPlayed: null, firstPlayed: null };
            stats[key].count++;
            if (!stats[key].lastPlayed || sortable > stats[key].lastPlayed.sortable) stats[key].lastPlayed = info;
            if (!stats[key].firstPlayed || sortable < stats[key].firstPlayed.sortable) stats[key].firstPlayed = info;
          });
        });
      });
    });

    // Complete history = our fetched window covers every setlist the API has on file.
    // Fall back to false if the API didn't tell us a total.
    var complete = (lifetimeTotal !== null) && (lifetimeTotal <= pageCount * itemsPerPage);

    var result = {
      totalShows: totalShows,
      lifetimeTotal: lifetimeTotal,
      complete: complete,
      songs: stats
    };
    statsCache[mbid] = result;
    return result;
  });
}

// Walk every rendered song row and stamp it with stats data attributes
// so that the popover handler can read them on click/hover.
function applyStatsToRows(songs) {
  for (var i = 0; i < songs.length; i++) {
    var song = songs[i];
    var row = document.getElementById('slSong' + i);
    if (!row) continue;
    var btn = row.querySelector('.sl-stats-btn');
    if (!btn) continue;

    var bucket = song.mbid && statsCache[song.mbid];
    if (!bucket) {
      // Stats request still pending or failed — leave as loading
      continue;
    }

    var key = normalizeSongName(song.name);
    var entry = bucket.songs[key];
    btn.classList.remove('loading');
    btn.removeAttribute('disabled');
    btn.setAttribute('data-total-shows', bucket.totalShows);
    btn.setAttribute('data-complete', bucket.complete ? '1' : '0');
    if (bucket.lifetimeTotal !== null && bucket.lifetimeTotal !== undefined) {
      btn.setAttribute('data-lifetime-total', bucket.lifetimeTotal);
    }
    if (entry) {
      btn.setAttribute('data-count', entry.count);
      if (entry.lastPlayed) {
        btn.setAttribute('data-last-date', entry.lastPlayed.date);
        btn.setAttribute('data-last-venue', entry.lastPlayed.venue || '');
        btn.setAttribute('data-last-city', entry.lastPlayed.city || '');
        btn.setAttribute('data-last-country', entry.lastPlayed.country || '');
      }
      if (bucket.complete && entry.firstPlayed) {
        // Only expose first-played when our window covers the artist's full history
        btn.setAttribute('data-first-date', entry.firstPlayed.date);
        btn.setAttribute('data-first-venue', entry.firstPlayed.venue || '');
        btn.setAttribute('data-first-city', entry.firstPlayed.city || '');
      }
    } else {
      btn.setAttribute('data-count', '0');
    }
  }
}

function loadStatsForArtist(mbid, songs) {
  if (!mbid) return;
  buildSongStats(mbid).then(function() {
    applyStatsToRows(songs);
  });
}

function loadStatsForCombine(songs) {
  // Fetch each unique mbid once, then re-apply when each finishes
  var seen = {};
  songs.forEach(function(s) {
    if (s.mbid && !seen[s.mbid]) {
      seen[s.mbid] = true;
      buildSongStats(s.mbid).then(function() { applyStatsToRows(songs); });
    }
  });
}

function statsButtonHtml() {
  return '<button class="sl-stats-btn loading" type="button" aria-label="Show song statistics" disabled>'
    + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M3 3v18h18"/><rect x="7" y="13" width="3" height="5"/><rect x="12" y="9" width="3" height="9"/><rect x="17" y="5" width="3" height="13"/>'
    + '</svg>'
    + '</button>';
}

function formatStatDate(ddmmyyyy) {
  if (!ddmmyyyy) return '';
  var parts = ddmmyyyy.split('-');
  if (parts.length !== 3) return ddmmyyyy;
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[parseInt(parts[1], 10) - 1] + ' ' + parseInt(parts[0], 10) + ', ' + parts[2];
}

function buildStatsPopoverHtml(btn) {
  var totalShows = parseInt(btn.getAttribute('data-total-shows') || '0', 10);
  var count = parseInt(btn.getAttribute('data-count') || '0', 10);
  var complete = btn.getAttribute('data-complete') === '1';
  var lifetimeTotal = parseInt(btn.getAttribute('data-lifetime-total') || '0', 10);

  // Wording reflects whether we have full history or only a recent window
  var windowLabel = complete ? 'all ' + totalShows + ' shows' : 'last ' + totalShows + ' shows';
  var footer = complete
    ? 'Across all ' + totalShows + ' setlist.fm shows for this artist'
    : 'Sampled from the ' + totalShows + ' most recent setlist.fm shows'
      + (lifetimeTotal ? ' (of ' + lifetimeTotal + ' on file)' : '');

  if (totalShows === 0) {
    return '<div class="sl-stats-empty">No play history available on setlist.fm.</div>';
  }
  if (count === 0) {
    return '<div class="sl-stats-empty">Not played in the ' + windowLabel + '.</div>'
      + '<div class="sl-stats-foot">' + footer + '</div>';
  }

  var pct = Math.round((count / totalShows) * 100);
  var lastDate = btn.getAttribute('data-last-date');
  var lastVenue = btn.getAttribute('data-last-venue');
  var lastCity = btn.getAttribute('data-last-city');
  var firstDate = btn.getAttribute('data-first-date');
  var firstVenue = btn.getAttribute('data-first-venue');
  var firstCity = btn.getAttribute('data-first-city');

  var playedLabel = complete ? 'Times played' : 'Recent plays';
  var html = '<div class="sl-stats-row"><span class="sl-stats-label">' + playedLabel + '</span>'
    + '<span class="sl-stats-value">' + count + ' / ' + totalShows + ' shows <span class="sl-stats-pct">(' + pct + '%)</span></span></div>';

  if (lastDate) {
    var lastWhere = [lastVenue, lastCity].filter(Boolean).join(', ');
    html += '<div class="sl-stats-row"><span class="sl-stats-label">Last played</span>'
      + '<span class="sl-stats-value">' + escHtml(formatStatDate(lastDate))
      + (lastWhere ? '<br><span class="sl-stats-sub">' + escHtml(lastWhere) + '</span>' : '')
      + '</span></div>';
  }
  // First played is only honest when our window covers the artist's full history.
  // applyStatsToRows refuses to set data-first-date unless bucket.complete is true.
  if (firstDate && firstDate !== lastDate) {
    var firstWhere = [firstVenue, firstCity].filter(Boolean).join(', ');
    html += '<div class="sl-stats-row"><span class="sl-stats-label">First played</span>'
      + '<span class="sl-stats-value">' + escHtml(formatStatDate(firstDate))
      + (firstWhere ? '<br><span class="sl-stats-sub">' + escHtml(firstWhere) + '</span>' : '')
      + '</span></div>';
  }
  html += '<div class="sl-stats-foot">' + footer + '</div>';
  return html;
}

function showStatsPopover(btn) {
  hideStatsPopover();
  if (btn.classList.contains('loading') || btn.hasAttribute('disabled')) return;
  var popover = document.createElement('div');
  popover.className = 'sl-stats-tooltip show';
  popover.setAttribute('role', 'tooltip');
  popover.innerHTML = buildStatsPopoverHtml(btn);
  btn.appendChild(popover);
  btn.classList.add('open');
}

function hideStatsPopover() {
  var open = document.querySelectorAll('.sl-stats-btn.open');
  open.forEach(function(b) {
    b.classList.remove('open');
    var t = b.querySelector('.sl-stats-tooltip');
    if (t) t.remove();
  });
}

function toggleStatsPopover(btn) {
  if (btn.classList.contains('open')) {
    hideStatsPopover();
  } else {
    showStatsPopover(btn);
  }
}

/* ── SPOTIFY API ─────────────────────── */

// Strip parens / brackets / dashed suffixes that often break Spotify's
// strict "track:" filter even when the song exists on Spotify under a
// slightly different rendering (remasters, live versions, deluxe tags).
function cleanForSearch(name) {
  return String(name || '')
    .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '')   // drop "(...)" / "[...]"
    .replace(/\s*[-–—]\s*(remaster(ed)?|live|version|edit|mix|radio|demo|acoustic|deluxe|bonus).*/gi, '')
    .replace(/\s+\/\s+.*/, '')                  // drop " / second title"
    .replace(/\s+/g, ' ')
    .trim();
}

function spotifySearchOnce(query) {
  var token = getSpotifyToken();
  if (!token) return Promise.resolve(null);
  return fetch(SL_CONFIG.spotifyApiUrl + '/search?q=' + encodeURIComponent(query) + '&type=track&limit=3', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function(r) {
    if (!r.ok) return null;
    return r.json();
  })
  .then(function(data) {
    if (!data || !data.tracks || !data.tracks.items || data.tracks.items.length === 0) return null;
    return data.tracks.items[0];
  })
  .catch(function() { return null; });
}

function spotifySearch(songName, artistName) {
  // Try progressively looser queries until one returns a track.
  var cleaned = cleanForSearch(songName);
  var attempts = [
    'track:' + songName + ' artist:' + artistName,
    'track:' + cleaned + ' artist:' + artistName,
    cleaned + ' ' + artistName,
    songName + ' ' + artistName
  ];
  // De-dup attempts (cleaned can equal raw)
  var seen = {};
  attempts = attempts.filter(function(q) { if (seen[q]) return false; seen[q] = true; return true; });

  function tryNext(i) {
    if (i >= attempts.length) return Promise.resolve(null);
    return spotifySearchOnce(attempts[i]).then(function(track) {
      if (track) return track;
      return tryNext(i + 1);
    });
  }
  return tryNext(0);
}

function matchAllSongs(songs, fallbackArtistName) {
  // Sequential to respect rate limits
  var results = [];
  var index = 0;

  function next() {
    if (index >= songs.length) return Promise.resolve(results);
    var song = songs[index];
    // Prefer the cover artist (for cover songs) > the song's own tagged
    // artist (combine mode keeps each song's source artist) > caller fallback
    var searchArtist = song.cover || song.artist || fallbackArtistName;
    index++;
    return spotifySearch(song.name, searchArtist)
      .then(function(track) {
        results.push({ song: song, track: track });
        updateSongRow(index - 1, track);
        return next();
      });
  }

  return next();
}

function getSpotifyUserId() {
  var token = getSpotifyToken();
  return fetch(SL_CONFIG.spotifyApiUrl + '/me', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function(r) {
    if (!r.ok) {
      return r.text().then(function(body) {
        throw new Error('Spotify /me failed (' + r.status + '): ' + body);
      });
    }
    return r.json();
  })
  .then(function(data) { return data.id; });
}

function createPlaylist(userId, name, description) {
  var token = getSpotifyToken();
  return fetch('/api/spotify-proxy?endpoint=' + encodeURIComponent('/me/playlists'), {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: name,
      description: description,
      public: true
    })
  })
  .then(function(r) {
    if (!r.ok) {
      return r.text().then(function(body) {
        throw new Error('Spotify error (' + r.status + '): ' + body);
      });
    }
    return r.json();
  });
}

function addTracksToPlaylist(playlistId, uris) {
  var token = getSpotifyToken();
  // Spotify allows max 100 tracks per request
  var batches = [];
  for (var i = 0; i < uris.length; i += 100) {
    batches.push(uris.slice(i, i + 100));
  }

  // Use /items (the post-Feb-2026 endpoint). The legacy /tracks endpoint
  // returns 403 in Dev Mode for personal apps.
  function addBatch(idx) {
    if (idx >= batches.length) return Promise.resolve();
    var endpoint = '/playlists/' + playlistId + '/items';
    return fetch('/api/spotify-proxy?endpoint=' + encodeURIComponent(endpoint), {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ uris: batches[idx] })
    }).then(function(r) {
      if (!r.ok) {
        return r.text().then(function(body) {
          throw new Error('Failed to add tracks (' + r.status + '): ' + body);
        });
      }
      return addBatch(idx + 1);
    });
  }

  return addBatch(0);
}

/* ── APP STATE ───────────────────────── */

var appState = {
  mode: 'single',     // 'single' | 'combine'
  artist: null,       // { mbid, name, disambiguation }
  setlist: null,      // full setlist object from setlist.fm
  songs: [],          // extracted song list
  matched: [],        // [{ song, track }]
  combineSlots: []    // combine mode: [{id, artist, setlist, songs}]
};

/* ── UI HELPERS ──────────────────────── */

function showError(id, msg) {
  var el = document.getElementById(id);
  el.textContent = msg;
  el.style.display = 'block';
}

function hideError(id) {
  document.getElementById(id).style.display = 'none';
}

function showLoading(text) {
  document.getElementById('slLoadingText').textContent = text || 'Loading...';
  document.getElementById('slLoading').style.display = 'flex';
}

function hideLoading() {
  document.getElementById('slLoading').style.display = 'none';
}

function showStep(n) {
  for (var i = 1; i <= 4; i++) {
    document.getElementById('slStep' + i).style.display = (i === n) ? 'block' : 'none';
  }
  document.getElementById('slStartOver').style.display = (n > 1) ? 'block' : 'none';
}

/* ── RENDER: ARTIST RESULTS ──────────── */

function renderArtistResults(artists) {
  var el = document.getElementById('slArtistResults');
  if (artists.length === 0) {
    el.innerHTML = '<div class="sl-empty">No artists found. Try a different search.</div>';
    el.style.display = 'block';
    return;
  }

  var html = '';
  var shown = artists.slice(0, 8);
  for (var i = 0; i < shown.length; i++) {
    var a = shown[i];
    var dis = a.disambiguation ? ' <span class="sl-artist-dis">' + escHtml(a.disambiguation) + '</span>' : '';
    html += '<button class="sl-result-card" data-idx="' + i + '">'
      + '<span class="sl-result-name">' + escHtml(a.name) + dis + '</span>'
      + '</button>';
  }
  el.innerHTML = html;
  el.style.display = 'block';

  el.querySelectorAll('.sl-result-card').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(btn.getAttribute('data-idx'), 10);
      selectArtist(shown[idx]);
    });
  });
}

/* ── RENDER: SETLIST RESULTS ─────────── */

function renderSetlistResults(setlists) {
  var el = document.getElementById('slSetlistResults');
  if (setlists.length === 0) {
    el.innerHTML = '<div class="sl-empty">No setlists with songs found for this artist.</div>';
    return;
  }

  var html = '';
  var shown = setlists.slice(0, 12);
  for (var i = 0; i < shown.length; i++) {
    var s = shown[i];
    var date = formatSetlistDate(s.eventDate);
    var venue = s.venue ? s.venue.name : 'Unknown venue';
    var city = (s.venue && s.venue.city) ? s.venue.city.name : '';
    var country = (s.venue && s.venue.city && s.venue.city.country) ? s.venue.city.country.code : '';
    var songCount = 0;
    if (s.sets && s.sets.set) {
      s.sets.set.forEach(function(set) { if (set.song) songCount += set.song.length; });
    }
    var locationStr = city + (country ? ', ' + country : '');

    html += '<button class="sl-result-card sl-setlist-card" data-idx="' + i + '">'
      + '<div class="sl-setlist-date">' + escHtml(date) + '</div>'
      + '<div class="sl-setlist-venue">' + escHtml(venue) + '</div>'
      + '<div class="sl-setlist-location">' + escHtml(locationStr) + '</div>'
      + '<div class="sl-setlist-count">' + songCount + ' songs</div>'
      + '</button>';
  }
  el.innerHTML = html;

  el.querySelectorAll('.sl-setlist-card').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(btn.getAttribute('data-idx'), 10);
      selectSetlist(shown[idx]);
    });
  });
}

function formatSetlistDate(dateStr) {
  // setlist.fm uses dd-MM-yyyy
  var parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var m = parseInt(parts[1], 10) - 1;
  return months[m] + ' ' + parseInt(parts[0], 10) + ', ' + parts[2];
}

/* ── RENDER: SONG LIST ───────────────── */

function renderSongList(songs) {
  var el = document.getElementById('slSongList');
  var html = '';
  for (var i = 0; i < songs.length; i++) {
    var song = songs[i];
    var coverNote = song.cover ? ' <span class="sl-song-cover">' + escHtml(song.cover) + ' cover</span>' : '';
    html += '<div class="sl-song-row" id="slSong' + i + '">'
      + '<span class="sl-song-status">&#8987;</span>'
      + '<span class="sl-song-name">' + escHtml(song.name) + coverNote + '</span>'
      + statsButtonHtml()
      + '</div>';
  }
  el.innerHTML = html;
}

function updateSongRow(idx, track) {
  var row = document.getElementById('slSong' + idx);
  if (!row) return;
  var statusEl = row.querySelector('.sl-song-status');
  if (track) {
    statusEl.innerHTML = '&#10003;';
    statusEl.className = 'sl-song-status matched';
  } else {
    statusEl.innerHTML = '&#10007;';
    statusEl.className = 'sl-song-status unmatched';
  }
}

function renderMatchSummary(matched) {
  var found = matched.filter(function(m) { return m.track !== null; }).length;
  var total = matched.length;
  var el = document.getElementById('slMatchSummary');
  el.innerHTML = '<span class="sl-match-found">' + found + '</span> of '
    + '<span class="sl-match-total">' + total + '</span> songs matched on Spotify';
  if (found === 0) {
    document.getElementById('slCreateBtn').disabled = true;
  }
}

/* ── APP ACTIONS ─────────────────────── */

function selectArtist(artist) {
  appState.artist = artist;
  document.getElementById('slArtistChosen').innerHTML =
    '<span class="sl-chosen-name">' + escHtml(artist.name) + '</span>'
    + '<button class="sl-btn sl-btn-ghost sl-btn-sm" id="slChangeArtist">Change</button>';
  document.getElementById('slChangeArtist').addEventListener('click', function() {
    appState.artist = null;
    appState.setlist = null;
    appState.songs = [];
    appState.matched = [];
    showStep(1);
  });

  showStep(2);
  hideError('slSetlistError');
  showLoading('Finding setlists...');

  getArtistSetlists(artist.mbid)
    .then(function(setlists) {
      hideLoading();
      renderSetlistResults(setlists);
    })
    .catch(function(err) {
      hideLoading();
      showError('slSetlistError', err.message);
    });
}

function selectSetlist(setlist) {
  appState.setlist = setlist;
  appState.songs = extractSongs(setlist, appState.artist && appState.artist.name, appState.artist && appState.artist.mbid);

  var date = formatSetlistDate(setlist.eventDate);
  var venue = setlist.venue ? setlist.venue.name : 'Unknown venue';
  var city = (setlist.venue && setlist.venue.city) ? setlist.venue.city.name : '';
  document.getElementById('slSetlistInfo').innerHTML =
    '<div class="sl-setlist-info-header">'
    + '<strong>' + escHtml(appState.artist.name) + '</strong>'
    + '<span class="sl-setlist-info-date">' + escHtml(date) + '</span>'
    + '</div>'
    + '<div class="sl-setlist-info-venue">' + escHtml(venue) + (city ? ', ' + escHtml(city) : '') + '</div>';

  showStep(3);
  hideError('slCreateError');
  document.getElementById('slDedupRow').style.display = 'none';
  renderSongList(appState.songs);
  loadStatsForArtist(appState.artist && appState.artist.mbid, appState.songs);

  // If we have a Spotify token, match songs immediately
  var token = getSpotifyToken();
  if (token) {
    showLoading('Matching songs on Spotify...');
    matchAllSongs(appState.songs, appState.artist.name)
      .then(function(results) {
        appState.matched = results;
        hideLoading();
        renderMatchSummary(results);
      });
  } else {
    document.getElementById('slMatchSummary').innerHTML =
      '<span class="sl-match-note">Connect to Spotify to match songs and create a playlist</span>';
  }
}

function doCreatePlaylist() {
  var token = getSpotifyToken();
  if (!token) {
    startSpotifyAuth();
    return;
  }

  var uris = appState.matched
    .filter(function(m) { return m.track !== null; })
    .map(function(m) { return m.track.uri; });

  if (uris.length === 0) {
    showError('slCreateError', 'No songs were matched on Spotify.');
    return;
  }

  hideError('slCreateError');
  showLoading('Creating playlist...');

  var playlistName, description;
  if (appState.mode === 'combine' && appState.combineSlots.length > 0) {
    var artistNames = appState.combineSlots.map(function(s) { return s.artist.name; });
    var firstDate = formatSetlistDate(appState.combineSlots[0].setlist.eventDate);
    playlistName = artistNames.join(' & ') + ' — ' + firstDate;
    description = 'Combined setlist: ' + appState.combineSlots.map(function(s) {
      return s.artist.name + ' (' + formatSetlistDate(s.setlist.eventDate) + ')';
    }).join(', ') + '. Built with Setlist to Spotify (Alan\'s Brain).';
  } else {
    var date = formatSetlistDate(appState.setlist.eventDate);
    var venue = appState.setlist.venue ? appState.setlist.venue.name : '';
    playlistName = appState.artist.name + ' — ' + date;
    description = 'Setlist from ' + venue + ' on ' + date + '. Built with Setlist to Spotify (Alan\'s Brain).';
  }

  getSpotifyUserId()
    .then(function(userId) {
      return createPlaylist(userId, playlistName, description);
    })
    .then(function(playlist) {
      return addTracksToPlaylist(playlist.id, uris)
        .then(function() {
          // Tracks added successfully
          hideLoading();
          showStep(4);
          var matched = appState.matched.filter(function(m) { return m.track; }).length;
          document.getElementById('slSuccess').innerHTML =
            '<div class="sl-success-icon">&#10003;</div>'
            + '<div class="sl-success-title">Playlist Created!</div>'
            + '<div class="sl-success-detail">'
              + '<strong>' + escHtml(playlistName) + '</strong><br>'
              + matched + ' tracks added'
            + '</div>'
            + '<a class="sl-btn sl-btn-spotify" href="' + playlist.external_urls.spotify + '" target="_blank" rel="noopener">'
              + '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-right:6px"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>'
              + 'Open in Spotify'
            + '</a>';
        })
        .catch(function() {
          // Track addition blocked (Spotify Dev Mode restriction) — show fallback
          hideLoading();
          showStep(4);
          var trackLinks = appState.matched
            .filter(function(m) { return m.track; })
            .map(function(m) {
              return m.track.external_urls.spotify;
            });
          var searchLinks = appState.matched
            .filter(function(m) { return m.track; })
            .map(function(m) {
              return m.song.name + ' — ' + (m.song.cover || appState.artist.name);
            });
          var copyText = searchLinks.join('\n');

          document.getElementById('slSuccess').innerHTML =
            '<div class="sl-success-icon" style="color:var(--yellow)">&#9888;</div>'
            + '<div class="sl-success-title">Playlist Created (Empty)</div>'
            + '<div class="sl-success-detail">'
              + '<strong>' + escHtml(playlistName) + '</strong><br>'
              + 'Spotify\'s Development Mode blocked adding tracks automatically.<br>'
              + 'Use the links below to add them manually.'
            + '</div>'
            + '<a class="sl-btn sl-btn-spotify" href="' + playlist.external_urls.spotify + '" target="_blank" rel="noopener">'
              + '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-right:6px"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>'
              + 'Open Playlist in Spotify'
            + '</a>'
            + '<div class="sl-track-links">'
              + '<div class="sl-track-links-header">'
                + '<strong>Matched tracks (' + trackLinks.length + ')</strong>'
                + '<button class="sl-btn sl-btn-ghost sl-btn-sm" id="slCopyTracks">Copy list</button>'
              + '</div>'
              + '<div class="sl-track-links-list">'
                + trackLinks.map(function(url, i) {
                    return '<a href="' + escHtml(url) + '" target="_blank" rel="noopener" class="sl-track-link">'
                      + escHtml(searchLinks[i]) + '</a>';
                  }).join('')
              + '</div>'
            + '</div>';

          document.getElementById('slCopyTracks').addEventListener('click', function() {
            navigator.clipboard.writeText(copyText).then(function() {
              document.getElementById('slCopyTracks').textContent = 'Copied!';
            });
          });
        });
    })
    .catch(function(err) {
      hideLoading();
      showError('slCreateError', err.message);
    });
}

function resetApp() {
  var mode = appState.mode;
  appState = { mode: mode, artist: null, setlist: null, songs: [], matched: [], combineSlots: [] };
  showStep(1);
  if (mode === 'single') {
    document.getElementById('slArtistInput').value = '';
    document.getElementById('slArtistResults').style.display = 'none';
    hideError('slSearchError');
  } else {
    initCombineSlots();
    hideError('slCombineError');
  }
  hideError('slSetlistError');
  hideError('slCreateError');
  document.getElementById('slCreateBtn').disabled = false;
}

/* ── INIT ──────────────────────────────── */

function initSetlistApp() {
  // Load saved keys (or defaults) into setup fields
  var keyField = document.getElementById('slSetlistKey');
  var idField = document.getElementById('slSpotifyId');
  keyField.value = getSetlistKey();
  idField.value = getSpotifyClientId();
  // Auto-save defaults if nothing stored yet
  if (!localStorage.getItem('ab_setlist_key') && SL_CONFIG.defaultSetlistKey) {
    localStorage.setItem('ab_setlist_key', SL_CONFIG.defaultSetlistKey);
  }
  if (!localStorage.getItem('ab_spotify_client_id') && SL_CONFIG.defaultSpotifyClientId) {
    localStorage.setItem('ab_spotify_client_id', SL_CONFIG.defaultSpotifyClientId);
  }
  updateKeysStatus();

  // Save keys button
  document.getElementById('slSaveKeysBtn').addEventListener('click', function() {
    localStorage.setItem('ab_setlist_key', keyField.value.trim());
    localStorage.setItem('ab_spotify_client_id', idField.value.trim());
    updateKeysStatus();
  });

  // Search button
  document.getElementById('slSearchBtn').addEventListener('click', doSearch);
  document.getElementById('slArtistInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doSearch();
  });

  // Create playlist button
  document.getElementById('slCreateBtn').addEventListener('click', doCreatePlaylist);

  // Reset button
  document.getElementById('slResetBtn').addEventListener('click', resetApp);

  // Combine mode actions
  document.getElementById('slAddSlotBtn').addEventListener('click', function() {
    if (appState.combineSlots.length < 5) {
      appState.combineSlots.push(makeCombineSlot());
      renderCombineSlots();
    }
  });
  document.getElementById('slCombineReviewBtn').addEventListener('click', doCombineReview);

  // Dedup checkbox rebuilds song list on change
  document.getElementById('slDedupCheck').addEventListener('change', function() {
    if (appState.mode === 'combine') {
      var dedup = this.checked;
      var groups = buildCombinedSongs(dedup);
      appState.songs = [];
      groups.forEach(function(g) { appState.songs = appState.songs.concat(g.songs); });
      var songListEl = document.getElementById('slSongList');
      var html = '';
      var globalIdx = 0;
      groups.forEach(function(group) {
        html += '<div class="sl-group-header">' + escHtml(group.label) + '</div>';
        group.songs.forEach(function(song) {
          var coverNote = song.cover ? ' <span class="sl-song-cover">' + escHtml(song.cover) + ' cover</span>' : '';
          html += '<div class="sl-song-row" id="slSong' + globalIdx + '">'
            + '<span class="sl-song-status">&#8987;</span>'
            + '<span class="sl-song-name">' + escHtml(song.name) + coverNote + '</span>'
            + statsButtonHtml()
            + '</div>';
          globalIdx++;
        });
      });
      songListEl.innerHTML = html;
      loadStatsForCombine(appState.songs);
      appState.matched = [];
      document.getElementById('slMatchSummary').innerHTML = '';
      var token = getSpotifyToken();
      if (token) {
        showLoading('Matching songs on Spotify...');
        matchAllSongs(appState.songs, appState.combineSlots[0].artist.name)
          .then(function(results) {
            appState.matched = results;
            hideLoading();
            renderMatchSummary(results);
          });
      }
    }
  });

  // Mode toggle
  document.getElementById('slModeSingle').addEventListener('click', function() { setMode('single'); });
  document.getElementById('slModeCombine').addEventListener('click', function() { setMode('combine'); });

  // Stats popover: click toggles, outside-click and Escape close it.
  // Desktop also gets hover-to-preview on the song list.
  var songListEl = document.getElementById('slSongList');
  if (songListEl) {
    songListEl.addEventListener('click', function(e) {
      // Clicks inside the open popover shouldn't toggle it closed
      if (e.target.closest('.sl-stats-tooltip')) {
        e.stopPropagation();
        return;
      }
      var btn = e.target.closest('.sl-stats-btn');
      if (!btn) return;
      e.stopPropagation();
      toggleStatsPopover(btn);
    });
    var hoverSupported = window.matchMedia && window.matchMedia('(hover: hover)').matches;
    if (hoverSupported) {
      songListEl.addEventListener('mouseover', function(e) {
        var btn = e.target.closest && e.target.closest('.sl-stats-btn');
        if (btn && !btn.classList.contains('open')) showStatsPopover(btn);
      });
      songListEl.addEventListener('mouseout', function(e) {
        var btn = e.target.closest && e.target.closest('.sl-stats-btn');
        if (!btn) return;
        var to = e.relatedTarget;
        if (to && btn.contains(to)) return; // moved within button/popover
        hideStatsPopover();
      });
    }
  }
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.sl-stats-btn')) hideStatsPopover();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') hideStatsPopover();
  });

  // Handle OAuth callback
  var params = new URLSearchParams(window.location.search);
  if (params.has('code') || params.has('error')) {
    handleOAuthCallback().then(function(success) {
      if (success) {
        // Restore app state from before the redirect
        var saved = sessionStorage.getItem('sl_pending_state');
        if (saved) {
          try {
            var restored = JSON.parse(saved);
            appState = restored;
            sessionStorage.removeItem('sl_pending_state');
            if (appState.mode === 'combine') {
              setMode('combine');
              rebuildAndCreateCombine();
            } else if (appState.setlist && appState.songs.length > 0) {
              rebuildAndCreate();
            }
          } catch (e) { /* ignore */ }
        }
      }
    });
  }
}

function rebuildAndCreate() {
  // Rebuild the UI to step 3 without triggering a duplicate match
  // (selectSetlist would also start matching if a token exists)
  appState.songs = extractSongs(appState.setlist, appState.artist && appState.artist.name, appState.artist && appState.artist.mbid);

  var date = formatSetlistDate(appState.setlist.eventDate);
  var venue = appState.setlist.venue ? appState.setlist.venue.name : 'Unknown venue';
  var city = (appState.setlist.venue && appState.setlist.venue.city) ? appState.setlist.venue.city.name : '';
  document.getElementById('slSetlistInfo').innerHTML =
    '<div class="sl-setlist-info-header">'
    + '<strong>' + escHtml(appState.artist.name) + '</strong>'
    + '<span class="sl-setlist-info-date">' + escHtml(date) + '</span>'
    + '</div>'
    + '<div class="sl-setlist-info-venue">' + escHtml(venue) + (city ? ', ' + escHtml(city) : '') + '</div>';

  showStep(3);
  hideError('slCreateError');
  renderSongList(appState.songs);
  loadStatsForArtist(appState.artist && appState.artist.mbid, appState.songs);

  showLoading('Matching songs on Spotify...');
  matchAllSongs(appState.songs, appState.artist.name)
    .then(function(results) {
      appState.matched = results;
      hideLoading();
      renderMatchSummary(results);
      doCreatePlaylist();
    });
}

function doSearch() {
  var query = document.getElementById('slArtistInput').value.trim();
  if (!query) return;

  hideError('slSearchError');
  document.getElementById('slArtistResults').style.display = 'none';

  // Check if the input is a setlist.fm URL
  var setlistId = parseSetlistUrl(query);
  if (setlistId) {
    showLoading('Fetching setlist...');
    fetchSetlistById(setlistId)
      .then(function(setlist) {
        hideLoading();
        // Extract artist info from the setlist
        var artist = setlist.artist || {};
        appState.artist = {
          mbid: artist.mbid || '',
          name: artist.name || 'Unknown Artist',
          disambiguation: artist.disambiguation || ''
        };
        // Jump straight to the song review
        selectSetlist(setlist);
      })
      .catch(function(err) {
        hideLoading();
        showError('slSearchError', err.message);
      });
    return;
  }

  showLoading('Searching artists...');

  searchArtists(query)
    .then(function(artists) {
      hideLoading();
      renderArtistResults(artists);
    })
    .catch(function(err) {
      hideLoading();
      showError('slSearchError', err.message);
    });
}

/* ── COMBINE MODE ────────────────────── */

function setMode(mode) {
  appState.mode = mode;
  document.getElementById('slModeSingle').classList.toggle('active', mode === 'single');
  document.getElementById('slModeCombine').classList.toggle('active', mode === 'combine');
  document.getElementById('slSingleMode').style.display = mode === 'single' ? 'block' : 'none';
  document.getElementById('slCombineMode').style.display = mode === 'combine' ? 'block' : 'none';
  if (mode === 'combine' && appState.combineSlots.length === 0) {
    initCombineSlots();
  }
  showStep(1);
}

function initCombineSlots() {
  appState.combineSlots = [];
  // Start with 2 empty slots
  appState.combineSlots.push(makeCombineSlot());
  appState.combineSlots.push(makeCombineSlot());
  renderCombineSlots();
}

function makeCombineSlot() {
  return { id: Date.now() + Math.random(), phase: 'search', query: '', artistResults: [], setlistResults: [], artist: null, setlist: null, songs: [] };
}

function renderCombineSlots() {
  var container = document.getElementById('slCombineSlots');
  var html = '';
  appState.combineSlots.forEach(function(slot, idx) {
    html += '<div class="sl-slot" id="slSlot_' + slot.id + '">';
    html += '<div class="sl-slot-header">';
    html += '<span class="sl-slot-label">Setlist ' + (idx + 1) + '</span>';
    if (appState.combineSlots.length > 2) {
      html += '<button class="sl-slot-remove" data-slot-remove="' + slot.id + '">Remove</button>';
    }
    html += '</div>';

    if (slot.phase === 'done') {
      var date = formatSetlistDate(slot.setlist.eventDate);
      var venue = slot.setlist.venue ? slot.setlist.venue.name : '';
      var city = (slot.setlist.venue && slot.setlist.venue.city) ? slot.setlist.venue.city.name : '';
      html += '<div class="sl-slot-confirmed">';
      html += '<div class="sl-slot-confirmed-info">';
      html += '<strong>' + escHtml(slot.artist.name) + '</strong>';
      html += '<div class="sl-slot-confirmed-meta">' + escHtml(date) + (venue ? ' &mdash; ' + escHtml(venue) : '') + (city ? ', ' + escHtml(city) : '') + '</div>';
      html += '</div>';
      html += '<button class="sl-btn sl-btn-ghost sl-btn-sm" data-slot-change="' + slot.id + '">Change</button>';
      html += '</div>';
    } else if (slot.phase === 'picking-setlists') {
      html += '<div class="sl-step-label" style="font-size:0.72rem;margin-bottom:8px">Pick a setlist for ' + escHtml(slot.artist.name) + '</div>';
      html += renderCombineSetlistList(slot);
    } else if (slot.phase === 'picking-artists') {
      html += '<div class="sl-search-row">';
      html += '<input type="text" class="sl-input" data-slot-input="' + slot.id + '" value="' + escHtml(slot.query) + '" placeholder="Artist name or setlist.fm URL..." autocomplete="off" spellcheck="false">';
      html += '<button class="sl-btn sl-btn-primary" data-slot-search="' + slot.id + '">Search</button>';
      html += '</div>';
      html += renderCombineArtistList(slot);
    } else {
      html += '<div class="sl-search-row">';
      html += '<input type="text" class="sl-input" data-slot-input="' + slot.id + '" value="' + escHtml(slot.query) + '" placeholder="Artist name or setlist.fm URL..." autocomplete="off" spellcheck="false">';
      html += '<button class="sl-btn sl-btn-primary" data-slot-search="' + slot.id + '">Search</button>';
      html += '</div>';
    }

    html += '</div>';
  });
  container.innerHTML = html;

  // Update action buttons
  var doneCount = appState.combineSlots.filter(function(s) { return s.phase === 'done'; }).length;
  document.getElementById('slCombineReviewBtn').disabled = doneCount < 2;
  document.getElementById('slAddSlotBtn').style.display = appState.combineSlots.length >= 5 ? 'none' : '';

  // Wire up event delegation on container
  container.onclick = null;
  container.addEventListener('click', handleCombineClick);
  container.querySelectorAll('input[data-slot-input]').forEach(function(input) {
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        var slotId = input.getAttribute('data-slot-input');
        doCombineSearch(parseFloat(slotId));
      }
    });
  });
}

function renderCombineArtistList(slot) {
  if (!slot.artistResults || slot.artistResults.length === 0) return '';
  var html = '<div class="sl-results" style="margin-top:8px">';
  slot.artistResults.slice(0, 8).forEach(function(a, i) {
    var dis = a.disambiguation ? ' <span class="sl-artist-dis">' + escHtml(a.disambiguation) + '</span>' : '';
    html += '<button class="sl-result-card" data-slot-artist="' + slot.id + '" data-artist-idx="' + i + '">'
      + '<span class="sl-result-name">' + escHtml(a.name) + dis + '</span>'
      + '</button>';
  });
  html += '</div>';
  return html;
}

function renderCombineSetlistList(slot) {
  if (!slot.setlistResults || slot.setlistResults.length === 0) {
    return '<div class="sl-empty">No setlists found for this artist.</div>';
  }
  var html = '<div class="sl-results" style="margin-top:8px">';
  slot.setlistResults.slice(0, 10).forEach(function(s, i) {
    var date = formatSetlistDate(s.eventDate);
    var venue = s.venue ? s.venue.name : 'Unknown venue';
    var city = (s.venue && s.venue.city) ? s.venue.city.name : '';
    var country = (s.venue && s.venue.city && s.venue.city.country) ? s.venue.city.country.code : '';
    var locationStr = city + (country ? ', ' + country : '');
    var songCount = 0;
    if (s.sets && s.sets.set) s.sets.set.forEach(function(set) { if (set.song) songCount += set.song.length; });
    html += '<button class="sl-result-card sl-setlist-card" data-slot-setlist="' + slot.id + '" data-setlist-idx="' + i + '">'
      + '<div class="sl-setlist-date">' + escHtml(date) + '</div>'
      + '<div class="sl-setlist-venue">' + escHtml(venue) + '</div>'
      + '<div class="sl-setlist-location">' + escHtml(locationStr) + '</div>'
      + '<div class="sl-setlist-count">' + songCount + ' songs</div>'
      + '</button>';
  });
  html += '</div>';
  return html;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function handleCombineClick(e) {
  var removeBtn = e.target.closest('[data-slot-remove]');
  if (removeBtn) {
    var id = parseFloat(removeBtn.getAttribute('data-slot-remove'));
    appState.combineSlots = appState.combineSlots.filter(function(s) { return s.id !== id; });
    renderCombineSlots();
    return;
  }
  var changeBtn = e.target.closest('[data-slot-change]');
  if (changeBtn) {
    var id = parseFloat(changeBtn.getAttribute('data-slot-change'));
    var slot = appState.combineSlots.find(function(s) { return s.id === id; });
    if (slot) { slot.phase = 'search'; slot.artist = null; slot.setlist = null; slot.songs = []; slot.artistResults = []; slot.setlistResults = []; }
    renderCombineSlots();
    return;
  }
  var searchBtn = e.target.closest('[data-slot-search]');
  if (searchBtn) {
    var id = parseFloat(searchBtn.getAttribute('data-slot-search'));
    doCombineSearch(id);
    return;
  }
  var artistBtn = e.target.closest('[data-slot-artist]');
  if (artistBtn) {
    var id = parseFloat(artistBtn.getAttribute('data-slot-artist'));
    var idx = parseInt(artistBtn.getAttribute('data-artist-idx'), 10);
    var slot = appState.combineSlots.find(function(s) { return s.id === id; });
    if (slot) selectCombineArtist(slot, slot.artistResults[idx]);
    return;
  }
  var setlistBtn = e.target.closest('[data-slot-setlist]');
  if (setlistBtn) {
    var id = parseFloat(setlistBtn.getAttribute('data-slot-setlist'));
    var idx = parseInt(setlistBtn.getAttribute('data-setlist-idx'), 10);
    var slot = appState.combineSlots.find(function(s) { return s.id === id; });
    if (slot) selectCombineSetlist(slot, slot.setlistResults[idx]);
    return;
  }
}

function doCombineSearch(slotId) {
  var slot = appState.combineSlots.find(function(s) { return s.id === slotId; });
  if (!slot) return;
  var inputEl = document.querySelector('[data-slot-input="' + slotId + '"]');
  var query = inputEl ? inputEl.value.trim() : slot.query;
  if (!query) return;
  slot.query = query;
  hideError('slCombineError');

  var setlistId = parseSetlistUrl(query);
  if (setlistId) {
    showLoading('Fetching setlist...');
    fetchSetlistById(setlistId)
      .then(function(setlist) {
        hideLoading();
        var a = setlist.artist || {};
        slot.artist = { mbid: a.mbid || '', name: a.name || 'Unknown Artist', disambiguation: '' };
        selectCombineSetlist(slot, setlist);
      })
      .catch(function(err) { hideLoading(); showError('slCombineError', err.message); });
    return;
  }

  showLoading('Searching...');
  searchArtists(query)
    .then(function(artists) {
      hideLoading();
      slot.artistResults = artists;
      slot.phase = 'picking-artists';
      renderCombineSlots();
    })
    .catch(function(err) { hideLoading(); showError('slCombineError', err.message); });
}

function selectCombineArtist(slot, artist) {
  slot.artist = artist;
  slot.phase = 'picking-setlists';
  showLoading('Finding setlists...');
  getArtistSetlists(artist.mbid)
    .then(function(setlists) {
      hideLoading();
      slot.setlistResults = setlists;
      renderCombineSlots();
    })
    .catch(function(err) { hideLoading(); showError('slCombineError', err.message); });
}

function selectCombineSetlist(slot, setlist) {
  slot.setlist = setlist;
  slot.songs = extractSongs(setlist, slot.artist && slot.artist.name, slot.artist && slot.artist.mbid);
  slot.phase = 'done';
  renderCombineSlots();
}

function normalizeSongName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildCombinedSongs(dedup) {
  var allGroups = appState.combineSlots.map(function(slot) {
    return { label: slot.artist.name + ' — ' + formatSetlistDate(slot.setlist.eventDate), songs: slot.songs };
  });
  if (!dedup) return allGroups;
  var seen = {};
  return allGroups.map(function(group) {
    return {
      label: group.label,
      songs: group.songs.filter(function(song) {
        var key = normalizeSongName(song.name);
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      })
    };
  });
}

function doCombineReview() {
  var doneSlots = appState.combineSlots.filter(function(s) { return s.phase === 'done'; });
  if (doneSlots.length < 2) {
    showError('slCombineError', 'Please select at least 2 setlists.');
    return;
  }
  hideError('slCombineError');

  var dedup = document.getElementById('slDedupCheck') ? document.getElementById('slDedupCheck').checked : true;
  var groups = buildCombinedSongs(dedup);

  appState.songs = [];
  groups.forEach(function(g) { appState.songs = appState.songs.concat(g.songs); });

  // Build header info for step 3
  var infoHtml = '<div class="sl-setlist-info-header"><strong>Combined Setlist</strong></div>'
    + '<div class="sl-setlist-info-venue">' + doneSlots.map(function(s) { return escHtml(s.artist.name); }).join(' &amp; ') + '</div>';
  document.getElementById('slSetlistInfo').innerHTML = infoHtml;

  // Show dedup toggle
  document.getElementById('slDedupRow').style.display = 'flex';
  document.getElementById('slDedupCheck').checked = dedup;

  // Render song list with group headers
  var songListEl = document.getElementById('slSongList');
  var html = '';
  var globalIdx = 0;
  groups.forEach(function(group) {
    html += '<div class="sl-group-header">' + escHtml(group.label) + '</div>';
    group.songs.forEach(function(song) {
      var coverNote = song.cover ? ' <span class="sl-song-cover">' + escHtml(song.cover) + ' cover</span>' : '';
      html += '<div class="sl-song-row" id="slSong' + globalIdx + '">'
        + '<span class="sl-song-status">&#8987;</span>'
        + '<span class="sl-song-name">' + escHtml(song.name) + coverNote + '</span>'
        + statsButtonHtml()
        + '</div>';
      globalIdx++;
    });
  });
  songListEl.innerHTML = html;
  loadStatsForCombine(appState.songs);

  showStep(3);
  hideError('slCreateError');

  var token = getSpotifyToken();
  var primaryArtistName = doneSlots[0].artist.name;
  if (token) {
    showLoading('Matching songs on Spotify...');
    matchAllSongs(appState.songs, primaryArtistName)
      .then(function(results) {
        appState.matched = results;
        hideLoading();
        renderMatchSummary(results);
      });
  } else {
    document.getElementById('slMatchSummary').innerHTML =
      '<span class="sl-match-note">Connect to Spotify to match songs and create a playlist</span>';
  }
}

function rebuildAndCreateCombine() {
  // After OAuth redirect, rebuild combine review and create playlist
  var doneSlots = appState.combineSlots.filter(function(s) { return s.phase === 'done'; });
  if (doneSlots.length < 2 || appState.songs.length === 0) return;

  var infoHtml = '<div class="sl-setlist-info-header"><strong>Combined Setlist</strong></div>'
    + '<div class="sl-setlist-info-venue">' + doneSlots.map(function(s) { return escHtml(s.artist.name); }).join(' &amp; ') + '</div>';
  document.getElementById('slSetlistInfo').innerHTML = infoHtml;

  document.getElementById('slDedupRow').style.display = 'flex';
  renderSongList(appState.songs);
  loadStatsForCombine(appState.songs);
  showStep(3);
  hideError('slCreateError');

  showLoading('Matching songs on Spotify...');
  matchAllSongs(appState.songs, doneSlots[0].artist.name)
    .then(function(results) {
      appState.matched = results;
      hideLoading();
      renderMatchSummary(results);
      doCreatePlaylist();
    });
}

function updateKeysStatus() {
  var el = document.getElementById('slKeysStatus');
  var hasSetlist = !!getSetlistKey();
  var hasSpotify = !!getSpotifyClientId();
  if (hasSetlist && hasSpotify) {
    el.innerHTML = '&#10003; Both keys saved';
    el.className = 'sl-setup-status saved';
  } else if (hasSetlist || hasSpotify) {
    el.textContent = 'Missing ' + (!hasSetlist ? 'Setlist.fm key' : 'Spotify Client ID');
    el.className = 'sl-setup-status partial';
  } else {
    el.textContent = 'No keys saved yet';
    el.className = 'sl-setup-status';
  }
}
