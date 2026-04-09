const { getAccessToken, getServerIp, resolveCredentials } = require('../../lib/naver-auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Naver-Client-Id, X-Naver-Client-Secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { clientId, clientSecret } = resolveCredentials(req);
  if (!clientId || !clientSecret) {
    return res.status(400).json({ success: false, error: '네이버 API 키가 설정되지 않았습니다.' });
  }

  const serverIp = await getServerIp();

  try {
    const { token, expiresIn } = await getAccessToken(clientId, clientSecret);
    return res.status(200).json({ success: true, token, expiresIn, serverIp });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message, serverIp });
  }
};
