/* ══════════════════════════════════════
   LIVE PLAY STATS — App Engine
   Alan's Brain
   ══════════════════════════════════════ */

var LPS_CONFIG = {
  setlistProxyUrl: '/api/setlist',
  spotifyAuthUrl: 'https://accounts.spotify.com/authorize',
  spotifyTokenUrl: 'https://accounts.spotify.com/api/token',
  spotifyApiUrl: 'https://api.spotify.com/v1',
  spotifyScopes: 'playlist-modify-public playlist-modify-private',
  redirectUri: window.location.origin + window.location.pathname,
  defaultSpotifyClientId: '735092c51ee34dd7836615fe4c067edb',
  defaultSetlistKey: 'vyNcQzeLTe_xV5pVtKlrt3EmJo2v8WzCB0xM'
};

/* ── KEY / TOKEN MANAGEMENT ─────────── */

function lpsGetClientId() {
  return localStorage.getItem('ab_spotify_client_id') || LPS_CONFIG.defaultSpotifyClientId;
}

function lpsGetSetlistKey() {
  return localStorage.getItem('ab_setlist_key') || LPS_CONFIG.defaultSetlistKey;
}

function lpsGetToken() {
  var token = localStorage.getItem('ab_spotify_token');
  var expiry = parseInt(localStorage.getItem('ab_spotify_token_expiry') || '0', 10);
  if (token && Date.now() < expiry) return token;
  return null;
}

function lpsSaveToken(token, expiresIn) {
  localStorage.setItem('ab_spotify_token', token);
  localStorage.setItem('ab_spotify_token_expiry', String(Date.now() + (expiresIn * 1000) - 60000));
}

/* ── SPOTIFY PKCE OAuth ──────────────── */

function lpsGenerateRandom(length) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  var arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  var result = '';
  for (var i = 0; i < length; i++) result += chars[arr[i] % chars.length];
  return result;
}

function lpsSha256(plain) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
}

function lpsBase64url(buffer) {
  var bytes = new Uint8Array(buffer);
  var str = '';
  for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function lpsStartAuth() {
  var clientId = lpsGetClientId();
  if (!clientId) { lpsShowError('lpsError', 'Please set your Spotify Client ID below.'); return; }
  var verifier = lpsGenerateRandom(64);
  sessionStorage.setItem('lps_pkce_verifier', verifier);
  sessionStorage.setItem('lps_pending_url', document.getElementById('lpsUrlInput').value.trim());
  lpsSha256(verifier).then(function(hash) {
    var challenge = lpsBase64url(hash);
    var state = lpsGenerateRandom(16);
    sessionStorage.setItem('lps_oauth_state', state);
    var params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: LPS_CONFIG.redirectUri,
      scope: LPS_CONFIG.spotifyScopes,
      state: state,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      show_dialog: 'true'
    });
    window.location.href = LPS_CONFIG.spotifyAuthUrl + '?' + params.toString();
  });
}

function lpsHandleOAuth() {
  var params = new URLSearchParams(window.location.search);
  var code = params.get('code');
  var state = params.get('state');
  var error = params.get('error');
  window.history.replaceState({}, '', window.location.pathname);
  if (error || !code) return Promise.resolve(false);
  if (state !== sessionStorage.getItem('lps_oauth_state')) return Promise.resolve(false);
  var verifier = sessionStorage.getItem('lps_pkce_verifier');
  return fetch(LPS_CONFIG.spotifyTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: code,
      redirect_uri: LPS_CONFIG.redirectUri,
      client_id: lpsGetClientId(),
      code_verifier: verifier
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.access_token) {
      lpsSaveToken(data.access_token, data.expires_in);
      sessionStorage.removeItem('lps_pkce_verifier');
      sessionStorage.removeItem('lps_oauth_state');
      return true;
    }
    return false;
  })
  .catch(function() { return false; });
}

/* ── SPOTIFY URL PARSING ─────────────── */

function lpsParseUrl(input) {
  var match = input.match(/open\.spotify\.com\/(track|album|playlist)\/([A-Za-z0-9]+)/);
  if (match) return { type: match[1], id: match[2] };
  var uri = input.match(/spotify:(track|album|playlist):([A-Za-z0-9]+)/);
  if (uri) return { type: uri[1], id: uri[2] };
  return null;
}

/* ── SPOTIFY FETCHERS ────────────────── */

function lpsFetch(path) {
  var token = lpsGetToken();
  return fetch(LPS_CONFIG.spotifyApiUrl + path, {
    headers: { 'Authorization': 'Bearer ' + token }
  }).then(function(r) {
    if (!r.ok) throw new Error('Spotify API error: ' + r.status);
    return r.json();
  });
}

