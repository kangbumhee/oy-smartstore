const { getAccessToken, getAuthHeadersFromToken, resolveCredentials, resolveToken, proxyFetch, NAVER_API_BASE } = require('../../lib/naver-auth');

const ORIGIN_PRODUCTS_URL = `${NAVER_API_BASE}/v2/products/origin-products`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, PATCH, DELETE, OPTIONS');
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

    if (req.method === 'GET') {
      const { productNo, page = '1' } = req.query || {};

      if (productNo) {
        const url = `${ORIGIN_PRODUCTS_URL}/${productNo}`;
        const r = await proxyFetch(url, { headers });
        const data = await r.json().catch(() => ({}));
        return res.status(r.status).json({ success: r.ok, data });
      }

      const r = await proxyFetch(`${ORIGIN_PRODUCTS_URL}?page=${page}&size=50`, { headers });
      const data = await r.json().catch(() => ({}));
      return res.status(r.status).json({ success: r.ok, data });
    }

    if (req.method === 'PUT') {
      let body;
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
      const { productNo } = body;
      if (!productNo) return res.status(400).json({ error: 'productNo required' });

      const url = `${ORIGIN_PRODUCTS_URL}/${productNo}`;
      const payload = { originProduct: {} };

      if (body.action === 'pause') {
        payload.originProduct.statusType = 'SUSPENSION';
      } else if (body.action === 'resume') {
        payload.originProduct.statusType = 'SALE';
      } else {
        if (body.price !== undefined) payload.originProduct.salePrice = body.price;
        if (body.stock !== undefined) payload.originProduct.stockQuantity = body.stock;
        if (body.statusType) payload.originProduct.statusType = body.statusType;
      }

      const r = await proxyFetch(url, { method: 'PUT', headers, body: JSON.stringify(payload) });
      const data = await r.json().catch(() => ({}));
      return res.status(r.status).json({ success: r.ok, data });
    }

    if (req.method === 'PATCH') {
      let body;
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
      const { productNo, optionCombinations, useStockManagement } = body;
      if (!productNo) return res.status(400).json({ error: 'productNo required' });

      if (optionCombinations && optionCombinations.length > 0) {
        const url = `${ORIGIN_PRODUCTS_URL}/${productNo}/option-stock`;
        const payload = {
          optionInfo: {
            optionCombinations: optionCombinations,
          },
        };
        if (useStockManagement !== undefined) {
          payload.useStockManagement = useStockManagement;
        }

        const r = await proxyFetch(url, { method: 'PUT', headers, body: JSON.stringify(payload) });
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { raw: text }; }

        console.log(`[option-stock] productNo=${productNo} options=${optionCombinations.length} status=${r.status}`);
        return res.status(r.status).json({ success: r.ok, data });
      }

      return res.status(400).json({ error: 'optionCombinations required for PATCH' });
    }

    if (req.method === 'DELETE') {
      const { productNo } = req.query || {};
      if (!productNo) return res.status(400).json({ error: 'productNo query parameter required' });

      const url = `${ORIGIN_PRODUCTS_URL}/${productNo}`;
      const payload = {
        originProduct: {
          statusType: 'SUSPENSION',
        },
      };

      const r = await proxyFetch(url, { method: 'PUT', headers, body: JSON.stringify(payload) });
      const data = await r.json().catch(() => ({}));
      return res.status(r.status).json({ success: r.ok, data, note: '네이버 API는 삭제 미지원 → 판매중지 처리됨' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[products] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
