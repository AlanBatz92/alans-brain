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
      code_challenge: challenge
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

function extractSongs(setlist) {
  var songs = [];
  if (!setlist.sets || !setlist.sets.set) return songs;
  setlist.sets.set.forEach(function(set) {
    if (set.song) {
      set.song.forEach(function(song) {
        if (song.name && !song.tape) {
          songs.push({
            name: song.name,
            cover: song.cover ? song.cover.name : null
          });
        }
      });
    }
  });
  return songs;
}

/* ── SPOTIFY API ─────────────────────── */

function spotifySearch(songName, artistName) {
  var token = getSpotifyToken();
  if (!token) return Promise.resolve(null);

  var query = 'track:' + songName + ' artist:' + artistName;
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

function matchAllSongs(songs, artistName) {
  // Sequential to respect rate limits
  var results = [];
  var index = 0;

  function next() {
    if (index >= songs.length) return Promise.resolve(results);
    var song = songs[index];
    var searchArtist = song.cover || artistName;
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
    if (!r.ok) throw new Error('Could not get Spotify user');
    return r.json();
  })
  .then(function(data) { return data.id; });
}

function createPlaylist(userId, name, description) {
  var token = getSpotifyToken();
  return fetch(SL_CONFIG.spotifyApiUrl + '/users/' + userId + '/playlists', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: name,
      description: description,
      public: false
    })
  })
  .then(function(r) {
    if (!r.ok) throw new Error('Could not create playlist');
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

  function addBatch(idx) {
    if (idx >= batches.length) return Promise.resolve();
    return fetch(SL_CONFIG.spotifyApiUrl + '/playlists/' + playlistId + '/tracks', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ uris: batches[idx] })
    }).then(function() { return addBatch(idx + 1); });
  }

  return addBatch(0);
}

/* ── APP STATE ───────────────────────── */

var appState = {
  artist: null,       // { mbid, name, disambiguation }
  setlist: null,      // full setlist object from setlist.fm
  songs: [],          // extracted song list
  matched: []         // [{ song, track }]
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
    var dis = a.disambiguation ? ' <span class="sl-artist-dis">' + a.disambiguation + '</span>' : '';
    html += '<button class="sl-result-card" data-idx="' + i + '">'
      + '<span class="sl-result-name">' + a.name + dis + '</span>'
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
      + '<div class="sl-setlist-date">' + date + '</div>'
      + '<div class="sl-setlist-venue">' + venue + '</div>'
      + '<div class="sl-setlist-location">' + locationStr + '</div>'
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
    var coverNote = song.cover ? ' <span class="sl-song-cover">' + song.cover + ' cover</span>' : '';
    html += '<div class="sl-song-row" id="slSong' + i + '">'
      + '<span class="sl-song-status">&#8987;</span>'
      + '<span class="sl-song-name">' + song.name + coverNote + '</span>'
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
    '<span class="sl-chosen-name">' + artist.name + '</span>'
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
  appState.songs = extractSongs(setlist);

  var date = formatSetlistDate(setlist.eventDate);
  var venue = setlist.venue ? setlist.venue.name : 'Unknown venue';
  var city = (setlist.venue && setlist.venue.city) ? setlist.venue.city.name : '';
  document.getElementById('slSetlistInfo').innerHTML =
    '<div class="sl-setlist-info-header">'
    + '<strong>' + appState.artist.name + '</strong>'
    + '<span class="sl-setlist-info-date">' + date + '</span>'
    + '</div>'
    + '<div class="sl-setlist-info-venue">' + venue + (city ? ', ' + city : '') + '</div>';

  showStep(3);
  hideError('slCreateError');
  renderSongList(appState.songs);

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

  var date = formatSetlistDate(appState.setlist.eventDate);
  var venue = appState.setlist.venue ? appState.setlist.venue.name : '';
  var playlistName = appState.artist.name + ' — ' + date;
  var description = 'Setlist from ' + venue + ' on ' + date + '. Built with Setlist to Spotify (Alan\'s Brain).';

  getSpotifyUserId()
    .then(function(userId) {
      return createPlaylist(userId, playlistName, description);
    })
    .then(function(playlist) {
      return addTracksToPlaylist(playlist.id, uris).then(function() { return playlist; });
    })
    .then(function(playlist) {
      hideLoading();
      showStep(4);
      var matched = appState.matched.filter(function(m) { return m.track; }).length;
      document.getElementById('slSuccess').innerHTML =
        '<div class="sl-success-icon">&#10003;</div>'
        + '<div class="sl-success-title">Playlist Created!</div>'
        + '<div class="sl-success-detail">'
          + '<strong>' + playlistName + '</strong><br>'
          + matched + ' tracks added'
        + '</div>'
        + '<a class="sl-btn sl-btn-spotify" href="' + playlist.external_urls.spotify + '" target="_blank" rel="noopener">'
          + '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-right:6px"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>'
          + 'Open in Spotify'
        + '</a>';
    })
    .catch(function(err) {
      hideLoading();
      showError('slCreateError', 'Failed to create playlist: ' + err.message);
    });
}

function resetApp() {
  appState = { artist: null, setlist: null, songs: [], matched: [] };
  showStep(1);
  document.getElementById('slArtistInput').value = '';
  document.getElementById('slArtistResults').style.display = 'none';
  hideError('slSearchError');
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

  // Handle OAuth callback
  var params = new URLSearchParams(window.location.search);
  if (params.has('code') || params.has('error')) {
    handleOAuthCallback().then(function(success) {
      if (success) {
        // Restore app state from before the redirect
        var saved = sessionStorage.getItem('sl_pending_state');
        if (saved) {
          try {
            appState = JSON.parse(saved);
            sessionStorage.removeItem('sl_pending_state');
            if (appState.setlist && appState.songs.length > 0) {
              // Rebuild UI and immediately create the playlist
              rebuildAndCreate();
            }
          } catch (e) { /* ignore */ }
        }
      }
    });
  }
}

function rebuildAndCreate() {
  // Rebuild the UI to step 3, then auto-create
  selectSetlist(appState.setlist);
  // Wait for matching to complete, then create
  showLoading('Matching songs on Spotify...');
  matchAllSongs(appState.songs, appState.artist.name)
    .then(function(results) {
      appState.matched = results;
      hideLoading();
      renderMatchSummary(results);
      // Auto-create
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