function lpsFetchAllAlbumTracks(albumId, offset, all) {
  return lpsFetch('/albums/' + albumId + '/tracks?limit=50&offset=' + offset).then(function(data) {
    all = all.concat(data.items);
    if (data.next) return lpsFetchAllAlbumTracks(albumId, offset + 50, all);
    return all;
  });
}

function lpsFetchAllPlaylistTracks(playlistId, offset, all) {
  return lpsFetch('/playlists/' + playlistId + '/tracks?limit=100&offset=' + offset
    + '&fields=items(track(id,name,artists(name))),next').then(function(data) {
    (data.items || []).forEach(function(item) {
      if (item.track && item.track.name) all.push(item.track);
    });
    if (data.next) return lpsFetchAllPlaylistTracks(playlistId, offset + 100, all);
    return all;
  });
}

function lpsFetchSongs(parsed) {
  if (parsed.type === 'track') {
    return lpsFetch('/tracks/' + parsed.id).then(function(track) {
      return [{ name: track.name, artist: track.artists[0] ? track.artists[0].name : '' }];
    });
  }
  if (parsed.type === 'album') {
    return lpsFetch('/albums/' + parsed.id).then(function(album) {
      var primaryArtist = album.artists[0] ? album.artists[0].name : '';
      return lpsFetchAllAlbumTracks(parsed.id, 0, []).then(function(tracks) {
        return tracks.map(function(t) {
          return { name: t.name, artist: t.artists[0] ? t.artists[0].name : primaryArtist };
        });
      });
    });
  }
  // playlist
  return lpsFetchAllPlaylistTracks(parsed.id, 0, []).then(function(tracks) {
    return tracks.map(function(t) {
      return { name: t.name, artist: t.artists[0] ? t.artists[0].name : '' };
    });
  });
}

/* ── SONG NAME CLEANING ──────────────── */

function lpsCleanSongName(name) {
  return name
    .replace(/\s*[\(\[](remaster(ed)?|live|version|edit|mix|radio|demo|acoustic|deluxe|bonus|feat\.?[^\)\]]*)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*[-–]\s*(remaster(ed)?|live|version|edit|mix|radio|demo|acoustic).*/gi, '')
    .trim();
}

/* ── SETLIST.FM QUERY ────────────────── */

function lpsSearchSong(songName, artistName) {
  var cleaned = lpsCleanSongName(songName);
  var url = LPS_CONFIG.setlistProxyUrl
    + '?path=' + encodeURIComponent('/search/setlists')
    + '&songName=' + encodeURIComponent(cleaned)
    + '&artistName=' + encodeURIComponent(artistName)
    + '&p=1';
  return fetch(url)
    .then(function(r) { if (!r.ok) return { total: 0, setlist: [] }; return r.json(); })
    .then(function(data) {
      var total = data.total || 0;
      var first = (data.setlist || [])[0] || null;
      return {
        total: total,
        lastDate: first ? first.eventDate : null,
        lastVenue: first ? (first.venue ? first.venue.name : null) : null,
        lastCity: first ? (first.venue && first.venue.city ? first.venue.city.name : null) : null,
        lastCountry: first ? (first.venue && first.venue.city && first.venue.city.country ? first.venue.city.country.code : null) : null,
        setlistUrl: first ? first.url : null
      };
    })
    .catch(function() { return { total: 0 }; });
}

/* ── DATE FORMATTING ─────────────────── */

function lpsFormatDate(dateStr) {
  if (!dateStr) return '—';
  var parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var m = parseInt(parts[1], 10) - 1;
  return months[m] + ' ' + parseInt(parts[0], 10) + ', ' + parts[2];
}

/* ── APP STATE ───────────────────────── */

var lpsState = {
  songs: [],    // [{name, artist}]
  rows: []      // [{song, stats}] populated as queries complete
};

var lpsSort = { col: 'count', dir: 'desc' };

/* ── TABLE RENDERING ─────────────────── */

function lpsSortRows(rows) {
  var col = lpsSort.col;
  var dir = lpsSort.dir === 'asc' ? 1 : -1;
  return rows.slice().sort(function(a, b) {
    var av, bv;
    if (col === 'count') {
      av = (a.stats && a.stats.total) || 0;
      bv = (b.stats && b.stats.total) || 0;
    } else if (col === 'song') {
      av = a.song.name.toLowerCase();
      bv = b.song.name.toLowerCase();
      return av < bv ? -dir : av > bv ? dir : 0;
    } else if (col === 'date') {
      av = a.stats && a.stats.lastDate ? a.stats.lastDate : '';
      bv = b.stats && b.stats.lastDate ? b.stats.lastDate : '';
      return av < bv ? -dir : av > bv ? dir : 0;
    } else {
      av = 0; bv = 0;
    }
    return (bv - av) * dir;
  });
}

