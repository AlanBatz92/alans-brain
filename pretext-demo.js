/* ═══════════════════════════════════════════
   PreText Playground — Interactive Text Canvas
   Characters physically react to your mouse!
   ═══════════════════════════════════════════ */

const TRANSCRIPT = `Earlier this week the world may have changed forever. No it's not because I finally figured out who was stealing all the water off the top of my Greek yogurt. It's because Changlu, a former React core team member and engineer at Midjourney, claims to have crawled through the depths of hell to bring us PreText, a fast, secure, accurate, and comprehensive text measurement library written in pure TypeScript. Now I know if you don't have a deep innate interest in trains that might sound boring but it's actually a massive game changer for UI development. Ever since Al Gore invented the internet rendering dynamic text has had a performance trade-off. When the browser needs to figure out how tall a paragraph is or where to break a line it has to trigger a layout reflow which often calculates the position and geometry of every element on the page. This reflow is one of the most expensive operations a browser can perform. But it's also what the browser needs to do whenever you ask it for the height of any text element. This makes it unreasonably difficult to build any sort of text heavy UI like a virtualized list or a masonry layout. But now finally in 2026 with PreText you may be able to have your cake and eat it too. A decade ago while the rest of us were busy mourning the death of Harambe Chang spent his time studying the blade of front-end infrastructure at Facebook while also building React Motion one of the most popular animation libraries in the React ecosystem. What Chang figured out is that you don't actually need to ask the browser for text dimensions at all. Before getting the width he used the canvas API which lives outside the DOM and gives you the pixel width of any string in any font without triggering reflows or layout calculations. The result is a surprisingly simple API. You first prepare your text which breaks it apart into segments and then caches each segment width. Then you call layout which gives you the total height and line count of that text all without ever having to touch the DOM or trigger a reflow. You can build some pretty crazy apps.`;

// ── Config ──
const FONT_SIZE = 18;
const FONT = `bold ${FONT_SIZE}px "JetBrains Mono", monospace`;
const CELL_W = 12;
const CELL_H = 22;
const BG = '#0a0e1a';

const COL_TEAL   = [45, 212, 191];
const COL_BLUE   = [56, 189, 248];
const COL_PURPLE = [167, 139, 250];
const COL_DIM    = [90, 99, 128];

// ── Pre-build color LUT ──
const BLVLS = 24;
const stdCols = [], mtxCols = [], camCols = [];
for (let i = 0; i < BLVLS; i++) {
  const b = i / (BLVLS - 1);
  let cr, cg, cb;
  if (b < 0.3)     { const t=b/0.3; cr=COL_DIM[0]+(COL_TEAL[0]-COL_DIM[0])*t; cg=COL_DIM[1]+(COL_TEAL[1]-COL_DIM[1])*t; cb=COL_DIM[2]+(COL_TEAL[2]-COL_DIM[2])*t; }
  else if (b < 0.7) { const t=(b-0.3)/0.4; cr=COL_TEAL[0]+(COL_BLUE[0]-COL_TEAL[0])*t; cg=COL_TEAL[1]+(COL_BLUE[1]-COL_TEAL[1])*t; cb=COL_TEAL[2]+(COL_BLUE[2]-COL_TEAL[2])*t; }
  else              { const t=(b-0.7)/0.3; cr=COL_BLUE[0]+(COL_PURPLE[0]-COL_BLUE[0])*t; cg=COL_BLUE[1]+(COL_PURPLE[1]-COL_BLUE[1])*t; cb=COL_BLUE[2]+(COL_PURPLE[2]-COL_BLUE[2])*t; }
  stdCols[i] = `rgba(${cr|0},${cg|0},${cb|0},${Math.min(1,b*1.5+0.05).toFixed(2)})`;
  mtxCols[i] = `rgba(${b*45|0},${50+b*205|0},${b*80|0},${Math.min(1,b+0.1).toFixed(2)})`;
  camCols[i] = `rgba(232,236,244,${b.toFixed(2)})`;
}

