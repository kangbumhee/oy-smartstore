const { getAccessToken, getAuthHeadersFromToken, resolveCredentials, resolveToken, proxyFetch, NAVER_API_BASE } = require('../../lib/naver-auth');

const GROUP_PRODUCTS_URL = `${NAVER_API_BASE}/v2/standard-group-products`;
const GROUP_STATUS_URL = `${NAVER_API_BASE}/v2/standard-group-products/status`;

async function parseResponseBody(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function pollGroupStatus(headers, requestId, timeoutMs = 50000, intervalMs = 3000) {
  const start = Date.now();
  const url = `${GROUP_STATUS_URL}?requestId=${encodeURIComponent(requestId)}`;

  while (Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    try {
      const response = await proxyFetch(url, {
        headers: { ...headers, Accept: 'application/json;charset=UTF-8' },
      });

      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      const progress = data.progress || data;
      const state = progress.state || data.state;

      if (state === 'COMPLETED' || state === 'ERROR' || state === 'FAILED') {
        return {
          state,
          groupProductNo: data.groupProductNo || progress.groupProductNo || null,
          requestId: data.requestId || requestId,
          productNos: data.productNos || progress.productNos || [],
          failReason: data.failReason || progress.failReason || progress.invalidInputs || null,
          raw: data,
        };
      }
    } catch {
      // ignore and retry until timeout
    }
  }

  return null;
}

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

    if (req.method === 'GET') {
      const { groupProductNo } = req.query || {};
      if (!groupProductNo) return res.status(400).json({ success: false, error: 'groupProductNo query parameter required' });

      const response = await proxyFetch(`${GROUP_PRODUCTS_URL}/${encodeURIComponent(groupProductNo)}`, {
        headers: { ...headers, Accept: 'application/json;charset=UTF-8' },
      });
      const data = await parseResponseBody(response);
      return res.status(response.status).json({ success: response.ok, data, status: response.status });
    }

    if (req.method === 'PUT') {
      let body;
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return res.status(400).json({ success: false, error: 'Invalid JSON' }); }

      const { groupProductNo, groupProduct } = body || {};
      if (!groupProductNo || !groupProduct) {
        return res.status(400).json({ success: false, error: 'groupProductNo and groupProduct required' });
      }

      const payload = { groupProduct };
      const response = await proxyFetch(`${GROUP_PRODUCTS_URL}/${encodeURIComponent(groupProductNo)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await parseResponseBody(response);

      if (!response.ok) {
        return res.status(response.status).json({ success: false, data, status: response.status });
      }

      const progress = data.progress || data;
      const state = progress.state || data.state || '';
      const requestId = data.requestId || progress.requestId || '';

      if ((state === 'QUEUED' || state === 'PROCESSING') && requestId) {
        const final = await pollGroupStatus(headers, requestId);
        if (final?.state === 'COMPLETED') {
          return res.status(200).json({
            success: true,
            state: final.state,
            requestId: final.requestId,
            groupProductNo: final.groupProductNo,
            productNos: final.productNos,
            data: final.raw,
          });
        }

        if (final?.state === 'ERROR' || final?.state === 'FAILED') {
          return res.status(200).json({
            success: false,
            state: final.state,
            requestId: final.requestId,
            groupProductNo: final.groupProductNo,
            productNos: final.productNos,
            error: final.failReason || '그룹상품 수정 실패',
            data: final.raw,
          });
        }
      }

      return res.status(200).json({
        success: true,
        state,
        requestId,
        groupProductNo,
        data,
      });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('[group-products] Error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};
