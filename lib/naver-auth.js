const bcrypt = require('bcryptjs');
const { ProxyAgent } = require('undici');

const NAVER_API_BASE = 'https://api.commerce.naver.com/external';
const TOKEN_URL = `${NAVER_API_BASE}/v1/oauth2/token`;

function getDispatcher() {
  const proxyUrl = (process.env.PROXY_URL || process.env.FIXIE_URL || '').trim();
  if (!proxyUrl) return undefined;
  return new ProxyAgent(proxyUrl);
}

function proxyFetch(url, options = {}) {
  const dispatcher = getDispatcher();
  if (dispatcher) options.dispatcher = dispatcher;
  return fetch(url, options);
}

async function getServerIp() {
  try {
    const r = await proxyFetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
    const d = await r.json();
    return d.ip || 'unknown';
  } catch { return 'unknown'; }
}

async function getAccessToken(clientId, clientSecret) {
  clientId = (clientId || '').trim();
  clientSecret = (clientSecret || '').trim();

  if (!clientId || !clientSecret) {
    throw new Error('Naver client_id / client_secret가 비어있습니다.');
  }

  const timestamp = String(Date.now() - 3000);
  const password = `${clientId}_${timestamp}`;
  const hashed = bcrypt.hashSync(password, clientSecret);
  const clientSecretSign = Buffer.from(hashed).toString('base64');

  const params = new URLSearchParams({
    client_id: clientId,
    timestamp,
    client_secret_sign: clientSecretSign,
    grant_type: 'client_credentials',
    type: 'SELF',
  });

  const res = await proxyFetch(`${TOKEN_URL}?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (!res.ok) {
    const body = await res.text();
    const serverIp = await getServerIp();
    throw new Error(`Token failed (서버IP: ${serverIp}): ${res.status} - ${body}`);
  }

  const data = await res.json();
  return { token: data.access_token, expiresIn: data.expires_in || 10800 };
}

function getAuthHeadersFromToken(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function getAuthHeaders(clientId, clientSecret) {
  const { token } = await getAccessToken(clientId, clientSecret);
  return getAuthHeadersFromToken(token);
}

function resolveCredentials(req) {
  const hClientId = (req.headers['x-naver-client-id'] || '').trim();
  const hClientSecret = (req.headers['x-naver-client-secret'] || '').trim();
  const envClientId = (process.env.NAVER_CLIENT_ID || '').trim();
  const envClientSecret = (process.env.NAVER_CLIENT_SECRET || '').trim();
  return {
    clientId: hClientId || envClientId,
    clientSecret: hClientSecret || envClientSecret,
  };
}

function resolveToken(req) {
  return (req.headers['x-naver-token'] || '').trim();
}

function resolveGoogleKey(req) {
  const hKey = (req.headers['x-google-api-key'] || '').trim();
  const envKey = (process.env.GOOGLE_API_KEY || '').trim();
  return hKey || envKey;
}

module.exports = {
  NAVER_API_BASE,
  getAccessToken,
  getAuthHeaders,
  getAuthHeadersFromToken,
  getServerIp,
  proxyFetch,
  resolveCredentials,
  resolveToken,
  resolveGoogleKey,
};