// ── Glyph atlas: pre-render each char at each brightness into ImageBitmaps ──
// Key: charCode * BLVLS * 3 + blvl * 3 + scheme
const GLYPH_W = CELL_W * 2; // render space per glyph
const GLYPH_H = CELL_H * 2;
let glyphAtlas = null;  // single canvas with all glyphs
let glyphMap = {};      // { key -> {x,y} } positions in atlas

function buildGlyphAtlas() {
  const chars = new Set();
  for (let i = 0; i < TRANSCRIPT.length; i++) chars.add(TRANSCRIPT[i]);
  const charArr = [...chars];

  const perRow = 32;
  const totalGlyphs = charArr.length * BLVLS * 3;
  const atlasRows = Math.ceil(totalGlyphs / perRow);

  glyphAtlas = document.createElement('canvas');
  glyphAtlas.width = perRow * GLYPH_W;
  glyphAtlas.height = atlasRows * GLYPH_H;
  const g = glyphAtlas.getContext('2d');
  g.font = FONT;
  g.textBaseline = 'middle';
  g.textAlign = 'center';

  let si = 0;
  const schemes = ['std', 'mtx', 'cam'];
  const luts = [stdCols, mtxCols, camCols];

  for (let si2 = 0; si2 < 3; si2++) {
    const lut = luts[si2];
    const sch = schemes[si2];
    for (let bi = 0; bi < BLVLS; bi++) {
      g.fillStyle = lut[bi];
      for (const ch of charArr) {
        const col = si % perRow;
        const row = (si / perRow) | 0;
        const x = col * GLYPH_W + GLYPH_W / 2;
        const y = row * GLYPH_H + GLYPH_H / 2;
        g.fillText(ch, x, y);
        glyphMap[`${sch}_${bi}_${ch}`] = { x: col * GLYPH_W, y: row * GLYPH_H };
        si++;
      }
    }
  }
}

// ── State ──
let canvas, ctx, dpr;
let cols = 0, rows = 0, N = 0;
let cW = 0, cH = 0;
let grid;
let ox, oy, vx, vy, br, tbr;

let mouseX = -1, mouseY = -1, pmx = -1, pmy = -1, mvx = 0, mvy = 0;
let mode = 'ripple';
let ripples = [];
let time = 0;
let rainDrops = [];
let webcamActive = false, wcVid = null, wcCvs = null, wcCtx = null;
let frameCount = 0, lastFT = performance.now(), fps = 0;

function init() {
  canvas = document.getElementById('textCanvas');
  ctx = canvas.getContext('2d');
  buildGlyphAtlas();
  resize();
  bind();
  setTimeout(() => document.getElementById('loading').classList.add('hidden'), 300);
  requestAnimationFrame(loop);
}

function resize() {
  const wrap = document.getElementById('canvas-wrap');
  const rc = wrap.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  cW = rc.width; cH = rc.height;
  canvas.width = cW * dpr;
  canvas.height = cH * dpr;
  canvas.style.width = cW + 'px';
  canvas.style.height = cH + 'px';

  cols = Math.floor(cW / CELL_W);
  rows = Math.floor(cH / CELL_H);
  N = cols * rows;

  grid = new Array(N);
  for (let i = 0; i < N; i++) grid[i] = TRANSCRIPT[i % TRANSCRIPT.length];

  ox = new Float32Array(N);
  oy = new Float32Array(N);
  vx = new Float32Array(N);
  vy = new Float32Array(N);
  br = new Float32Array(N).fill(0.08);
  tbr = new Float32Array(N).fill(0.08);

  rainDrops = [];
  for (let c = 0; c < cols; c++)
    rainDrops[c] = { y: Math.random()*rows*-2, sp: 0.3+Math.random()*0.7, ln: 5+(Math.random()*15|0) };

  document.getElementById('stat-grid').textContent = `${cols}x${rows}`;
  document.getElementById('stat-chars').textContent = N.toLocaleString();
}

