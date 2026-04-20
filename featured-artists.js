/* ══════════════════════════════════════
   FEATURED ARTIST PLAYLIST — App Engine
   Alan's Brain
   ══════════════════════════════════════ */

var FA_CONFIG = {
  spotifyAuthUrl: 'https://accounts.spotify.com/authorize',
  spotifyTokenUrl: 'https://accounts.spotify.com/api/token',
  spotifyApiUrl: 'https://api.spotify.com/v1',
  spotifyScopes: 'playlist-modify-public playlist-modify-private',
  redirectUri: window.location.origin + window.location.pathname,
  defaultSpotifyClientId: '735092c51ee34dd7836615fe4c067edb'
};

/* ── KEY / TOKEN MANAGEMENT ─────────── */

function faGetClientId() {
  return localStorage.getItem('ab_spotify_client_id') || FA_CONFIG.defaultSpotifyClientId;
}

function faGetToken() {
  var token = localStorage.getItem('ab_spotify_token');
  var expiry = parseInt(localStorage.getItem('ab_spotify_token_expiry') || '0', 10);
  if (token && Date.now() < expiry) return token;
  return null;
}

function faSaveToken(token, expiresIn) {
  localStorage.setItem('ab_spotify_token', token);
  localStorage.setItem('ab_spotify_token_expiry', String(Date.now() + (expiresIn * 1000) - 60000));
}

/* ── SPOTIFY PKCE OAuth ──────────────── */

function faGenerateRandom(length) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  var arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  var result = '';
  for (var i = 0; i < length; i++) result += chars[arr[i] % chars.length];
  return result;
}

function faSha256(plain) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
}

function faBase64url(buffer) {
  var bytes = new Uint8Array(buffer);
  var str = '';
  for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function faStartAuth() {
  var clientId = faGetClientId();
  if (!clientId) { faShowError('faError', 'Please set your Spotify Client ID below.'); return; }
  var verifier = faGenerateRandom(64);
  sessionStorage.setItem('fa_pkce_verifier', verifier);
  sessionStorage.setItem('fa_pending_state', JSON.stringify(faState));
  faSha256(verifier).then(function(hash) {
    var challenge = faBase64url(hash);
    var state = faGenerateRandom(16);
    sessionStorage.setItem('fa_oauth_state', state);
    var params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: FA_CONFIG.redirectUri,
      scope: FA_CONFIG.spotifyScopes,
      state: state,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      show_dialog: 'true'
    });
    window.location.href = FA_CONFIG.spotifyAuthUrl + '?' + params.toString();
  });
}

function faHandleOAuth() {
  var params = new URLSearchParams(window.location.search);
  var code = params.get('code');
  var state = params.get('state');
  var error = params.get('error');
  window.history.replaceState({}, '', window.location.pathname);
  if (error || !code) return Promise.resolve(false);
  if (state !== sessionStorage.getItem('fa_oauth_state')) return Promise.resolve(false);
  var verifier = sessionStorage.getItem('fa_pkce_verifier');
  return fetch(FA_CONFIG.spotifyTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: code,
      redirect_uri: FA_CONFIG.redirectUri,
      client_id: faGetClientId(),
      code_verifier: verifier
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.access_token) {
      faSaveToken(data.access_token, data.expires_in);
      sessionStorage.removeItem('fa_pkce_verifier');
      sessionStorage.removeItem('fa_oauth_state');
      return true;
    }
    return false;
  })
  .catch(function() { return false; });
}

/* ── SPOTIFY URL PARSING ─────────────── */

function faParseUrl(input) {
  var match = input.match(/open\.spotify\.com\/(track|album|playlist)\/([A-Za-z0-9]+)/);
  if (match) return { type: match[1], id: match[2] };
  var uri = input.match(/spotify:(track|album|playlist):([A-Za-z0-9]+)/);
  if (uri) return { type: uri[1], id: uri[2] };
  return null;
}

/* ── SPOTIFY DATA FETCHERS ───────────── */

