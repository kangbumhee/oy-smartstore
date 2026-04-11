const { getAccessToken, getAuthHeadersFromToken, resolveCredentials, resolveToken } = require('../../lib/naver-auth');
const { resolveDeliveryProfile } = require('../../lib/naver-delivery');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Naver-Client-Id, X-Naver-Client-Secret, X-Naver-Token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  let body = {};
  if (req.method === 'POST') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch { body = {}; }
  }

  try {
    let token = resolveToken(req, body);
    if (!token) {
      const { clientId, clientSecret } = resolveCredentials(req);
      const result = await getAccessToken(clientId, clientSecret);
      token = result.token;
    }

    const headers = getAuthHeadersFromToken(token);
    const resolved = await resolveDeliveryProfile(headers);
    if (!resolved.success) {
      return res.status(400).json(resolved);
    }

    return res.status(200).json({
      success: true,
      profile: resolved.profile,
      outboundLocations: resolved.outboundLocations,
      addressBooks: resolved.addressBooks,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
};
