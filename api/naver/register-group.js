/**
 * 그룹상품 등록 API — 옵션별 개별 상품 페이지 자동 생성
 * POST /v2/standard-group-products (비동기)
 */
const { getAccessToken, getAuthHeadersFromToken, resolveCredentials, resolveToken, proxyFetch, NAVER_API_BASE } = require('../../lib/naver-auth');
const { getProductNotice, DELIVERY_INFO, AFTER_SERVICE_INFO, ORIGIN_AREA_INFO, CERTIFICATION_EXCLUDE } = require('../../lib/delivery-template');

const GROUP_PRODUCTS_URL = `${NAVER_API_BASE}/v2/standard-group-products`;
const PURCHASE_OPTIONS_URL = `${NAVER_API_BASE}/v2/products/standard-purchase-options`;

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

async function fetchGuideId(headers, categoryId) {
  const url = `${PURCHASE_OPTIONS_URL}?leafCategoryId=${categoryId}`;
  console.log('[group] Fetching guideId for category:', categoryId);
  const r = await proxyFetch(url, { headers });
  if (!r.ok) {
    const text = await r.text();
    console.warn('[group] guideId fetch failed:', r.status, text.substring(0, 200));
    return null;
  }
  const data = await r.json();
  const guides = data.data || data.standardPurchaseOptionGuides || data.guides || [];

  if (Array.isArray(guides) && guides.length > 0) {
    const first = guides[0];
    const id = first.guideId || first.id;
    console.log('[group] Found guideId:', id, 'from', guides.length, 'guides');
    return id;
  }
  if (data.guideId) return data.guideId;
  console.warn('[group] No guideId found in response:', JSON.stringify(data).substring(0, 300));
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
  } = body;

  if (!name || !sellingPrice || !categoryId || !detailHtml) {
    return res.status(400).json({ error: 'name, sellingPrice, categoryId, detailHtml required' });
  }

  const availableOpts = (options || []).filter((o) => !o.soldOut);
  if (availableOpts.length < 2) {
    return res.status(400).json({ error: '그룹상품은 2개 이상의 옵션이 필요합니다. 일반등록을 사용하세요.' });
  }

  try {
    let token = resolveToken(req);
    if (!token) {
      const { clientId, clientSecret } = resolveCredentials(req);
      const result = await getAccessToken(clientId, clientSecret);
      token = result.token;
    }
    const headers = getAuthHeadersFromToken(token);
    const cleanedName = cleanProductName(name).substring(0, 100);

    const guideId = await fetchGuideId(headers, categoryId);
    if (!guideId) {
      return res.status(400).json({
        success: false,
        error: `카테고리(${categoryId})에서 판매 옵션 가이드를 찾을 수 없습니다. 일반등록으로 전환하세요.`,
        fallbackToNormal: true,
      });
    }

    const imageBlock = {};
    if (uploadedImages.length > 0 && uploadedImages[0]?.url) {
      imageBlock.representativeImage = uploadedImages[0];
      if (uploadedImages.length > 1) {
        imageBlock.optionalImages = uploadedImages.slice(1, 5);
      }
    }

    const productNotice = getProductNotice(oliveyoungCategory, cleanedName, brand);

    const optPrices = availableOpts.map((o) => parseInt(o.sellingPrice || o.price || 0, 10)).filter((p) => p > 0);
    const basePrices = optPrices.length > 0 ? optPrices : [sellingPrice];

    const specificProducts = availableOpts.map((opt) => {
      let optName = (opt.name || opt.optionName || '').trim();
      if (optName.length > 50) optName = optName.substring(0, 50);

      const optPrice = parseInt(opt.sellingPrice || opt.price || 0, 10);
      const finalPrice = optPrice > 0 ? optPrice : Math.round(sellingPrice);
      const optStock = parseInt(opt.quantity || opt.stockQuantity || stock, 10);

      return {
        statusType: 'SALE',
        saleType: 'NEW',
        salePrice: Math.round(finalPrice),
        stockQuantity: Math.max(0, optStock),
        images: imageBlock,
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
      '| options:', availableOpts.length,
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