function faFetch(path) {
  var token = faGetToken();
  return fetch(FA_CONFIG.spotifyApiUrl + path, {
    headers: { 'Authorization': 'Bearer ' + token }
  }).then(function(r) {
    if (!r.ok) throw new Error('Spotify API error: ' + r.status);
    return r.json();
  });
}

function faFetchTrackArtists(id) {
  return faFetch('/tracks/' + id).then(function(track) {
    return {
      source: { name: track.name, type: 'track', primaryArtist: track.artists[0] ? track.artists[0].name : '' },
      primaryArtist: track.artists[0] || null,
      featuredArtists: track.artists.slice(1),
      hasFeatures: track.artists.length > 1
    };
  });
}

function faFetchAlbumTracks(albumId, offset, allTracks) {
  return faFetch('/albums/' + albumId + '/tracks?limit=50&offset=' + offset).then(function(data) {
    allTracks = allTracks.concat(data.items);
    if (data.next) return faFetchAlbumTracks(albumId, offset + 50, allTracks);
    return allTracks;
  });
}

function faFetchAlbumArtists(id) {
  return faFetch('/albums/' + id).then(function(album) {
    var primaryIds = album.artists.map(function(a) { return a.id; });
    return faFetchAlbumTracks(id, 0, []).then(function(tracks) {
      var featMap = {};
      tracks.forEach(function(track) {
        (track.artists || []).forEach(function(artist) {
          if (primaryIds.indexOf(artist.id) === -1 && !featMap[artist.id]) {
            featMap[artist.id] = artist;
          }
        });
      });
      var featuredArtists = Object.keys(featMap).map(function(k) { return featMap[k]; });
      return {
        source: {
          name: album.name,
          type: 'album',
          primaryArtist: album.artists.map(function(a) { return a.name; }).join(', ')
        },
        primaryArtists: album.artists,
        featuredArtists: featuredArtists,
        hasFeatures: featuredArtists.length > 0
      };
    });
  });
}

function faFetchPlaylistTracks(playlistId, offset, artistMap) {
  return faFetch('/playlists/' + playlistId + '/tracks?limit=100&offset=' + offset
    + '&fields=items(track(artists(id,name))),next,total').then(function(data) {
    (data.items || []).forEach(function(item) {
      if (!item.track || !item.track.artists) return;
      item.track.artists.forEach(function(a) {
        if (!artistMap[a.id]) artistMap[a.id] = a;
      });
    });
    if (data.next) return faFetchPlaylistTracks(playlistId, offset + 100, artistMap);
    return artistMap;
  });
}

function faFetchPlaylistArtists(id) {
  return faFetch('/playlists/' + id + '?fields=name,owner(display_name)').then(function(playlist) {
    return faFetchPlaylistTracks(id, 0, {}).then(function(artistMap) {
      var all = Object.keys(artistMap).map(function(k) { return artistMap[k]; });
      var capped = all.slice(0, 20);
      return {
        source: { name: playlist.name, type: 'playlist', primaryArtist: null },
        featuredArtists: capped,
        hasFeatures: all.length > 0,
        totalCount: all.length,
        capped: all.length > 20
      };
    });
  });
}

function faGetTopTracks(artistId) {
  return faFetch('/artists/' + artistId + '/top-tracks?market=US').then(function(data) {
    return (data.tracks || []).slice(0, 5);
  });
}

function faGetUserId() {
  return faFetch('/me').then(function(data) { return data.id; });
}

function faCreatePlaylist(userId, name, desc) {
  var token = faGetToken();
  return fetch('/api/spotify-proxy?endpoint=' + encodeURIComponent('/me/playlists'), {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, description: desc, public: true })
  }).then(function(r) {
    if (!r.ok) return r.text().then(function(b) { throw new Error('Spotify error (' + r.status + '): ' + b); });
    return r.json();
  });
}

