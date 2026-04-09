const { getAuthHeaders, getAuthHeadersFromToken, resolveCredentials, resolveToken, proxyFetch, NAVER_API_BASE } = require('../../lib/naver-auth');
const { OLIVEYOUNG_TO_NAVER, BLOCKED_COSMETIC_IDS, SAFE_COSMETIC } = require('../../lib/category-data');

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
    if (!cat.leaf) continue;
    if ((cat.wholeCategoryName || '').toLowerCase().includes(kw)) {
      results.push({ id: String(cat.id), name: cat.wholeCategoryName, leaf: true });
      if (results.length >= limit) break;
    }
  }
  return results;
}

const KEYWORD_MAP = {
  '로션': ['로션'], '스킨': ['스킨/토너'], '토너': ['스킨/토너'],
  '에센스': ['에센스/세럼/앰플'], '세럼': ['에센스/세럼/앰플'], '앰플': ['에센스/세럼/앰플'],
  '크림': ['크림'], '미스트': ['미스트'], '오일': ['페이스오일'],
  '선크림': ['선케어'], '선스틱': ['선케어'], '클렌징': ['클렌징'],
  '마스크팩': ['마스크/팩'], '팩': ['마스크/팩'],
  '립스틱': ['립스틱'], '립틴트': ['립틴트/라커'],
  '파운데이션': ['파운데이션'], '쿠션': ['쿠션'], '컨실러': ['컨실러'],
  '아이섀도': ['아이섀도'], '마스카라': ['마스카라'], '향수': ['여성향수'],
  '바디로션': ['바디로션/크림'], '바디워시': ['바디워시'],
  '핸드크림': ['핸드크림'], '샴푸': ['샴푸'], '린스': ['린스/컨디셔너'],
  '트리트먼트': ['헤어트리트먼트/팩'], '비타민': ['비타민'], '유산균': ['유산균'],
  '콜라겐': ['콜라겐'], '다이어트': ['다이어트식품'],
};

const HEALTH_KEYWORDS = ['비타민', '유산균', '콜라겐', '오메가', '루테인', '프로틴', '홍삼', '다이어트', '건강식품'];

function generateSearchTerms(category, productName) {
  const terms = [];
  for (const [key, values] of Object.entries(KEYWORD_MAP)) {
    if (category.includes(key)) terms.push(...values);
  }
  for (const [key, values] of Object.entries(KEYWORD_MAP)) {
    if (productName.includes(key)) {
      for (const v of values) { if (!terms.includes(v)) terms.push(v); }
    }
  }
  if (category) terms.push(category);
  return terms;
}

async function getBestMatch(categories, oyCategory, productName) {
  const searchTerms = generateSearchTerms(oyCategory, productName);
  const isHealth = HEALTH_KEYWORDS.some((k) => oyCategory.includes(k) || productName.includes(k));
  for (const term of searchTerms) {
    const results = searchLeafCategories(categories, term);
    if (results.length > 0) {
      let match;
      if (isHealth) {
        const nonBeauty = results.filter((r) => !r.name.includes('화장품') && !r.name.includes('미용'));
        match = nonBeauty.length > 0 ? nonBeauty[0] : results[0];
      } else {
        const beauty = results.filter((r) => r.name.includes('화장품') || r.name.includes('미용'));
        match = beauty.length > 0 ? beauty[0] : results[0];
      }
      if (BLOCKED_COSMETIC_IDS.has(match.id)) return SAFE_COSMETIC;
      return match;
    }
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

    if (mode === 'best-match') {
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
