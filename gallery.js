/* ═══════════════════════════════════════════
   gallery.js — Shared lightbox + slideshow
   Used by photos.html and art.html
   ═══════════════════════════════════════════ */

/* ── Lightbox ──
   Creates a full-screen image viewer with prev/next navigation.
   Usage:
     var lb = new Lightbox();
     lb.open(images, startIndex);
   Where images is an array of { src, caption } objects.
*/
function Lightbox() {
  var self = this;
  self.images = [];
  self.index = 0;
  self.el = null;
  self.imgEl = null;
  self.captionEl = null;

  self._build = function() {
    if (self.el) return;

    self.el = document.createElement('div');
    self.el.className = 'lightbox';
    self.el.innerHTML =
      '<button class="lightbox-close" aria-label="Close">&times;</button>' +
      '<button class="lightbox-nav lightbox-prev" aria-label="Previous">&lsaquo;</button>' +
      '<div class="lightbox-content">' +
        '<img src="" alt="">' +
        '<div class="lightbox-caption"></div>' +
      '</div>' +
      '<button class="lightbox-nav lightbox-next" aria-label="Next">&rsaquo;</button>';

    document.body.appendChild(self.el);

    self.imgEl = self.el.querySelector('.lightbox-content img');
    self.captionEl = self.el.querySelector('.lightbox-caption');

    self.el.querySelector('.lightbox-close').addEventListener('click', function() {
      self.close();
    });
    self.el.querySelector('.lightbox-prev').addEventListener('click', function(e) {
      e.stopPropagation();
      self.prev();
    });
    self.el.querySelector('.lightbox-next').addEventListener('click', function(e) {
      e.stopPropagation();
      self.next();
    });

    // Close on backdrop click
    self.el.addEventListener('click', function(e) {
      if (e.target === self.el) self.close();
    });

    // Keyboard navigation
    self._keyHandler = function(e) {
      if (!self.el.classList.contains('open')) return;
      if (e.key === 'Escape') self.close();
      else if (e.key === 'ArrowLeft') self.prev();
      else if (e.key === 'ArrowRight') self.next();
    };
    document.addEventListener('keydown', self._keyHandler);

    // Touch swipe support
    var touchStartX = 0;
    self.el.addEventListener('touchstart', function(e) {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });
    self.el.addEventListener('touchend', function(e) {
      var dx = e.changedTouches[0].screenX - touchStartX;
      if (Math.abs(dx) > 50) {
        if (dx < 0) self.next();
        else self.prev();
      }
    }, { passive: true });
  };

  self.open = function(images, startIndex) {
    self._build();
    self.images = images;
    self.index = startIndex || 0;
    self._show();
    self.el.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  self.close = function() {
    if (!self.el) return;
    self.el.classList.remove('open');
    document.body.style.overflow = '';
  };

  self.prev = function() {
    self.index = (self.index - 1 + self.images.length) % self.images.length;
    self._show();
  };

  self.next = function() {
    self.index = (self.index + 1) % self.images.length;
    self._show();
  };

  self._show = function() {
    var item = self.images[self.index];
    if (!item) return;
    self.imgEl.src = item.src;
    self.imgEl.alt = item.caption || '';
    self.captionEl.textContent = item.caption || '';
    self.captionEl.style.display = item.caption ? '' : 'none';

    // Hide nav arrows if only one image
    var showNav = self.images.length > 1;
    self.el.querySelector('.lightbox-prev').style.display = showNav ? '' : 'none';
    self.el.querySelector('.lightbox-next').style.display = showNav ? '' : 'none';
  };
}

/* ── Slideshow ──
   Auto-cycling hero slideshow with crossfade.
   Usage:
     var ss = new Slideshow(containerEl, images, { interval: 15000 });
   Where images is an array of { src, title, artist } objects.
   containerEl should have the .slideshow class applied.
*/
function Slideshow(container, images, opts) {
  var self = this;
  opts = opts || {};
  self.container = container;
  self.images = images;
  self.index = 0;
  self.interval = opts.interval || 15000;
  self.timer = null;
  self.progressTimer = null;
  self.paused = false;
  self.onSlideChange = opts.onSlideChange || null;

  // Build DOM
  self.imgA = document.createElement('img');
  self.imgA.className = 'slideshow-img active';
  self.imgB = document.createElement('img');
  self.imgB.className = 'slideshow-img';

  self.info = document.createElement('div');
  self.info.className = 'slideshow-info';
  self.info.innerHTML = '<div class="slide-title"></div><div class="slide-artist"></div><div class="slide-year"></div>';

  self.progress = document.createElement('div');
  self.progress.className = 'slideshow-progress';

  var prevBtn = document.createElement('button');
  prevBtn.className = 'slideshow-nav slideshow-prev';
  prevBtn.setAttribute('aria-label', 'Previous');
  prevBtn.innerHTML = '&#8249;';

  var nextBtn = document.createElement('button');
  nextBtn.className = 'slideshow-nav slideshow-next';
  nextBtn.setAttribute('aria-label', 'Next');
  nextBtn.innerHTML = '&#8250;';

  container.appendChild(self.imgA);
  container.appendChild(self.imgB);
  container.appendChild(self.info);
  container.appendChild(self.progress);
  container.appendChild(prevBtn);
  container.appendChild(nextBtn);

  // Events
  prevBtn.addEventListener('click', function() { self.prev(); self._restartAuto(); });
  nextBtn.addEventListener('click', function() { self.next(); self._restartAuto(); });

  container.addEventListener('mouseenter', function() { self.paused = true; });
  container.addEventListener('mouseleave', function() { self.paused = false; });

  self.goTo = function(idx) {
    self.index = idx;
    self._showSlide(false);
    self._restartAuto();
  };

  self.prev = function() {
    self.index = (self.index - 1 + self.images.length) % self.images.length;
    self._showSlide(false);
  };

  self.next = function() {
    self.index = (self.index + 1) % self.images.length;
    self._showSlide(false);
  };

  self._showSlide = function(isFirst) {
    var item = self.images[self.index];
    if (!item) return;

    // Crossfade between imgA and imgB
    var active = container.querySelector('.slideshow-img.active');
    var inactive = (active === self.imgA) ? self.imgB : self.imgA;

    inactive.src = item.src;
    inactive.alt = item.title || '';

    if (!isFirst) {
      inactive.classList.add('active');
      active.classList.remove('active');
    } else {
      self.imgA.src = item.src;
      self.imgA.alt = item.title || '';
    }

    // Update info
    self.info.querySelector('.slide-title').textContent = item.title || '';
    self.info.querySelector('.slide-artist').textContent = item.artist || '';
    self.info.querySelector('.slide-year').textContent = item.year || '';

    // Preload next
    var nextIdx = (self.index + 1) % self.images.length;
    var preload = new Image();
    preload.src = self.images[nextIdx].src;

    // Callback
    if (self.onSlideChange) self.onSlideChange(self.index);
  };

  self._startAuto = function() {
    if (self.images.length <= 1) return;

    var elapsed = 0;
    var step = 50;
    self.progress.style.width = '0%';

    self.progressTimer = setInterval(function() {
      if (self.paused) return;
      elapsed += step;
      self.progress.style.width = (elapsed / self.interval * 100) + '%';
      if (elapsed >= self.interval) {
        self.next();
        self._restartAuto();
      }
    }, step);
  };

  self._restartAuto = function() {
    clearInterval(self.progressTimer);
    self._startAuto();
  };

  self.destroy = function() {
    clearInterval(self.progressTimer);
  };

  // Init
  self._showSlide(true);
  self._startAuto();
}
