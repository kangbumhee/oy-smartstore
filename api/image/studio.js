/**
 * AI Product Image Generator via EccoAPI (나노바나나 3.1)
 * Supports reference thumbnail for better results.
 */

const ECCO_API_URL = 'https://eccoapi.com/api/v1/nanobanana31/generate';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Google-Api-Key, X-AI-Base-URL, X-AI-Model, X-Naver-Client-Id, X-Naver-Client-Secret, X-EccoAPI-Key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { body = {}; }

  const {
    productName,
    brand,
    category,
    options,
    count = 1,
    prompt: customPrompt,
    thumbnailPrompt: rawThumbnailPrompt,
    thumbnail,
  } = body;
  if (!productName) return res.status(400).json({ error: 'productName 필요' });

  const eccoKey = resolveEccoKey(req);
  if (!eccoKey) return res.status(400).json({ error: 'EccoAPI Key가 설정되지 않았습니다. 설정에서 nk_live_ 키를 입력하세요.' });

  const startTime = Date.now();

  try {
    const prompts = [];
    const numMain = Math.min(parseInt(count, 10) || 1, 5);

    const mainPrompt = customPrompt
      ? ensureProductContext(customPrompt, productName, brand, thumbnail)
      : buildPrompt(productName, brand, category, null, thumbnail);

    const thumbPrompt = rawThumbnailPrompt
      ? ensureProductContext(String(rawThumbnailPrompt), productName, brand, thumbnail)
      : null;

    for (let i = 0; i < numMain; i++) {
      if (i === 0 && thumbPrompt) {
        prompts.push(thumbPrompt);
      } else {
        prompts.push(mainPrompt);
      }
    }

    if (options && Array.isArray(options) && options.length > 1) {
      for (const opt of options.slice(0, 2)) {
        if (opt.soldOut || prompts.length >= 5) continue;
        const optName = opt.name || opt.optionName || '';
        if (!optName) continue;
        prompts.push(buildPrompt(productName, brand, category, optName, thumbnail));
      }
    }

    console.log(`[studio] Generating ${prompts.length} images, prompt length: ${prompts[0]?.length || 0}`);

    const results = await Promise.allSettled(
      prompts.map((p) => callEccoAPI(eccoKey, p))
    );

    const images = [];
    const errors = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) images.push(r.value);
      else if (r.status === 'rejected') errors.push(r.reason?.message || 'unknown');
    }

    const elapsed = Date.now() - startTime;
    console.log(`[studio] Done: ${images.length} images, ${errors.length} errors, ${elapsed}ms`);

    if (images.length === 0) {
      return res.status(200).json({
        success: false,
        error: '이미지 생성 실패: ' + (errors[0] || 'unknown'),
        errors,
        elapsed,
      });
    }

    return res.status(200).json({ success: true, images, count: images.length, elapsed });
  } catch (e) {
    console.error('[studio] Error:', e.message);
    return res.status(200).json({ success: false, error: e.message, elapsed: Date.now() - startTime });
  }
};

function resolveEccoKey(req) {
  const headerKey = (req.headers['x-eccoapi-key'] || '').trim();
  const envKey = (process.env.ECCOAPI_KEY || '').trim();
  return headerKey || envKey;
}

function ensureProductContext(prompt, name, brand, thumbnail) {
  let p = prompt;
  if (thumbnail) {
    p += ` Use this product image as visual reference for the product packaging and appearance: ${thumbnail}`;
  }
  return p.substring(0, 2000);
}

function buildPrompt(name, brand, category, optionName, thumbnail) {
  const parts = [`Professional product advertisement photo featuring "${name}"`];
  if (brand) parts.push(`by "${brand}"`);
  if (optionName) parts.push(`(${optionName} variant)`);
  parts.push('.');
  parts.push('A young attractive Korean model is holding or presenting the product.');
  parts.push('Clean studio background, professional lighting, high-end commercial quality.');
  parts.push('Product clearly visible and prominent. Photorealistic.');

  if (category) {
    const cat = (category || '').toLowerCase();
    if (cat.includes('화장품') || cat.includes('스킨') || cat.includes('메이크업') || cat.includes('뷰티')) {
      parts.push('K-beauty cosmetics styling.');
    }
  }
  parts.push('NO text overlays. NO watermarks.');
  if (thumbnail) {
    parts.push(`Use this product image as reference for accurate product appearance: ${thumbnail}`);
  }
  return parts.join(' ').substring(0, 2000);
}

async function callEccoAPI(apiKey, prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const r = await fetch(ECCO_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, imageSize: '1K', aspectRatio: '1:1' }),
      signal: controller.signal,
    });

    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`EccoAPI ${r.status}: ${errText.substring(0, 200)}`);
    }

    const data = await r.json();
    if (data.code === 200 && data.data?.assetUrl) return data.data.assetUrl;
    const inlineParts = data.data?.candidates?.[0]?.content?.parts || [];
    for (const part of inlineParts) {
      if (part.inlineData?.assetUrl) return part.inlineData.assetUrl;
    }
    throw new Error('EccoAPI: 응답에 이미지 URL 없음');
  } finally {
    clearTimeout(timeout);
  }
}
