// Vercel serverless function — proxies write requests to Spotify API
// Works around potential CORS/browser restrictions on playlist modification

const SPOTIFY_BASE = 'https://api.spotify.com/v1';

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  const { endpoint } = req.query;
  const authHeader = req.headers.authorization;

  if (!endpoint) {
    return res.status(400).json({ error: 'Missing endpoint parameter' });
  }

  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const url = SPOTIFY_BASE + endpoint;

  try {
    const fetchOptions = {
      method: req.method || 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      }
    };

    if (req.body && (req.method === 'POST' || req.method === 'PUT')) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(url, fetchOptions);
    const data = await response.text();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    // On error, include debug info
    if (!response.ok) {
      const debugHeaders = {};
      response.headers.forEach((value, key) => {
        debugHeaders[key] = value;
      });
      return res.status(response.status).send(JSON.stringify({
        spotifyStatus: response.status,
        spotifyBody: data,
        spotifyHeaders: debugHeaders,
        requestUrl: url,
        requestMethod: fetchOptions.method,
        bodyPreview: fetchOptions.body ? fetchOptions.body.substring(0, 200) : null
      }));
    }

    res.status(response.status).send(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
