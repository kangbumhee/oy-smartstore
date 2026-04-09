const { getAccessToken, getAuthHeadersFromToken, resolveCredentials, resolveToken, proxyFetch, NAVER_API_BASE } = require('../../lib/naver-auth');

const GROUP_PRODUCTS_URL = `${NAVER_API_BASE}/v2/standard-group-products`;
const GROUP_STATUS_URL = `${NAVER_API_BASE}/v2/standard-group-products/status`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Naver-Client-Id, X-Naver-Client-Secret, X-Naver-Token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    let body = {};
    if (req.method === 'POST') {
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch { body = {}; }
    }

    let token = resolveToken(req, body);
    if (!token) {
      const { clientId, clientSecret } = resolveCredentials(req);
      const result = await getAccessToken(clientId, clientSecret);
      token = result.token;
    }
    const headers = getAuthHeadersFromToken(token);

    const action = body.action || req.query?.action || 'status';
    const requestId = body.requestId || req.query?.requestId;

    const results = {};

    if (action === 'status' && requestId) {
      const url = `${GROUP_STATUS_URL}?requestId=${encodeURIComponent(requestId)}`;
      console.log('[group-status] checking:', url);
      const r = await proxyFetch(url, { headers: { ...headers, Accept: 'application/json;charset=UTF-8' } });
      const text = await r.text();
      results.statusCheck = { httpStatus: r.status, body: text.substring(0, 2000) };
    }

    if (action === 'status-no-param' || action === 'all') {
      const r = await proxyFetch(GROUP_STATUS_URL, { headers: { ...headers, Accept: 'application/json;charset=UTF-8' } });
      const text = await r.text();
      results.statusNoParam = { httpStatus: r.status, body: text.substring(0, 2000) };
    }

    if (action === 'list' || action === 'all') {
      const r = await proxyFetch(`${GROUP_PRODUCTS_URL}?page=1&size=5`, { headers: { ...headers, Accept: 'application/json;charset=UTF-8' } });
      const text = await r.text();
      results.groupList = { httpStatus: r.status, body: text.substring(0, 2000) };
    }

    return res.status(200).json({ success: true, action, requestId, results });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
};
