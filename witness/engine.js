/* Witness scene candidate viewer: a case-agnostic engine.
   Data comes from the inline <script id="case-data"> block, or from case-data.json beside the page.
   Geometry mirrors model/geometry.py (analytic ellipsoid projection); tests/viewer_check.py holds them together. */
"use strict";
(function boot() {
  const el = document.getElementById("case-data");
  const txt = el && el.textContent.trim();
  if (txt) return start(JSON.parse(txt));
  const src = (document.querySelector('meta[name="case-data"]') || {}).content || "case-data.json";
  fetch(src).then((r) => r.json()).then(start).catch((e) => { document.body.insertAdjacentHTML("afterbegin", `<p style="padding:20px">Could not load case data (${String(e)}).</p>`); });
})();

function start(D) {
const R = D.results, P = D.parameters, K = D.constants, VD = D.viewer_defaults;
const FT_MI = K.ft_per_mi, D2R = Math.PI / 180, R2D = 180 / Math.PI, RE_FT = K.earth_mean_r_m * K.ft_per_m;
const $ = (id) => document.getElementById(id);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = (v, dp) => (v == null || !isFinite(v) ? "n/a" : Number(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const rv = (key, dp, unit) => `<span class="num" data-key="${key}" data-dp="${dp}">${fmt(R[key], dp)}</span>${unit || ""}`;
const CHIP = { good: "&#10003;", warn: "!", serious: "&#9650;", crit: "&#10005;", na: "&ndash;" };
const chip = (kind, text) => `<span class="chip ${kind}"><i aria-hidden="true">${CHIP[kind]}</i>${text}</span>`;
const LED = Object.fromEntries(D.ledger.map((r) => [r.id, r]));
const SRC = Object.fromEntries(D.sources.map((r) => [r.id, r]));
const cl = (id) => (LED[id] ? `<button type="button" class="cl" data-claim="${id}" title="${esc(LED[id].paraphrase)}">${id}</button>` : esc(id));
const cls = (ids) => ids.map(cl).join(" ");
const dist = (ft) => (ft < 2640 ? `${fmt(ft, 0)} ft` : `${fmt(ft / FT_MI, ft < 5 * FT_MI ? 2 : 1)} mi`);
document.querySelectorAll("#geom-version").forEach((e) => (e.textContent = D.version));
if (D.candidates.page) { document.querySelector("h1").textContent = D.candidates.page.title; document.querySelector("header .sub").textContent = D.candidates.page.intro; document.title = D.candidates.page.title; }
$("case-id").textContent = D.case_id;

/* ---------------- geometry port */
const refr = (slantFt) => K.refraction_k * (slantFt / K.ft_per_m) / (2 * K.earth_mean_r_m) * R2D;
function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let i = 0; i < xs.length - 1; i++) if (x <= xs[i + 1]) { const t = (x - xs[i]) / (xs[i + 1] - xs[i]); return ys[i] + t * (ys[i + 1] - ys[i]); }
  return ys[ys.length - 1];
}
const SKY_AZ = D.skyline.map((r) => r.az_deg), SKY_EL = D.skyline.map((r) => r.skyline_el_deg);
const skyEl = (az) => interp(SKY_AZ, SKY_EL, az);
const RAYS = D.rays.map((r) => ({ az: r.az, d: r.pts.map((p) => Math.hypot(p[0], p[1])), h: r.pts.map((p) => D.eye_ft + p[2] + (p[0] * p[0] + p[1] * p[1]) / (2 * RE_FT)) }));
const OBS_GROUND = D.eye_ft - P.eye_height_ft;
function rayH(r, d) { if (d <= r.d[0]) return OBS_GROUND + (d / r.d[0]) * (r.h[0] - OBS_GROUND); if (d > r.d[r.d.length - 1]) return null; return interp(r.d, r.h, d); }
function terrainAt(az, d) {
  if (az < RAYS[0].az || az > RAYS[RAYS.length - 1].az) return null;
  for (let i = 0; i < RAYS.length - 1; i++) if (az <= RAYS[i + 1].az) {
    const t = (az - RAYS[i].az) / (RAYS[i + 1].az - RAYS[i].az), a = rayH(RAYS[i], d), b = rayH(RAYS[i + 1], d);
    return a == null || b == null ? null : a + t * (b - a);
  }
  return null;
}
const AZ = R["geom.pin.az"], PIN_DH = R["geom.pin.dist_mi"] * FT_MI;
function place(p) {
  const sky = skyEl(AZ), gapDeg = Math.atan(p.gap / (P.witness_distance_mi * FT_MI)) * R2D, bottom = sky + gapDeg;
  const dh = PIN_DH * p.scale, th = p.angle, psi = (p.yaw == null ? 90 : p.yaw) * D2R;
  const wf = Math.sqrt(Math.sin(psi) ** 2 + (p.d2l * Math.cos(psi)) ** 2), sl = Math.sqrt(Math.cos(psi) ** 2 + (p.d2l * Math.sin(psi)) ** 2);
  let elc = bottom + th * p.h2l / 2, slant = 0, L = 0, angH = 0;
  for (let i = 0; i < 10; i++) {
    slant = dh / Math.cos(elc * D2R);
    L = 2 * slant * Math.tan(th * D2R / 2) / wf;
    const c = p.h2l * L / 2, s = sl * L / 2, e = elc * D2R;
    angH = 2 * Math.atan(Math.sqrt((c * Math.cos(e)) ** 2 + (s * Math.sin(e)) ** 2) / slant) * R2D;
    elc = bottom + angH / 2;
  }
  const elg = (elc - refr(slant)) * D2R, horiz = slant * Math.cos(elg);
  const alt = D.eye_ft + slant * Math.sin(elg) + horiz * horiz / (2 * RE_FT);
  const ter = terrainAt(AZ, dh);
  return { az: AZ, sky, gapDeg, bottom, elc, top: bottom + angH, angH, dh, slant, L, H: p.h2l * L, Dp: p.d2l * L, th, alt, ter, agl: ter == null ? null : alt - ter, scale: p.scale, h2l: p.h2l, d2l: p.d2l };
}

/* ---------------- candidates and state */
const CANDS = D.candidates.candidates, CBY = Object.fromEntries(CANDS.map((c) => [c.id, c]));
const HYP = {}; D.hypotheses.forEach((r) => ((HYP[r.hypothesis] = HYP[r.hypothesis] || []).push(r)));
const HSUM = Object.fromEntries(D.hyp_summary.map((r) => [r.hypothesis, r]));
const TIMES = D.sun_window.map((r) => r.time_mst);
const sunAt = (t) => { const r = D.sun_window.find((x) => x.time_mst === t) || D.sun_window[0]; return { alt: r.sun_alt, az: r.sun_az }; };
const A_MIN = R["cand.angle_min_deg"], A_MAX = R["cand.angle_max_deg"], A_DEF = R["cand.angle_default_deg"];
const T = { time: VD.time_mst, gap: VD.gap_ft_at_6mi, angle: A_DEF, duration: P.duration_s, glance: P.glance_s, h2l: VD.height_to_length, d2l: VD.depth_to_length };
const CS = {};
for (const c of CANDS) {
  if (c.size.mode === "fit") CS[c.id] = { scale: R[`cand.${c.id}.default.scale`], min: R[`cand.${c.id}.near.scale`], max: R[`cand.${c.id}.far.scale`] };
  else CS[c.id] = { opt: c.size.default_option || 0 };
}
const V = { cand: "craft", mode: "eye", metar: false, thumb: true, labels: true, anim: true };
try { const h = new URLSearchParams(location.hash.slice(1)); if (CBY[h.get("c")]) V.cand = h.get("c"); } catch (e) { /* no hash */ }
const PG = D.candidates.page || {};
const shapeOf = (c) => (c.shape.user_shape ? { h2l: T.h2l, d2l: T.d2l } : { h2l: c.shape.h2l, d2l: c.shape.d2l });
const sizeOf = (c) => R[`cand.${c.id}.opt${CS[c.id].opt}.size_ft`];
function placeCand(c, tst) {
  const t = tst || T, sh = shapeOf(c), base = { gap: t.gap, angle: t.angle, h2l: sh.h2l, d2l: sh.d2l, yaw: 90 };
  if (c.size.mode === "fit") return place({ ...base, scale: CS[c.id].scale });
  const L = sizeOf(c); let sc = 1;
  for (let i = 0; i < 12; i++) sc *= L / place({ ...base, scale: sc }).L;
  return place({ ...base, scale: sc });
}
function windAt(alt, agl) {
  const SW = PG.surface_wind; if (SW && agl != null && agl < 1000) return { from: R[SW.from_key], kt: R[SW.kt_key], src: SW.label };
  const W = D.wind_profile, xs = W.map((w) => w.alt_msl_ft);
  const u = interp(xs, W.map((w) => -w.kt * Math.sin(w.from_deg * D2R)), alt), v = interp(xs, W.map((w) => -w.kt * Math.cos(w.from_deg * D2R)), alt);
  return { from: (Math.atan2(-u, -v) * R2D + 360) % 360, kt: Math.hypot(u, v), src: "Denver sounding, time-weighted" };
}
function metrics(c, o) {
  const m = { behind: o.dh > R["geom.ridge.dist_ft"], stereo: o.slant < R["stereo.max_dist_ft"] };
  const w = windAt(o.alt, o.agl); m.wind = w;
  const v = w.kt * K.kt_to_ms * K.ft_per_m, to = (w.from + 180) % 360;
  m.vel = c.motion.mode === "free" ? [v * Math.sin(to * D2R), v * Math.cos(to * D2R)] : [0, 0];
  const perp = v * Math.sin((to - AZ) * D2R);
  m.drift = c.motion.mode === "free" ? Math.abs(perp / o.dh * R2D) * T.duration : 0;
  m.driftW = m.drift / o.th;
  if (m.behind) { const ref = refr(o.slant); m.drop = o.dh * (Math.tan((o.top - ref) * D2R) - Math.tan((o.sky - ref) * D2R)); m.hideMph = 2 * m.drop / T.glance * 3600 / FT_MI; }
  if (c.audio) { const L0 = typeof c.audio.level_dba === "number" ? c.audio.level_dba : K[c.audio.level_dba], r0 = c.audio.ref_ft;
    m.dba = L0 - 20 * Math.log10(o.slant / r0) - P.absorption_db_per_km * (o.slant - r0) / K.ft_per_m / 1000; }
  m.haze = Math.exp(-K.koschmieder * o.slant / (P.visibility_mi * FT_MI));
  return m;
}

/* ---------------- tooltip and claim popover */
const tip = $("tip");
const showTip = (e, html) => { tip.innerHTML = html; tip.style.display = "block"; tip.style.left = Math.min(e.clientX + 14, innerWidth - 330) + "px"; tip.style.top = e.clientY + 14 + "px"; };
const hideTip = () => (tip.style.display = "none");
function hoverTips(root) { root.querySelectorAll("[data-tip]").forEach((el) => { el.addEventListener("mousemove", (e) => showTip(e, el.getAttribute("data-tip"))); el.addEventListener("mouseleave", hideTip); }); }
const pop = $("pop");
function openClaim(id, anchor) {
  const r = LED[id]; if (!r) return;
  const s = SRC[r.source] || {};
  const tr = r.excerpt_kind === "transcript";
  let h = `<div class="small muted mono">${r.id} &middot; ${esc(r.timestamp)} &middot; ${esc(r.speaker)}</div>`;
  h += `<div><q>${esc(r.excerpt)}</q></div><div class="small sub">${esc(r.paraphrase)}</div>`;
  h += `<div class="small muted">Hedges: ${esc(r.hedges)} &middot; Role: ${esc(r.role)} &middot; Used for: ${esc(r.model_use)}</div>`;
  h += `<div class="small">${esc(s.title || r.source)}${s.url && /^https?:/.test(s.url) ? ` &middot; <a href="${esc(s.url)}" target="_blank" rel="noopener">open record</a>` : ""}${r.excerpt_kind === "record" ? " (OCR or transcription; spelling kept)" : ""}</div>`;
  if (tr) h += `<div><button type="button" id="pop-go" data-cue="${r.cues.split(";")[0]}">Show in transcript</button></div>`;
  $("pop-body").innerHTML = h; pop.classList.add("on");
  const b = anchor ? anchor.getBoundingClientRect() : { left: innerWidth / 2 - 200, bottom: innerHeight / 3 };
  pop.style.left = Math.max(12, Math.min(b.left, innerWidth - pop.offsetWidth - 12)) + "px";
  const top = b.bottom + 8; pop.style.top = (top + pop.offsetHeight > innerHeight - 8 ? Math.max(8, b.top - pop.offsetHeight - 8) : top) + "px";
  const go = $("pop-go"); if (go) go.addEventListener("click", () => { pop.classList.remove("on"); showCue(+go.dataset.cue); });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button.cl"); if (b) { e.preventDefault(); openClaim(b.dataset.claim, b); return; }
  if (!e.target.closest("#pop")) pop.classList.remove("on");
});
$("pop-x").addEventListener("click", () => pop.classList.remove("on"));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") pop.classList.remove("on"); });

