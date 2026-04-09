const { getAccessToken, getAuthHeadersFromToken, resolveCredentials, resolveToken, proxyFetch, NAVER_API_BASE } = require('../../lib/naver-auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Naver-Client-Id, X-Naver-Client-Secret, X-Naver-Token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    let token = resolveToken(req);
    if (!token) {
      const { clientId, clientSecret } = resolveCredentials(req);
      const result = await getAccessToken(clientId, clientSecret);
      token = result.token;
    }
    const headers = getAuthHeadersFromToken(token);

    if (req.method === 'PUT') {
      let body;
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
      const { productNo, price, stock, action } = body;
      if (!productNo) return res.status(400).json({ error: 'productNo required' });
      const url = `${NAVER_API_BASE}/v2/products/${productNo}`;
      const payload = { originProduct: {} };
      if (action === 'pause') payload.originProduct.statusType = 'SUSPENSION';
      else {
        if (price !== undefined) payload.originProduct.salePrice = price;
        if (stock !== undefined) payload.originProduct.stockQuantity = stock;
      }
      const r = await proxyFetch(url, { method: 'PUT', headers, body: JSON.stringify(payload) });
      const data = await r.json().catch(() => ({}));
      return res.status(r.status).json({ success: r.ok, data });
    }

    const { page = '1' } = req.query || {};
    const r = await proxyFetch(`${NAVER_API_BASE}/v2/products?page=${page}&size=50`, { headers });
    const data = await r.json().catch(() => ({}));
    return res.status(r.status).json({ success: r.ok, data });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
};
