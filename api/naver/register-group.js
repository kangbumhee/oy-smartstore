/**
 * 그룹상품 등록 API — 옵션별 개별 상품 페이지 자동 생성
 * POST /v2/standard-group-products (비동기)
 *
 * 공식 가이드: https://github.com/commerce-api-naver/commerce-api/wiki/커머스API-그룹상품-연동-가이드
 */
const { getAccessToken, getAuthHeadersFromToken, resolveCredentials, resolveToken, proxyFetch, NAVER_API_BASE } = require('../../lib/naver-auth');
const { getProductNotice, AFTER_SERVICE_INFO, ORIGIN_AREA_INFO } = require('../../lib/delivery-template');
const { resolveDeliveryProfile, buildDeliveryInfo, hasDeliveryProfileError } = require('../../lib/naver-delivery');
const { buildStandardPurchaseOptionsForLabel, chooseBestGuide, sanitizeValueName } = require('../../lib/group-option-workbook');

const GROUP_PRODUCTS_URL = `${NAVER_API_BASE}/v2/standard-group-products`;
const GUIDE_URL = `${NAVER_API_BASE}/v2/standard-purchase-option-guides`;
const ATTR_META_URL = `${NAVER_API_BASE}/v1/product-attributes/attributes`;

async function fetchAttributeSeqToNameMap(headers, categoryId) {
  const url = `${ATTR_META_URL}?categoryId=${encodeURIComponent(String(categoryId).trim())}`;
  try {
    const r = await proxyFetch(url, {
      headers: { ...headers, Accept: 'application/json;charset=UTF-8' },
    });
    if (!r.ok) return new Map();
    const arr = await r.json();
    if (!Array.isArray(arr)) return new Map();
    const m = new Map();
    for (const row of arr) {
      if (row?.attributeSeq != null) {
        m.set(Number(row.attributeSeq), String(row.attributeName || '').trim());
      }
    }
    return m;
  } catch (e) {
    console.warn('[group-register] attribute meta fetch failed:', e.message);
    return new Map();
  }
}

function normalizeAttrAxisToken(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '');
}

/** 스마트스토어 센터: 판매옵션과 겹치는 상품속성은 옵션으로만 관리 → API 중복이 연관 속성 오류 유발 */
function attributeNameOverlapsSaleAxis(attrName, axisNames) {
  const n = normalizeAttrAxisToken(attrName);
  if (!n) return false;
  for (const raw of axisNames) {
    const a = normalizeAttrAxisToken(raw);
    if (!a) continue;
    if (n === a) return true;
    if (a.length >= 2) {
      if ((a === '용량' || a === '중량') && n.includes('용기')) continue;
      if (n.includes(a)) return true;
    } else if (n.startsWith(a) && n.length > a.length) {
      return true;
    }
  }
  return false;
}

function filterProductAttributesBySaleAxes(rows, seqToName, axisNames) {
  if (!Array.isArray(rows) || rows.length === 0 || !axisNames.length) return rows;
  return rows.filter((row) => {
    const seq = row?.attributeSeq;
    const name = seqToName.get(Number(seq)) || '';
    if (!name) return true;
    return !attributeNameOverlapsSaleAxis(name, axisNames);
  });
}