/* ---------------- candidate rail */
function railHTML() {
  return `<h3>Candidate objects</h3>` + CANDS.map((c) => {
    const s = HSUM[c.hyp] || {};
    const b = (k, n) => `<span class="v ${k}" style="width:18px;height:18px">${n ?? "-"}</span>`;
    return `<button type="button" class="cand" data-c="${c.id}" aria-pressed="${c.id === V.cand}" title="${esc(c.label)}"><span class="row"><span class="t">${esc(c.short)}</span><span class="x">${b("X", s.contradicts)}${b("S", s.strains)}${b("F", s.fits)}</span></span><span class="d" id="rx-${c.id}"></span></button>`;
  }).join("") + `<p class="small muted">Badges: claims the candidate contradicts, strains, fits. Not drawn: birds or debris, Venus or the Moon, halo or glint, and no-object explanations; they are scored in the matrix in the appendix.</p>`;
}
$("rail").innerHTML = railHTML();
$("rail").addEventListener("click", (e) => { const b = e.target.closest(".cand"); if (b) select(b.dataset.c); });

/* ---------------- controls */
function slider(o) {
  let last = -99, row = 0;
  const tk = (o.ticks || []).map(([v, lab, def]) => [(v - o.min) / (o.max - o.min) * 100, lab, def]).sort((p, q) => p[0] - q[0]);
  const ticks = tk.map(([pc, lab, def]) => {
    row = pc - last < 7 + 0.9 * String(lab).length ? 1 - row : 0; if (lab) last = pc;
    const tr = pc < 6 ? "translateX(-4px)" : pc > 94 ? "translateX(calc(-100% + 4px))" : "translateX(-50%)";
    return `<span class="${def ? "def" : ""}" style="left:${pc}%; top:${row * 12}px; transform:${tr}">${esc(lab)}</span>`;
  }).join("");
  return `<div class="ctl"><div class="top"><label for="${o.id}">${o.label}</label><output id="${o.id}-o"></output></div>
    <input type="range" id="${o.id}" min="${o.min}" max="${o.max}" step="${o.step}" value="${o.value}">
    <div class="ticks" aria-hidden="true">${ticks}</div><div class="why">${o.why || ""}</div></div>`;
}
const TR = D.date_window.time_readings_mst, i0 = Math.min(...Object.values(TR).map((t) => TIMES.indexOf(t)).filter((x) => x >= 0)), i1 = Math.max(...Object.values(TR).map((t) => TIMES.indexOf(t)));
const num = (v) => (typeof v === "number" ? v : R[v]);
const whyHTML = (w, flag) => esc(w || "").replace(/\[\[(C\d+)\]\]/g, (_, id) => cl(id)) + (flag ? ` <span class="invented">${esc(flag)}</span>` : "");
function buildTestimony() {
  const CT = D.candidates.testimony_controls;
  $("ctl-testimony").innerHTML = CT.map((k) => {
    if (k.range_from === "time_readings") {
      const ticks = Object.entries(TR).map(([key, t]) => [TIMES.indexOf(t), /_high$/.test(key) ? "" : (key.match(/C\d\d/) || [""])[0], t === VD.time_mst]);
      return slider({ id: k.id, label: esc(k.label), min: i0, max: i1, step: 1, value: TIMES.indexOf(T[k.param]), ticks, why: whyHTML(k.why, k.flag) });
    }
    return slider({ id: k.id, label: esc(k.label), min: num(k.min), max: num(k.max), step: k.step, value: T[k.param], ticks: (k.ticks || []).map(([v, l, d]) => [num(v), l, !!d]), why: whyHTML(k.why, k.flag) });
  }).join("");
  for (const k of CT) $(k.id).addEventListener("input", () => { readTestimony(); update(); });
}
function readTestimony() {
  for (const k of D.candidates.testimony_controls) { const v = +$(k.id).value; T[k.param] = k.range_from === "time_readings" ? TIMES[v] : v; }
  if (Math.abs(T.angle - A_DEF) < 0.006) T.angle = A_DEF;
}
const lpos = (s, c) => Math.round(1000 * Math.log(s / c.min) / Math.log(c.max / c.min));
const lval = (v, c) => c.min * Math.pow(c.max / c.min, v / 1000);
function buildCandControls() {
  const c = CBY[V.cand], st = CS[c.id];
  $("ctl-cand-h").textContent = `What the ${c.short.toLowerCase()} allows`;
  let h = "";
  if (c.size.mode === "fit") {
    $("ctl-cand-note").innerHTML = `Its size is not known in advance, so the angle sets the size at whatever distance you choose. ${esc(c.distance.basis)}`;
    const def = R[`cand.${c.id}.default.scale`];
    h += slider({ id: "k-dist", label: "Distance along the line of sight", min: 0, max: 1000, step: 1, value: lpos(st.scale, st),
      ticks: [[0, "near bound", false], [lpos(def, st), "default", true], [1000, "far bound", false]], why: `Bounds from ${cls(c.distance.claims)}` });
    if (c.shape.user_shape) {
      h += slider({ id: "k-h2l", label: "Height to length", min: 0.3, max: 0.8, step: 0.01, value: T.h2l, ticks: [[0.45, "0.45", true]], why: `${cls(c.shape.claims || [])} <span class="invented">RATIO ASSUMED</span>` });
      h += slider({ id: "k-d2l", label: "Depth to length", min: 0.3, max: 0.8, step: 0.01, value: T.d2l, ticks: [[0.5, "0.5", true]], why: `${cls(c.shape.claims || [])} <span class="invented">RATIO ASSUMED</span>` });
    }
  } else {
    $("ctl-cand-note").innerHTML = `Its size is known, so the angle the witnesses gave fixes how far away it must be. Move the angular-size slider on the left to slide it along the line of sight.`;
    const opts = c.size.options.map((o, i) => `<option value="${i}" ${i === st.opt ? "selected" : ""}>${esc(o.label)}</option>`).join("");
    h += `<div class="ctl"><div class="top"><label for="k-opt">Size</label><output id="k-opt-o"></output></div><select id="k-opt" ${c.size.options.length < 2 ? "disabled" : ""}>${opts}</select><div class="why" id="k-opt-why"></div></div>`;
  }
  $("ctl-cand").innerHTML = h;
  if ($("k-dist")) $("k-dist").addEventListener("input", () => { const v = +$("k-dist").value; const def = R[`cand.${c.id}.default.scale`]; st.scale = v === lpos(def, st) ? def : lval(v, st); update(); });
  if ($("k-h2l")) $("k-h2l").addEventListener("input", () => { T.h2l = +$("k-h2l").value; needRebuild = true; update(); });
  if ($("k-d2l")) $("k-d2l").addEventListener("input", () => { T.d2l = +$("k-d2l").value; needRebuild = true; update(); });
  if ($("k-opt")) $("k-opt").addEventListener("change", () => { st.opt = +$("k-opt").value; update(); });
}
function updateOutputs(o) {
  const s = sunAt(T.time);
  const OUT = { time: `${T.time}, sun ${fmt(s.alt, 1)}° up`, gap: `${fmt(T.gap, 0)} ft (${fmt(o.gapDeg, 2)}°)`, angle: `${fmt(T.angle, 2)}°`,
    duration: T.duration >= 60 ? `${Math.floor(T.duration / 60)} min ${T.duration % 60 ? (T.duration % 60) + " s" : ""}` : `${T.duration} s`, glance: `${fmt(T.glance, 1)} s` };
  for (const k of D.candidates.testimony_controls) { const e = $(k.id + "-o"); if (e) e.textContent = OUT[k.param] ?? fmt(T[k.param], 2); }
  const c = CBY[V.cand];
  if ($("k-dist")) $("k-dist-o").textContent = `${dist(o.dh)} (${fmt(o.scale, o.scale < 0.1 ? 3 : 2)}x pin)`;
  if ($("k-h2l")) $("k-h2l-o").textContent = fmt(T.h2l, 2);
  if ($("k-d2l")) $("k-d2l-o").textContent = fmt(T.d2l, 2);
  if ($("k-opt")) {
    const op = c.size.options[CS[c.id].opt];
    $("k-opt-o").textContent = `${fmt(sizeOf(c), 0)} ft`;
    const near = placeCand(c, { ...T, angle: A_MAX }), far = placeCand(c, { ...T, angle: A_MIN });
    $("k-opt-why").innerHTML = `Size source: ${SRC[op.source] ? esc(SRC[op.source].title) : esc(op.source)}. Across the reported angles it would be ${dist(near.dh)} to ${dist(far.dh)} away.`;
  }
}

