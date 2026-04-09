const { getAccessToken, getAuthHeadersFromToken, resolveCredentials, resolveToken, proxyFetch, NAVER_API_BASE } = require('../../lib/naver-auth');
const { getDetailAttribute, DELIVERY_INFO } = require('../../lib/delivery-template');

const PRODUCT_URL = `${NAVER_API_BASE}/v2/products`;

/**
 * 올리브영 프로모션 태그 제거 → 스마트스토어용 상품명
 */
function cleanProductName(rawName) {
  if (!rawName) return rawName;
  let name = rawName;

  name = name.replace(/\[([^\]]*올영[^\]]*)\]/gi, '');
  name = name.replace(/\[([^\]]*증정[^\]]*)\]/gi, '');
  name = name.replace(/\[([^\]]*기획[^\]]*)\]/gi, '');
  name = name.replace(/\[([^\]]*에디션[^\]]*)\]/gi, '');
  name = name.replace(/\[([^\]]*PICK[^\]]*)\]/gi, '');
  name = name.replace(/\[([^\]]*공동개발[^\]]*)\]/gi, '');
  name = name.replace(/\[([^\]]*단독[^\]]*)\]/gi, '');
  name = name.replace(/\[([^\]]*한정[^\]]*)\]/gi, '');
  name = name.replace(/\[([^\]]*연속[^\]]*)\]/gi, '');
  name = name.replace(/\[([^\]]*NEW[^\]]*)\]/gi, '');
  name = name.replace(/\[\d+\+\d+\]/g, '');

  name = name.replace(/\(단품[\/]?기획\)/g, '');
  name = name.replace(/\(본품[+][^\)]*\)/g, '');

  name = name.replace(/\s{2,}/g, ' ').trim();
  name = name.replace(/^[\s\/]+|[\s\/]+$/g, '').trim();

  return name || rawName;
}

function buildOptions(oyOptions) {
  if (!oyOptions || oyOptions.length === 0) return null;

  console.log('[buildOptions] Input:', JSON.stringify(oyOptions.slice(0, 3)));

  const basePrices = oyOptions
    .map((o) => parseInt(o.sellingPrice || o.price || 0, 10))
    .filter((p) => p > 0);
  const minPrice = basePrices.length > 0 ? Math.min(...basePrices) : 0;

  const combinations = oyOptions.map((opt, i) => {
    const optPrice = parseInt(opt.sellingPrice || opt.price || 0, 10);
    const priceDiff = minPrice > 0 && optPrice > 0 ? optPrice - minPrice : 0;
    let name = (opt.name || opt.optionName || `옵션${i + 1}`).trim();
    if (name.length > 25) name = name.substring(0, 25);

    const stockQty = Math.max(0, parseInt(opt.quantity || opt.stockQuantity || 0, 10));
    const unusable = opt.soldOut === true || opt.soldOutFlag === 'Y' || stockQty <= 0;

    return {
      optionName1: name,
      stockQuantity: stockQty,
      price: Math.max(0, Math.round(priceDiff)),
      usable: !unusable,
    };
  });

  console.log('[buildOptions] Built', combinations.length, 'combinations:', JSON.stringify(combinations.slice(0, 2)));

  return {
    optionCombinationSortType: 'CREATE',
    optionCombinationGroupNames: { optionGroupName1: '옵션' },
    optionCombinations: combinations,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Naver-Client-Id, X-Naver-Client-Secret, X-Naver-Token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }

  const { name, sellingPrice, categoryId, detailHtml, uploadedImages = [], options = [], stock = 999, brand = '', oliveyoungCategory = '' } = body;
  if (!name || !sellingPrice || !categoryId || !detailHtml) {
    return res.status(400).json({ error: 'name, sellingPrice, categoryId, detailHtml required' });
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
    const detailAttr = getDetailAttribute(oliveyoungCategory, cleanedName, brand);
    const optionInfo = buildOptions(options);
    const hasOptions = optionInfo && optionInfo.optionCombinations && optionInfo.optionCombinations.length > 0;

    if (hasOptions) {
      detailAttr.optionInfo = optionInfo;
    }

    if (!uploadedImages || uploadedImages.length === 0 || !uploadedImages[0]?.url) {
      return res.status(400).json({
        success: false,
        error: '대표 이미지가 없습니다. 이미지 업로드를 확인하세요.',
      });
    }

    const imageBlock = {
      representativeImage: uploadedImages[0],
    };
    if (uploadedImages.length > 1) {
      imageBlock.optionalImages = uploadedImages.slice(1, 5);
    }

    const payload = {
      originProduct: {
        statusType: 'SALE',
        saleType: 'NEW',
        leafCategoryId: String(categoryId),
        name: name.substring(0, 100),
        salePrice: Math.round(sellingPrice),
        stockQuantity: hasOptions ? 0 : stock,
        detailContent: detailHtml,
        images: imageBlock,
        deliveryInfo: DELIVERY_INFO,
        detailAttribute: detailAttr,
      },
      smartstoreChannelProduct: {
        naverShoppingRegistration: true,
        channelProductDisplayStatusType: 'ON',
      },
    };

    console.log('[register] name:', cleanedName, '| options:', options.length,
      '| hasOptions:', hasOptions, '| stockQuantity:', hasOptions ? 0 : stock,
      hasOptions ? `combinations: ${optionInfo.optionCombinations.length}` : '');

    const registerRes = await proxyFetch(PRODUCT_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
    const text = await registerRes.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (registerRes.ok) return res.status(200).json({ success: true, result: data });

    console.log('[register] FAILED:', registerRes.status, text.substring(0, 500));
    return res.status(registerRes.status).json({ success: false, error: data, status: registerRes.status });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
};
