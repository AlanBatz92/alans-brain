/* ═══════════════════════════════════════════
   STARFIELD — Alan's Brain (Space theme)
   A drifting, twinkling parallax starfield drawn on a fixed full-viewport
   <canvas> behind the page content, plus a small scaffold for occasional
   "background events" — currently a slow comet and shooting stars.
   Vanilla, no deps, no image assets.

   Loaded ON DEMAND by theme-switcher.js only while the "Starfield" theme is
   active, so it costs nothing for every other visitor. Self-boots on load
   (the theme is already set when we're injected), then listens for
   `themechange` to start/stop. Honors prefers-reduced-motion (renders a
   static field, no animation loop) and pauses while the tab is hidden.

   ── BACKGROUND EVENTS SCAFFOLD ──────────────────────────────────────────
   "Events" are occasional flourishes layered over the stars. Each event TYPE
   lives in EVENT_TYPES with two hooks:
     • onFrame(now, dt) — called every frame; decides when to spawn and pushes
       an effect instance into `effects` (own cooldown / data source / etc).
     • reset()          — called on stop, to clear any scheduling state.
   An EFFECT INSTANCE is `{ step(dt) → aliveBool }` — it updates and draws
   itself each frame and returns false once it should be retired.
   To add a new event (meteor shower, satellite pass, aurora…), write a
   make…Type() returning {onFrame, reset} that pushes effects, and add it to
   EVENT_TYPES. Right now: a comet and shooting stars.

   The shooting stars double as a quiet easter egg: when birdstation is
   reachable, each streak is fired by a *real bird detection* from the
   backyard mic (the species is logged to the console). When detections are
   unavailable — overnight, or the box is offline — it falls back to random
   streaks so the sky is never empty.
   ═══════════════════════════════════════════ */
