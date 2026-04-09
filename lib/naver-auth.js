const bcrypt = require('bcryptjs');
const { ProxyAgent } = require('undici');

const NAVER_API_BASE = 'https://api.commerce.naver.com/external';
const TOKEN_URL = `${NAVER_API_BASE}/v1/oauth2/token`;

/** 커머스 API client_secret은 $2a$ / $2b$ bcrypt salt 형식이어야 함. Vercel·쉘에서 $ 가 잘리면 bcrypt가 "Invalid salt version" 등을 냄 */
function assertNaverClientSecretShape(clientSecret) {
  if (!/^\$2[aby]\$\d{2}\$/.test(clientSecret)) {
    throw new Error(
      'NAVER client_secret 형식이 올바르지 않습니다. 커머스API에서 발급받은 $2a$… 또는 $2b$… 값이어야 합니다. ' +
        'Vercel 환경변수·.env에서는 값 전체를 따옴표로 감싸 $ 문자가 잘리지 않게 하세요.'
    );
  }
  if (clientSecret.length < 29) {
    throw new Error(
      'NAVER client_secret이 너무 짧습니다(앞부분만 들어갔을 수 있음). 발급받은 전체 문자열을 다시 복사해 넣었는지 확인하세요.'
    );
  }
}

function parseJsonBodyObject(req) {
  const raw = req.body;
  if (raw == null) return null;
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

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

  assertNaverClientSecretShape(clientSecret);

  const timestamp = String(Date.now() - 3000);
  const password = `${clientId}_${timestamp}`;
  let hashed;
  try {
    hashed = bcrypt.hashSync(password, clientSecret);
  } catch (e) {
    throw new Error(
      `네이버 토큰 서명(bcrypt) 실패: ${e.message}. client_secret이 잘리지 않았는지, Vercel에는 따옴표로 감싼 전체 값을 넣었는지 확인하세요.`
    );
  }
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

/**
 * Bearer 토큰: 1) X-Naver-Token 헤더 2) JSON body의 token / access_token / accessToken
 * (브라우저 콘솔 테스트 등에서 body만 넣는 경우 대비)
 */
function resolveToken(req, parsedBody) {
  const fromHeader = (req.headers['x-naver-token'] || '').trim();
  if (fromHeader) return fromHeader;

  const obj =
    parsedBody && typeof parsedBody === 'object' ? parsedBody : parseJsonBodyObject(req);
  if (obj && typeof obj === 'object') {
    const t = obj.token ?? obj.access_token ?? obj.accessToken;
    if (t != null && String(t).trim()) return String(t).trim();
  }
  return '';
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
