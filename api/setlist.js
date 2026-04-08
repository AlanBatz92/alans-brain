// Vercel serverless function — proxies requests to setlist.fm API
// Avoids CORS issues since the call happens server-side

const SETLIST_BASE = 'https://api.setlist.fm/rest/1.0';
const API_KEY = 'vyNcQzeLTe_xV5pVtKlrt3EmJo2v8WzCB0xM';

export default async function handler(req, res) {
  const { path } = req.query;

  if (!path) {
    return res.status(400).json({ error: 'Missing path parameter' });
  }

  // Build the target URL, forwarding any extra query params
  // Use string concatenation — new URL() with an absolute path drops the base path
  const target = SETLIST_BASE + path;
  const url = new URL(target);
  // Copy all query params except 'path' itself
  for (const [key, value] of Object.entries(req.query)) {
    if (key !== 'path') url.searchParams.set(key, value);
  }

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'x-api-key': API_KEY
      }
    });

    const data = await response.text();

    // Forward status and CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.status(response.status).send(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