function faAddTracks(playlistId, uris) {
  var token = faGetToken();
  var batches = [];
  for (var i = 0; i < uris.length; i += 100) batches.push(uris.slice(i, i + 100));
  function next(idx) {
    if (idx >= batches.length) return Promise.resolve();
    return fetch('/api/spotify-proxy?endpoint=' + encodeURIComponent('/playlists/' + playlistId + '/tracks'), {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: batches[idx] })
    }).then(function(r) {
      if (!r.ok) return r.text().then(function(b) { throw new Error('Add tracks failed: ' + b); });
      return next(idx + 1);
    });
  }
  return next(0);
}

/* ── APP STATE ───────────────────────── */

var faState = {
  parsed: null,       // { type, id }
  sourceInfo: null,   // returned from fetch*Artists
  selectedArtists: [],// artist objects with checked=true
  topTracks: {},      // artistId -> [tracks]
  playlist: null
};

/* ── UI HELPERS ──────────────────────── */

function faShowError(id, msg) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

function faHideError(id) {
  var el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function faShowLoading(text) {
  document.getElementById('faLoadingText').textContent = text || 'Loading...';
  document.getElementById('faLoading').style.display = 'flex';
}

function faHideLoading() {
  document.getElementById('faLoading').style.display = 'none';
}

function faShowStep(n) {
  for (var i = 1; i <= 4; i++) {
    document.getElementById('faStep' + i).style.display = (i === n) ? 'block' : 'none';
  }
  document.getElementById('faStartOver').style.display = (n > 1) ? 'block' : 'none';
}

/* ── STEP 2: ARTIST SELECTION ────────── */

function faRenderStep2() {
  var info = faState.sourceInfo;
  var typeLabel = info.source.type.charAt(0).toUpperCase() + info.source.type.slice(1);

  var html = '<div class="fa-source-block">'
    + '<span class="fa-type-badge">' + typeLabel + '</span>'
    + '<div class="fa-source-info">'
    + '<div class="fa-source-name">' + faEsc(info.source.name) + '</div>'
    + (info.source.primaryArtist ? '<div class="fa-source-artist">by ' + faEsc(info.source.primaryArtist) + '</div>' : '')
    + '</div>'
    + '</div>';

  document.getElementById('faSourceInfo').innerHTML = html;

  var artists = info.featuredArtists;
  var listEl = document.getElementById('faArtistList');
  var noFeatEl = document.getElementById('faNoFeatures');

  if (!info.hasFeatures || artists.length === 0) {
    var msg = '';
    if (info.source.type === 'track') msg = '"' + info.source.name + '" has only one credited artist — no features found.';
    else if (info.source.type === 'album') msg = 'No featured artists found on this album. Every track credits only the primary artist.';
    else msg = 'No artists found in this playlist.';
    noFeatEl.textContent = msg;
    noFeatEl.style.display = 'block';
    listEl.innerHTML = '';
    document.getElementById('faStep2ContinueBtn').disabled = true;
  } else {
    noFeatEl.style.display = 'none';
    if (info.capped) {
      noFeatEl.textContent = 'Found ' + info.totalCount + ' artists — showing the first 20.';
      noFeatEl.style.display = 'block';
    }
    var artistHtml = '';
    artists.forEach(function(artist, i) {
      artistHtml += '<label class="fa-artist-item checked" id="faArtistItem_' + i + '">'
        + '<input type="checkbox" class="fa-artist-check" data-artist-idx="' + i + '" checked>'
        + '<span class="fa-artist-name">' + faEsc(artist.name) + '</span>'
        + '</label>';
    });
    listEl.innerHTML = artistHtml;
    document.getElementById('faStep2ContinueBtn').disabled = false;

    listEl.querySelectorAll('input[type=checkbox]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var item = cb.closest('.fa-artist-item');
        item.classList.toggle('checked', cb.checked);
        var anyChecked = listEl.querySelectorAll('input:checked').length > 0;
        document.getElementById('faStep2ContinueBtn').disabled = !anyChecked;
      });
    });
  }

  faShowStep(2);
}

/* ── STEP 3: TRACK PREVIEW ───────────── */

