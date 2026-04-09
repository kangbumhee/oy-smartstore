const { resolveCredentials, proxyFetch } = require('../lib/naver-auth');
const { resolveAIConfig } = require('../lib/ai-client');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Naver-Client-Id, X-Naver-Client-Secret, X-Google-Api-Key, X-AI-Base-URL, X-AI-Model');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { clientId } = resolveCredentials(req);
  const aiConfig = resolveAIConfig(req);

  let serverIp = 'unknown';
  try {
    const ipRes = await proxyFetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
    const ipData = await ipRes.json();
    serverIp = ipData.ip || 'unknown';
  } catch { /* ignore */ }

  return res.status(200).json({
    success: true,
    serverIp,
    settings: {
      defaultMarginRate: parseFloat(process.env.DEFAULT_MARGIN_RATE || '0.15'),
      smartstoreShippingFee: parseInt(process.env.SMARTSTORE_SHIPPING_FEE || '3000', 10),
      oliveyoungShippingFee: parseInt(process.env.OLIVEYOUNG_SHIPPING_FEE || '2500', 10),
      shippingProfitBuffer: parseInt(process.env.SHIPPING_PROFIT_BUFFER || '500', 10),
      geminiModel: (process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim(),
      hasNaverCredentials: !!clientId,
      hasGoogleApiKey: !!aiConfig.apiKey,
      hasProxy: !!(process.env.PROXY_URL || process.env.FIXIE_URL || '').trim(),
    },
  });
};