function bind() {
  window.addEventListener('resize', resize);
  const w = document.getElementById('canvas-wrap');
  w.addEventListener('mousemove', e => {
    const r = w.getBoundingClientRect();
    pmx = mouseX; pmy = mouseY;
    mouseX = e.clientX-r.left; mouseY = e.clientY-r.top;
    if (pmx >= 0) { mvx = mouseX-pmx; mvy = mouseY-pmy; }
  });
  w.addEventListener('mouseleave', () => { mouseX=-1; mouseY=-1; pmx=-1; mvx=0; mvy=0; });
  w.addEventListener('click', e => {
    const r = w.getBoundingClientRect();
    ripples.push({ cx: e.clientX-r.left, cy: e.clientY-r.top, rad: 0, str: 1 });
  });
  w.addEventListener('touchstart', e => {
    const r = w.getBoundingClientRect(); const t = e.touches[0];
    mouseX = t.clientX-r.left; mouseY = t.clientY-r.top;
    ripples.push({ cx: mouseX, cy: mouseY, rad: 0, str: 1 });
  });
  w.addEventListener('touchmove', e => {
    e.preventDefault();
    const r = w.getBoundingClientRect(); const t = e.touches[0];
    pmx = mouseX; pmy = mouseY;
    mouseX = t.clientX-r.left; mouseY = t.clientY-r.top;
    if (pmx >= 0) { mvx = mouseX-pmx; mvy = mouseY-pmy; }
  }, { passive: false });
  w.addEventListener('touchend', () => { mouseX=-1; mouseY=-1; pmx=-1; mvx=0; mvy=0; });

  document.querySelectorAll('.controls button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.controls button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const m = b.dataset.mode;
      if (m === 'webcam') startCam(); else if (webcamActive) stopCam();
      mode = m;
      document.getElementById('stat-mode').textContent = m;
    });
  });
}

async function startCam() {
  if (webcamActive) return;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { width: cols, height: rows } });
    wcVid = document.createElement('video'); wcVid.srcObject = s; wcVid.play();
    wcCvs = document.createElement('canvas'); wcCvs.width = cols; wcCvs.height = rows;
    wcCtx = wcCvs.getContext('2d', { willReadFrequently: true }); webcamActive = true;
  } catch(e) {
    mode = 'ripple'; document.getElementById('stat-mode').textContent = 'ripple';
    document.querySelector('[data-mode="ripple"]').classList.add('active');
    document.querySelector('[data-mode="webcam"]').classList.remove('active');
  }
}
function stopCam() {
  if (wcVid?.srcObject) wcVid.srcObject.getTracks().forEach(t => t.stop());
  wcVid = null; wcCvs = null; wcCtx = null; webcamActive = false;
}

// ═══════════════
// PHYSICS
// ═══════════════

function physics() {
  time += 0.016;
  switch (mode) {
    case 'ripple':  fxRipple(); break;
    case 'gravity': fxGravity(); break;
    case 'wave':    fxWave(); break;
    case 'reveal':  fxReveal(); break;
    case 'matrix':  fxMatrix(); break;
    case 'webcam':  fxWebcam(); break;
  }

  // Click ripple forces — only check cells near wavefront
  for (let ri = ripples.length - 1; ri >= 0; ri--) {
    const rp = ripples[ri];
    rp.rad += 7; rp.str *= 0.96;
    if (rp.str < 0.004) { ripples.splice(ri, 1); continue; }
    const band = 25;
    const rOuter = rp.rad + band, rInner = rp.rad - band;
    const r0 = Math.max(0, ((rp.cy - rOuter)/CELL_H|0)-1);
    const r1 = Math.min(rows-1, ((rp.cy + rOuter)/CELL_H|0)+1);
    const c0 = Math.max(0, ((rp.cx - rOuter)/CELL_W|0)-1);
    const c1 = Math.min(cols-1, ((rp.cx + rOuter)/CELL_W|0)+1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const i = r*cols+c;
      const px = c*CELL_W+CELL_W*0.5, py = r*CELL_H+CELL_H*0.5;
      const dx = px-rp.cx, dy = py-rp.cy;
      const dist = Math.sqrt(dx*dx+dy*dy);
      const ringD = Math.abs(dist - rp.rad);
      if (ringD < band && dist > 0.5) {
        const push = (1-ringD/band)*rp.str*6;
        const a = Math.atan2(dy, dx);
        vx[i] += Math.cos(a)*push*0.35;
        vy[i] += Math.sin(a)*push*0.35;
        tbr[i] = Math.max(tbr[i], (1-ringD/band)*rp.str*0.9);
      }
    }
  }

  // Integrate
  for (let i = 0; i < N; i++) {
    vx[i] = (vx[i] - ox[i]*0.08) * 0.88;
    vy[i] = (vy[i] - oy[i]*0.08) * 0.88;
    ox[i] += vx[i]; oy[i] += vy[i];
    if (ox[i] > 30) ox[i] = 30; else if (ox[i] < -30) ox[i] = -30;
    if (oy[i] > 30) oy[i] = 30; else if (oy[i] < -30) oy[i] = -30;
    br[i] += (tbr[i]-br[i]) * 0.14;
  }
  mvx *= 0.85; mvy *= 0.85;
}