/* ---------------- readout and checklist */
function readout(c, o, m) {
  $("ro-summary").innerHTML = `<b>${esc(c.label)}.</b> ${esc(c.summary)}${c.matrix_note ? ` <span class="small muted">${esc(c.matrix_note)}</span>` : ""}`;
  const rows = [
    ["Distance from the stairs", `<b>${dist(o.dh)}</b>${c.size.mode === "fixed" ? " (set by its size and the angle)" : ""}`],
    ["Size", `<b>${fmt(o.L, 0)} ft</b> long, ${fmt(o.H, 0)} ft tall${c.size.mode === "fit" ? " (implied by the angle at this distance)" : " (known)"}`],
    ["Height", `<b>${fmt(o.alt, 0)} ft</b> above sea level${o.agl != null ? `, <b>${fmt(o.agl, 0)} ft</b> above the ground below it` : ", beyond the terrain data"}`],
    ["Against the mountain", m.behind ? chip("good", "Behind the ridge crest, as reported") : chip("crit", "In front of the mountain") + (PG.front_claim ? ` <span class="small">${cl(PG.front_claim.id)} says "${esc(PG.front_claim.words)}"</span>` : "")],
    ["Depth cue", m.stereo ? chip("serious", "Close enough for two-eye depth") + ` <span class="small">within ${fmt(R["stereo.max_dist_ft"], 0)} ft, nearness would show</span>` : chip("na", "Too far for two-eye depth") + ` <span class="small">so "over the mountain" is a projection</span>`],
    ["Motion while watched", c.motion.mode === "free" ? `${m.drift < 0.5 * o.th ? chip("good", "Looks still") : chip("crit", "Visibly drifts")} ${m.drift > 60 ? `moves its own width every <b>${fmt(o.th / (m.drift / T.duration), 1)} s</b>, so it would cross out of view long before ${T.duration} s` : `<b>${fmt(m.drift, m.drift < 10 ? 2 : 0)}°</b> (${fmt(m.driftW, 1)} body widths) in ${T.duration} s`}; wind ${fmt(m.wind.kt, 1)} kt from ${fmt(m.wind.from, 0)}° (${m.wind.src})`
      : `${chip("good", "Holds still")} ${esc(c.motion.basis)}`],
    ["Sound at the stairs", m.dba != null ? `${m.dba - K.ambient_dba > 6 ? chip("crit", "Audible") : chip("warn", "Faint")} about <b>${fmt(m.dba, 0)} dBA</b> against ${fmt(K.ambient_dba, 0)} dBA ambient${PG.sound_claim ? `; ${cl(PG.sound_claim.id)} ${esc(PG.sound_claim.words)}` : ""}` : `<span class="muted">Silent or not modeled</span> ${PG.sound_claim ? cl(PG.sound_claim.id) : ""}`],
    ["Haze between", `${fmt(m.haze * 100, 0)}% of its contrast survives (${P.visibility_mi} mi visual range)`],
    ["After the glance", `${c.after_glance.mode === "gone" ? chip("warn", "Gone") : chip("crit", "Still visible")} ${esc(c.after_glance.text)}${m.behind && c.after_glance.mode === "gone" ? ` Dropping behind the ridge in ${fmt(T.glance, 1)} s means falling ${fmt(m.drop, 0)} ft, peaking near ${fmt(m.hideMph, 0)} mph.` : ""}`],
  ];
  $("ro-stats").innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("");
  const rs = (HYP[c.hyp] || []).filter((r) => r.verdict === "X" || r.verdict === "S").sort((a, b) => (a.verdict === "X" ? 0 : 1) - (b.verdict === "X" ? 0 : 1));
  const s = HSUM[c.hyp] || {};
  $("ro-check").innerHTML = `<div class="small" style="margin-bottom:6px">${s.contradicts} contradict, ${s.strains} strain, ${s.fits} fit, ${s.neutral} neutral &middot; known physics (K1): <b>${s.K1}</b> &middot; checkable (K2): <b>${s.K2}</b></div>` +
    `<table><tbody>${rs.slice(0, 7).map((r) => `<tr><td><span class="v ${r.verdict}">${r.verdict}</span></td><td>${cl(r.claim_or_criterion)}</td><td>${esc(r.reason)}</td></tr>`).join("")}</tbody></table>`;
}
function checklist(c) {
  $("chk-name").textContent = c.label;
  const order = { X: 0, S: 1, F: 2, N: 3, no: 0, yes: 2 };
  const rows = (HYP[c.hyp] || []).slice().sort((a, b) => order[a.verdict] - order[b.verdict]);
  $("chk").innerHTML = `<thead><tr><th></th><th>Claim</th><th>Exact words</th><th>Why this verdict</th></tr></thead><tbody>` + rows.map((r) => {
    const L = LED[r.claim_or_criterion];
    const v = r.verdict === "yes" || r.verdict === "no" ? `<span class="v ${r.verdict === "yes" ? "F" : "X"}">${r.claim_or_criterion}</span>` : `<span class="v ${r.verdict}">${r.verdict}</span>`;
    return `<tr><td>${v}</td><td>${L ? cl(L.id) + " " + esc(L.paraphrase) : r.claim_or_criterion === "K1" ? "Achievable with known physics" : "Makes a checkable prediction"}</td><td>${L ? (L.excerpt_kind === "data" ? `<code class="small">${esc(L.excerpt)}</code>` : `<q>${esc(L.excerpt)}</q>`) : ""}</td><td>${esc(r.reason)}</td></tr>`;
  }).join("") + `</tbody>`;
}

