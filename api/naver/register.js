const { getAccessToken, getAuthHeadersFromToken, resolveCredentials, resolveToken, proxyFetch, NAVER_API_BASE } = require('../../lib/naver-auth');
const { getDetailAttribute } = require('../../lib/delivery-template');
const { resolveDeliveryProfile, buildDeliveryInfo, hasDeliveryProfileError } = require('../../lib/naver-delivery');

const PRODUCT_URL = `${NAVER_API_BASE}/v2/products`;
const OPTION_PRICE_LIMIT = 9650;

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
  name = name.replace(/,?\s*FREE\s*\(One\s*size\)/gi, '');
  name = name.replace(/,?\s*FREE$/gi, '');
  name = name.replace(/,?\s*\(One\s*size\)/gi, '');
  name = name.replace(/\d+COLOR\s*/gi, '');
  name = name.replace(/[#"*?<>\\]/g, ' ');
  name = name.replace(/,\s*$/, '');

  name = name.replace(/\s{2,}/g, ' ').trim();
  name = name.replace(/^[\s\/,]+|[\s\/,]+$/g, '').trim();

  return name || rawName;
}

function sanitizeOptionName(rawName, index) {
  let name = cleanProductName(rawName || `옵션${index + 1}`);
  if (name.length > 25) name = name.substring(0, 25);
  return name || `옵션${index + 1}`;
}

function resolveOptionBasePrice(oyOptions, requestedSellingPrice = 0) {
  const optionPrices = Array.isArray(oyOptions)
    ? oyOptions.map((o) => parseInt(o.sellingPrice || o.price || 0, 10)).filter((p) => p > 0)
    : [];

  if (optionPrices.length === 0) {
    const fallbackPrice = Math.max(0, Math.round(Number(requestedSellingPrice) || 0));
    return {
      feasible: true,
      basePrice: fallbackPrice,
      minPrice: fallbackPrice,
      maxPrice: fallbackPrice,
      spread: 0,
    };
  }

  const minPrice = Math.min(...optionPrices);
  const maxPrice = Math.max(...optionPrices);
  const spread = maxPrice - minPrice;
  const lowerBound = maxPrice - OPTION_PRICE_LIMIT;
  const upperBound = minPrice + OPTION_PRICE_LIMIT;

  if (lowerBound <= upperBound) {
    let target = Math.round(Number(requestedSellingPrice) || 0);
    if (target <= 0) target = minPrice;
    const basePrice = Math.max(lowerBound, Math.min(upperBound, target));
    return {
      feasible: true,
      basePrice,
      minPrice,
      maxPrice,
      spread,
      lowerBound,
      upperBound,
    };
  }

  return {
    feasible: false,
    basePrice: minPrice,
    minPrice,
    maxPrice,
    spread,
    lowerBound,
    upperBound,
  };
}

function buildOptions(oyOptions, baseSalePrice) {
  if (!oyOptions || oyOptions.length === 0) return null;

  console.log('[buildOptions] Input:', JSON.stringify(oyOptions.slice(0, 3)));

  const combinations = oyOptions.map((opt, i) => {
    const optPrice = parseInt(opt.sellingPrice || opt.price || 0, 10);
    const priceDiff = baseSalePrice > 0 && optPrice > 0 ? optPrice - baseSalePrice : 0;
    const name = sanitizeOptionName(opt.name || opt.optionName, i);

    const stockQty = Math.max(0, parseInt(opt.stockQuantity ?? opt.quantity ?? 0, 10));
    const unusable = opt.soldOut === true || opt.soldOutFlag === 'Y' || stockQty <= 0;

    return {
      optionName1: name,
      stockQuantity: stockQty,
      price: Math.max(-OPTION_PRICE_LIMIT, Math.min(OPTION_PRICE_LIMIT, Math.round(priceDiff))),
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

  const { name, sellingPrice, categoryId, detailHtml, uploadedImages = [], options = [], stock = 999, brand = '', oliveyoungCategory = '', sellerTags = [],
    brandId, brandName, manufacturerId, manufacturerName, productAttributes = [], deliveryProfile = null } = body;
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
    const optionPricing = resolveOptionBasePrice(options, sellingPrice);
    if (Array.isArray(options) && options.length > 0 && !optionPricing.feasible) {
      return res.status(400).json({
        success: false,
        error: '옵션 가격 차이가 너무 커 일반상품 옵션으로 등록할 수 없습니다. 그룹상품으로 등록하거나 옵션 가격 차이를 줄여 주세요.',
        invalidInputs: [
          {
            name: 'originProduct.detailAttribute.optionInfo.optionCombinations.price',
            type: 'OptionPriceSpreadExceeded',
            message: `옵션 가격 차이(${optionPricing.spread.toLocaleString()}원)가 일반상품 허용 범위(19,300원)를 초과했습니다.`,
          },
        ],
      });
    }
    const baseSalePrice = optionPricing.basePrice > 0 ? optionPricing.basePrice : Math.round(Number(sellingPrice) || 0);
    const optionInfo = buildOptions(options, baseSalePrice);
    const hasOptions = optionInfo && optionInfo.optionCombinations && optionInfo.optionCombinations.length > 0;
    const resolvedDelivery = await resolveDeliveryProfile(headers);
    let effectiveDeliveryProfile = resolvedDelivery.success
      ? resolvedDelivery.profile
      : deliveryProfile;

    if (!effectiveDeliveryProfile?.shippingAddressId || !effectiveDeliveryProfile?.returnAddressId) {
      return res.status(400).json({
        success: false,
        error: resolvedDelivery.error || '배송 프로필을 확인할 수 없습니다.',
        deliveryProfile: effectiveDeliveryProfile || null,
      });
    }

    let deliveryInfo;
    try {
      deliveryInfo = buildDeliveryInfo(effectiveDeliveryProfile);
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message, deliveryProfile: effectiveDeliveryProfile });
    }

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

    if (sellerTags && sellerTags.length > 0) {
      const recommendTags = sellerTags
        .filter(t => t.code && t.code > 0 && (t.text || '').trim().length > 0)
        .slice(0, 10)
        .map(t => ({ code: t.code, text: t.text.substring(0, 15) }));
      const directTags = sellerTags
        .filter(t => !t.code || t.code === 0)
        .filter(t => (t.text || '').trim().length >= 2)
        .slice(0, Math.max(0, 10 - recommendTags.length))
        .map(t => ({ text: t.text.substring(0, 15) }));
      const allTags = [...recommendTags, ...directTags];
      if (allTags.length > 0) {
        if (!detailAttr.seoInfo) detailAttr.seoInfo = {};
        detailAttr.seoInfo.sellerTags = allTags;
        console.log('[register] tags:', allTags.length, '(추천:', recommendTags.length, '직접:', directTags.length + ')');
      }
    }

    if (brandName || manufacturerName) {
      detailAttr.naverShoppingSearchInfo = {};
      if (brandId) detailAttr.naverShoppingSearchInfo.brandId = Number(brandId);
      else if (brandName) detailAttr.naverShoppingSearchInfo.brandName = brandName;
      if (manufacturerId) detailAttr.naverShoppingSearchInfo.manufacturerId = Number(manufacturerId);
      else if (manufacturerName) detailAttr.naverShoppingSearchInfo.manufacturerName = manufacturerName;
      console.log('[register] brand:', brandName, '(id:', brandId || 'none)', '| manufacturer:', manufacturerName, '(id:', manufacturerId || 'none)');
    }

    if (productAttributes && productAttributes.length > 0) {
      detailAttr.productAttributes = productAttributes;
      console.log('[register] attributes:', productAttributes.length, '건');
    }

    const payload = {
      originProduct: {
        statusType: 'SALE',
        saleType: 'NEW',
        leafCategoryId: String(categoryId),
        name: cleanedName,
        salePrice: hasOptions ? baseSalePrice : Math.round(sellingPrice),
        stockQuantity: hasOptions ? 0 : stock,
        detailContent: detailHtml,
        images: imageBlock,
        deliveryInfo,
        detailAttribute: detailAttr,
      },
      smartstoreChannelProduct: {
        naverShoppingRegistration: true,
        channelProductDisplayStatusType: 'ON',
      },
    };

    console.log('[register] name:', cleanedName, '| options:', options.length,
      '| hasOptions:', hasOptions, '| stockQuantity:', hasOptions ? 0 : stock,
      hasOptions ? `combinations: ${optionInfo.optionCombinations.length}` : '',
      hasOptions ? `| baseSalePrice: ${baseSalePrice}` : '',
      '| deliveryProfile:', JSON.stringify({
        shippingAddressId: effectiveDeliveryProfile.shippingAddressId,
        returnAddressId: effectiveDeliveryProfile.returnAddressId,
        outboundLocationId: effectiveDeliveryProfile.outboundLocationId || null,
        deliveryBundleGroupUsable: !!effectiveDeliveryProfile.deliveryBundleGroupId,
      }));

    let deliveryRetried = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      let registerRes = await proxyFetch(PRODUCT_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
      let text = await registerRes.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      if (registerRes.ok) return res.status(200).json({ success: true, result: data });

      const tagError = (data?.invalidInputs || []).find(i =>
        (i.type || '').includes('sellerTags') || (i.type || '').includes('recommendTags') ||
        (i.name || '').includes('sellerTags') || (i.message || '').includes('태그')
      );
      const deliveryError = hasDeliveryProfileError(data);

      if (deliveryError && !deliveryRetried) {
        const refreshedDelivery = await resolveDeliveryProfile(headers);
        if (refreshedDelivery.success) {
          effectiveDeliveryProfile = refreshedDelivery.profile;
          payload.originProduct.deliveryInfo = buildDeliveryInfo(effectiveDeliveryProfile);
          deliveryRetried = true;
          console.log('[register] 배송 프로필 재조회 후 재시도:', JSON.stringify(effectiveDeliveryProfile));
          continue;
        }
      }

      if (!tagError || !detailAttr.seoInfo?.sellerTags?.length) {
        console.log('[register] FAILED:', registerRes.status, text.substring(0, 500));
        return res.status(registerRes.status).json({
          success: false, error: data, invalidInputs: data?.invalidInputs || null, status: registerRes.status,
        });
      }

      const badMatch = (tagError.message || '').match(/[\(（]([^)）]+)[\)）]/);
      const badWords = badMatch ? badMatch[1].split(',').map(s => s.trim().replace(/^태그명:\s*/, '')) : [];

      if (badWords.length > 0) {
        detailAttr.seoInfo.sellerTags = detailAttr.seoInfo.sellerTags.filter(
          t => !badWords.some(bw => t.text === bw)
        );
        console.log('[register] 태그 제거 후 재시도 (#' + (attempt + 1) + '):', badWords.join(', '), '→ 남은', detailAttr.seoInfo.sellerTags.length + '개');
      } else {
        console.log('[register] 태그 전체 제거 후 재시도 (#' + (attempt + 1) + ')');
        detailAttr.seoInfo.sellerTags = [];
      }

      if (!detailAttr.seoInfo.sellerTags.length) {
        delete detailAttr.seoInfo.sellerTags;
        delete detailAttr.seoInfo;
      }
      payload.originProduct.detailAttribute = detailAttr;
    }

    return res.status(400).json({ success: false, error: '태그 재시도 초과' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
};
