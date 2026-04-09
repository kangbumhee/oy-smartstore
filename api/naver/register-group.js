/**
 * 그룹상품 등록 API — 옵션별 개별 상품 페이지 자동 생성
 * POST /v2/standard-group-products (비동기)
 */
const { getAccessToken, getAuthHeadersFromToken, resolveCredentials, resolveToken, proxyFetch, NAVER_API_BASE } = require('../../lib/naver-auth');
const { getProductNotice, DELIVERY_INFO, AFTER_SERVICE_INFO } = require('../../lib/delivery-template');

const GROUP_PRODUCTS_URL = `${NAVER_API_BASE}/v2/standard-group-products`;

function cleanProductName(rawName) {
  if (!rawName) return rawName;
  let name = rawName;
  const patterns = [
    /\[[^\]]*올영[^\]]*\]/gi, /\[[^\]]*증정[^\]]*\]/gi,
    /\[[^\]]*기획[^\]]*\]/gi, /\[[^\]]*에디션[^\]]*\]/gi,
    /\[[^\]]*PICK[^\]]*\]/gi, /\[[^\]]*공동개발[^\]]*\]/gi,
    /\[[^\]]*단독[^\]]*\]/gi, /\[[^\]]*한정[^\]]*\]/gi,
    /\[[^\]]*연속[^\]]*\]/gi, /\[[^\]]*NEW[^\]]*\]/gi,
    /\[\d+\+\d+\]/g,
  ];
  for (const p of patterns) name = name.replace(p, '');
  name = name.replace(/\(단품[\/]?기획\)/g, '');
  name = name.replace(/\(본품[+][^\)]*\)/g, '');
  return name.replace(/\s{2,}/g, ' ').trim().replace(/^[\s\/]+|[\s\/]+$/g, '').trim() || rawName;
}

function extractGuidesArray(data) {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.content)) return data.content;
  if (Array.isArray(data.guides)) return data.guides;
  if (Array.isArray(data.standardPurchaseOptionGuides)) return data.standardPurchaseOptionGuides;

  const d = data.data;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    if (Array.isArray(d.content)) return d.content;
    if (Array.isArray(d.guides)) return d.guides;
    if (Array.isArray(d.standardPurchaseOptionGuides)) return d.standardPurchaseOptionGuides;
    if (Array.isArray(d.standardPurchaseOptionGuideList)) return d.standardPurchaseOptionGuideList;
  }
  return [];
}