/* ---------------- three.js scene */
const S = 0.01; // scene units per foot
const V3 = (e, n, u) => new THREE.Vector3(e * S, u * S, -n * S);
let G3 = null, needRebuild = true;
const PRE_V = `#include <common>\n#include <fog_pars_vertex>\n#include <logdepthbuf_pars_vertex>\n`;
const PRE_F = `#include <common>\n#include <fog_pars_fragment>\n#include <logdepthbuf_pars_fragment>\n`;
const NOISE = `
float h31(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }
vec3 hash3(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6))); return fract(sin(p)*43758.5453); }`;
const VERT = PRE_V + `attribute vec3 sp; varying vec3 vN; varying vec3 vW; varying vec3 vP; varying vec3 vSp;
void main(){ vP = position; vSp = sp; vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;
const FRAG_CRAFT = PRE_F + `uniform vec3 uSun; uniform vec3 uColor; uniform vec3 uSky; uniform vec3 uGround; uniform float uTime; uniform float uOpacity; uniform float uRipple;
varying vec3 vN; varying vec3 vW; varying vec3 vP; varying vec3 vSp;` + NOISE + `
void main(){
  #include <logdepthbuf_fragment>
  vec3 p = normalize(vSp) * 6.5; vec3 ip = floor(p); vec3 fp = fract(p);
  float d1 = 8.0, d2 = 8.0; vec3 c1 = vec3(0.0);
  for (int i=-1;i<=1;i++) for (int j=-1;j<=1;j++) for (int k=-1;k<=1;k++) {
    vec3 g = vec3(float(i),float(j),float(k)); vec3 o = hash3(ip+g); vec3 r = g + o - fp; float d = dot(r,r);
    if (d < d1) { d2 = d1; d1 = d; c1 = ip+g+o; } else if (d < d2) { d2 = d; } }
  float edge = sqrt(d2) - sqrt(d1);
  vec3 cd = normalize(c1);
  float w = 0.0;
  w += sin(acos(clamp(dot(cd, normalize(vec3(0.7,0.2,0.5))),-1.0,1.0))*7.0 - uTime*uRipple*1.1);
  w += sin(acos(clamp(dot(cd, normalize(vec3(-0.6,-0.3,0.4))),-1.0,1.0))*7.0 - uTime*uRipple*0.9 + 2.1);
  w += sin(acos(clamp(dot(cd, normalize(vec3(0.1,0.8,-0.6))),-1.0,1.0))*7.0 - uTime*uRipple*1.3 + 4.2);
  vec3 n = normalize(vN + 0.16 * (w/3.0) * (hash3(c1*1.7) - 0.5) * 2.0);
  vec3 v = normalize(cameraPosition - vW);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float dif = max(dot(n, uSun), 0.0);
  vec3 amb = mix(uGround, uSky, n.y*0.5+0.5);
  vec3 col = uColor * (0.88*dif + 0.42*amb) + 0.10*uColor*pow(1.0-ndv, 2.0);
  col += 0.018 * vec3(sin(9.0*ndv), sin(9.0*ndv+2.1), sin(9.0*ndv+4.2));
  col += 0.22 * pow(max(dot(n, normalize(uSun+v)), 0.0), 70.0);
  col *= mix(0.80, 1.0, smoothstep(0.0, 0.045, edge));
  gl_FragColor = vec4(col, uOpacity);
  #include <fog_fragment>
}`;
const FRAG_CLOUD = PRE_F + `uniform vec3 uSun; uniform vec3 uColor; uniform float uTime; uniform float uOpacity; uniform float uSeed;
varying vec3 vN; varying vec3 vW; varying vec3 vP; varying vec3 vSp;` + NOISE + `
void main(){
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vN); vec3 v = normalize(cameraPosition - vW);
  float ndv = abs(dot(n, v));
  float f = fbm(normalize(vSp)*3.2 + vec3(uSeed, uTime*0.015, uTime*0.01));
  float a = smoothstep(0.08, 0.62, ndv + (f - 0.5) * 0.75) * uOpacity;
  float dif = 0.5 + 0.5 * max(dot(n, uSun), 0.0);
  vec3 col = uColor * (0.66 + 0.34*dif) * (0.88 + 0.24*f);
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}`;
const FRAG_LAYER = PRE_F + `uniform float uCov; uniform float uTime; uniform vec3 uColor; varying vec3 vN; varying vec3 vW; varying vec3 vP; varying vec3 vSp;` + NOISE + `
void main(){
  #include <logdepthbuf_fragment>
  vec2 q = vW.xz / 900.0;
  float f = fbm(vec3(q.x, q.y, uTime*0.002));
  float g = fbm(vec3(q.x*6.0, q.y*2.0, 3.0));
  float a = smoothstep(1.0 - uCov - 0.12, 1.0 - uCov + 0.18, f) * (0.55 + 0.45*g) * 0.85;
  gl_FragColor = vec4(uColor, a);
  #include <fog_fragment>
}`;
function shaderMat(frag, u, opts) {
  return new THREE.ShaderMaterial(Object.assign({ vertexShader: VERT, fragmentShader: frag, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, u]), fog: true, transparent: true }, opts || {}));
}
function withSp(g) { const p = g.attributes.position, a = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), l = Math.hypot(x, y, z) || 1; a[i * 3] = x / l; a[i * 3 + 1] = y / l; a[i * 3 + 2] = z / l; } g.setAttribute("sp", new THREE.BufferAttribute(a, 3)); return g; }
function ellipsoidGeo(h2l, d2l, seg, wobble) {
  const g = new THREE.SphereGeometry(0.5, seg, Math.round(seg * 0.6)); withSp(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = wobble ? 1 + 0.045 * Math.sin(5.1 * x + 0.7) * Math.cos(3.3 * z + 0.4) + 0.03 * Math.sin(7.7 * y + 2.0 * x) - 0.05 * Math.max(0, -y * 2) * Math.exp(-(x * x) * 14) : 1;
    p.setXYZ(i, x * k, y * h2l * k, z * d2l * k);
  }
  g.computeVertexNormals(); return g;
}
function lathe(fr, n, seg) { // fr(t): radius for t in 0..1 from nose (+x) to tail (-x); unit length
  const pts = []; for (let i = 0; i <= n; i++) { const t = i / n; pts.push(new THREE.Vector2(Math.max(1e-4, fr(t)), 0.5 - t)); }
  const g = new THREE.LatheGeometry(pts, seg || 48); g.rotateZ(-Math.PI / 2); g.computeVertexNormals(); return g;
}
const std = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.72, metalness: 0.0 }, o || {}));
function fin(len, ht, x, r, ang, mat) {
  const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(len, 0); s.lineTo(len * 0.25, ht); s.lineTo(0, ht * 0.9); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false }); g.translate(-len, 0, -0.002);
  const m = new THREE.Mesh(g, mat); const holder = new THREE.Group(); m.position.set(x + len, r * 0.25, 0); holder.add(m); holder.rotation.x = ang; return holder;
}
function buildCand(c) {
  const grp = new THREE.Group(), sh = shapeOf(c), col = new THREE.Color(c.colour);
  const U = { uSun: { value: new THREE.Vector3(0, 1, 0) }, uColor: { value: col }, uTime: { value: 0 }, uOpacity: { value: c.opacity }, uSky: { value: new THREE.Color(0xbfd5ea) }, uGround: { value: new THREE.Color(0x8a7c64) }, uRipple: { value: 1.0 }, uSeed: { value: 0 } };
  const mats = [];
  const R0 = sh.h2l / 2;
  if (c.render === "panel-ellipsoid") {
    const m = shaderMat(FRAG_CRAFT, U, { depthWrite: true }); mats.push(m); grp.add(new THREE.Mesh(ellipsoidGeo(1, 1, 160, true).scale(1, sh.h2l, sh.d2l), m));
  } else if (c.render === "lens-cloud" || c.render === "puff-cloud") {
    const parts = c.render === "lens-cloud" ? [[0, 0, 0, 1, 1, 1], [0.06, sh.h2l * 0.9, 0.02, 0.78, 0.7, 0.8], [-0.04, -sh.h2l * 0.75, -0.03, 0.86, 0.6, 0.9]]
      : [[0, 0, 0, 0.62, 1, 0.7], [0.24, 0.05, 0.05, 0.45, 0.8, 0.6], [-0.26, -0.02, -0.04, 0.48, 0.75, 0.6], [0.05, 0.16, -0.06, 0.4, 0.7, 0.5], [-0.1, -0.12, 0.1, 0.5, 0.55, 0.6], [0.38, -0.08, 0, 0.26, 0.5, 0.4]];
    parts.forEach((q, i) => { const m = shaderMat(FRAG_CLOUD, { ...U, uSeed: { value: i * 3.7 } }, { depthWrite: false }); mats.push(m);
      const me = new THREE.Mesh(ellipsoidGeo(sh.h2l, sh.d2l, 64, false), m); me.position.set(q[0], q[1], q[2]); me.scale.set(q[3], q[4], q[5]); me.renderOrder = 2 + i; grp.add(me); });
  } else if (c.render === "aerostat" || c.render === "blimp") {
    const rr = R0, mat = std(c.colour, { roughness: 0.55 });
    const hull = lathe((t) => rr * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.72) * (1 - 0.18 * t), 64, 48);
    grp.add(new THREE.Mesh(hull, mat));
    const fins = c.render === "aerostat" ? [0, 2.094, -2.094] : [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4];
    fins.forEach((a) => grp.add(fin(0.2, rr * 1.1, -0.48, rr, a, mat)));
    if (c.render === "aerostat") { const pod = new THREE.Mesh(new THREE.SphereGeometry(rr * 0.42, 24, 16), std(0xdedbd2)); pod.position.set(0.12, -rr * 0.95, 0); grp.add(pod); }
    else { const gon = new THREE.Mesh(new THREE.BoxGeometry(0.16, rr * 0.45, rr * 0.5), std(0x8f959b)); gon.position.set(0.1, -rr * 1.05, 0); grp.add(gon); }
  } else if (c.render === "sphere-balloon") {
    grp.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 48, 32), std(c.colour, { roughness: 0.35, transparent: true, opacity: 0.88 })));
    const str = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.6, 4), std(0xffffff)); str.position.set(0, -1.3, 0); grp.add(str);
    const pay = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), std(0xd8d2c4)); pay.position.set(0, -2.1, 0); grp.add(pay);
  } else if (c.render === "zp-balloon") {
    const H = sh.h2l, pts = [];
    for (let i = 0; i <= 60; i++) { const t = i / 60, ph = Math.PI * t, y = H / 2 * Math.cos(ph) - 0.15 * H * Math.pow(Math.max(0, (t - 0.5) * 2), 2);
      const r = 0.5 * Math.pow(Math.sin(ph), 0.85) * (1 - 0.35 * Math.max(0, (t - 0.6) / 0.4));
      pts.push(new THREE.Vector2(Math.max(0.002, r), y)); }
    const cv = document.createElement("canvas"); cv.width = 256; cv.height = 8; const x = cv.getContext("2d"); x.fillStyle = "#f2f1ec"; x.fillRect(0, 0, 256, 8); x.fillStyle = "#c9c6bb"; for (let i = 0; i < 32; i++) x.fillRect(i * 8, 0, 1, 8);
    const g = new THREE.LatheGeometry(pts, 96); g.computeVertexNormals();
    grp.add(new THREE.Mesh(g, std(0xffffff, { map: new THREE.CanvasTexture(cv), roughness: 0.4, transparent: true, opacity: 0.93, side: THREE.DoubleSide })));
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.9, 4), std(0x777777)); tr.position.set(0, -H * 0.65 - 0.45, 0); grp.add(tr);
    const pay = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.04), std(0x9a9a9a)); pay.position.set(0, -H * 0.65 - 0.92, 0); grp.add(pay);
  } else if (c.render === "helicopter") {
    const m = std(c.colour, { roughness: 0.8 });
    const fus = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 20), m); fus.scale.set(0.42, 0.17, 0.13); fus.position.set(0.14, 0, 0); grp.add(fus);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.03, 0.46, 10), m); boom.rotation.z = Math.PI / 2; boom.position.set(-0.22, 0.03, 0); grp.add(boom);
    const vf = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.008), m); vf.position.set(-0.44, 0.08, 0); grp.add(vf);
    const rot = new THREE.Mesh(new THREE.CircleGeometry(sh.d2l / 2, 48), new THREE.MeshBasicMaterial({ color: 0x2b2f2a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    rot.rotation.x = -Math.PI / 2; rot.position.set(0.12, 0.11, 0); grp.add(rot);
    const tr = new THREE.Mesh(new THREE.CircleGeometry(0.05, 24), rot.material); tr.position.set(-0.46, 0.08, 0.012); grp.add(tr);
    for (const z of [-0.05, 0.05]) { const sk = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.006, 0.006), std(0x222222)); sk.position.set(0.14, -0.1, z); grp.add(sk); }
  } else if (c.render === "quadcopter") {
    const m = std(c.colour, { roughness: 0.5 });
    grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.22), m));
    const disk = new THREE.MeshBasicMaterial({ color: 0x1d1f22, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.03), m); arm.rotation.y = Math.atan2(sz, sx) * -1; arm.position.set(sx * 0.15, 0.01, sz * 0.15); grp.add(arm);
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.17, 32), disk); d.rotation.x = -Math.PI / 2; d.position.set(sx * 0.32, 0.05, sz * 0.32); grp.add(d);
    }
  }
  grp.userData = { mats, U };
  return grp;
}
function sunVec(s) { return new THREE.Vector3(Math.sin(s.az * D2R) * Math.cos(s.alt * D2R), Math.sin(s.alt * D2R), -Math.cos(s.az * D2R) * Math.cos(s.alt * D2R)); }
function initThree() {
  if (typeof THREE === "undefined" || !THREE.OrbitControls) { $("fallback").style.display = "grid"; return; }
  const canvas = $("scene");
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true }); } catch (err) { $("fallback").style.display = "grid"; return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const HOR = new THREE.Color(0xc7d8e6);
  scene.fog = new THREE.Fog(HOR, 0, P.visibility_mi * FT_MI * S);
  const cam = new THREE.PerspectiveCamera(20, 1, 0.002, 30000);
  const controls = new THREE.OrbitControls(cam, canvas); controls.enabled = false;
  scene.add(new THREE.HemisphereLight(0xcfe0f2, 0x7a6a55, 0.5));
  const sun = new THREE.DirectionalLight(0xfff6e8, 1.0); scene.add(sun); scene.add(sun.target);
  // sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(12000, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uZen: { value: new THREE.Color(0x3f77b8) }, uHor: { value: HOR } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uSun; uniform vec3 uZen; uniform vec3 uHor; varying vec3 vD; void main(){ float e = max(vD.y, 0.0);
      vec3 c = mix(uHor, uZen, pow(e, 0.42)); float s = max(dot(normalize(vD), uSun), 0.0); c += vec3(1.0,0.97,0.9) * (0.25*pow(s, 8.0) + 0.6*pow(s, 600.0));
      if (vD.y < 0.0) c = mix(uHor, vec3(0.62,0.6,0.55), min(1.0, -vD.y*4.0)); gl_FragColor = vec4(c, 1.0); }` }));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
  renderer.setClearColor(HOR, 1);
  // terrain wedge from the USGS rays
  const rays = D.rays, nR = rays.length, nP = rays[0].pts.length + 1;
  const pos = new Float32Array(nR * nP * 3), col = new Float32Array(nR * nP * 3);
  const C = [[5800, new THREE.Color(0xb3a27e)], [6600, new THREE.Color(0x8c8a62)], [7400, new THREE.Color(0x55633f)], [8800, new THREE.Color(0x45533a)], [9800, new THREE.Color(0x5f6457)]];
  const tcol = (h) => { for (let i = 0; i < C.length - 1; i++) if (h <= C[i + 1][0]) return C[i][1].clone().lerp(C[i + 1][1], Math.max(0, (h - C[i][0]) / (C[i + 1][0] - C[i][0]))); return C[C.length - 1][1].clone(); };
  for (let i = 0; i < nR; i++) for (let j = 0; j < nP; j++) {
    const p = j === 0 ? [0, 0, -P.eye_height_ft] : rays[i].pts[j - 1];
    const k = (i * nP + j) * 3; pos[k] = p[0] * S; pos[k + 1] = p[2] * S; pos[k + 2] = -p[1] * S;
    const c = tcol(D.eye_ft + p[2] + (p[0] * p[0] + p[1] * p[1]) / (2 * RE_FT)); col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
  }
  const idx = []; for (let i = 0; i < nR - 1; i++) for (let j = 0; j < nP - 1; j++) { const a = i * nP + j, b = (i + 1) * nP + j; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const tg = new THREE.BufferGeometry(); tg.setAttribute("position", new THREE.BufferAttribute(pos, 3)); tg.setAttribute("color", new THREE.BufferAttribute(col, 3)); tg.setIndex(idx); tg.computeVertexNormals();
  const nrm = tg.attributes.normal; for (let i = 0; i < nR; i++) nrm.setXYZ(i * nP, 0, 1, 0);
  scene.add(new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true })));
  const ground = new THREE.Mesh(new THREE.RingGeometry(0.01, 90 * FT_MI * S, 96, 40), new THREE.MeshLambertMaterial({ color: 0xb5a47f }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = (-P.eye_height_ft - 3) * S; scene.add(ground);
  const at = D.points.antenna_farm, tw = std(0x8c3b36);
  for (let k = -2; k <= 2; k++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(6 * S, 6 * S, 300 * S, 6), tw); m.position.copy(V3(at.enu[0] + k * 120, at.enu[1] + k * 60, at.enu[2] + 150)); scene.add(m); }
  // METAR cloud layers
  const layers = new THREE.Group(); scene.add(layers);
  // line of sight, tether, drift track, observer marker (orbit only)
  const lmat = new THREE.LineBasicMaterial({ color: 0x2a78d6 });
  const sight = new THREE.LineSegments(new THREE.BufferGeometry(), lmat); scene.add(sight);
  const tether = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.3 })); scene.add(tether);
  const track = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xeb6834, dashSize: 3, gapSize: 2 })); scene.add(track);
  const obsM = new THREE.Mesh(new THREE.ConeGeometry(110 * S, 360 * S, 12), std(0xd03b3b)); obsM.position.set(0, 180 * S, 0); scene.add(obsM);
  const holder = new THREE.Group(); scene.add(holder);
  G3 = { renderer, scene, cam, controls, sun, sky, layers, sight, tether, track, obsM, holder, obj: null, labels: [], last: 0 };
  controls.addEventListener("change", () => (G3.dirty = true));
  new ResizeObserver(() => sizeThree()).observe($("vp"));
  sizeThree();
}
function sizeThree() {
  if (!G3) return; const c = $("vp"), w = c.clientWidth, h = c.clientHeight;
  G3.renderer.setSize(w, h, false); G3.cam.aspect = w / h; setFov(); G3.dirty = true;
  const ov = $("overlay"), dpr = Math.min(devicePixelRatio || 1, 2); ov.width = w * dpr; ov.height = h * dpr;
}
const HFOV = { eye: 30, zoom: 10 };
function setFov() { if (!G3) return; const h = HFOV[V.mode]; G3.cam.fov = h ? 2 * Math.atan(Math.tan(h * D2R / 2) / G3.cam.aspect) * R2D : 40; G3.cam.updateProjectionMatrix(); }
function layersFor(t) {
  const STN = PG.metar_station || "KCOS", obs = D.wx_temps.filter((w) => w.station === STN && w.clouds && /\d/.test(w.clouds));
  if (!obs.length) return { obs: { time_mst: "n/a" }, layers: [] };
  const tm = (s) => { const [a, b] = s.split(":").map(Number); return a * 60 + b; };
  let pick = obs[0]; for (const w of obs) if (tm(w.time_mst) <= tm(t) + 4) pick = w;
  const out = []; String(pick.clouds).replace(/(FEW|SCT|BKN|OVC)(\d{3})/g, (_, cov, h) => out.push({ cov, msl: D.points[STN.toLowerCase()].ground_ft + 100 * +h })); return { obs: pick, layers: out };
}
function rebuildLayers() {
  if (!G3) return; G3.layers.clear(); if (!V.metar) return;
  const COV = { FEW: 0.2, SCT: 0.4, BKN: 0.7, OVC: 0.95 };
  for (const L of layersFor(T.time).layers) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(240 * FT_MI * S, 240 * FT_MI * S, 60, 60), shaderMat(FRAG_LAYER, { uCov: { value: COV[L.cov] }, uTime: { value: 0 }, uColor: { value: new THREE.Color(0xf4f6f8) } }, { depthWrite: false, side: THREE.DoubleSide }));
    m.geometry.setAttribute("sp", new THREE.BufferAttribute(new Float32Array(m.geometry.attributes.position.count * 3), 3));
    m.rotation.x = -Math.PI / 2; m.position.y = (L.msl - D.eye_ft) * S; m.renderOrder = 1; G3.layers.add(m);
  }
}