/** 비동기 ERROR 응답에서 invalidInputs를 모아 프론트에 넘김 */
function collectInvalidInputsFromPollFinal(final) {
  const out = [];
  const push = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const row of arr) {
      if (row && typeof row === 'object') out.push(row);
    }
  };
  const raw = final?.raw;
  if (raw && typeof raw === 'object') {
    push(raw.invalidInputs);
    push(raw.progress?.invalidInputs);
    push(raw.data?.invalidInputs);
  }
  const fr = final?.failReason;
  if (fr && typeof fr === 'object') {
    push(fr.invalidInputs);
    if (Array.isArray(fr)) push(fr);
  }
  const seen = new Set();
  return out.filter((row) => {
    const k = JSON.stringify(row);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

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
  name = name.replace(/,?\s*FREE\s*\(One\s*size\)/gi, '');
  name = name.replace(/,?\s*FREE$/gi, '');
  name = name.replace(/,?\s*\(One\s*size\)/gi, '');
  name = name.replace(/\d+COLOR\s*/gi, '');
  name = name.replace(/증정[^)\]]*[\])]/gi, '');
  name = name.replace(/레디백\s*증정/gi, '');
  name = name.replace(/,\s*증정[^,]*/gi, '');
  name = name.replace(/\bfree\b/gi, '');
  name = name.replace(/[#"*?<>\\]/g, ' ');
  name = name.replace(/,\s*$/, '');
  return name.replace(/\s{2,}/g, ' ').trim().replace(/^[\s\/,]+|[\s\/,]+$/g, '').trim() || rawName;
}

function trimGroupProductName(rawName, maxLength = 40) {
  const cleaned = cleanProductName(rawName || '');
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength).trim();
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

const GROUP_STATUS_URL = `${NAVER_API_BASE}/v2/standard-group-products/status`;

async function pollGroupStatus(headers, requestId, timeoutMs, intervalMs) {
  const start = Date.now();
  const url = `${GROUP_STATUS_URL}?requestId=${encodeURIComponent(requestId)}`;
  console.log('[group-poll] polling:', url);

  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      const r = await proxyFetch(url, {
        headers: { ...headers, Accept: 'application/json;charset=UTF-8' },
      });
      if (!r.ok) {
        const txt = await r.text();
        console.warn('[group-poll] status check failed:', r.status, txt.substring(0, 200));
        continue;
      }
      const data = await r.json();
      console.log('[group-poll] raw:', JSON.stringify(data).substring(0, 400));

      const progress = data.progress || data;
      const state = progress.state || data.state;
      console.log('[group-poll] state:', state);

      if (state === 'COMPLETED' || state === 'ERROR' || state === 'FAILED') {
        return {
          state,
          groupProductNo: data.groupProductNo || progress.groupProductNo || null,
          requestId: data.requestId || requestId,
          productNos: data.productNos || progress.productNos || [],
          failReason: data.failReason || progress.failReason || progress.invalidInputs || null,
          raw: data,
        };
      }
    } catch (e) {
      console.warn('[group-poll] error:', e.message);
    }
  }
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
    sellerTags = [],
    brandId, brandName: reqBrandName, manufacturerId, manufacturerName: reqManufacturerName,
    deliveryProfile = null,
  } = body;

  const hasProductAttributesKey = Object.prototype.hasOwnProperty.call(body, 'productAttributes');
  const productAttributesRaw = body.productAttributes;
  const productAttributes = hasProductAttributesKey
    ? (Array.isArray(productAttributesRaw) ? productAttributesRaw : [])
    : undefined;

  const rawByOpt = body.productAttributesByOption;
  const productAttributesByOption = Array.isArray(rawByOpt)
    ? rawByOpt.map((row) => (Array.isArray(row) ? row : []))
    : null;
  const useAttributesByOption = !!(productAttributesByOption && productAttributesByOption.length > 0);

  const effectiveBrand = String(brand || reqBrandName || '').trim();
  const effectiveManufacturer = String(reqManufacturerName || effectiveBrand || '').trim();

  if (!name || !sellingPrice || !categoryId || !detailHtml) {
    return res.status(400).json({ error: 'name, sellingPrice, categoryId, detailHtml required' });
  }

  const allOpts = options || [];
  if (allOpts.length < 1) {
    return res.status(200).json({
      success: false,
      error: '그룹상품 등록용 옵션이 없습니다.',
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
    const groupProductName = trimGroupProductName(name, 40);
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

    const guide = await fetchOptionGuide(headers, categoryId);
    if (!guide.supported) {
      return res.status(200).json({
        success: false,
        error: `카테고리(${categoryId}) 그룹상품 미지원: ${guide.reason}`,
        fallbackToNormal: true,
      });
    }

    const pickedGuide = chooseBestGuide(
      categoryId,
      guide.allGuides || [],
      allOpts.map((opt) => (opt?.name || opt?.optionName || '').trim()).filter(Boolean)
    );
    const selectedGuide = pickedGuide?.guide || { guideId: guide.guideId, standardPurchaseOptions: guide.standardPurchaseOptions };
    const guideId = selectedGuide.guideId ?? selectedGuide.id ?? guide.guideId;
    const stdOptions = selectedGuide.standardPurchaseOptions || guide.standardPurchaseOptions || [];

    console.log('[group-register] workbook guide pick:',
      JSON.stringify({
        categoryId: String(categoryId),
        pickedGuideId: guideId,
        score: pickedGuide?.score ?? null,
        maxCount: pickedGuide?.workbookInfo?.maxCount ?? null,
        optionNames: stdOptions.map((o) => o.optionName),
      }));

    if (pickedGuide?.workbookInfo?.maxCount && allOpts.length > Number(pickedGuide.workbookInfo.maxCount)) {
      return res.status(200).json({
        success: false,
        fallbackToNormal: true,
        error: `카테고리(${categoryId}) 그룹상품 판매옵션 허용 개수(${pickedGuide.workbookInfo.maxCount}개)를 초과했습니다.`,
      });
    }

    const imageBlock = {};
    if (uploadedImages.length > 0 && uploadedImages[0]?.url) {
      imageBlock.representativeImage = uploadedImages[0];
      if (uploadedImages.length > 1) {
        imageBlock.optionalImages = uploadedImages.slice(1, 5);
      }
    }

    const productNotice = getProductNotice(oliveyoungCategory, cleanedName, effectiveBrand);

    const thumbList = Array.isArray(optionThumbnailUploads) ? optionThumbnailUploads : [];
    const sharedList = Array.isArray(sharedOptionalUploads) ? sharedOptionalUploads : [];

    const saleAxisNames = stdOptions.map((o) => String(o.optionName || '').trim()).filter(Boolean);
    let seqToName = new Map();
    const needsAxisAttrFilter = saleAxisNames.length > 0 && (hasProductAttributesKey || useAttributesByOption);
    if (needsAxisAttrFilter) {
      seqToName = await fetchAttributeSeqToNameMap(headers, categoryId);
      if (seqToName.size > 0) {
        console.log('[group-register] 판매옵션 축:', saleAxisNames.join(', '), '— 축과 겹치는 상품속성은 전송에서 제외');
      }
    }

    const attrsForSkuIndex = (index) => {
      let rows = null;
      if (useAttributesByOption) {
        const row = productAttributesByOption[index] !== undefined
          ? productAttributesByOption[index]
          : (productAttributesByOption[0] || []);
        rows = Array.isArray(row) ? row.map((a) => ({ ...a })) : [];
      } else if (productAttributes !== undefined) {
        rows = productAttributes.map((a) => ({ ...a }));
      } else {
        return null;
      }
      if (rows.length > 0 && seqToName.size > 0 && saleAxisNames.length > 0) {
        const filtered = filterProductAttributesBySaleAxes(rows, seqToName, saleAxisNames);
        if (filtered.length !== rows.length) {
          console.log('[group-register] productAttributes', rows.length - filtered.length, '건 제거 (판매옵션 축과 중복)');
        }
        rows = filtered;
      }
      return rows;
    };

    if (useAttributesByOption) {
      console.log(
        '[group-register] productAttributesByOption:',
        productAttributesByOption.length,
        'entries (per 옵션 행; 향/색 등 옵션별 상이할 때 사용)'
      );
    } else if (hasProductAttributesKey) {
      console.log(
        '[group-register] productAttributes from client:',
        productAttributes.length,
        'row(s) per SKU (explicit empty clears attrs on each option row)'
      );
    }

    const specificProducts = allOpts.map((opt, index) => {
      const paRows = attrsForSkuIndex(index);
      let optName = sanitizeValueName((opt.name || opt.optionName || '').trim());

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
        deliveryInfo: { ...deliveryInfo },
        originAreaInfo: ORIGIN_AREA_INFO,
        standardPurchaseOptions: buildStandardPurchaseOptionsForLabel(optName, stdOptions),
        smartstoreChannelProduct: {
          naverShoppingRegistration: true,
          channelProductDisplayStatusType: 'ON',
        },
        ...(paRows !== null ? { productAttributes: paRows } : {}),
      };
    });

    const seoInfo = {};
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
      seoInfo.sellerTags = [...recommendTags, ...directTags];
      console.log('[group-register] tags:', seoInfo.sellerTags.length, '(추천:', recommendTags.length, '직접:', directTags.length + ')');
    }

    const groupProductBody = {
      leafCategoryId: String(categoryId),
      name: groupProductName,
      guideId,
      ...(effectiveBrand ? { brandName: effectiveBrand } : {}),
      taxType: 'TAX',
      minorPurchasable: true,
      productInfoProvidedNotice: productNotice,
      afterServiceInfo: AFTER_SERVICE_INFO,
      commonDetailContent: detailHtml,
      ...(seoInfo.sellerTags?.length > 0 ? { seoInfo } : {}),
      smartstoreGroupChannel: {
        naverShoppingRegistration: true,
        channelProductDisplayStatusType: 'ON',
      },
      specificProducts,
    };

    if (effectiveBrand || effectiveManufacturer) {
      groupProductBody.naverShoppingSearchInfo = {};
      if (brandId) groupProductBody.naverShoppingSearchInfo.brandId = Number(brandId);
      else if (effectiveBrand) groupProductBody.naverShoppingSearchInfo.brandName = effectiveBrand;
      if (manufacturerId) groupProductBody.naverShoppingSearchInfo.manufacturerId = Number(manufacturerId);
      else if (effectiveManufacturer) groupProductBody.naverShoppingSearchInfo.manufacturerName = effectiveManufacturer;
      console.log('[group-register] brand:', effectiveBrand, '| manufacturer:', effectiveManufacturer);
    }

    if (useAttributesByOption || (hasProductAttributesKey && productAttributes.length > 0)) {
      const n = useAttributesByOption ? 'by-option' : productAttributes.length;
      console.log('[group-register] attributes (per specificProduct):', n, '×', specificProducts.length, '옵션');
    }

    const payload = { groupProduct: groupProductBody };

    console.log('[group-register] leafCategoryId:', String(categoryId),
      '| name:', groupProductName,
      '| fullName:', cleanedName,
      '| options:', allOpts.length,
      '| guideId:', guideId,
      '| stdOptions:', stdOptions.map((o) => `${o.optionName}(${o.optionId})`).join(','),
      '| deliveryProfile:', JSON.stringify({
        shippingAddressId: effectiveDeliveryProfile.shippingAddressId,
        returnAddressId: effectiveDeliveryProfile.returnAddressId,
        outboundLocationId: effectiveDeliveryProfile.outboundLocationId || null,
        deliveryBundleGroupUsable: !!effectiveDeliveryProfile.deliveryBundleGroupId,
      }));

    let r, text, data;
    let deliveryRetried = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      r = await proxyFetch(GROUP_PRODUCTS_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
      text = await r.text();
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      if (r.ok) break;

      const tagError = (data?.invalidInputs || []).find(i =>
        (i.type || '').includes('sellerTags') || (i.type || '').includes('recommendTags') ||
        (i.name || '').includes('sellerTags') || (i.message || '').includes('태그')
      );
      const deliveryError = hasDeliveryProfileError(data);

      if (deliveryError && !deliveryRetried) {
        const refreshedDelivery = await resolveDeliveryProfile(headers);
        if (refreshedDelivery.success) {
          effectiveDeliveryProfile = refreshedDelivery.profile;
          const refreshedInfo = buildDeliveryInfo(effectiveDeliveryProfile);
          payload.groupProduct.specificProducts = payload.groupProduct.specificProducts.map((item) => ({
            ...item,
            deliveryInfo: { ...refreshedInfo },
          }));
          deliveryRetried = true;
          console.log('[group-register] 배송 프로필 재조회 후 재시도:', JSON.stringify(effectiveDeliveryProfile));
          continue;
        }
      }

      if (!tagError || !payload.groupProduct.seoInfo?.sellerTags?.length) break;

      const badMatch = (tagError.message || '').match(/[\(（]([^)）]+)[\)）]/);
      const badWords = badMatch ? badMatch[1].split(',').map(s => s.trim().replace(/^태그명:\s*/, '')) : [];

      if (badWords.length > 0) {
        payload.groupProduct.seoInfo.sellerTags = payload.groupProduct.seoInfo.sellerTags.filter(
          t => !badWords.some(bw => t.text === bw)
        );
        console.log('[group-register] 태그 제거 후 재시도 (#' + (attempt + 1) + '):', badWords.join(', '), '→ 남은', payload.groupProduct.seoInfo.sellerTags.length + '개');
      } else {
        payload.groupProduct.seoInfo.sellerTags = [];
        console.log('[group-register] 태그 전체 제거 후 재시도 (#' + (attempt + 1) + ')');
      }

      if (!payload.groupProduct.seoInfo.sellerTags.length) delete payload.groupProduct.seoInfo;
    }

    if (r.ok) {
      const progress = data.progress || data;
      const state = progress.state || 'QUEUED';
      const reqId = data.requestId || progress.requestId || null;
      console.log('[group-register] Accepted, state:', state, 'requestId:', reqId);

      if ((state === 'QUEUED' || state === 'PROCESSING') && reqId) {
        const final = await pollGroupStatus(headers, reqId, 50000, 3000);
        if (final && final.state === 'COMPLETED') {
          console.log('[group-register] COMPLETED:', JSON.stringify(final).substring(0, 300));
          return res.status(200).json({
            success: true,
            isGroup: true,
            result: final.raw || final,
            groupProductNo: final.groupProductNo,
            requestId: final.requestId,
            productNos: final.productNos,
            state: 'COMPLETED',
            debug: {
              guideId,
              stdOptionIds: stdOptions.map((o) => ({ id: o.optionId, name: o.optionName })),
              optionPrices: specificProducts.map((p, idx) => ({
                idx,
                salePrice: p.salePrice,
                standardPurchaseOptions: p.standardPurchaseOptions,
              })),
            },
          });
        }
        if (final && (final.state === 'ERROR' || final.state === 'FAILED')) {
          const polledInvalid = collectInvalidInputsFromPollFinal(final);
          let reason = final.failReason || final.raw || final;
          if (typeof reason === 'object' && reason !== null && !Array.isArray(reason)) {
            reason = {
              ...reason,
              invalidInputs: polledInvalid.length ? polledInvalid : (reason.invalidInputs || []),
            };
          } else if (polledInvalid.length) {
            reason = { errorMessage: String(reason || ''), invalidInputs: polledInvalid };
          }
          console.warn('[group-register] Async', final.state, ':', JSON.stringify(reason).substring(0, 500));
          return res.status(200).json({
            success: false,
            error: reason,
            invalidInputs: polledInvalid.length ? polledInvalid : undefined,
            fallbackToNormal: true,
            message: `그룹등록 비동기 처리 ${final.state}`,
          });
        }
        console.warn('[group-register] Poll timeout — QUEUED never became COMPLETED, falling back');
        return res.status(200).json({
          success: false,
          fallbackToNormal: true,
          error: '그룹상품 비동기 처리 시간 초과 (QUEUED → COMPLETED 전환 실패). 일반등록으로 전환합니다.',
          requestId: reqId,
          state: 'QUEUED_TIMEOUT',
        });
      }

      if (state === 'COMPLETED') {
        return res.status(200).json({
          success: true,
          isGroup: true,
          result: data,
          groupProductNo: data.groupProductNo || progress.groupProductNo || null,
          requestId: reqId,
          productNos: data.productNos || progress.productNos || [],
          state: 'COMPLETED',
          debug: {
            guideId,
            stdOptionIds: stdOptions.map((o) => ({ id: o.optionId, name: o.optionName })),
            optionPrices: specificProducts.map((p, idx) => ({
              idx,
              salePrice: p.salePrice,
              standardPurchaseOptions: p.standardPurchaseOptions,
            })),
          },
        });
      }

      console.warn('[group-register] Unexpected state:', state, '— falling back');
      return res.status(200).json({
        success: false,
        fallbackToNormal: true,
        error: `그룹상품 예상치 못한 상태: ${state}. 일반등록으로 전환합니다.`,
        requestId: reqId,
        state,
      });
    }

    console.log('[group-register] FAILED:', r.status, text.substring(0, 500));
    if (data?.invalidInputs) console.log('[group-register] invalidInputs:', JSON.stringify(data.invalidInputs));

    if (r.status === 400) {
      return res.status(200).json({
        success: false,
        error: data,
        invalidInputs: data?.invalidInputs || null,
        fallbackToNormal: true,
        message: '그룹등록 실패 → 일반등록으로 전환',
        debug: {
          guideId,
          stdOptionIds: stdOptions.map((o) => ({ id: o.optionId, name: o.optionName })),
          samplePayloadOpt: specificProducts[0]?.standardPurchaseOptions,
        },
      });
    }

    return res.status(r.status).json({ success: false, error: data, invalidInputs: data?.invalidInputs || null, status: r.status });
  } catch (e) {
    console.error('[group-register] Error:', e.message, e.stack);
    return res.status(200).json({
      success: false,
      error: e.message,
      fallbackToNormal: true,
      message: '그룹등록 서버 에러 → 일반등록으로 전환',
    });
  }
};
