/* ═══════════════════════════════════════════
   soundboards.js — Web Audio API engine
   Handles loading, decoding, and playing clips
   ═══════════════════════════════════════════ */

function SoundEngine() {
  var self = this;
  self.ctx = null;
  self.buffers = {};    // file path → AudioBuffer
  self.sources = [];    // active AudioBufferSourceNodes
  self.sourceMap = {};  // url → { source, onEnded } for toggle-off support
  self.pending = 0;     // number of clips currently loading (not yet playing)
  self.gainNode = null;
  self.volume = 0.8;

  self._init = function() {
    if (self.ctx) return;
    self.ctx = new (window.AudioContext || window.webkitAudioContext)();
    self.gainNode = self.ctx.createGain();
    self.gainNode.gain.value = self.volume;
    self.gainNode.connect(self.ctx.destination);
  };

  // Load and decode an audio file, cache the buffer
  self.load = function(url, callback, onError) {
    if (self.buffers[url]) {
      if (callback) callback(self.buffers[url]);
      return;
    }
    fetch(url)
      .then(function(r) { return r.arrayBuffer(); })
      .then(function(data) { return self.ctx.decodeAudioData(data); })
      .then(function(buffer) {
        self.buffers[url] = buffer;
        if (callback) callback(buffer);
      })
      .catch(function(err) {
        console.warn('Failed to load audio:', url, err);
        if (onError) onError();
      });
  };

  // Check if a specific clip is currently playing
  self.isPlaying = function(url) {
    return !!self.sourceMap[url];
  };

  // Stop a specific clip by URL
  self.stop = function(url) {
    var entry = self.sourceMap[url];
    if (entry) {
      try { entry.source.stop(); } catch(e) {}
      // onended handler cleans up sources/sourceMap
    }
  };

  // Play a clip — onStart(duration) called when playback begins, onEnded() when it finishes
  self.play = function(url, onStart, onEnded) {
    self._init();

    var doPlay = function(buffer) {
      self.pending = Math.max(0, self.pending - 1);
      var source = self.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(self.gainNode);
      source.start(0);
      self.sources.push(source);
      self.sourceMap[url] = { source: source, onEnded: onEnded };
      if (onStart) onStart(buffer.duration);
      source.onended = function() {
        var idx = self.sources.indexOf(source);
        if (idx > -1) self.sources.splice(idx, 1);
        delete self.sourceMap[url];
        if (onEnded) onEnded();
      };
    };

    if (self.buffers[url]) {
      doPlay(self.buffers[url]);
    } else {
      self.pending++;
      self.load(url, doPlay, function() {
        self.pending = Math.max(0, self.pending - 1);
        if (onEnded) onEnded();
      });
    }
  };

  // Stop all playing sounds
  self.stopAll = function() {
    self.sources.forEach(function(s) {
      try { s.stop(); } catch(e) {}
    });
    self.sources = [];
    self.sourceMap = {};
    self.pending = 0;
  };

  // Set volume (0–1)
  self.setVolume = function(v) {
    self.volume = v;
    if (self.gainNode) self.gainNode.gain.value = v;
  };

  // How many sounds are currently playing or loading
  self.playingCount = function() {
    return self.sources.length + self.pending;
  };
}