function faRenderStep3(tracksMap) {
  var html = '';
  faState.selectedArtists.forEach(function(artist) {
    var tracks = tracksMap[artist.id] || [];
    html += '<div class="fa-group-header">Top ' + tracks.length + ' by ' + faEsc(artist.name) + '</div>';
    tracks.forEach(function(track, i) {
      var albumName = track.album ? track.album.name : '';
      html += '<div class="fa-track-row">'
        + '<span class="fa-track-num">' + (i + 1) + '</span>'
        + '<span class="fa-track-name">' + faEsc(track.name) + '</span>'
        + '<span class="fa-track-album">' + faEsc(albumName) + '</span>'
        + '</div>';
    });
  });

  document.getElementById('faTrackPreview').innerHTML = html;
  var total = Object.keys(tracksMap).reduce(function(sum, k) { return sum + tracksMap[k].length; }, 0);
  document.getElementById('faTrackCount').textContent = total + ' tracks across ' + faState.selectedArtists.length + ' artists';

  var defaultName = 'Featured Artists — ' + faEsc(faState.sourceInfo.source.name);
  document.getElementById('faPlaylistNameInput').value = 'Featured Artists — ' + faState.sourceInfo.source.name;
  faShowStep(3);
}

/* ── ACTIONS ─────────────────────────── */

function faDoAnalyze() {
  var input = document.getElementById('faUrlInput').value.trim();
  faHideError('faStep1Error');
  if (!input) { faShowError('faStep1Error', 'Paste a Spotify link first.'); return; }

  var parsed = faParseUrl(input);
  if (!parsed) { faShowError('faStep1Error', 'That doesn\'t look like a Spotify track, album, or playlist link.'); return; }

  var token = faGetToken();
  if (!token) {
    faState.parsed = parsed;
    faState.pendingAnalyze = true;
    faStartAuth();
    return;
  }

  faState.parsed = parsed;
  faShowLoading('Analyzing...');

  var fetcher;
  if (parsed.type === 'track') fetcher = faFetchTrackArtists(parsed.id);
  else if (parsed.type === 'album') fetcher = faFetchAlbumArtists(parsed.id);
  else fetcher = faFetchPlaylistArtists(parsed.id);

  fetcher
    .then(function(info) {
      faHideLoading();
      faState.sourceInfo = info;
      faRenderStep2();
    })
    .catch(function(err) {
      faHideLoading();
      faShowError('faStep1Error', err.message);
    });
}

function faDoContinueToStep3() {
  var checkboxes = document.getElementById('faArtistList').querySelectorAll('input:checked');
  faState.selectedArtists = [];
  checkboxes.forEach(function(cb) {
    var idx = parseInt(cb.getAttribute('data-artist-idx'), 10);
    faState.selectedArtists.push(faState.sourceInfo.featuredArtists[idx]);
  });

  if (faState.selectedArtists.length === 0) {
    faShowError('faStep2Error', 'Select at least one artist.');
    return;
  }

  faHideError('faStep2Error');
  faShowLoading('Loading top tracks...');

  var tracksMap = {};
  var idx = 0;

  function next() {
    if (idx >= faState.selectedArtists.length) {
      faState.topTracks = tracksMap;
      faHideLoading();
      faRenderStep3(tracksMap);
      return;
    }
    var artist = faState.selectedArtists[idx];
    idx++;
    document.getElementById('faLoadingText').textContent = 'Loading top tracks for ' + artist.name + '...';
    faGetTopTracks(artist.id)
      .then(function(tracks) {
        tracksMap[artist.id] = tracks;
        next();
      })
      .catch(function() {
        tracksMap[artist.id] = [];
        next();
      });
  }
  next();
}

