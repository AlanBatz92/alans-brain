// Vercel serverless function — proxies requests to the OpenWeatherMap One Call 3.0 API.
// Keeps the API key server-side (read from the OPENWEATHER_API_KEY env var) so it is
// never exposed in client JS. The browser calls /api/weather instead of OWM directly.
//
// Setup (one-time, in the Vercel project settings):
//   1. Add an Environment Variable  OPENWEATHER_API_KEY = <your key>
//   2. Rotate the old key that previously lived in weather.js (it was public).
//
// Usage from the browser (same-origin):
//   /api/weather?endpoint=onecall&lat=40.54&lon=-75.50&units=imperial&exclude=minutely,alerts
//   /api/weather?endpoint=day_summary&lat=40.54&lon=-75.50&date=2026-06-13&units=imperial

const OWM_BASE = 'https://api.openweathermap.org/data/3.0';

// Whitelist of allowed upstream endpoints (prevents the proxy being used to hit
// arbitrary URLs) and the query params each may forward.
const ALLOWED_ENDPOINTS = {
  onecall:     '/onecall',
  day_summary: '/onecall/day_summary',
  timemachine: '/onecall/timemachine'
};
const ALLOWED_PARAMS = ['lat', 'lon', 'units', 'exclude', 'date', 'dt', 'lang'];

export default async function handler(req, res) {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'OPENWEATHER_API_KEY is not configured on the server' });
  }

  const endpoint = req.query.endpoint || 'onecall';
  const path = ALLOWED_ENDPOINTS[endpoint];
  if (!path) {
    return res.status(400).json({ error: 'Unknown endpoint' });
  }

  const url = new URL(OWM_BASE + path);
  for (const name of ALLOWED_PARAMS) {
    if (req.query[name] != null) url.searchParams.set(name, req.query[name]);
  }
  url.searchParams.set('appid', key);

  try {
    const response = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
    const data = await response.text();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.status(response.status).send(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