/* ---------------- playback */
const PB = { playing: false, te: 0, lastWall: 0 };
const AFTER_HOLD = 6;
const totalT = () => T.duration + T.glance + AFTER_HOLD;
function phase(te) {
  if (te <= T.duration) return { k: "watch", f: 0 };
  if (te <= T.duration + T.glance) return { k: "glance", f: Math.sin(Math.PI * (te - T.duration) / T.glance) };
  return { k: "after", f: 0 };
}
function stepPlayback(now) {
  if (!PB.playing) return;
  const dt = Math.min(0.1, (now - PB.lastWall) / 1000); PB.lastWall = now;
  const rate = PB.te < T.duration ? T.duration / 9 : 1;
  PB.te = Math.min(totalT(), PB.te + dt * rate);
  $("p-t").value = Math.round(PB.te / totalT() * 1000);
  if (PB.te >= totalT()) { PB.playing = false; $("p-play").setAttribute("aria-pressed", "false"); $("p-play").textContent = "Replay"; }
}
$("p-play").addEventListener("click", () => {
  if (PB.playing) { PB.playing = false; $("p-play").setAttribute("aria-pressed", "false"); $("p-play").textContent = "Play the event"; return; }
  if (PB.te >= totalT() - 0.01) PB.te = 0;
  PB.playing = true; PB.lastWall = performance.now(); $("p-play").setAttribute("aria-pressed", "true"); $("p-play").textContent = "Pause";
  if (V.mode === "orbit") setMode("eye");
});
$("p-t").addEventListener("input", () => { PB.playing = false; PB.te = +$("p-t").value / 1000 * totalT(); $("p-play").setAttribute("aria-pressed", "false"); $("p-play").textContent = "Play the event"; G3 && (G3.dirty = true); });
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/* ---------------- per-frame update */
let CUR = null; // {c, o, m}
function frame(now) {
  requestAnimationFrame(frame);
  stepPlayback(now);
  if (!G3 || !CUR) { hudAndCaption(); return; }
  if (!V.anim && !PB.playing && !G3.dirty) return;
  if (now - G3.last < 30 && !G3.dirty) return;
  G3.last = now; G3.dirty = false;
  const { c, o, m } = CUR, t = now / 1000, ph = phase(PB.te);
  const e0 = o.dh * Math.sin(AZ * D2R), n0 = o.dh * Math.cos(AZ * D2R), u0 = o.alt - D.eye_ft;
  const tt = Math.min(PB.te, totalT());
  let de = m.vel[0] * tt, dn = m.vel[1] * tt, du = 0;
  if (c.motion.mode === "hover") { de += 0.012 * o.L * Math.sin(t * 0.9); du += 0.01 * o.L * Math.sin(t * 1.3 + 1); }
  if (c.motion.mode === "tethered") { de += 0.02 * o.L * Math.sin(t * 0.25); du += 0.006 * o.L * Math.sin(t * 0.31); }
  const obj = G3.obj;
  if (obj) {
    obj.position.copy(V3(e0 + de, n0 + dn, u0 + du));
    obj.visible = !(c.after_glance.mode === "gone" && PB.te > T.duration + T.glance * 0.5);
    for (const mm of obj.userData.mats) { mm.uniforms.uTime.value = V.anim ? t : 0; mm.uniforms.uSun.value.copy(sunVec(sunAt(T.time))); }
    if (c.render === "aerostat") {
      const bot = obj.position.clone().add(new THREE.Vector3(0, -o.H * 0.45 * S, 0));
      const gx = e0 + de, gn = n0 + dn, gh = (terrainAt(AZ, o.dh) ?? OBS_GROUND) - D.eye_ft;
      G3.tether.geometry.setFromPoints([bot, V3(gx - 0.15 * o.L, gn, gh)]); G3.tether.visible = obj.visible;
    } else G3.tether.visible = false;
  }
  for (const L of G3.layers.children) L.material.uniforms.uTime.value = V.anim ? t : 0;
  // camera
  const cam = G3.cam;
  if (V.mode !== "orbit") {
    const yaw = 12 * ph.f, elOff = -26 * ph.f;
    const lookEl = (V.mode === "zoom" ? o.elc - 0.5 : o.elc - 3) + elOff, lookAz = AZ + yaw;
    cam.position.set(0, 0, 0);
    cam.lookAt(new THREE.Vector3(Math.sin(lookAz * D2R) * Math.cos(lookEl * D2R), Math.sin(lookEl * D2R), -Math.cos(lookAz * D2R) * Math.cos(lookEl * D2R)));
    $("glance").style.opacity = String(ph.f);
  } else { G3.controls.update(); $("glance").style.opacity = "0"; }
  G3.sky.position.copy(cam.position);
  G3.renderer.render(G3.scene, cam);
  drawOverlay(); hudAndCaption(); drawLabels();
}
const HUDC = { h: null, c: null };
function hudAndCaption() {
  if (!CUR) return;
  const { c, o, m } = CUR, ph = phase(PB.te);
  const mode = { eye: "Witness eye, 30° across", zoom: "Zoom 3x, 10° across", orbit: "Orbit view (drag to turn, scroll to zoom)" }[V.mode];
  const hud = `<span><b>${esc(c.short)}</b> ${dist(o.dh)}, ${fmt(o.L, 0)} ft, ${fmt(T.angle, 2)}°</span><span class="more">${mode}</span><span class="more">${T.time} MST, sun ${fmt(sunAt(T.time).alt, 0)}° up${V.metar ? `, sky per ${esc(PG.metar_station || "METAR")} ${layersFor(T.time).obs.time_mst}` : ", sky as remembered"}</span>`;
  if (hud !== HUDC.h) { $("hud").innerHTML = hud; HUDC.h = hud; }
  let cap = "";
  if (PB.te > 0 || PB.playing) {
    if (ph.k === "watch") cap = `Watching, ${mmss(PB.te)} of ${mmss(T.duration)}. ${c.motion.mode === "free" ? `Drifting with the wind: ${fmt(m.drift * PB.te / T.duration, 1)}° so far.` : esc(c.motion.basis) + "."}`;
    else if (ph.k === "glance") cap = `They look away for ${fmt(T.glance, 1)} s${PG.glance_words ? ", " + PG.glance_words : ""}.`;
    else cap = `They look back. ${esc(c.after_glance.text)}`;
  }
  if (cap !== HUDC.c) { const el = $("caption"); el.textContent = cap; el.classList.toggle("on", !!cap); $("vp").classList.toggle("captioned", !!cap); HUDC.c = cap; }
  $("clock").textContent = `${ph.k === "watch" ? "watching" : ph.k === "glance" ? "glance away" : "looking back"}, ${mmss(Math.min(PB.te, T.duration + T.glance))}`;
}
let LBL_KEY = "", THUMB_RECT = null;
const hits = (r, list) => list.some((q) => r[0] < q[0] + q[2] && r[0] + r[2] > q[0] && r[1] < q[1] + q[3] && r[1] + r[3] > q[1]);
function objScreenRect() {
  if (!G3.obj || !G3.obj.visible || V.mode === "orbit") return null;
  const w = $("vp").clientWidth, h = $("vp").clientHeight, ppd = h / G3.cam.fov, p = G3.obj.position.clone().project(G3.cam);
  if (p.z > 1) return null;
  const cx = (p.x + 1) / 2 * w, cy = (1 - p.y) / 2 * h, ow = Math.max(8, CUR.o.th * ppd), oh = Math.max(6, CUR.o.angH * ppd);
  return [cx - ow / 2, cy - oh / 2, ow, oh];
}
// Labels never sit on the object: landmarks hang below their ridge points, the object's label sits beside it,
// and anything that would still collide with the object, the thumb or the HUD is dropped.
function drawLabels() {
  const box = $("labels");
  if (!V.labels || !CUR) { if (box.innerHTML) box.innerHTML = ""; LBL_KEY = ""; return; }
  const { c, o } = CUR, cam = G3.cam, w = $("vp").clientWidth, h = $("vp").clientHeight, pts = D.points;
  const proj = (v) => { const p = v.clone().project(cam); return p.z > 1 || p.z < -1 || Math.abs(p.x) > 1.02 || Math.abs(p.y) > 1.02 ? null : [(p.x + 1) / 2 * w, (1 - p.y) / 2 * h]; };
  const items = [], ob = objScreenRect();
  if (G3.obj && G3.obj.visible) {
    const t = `${c.short}: ${dist(o.dh)}, ${fmt(o.L, 0)} ft`;
    if (ob) items.push({ t, cls: "obj", x: ob[0] + ob[2] + 8, y: ob[1] + ob[3] / 2, ax: "left", ay: "mid", alt: { x: ob[0] - 8, ax: "right" } });
    else { const q = proj(G3.obj.position); if (q) items.push({ t, cls: "obj", x: q[0], y: q[1] + 8, ax: "center", ay: "top" }); }
  }
  for (const [t, pt] of [["Cheyenne Mtn summit", pts.summit], ["Antenna farm", pts.antenna_farm]]) { const q = proj(V3(...pt.enu)); if (q) items.push({ t, cls: "land", x: q[0], y: q[1] + 10, ax: "center", ay: "top" }); }
  if (V.mode === "orbit") { const q = proj(V3(0, 0, 450)); if (q) items.push({ t: "Stair top (witnesses)", cls: "", x: q[0], y: q[1] - 6, ax: "center", ay: "bottom" }); }
  const key = items.map((i) => `${i.t}|${Math.round(i.x)}|${Math.round(i.y)}`).join(";") + "|" + (THUMB_RECT ? THUMB_RECT.map(Math.round).join(",") : "") + "|" + w + "x" + h + "|" + $("hud").offsetHeight;
  if (key === LBL_KEY) return; LBL_KEY = key;
  box.innerHTML = items.map((i) => `<div class="${i.cls}">${esc(i.t)}</div>`).join("");
  const vr = $("vp").getBoundingClientRect(), hr = $("hud").getBoundingClientRect();
  const obst = [[hr.left - vr.left - 4, hr.top - vr.top - 4, hr.width + 8, hr.height + 8]];
  if (ob) obst.push([ob[0] - 5, ob[1] - 5, ob[2] + 10, ob[3] + 10]);
  if (THUMB_RECT) obst.push(THUMB_RECT);
  [...box.children].forEach((el, k) => {
    const it = items[k], W = el.offsetWidth, H = el.offsetHeight;
    const at = (x, ax) => { const l = ax === "left" ? x : ax === "right" ? x - W : x - W / 2, t = it.ay === "mid" ? it.y - H / 2 : it.ay === "top" ? it.y : it.y - H;
      return [Math.max(2, Math.min(w - W - 2, l)), Math.max(2, Math.min(h - H - 2, t)), W, H]; };
    let r = at(it.x, it.ax);
    if (hits(r, obst) && it.alt) r = at(it.alt.x, it.alt.ax);
    if (hits(r, obst) && it.cls === "obj") { const below = [Math.max(2, Math.min(w - W - 2, ob[0] + ob[2] / 2 - W / 2)), ob[1] + ob[3] + 8, W, H]; if (!hits(below, obst)) r = below; }
    if (hits(r, obst) && it.cls !== "obj") { el.style.display = "none"; return; }
    el.style.left = r[0] + "px"; el.style.top = r[1] + "px"; obst.push(r);
  });
}
function drawOverlay() {
  const cv = $("overlay"), x = cv.getContext("2d"), dpr = cv.width / Math.max(1, $("vp").clientWidth);
  x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, cv.width, cv.height); THUMB_RECT = null;
  if (V.mode === "orbit" || !CUR || !G3.obj) return;
  const w = $("vp").clientWidth, h = $("vp").clientHeight, ppd = h / G3.cam.fov;
  // 1-degree ruler
  x.strokeStyle = "rgba(21,25,28,0.85)"; x.fillStyle = "rgba(21,25,28,0.85)"; x.lineWidth = 2; x.font = "12px IBM Plex Sans, sans-serif";
  x.beginPath(); x.moveTo(w - 20 - ppd, h - 22); x.lineTo(w - 20, h - 22); x.moveTo(w - 20 - ppd, h - 27); x.lineTo(w - 20 - ppd, h - 17); x.moveTo(w - 20, h - 27); x.lineTo(w - 20, h - 17); x.stroke();
  x.textAlign = "right"; x.fillText("1°", w - 22, h - 30);
  if (!V.thumb || phase(PB.te).k !== "watch") return;
  const { o } = CUR, p = G3.obj.position.clone().project(G3.cam);
  if (p.z > 1) return;
  const cx = (p.x + 1) / 2 * w, cy = (1 - p.y) / 2 * h;
  const tl = 2 * Math.atan(P.thumb_length_in / 2 / P.arm_in) * R2D * ppd, tb = 2 * Math.atan(K.thumb_breadth_mm / K.mm_per_in / 2 / P.arm_in) * R2D * ppd;
  const objW = T.angle * ppd, x0 = cx - objW / 2, y0 = cy - o.angH * ppd / 2 - 0.35 * ppd - tb;
  const zoom = V.mode === "zoom";
  x.save(); x.globalAlpha = zoom ? 0.9 : 0.62; x.fillStyle = "#d9a98a"; x.strokeStyle = "#8a5a44"; x.lineWidth = zoom ? 1.5 : 1;
  const r = tb / 2; x.beginPath(); x.moveTo(x0 + r, y0 + tb * 0.04); x.lineTo(x0 + tl, y0); x.lineTo(x0 + tl, y0 + tb); x.lineTo(x0 + r, y0 + tb * 0.96); x.arc(x0 + r, y0 + r, r * 0.96, Math.PI / 2, Math.PI * 1.5); x.closePath();
  if (!zoom) x.fill(); x.stroke();
  x.beginPath(); x.ellipse(x0 + tb * 0.75, y0 + tb / 2, tb * 0.55, tb * 0.36, 0, 0, Math.PI * 2); if (!zoom) { x.fillStyle = "#f1d9cc"; x.fill(); } else x.stroke();
  x.restore();
  x.strokeStyle = "rgba(21,25,28,0.9)"; x.setLineDash([4, 3]); x.beginPath(); x.moveTo(x0 + tl / 2, y0 - 3); x.lineTo(x0 + tl / 2, y0 + tb + 3); x.stroke(); x.setLineDash([]);
  const narrow = w < 560; x.font = (narrow ? "11px" : "12px") + " IBM Plex Sans, sans-serif";
  let lab = PG.gesture_label || "gesture at arm's length"; if (narrow || x.measureText(lab).width > w - 8) lab = lab.replace(/ at arm's length/, "");
  const tw = x.measureText(lab).width, tx = Math.max(4, Math.min(w - tw - 4, x0));
  x.textAlign = "left"; x.fillStyle = "rgba(21,25,28,0.95)"; x.fillText(lab, tx, y0 - 6);
  THUMB_RECT = [Math.min(x0, tx) - 2, y0 - 20, Math.max(x0 + tl, tx + tw) - Math.min(x0, tx) + 4, tb + 22];
}