async function fetchGuideId(headers, categoryId) {
  const enc = encodeURIComponent(categoryId);
  const endpoints = [
    `${NAVER_API_BASE}/v2/product-option-guides?leafCategoryId=${enc}`,
    `${NAVER_API_BASE}/v2/standard-purchase-option-guides?leafCategoryId=${enc}`,
    `${NAVER_API_BASE}/v2/categories/${enc}/product-option-guides`,
    `${NAVER_API_BASE}/v2/categories/${enc}/standard-purchase-option-guides`,
    `${NAVER_API_BASE}/v2/products/standard-purchase-options?leafCategoryId=${enc}`,
  ];

  for (const url of endpoints) {
    console.log('[group] Trying guideId endpoint:', url);
    try {
      const r = await proxyFetch(url, { headers });
      if (!r.ok) {
        const text = await r.text();
        console.warn('[group] endpoint failed:', r.status, url, text.substring(0, 120));
        continue;
      }
      const data = await r.json();
      const guides = extractGuidesArray(data);

      if (Array.isArray(guides) && guides.length > 0) {
        const first = guides[0];
        const id =
          first.guideId ??
          first.id ??
          first.standardPurchaseOptionGuideNo ??
          first.standardPurchaseOptionGuideId;
        if (id != null && id !== '') {
          console.log('[group] Found guideId:', id, 'from:', url);
          return { guideId: id, guides: first };
        }
      }
      if (data.guideId != null && data.guideId !== '') {
        console.log('[group] Found direct guideId:', data.guideId);
        return { guideId: data.guideId, guides: data };
      }
      const dg = data.data?.guideId;
      if (dg != null && dg !== '') {
        console.log('[group] Found data.guideId:', dg);
        return { guideId: dg, guides: data.data };
      }
      console.warn('[group] No guideId in response from:', url, JSON.stringify(data).substring(0, 220));
    } catch (e) {
      console.warn('[group] endpoint error:', url, e.message);
    }
  }

  console.warn('[group] All guide endpoints failed for category:', categoryId);
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Naver-Client-Id, X-Naver-Client-Secret, X-Naver-Token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const {
    name, sellingPrice, categoryId, detailHtml,
    uploadedImages = [], options = [], stock = 999,
    brand = '', oliveyoungCategory = '',
    optionThumbnailUploads = [],
    sharedOptionalUploads = [],
  } = body;

  if (!name || !sellingPrice || !categoryId || !detailHtml) {
    return res.status(400).json({ error: 'name, sellingPrice, categoryId, detailHtml required' });
  }

  const allOpts = options || [];
  if (allOpts.length < 2) {
    return res.status(200).json({
      success: false,
      error: '그룹상품은 2개 이상의 옵션이 필요합니다.',
      fallbackToNormal: true,
    });
  }

  try {
    let token = resolveToken(req, body);
    if (!token) {
      const { clientId, clientSecret } = resolveCredentials(req);
      const result = await getAccessToken(clientId, clientSecret);
      token = result.token;
    }
    const headers = getAuthHeadersFromToken(token);
    const cleanedName = cleanProductName(name).substring(0, 100);

    const guideResult = await fetchGuideId(headers, categoryId);
    if (!guideResult) {
      return res.status(200).json({
        success: false,
        error: `카테고리(${categoryId})에서 판매 옵션 가이드를 찾을 수 없습니다. 이 카테고리는 그룹상품을 지원하지 않을 수 있습니다.`,
        fallbackToNormal: true,
      });
    }
    const guideId = guideResult.guideId;

    const imageBlock = {};
    if (uploadedImages.length > 0 && uploadedImages[0]?.url) {
      imageBlock.representativeImage = uploadedImages[0];
      if (uploadedImages.length > 1) {
        imageBlock.optionalImages = uploadedImages.slice(1, 5);
      }
    }

    const productNotice = getProductNotice(oliveyoungCategory, cleanedName, brand);

    const optPrices = allOpts.map((o) => parseInt(o.sellingPrice || o.price || 0, 10)).filter((p) => p > 0);
    const basePrices = optPrices.length > 0 ? optPrices : [sellingPrice];

    const thumbList = Array.isArray(optionThumbnailUploads) ? optionThumbnailUploads : [];
    const sharedList = Array.isArray(sharedOptionalUploads) ? sharedOptionalUploads : [];

    const specificProducts = allOpts.map((opt, index) => {
      let optName = (opt.name || opt.optionName || '').trim();
      if (optName.length > 50) optName = optName.substring(0, 50);

      const optPrice = parseInt(opt.sellingPrice || opt.price || 0, 10);
      const finalPrice = optPrice > 0 ? optPrice : Math.round(sellingPrice);
      const optStock = Math.max(0, parseInt(opt.stockQuantity ?? opt.quantity ?? 0, 10));
      const isOutOfStock = optStock === 0 || opt.soldOut === true || opt.soldOutFlag === 'Y' || opt.statusType === 'OUTOFSTOCK';

      let imagesPayload;
      if (thumbList.length > 0) {
        const rep = thumbList[index] || thumbList[0] || uploadedImages[0];
        imagesPayload = {};
        if (rep && rep.url) imagesPayload.representativeImage = rep;
        if (sharedList.length > 0) {
          imagesPayload.optionalImages = sharedList.slice(0, 9);
        }
        if (!imagesPayload.representativeImage && uploadedImages[0]) {
          imagesPayload.representativeImage = uploadedImages[0];
        }
        if (!imagesPayload.optionalImages && uploadedImages.length > 1 && thumbList.length > 0) {
          const rest = uploadedImages.filter((u) => !thumbList.some((t) => t.url === u.url));
          if (rest.length > 0) imagesPayload.optionalImages = rest.slice(0, 9);
        }
      } else {
        imagesPayload = { ...imageBlock };
      }

      return {
        statusType: isOutOfStock ? 'OUTOFSTOCK' : 'SALE',
        saleType: 'NEW',
        salePrice: Math.round(finalPrice),
        stockQuantity: Math.max(0, optStock),
        images: imagesPayload,
        deliveryInfo: DELIVERY_INFO,
        standardPurchaseOptions: [{ valueName: optName }],
      };
    });

    const payload = {
      groupProduct: {
        leafCategoryId: String(categoryId),
        name: cleanedName,
        guideId,
        brandName: brand || undefined,
        saleType: 'NEW',
        taxType: 'TAX',
        minorPurchasable: true,
        productInfoProvidedNotice: productNotice,
        afterServiceInfo: AFTER_SERVICE_INFO,
        commonDetailContent: detailHtml,
        smartstoreGroupChannel: {
          naverShoppingRegistration: true,
          channelProductDisplayStatusType: 'ON',
        },
        specificProducts,
      },
    };

    console.log('[group-register] name:', cleanedName,
      '| options:', allOpts.length,
      '| guideId:', guideId,
      '| prices:', basePrices.slice(0, 3).join(','));

    const r = await proxyFetch(GROUP_PRODUCTS_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (r.ok) {
      const progress = data.progress || data;
      return res.status(200).json({
        success: true,
        isGroup: true,
        result: data,
        groupProductNo: progress.groupProductNo || null,
        requestId: progress.requestId || null,
        productNos: progress.productNos || [],
        state: progress.state || 'QUEUED',
      });
    }

    console.log('[group-register] FAILED:', r.status, text.substring(0, 500));

    if (r.status === 400) {
      return res.status(200).json({
        success: false,
        error: data,
        fallbackToNormal: true,
        message: '그룹등록 실패 → 일반등록으로 전환',
      });
    }

    return res.status(r.status).json({ success: false, error: data, status: r.status });
  } catch (e) {
    console.error('[group-register] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