(function () {
  if (window.__starfieldLoaded) return;
  window.__starfieldLoaded = true;

  var canvas = null, ctx = null;
  var stars = [];
  var effects = [];                 // active event effects (comets, shooters…)
  var raf = null, running = false, last = 0;
  var w = 0, h = 0, dpr = 1;
  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Star tints from the site's cool spectrum so the field feels on-brand.
  var STAR_TINTS = ['255,255,255', '224,242,255', '199,224,255', '226,214,255'];

  /* ── Tunable knobs (exposed for tinkering from the console) ───────────── */
  var CFG = {
    comet: {
      // A comet is the "special event". It fires on a rare bird moment (a new
      // lifer, or a seldom-heard species) and, failing that, drifts by on a long
      // ambient timer so the sky still gets one now and then.
      minGap: 360000, maxGap: 960000,   // ambient fallback cadence (~6–16 min)
      firstMin: 30000, firstMax: 90000, // first ambient comet after load
      minSpacing: 30000                 // never two comets closer than this (caps bursts)
    },
    shooter: {
      randChance: 0.004,    // per-frame odds of a fallback streak when birds are quiet
      maxActive: 3,
      releaseGap: 2600,     // ms between releasing queued bird streaks (so they don't burst)
      idleBeforeRandom: 45000 // ms of bird silence before random streaks take over
    },
    birds: {
      url: 'https://birds.alansbrain.com/api/detections?limit=8&min_confidence=0.85',
      lifeUrl: 'https://birds.alansbrain.com/api/lifetime',
      pollMs: 90000,        // how often to check for new detections
      lifePollMs: 300000,   // how often to check the life list (lifers are rare)
      timeoutMs: 6000,
      queueCap: 6,
      rareMax: 3,           // a life-listed species with <= this many all-time hits = "rare" → comet
      showLabels: false     // set true to draw the species name beside its streak
    }
  };
  window.STARFIELD_CONFIG = CFG;

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

  function drawStars(animate, dt) {
    var step = dt / 16;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      if (animate) {
        s.y += s.vy * step;
        if (s.y > h + 2) { s.y = -2; s.x = Math.random() * w; }
        s.tw += s.tws * (dt / 1000) * Math.PI;
        drawStar(s, s.baseAlpha * (0.6 + 0.4 * Math.sin(s.tw)), i % STAR_TINTS.length);
      } else {
        drawStar(s, s.baseAlpha, i % STAR_TINTS.length);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawStatic() {
    ctx.clearRect(0, 0, w, h);
    drawStars(false, 0);
  }

  /* ═══════════════════════════════════════════
     EFFECT: SHOOTING STAR
     A fast streak with a fading tail. `bird` carries an optional species name
     so a detection-driven streak can announce itself; random fallback streaks
     leave it null.
     ═══════════════════════════════════════════ */
  function makeShooter(bird) {
    var speed = 6 + Math.random() * 4;
    var angle = (Math.PI / 4) + (Math.random() - 0.5) * 0.5; // roughly down-right
    var sh = {
      x: Math.random() * w * 0.6,
      y: Math.random() * h * 0.3,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      bird: bird || null
    };
    sh.step = function (dt) {
      var step = dt / 16;
      sh.x += sh.vx * step;
      sh.y += sh.vy * step;
      var tailX = sh.x - sh.vx * 8, tailY = sh.y - sh.vy * 8;
      // Retire only once the whole streak (head AND trailing tail) has left the
      // viewport, so it always flies off screen rather than blinking out mid-flight.
      if (tailX > w || tailY > h) return false;
      var grad = ctx.createLinearGradient(sh.x, sh.y, tailX, tailY);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
      if (sh.bird && CFG.birds.showLabels) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = 'rgba(224,242,255,0.9)';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(sh.bird, sh.x + 6, sh.y - 4);
        ctx.globalAlpha = 1;
      }
      return true;
    };
    return sh;
  }

  /* ═══════════════════════════════════════════
     EFFECT: COMET
     A slow interstellar visitor (think 3I/ATLAS) — a glowing, faintly green
     coma with a long soft tail, drifting all the way across the viewport over
     many seconds. Drawn entirely with canvas gradients, no image.
     ═══════════════════════════════════════════ */
  function makeComet() {
    // Enter from the upper-left third, drift slowly down-and-across.
    var fromLeft = Math.random() < 0.7;
    var speed = 0.5 + Math.random() * 0.45;           // px per 16ms — deliberately slow
    var angle = (Math.PI / 5) + (Math.random() - 0.5) * 0.45; // shallow downward drift
    var c = {
      x: fromLeft ? -60 : Math.random() * w * 0.5,
      y: fromLeft ? Math.random() * h * 0.4 : -60,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 1.8 + Math.random() * 1.4,                   // nucleus radius
      coma: 9 + Math.random() * 5,                    // glow radius
      tail: 130 + Math.random() * 90,                 // tail length
      life: 0
    };
    c.step = function (dt) {
      var step = dt / 16;
      c.x += c.vx * step;
      c.y += c.vy * step;
      c.life += dt;
      // Fade in over the first ~1.2s, hold, then it simply leaves the screen.
      var alpha = Math.min(1, c.life / 1200);

      // Off screen (with margin for the trailing tail) → retire.
      var len = Math.sqrt(c.vx * c.vx + c.vy * c.vy) || 1;
      var ux = c.vx / len, uy = c.vy / len;
      if (c.x - ux * c.tail > w + 40 || c.y - uy * c.tail > h + 40) return false;

      // Tail: a tapering wedge, widest at the head, fading to a point behind it.
      var tx = c.x - ux * c.tail, ty = c.y - uy * c.tail; // tail tip
      var pxv = -uy, pyv = ux;                            // perpendicular
      var hw = c.coma * 0.85;                             // half-width at the head
      var tg = ctx.createLinearGradient(c.x, c.y, tx, ty);
      tg.addColorStop(0, 'rgba(150,235,255,' + (0.30 * alpha) + ')');
      tg.addColorStop(0.4, 'rgba(140,225,235,' + (0.12 * alpha) + ')');
      tg.addColorStop(1, 'rgba(120,220,210,0)');
      ctx.fillStyle = tg;
      ctx.beginPath();
      ctx.moveTo(c.x + pxv * hw, c.y + pyv * hw);
      ctx.lineTo(c.x - pxv * hw, c.y - pyv * hw);
      ctx.lineTo(tx, ty);
      ctx.closePath();
      ctx.fill();

      // Coma: a soft radial glow with a faint green-white cast.
      var cg = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.coma);
      cg.addColorStop(0, 'rgba(235,255,245,' + (0.95 * alpha) + ')');
      cg.addColorStop(0.4, 'rgba(170,240,220,' + (0.45 * alpha) + ')');
      cg.addColorStop(1, 'rgba(150,230,210,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.coma, 0, Math.PI * 2);
      ctx.fill();

      // Nucleus: a bright little core.
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return true;
    };
    return c;
  }

  /* ═══════════════════════════════════════════
     BIRD DETECTIONS → shooting stars
     Polls birdstation for recent detections; new ones queue up and are
     released as streaks. Fails silent (box offline / CORS / overnight quiet)
     and the shooter event falls back to random streaks.
     ═══════════════════════════════════════════ */
  var birdQueue = [];        // queued detections → streaks ({ name, rare })
  var lastSeenTs = null;     // newest detection timestamp we've already handled
  var pollTimer = null, lifePollTimer = null;
  var lifeSet = null;        // set of life-list species names (null until first load)
  var lifeCount = {};        // species name → all-time count (for rarity)
  var pendingComet = null;   // a requested special-event comet, awaiting a free slot
  var lastCometAt = -1e9;    // last comet spawn time (enforces CFG.comet.minSpacing)

  function pollBirds() {
    if (!running || document.hidden || reduceMotion) return;
    if (!window.fetch) return;
    var ctrl = null, to = null;
    try {
      ctrl = new AbortController();
      to = setTimeout(function () { ctrl.abort(); }, CFG.birds.timeoutMs);
    } catch (e) { /* no AbortController — fetch without timeout */ }

    fetch(CFG.birds.url, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (to) clearTimeout(to);
        if (!data || !data.detections || !data.detections.length) return;
        // API returns newest-first; walk oldest→newest so streaks fire in order.
        var rows = data.detections.slice().reverse();
        var maxTs = lastSeenTs;
        for (var i = 0; i < rows.length; i++) {
          var ts = rows[i].timestamp;
          if (!ts) continue;
          if (lastSeenTs !== null && ts > lastSeenTs) {
            birdQueue.push({ name: rows[i].common_name || 'a bird', rare: isRare(rows[i]) });
          }
          if (maxTs === null || ts > maxTs) maxTs = ts;
        }
        lastSeenTs = maxTs;        // first poll just sets the baseline (no burst)
        if (birdQueue.length > CFG.birds.queueCap) {
          birdQueue = birdQueue.slice(-CFG.birds.queueCap);
        }
      })
      .catch(function () { if (to) clearTimeout(to); /* stay quiet, fall back */ });
  }

  // A detection is "rare" if its species is on the life list with very few
  // all-time hits. Unknown (life list not loaded yet) → treat as not rare.
  function isRare(row) {
    if (!lifeSet) return false;
    var sci = row.scientific_name, com = row.common_name;
    var total = (sci != null && lifeCount[sci] != null) ? lifeCount[sci]
              : (com != null && lifeCount[com] != null) ? lifeCount[com] : null;
    return total != null && total <= CFG.birds.rareMax;
  }

  // Poll the life list: a newly-appeared species fires a (special) comet.
  function pollLife() {
    if (!running || document.hidden || reduceMotion || !window.fetch) return;
    var ctrl = null, to = null;
    try {
      ctrl = new AbortController();
      to = setTimeout(function () { ctrl.abort(); }, CFG.birds.timeoutMs);
    } catch (e) { /* no AbortController */ }

    fetch(CFG.birds.lifeUrl, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (to) clearTimeout(to);
        var species = data && (data.species || data.lifetime);
        if (!species || !species.length) return;
        var firstLoad = (lifeSet === null);
        var newSet = {}, counts = {}, newcomer = null;
        for (var i = 0; i < species.length; i++) {
          var s = species[i], com = s.common_name, sci = s.scientific_name;
          var total = (s.total_detections != null) ? s.total_detections
                    : (s.count != null ? s.count : 0);
          if (com) { newSet[com] = 1; counts[com] = total; }
          if (sci) { newSet[sci] = 1; counts[sci] = total; }
          if (!firstLoad && !newcomer &&
              !((com && lifeSet[com]) || (sci && lifeSet[sci]))) {
            newcomer = com || sci || 'a new bird';
          }
        }
        lifeSet = newSet; lifeCount = counts;
        if (newcomer) requestComet('lifer', newcomer);
      })
      .catch(function () { if (to) clearTimeout(to); });
  }

  // Ask for a special-event comet; the comet event picks it up at the next free
  // slot (one queued at a time, spacing enforced in the event).
  function requestComet(reason, name) {
    if (!pendingComet) pendingComet = { reason: reason, name: name };
  }

  function spawnComet(info) {
    var c = makeComet();
    c.kind = 'comet';
    effects.push(c);
    if (info && window.console && console.log) {
      var msg = info.reason === 'lifer'
        ? '☄️ ' + info.name + ' just joined the life list — a comet flies for it'
        : '☄️ rare visitor: ' + info.name + ' — a comet flies for it';
      console.log('%c' + msg, 'color:#9be7ff;font-weight:700');
    }
  }

  function startPolling() {
    if (reduceMotion) return;
    if (!pollTimer) { pollBirds(); pollTimer = setInterval(pollBirds, CFG.birds.pollMs); }
    if (!lifePollTimer) { pollLife(); lifePollTimer = setInterval(pollLife, CFG.birds.lifePollMs); }
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (lifePollTimer) { clearInterval(lifePollTimer); lifePollTimer = null; }
  }

  /* ═══════════════════════════════════════════
     EVENT TYPES (the scaffold)
     ═══════════════════════════════════════════ */
  function countEffects(kind) {
    var n = 0;
    for (var i = 0; i < effects.length; i++) if (effects[i].kind === kind) n++;
    return n;
  }

  function makeCometType() {
    var nextAt = 0;
    function reschedule(now) {
      nextAt = now + CFG.comet.minGap + Math.random() * (CFG.comet.maxGap - CFG.comet.minGap);
    }
    return {
      id: 'comet',
      reset: function () { nextAt = 0; },
      onFrame: function (now) {
        if (countEffects('comet') > 0) return;            // one comet at a time
        if (now - lastCometAt < CFG.comet.minSpacing) return;
        // A special bird event (new lifer / rare detection) → a comet, now.
        if (pendingComet) {
          spawnComet(pendingComet);
          pendingComet = null;
          lastCometAt = now;
          reschedule(now);
          return;
        }
        // Ambient fallback comet on a long timer (first one comes sooner).
        if (!nextAt) {
          nextAt = now + CFG.comet.firstMin + Math.random() * (CFG.comet.firstMax - CFG.comet.firstMin);
          return;
        }
        if (now >= nextAt) {
          spawnComet(null);
          lastCometAt = now;
          reschedule(now);
        }
      }
    };
  }

  function makeShooterType() {
    // Start "long ago" so random fallback streaks fire from the first second
    // (when the box is offline); a real bird streak then suppresses them for a
    // window, so during active birding the sky is detection-driven.
    var lastBirdSpawn = -1e9; // last time a detection-driven streak fired
    var lastRelease = 0;      // last time we popped the bird queue
    return {
      id: 'shooter',
      reset: function () { lastBirdSpawn = -1e9; lastRelease = 0; },
      onFrame: function (now) {
        var s = CFG.shooter;
        if (countEffects('shooter') >= s.maxActive) return;

        // 1) A real bird detection is queued → release it.
        if (birdQueue.length && now - lastRelease > s.releaseGap) {
          var item = birdQueue.shift();
          lastRelease = now;
          lastBirdSpawn = now;
          if (item.rare) {
            // A seldom-heard bird → promote it to a comet rather than a streak.
            requestComet('rare', item.name);
          } else {
            var sh = makeShooter(item.name);
            sh.kind = 'shooter';
            effects.push(sh);
            if (window.console && console.log) {
              console.log('%c🐦 ' + item.name + '%c — a shooting star, courtesy of birdstation',
                'color:#34d399;font-weight:700', 'color:#7c8aa5');
            }
          }
          return;
        }

        // 2) Birds quiet (overnight / offline) → fall back to random streaks.
        if (now - lastBirdSpawn > s.idleBeforeRandom && Math.random() < s.randChance) {
          var r = makeShooter(null);
          r.kind = 'shooter';
          effects.push(r);
        }
      }
    };
  }

  var EVENT_TYPES = [makeCometType(), makeShooterType()];

  /* ═══════════════════════════════════════════
     MAIN LOOP
     ═══════════════════════════════════════════ */
  function frame(t) {
    if (!running) return;
    var dt = last ? (t - last) : 16;
    last = t;
    ctx.clearRect(0, 0, w, h);

    drawStars(true, dt);

    // Spawn pass: let each event type decide whether to add an effect.
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    for (var k = 0; k < EVENT_TYPES.length; k++) EVENT_TYPES[k].onFrame(now, dt);

    // Tick pass: update + draw effects, drop the finished ones.
    for (var j = effects.length - 1; j >= 0; j--) {
      if (!effects[j].step(dt)) effects.splice(j, 1);
    }
    ctx.globalAlpha = 1;

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
    startPolling();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    stopPolling();
    if (canvas) { ctx.clearRect(0, 0, w, h); canvas.style.display = 'none'; }
    effects = [];
    birdQueue = [];
    lastSeenTs = null; lifeSet = null; lifeCount = {};
    pendingComet = null; lastCometAt = -1e9;
    for (var k = 0; k < EVENT_TYPES.length; k++) EVENT_TYPES[k].reset();
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

  // ── Dev / verification hooks ───────────────────────────────────────────
  // Handy for confirming the bird-driven events on the live site (must be on the
  // Starfield theme). In the browser console:
  //   __starfield.status()                                  → connection + state
  //   __starfield.testStreak('Northern Cardinal')           → a bird streak now
  //   __starfield.testComet('lifer','Pileated Woodpecker')  → a comet now
  window.__starfield = {
    status: function () {
      return {
        running: running,
        detectionsConnected: lastSeenTs !== null, // /api/detections reached (baseline set)
        lifeListConnected: lifeSet !== null,       // /api/lifetime reached
        queuedStreaks: birdQueue.length,
        activeEffects: effects.length
      };
    },
    testStreak: function (name) {
      if (!running) return 'not running — switch to the Starfield theme first';
      var sh = makeShooter(name || 'test bird'); sh.kind = 'shooter'; effects.push(sh);
      return 'spawned a streak for ' + (name || 'test bird');
    },
    testComet: function (reason, name) {
      if (!running) return 'not running — switch to the Starfield theme first';
      spawnComet({ reason: reason || 'rare', name: name || 'test bird' });
      return 'spawned a comet (' + (reason || 'rare') + ': ' + (name || 'test bird') + ')';
    }
  };

  // Start/stop as the user switches skins.
  window.addEventListener('themechange', function (e) {
    if (e.detail && e.detail.theme === 'starfield') start();
    else stop();
  });

  // We were injected because the Starfield theme is active — kick it off.
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
