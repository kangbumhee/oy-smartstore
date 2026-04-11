const { getAuthHeaders, getAuthHeadersFromToken, resolveCredentials, resolveToken, proxyFetch, NAVER_API_BASE } = require('../../lib/naver-auth');
const { OLIVEYOUNG_TO_NAVER, BLOCKED_COSMETIC_IDS, SAFE_COSMETIC, getNaverCategory } = require('../../lib/category-data');

let cachedCategories = null;
let cacheTime = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000;

async function resolveHeaders(req) {
  const token = resolveToken(req);
  if (token) return getAuthHeadersFromToken(token);
  const { clientId, clientSecret } = resolveCredentials(req);
  return getAuthHeaders(clientId, clientSecret);
}

async function fetchAllCategories(headers) {
  if (cachedCategories && Date.now() - cacheTime < CACHE_TTL) return cachedCategories;
  const h = { ...headers };
  delete h['Content-Type'];
  h['Accept'] = 'application/json;charset=UTF-8';
  const r = await proxyFetch(`${NAVER_API_BASE}/v1/categories`, { headers: h });
  if (!r.ok) throw new Error(`Category fetch failed: ${r.status}`);
  cachedCategories = await r.json();
  cacheTime = Date.now();
  return cachedCategories;
}

function searchLeafCategories(categories, keyword, limit = 10) {
  const results = [];
  const kw = keyword.toLowerCase();
  for (const cat of categories) {
    if (!cat.last) continue;
    if ((cat.wholeCategoryName || '').toLowerCase().includes(kw)) {
      results.push({ id: String(cat.id), name: cat.wholeCategoryName, leaf: true });
      if (results.length >= limit) break;
    }
  }
  return results;
}

const KEYWORD_MAP = {
  '스킨/토너': ['스킨/토너'], '스킨케어세트': ['스킨케어세트'],
  '로션': ['로션'], '토너': ['스킨/토너'],
  '에센스': ['에센스/세럼/앰플'], '세럼': ['에센스/세럼/앰플'], '앰플': ['에센스/세럼/앰플'],
  '에센스/세럼': ['에센스/세럼/앰플'],
  '크림': ['크림'], '미스트': ['미스트'], '오일': ['페이스오일'], '미스트/오일': ['미스트'],
  '선케어': ['선크림', '선케어'], '선크림': ['선크림'], '선스틱': ['선스틱'], '선블록': ['선케어'], 'SPF': ['선크림'],
  '클렌징': ['클렌징'], '폼클렌저': ['클렌징폼'], '클렌징폼/젤': ['클렌징'],
  '마스크팩': ['마스크/팩'], '팩': ['마스크/팩'], '시트팩': ['마스크/팩'], '마스크팩': ['마스크/팩'],
  '립메이크업': ['립틴트', '립스틱', '립메이크업'],
  '립스틱': ['립스틱'], '립틴트': ['립틴트'], '틴트': ['립틴트'], '립글로스': ['립글로스'],
  '립밤': ['립케어'], '립라이너': ['립라이너'],
  '베이스메이크업': ['파운데이션', '쿠션', '베이스메이크업'],
  '파운데이션': ['파운데이션'], '쿠션': ['쿠션'], '컨실러': ['컨실러'],
  '프라이머': ['메이크업베이스'], '베이스': ['메이크업베이스'],
  '아이메이크업': ['아이섀도', '아이메이크업'],
  '아이섀도': ['아이섀도'], '마스카라': ['마스카라'], '아이라이너': ['아이라이너'],
  '아이브로': ['아이브로우'], '블러셔': ['블러셔'], '블러쉬': ['블러셔'],
  '하이라이터': ['하이라이터'], '쉐딩': ['쉐딩'],
  '향수': ['향수'], '퍼퓸': ['향수'], '디퓨저': ['디퓨저'], '향수/디퓨저': ['향수'],
  '바디케어': ['바디로션/크림', '바디케어'], '바디로션': ['바디로션/크림'], '바디워시': ['바디워시'],
  '바디스크럽': ['바디스크럽'], '핸드케어': ['핸드크림'],
  '핸드크림': ['핸드크림'], '샴푸': ['샴푸'], '린스': ['린스/컨디셔너'], '샴푸/린스': ['샴푸'],
  '트리트먼트': ['헤어트리트먼트/팩'], '헤어에센스': ['헤어에센스/오일'],
  '헤어케어': ['샴푸', '헤어케어'], '두피케어': ['두피케어'], '스타일링': ['스타일링'],
  '비타민': ['비타민'], '유산균': ['유산균'], '영양제': ['비타민'],
  '콜라겐': ['콜라겐'], '다이어트': ['다이어트식품'], '건강식품': ['건강식품'],
  '네일': ['네일'], '매니큐어': ['네일'], '젤네일': ['네일'],
  '치약': ['치약'], '칫솔': ['칫솔'], '마우스워시': ['구강청결제'], '구강용품': ['치약'],
  '데오드란트': ['데오드란트'],
  '메이크업툴': ['메이크업소품'], '더모코스메틱': ['스킨케어'],
};

const HEALTH_KEYWORDS = ['비타민', '유산균', '콜라겐', '오메가', '루테인', '프로틴', '홍삼', '다이어트', '건강식품'];

