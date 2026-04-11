/**
 * 브라우저 캔버스(crossOrigin + toDataURL)용 — CORS 미설정 호스트(R2 등) 이미지를
 * 서버에서 받아 data URL로 반환. SSRF 방지를 위해 허용 호스트만 통과.
 */
const MAX_BYTES = 12 * 1024 * 1024;
const FETCH_MS = 25000;

function isAllowedImageUrl(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  const suffixOk = ['.r2.cloudflarestorage.com', '.r2.dev'].some((s) => h.endsWith(s));
  return suffixOk;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid JSON' });
  }

  const url = String(body?.url || '').trim();
  if (!url || !isAllowedImageUrl(url)) {
    return res.status(400).json({ success: false, error: '허용되지 않은 이미지 URL입니다.' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_MS);
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'image/*,*/*' },
    });
    clearTimeout(timer);
    if (!r.ok) {
      return res.status(502).json({ success: false, error: `이미지 서버 응답 ${r.status}` });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      return res.status(413).json({ success: false, error: '이미지가 너무 큽니다' });
    }
    const ct = (r.headers.get('content-type') || 'image/png').split(';')[0].trim();
    const mime = ct.startsWith('image/') ? ct : 'image/png';
    const b64 = buf.toString('base64');
    return res.status(200).json({
      success: true,
      mimeType: mime,
      dataUrl: `data:${mime};base64,${b64}`,
    });
  } catch (e) {
    clearTimeout(timer);
    return res.status(502).json({
      success: false,
      error: e.name === 'AbortError' ? '이미지 다운로드 시간 초과' : (e.message || 'fetch 실패'),
    });
  }
};
