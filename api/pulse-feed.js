// Vercel serverless function — proxies RSS/Atom feed requests for Pulse.
// Exists for the same reason as api/setlist.js: browsers can't fetch these
// cross-origin feeds directly (CORS). The function fetches the raw XML
// server-side and returns it with permissive CORS headers; all parsing
// happens client-side in pulse.js.
//
// Locked to an allow-list of source domains so it can't be abused as an
// open proxy. To add a Pulse source, add its hostname suffix here AND add
// the feed URL to the SOURCES list in pulse.js.

const ALLOWED_HOSTS = [
  'lehighvalleynews.com',
  'wfmz.com',
  'mcall.com',
  'lehighvalleylive.com',
  'pa.gov',
  'governor.pa.gov',
  'fema.gov',
  'feedburner.com',
  'feeds.feedburner.com'
];

function hostAllowed(hostname) {
  const h = hostname.toLowerCase();
  return ALLOWED_HOSTS.some(function (allowed) {
    return h === allowed || h.endsWith('.' + allowed);
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  let target;
  try {
    target = new URL(url);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid url' });
  }

  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return res.status(400).json({ error: 'Unsupported protocol' });
  }

  if (!hostAllowed(target.hostname)) {
    return res.status(403).json({ error: 'Host not in allow-list: ' + target.hostname });
  }

  try {
    const response = await fetch(target.toString(), {
      headers: {
        // Some feeds 403 a bare fetch; present as a normal browser/reader.
        'User-Agent': 'Mozilla/5.0 (compatible; AlansBrainPulse/0.1; +https://alansbrain.com)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
      }
    });

    const body = await response.text();

    // Pass the upstream content-type through when it looks like XML, else
    // default to xml so the client's DOMParser does the right thing.
    const upstreamType = response.headers.get('content-type') || '';
    const contentType = /xml/i.test(upstreamType) ? upstreamType : 'application/xml; charset=utf-8';

    // Cache at the edge briefly so repeated visits don't hammer sources.
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    res.status(response.status).send(body);
  } catch (err) {
    res.status(502).json({ error: 'Fetch failed: ' + err.message });
  }
}