function lpsRenderTable() {
  var completed = lpsState.rows.filter(function(r) { return r.stats !== undefined; });
  var sorted = lpsSortRows(completed);

  var thead = '<tr>';
  var cols = [
    { key: 'song', label: 'Song' },
    { key: 'count', label: 'Times Played' },
    { key: 'date', label: 'Last Played' },
    { key: 'venue', label: 'Last Venue' }
  ];
  cols.forEach(function(c) {
    var cls = 'sortable';
    if (lpsSort.col === c.key) cls += ' ' + (lpsSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    thead += '<th class="' + cls + '" data-col="' + c.key + '">' + c.label + '</th>';
  });
  thead += '</tr>';

  var tbody = '';
  sorted.forEach(function(row) {
    var s = row.stats;
    var notFound = !s || s.total === 0;
    var trCls = notFound ? 'lps-not-found' : '';
    var songCell = s && s.setlistUrl
      ? '<a class="lps-song-link" href="' + lpsEsc(s.setlistUrl) + '" target="_blank" rel="noopener">' + lpsEsc(row.song.name) + '</a>'
      : '<span class="lps-song-link">' + lpsEsc(row.song.name) + '</span>';
    var countCell = notFound
      ? '<span class="lps-count">—</span><div style="font-size:0.7rem;color:var(--text-dim)">not found</div>'
      : '<span class="lps-count">' + s.total.toLocaleString() + '</span>';
    var dateCell = notFound ? '—' : '<span class="lps-date">' + lpsFormatDate(s.lastDate) + '</span>';
    var venueCell = notFound ? '—'
      : '<div class="lps-venue">' + lpsEsc(s.lastVenue || '—') + '</div>'
        + (s.lastCity ? '<div class="lps-city">' + lpsEsc(s.lastCity) + (s.lastCountry ? ', ' + lpsEsc(s.lastCountry) : '') + '</div>' : '');
    tbody += '<tr class="' + trCls + '">'
      + '<td>' + songCell + '<div class="lps-artist-cell">' + lpsEsc(row.song.artist) + '</div></td>'
      + '<td>' + countCell + '</td>'
      + '<td>' + dateCell + '</td>'
      + '<td>' + venueCell + '</td>'
      + '</tr>';
  });

  // Pending rows (still loading)
  var pending = lpsState.rows.filter(function(r) { return r.stats === undefined; });
  pending.forEach(function(row) {
    tbody += '<tr>'
      + '<td>' + lpsEsc(row.song.name) + '<div class="lps-artist-cell">' + lpsEsc(row.song.artist) + '</div></td>'
      + '<td class="lps-loading-cell" colspan="3">looking up...</td>'
      + '</tr>';
  });

  var table = document.getElementById('lpsTable');
  table.querySelector('thead').innerHTML = thead;
  table.querySelector('tbody').innerHTML = tbody;

  // Sort click handlers
  table.querySelectorAll('th.sortable').forEach(function(th) {
    th.onclick = function() {
      var col = th.getAttribute('data-col');
      if (lpsSort.col === col) {
        lpsSort.dir = lpsSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        lpsSort.col = col;
        lpsSort.dir = col === 'count' ? 'desc' : 'asc';
      }
      lpsRenderTable();
    };
  });
}

/* ── CSV EXPORT ──────────────────────── */

function lpsExportCsv() {
  var rows = lpsSortRows(lpsState.rows.filter(function(r) { return r.stats !== undefined; }));
  var csv = 'Song,Artist,Times Played,Last Played,Last Venue,Last City\n';
  rows.forEach(function(row) {
    var s = row.stats || {};
    csv += [
      '"' + (row.song.name || '').replace(/"/g, '""') + '"',
      '"' + (row.song.artist || '').replace(/"/g, '""') + '"',
      s.total || 0,
      '"' + (lpsFormatDate(s.lastDate) || '') + '"',
      '"' + (s.lastVenue || '').replace(/"/g, '""') + '"',
      '"' + ((s.lastCity || '') + (s.lastCountry ? ', ' + s.lastCountry : '')).replace(/"/g, '""') + '"'
    ].join(',') + '\n';
  });
  var blob = new Blob([csv], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'live-play-stats.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/* ── MAIN LOOKUP FLOW ────────────────── */

function lpsDoLookup() {
  var input = document.getElementById('lpsUrlInput').value.trim();
  lpsHideError('lpsError');
  if (!input) { lpsShowError('lpsError', 'Paste a Spotify link first.'); return; }

  var parsed = lpsParseUrl(input);
  if (!parsed) { lpsShowError('lpsError', 'That doesn\'t look like a Spotify track, album, or playlist link.'); return; }

  var token = lpsGetToken();
  if (!token) {
    lpsStartAuth();
    return;
  }

  lpsShowLoading('Fetching songs...');

  lpsFetchSongs(parsed)
    .then(function(songs) {
      lpsHideLoading();
      if (songs.length === 0) {
        lpsShowError('lpsError', 'No songs found.');
        return;
      }
      lpsState.songs = songs;
      lpsState.rows = songs.map(function(s) { return { song: s }; }); // stats undefined = pending
      lpsShowStep(2);
      lpsRunQueries();
    })
    .catch(function(err) {
      lpsHideLoading();
      lpsShowError('lpsError', err.message);
    });
}

function lpsRunQueries() {
  var idx = 0;
  var total = lpsState.songs.length;

  document.getElementById('lpsTableWrap').style.display = 'block';
  document.getElementById('lpsProgress').style.display = 'block';
  lpsRenderTable();

  function next() {
    if (idx >= total) {
      document.getElementById('lpsProgress').style.display = 'none';
      document.getElementById('lpsExportRow').style.display = 'flex';
      lpsRenderTable();
      return;
    }
    var song = lpsState.songs[idx];
    document.getElementById('lpsProgressText').textContent =
      'Looking up ' + (idx + 1) + ' of ' + total + ': ' + song.name + '...';
    idx++;
    lpsSearchSong(song.name, song.artist)
      .then(function(stats) {
        lpsState.rows[idx - 1].stats = stats;
        lpsRenderTable();
        next();
      });
  }
  next();
}

function lpsReset() {
  lpsState = { songs: [], rows: [] };
  document.getElementById('lpsUrlInput').value = '';
  lpsHideError('lpsError');
  document.getElementById('lpsTableWrap').style.display = 'none';
  document.getElementById('lpsProgress').style.display = 'none';
  document.getElementById('lpsExportRow').style.display = 'none';
  lpsShowStep(1);
}

/* ── UI HELPERS ──────────────────────── */

function lpsShowError(id, msg) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

function lpsHideError(id) {
  var el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function lpsShowLoading(text) {
  document.getElementById('lpsLoadingText').textContent = text || 'Loading...';
  document.getElementById('lpsLoading').style.display = 'flex';
}

function lpsHideLoading() {
  document.getElementById('lpsLoading').style.display = 'none';
}

function lpsShowStep(n) {
  document.getElementById('lpsStep1').style.display = n === 1 ? 'block' : 'none';
  document.getElementById('lpsStep2').style.display = n === 2 ? 'block' : 'none';
  document.getElementById('lpsStartOver').style.display = n > 1 ? 'block' : 'none';
}

function lpsEsc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── INIT ────────────────────────────── */

function initLivePlayStats() {
  if (!localStorage.getItem('ab_spotify_client_id') && LPS_CONFIG.defaultSpotifyClientId) {
    localStorage.setItem('ab_spotify_client_id', LPS_CONFIG.defaultSpotifyClientId);
  }
  if (!localStorage.getItem('ab_setlist_key') && LPS_CONFIG.defaultSetlistKey) {
    localStorage.setItem('ab_setlist_key', LPS_CONFIG.defaultSetlistKey);
  }

  var spotifyIdField = document.getElementById('lpsSpotifyId');
  var setlistKeyField = document.getElementById('lpsSetlistKey');
  spotifyIdField.value = lpsGetClientId();
  setlistKeyField.value = lpsGetSetlistKey();

  document.getElementById('lpsSaveKeysBtn').addEventListener('click', function() {
    localStorage.setItem('ab_spotify_client_id', spotifyIdField.value.trim());
    localStorage.setItem('ab_setlist_key', setlistKeyField.value.trim());
    document.getElementById('lpsKeysStatus').textContent = '✓ Saved';
    document.getElementById('lpsKeysStatus').className = 'sl-setup-status saved';
  });

  document.getElementById('lpsLookupBtn').addEventListener('click', lpsDoLookup);
  document.getElementById('lpsUrlInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') lpsDoLookup();
  });

  document.getElementById('lpsExportBtn').addEventListener('click', lpsExportCsv);
  document.getElementById('lpsResetBtn').addEventListener('click', lpsReset);

  // Handle OAuth callback
  var params = new URLSearchParams(window.location.search);
  if (params.has('code') || params.has('error')) {
    lpsHandleOAuth().then(function(success) {
      if (!success) return;
      var savedUrl = sessionStorage.getItem('lps_pending_url');
      if (savedUrl) {
        sessionStorage.removeItem('lps_pending_url');
        document.getElementById('lpsUrlInput').value = savedUrl;
        lpsDoLookup();
      }
    });
  }
}
