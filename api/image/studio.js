/**
 * AI Product Image Generator via EccoAPI (나노바나나 3.1)
 * Reference thumbnail: downloaded and sent as imageBase64 (not prompt URL text).
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
    thumbnailList: rawThumbnailList,
    thumbnailCount: rawThumbnailCount,
    thumbnailOptions,
  } = body;
  if (!productName) return res.status(400).json({ error: 'productName 필요' });

  const eccoKey = resolveEccoKey(req);
  if (!eccoKey) return res.status(400).json({ error: 'EccoAPI Key가 설정되지 않았습니다. 설정에서 nk_live_ 키를 입력하세요.' });

  const startTime = Date.now();

  try {
    const imageCache = new Map();
    const loadReferenceImages = async (url) => {
      const normalized = String(url || '').trim();
      if (!normalized || !normalized.startsWith('http')) return null;
      if (imageCache.has(normalized)) return imageCache.get(normalized);

      const imagePromise = fetchImageAsBase64(normalized).then((imgData) => {
        if (imgData) {
          console.log('[studio] 참조이미지 로드 성공:', normalized.substring(0, 120));
          return [imgData];
        }
        return null;
      });
      imageCache.set(normalized, imagePromise);
      return imagePromise;
    };

    const sharedReferenceImages = await loadReferenceImages(thumbnail);
    const thumbnailList = Array.isArray(rawThumbnailList)
      ? rawThumbnailList.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const promptJobs = [];
    const numTotal = Math.min(Math.max(1, parseInt(count, 10) || 1), 8);
    const optNames = Array.isArray(thumbnailOptions) ? thumbnailOptions : [];

    const hasRef = !!(sharedReferenceImages && sharedReferenceImages.length > 0) || thumbnailList.length > 0;

    const mainPrompt = customPrompt
      ? ensureProductContext(customPrompt, productName, brand)
      : buildPrompt(productName, brand, category, null, hasRef);

    const baseThumb = rawThumbnailPrompt
      ? ensureProductContext(String(rawThumbnailPrompt), productName, brand)
      : null;

    const hasThumbCountParam = rawThumbnailCount !== undefined && rawThumbnailCount !== null && String(rawThumbnailCount).trim() !== '';

    if (hasThumbCountParam) {
      const numThumbs = Math.min(
        Math.max(1, parseInt(rawThumbnailCount, 10) || 1),
        numTotal,
        5
      );
      for (let i = 0; i < numThumbs && promptJobs.length < numTotal; i++) {
        let p = baseThumb || mainPrompt;
        if (baseThumb && optNames[i]) {
          const v = String(optNames[i]).substring(0, 120).replace(/"/g, "'");
          p = `${baseThumb} The specific variant shown is "${v}".`;
        }
        const promptReferenceImages = await loadReferenceImages(thumbnailList[i]) || sharedReferenceImages;
        promptJobs.push({
          prompt: p.substring(0, 2000),
          referenceImages: promptReferenceImages,
        });
      }
      while (promptJobs.length < numTotal) {
        promptJobs.push({
          prompt: mainPrompt,
          referenceImages: sharedReferenceImages,
        });
      }
    } else {
      const numMain = Math.min(numTotal, 5);
      const thumbPrompt = baseThumb;
      for (let i = 0; i < numMain; i++) {
        if (i === 0 && thumbPrompt) {
          promptJobs.push({
            prompt: thumbPrompt,
            referenceImages: sharedReferenceImages,
          });
        } else {
          promptJobs.push({
            prompt: mainPrompt,
            referenceImages: sharedReferenceImages,
          });
        }
      }
      if (options && Array.isArray(options) && options.length > 1) {
        for (const opt of options.slice(0, 2)) {
          if (opt.soldOut || promptJobs.length >= 5) continue;
          const optName = opt.name || opt.optionName || '';
          if (!optName) continue;
          promptJobs.push({
            prompt: buildPrompt(productName, brand, category, optName, hasRef),
            referenceImages: sharedReferenceImages,
          });
        }
      }
    }

    console.log(
      `[studio] Generating ${promptJobs.length} images, sharedRef=${sharedReferenceImages ? sharedReferenceImages.length : 0}, variantRefs=${thumbnailList.length}, prompt length: ${promptJobs[0]?.prompt?.length || 0}`
    );

    const results = await Promise.allSettled(
      promptJobs.map((job) => callEccoAPI(eccoKey, job.prompt, job.referenceImages))
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

async function fetchImageAsBase64(imageUrl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const r = await fetch(imageUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const base64 = Buffer.from(buf).toString('base64');
    const contentType = r.headers.get('content-type') || 'image/jpeg';
    const mimeType = contentType.split(';')[0].trim();
    return { data: base64, mimeType };
  } catch (e) {
    console.warn('[studio] 참조이미지 다운로드 실패:', e.message);
    return null;
  }
}

function ensureProductContext(prompt, _name, _brand) {
  return String(prompt || '').substring(0, 2000);
}

function buildPrompt(name, brand, category, optionName, hasReferenceImage) {
  const parts = [`Professional product advertisement photo featuring "${name}"`];
  if (brand) parts.push(`by "${brand}"`);
  if (optionName) parts.push(`(${optionName} variant)`);
  parts.push('.');
  parts.push('A young attractive Korean model is holding or presenting the product.');
  parts.push('Clean studio background, professional lighting, high-end commercial quality.');
  parts.push('Product clearly visible and prominent. Photorealistic.');
  if (hasReferenceImage) {
    parts.push('Match the EXACT product packaging design from the reference image — same colors, logos, patterns, and shape.');
  }

  if (category) {
    const cat = (category || '').toLowerCase();
    if (cat.includes('화장품') || cat.includes('스킨') || cat.includes('메이크업') || cat.includes('뷰티')) {
      parts.push('K-beauty cosmetics styling.');
    }
  }
  parts.push('NO text overlays. NO watermarks.');
  return parts.join(' ').substring(0, 2000);
}

async function callEccoAPI(apiKey, prompt, referenceImages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  const payload = { prompt, imageSize: '1K', aspectRatio: '1:1' };
  if (referenceImages && referenceImages.length > 0) {
    payload.imageBase64 = referenceImages;
  }

  try {
    const r = await fetch(ECCO_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
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