function mouseArea(rad, fn) {
  if (mouseX < 0) return;
  const r0 = Math.max(0, ((mouseY-rad)/CELL_H|0)-1);
  const r1 = Math.min(rows-1, ((mouseY+rad)/CELL_H|0)+1);
  const c0 = Math.max(0, ((mouseX-rad)/CELL_W|0)-1);
  const c1 = Math.min(cols-1, ((mouseX+rad)/CELL_W|0)+1);
  const r2 = rad*rad;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const i = r*cols+c;
    const px = c*CELL_W+CELL_W*0.5, py = r*CELL_H+CELL_H*0.5;
    const dx = px-mouseX, dy = py-mouseY;
    const d2 = dx*dx+dy*dy;
    if (d2 < r2 && d2 > 0.5) fn(i, dx, dy, Math.sqrt(d2), 1-Math.sqrt(d2)/rad);
  };
}

function fxRipple() {
  for (let i = 0; i < N; i++) tbr[i] = 0.08;
  mouseArea(100, (i, dx, dy, dist, f) => {
    const a = Math.atan2(dy, dx);
    vx[i] += Math.cos(a)*f*2.2 + mvx*f*0.18;
    vy[i] += Math.sin(a)*f*2.2 + mvy*f*0.18;
    tbr[i] = Math.max(tbr[i], f*f*0.95);
  });
}

function fxGravity() {
  for (let i = 0; i < N; i++) tbr[i] = 0.06;
  mouseArea(200, (i, dx, dy, dist, f) => {
    const a = Math.atan2(-dy, -dx);
    vx[i] += Math.cos(a)*f*f*1.8;
    vy[i] += Math.sin(a)*f*f*1.8;
    const ring = Math.exp(-((dist-55)**2)/1200);
    tbr[i] = Math.max(tbr[i], f*0.45+ring*0.65);
  });
}

function fxWave() {
  for (let i = 0; i < N; i++) {
    const r = (i/cols)|0, c = i%cols;
    const px = c*CELL_W, py = r*CELL_H;
    const w1 = Math.sin(px*0.02+time*2.5)*8;
    const w2 = Math.cos(py*0.03+time*1.8)*6;
    const w3 = Math.sin((px+py)*0.015+time*3.2)*4;
    vx[i] += (w1+w3*0.5-ox[i])*0.04;
    vy[i] += (w2+w3*0.5-oy[i])*0.04;
    const b1 = (Math.sin(c*0.15+time*2)*0.5+0.5)*(Math.sin(r*0.2+time*1.5)*0.5+0.5);
    tbr[i] = b1*0.7+0.15;
  }
  mouseArea(90, (i, dx, dy, dist, f) => {
    vx[i] += mvx*f*0.35; vy[i] += mvy*f*0.35;
    tbr[i] = Math.min(1, tbr[i]+f*0.45);
  });
}

