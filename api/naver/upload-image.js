const { getAccessToken, resolveCredentials, resolveToken, proxyFetch, NAVER_API_BASE } = require('../../lib/naver-auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Naver-Client-Id, X-Naver-Client-Secret, X-Naver-Token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { body = {}; }
  const { imageUrls = [] } = body;
  if (!imageUrls.length) return res.status(400).json({ error: 'imageUrls required' });

  try {
    let token = resolveToken(req);
    if (!token) {
      const { clientId, clientSecret } = resolveCredentials(req);
      const result = await getAccessToken(clientId, clientSecret);
      token = result.token;
    }

    const uploaded = [];
    const errors = [];

    for (const url of imageUrls.slice(0, 5)) {
      try {
        let imgBuffer;
        let contentType = 'image/png';
        let ext = 'png';

        if (url.startsWith('data:image/')) {
          const match = url.match(/^data:image\/(\w+);base64,(.+)$/);
          if (!match) { errors.push({ url: url.substring(0, 50), error: 'Invalid base64 format' }); continue; }
          ext = match[1] === 'jpeg' ? 'jpg' : match[1];
          contentType = `image/${match[1]}`;
          imgBuffer = Buffer.from(match[2], 'base64');
        } else {
          console.log(`[upload-image] Downloading: ${url.substring(0, 80)}...`);
          const imgRes = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              Accept: 'image/*,*/*',
            },
            signal: AbortSignal.timeout(30000),
            redirect: 'follow',
          });

          if (!imgRes.ok) {
            console.log(`[upload-image] Download FAILED: ${imgRes.status} ${imgRes.statusText}`);
            errors.push({ url: url.substring(0, 80), error: `Download failed: ${imgRes.status}` });
            continue;
          }

          const ct = imgRes.headers.get('content-type') || '';
          if (ct.includes('png')) { contentType = 'image/png'; ext = 'png'; }
          else if (ct.includes('jpeg') || ct.includes('jpg')) { contentType = 'image/jpeg'; ext = 'jpg'; }
          else if (ct.includes('webp')) { contentType = 'image/webp'; ext = 'webp'; }
          else { contentType = 'image/png'; ext = 'png'; }

          imgBuffer = Buffer.from(await imgRes.arrayBuffer());
          console.log(`[upload-image] Downloaded: ${imgBuffer.byteLength} bytes, type: ${contentType}`);
        }

        if (imgBuffer.byteLength < 500) {
          errors.push({ url: url.substring(0, 80), error: `Too small: ${imgBuffer.byteLength} bytes` });
          continue;
        }

        const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).substring(2)}`;
        const headerBuf = Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="imageFiles"; filename="product.${ext}"\r\nContent-Type: ${contentType}\r\n\r\n`
        );
        const footerBuf = Buffer.from(`\r\n--${boundary}--\r\n`);
        const fullBody = Buffer.concat([headerBuf, imgBuffer, footerBuf]);

        console.log(`[upload-image] Uploading to Naver: ${fullBody.byteLength} bytes...`);
        const uploadRes = await proxyFetch(`${NAVER_API_BASE}/v1/product-images/upload`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          body: fullBody,
        });

        const uploadText = await uploadRes.text();
        if (uploadRes.ok) {
          let data;
          try { data = JSON.parse(uploadText); } catch { data = {}; }
          if (data.images?.length > 0) {
            uploaded.push({ url: data.images[0].url });
            console.log(`[upload-image] SUCCESS: ${data.images[0].url.substring(0, 60)}`);
          } else {
            errors.push({ url: url.substring(0, 80), error: 'Naver returned no images', response: uploadText.substring(0, 200) });
          }
        } else {
          console.log(`[upload-image] Naver upload FAILED: ${uploadRes.status} ${uploadText.substring(0, 200)}`);
          errors.push({ url: url.substring(0, 80), error: `Naver upload ${uploadRes.status}`, response: uploadText.substring(0, 200) });
        }
      } catch (e) {
        console.log(`[upload-image] ERROR: ${e.message}`);
        errors.push({ url: (url || '').substring(0, 80), error: e.message });
      }
    }

    console.log(`[upload-image] Result: ${uploaded.length} uploaded, ${errors.length} errors`);
    return res.status(200).json({ success: uploaded.length > 0, uploaded, errors, total: imageUrls.length });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
};
