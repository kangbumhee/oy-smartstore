/**
 * 그룹상품 등록 API — 옵션별 개별 상품 페이지 자동 생성
 * POST /v2/standard-group-products (비동기)
 *
 * 공식 가이드: https://github.com/commerce-api-naver/commerce-api/wiki/커머스API-그룹상품-연동-가이드
 */
const { getAccessToken, getAuthHeadersFromToken, resolveCredentials, resolveToken, proxyFetch, NAVER_API_BASE } = require('../../lib/naver-auth');
const { getProductNotice, DELIVERY_INFO, AFTER_SERVICE_INFO, ORIGIN_AREA_INFO } = require('../../lib/delivery-template');

const GROUP_PRODUCTS_URL = `${NAVER_API_BASE}/v2/standard-group-products`;
const GUIDE_URL = `${NAVER_API_BASE}/v2/standard-purchase-option-guides`;

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

/**
 * GET /v2/standard-purchase-option-guides?categoryId=...
 * 공식 응답:
 * {
 *   "useOptionYn": true,
 *   "optionGuides": [{
 *     "guideId": 21,
 *     "standardPurchaseOptions": [{
 *       "optionId": 51,
 *       "optionName": "용량",
 *       "optionValues": [{ "valueName": "250ml" }, ...]
 *     }, ...]
 *   }, ...]
 * }
 */
async function fetchOptionGuide(headers, categoryId) {
  const url = `${GUIDE_URL}?categoryId=${encodeURIComponent(String(categoryId).trim())}`;
  console.log('[group] fetchOptionGuide:', url);

  try {
    const r = await proxyFetch(url, {
      headers: { ...headers, Accept: 'application/json;charset=UTF-8' },
    });

    if (!r.ok) {
      const text = await r.text();
      console.warn('[group] guide API failed:', r.status, text.substring(0, 200));
      return { supported: false, reason: `API ${r.status}: ${text.substring(0, 100)}` };
    }

    const data = await r.json();

    if (data.useOptionYn === false) {
      return { supported: false, reason: '이 카테고리는 그룹 판매옵션을 지원하지 않습니다 (useOptionYn=false)' };
    }

    const guides = data.optionGuides || data.guides || [];
    if (!Array.isArray(guides) || guides.length === 0) {
      return { supported: false, reason: '판매옵션 가이드가 비어있습니다' };
    }

    const first = guides[0];
    const guideId = first.guideId ?? first.id;
    if (guideId == null) {
      return { supported: false, reason: 'guideId를 찾을 수 없습니다' };
    }

    const stdOptions = first.standardPurchaseOptions || [];
    console.log('[group] Found guideId:', guideId,
      '| options:', stdOptions.map((o) => `${o.optionName}(id=${o.optionId})`).join(', '));

    return {
      supported: true,
      guideId,
      standardPurchaseOptions: stdOptions,
      allGuides: guides,
    };
  } catch (e) {
    console.warn('[group] fetchOptionGuide error:', e.message);
    return { supported: false, reason: e.message };
  }
}

/**
 * 올리브영 옵션명(예: "1호 라이트베이지")을 네이버 판매옵션 구조에 매핑.
 * 가이드에 optionId가 1개면 그 optionId + 옵션명을 valueName으로 사용.
 * 가이드에 optionId가 2개 이상이면 첫 번째 optionId에 옵션명 배정.
 */
function buildStandardPurchaseOptions(optName, stdOptions) {
  if (!stdOptions || stdOptions.length === 0) {
    return [{ valueName: optName }];
  }

  if (stdOptions.length === 1) {
    return [{ optionId: stdOptions[0].optionId, valueName: optName }];
  }

  return [{ optionId: stdOptions[0].optionId, valueName: optName }];
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

    const guide = await fetchOptionGuide(headers, categoryId);
    if (!guide.supported) {
      return res.status(200).json({
        success: false,
        error: `카테고리(${categoryId}) 그룹상품 미지원: ${guide.reason}`,
        fallbackToNormal: true,
      });
    }

    const { guideId, standardPurchaseOptions: stdOptions } = guide;

    const imageBlock = {};
    if (uploadedImages.length > 0 && uploadedImages[0]?.url) {
      imageBlock.representativeImage = uploadedImages[0];
      if (uploadedImages.length > 1) {
        imageBlock.optionalImages = uploadedImages.slice(1, 5);
      }
    }

    const productNotice = getProductNotice(oliveyoungCategory, cleanedName, brand);

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
        salePrice: Math.round(finalPrice),
        stockQuantity: Math.max(0, optStock),
        images: imagesPayload,
        deliveryInfo: DELIVERY_INFO,
        originAreaInfo: ORIGIN_AREA_INFO,
        standardPurchaseOptions: buildStandardPurchaseOptions(optName, stdOptions),
        smartstoreChannelProduct: {
          naverShoppingRegistration: true,
          channelProductDisplayStatusType: 'ON',
        },
      };
    });

    const payload = {
      groupProduct: {
        leafCategoryId: String(categoryId),
        name: cleanedName,
        guideId,
        brandName: brand || undefined,
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
      '| stdOptions:', stdOptions.map((o) => `${o.optionName}(${o.optionId})`).join(','));

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
