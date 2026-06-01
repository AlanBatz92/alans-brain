/* ──────────────────────────────────────────────────────────────
   BirdInfo — Wikipedia fetch helper for Observatory bird cards.

   BirdInfo.get(scientificName, commonName) → Promise<BirdData|null>

   BirdData shape:
     { photo, photo_full, description, extract, url, title, attribution }

   Strategy:
   1. Check in-memory cache (current page session).
   2. Check localStorage cache (30-day TTL across visits).
   3. Check /data/bird-overrides.json for any hand-tuned entry.
   4. Fetch Wikipedia Summary REST API — scientific name first, common name
      as fallback (scientific is more precise; Wikipedia resolves species
      redirects well). Disambiguation pages and empty extracts are skipped.
   5. Cache result in memory + localStorage. Return null on total failure
      so the card degrades gracefully (shows name + local history only).

   Attribution: Wikipedia content is CC BY-SA — the returned `url` and
   `attribution` fields must be shown on any card that displays this data.
   ────────────────────────────────────────────────────────────── */

const BirdInfo = (() => {
  const CACHE_PREFIX = 'bird_wiki_';
  const TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days

  const memCache = {};

  // ── localStorage helpers ──────────────────────────────────────

  function lsGet(key) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.ts > TTL_MS) {
        localStorage.removeItem(CACHE_PREFIX + key);
        return null;
      }
      return entry.data;
    } catch (_) { return null; }
  }

  function lsSet(key, data) {
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
    } catch (_) {}
  }

  // ── Per-species overrides (optional, gracefully absent) ───────

  let overridesPromise = null;

  function loadOverrides() {
    if (!overridesPromise) {
      overridesPromise = fetch('/data/bird-overrides.json')
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));
    }
    return overridesPromise;
  }

  // ── Wikipedia Summary REST API ────────────────────────────────

  async function fetchWikipedia(title) {
    const url = 'https://en.wikipedia.org/api/rest_v1/page/summary/' +
                encodeURIComponent(title);
    let resp;
    try {
      resp = await fetch(url);
    } catch (_) { return null; }
    if (!resp.ok) return null;
    const data = await resp.json();
    // Skip disambiguation pages and articles with no useful text.
    if (data.type === 'disambiguation' || !data.extract) return null;
    return data;
  }

  function wikiToData(wiki) {
    return {
      photo:       wiki.thumbnail     ? wiki.thumbnail.source     : null,
      photo_full:  wiki.originalimage ? wiki.originalimage.source : null,
      description: wiki.description   || null,
      extract:     wiki.extract,
      url:         wiki.content_urls?.desktop?.page || null,
      title:       wiki.title,
      // Attribution text required by CC BY-SA — always render with the card.
      attribution: 'Wikipedia contributors',
    };
  }

  // ── Public API ────────────────────────────────────────────────

  async function get(scientificName, commonName) {
    const cacheKey = scientificName || commonName;
    if (!cacheKey) return null;

    if (memCache[cacheKey]) return memCache[cacheKey];

    const cached = lsGet(cacheKey);
    if (cached) {
      memCache[cacheKey] = cached;
      return cached;
    }

    // Overrides take priority over Wikipedia.
    const overrides = await loadOverrides();
    const override = (scientificName && overrides[scientificName]) ||
                     (commonName     && overrides[commonName]);
    if (override) {
      memCache[cacheKey] = override;
      lsSet(cacheKey, override);
      return override;
    }

    // Wikipedia: scientific name first, common name as fallback.
    let wiki = null;
    for (const name of [scientificName, commonName]) {
      if (!name) continue;
      wiki = await fetchWikipedia(name);
      if (wiki) break;
    }

    if (!wiki) return null;

    const result = wikiToData(wiki);
    memCache[cacheKey] = result;
    lsSet(cacheKey, result);
    return result;
  }

  return { get };
})();