/* ---------------- side profile and ladder */
function axes(o) {
  const { W, H, m, x, y } = o;
  const sx = (v) => m.l + (x.log ? (Math.log10(v) - Math.log10(x.min)) / (Math.log10(x.max) - Math.log10(x.min)) : (v - x.min) / (x.max - x.min)) * (W - m.l - m.r);
  const sy = (v) => H - m.b - (y.log ? (Math.log10(v) - Math.log10(y.min)) / (Math.log10(y.max) - Math.log10(y.min)) : (v - y.min) / (y.max - y.min)) * (H - m.t - m.b);
  let s = "";
  for (const t of y.ticks) s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${sy(t)}" y2="${sy(t)}"/><text x="${m.l - 6}" y="${sy(t) + 4}" text-anchor="end">${y.fmt(t)}</text>`;
  for (const t of x.ticks) s += `<line class="grid" y1="${m.t}" y2="${H - m.b}" x1="${sx(t)}" x2="${sx(t)}"/><text x="${sx(t)}" y="${H - m.b + 16}" text-anchor="middle">${x.fmt(t)}</text>`;
  s += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/><line class="axis" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${H - m.b}"/>`;
  s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 4}" text-anchor="middle">${x.label}</text><text x="12" y="${(m.t + H - m.b) / 2}" transform="rotate(-90 12 ${(m.t + H - m.b) / 2})" text-anchor="middle">${y.label}</text>`;
  return { s, sx, sy };
}
const lg = (v) => (v >= 1000 ? fmt(v / 1000, v >= 10000 || v % 1000 === 0 ? 0 : 1) + "k" : fmt(v, v < 1 ? 1 : 0));
function placeLabels(items, bounds, boxes) {
  boxes = boxes || []; let out = "";
  for (const it of items.slice().sort((p, q) => p.x - q.x)) {
    const w = it.text.length * 6.0 + 4, h = 12;
    for (const [dx, dy] of [[7, -6], [7, 14], [7, -19], [7, 27], [-7, -6], [-7, 14], [7, -32], [-7, 27]]) {
      let anchor = dx < 0 || it.x + dx + w > bounds.r ? "end" : "start";
      const x0 = anchor === "end" ? it.x - Math.abs(dx) - w : it.x + dx, y0 = it.y + dy - 10;
      if (x0 < bounds.l || y0 < bounds.t || y0 + h > bounds.b) continue;
      if (boxes.some((q) => x0 < q[0] + q[2] && x0 + w > q[0] && y0 < q[1] + q[3] && y0 + h > q[1])) continue;
      boxes.push([x0, y0, w, h]);
      out += `<text class="hit" data-c="${it.id}" x="${anchor === "end" ? x0 + w : x0}" y="${y0 + 10}" text-anchor="${anchor}" style="${it.sel ? "font-weight:600; fill:var(--ink)" : ""}">${esc(it.text)}</text>`;
      break;
    }
  }
  return out;
}
function sightZ(el, dFt) { return D.eye_ft + dFt * Math.tan((el - refr(dFt)) * D2R) + dFt * dFt / (2 * RE_FT); }
function allPlacements() { return CANDS.map((c) => ({ c, o: placeCand(c) })); }
function profile(all) {
  const svg = $("ch-profile"), W = 640, H = 380, m = { l: 56, r: 14, t: 12, b: 38 }, cur = CUR.o;
  const xmax = 30, A = axes({ W, H, m, x: { min: 0, max: xmax, ticks: [0, 5, 10, 15, 20, 25, 30], fmt: (v) => v, label: "Distance from the stairs (mi)" },
    y: { min: 5000, max: 33000, ticks: [5000, 10000, 15000, 20000, 25000, 30000], fmt: lg, label: "Altitude (ft above sea level)" } });
  let s = A.s; const boxes = [];
  const ly = layersFor(T.time);
  for (const L of ly.layers) { s += `<rect x="${m.l}" width="${W - m.l - m.r}" y="${A.sy(L.msl) - 3}" height="6" fill="var(--muted)" fill-opacity="0.18"/><text x="${m.l + 6}" y="${A.sy(L.msl) - 6}">${esc(PG.metar_station || "")} ${ly.obs.time_mst}: ${L.cov} at ${fmt(L.msl, 0)} ft</text>`; boxes.push([m.l + 6, A.sy(L.msl) - 16, 190, 12]); }
  const tp = []; for (let d = 0; d <= 10.01; d += 0.05) { const h = terrainAt(AZ, d * FT_MI); if (h != null) tp.push([d, h]); }
  s += `<path d="M${A.sx(0)},${A.sy(5000)} ${tp.map(([d, h]) => `L${A.sx(d)},${A.sy(h)}`).join(" ")} L${A.sx(tp[tp.length - 1][0])},${A.sy(5000)} Z" fill="#7d7a62" fill-opacity="0.55" stroke="#55533f"/>`;
  s += `<text x="${A.sx(9.8)}" y="${A.sy(5450)}" text-anchor="end" style="fill:#f4f1e6">terrain data ends at 10 mi</text>`;
  for (const el of [cur.bottom, cur.top]) { const pts = []; for (let d = 0; d <= xmax; d += 0.25) { const z = sightZ(el, d * FT_MI); if (z <= 33000) pts.push(`${A.sx(d)},${A.sy(z)}`); } s += `<polyline points="${pts.join(" ")}" fill="none" stroke="var(--s1)" stroke-width="1.2" stroke-dasharray="5 3"/>`; }
  const rx0 = A.sx(R["geom.ridge.dist_ft"] / FT_MI);
  s += `<line class="ref" x1="${rx0}" x2="${rx0}" y1="${A.sy(12500)}" y2="${H - m.b}"/><text x="${rx0 - 3}" y="${A.sy(12800)}" text-anchor="end">ridge crest</text>`; boxes.push([rx0 - 70, A.sy(12800) - 10, 70, 12]);
  // near-field inset, lower right (empty sky below the sight line)
  const ix = A.sx(12.2), iw = A.sx(29.6) - ix, ih = 128, iy = A.sy(5000) - ih - 8, nx = 2.6;
  const isx = (d) => ix + d / nx * iw, isy = (z) => iy + ih - (z - 5800) / (8600 - 5800) * ih;
  let ins = `<rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" fill="var(--panel)" stroke="var(--line)"/><text x="${ix + 4}" y="${iy + 12}">first ${nx} mi, 5,800 to 8,600 ft</text>`;
  const tn = tp.filter(([d]) => d <= nx); ins += `<path d="M${isx(0)},${isy(5800)} ${tn.map(([d, h]) => `L${isx(d)},${isy(Math.max(5800, h))}`).join(" ")} L${isx(tn[tn.length - 1][0])},${isy(5800)} Z" fill="#7d7a62" fill-opacity="0.45"/>`;
  for (const el of [cur.bottom, cur.top]) ins += `<line x1="${isx(0)}" y1="${isy(D.eye_ft)}" x2="${isx(nx)}" y2="${isy(Math.min(8600, sightZ(el, nx * FT_MI)))}" stroke="var(--s1)" stroke-width="1" stroke-dasharray="4 3"/>`;
  const mainL = [], insL = [];
  for (const { c, o } of all) {
    const sel = c.id === V.cand, colr = sel ? "var(--s2)" : "var(--ink-2)", d = o.dh / FT_MI;
    const tipT = `${esc(c.short)}: ${dist(o.dh)}, ${fmt(o.L, 0)} ft, centre ${fmt(o.alt, 0)} ft`;
    if (d > nx && d <= xmax && o.alt < 33000) {
      const rx = Math.max(2.5, (A.sx(d + o.L / 2 / FT_MI) - A.sx(d - o.L / 2 / FT_MI)) / 2), ry = Math.max(2.5, (A.sy(o.alt - o.H / 2) - A.sy(o.alt + o.H / 2)) / 2);
      s += `<ellipse class="hit" data-c="${c.id}" data-tip="${tipT}" cx="${A.sx(d)}" cy="${A.sy(o.alt)}" rx="${rx}" ry="${ry}" fill="${colr}" fill-opacity="${sel ? 0.9 : 0.45}" stroke="${sel ? "var(--ink)" : "none"}"/>`;
      mainL.push({ x: A.sx(d) + rx - 6, y: A.sy(o.alt), text: c.short, sel, id: c.id });
    } else if (d <= nx) {
      const px = isx(d), py = isy(o.alt);
      ins += `<circle class="hit" data-c="${c.id}" data-tip="${tipT}" cx="${px}" cy="${py}" r="${sel ? 4.5 : 3}" fill="${colr}" stroke="var(--panel)"/>`;
      insL.push({ x: px, y: py, text: `${c.short} ${dist(o.dh)}`, sel, id: c.id });
    }
  }
  s += placeLabels(mainL, { l: m.l, r: W - m.r, t: m.t, b: iy - 4 }, boxes);
  ins += placeLabels(insL, { l: ix + 2, r: ix + iw - 2, t: iy + 16, b: iy + ih - 2 });
  svg.innerHTML = s + ins; hoverTips(svg);
  svg.querySelectorAll(".hit").forEach((e) => e.addEventListener("click", () => select(e.dataset.c)));
}
function ladder(all) {
  const svg = $("ch-ladder"), W = 640, H = 380, m = { l: 58, r: 14, t: 12, b: 38 };
  const X = { min: 10, max: 40 * FT_MI, log: true, ticks: [10, 100, 1000, FT_MI, 10 * FT_MI], fmt: (v) => (v >= FT_MI ? fmt(v / FT_MI, 0) + " mi" : fmt(v, 0) + " ft"), label: "Distance from the stairs (log scale)" };
  const Y = { min: 0.5, max: 20000, log: true, ticks: [1, 10, 100, 1000, 10000], fmt: lg, label: "Object length (ft, log scale)" };
  const A = axes({ W, H, m, x: X, y: Y }); let s = A.s;
  const sz = (d, a) => 2 * d * Math.tan(a * D2R / 2);
  const band = [], N = 60; for (let i = 0; i <= N; i++) { const d = X.min * Math.pow(X.max / X.min, i / N); band.push([d, sz(d, A_MIN), sz(d, A_MAX)]); }
  const clampY = (v) => Math.min(Y.max, Math.max(Y.min, v));
  s += `<path d="M${band.map(([d, a]) => `${A.sx(d)},${A.sy(clampY(a))}`).join(" L")} L${band.slice().reverse().map(([d, , b]) => `${A.sx(d)},${A.sy(clampY(b))}`).join(" L")} Z" fill="var(--s1)" fill-opacity="0.12"/>`;
  s += `<polyline points="${band.map(([d]) => `${A.sx(d)},${A.sy(clampY(sz(d, T.angle)))}`).join(" ")}" fill="none" stroke="var(--s1)" stroke-width="1.6"/>`;
  const rd = R["geom.ridge.dist_ft"], st = R["stereo.max_dist_ft"];
  s += `<rect x="${m.l}" y="${m.t}" width="${A.sx(rd) - m.l}" height="${H - m.t - m.b}" fill="var(--crit)" fill-opacity="0.05"/>`;
  for (const [v, t, yy] of [[st, "two-eye depth limit", m.t + 12], [rd, "ridge crest", m.t + 12], [PIN_DH, "2022 pin", m.t + 26]]) s += `<line class="ref" x1="${A.sx(v)}" x2="${A.sx(v)}" y1="${m.t}" y2="${H - m.b}"/><text x="${A.sx(v) + 3}" y="${yy}">${t}</text>`;
  s += `<text x="${A.sx(rd) - 4}" y="${H - m.b - 8}" text-anchor="end">in front of the mountain</text>`;
  const labs = [];
  for (const { c, o } of all) {
    const sel = c.id === V.cand, colr = sel ? "var(--s2)" : "var(--ink-2)";
    if (c.size.mode === "fixed") {
      const L = o.L, d0 = L / 2 / Math.tan(A_MAX * D2R / 2), d1 = L / 2 / Math.tan(A_MIN * D2R / 2);
      s += `<line x1="${A.sx(Math.max(X.min, d0))}" x2="${A.sx(Math.min(X.max, d1))}" y1="${A.sy(L)}" y2="${A.sy(L)}" stroke="${colr}" stroke-width="${sel ? 3 : 2}" stroke-opacity="${sel ? 1 : 0.6}"/>`;
    } else {
      const st2 = CS[c.id], pts = []; for (let i = 0; i <= 12; i++) { const sc = st2.min * Math.pow(st2.max / st2.min, i / 12), d = PIN_DH * sc; pts.push(`${A.sx(d)},${A.sy(clampY(sz(d / Math.cos(o.elc * D2R), T.angle) * (o.L / sz(o.slant, T.angle))))}`); }
      s += `<polyline points="${pts.join(" ")}" fill="none" stroke="${colr}" stroke-width="${sel ? 3 : 2}" stroke-opacity="${sel ? 1 : 0.6}"/>`;
    }
    const px = A.sx(Math.min(X.max, Math.max(X.min, o.dh))), py = A.sy(clampY(o.L));
    s += `<circle class="hit" data-c="${c.id}" data-tip="${esc(c.short)}: ${dist(o.dh)}, ${fmt(o.L, 0)} ft" cx="${px}" cy="${py}" r="${sel ? 6 : 4.5}" fill="${colr}" stroke="var(--panel)" stroke-width="1.5"/>`;
    labs.push({ x: px, y: py, text: c.short, sel, id: c.id });
  }
  s += placeLabels(labs, { l: m.l + 2, r: W - m.r, t: m.t + 30, b: H - m.b - 14 }, [[A.sx(rd) - 130, H - m.b - 20, 130, 14]]);
  svg.innerHTML = s; hoverTips(svg);
  svg.querySelectorAll(".hit").forEach((e) => e.addEventListener("click", () => select(e.dataset.c)));
}

