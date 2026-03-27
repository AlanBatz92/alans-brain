/* ═══════════════════════════════════════════
   soundboards.js — Audio playback engine
   Uses <audio> elements (not Web Audio API)
   so iOS plays clips regardless of the
   silent/ringer switch — same as YouTube.
   ═══════════════════════════════════════════ */

function SoundEngine() {
  var self = this;
  self.active = {};   // canonical url → HTMLAudioElement
  self.volume = 0.8;

  // Play a clip.
  // Tries the .ogg version first (smaller file), falls back to original URL.
  // onStart(duration) fires when playback begins (duration in seconds).
  // onEnded() fires when the clip ends naturally or on unrecoverable error.
  self.play = function(url, onStart, onEnded) {
    var audio = document.createElement('audio');
    audio.setAttribute('playsinline', '');  // stay inline on iOS (no fullscreen)
    audio.volume = self.volume;
    self.active[url] = audio;

    // Trigger progress bar when metadata is loaded — duration is guaranteed
    // reliable here. The 'play' event fires slightly earlier but duration
    // is often NaN at that point, causing the progress animation to be skipped.
    audio.addEventListener('loadedmetadata', function() {
      if (onStart) onStart(isFinite(audio.duration) ? audio.duration : 0);
    }, { once: true });

    // Clean up when clip ends naturally
    audio.addEventListener('ended', function() {
      delete self.active[url];
      if (onEnded) onEnded();
    }, { once: true });

    // Try OGG first; on failure fall back to the original URL
    var oggUrl = url.replace(/\.wav$/i, '.ogg');
    if (oggUrl !== url) {
      audio.src = oggUrl;
      audio.play().catch(function() {
        if (self.active[url] === audio) {
          audio.src = url;
          audio.play().catch(function() {
            delete self.active[url];
            if (onEnded) onEnded();
          });
        }
      });
    } else {
      audio.src = url;
      audio.play().catch(function() {
        delete self.active[url];
        if (onEnded) onEnded();
      });
    }
  };

  // Stop a specific clip by URL
  self.stop = function(url) {
    var audio = self.active[url];
    if (audio) {
      audio.pause();
      delete self.active[url];
    }
  };

  // Check if a specific clip is currently active
  self.isPlaying = function(url) {
    return !!self.active[url];
  };

  // Stop all active clips
  self.stopAll = function() {
    Object.keys(self.active).forEach(function(u) { self.stop(u); });
  };

  // Set volume (0–1) — applies immediately to all active clips
  self.setVolume = function(v) {
    self.volume = v;
    Object.keys(self.active).forEach(function(u) {
      self.active[u].volume = v;
    });
  };

  // How many clips are currently active (playing or loading)
  self.playingCount = function() {
    return Object.keys(self.active).length;
  };
}