function fxReveal() {
  for (let i = 0; i < N; i++) {
    tbr[i] = 0;
    vx[i] += (Math.random()-0.5)*0.2;
    vy[i] += (Math.random()-0.5)*0.2;
  }
  if (mouseX < 0) return;
  const rad = 140;
  const r0 = Math.max(0, ((mouseY-rad)/CELL_H|0)-1);
  const r1 = Math.min(rows-1, ((mouseY+rad)/CELL_H|0)+1);
  const c0 = Math.max(0, ((mouseX-rad)/CELL_W|0)-1);
  const c1 = Math.min(cols-1, ((mouseX+rad)/CELL_W|0)+1);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const i = r*cols+c;
    const px = c*CELL_W+CELL_W*0.5, py = r*CELL_H+CELL_H*0.5;
    const dist = Math.sqrt((px-mouseX)**2+((py-mouseY)*0.7)**2);
    if (dist < rad) {
      const f = 1-dist/rad;
      vx[i] += -ox[i]*f*0.08; vy[i] += -oy[i]*f*0.08;
      tbr[i] = f*f;
    }
  }
}

function fxMatrix() {
  for (let i = 0; i < N; i++) tbr[i] = 0.02;
  for (let c = 0; c < cols; c++) {
    const d = rainDrops[c]; d.y += d.sp;
    if (d.y > rows+d.ln) { d.y = -d.ln-Math.random()*rows; d.sp = 0.3+Math.random()*0.7; d.ln = 5+(Math.random()*15|0); }
    for (let j = 0; j < d.ln; j++) {
      const row = (d.y-j)|0;
      if (row >= 0 && row < rows) {
        const i2 = row*cols+c; const fade = 1-j/d.ln;
        vy[i2] += fade*0.5;
        tbr[i2] = Math.max(tbr[i2], fade*(j===0?1:0.55));
      }
    }
  }
  mouseArea(60, (i, dx, dy, dist, f) => {
    const a = Math.atan2(dy, dx);
    vx[i] += Math.cos(a)*f*2.5; vy[i] += Math.sin(a)*f*2.5;
    tbr[i] = Math.max(tbr[i], f*0.85);
  });
}

function fxWebcam() {
  if (!webcamActive || !wcVid || wcVid.readyState < 2) { fxRipple(); return; }
  wcCtx.drawImage(wcVid, 0, 0, cols, rows);
  const px = wcCtx.getImageData(0, 0, cols, rows).data;
  for (let i = 0; i < N; i++) {
    const r = (i/cols)|0, c = i%cols;
    const sc = cols-1-c;
    const pi = (r*cols+sc)*4;
    tbr[i] = (0.299*px[pi]+0.587*px[pi+1]+0.114*px[pi+2])/255;
  }
}

// ═══════════════
// RENDER — drawImage from glyph atlas
// ═══════════════

function loop() {
  physics();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, cW, cH);

  const sch = mode === 'matrix' ? 'mtx' : mode === 'webcam' ? 'cam' : 'std';
  const hw = GLYPH_W * 0.5, hh = GLYPH_H * 0.5;

  for (let i = 0; i < N; i++) {
    const b = br[i];
    if (b < 0.015) continue;

    const r = (i / cols) | 0, c = i % cols;
    const ch = grid[i];
    const bi = Math.min(BLVLS - 1, b * (BLVLS - 1) | 0);
    const glyph = glyphMap[`${sch}_${bi}_${ch}`];
    if (!glyph) continue;

    const drawX = c * CELL_W + CELL_W * 0.5 + ox[i] - hw;
    const drawY = r * CELL_H + CELL_H * 0.5 + oy[i] - hh;

    ctx.drawImage(glyphAtlas, glyph.x, glyph.y, GLYPH_W, GLYPH_H,
      drawX, drawY, GLYPH_W, GLYPH_H);
  }

  frameCount++;
  const now = performance.now();
  if (now - lastFT >= 1000) {
    fps = frameCount; frameCount = 0; lastFT = now;
    document.getElementById('stat-fps').textContent = fps;
  }
  requestAnimationFrame(loop);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
