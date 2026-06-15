# PLAN — Systematic Review of alansbrain.com (June Ship)

> A time-boxed pass to get alansbrain.com **feature-complete for an MVP** you're
> comfortable linking on socials. Target **go-live ≈ 2 weeks out** (you finish two
> masters classes end of June — the goal is to leave the site resting on a good,
> exciting, *secure* note). Source: `Next_Big_Steps__June_Ship.md`.
>
> **Guiding principles**
> - **No feature creep.** Every page gets reviewed; we ship an MVP, not everything.
> - **Polish beats breadth.** All the small cleanups + one flagship that *lands*,
>   not three big builds half-finished.
> - **Security is a launch gate**, not an afterthought (it's a public link).
> - **Content is the long pole.** A lot of this is assets only Alan can make
>   (music, commercials, art, sounds, transcripts). I build the scaffolding; those
>   slot in as the assets arrive.
> - Match conventions in `Current State.md` (vanilla HTML/CSS/JS, JSON-driven,
>   `sl-`/`pulse-`/`obs-` prefixes, theme vars, box code under `birdstation/`).
>
> **Tags:** effort **S/M/L** · owner **🤖 code (Claude)** / **🧑 asset (Alan)** ·
> status `[ ]` todo `[~]` in progress `[x]` done.

---

## Scope decisions (locked 2026-06-14)

- **Flagship for go-live = Pulse "interests + events" feed.** The other two big
  builds — **Radio Station** and **Monte Cassino** — are **deferred to immediate
  post-launch** (designed here, built after the ship).
- **Start order:** cleanups + removals first (low-risk, no asset wait), then the
  flagship, with theme/content slotting in as assets land, then a security pass.
- This doc is the tracker; linked from `ROADMAP.md`. Update checkboxes as we go and
  add a dated `Build History.md` entry per landed chunk (per project convention).

---

## Phase 0 — Triage & open decisions  ▶ do up front

These gate other work; settle before building the dependent piece.

- [ ] **Pulse flagship — IMAP auth method.** App-password vs OAuth for reading the
      newsletter inbox. App-password is simplest; **must live only in
      `/etc/birdstation.env`** (never committed, like `ANTHROPIC_API_KEY`). Consider a
      **dedicated/forwarding inbox** that only receives newsletters, so the creds can't
      touch your primary mail. *(decision needed before Phase 4)*
- [ ] **Events sourcing cadence.** Which venues are API/scrape-able vs **manual**
      (you said you'll hand-curate on a cadence if needed): Shankweiler's, Emmaus
      Theater, Archer, East State Theater, Civic Theater, Frank Banko, + festivals
      (Strawberry Fest). `PLAN-ingestion.md` already settled Archer via Ticketmaster
      Discovery API; the rest need a per-source fetchability test. *(decision needed)*
- [ ] **Post-launch: Monte Cassino host.** Non-YouTube, "essence of the internet"
      vibe. Self-hosted `<audio>` on the site is the most on-brand + zero-dependency;
      alternatives are a decision for the post-launch build.
- [ ] **Post-launch: Radio music licensing.** Hosting copyrighted music on a public,
      socially-linked site is a real legal exposure. Options: your own tracks,
      royalty-free/CC, or short clips. *(decision needed before Radio build)*

---

## Phase 1 — Cleanups, removals, verbiage  ▶ start here  (all 🤖, all fast)

The fast, high-payoff polish. Knocks out ~10 items, no asset wait, makes the whole
site read as "MVP-ready."

**Removals / verbiage (trivial sweeps)**
- [x] **S 🤖** Remove `"Built with HTML, CSS, and JS — the way the web was meant to
      be"` footer — **all 14 pages** (confirmed present site-wide). *(done 2026-06-14)*
- [x] **S 🤖** Remove `"Privacy-safe — no IPs, hostnames, ports, or credentials
      anywhere on this page"` note on Stack (`techstack.html`) + its orphaned CSS. *(done)*
- [x] **S 🤖** Pride & Identity (`transart.html`): "art, voices, and resources **that
      matter**" → "art, voices, and resources". *(done)*

**Bird / Observatory cleanups**
- [x] **S 🤖** Bird life cards: text overflow ("text runneth over") — min-width:0 +
      overflow-wrap on the species name, life-list rows, and bird-card stat cells.
      *(done 2026-06-14; `?v=obs27`. Worth an eyeball on the live page to confirm.)*
- [x] **M 🤖** "Almost a lifer" shelf: show birds almost-a-lifer **by any metric**, not
      just 3-hits-at-85%. Added the cumulative route (6–7 of 8 all-time @ ≥0.70); the
      shelf now merges both paths, dedupes to the nearer one, and labels each card's
      scope. *(done 2026-06-14; `?v=obs36`. The ~100% instant path can't be "almost".)*
- [x] **M 🤖** Analytics: charts crowd / collide at high counts (e.g. sorting "all
      time", large numbers). Inline hour/day bar numbers now hide < 600px (the
      tap-to-detail popout is the mobile read path); desktop keeps them. *(done
      2026-06-15; `?v=obs28`. **VERIFY on preview** — please confirm phones read cleanly.)*

**Stack (`techstack.html`)**
- [x] **S 🤖** Expand node size — 56→64px (52px mobile), icons/glyphs + NODE_R to match.
      *(done 2026-06-15. **VERIFY on preview** — confirm no nodes overlap at the dense spots.)*
- [x] **S 🤖** Ensure all text is visible / not cut off — removed the label `max-width`
      + ellipsis truncation so full names ("alansbrain.com") show. *(done 2026-06-15)*
- [x] **S 🤖** Remove arbitrary glossary definitions (e.g. USB). *(done 2026-06-14)*
- [ ] **🧑 DEFERRED** Ensure **all** icons are custom (replace remaining emoji fallbacks:
      Alan, birdstation, GitHub, Vercel, Anthropic, Visitor). *(deferred — needs icon
      assets/choices; the existing set has nothing suitable. Revisit post-launch.)*

**Home page**
- [ ] **🧑 DEFERRED** Custom icons for **Pulse** and **Observatory** Explore cards.
      *(deferred with the Stack icons — same asset gap.)*

**Process**
- [x] **S 🤖** Add a convention to `CLAUDE.md`: *update the Stack page whenever a piece
      of technology is added or changed.* (Keeps `techstack.html` honest over time.) *(done)*

---

## Phase 1b — Weather app ("My Week") overhaul  ▶ first ship  (🤖)

A "clean and accurate" pass on `weather.html` / `weather.js`. Added to the first ship
2026-06-14. Ordered by priority; the first item is also a **security launch-gate** item.

**Security / accuracy (must)**
- [x] **M 🤖 + 🧑** **Move the OpenWeatherMap API key server-side.** Added
      **`api/weather.js`** (key from the `OPENWEATHER_API_KEY` env var, endpoint
      whitelist); `weather.js` calls the proxy and the key is gone from the client.
      *(done 2026-06-14. 🧑 **ACTION:** set `OPENWEATHER_API_KEY` in Vercel + **rotate**
      the old key. Also in Phase 5.)*
- [x] **M 🤖** **Fix the "vs. yesterday" comparison.** Replaced the relabeled-forecast
      hack with a **real** historical comparison via One Call 3.0 `day_summary` (through
      the proxy), timezone-aware date, cached per day/location. *(done 2026-06-14)*
- [x] **S 🤖** **Bucket the hourly windows + day labels in the location's timezone**,
      not the viewer's. New `locHour`/`locDow`/`locDateStr` helpers (from
      `timezone_offset`); `findOptimalWindow`/`getHoursForDay`/`windowMetrics`/the day
      cards all read in the forecast clock. *(done 2026-06-15. `updateTimestamp` stays
      viewer-local — it's when *you* refreshed.)*

**Cleanup (should)**
- [x] **S 🤖** Collapse the duplicate `scoreInverse()` into `scoreRange()` (15 callers
      repointed). *(done 2026-06-15)*
- [x] **S 🤖** Fix the drone daily **visibility fudge** — surface the assumed visibility
      ("clear (assumed)" / "reduced (fog)") with real points instead of a fake `20/20 —`.
      *(done 2026-06-15)*
- [x] **S 🤖** Replace the `prompt()`/`alert()` custom-location flow with an inline form
      (name/lat/lon, validation, Enter-to-save, inline errors). *(done 2026-06-15.
      **VERIFY on preview** — confirm the form looks right.)*

**Calibration (subjective — with Alan)**
- [ ] **S 🤖+🧑** Review the running/drone/tanning **thresholds** together; retune any
      band that feels off. Open to suggestions — this is the judgment-call part.

---

## Phase 2 — Theme polish  (🤖 engine / 🧑 some assets)

- [ ] **M 🤖** **Space theme — starfield background**, optional toggle. Pure CSS/canvas,
      **no assets needed** — I can do this end-to-end. Good early win.
- [ ] **M 🤖+🧑** **Quake theme — fully fleshed out.** Quake/Quake2 button textures,
      optional menu **SFX**, optional swirling **"sky"** background. 🤖 the
      toggles/rendering/settings; 🧑 (or sourced) the **textures + sound assets** —
      ⚠️ check licensing on real Quake assets before shipping on a public site.

---

## Phase 3 — Content expansion  (mostly 🧑 assets, 🤖 wiring)

Scaffolding is quick; the schedule risk is asset production while you're in finals.
Batch the assets; I wire them in as they land.

- [ ] **M 🤖+🧑** **Art:** grow from 2 → **10 pieces** (good cross-section of interests).
      🧑 images + captions, 🤖 JSON + gallery wiring (`art.html`/`gallery.js`/`data`).
- [ ] **M 🤖+🧑** **Soundboards:** ~**10–15 essential sounds per existing page** +
      several **rotating section icons**. 🧑 audio clips + icons, 🤖 JSON + wiring.
- [ ] **M 🤖+🧑** **Paranormal — Case #1 (Weygandt UAP/UFO):** methodology for
      compiling/transcribing the few Weygandt interviews + follow-up FOIA gaps / case-
      validity notes. 🧑 research/transcripts, 🤖 the case page.
- [ ] **S–M 🤖+🧑** **Pride & Identity:** add **Resources**, **Art**, and **Polyamory**
      books/podcasts that have helped you. 🧑 the lists/media, 🤖 page wiring (tabs exist).

---

## Phase 4 — FLAGSHIP: Pulse "interests + events" feed  (🤖 build / 🧑 creds + curation)

Same general page as Pulse / a new tab — a "what I'm interested in" feed plus a
venue/festival events surface. Builds on the **already-designed `PLAN-ingestion.md`
Phase 4** (pluggable adapters, separate `events` store, "What's On" surface).

**Build order (smallest shippable slices first):**
- [ ] **M 🤖** Schema + router: add `type`/`config`/`content_kind` to `feed_sources`,
      add the `events` table, and the adapter router (per `PLAN-ingestion.md`).
- [ ] **M 🤖** `api` adapter + **Archer Music Hall** via Ticketmaster Discovery API
      (needs a free `TICKETMASTER_API_KEY` in `/etc/birdstation.env`). First real events.
- [ ] **M 🤖** `GET /api/events` + a **"What's On" card** on the Pulse page (front-end
      reader, same thin pattern as the feed/digest).
- [ ] **M 🤖** `manual` adapter + a paste/entry path so venues with no API/scrape
      (Emmaus Theater, Civic, Frank Banko, festivals) can be curated on a cadence.
- [ ] **L 🤖+🧑** **IMAP newsletter ingestion** — an `email` adapter that reads a
      newsletter inbox into the interests feed. ⚠️ **Security-sensitive** (see Phase 5):
      creds only in `/etc/birdstation.env`; prefer a dedicated/forwarding inbox; read-only.
      🧑 the inbox + creds, 🤖 the adapter.
- [ ] **S 🤖** `scrape` adapter (AI-as-parser) for no-API venues **only where a server
      fetch actually works** (many 403 — test each before adding; per the plan's caveat).

---

## Phase 5 — Security review  ▶ launch gate  (🤖)

A dedicated pass before the link goes anywhere public. Run `/security-review` on the
diff, plus targeted checks:

- [ ] **Secrets:** no keys/creds committed; IMAP + Ticketmaster keys only in
      `/etc/birdstation.env` (chmod 600); `.gitignore` still blocks `*.env`/`*.db`.
- [ ] **OpenWeatherMap key:** moved behind the `api/weather.js` proxy (Phase 1b) and the
      old client-exposed key **rotated**. No third-party API keys in any static asset.
- [ ] **IMAP surface:** read-only, dedicated inbox, no creds in static JS or any API
      response; failure modes don't leak the address.
- [ ] **XSS:** every new rendered string (events, newsletter items) goes through
      `escapeHtml()` like the rest of Pulse. Newsletter HTML is untrusted input —
      sanitize hard.
- [ ] **New endpoints** (`/api/events`, any events writer) — writers key-guarded
      (`X-API-Key`/`BIRD_API_KEY`) like the train verdict routes; reads are safe/public.
- [ ] **CORS** still scoped to `alansbrain.com`/`www`.
- [ ] **Audio hosting** (radio/Monte Cassino, when built) — no hotlinking abuse, no
      copyrighted material exposed.
- [ ] **General page review:** every page loads clean, no console errors, no dead
      links, nothing half-built visible to a visitor.

---

## Phase 6 — Box-side (Observatory)  (🤖 / 🧑 labeling)

- [ ] **M 🤖** **Train detection — group passes** that are minutes apart as **one
      train**. Pass-grouping already exists in `birdstation/train_analytics.py`
      (`pass_gap_min`); apply/surface it consistently so counts read as *trains*, not clips.
- [ ] **🧑** Compile more labeled train events to increase dataset accuracy (corpus →
      recalibrate via the existing `build_horn_profile.py` loop).

---

## Deferred — immediate post go-live (designed, built after the ship)

- **Radio Station / Music Player** (GTA Vice City vibe): a few "stations", random
  "commercials" every 1–2 songs (toggle in settings), needs ≥12 commercials. 🤖 player
  engine; 🧑 music + commercials; ⚠️ licensing decision first.
- **Monte Cassino** (music project): demos/riffs/drum parts, non-YouTube host with the
  right internet vibe. 🤖 page + self-hosted audio; 🧑 demos + host decision.
- **Scorched Earth** hosted on-site with realistic DOS loading / background. (Your doc's
  explicit "future/next" item.)

---

## Suggested 2-week sequence

- **Days 1–3:** Phase 1 (all cleanups/removals/verbiage) — ships fast, instantly
  raises the floor. Phase 2 Space starfield as a quick win. *In parallel: Alan settles
  Phase 0 decisions + starts batching Phase 3 assets.*
- **Days 4–9:** Phase 4 flagship in slices (schema → Archer/api → What's On card →
  manual adapter → IMAP). Slot Phase 3 content + Quake theme as assets arrive.
- **Days 10–12:** Phase 6 train grouping; finish any content wiring.
- **Days 13–14:** Phase 5 security review + full page-by-page MVP walkthrough → **go-live**.