function generateSearchTerms(category, productName) {
  const terms = [];
  const parts = category.split(/\s+/).filter(Boolean);
  const subCategory = parts.length > 1 ? parts.slice(1).join(' ') : '';
  const mainCategory = parts[0] || '';
  const sorted = Object.entries(KEYWORD_MAP).sort((a, b) => b[0].length - a[0].length);

  if (subCategory) {
    for (const [key, values] of sorted) {
      if (subCategory.includes(key)) {
        for (const v of values) { if (!terms.includes(v)) terms.push(v); }
      }
    }
    if (!terms.length) terms.push(subCategory);
  }

  const nameTokens = productName.split(/[\s,]+/).filter(Boolean);
  for (const [key, values] of sorted) {
    const hit = nameTokens.some(t => t === key || (key.length >= 3 && t.startsWith(key)));
    if (hit) {
      for (const v of values) { if (!terms.includes(v)) terms.push(v); }
    }
  }

  if (mainCategory && mainCategory !== subCategory) {
    for (const [key, values] of sorted) {
      if (mainCategory.includes(key) && key.length >= 2) {
        for (const v of values) { if (!terms.includes(v)) terms.push(v); }
      }
    }
  }

  for (const p of parts) {
    if (!terms.includes(p)) terms.push(p);
  }
  return terms;
}

const BEAUTY_PATH_KEYWORDS = ['화장품', '미용', '스킨케어', '메이크업', '향수', '바디케어', '헤어케어', '선케어', '클렌징', '네일'];
const NON_BEAUTY_PATHS = ['의류', '패션', '잡화', '가전', '식품', '생활', '스포츠', '자동차', '도서'];

function isCosmeticContext(oyCategory, productName) {
  const ctx = `${oyCategory} ${productName}`;
  if (HEALTH_KEYWORDS.some(k => ctx.includes(k))) return false;
  return true;
}

async function getBestMatch(categories, oyCategory, productName) {
  const searchTerms = generateSearchTerms(oyCategory, productName);
  const isHealth = HEALTH_KEYWORDS.some((k) => oyCategory.includes(k) || productName.includes(k));
  const isCosmeticCtx = isCosmeticContext(oyCategory, productName);

  let bestCandidate = null;

  for (const term of searchTerms) {
    const results = searchLeafCategories(categories, term);
    if (results.length === 0) continue;

    if (isHealth) {
      const nonBeauty = results.filter((r) => !BEAUTY_PATH_KEYWORDS.some(k => r.name.includes(k)));
      const match = nonBeauty.length > 0 ? nonBeauty[0] : results[0];
      if (BLOCKED_COSMETIC_IDS.has(match.id)) return SAFE_COSMETIC;
      return match;
    }

    const beautyResults = results.filter((r) =>
      BEAUTY_PATH_KEYWORDS.some(k => r.name.includes(k)) &&
      !NON_BEAUTY_PATHS.some(k => r.name.includes(k))
    );

    if (beautyResults.length > 0) {
      const match = beautyResults[0];
      if (BLOCKED_COSMETIC_IDS.has(match.id)) return SAFE_COSMETIC;
      return match;
    }

    if (!bestCandidate && isCosmeticCtx) {
      const nonFashion = results.filter((r) => !NON_BEAUTY_PATHS.some(k => r.name.includes(k)));
      if (nonFashion.length > 0) bestCandidate = nonFashion[0];
    }

    if (!bestCandidate) bestCandidate = results[0];
  }

  if (bestCandidate) {
    if (isCosmeticCtx && NON_BEAUTY_PATHS.some(k => bestCandidate.name.includes(k))) {
      return SAFE_COSMETIC;
    }
    if (BLOCKED_COSMETIC_IDS.has(bestCandidate.id)) return SAFE_COSMETIC;
    return bestCandidate;
  }

  if (isHealth) {
    const fallback = searchLeafCategories(categories, '건강식품');
    if (fallback.length > 0) return fallback[0];
    return { id: '50018980', name: '식품 > 건강식품 > 건강분말 > 기타건강분말' };
  }
  return SAFE_COSMETIC;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Naver-Client-Id, X-Naver-Client-Secret, X-Naver-Token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { keyword, oyCategory = '', productName = '', mode = 'search' } = req.query || {};

  try {
    const headers = await resolveHeaders(req);
    const categories = await fetchAllCategories(headers);

    if (mode === 'debug') {
      const totalLeaf = categories.filter(c => c.last).length;
      const totalAll = categories.length;
      const searchTerms = generateSearchTerms(oyCategory, productName);
      const termResults = {};
      for (const term of searchTerms.slice(0, 8)) {
        const results = searchLeafCategories(categories, term, 5);
        termResults[term] = results.map(r => `${r.name} (${r.id})`);
      }
      const match = await getBestMatch(categories, oyCategory, productName);
      return res.status(200).json({
        success: true, totalCategories: totalAll, leafCategories: totalLeaf,
        searchTerms, termResults, bestMatch: match,
      });
    }

    if (mode === 'best-match') {
      const mapped = getNaverCategory(String(oyCategory || '').trim());
      if (mapped) {
        return res.status(200).json({ success: true, ...mapped, method: 'rule_based' });
      }
      const match = await getBestMatch(categories, oyCategory, productName);
      return res.status(200).json({ success: true, ...match, method: 'api_search' });
    }

    if (oyCategory && OLIVEYOUNG_TO_NAVER[oyCategory]) {
      const cat = OLIVEYOUNG_TO_NAVER[oyCategory];
      if (BLOCKED_COSMETIC_IDS.has(cat.id)) return res.status(200).json({ success: true, ...SAFE_COSMETIC, method: 'rule_redirected' });
      return res.status(200).json({ success: true, ...cat, method: 'rule_based' });
    }

    if (!keyword) return res.status(400).json({ error: 'keyword or oyCategory required' });
    const results = searchLeafCategories(categories, keyword, 20);
    return res.status(200).json({ success: true, results });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
};