/* ---------------- trace table and transcript reader */
const CUES = D.cues.map(([i, t, sp, tx]) => ({ i, t, sp, tx }));
const CUE_BY = Object.fromEntries(CUES.map((c) => [c.i, c]));
const USED = {}; D.ledger.forEach((r) => r.cues.split(";").filter(Boolean).forEach((i) => (USED[+i] = USED[+i] || []).push(r.id)));
const SPFIX = {}; D.fixes.forEach((f) => String(f.srt_index).split(";").forEach((i) => (SPFIX[+i] = SPFIX[+i] || []).push(f)));
function liveValue(r) {
  const o = CUR && CUR.o;
  switch (r.parameter) {
    case "time_mst": return `${T.time} MST`;
    case "gap_ft_at_6mi": return `${fmt(T.gap, 0)} ft`;
    case "angle_deg_source": return `${fmt(T.angle, 2)}°`;
    case "duration_s": return `${T.duration} s`;
    case "glance-away window": return `${fmt(T.glance, 1)} s`;
    case "distance_scale": return o ? dist(o.dh) : "";
    case "height_to_length, depth_to_length": return CBY[V.cand].shape.user_shape ? `${fmt(T.h2l, 2)}, ${fmt(T.d2l, 2)}` : `${CBY[V.cand].shape.h2l}, ${CBY[V.cand].shape.d2l} (${esc(CBY[V.cand].short)})`;
    case "cloud layers shown": return V.metar ? "METAR layers" : "clear (as remembered)";
    default: return esc(r.default);
  }
}
function traceTable() {
  $("trace").innerHTML = `<thead><tr><th>Element on screen</th><th>Setting now</th><th>Range allowed</th><th>Built from (exact words)</th><th>How</th></tr></thead><tbody>` + D.scene_trace.map((r) => {
    const ids = r.claims.split(";");
    const q = ids.map((id) => { const L = LED[id]; const ex = L.excerpt.length > 140 ? L.excerpt.slice(0, 137) + "..." : L.excerpt; return `<div style="margin-bottom:4px">${cl(id)} <q>${esc(ex)}</q> <span class="small muted">${L.excerpt_kind === "transcript" ? "interview " + esc(L.timestamp) : esc(L.timestamp.replace(/^REC /, ""))}</span></div>`; }).join("");
    return `<tr><td><b>${esc(r.element)}</b></td><td class="mono" data-live="${esc(r.parameter)}">${liveValue(r)}</td><td>${esc(r.viewer_range)}</td><td>${q}</td><td class="small">${esc(r.how)}</td></tr>`;
  }).join("") + `</tbody>`;
}
function refreshTraceLive() { $("trace").querySelectorAll("[data-live]").forEach((td) => { const r = D.scene_trace.find((x) => x.parameter === td.dataset.live); td.innerHTML = liveValue(r); }); }
function markCue(c) {
  let t = esc(c.tx);
  for (const id of USED[c.i] || []) for (const seg of LED[id].excerpt.split(" ... ")) { const s = esc(seg.trim()); if (s.length > 3 && t.includes(s)) t = t.replace(s, `<mark>${s}</mark>`); }
  return t;
}
function reader() {
  const only = $("rd-used").checked, q = $("rd-q").value.toLowerCase();
  const rows = CUES.filter((c) => (!only || USED[c.i]) && (!q || (c.tx + " " + c.sp).toLowerCase().includes(q)));
  $("rd-count").textContent = `${rows.length} lines`;
  $("reader").innerHTML = rows.map((c) => {
    const fx = (SPFIX[c.i] || []).map((f) => `<div class="fix">${esc(f.id)} ${f.kind === "speaker" ? "speaker label" : esc(f.kind)}: ${esc(f.corrected)} (${esc(f.reason)})</div>`).join("");
    return `<div class="cue ${USED[c.i] ? "used" : ""}" id="cue-${c.i}"><span class="tm">${mmss(c.t)}</span><span class="sp">${esc(c.sp)}</span><span class="tx">${markCue(c)}${fx}${USED[c.i] ? `<span class="tags">${USED[c.i].map(cl).join("")}</span>` : ""}</span></div>`;
  }).join("");
}
function showCue(i) {
  if (!document.getElementById("cue-" + i)) { $("rd-used").checked = false; $("rd-q").value = ""; reader(); }
  const el = document.getElementById("cue-" + i); if (!el) return;
  const box = $("reader"); $("rd-h").scrollIntoView({ block: "start" });
  box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 40;
  el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 2200);
}
$("rd-used").addEventListener("change", reader); $("rd-q").addEventListener("input", reader);

