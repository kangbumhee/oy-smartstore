const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map();
const TIMEOUT = 30000;

function cacheKey(keyword, size) {
  return `${String(keyword || '').trim().toLowerCase()}|${size}`;
}

function pruneCache() {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.ts > CACHE_TTL) cache.delete(k);
  }
  while (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first == null) break;
    cache.delete(first);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const { keyword, size = '50' } = req.query || {};
  if (!keyword) return res.status(400).json({ success: false, message: 'keyword required' });

  const ck = cacheKey(keyword, size);
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(hit.status).send(hit.body);
  }

  const lat = '37.6152';
  const lng = '126.7156';
  const url = `https://mcp.aka.page/api/oliveyoung/inventory?keyword=${encodeURIComponent(keyword)}&lat=${lat}&lng=${lng}&size=${encodeURIComponent(size)}`;

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), TIMEOUT);
    let r;
    try {
      r = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'OYSmartStore/1.0' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(t);
    }

    const text = await r.text();
    pruneCache();
    cache.set(ck, { body: text, status: r.status, ts: Date.now() });

    res.setHeader('X-Cache', 'MISS');
    return res.status(r.status).send(text);
  } catch (e) {
    const isAbort = e && e.name === 'AbortError';
    return res.status(500).json({
      error: isAbort ? 'upstream timeout' : (e.message || 'Proxy error'),
      code: isAbort ? 'TIMEOUT' : 'FETCH_ERROR',
    });
  }
};