function faDoCreatePlaylist() {
  var token = faGetToken();
  if (!token) {
    sessionStorage.setItem('fa_pending_state', JSON.stringify(faState));
    faStartAuth();
    return;
  }

  var uris = [];
  faState.selectedArtists.forEach(function(artist) {
    var tracks = faState.topTracks[artist.id] || [];
    tracks.forEach(function(t) { if (t.uri) uris.push(t.uri); });
  });

  if (uris.length === 0) {
    faShowError('faStep3Error', 'No tracks found to add.');
    return;
  }

  faHideError('faStep3Error');
  faShowLoading('Creating playlist...');

  var playlistName = document.getElementById('faPlaylistNameInput').value.trim()
    || ('Featured Artists — ' + faState.sourceInfo.source.name);
  var desc = 'Top tracks for each featured artist from: ' + faState.sourceInfo.source.name + '. Built with Alan\'s Brain.';

  faGetUserId()
    .then(function(userId) { return faCreatePlaylist(userId, playlistName, desc); })
    .then(function(playlist) {
      return faAddTracks(playlist.id, uris).then(function() {
        faHideLoading();
        faShowStep(4);
        document.getElementById('faSuccess').innerHTML =
          '<div class="sl-success-icon">&#10003;</div>'
          + '<div class="sl-success-title">Playlist Created!</div>'
          + '<div class="sl-success-detail">'
            + '<strong>' + faEsc(playlistName) + '</strong><br>'
            + uris.length + ' tracks added'
          + '</div>'
          + '<a class="sl-btn sl-btn-spotify" href="' + playlist.external_urls.spotify + '" target="_blank" rel="noopener">'
            + faSvgSpotify() + 'Open in Spotify'
          + '</a>';
      });
    })
    .catch(function(err) {
      faHideLoading();
      faShowError('faStep3Error', err.message);
    });
}

function faReset() {
  faState = { parsed: null, sourceInfo: null, selectedArtists: [], topTracks: {}, playlist: null };
  document.getElementById('faUrlInput').value = '';
  faHideError('faStep1Error');
  faHideError('faStep2Error');
  faHideError('faStep3Error');
  faShowStep(1);
}

function faEsc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function faSvgSpotify() {
  return '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-right:6px"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>';
}

/* ── INIT ────────────────────────────── */

function initFeaturedArtistsApp() {
  // Auto-save default client ID
  if (!localStorage.getItem('ab_spotify_client_id') && FA_CONFIG.defaultSpotifyClientId) {
    localStorage.setItem('ab_spotify_client_id', FA_CONFIG.defaultSpotifyClientId);
  }

  // Setup inputs
  var keyField = document.getElementById('faSpotifyId');
  keyField.value = faGetClientId();
  document.getElementById('faSaveKeyBtn').addEventListener('click', function() {
    localStorage.setItem('ab_spotify_client_id', keyField.value.trim());
    document.getElementById('faKeysStatus').textContent = '✓ Saved';
    document.getElementById('faKeysStatus').className = 'sl-setup-status saved';
  });

  document.getElementById('faAnalyzeBtn').addEventListener('click', faDoAnalyze);
  document.getElementById('faUrlInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') faDoAnalyze();
  });

  document.getElementById('faStep2ContinueBtn').addEventListener('click', faDoContinueToStep3);
  document.getElementById('faStep3CreateBtn').addEventListener('click', faDoCreatePlaylist);
  document.getElementById('faResetBtn').addEventListener('click', faReset);

  // Handle OAuth callback
  var params = new URLSearchParams(window.location.search);
  if (params.has('code') || params.has('error')) {
    faHandleOAuth().then(function(success) {
      if (!success) return;
      var saved = sessionStorage.getItem('fa_pending_state');
      if (!saved) return;
      try {
        faState = JSON.parse(saved);
        sessionStorage.removeItem('fa_pending_state');
        if (faState.pendingAnalyze && faState.parsed) {
          faState.pendingAnalyze = false;
          // Restore URL input and re-analyze
          var type = faState.parsed.type;
          var id = faState.parsed.id;
          document.getElementById('faUrlInput').value = 'spotify:' + type + ':' + id;
          faDoAnalyze();
        } else if (faState.selectedArtists && faState.selectedArtists.length > 0 && Object.keys(faState.topTracks).length > 0) {
          // Was at step 3 about to create — rebuild and create
          faRenderStep3(faState.topTracks);
          faDoCreatePlaylist();
        }
      } catch (e) { /* ignore */ }
    });
  }
}