/* ---------------- appendix */
function appendix() {
  const tpl = (t) => String(t || "").replace(/\{\{([\w.]+)\|(\d)\}\}/g, (_, k, dp) => (R[k] == null ? "n/a" : rv(k, +dp)));
  const tiles = (PG.tiles || []).map((t) => ({ lab: esc(t.lab), val: tpl(t.val), txt: tpl(t.txt) }));
  $("tiles").innerHTML = tiles.map((t) => `<div class="tile"><div class="lab">${t.lab}</div><div class="val">${t.val}</div><div class="txt">${t.txt}</div></div>`).join("");
  const cols = [...new Set(D.hypotheses.map((r) => r.claim_or_criterion))].filter((c) => c !== "K1" && c !== "K2");
  const cell = {}; D.hypotheses.forEach((r) => (cell[r.hypothesis + "|" + r.claim_or_criterion] = r));
  let h = `<thead><tr><th>Rank</th><th>Candidate</th><th>X</th><th>S</th><th>F</th><th>K1</th><th>K2</th>${cols.map((c) => `<th>${cl(c)}</th>`).join("")}</tr></thead><tbody>`;
  for (const s of D.hyp_summary) {
    h += `<tr><td class="c">${s.rank}${s.rank_among_K1_yes !== "" ? "" : "*"}</td><td>${esc(s.label)}</td><td class="c">${s.contradicts}</td><td class="c">${s.strains}</td><td class="c">${s.fits}</td>`;
    for (const k of ["K1", "K2"]) { const c = cell[s.hypothesis + "|" + k]; h += `<td class="c" title="${esc(c.reason)}">${c.verdict === "yes" ? chip("good", "yes") : chip("crit", "no")}</td>`; }
    for (const c of cols) { const r = cell[s.hypothesis + "|" + c]; h += `<td class="c"><span class="v ${r.verdict}" data-tip="<b>${s.hypothesis} vs ${c}</b><br>${esc((LED[c] || {}).paraphrase || "")}<br><i>${esc(r.reason)}</i>">${r.verdict}</span></td>`; }
    h += "</tr>";
  }
  $("hyp").innerHTML = h + `</tbody><caption style="caption-side:bottom; text-align:left; padding:8px; font-size:12px; color:var(--muted)">* Fails K1: ranks first by construction because it is defined by the testimony. Neutral cells do not penalize, so candidates with many neutrals rank higher than their plausibility suggests.</caption>`;
  hoverTips($("hyp"));
  chartSun(); chartTemp();
  const drawLedger = () => {
    const q = $("f-q").value.toLowerCase(), rows = D.ledger.filter((r) => !q || Object.values(r).join(" ").toLowerCase().includes(q));
    $("f-count").textContent = `${rows.length} of ${D.ledger.length} claims`;
    $("ledger").innerHTML = `<thead><tr><th>ID</th><th>Time</th><th>Src</th><th>Speaker</th><th>Exact words</th><th>Paraphrase</th><th>Type</th><th>Role</th><th>Model use</th></tr></thead><tbody>` +
      rows.map((r) => `<tr><td>${cl(r.id)}</td><td class="mono">${esc(r.timestamp)}</td><td class="mono">${r.source}</td><td>${esc(r.speaker)}</td><td><q>${esc(r.excerpt)}</q></td><td>${esc(r.paraphrase)}</td><td>${esc(r.type)}</td><td>${esc(r.role)}</td><td>${esc(r.model_use)}</td></tr>`).join("") + `</tbody>`;
  };
  $("f-q").addEventListener("input", drawLedger); drawLedger();
  const simple = (id, rows, cols2, names) => { $(id).innerHTML = `<thead><tr>${names.map((n) => `<th>${n}</th>`).join("")}</tr></thead><tbody>` + rows.map((r) => `<tr>${cols2.map((c) => `<td${c === "id" ? ' class="mono"' : ""}>${c === "url" ? (/^https?:/.test(r[c]) ? `<a href="${esc(r[c])}" target="_blank" rel="noopener">${esc(r.publisher_or_author)}</a>` : esc(r.publisher_or_author)) : esc(r[c])}</td>`).join("")}</tr>`).join("") + `</tbody>`; };
  simple("amb", D.ambiguities, ["id", "topic", "claims", "readings", "default", "why_default", "resolve_by"], ["ID", "Topic", "Claims", "Readings", "Default", "Why", "What would resolve it"]);
  simple("fixes", D.fixes, ["id", "timestamp", "as_transcribed", "corrected", "kind", "reason"], ["ID", "Time", "As transcribed", "Corrected", "Kind", "Reason"]);
  simple("sources", D.sources, ["id", "title", "url", "date", "what_it_supports", "tier"], ["ID", "Title", "Publisher (link)", "Date", "Supports", "Tier"]);
  $("params").innerHTML = Object.entries(D.parameter_meta).map(([k, m]) => { const v = D.parameters[k]; return `<dt class="mono">${k}</dt><dd>${esc(Array.isArray(v) ? v.join(", ") : v)} ${esc(m.unit)} <span class="sub">(${esc(m.basis)}; range ${esc(m.range.join(" to "))})</span> ${/INVENTED/.test(m.basis) ? '<span class="invented">ANALYST INVENTED</span>' : ""}</dd>`; }).join("");
}
const tmin = (t) => { const [a, b] = t.split(":").map(Number); return a * 60 + b; };
function chartSun() {
  const svg = $("ch-sun"), W = 560, H = 300, m = { l: 46, r: 18, t: 14, b: 40 };
  const A = axes({ W, H, m, x: { min: 570, max: 840, ticks: [570, 600, 660, 720, 780, 840], fmt: (v) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`, label: "Time (MST), 15 Feb 2022" }, y: { min: 0, max: 45, ticks: [0, 10, 20, 30, 40], fmt: (v) => v + "°", label: "Sun altitude" } });
  let s = A.s + `<polyline points="${D.sun_window.map((r) => `${A.sx(tmin(r.time_mst))},${A.sy(r.sun_alt)}`).join(" ")}" fill="none" stroke="var(--s1)" stroke-width="2"/>`;
  for (const [k, t] of Object.entries(TR)) { const r = D.sun_window.find((x) => x.time_mst === t) || D.sun_window[0]; s += `<circle cx="${A.sx(tmin(t))}" cy="${A.sy(r.sun_alt)}" r="5" fill="var(--s1)" stroke="var(--panel)" stroke-width="2" data-tip="${esc(k)} ${t}: sun ${fmt(r.sun_alt, 1)}° up"/><text x="${A.sx(tmin(t))}" y="${A.sy(r.sun_alt) - 9}" text-anchor="middle">${(k.match(/C\d\d/) || [""])[0]}</text>`; }
  s += `<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${A.sy(10)}" y2="${A.sy(10)}"/><text x="${W - m.r - 4}" y="${A.sy(10) - 4}" text-anchor="end">a "low" sun would sit below about 10°</text>`;
  svg.innerHTML = s; hoverTips(svg);
}
function chartTemp() {
  const svg = $("ch-temp"), W = 560, H = 300, m = { l: 46, r: 18, t: 14, b: 40 };
  const A = axes({ W, H, m, x: { min: 470, max: 900, ticks: [480, 540, 600, 660, 720, 780, 840, 900], fmt: (v) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`, label: "Time (MST)" }, y: { min: 30, max: 70, ticks: [30, 40, 50, 60, 70], fmt: (v) => v + "°F", label: "Temperature" } });
  let s = A.s + `<rect x="${m.l}" width="${W - m.l - m.r}" y="${A.sy(54)}" height="${A.sy(46) - A.sy(54)}" fill="var(--s3)" fill-opacity="0.14"/><text x="${W - m.r - 4}" y="${A.sy(54) + 13}" text-anchor="end">"about 50 F" (46-54)</text>`;
  for (const [st, c] of [...new Set(D.wx_temps.map((w) => w.station))].slice(0, 3).map((st, i) => [st, `var(--s${i + 1})`])) {
    const r = D.wx_temps.filter((w) => w.station === st && tmin(w.time_mst) >= 470 && tmin(w.time_mst) <= 900);
    s += `<polyline points="${r.map((w) => `${A.sx(tmin(w.time_mst))},${A.sy(w.t_f)}`).join(" ")}" fill="none" stroke="${c}" stroke-width="2"/>`;
    for (const w of r) s += `<circle cx="${A.sx(tmin(w.time_mst))}" cy="${A.sy(w.t_f)}" r="4" fill="${c}" stroke="var(--panel)" stroke-width="2" data-tip="${st} ${w.time_mst} MST: ${fmt(w.t_f, 1)} F${w.clouds ? ", " + esc(w.clouds) : ""}"/>`;
  }
  svg.innerHTML = s; hoverTips(svg);
}

/* ---------------- view mode, selection, update */
function setMode(mode) {
  V.mode = mode; for (const [id, k] of [["v-eye", "eye"], ["v-zoom", "zoom"], ["v-orbit", "orbit"]]) $(id).setAttribute("aria-pressed", String(k === mode));
  if (!G3) return; setFov();
  const orbit = mode === "orbit"; G3.controls.enabled = orbit; G3.sight.visible = orbit; G3.track.visible = orbit; G3.obsM.visible = orbit;
  if (orbit && CUR) {
    const o = CUR.o, d = Math.max(o.dh, 3 * FT_MI), tgt = V3(0.5 * d * Math.sin(AZ * D2R), 0.5 * d * Math.cos(AZ * D2R), Math.max(1500, 0.5 * (o.alt - D.eye_ft)));
    G3.cam.position.copy(tgt.clone().add(V3(0.55 * d, -0.75 * d, 0.45 * d))); G3.controls.target.copy(tgt); G3.controls.update();
  }
  G3.dirty = true;
}
for (const [id, k] of [["v-eye", "eye"], ["v-zoom", "zoom"], ["v-orbit", "orbit"]]) $(id).addEventListener("click", () => setMode(k));
$("t-metar").addEventListener("change", () => { V.metar = $("t-metar").checked; rebuildLayers(); update(); });
$("t-thumb").addEventListener("change", () => { V.thumb = $("t-thumb").checked; G3 && (G3.dirty = true); });
$("t-labels").addEventListener("change", () => { V.labels = $("t-labels").checked; G3 && (G3.dirty = true); });
$("t-anim").addEventListener("change", () => { V.anim = $("t-anim").checked; G3 && (G3.dirty = true); });
function select(id) {
  if (!CBY[id]) return; V.cand = id; needRebuild = true; PB.te = 0; PB.playing = false; $("p-t").value = 0; $("p-play").textContent = "Play the event"; $("p-play").setAttribute("aria-pressed", "false");
  document.querySelectorAll(".cand").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.c === id)));
  try { history.replaceState(null, "", "#c=" + id); } catch (e) { /* sandboxed */ }
  buildCandControls(); update(); if (V.mode === "orbit") setMode("orbit");
}
let lastLayerTime = null;
function update() {
  const c = CBY[V.cand], o = placeCand(c), m = metrics(c, o);
  CUR = { c, o, m };
  if (G3) {
    if (needRebuild) { if (G3.obj) { G3.holder.remove(G3.obj); G3.obj.traverse((n) => { if (n.geometry) n.geometry.dispose(); }); } G3.obj = buildCand(c); G3.holder.add(G3.obj); needRebuild = false; }
    G3.obj.scale.setScalar(o.L * S); G3.obj.rotation.set(0, (90 - (AZ + 90)) * D2R, 0);
    const s = sunAt(T.time), sv = sunVec(s); G3.sun.position.copy(sv.clone().multiplyScalar(5000)); G3.sun.target.position.set(0, 0, 0); G3.sky.material.uniforms.uSun.value.copy(sv);
    if (V.metar && lastLayerTime !== layersFor(T.time).obs.time_mst) { lastLayerTime = layersFor(T.time).obs.time_mst; rebuildLayers(); }
    const far = 32 * FT_MI, segs = [];
    for (const el of [o.bottom, o.top]) segs.push(new THREE.Vector3(0, 0, 0), V3(far * Math.sin(AZ * D2R), far * Math.cos(AZ * D2R), far * Math.tan(el * D2R)));
    G3.sight.geometry.setFromPoints(segs);
    const e0 = o.dh * Math.sin(AZ * D2R), n0 = o.dh * Math.cos(AZ * D2R), u0 = o.alt - D.eye_ft, tt = T.duration;
    G3.track.geometry.setFromPoints([V3(e0, n0, u0), V3(e0 + m.vel[0] * tt, n0 + m.vel[1] * tt, u0)]); G3.track.computeLineDistances();
    G3.dirty = true;
  }
  updateOutputs(o); readout(c, o, m); checklist(c);
  const all = allPlacements(); profile(all); ladder(all);
  for (const { c: cc, o: oo } of all) { const e = $("rx-" + cc.id); if (e) e.textContent = `${dist(oo.dh)} away, ${fmt(oo.L, 0)} ft`; }
  refreshTraceLive();
}

/* ---------------- test hooks */
window.__check = () => {
  const o = place({ scale: 1, gap: P.gap_ft_at_6mi, angle: R["size.gesture.default_deg"], h2l: P.height_to_length, d2l: P.depth_to_length, yaw: P.yaw_deg });
  const s = sunAt(VD.time_mst); return { length_ft: o.L, alt_center_ft: o.alt, el_center: o.elc, el_bottom: o.bottom, terrain_under_ft: o.ter, sun_alt: s.alt, sun_az: s.az, az: o.az };
};
window.__cands = () => {
  const t0 = { ...T, gap: P.gap_ft_at_6mi, angle: A_DEF, h2l: P.height_to_length, d2l: P.depth_to_length, duration: P.duration_s, glance: P.glance_s };
  const saved = JSON.stringify(CS), out = {};
  for (const c of CANDS) {
    if (c.size.mode === "fit") { CS[c.id].scale = R[`cand.${c.id}.default.scale`]; const keep = { ...T }; Object.assign(T, t0); const o = placeCand(c); const m = metrics(c, o); Object.assign(T, keep); out[c.id] = { key: `cand.${c.id}.default`, dist_mi: o.dh / FT_MI, length_ft: o.L, alt_center_ft: o.alt, drift_deg: m.drift }; }
    else c.size.options.forEach((_, i) => { CS[c.id].opt = i; const keep = { ...T }; Object.assign(T, t0); const o = placeCand(c); const m = metrics(c, o); Object.assign(T, keep); out[`${c.id}.opt${i}`] = { key: `cand.${c.id}.opt${i}.default`, dist_mi: o.dh / FT_MI, length_ft: o.L, alt_center_ft: o.alt, drift_deg: m.drift, dba: m.dba }; });
  }
  Object.assign(CS, JSON.parse(saved)); return out;
};
window.__three = () => G3; window.__select = select; window.__setMode = setMode; window.__state = () => ({ cand: V.cand, mode: V.mode, te: PB.te, T: { ...T } });
window.__seek = (te) => { PB.playing = false; PB.te = te; G3 && (G3.dirty = true); };

/* ---------------- go */
buildTestimony(); buildCandControls(); traceTable(); reader(); appendix();
initThree(); update(); setMode(V.mode);
document.querySelectorAll(".cand").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.c === V.cand)));
new MutationObserver(() => update()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
requestAnimationFrame(frame);
}
