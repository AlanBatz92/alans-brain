/* ═══════════════════════════════════════════
   STARFIELD — Alan's Brain (Space theme)
   A drifting, twinkling parallax starfield with the occasional shooting
   star, drawn on a fixed full-viewport <canvas> behind the page content.
   Vanilla, no deps, no assets.

   Loaded ON DEMAND by theme-switcher.js only while the "Starfield" theme is
   active, so it costs nothing for every other visitor. Self-boots on load
   (the theme is already set when we're injected), then listens for
   `themechange` to start/stop. Honors prefers-reduced-motion (renders a
   static field, no animation loop) and pauses while the tab is hidden.
   ═══════════════════════════════════════════ */
(function () {
  if (window.__starfieldLoaded) return;
  window.__starfieldLoaded = true;

  var canvas = null, ctx = null;
  var stars = [], shooters = [];
  var raf = null, running = false, last = 0;
  var w = 0, h = 0, dpr = 1;
  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Star tints from the site's cool spectrum so the field feels on-brand.
  var STAR_TINTS = ['255,255,255', '224,242,255', '199,224,255', '226,214,255'];

  function makeCanvas() {
    canvas = document.createElement('canvas');
    canvas.id = 'starfield-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    // z-index 0 sits with the ambient blobs, below .page (z-index 1).
    canvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initStars();
  }

  function initStars() {
    // Density scales with viewport area, capped so phones stay smooth.
    var count = Math.min(220, Math.round((w * h) / 6000));
    stars = [];
    for (var i = 0; i < count; i++) {
      var depth = Math.random();           // 0 = far (small/dim/slow) … 1 = near
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.4 + depth * 1.4,
        baseAlpha: 0.35 + depth * 0.5,
        vy: 0.02 + depth * 0.06,           // nearer stars drift faster (parallax)
        tw: Math.random() * Math.PI * 2,   // twinkle phase
        tws: 0.45 + Math.random() * 1.2    // twinkle speed (eased ~25% for a calmer shimmer)
      });
    }
  }

  function drawStar(s, alpha, tintIdx) {
    ctx.globalAlpha = alpha < 0 ? 0 : alpha;
    ctx.fillStyle = 'rgb(' + STAR_TINTS[tintIdx] + ')';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawStatic() {
    ctx.clearRect(0, 0, w, h);
    for (var i = 0; i < stars.length; i++) {
      drawStar(stars[i], stars[i].baseAlpha, i % STAR_TINTS.length);
    }
    ctx.globalAlpha = 1;
  }

  function spawnShooter() {
    var speed = 6 + Math.random() * 4;
    var angle = (Math.PI / 4) + (Math.random() - 0.5) * 0.5; // roughly down-right
    shooters.push({
      x: Math.random() * w * 0.6,
      y: Math.random() * h * 0.3,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed
    });
  }

  function frame(t) {
    if (!running) return;
    var dt = last ? (t - last) : 16;
    last = t;
    ctx.clearRect(0, 0, w, h);

    var step = dt / 16;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.y += s.vy * step;
      if (s.y > h + 2) { s.y = -2; s.x = Math.random() * w; }
      s.tw += s.tws * (dt / 1000) * Math.PI;
      drawStar(s, s.baseAlpha * (0.6 + 0.4 * Math.sin(s.tw)), i % STAR_TINTS.length);
    }
    ctx.globalAlpha = 1;

    // Occasional shooting star — kept rare and capped for taste.
    if (Math.random() < 0.004 && shooters.length < 2) spawnShooter();
    for (var j = shooters.length - 1; j >= 0; j--) {
      var sh = shooters[j];
      sh.x += sh.vx * step;
      sh.y += sh.vy * step;
      var tailX = sh.x - sh.vx * 8, tailY = sh.y - sh.vy * 8;
      // Retire only once the whole streak (head AND trailing tail) has left the
      // viewport, so it always flies off screen rather than blinking out mid-flight.
      if (tailX > w || tailY > h) { shooters.splice(j, 1); continue; }
      var grad = ctx.createLinearGradient(sh.x, sh.y, tailX, tailY);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
    }

    raf = requestAnimationFrame(frame);
  }

  var resizeTimer;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!canvas) return;
      resize();
      if (reduceMotion && canvas.style.display !== 'none') drawStatic();
    }, 150);
  }

  function start() {
    if (!canvas) {
      makeCanvas();
      resize();
      window.addEventListener('resize', onResize);
    }
    canvas.style.display = '';
    if (reduceMotion) { drawStatic(); running = false; return; }
    if (running) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    if (canvas) { ctx.clearRect(0, 0, w, h); canvas.style.display = 'none'; }
    shooters = [];
  }

  // Pause the loop while the tab is backgrounded; resume on return.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
    } else if (running && !reduceMotion) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  });

  // Start/stop as the user switches skins.
  window.addEventListener('themechange', function (e) {
    if (e.detail && e.detail.theme === 'starfield') start();
    else stop();
  });

  // We were injected because the Starfield theme is active — kick it off.
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
