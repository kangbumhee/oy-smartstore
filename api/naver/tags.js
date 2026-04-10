const { getAccessToken, getAuthHeadersFromToken, resolveCredentials, resolveToken, proxyFetch, resolveGoogleKey, NAVER_API_BASE } = require('../../lib/naver-auth');

const RECOMMEND_TAGS_URL = `${NAVER_API_BASE}/v2/tags/recommend-tags`;
const RESTRICTED_TAGS_URL = `${NAVER_API_BASE}/v2/tags/restricted-tags`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Naver-Client-Id, X-Naver-Client-Secret, X-Naver-Token, X-Google-Api-Key, X-AI-Base-URL, X-AI-Model');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const { productName, categoryName = '', brand = '', keywords = [] } = body;
  if (!productName) return res.status(400).json({ error: 'productName required' });

  try {
    let token = resolveToken(req, body);
    if (!token) {
      const { clientId, clientSecret } = resolveCredentials(req);
      const result = await getAccessToken(clientId, clientSecret);
      token = result.token;
    }
    const headers = getAuthHeadersFromToken(token);

    const searchTerms = buildSearchTerms(productName, categoryName, brand, keywords);
    console.log('[tags] 검색어:', searchTerms.join(', '));

    const allTags = [];
    const seenTexts = new Set();

    for (const term of searchTerms.slice(0, 6)) {
      try {
        const url = `${RECOMMEND_TAGS_URL}?keyword=${encodeURIComponent(term)}`;
        const r = await proxyFetch(url, {
          headers: { ...headers, Accept: 'application/json;charset=UTF-8' },
        });
        if (r.ok) {
          const data = await r.json();
          const tags = Array.isArray(data) ? data : (data.tags || data.result || []);
          for (const t of tags) {
            const text = (t.text || t.tag || t.tagName || '').trim();
            const code = t.code || 0;
            if (text && !seenTexts.has(text)) {
              seenTexts.add(text);
              allTags.push({ code, text, count: t.count || t.searchCount || 0 });
            }
          }
        }
        if (searchTerms.indexOf(term) < searchTerms.length - 1) {
          await new Promise(r => setTimeout(r, 300));
        }
      } catch (e) {
        console.warn('[tags] search error for', term, ':', e.message);
      }
    }

    allTags.sort((a, b) => b.count - a.count);

    const aiTags = await generateAiTags(req, productName, categoryName, brand, allTags);

    const verifiedAiTags = await verifyTagsWithNaver(headers, aiTags, seenTexts);

    const candidateTags = selectFinalTags(allTags, verifiedAiTags, productName, brand);

    const finalTags = await filterRestrictedTags(headers, candidateTags);
    console.log('[tags] 최종:', finalTags.length, '개 (후보', candidateTags.length, '→ 제한필터 후', finalTags.length + ')');

    return res.status(200).json({
      success: true,
      tags: finalTags,
      naverTags: allTags.slice(0, 20),
      aiSuggested: aiTags,
    });
  } catch (e) {
    console.error('[tags] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};

function buildSearchTerms(productName, categoryName, brand, keywords) {
  const terms = new Set();

  const cleanName = productName
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\d+COLOR|\d+ml|\d+g/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (brand) terms.add(brand);
  terms.add(cleanName);

  const words = cleanName.split(/\s+/).filter(w => w.length >= 2);
  if (words.length >= 2) {
    terms.add(words.slice(0, 3).join(' '));
    terms.add(words.slice(0, 2).join(' '));
  }

  const catParts = (categoryName || '').split('>').map(s => s.trim()).filter(Boolean);
  if (catParts.length > 0) {
    terms.add(catParts[catParts.length - 1]);
  }

  for (const kw of keywords) {
    if (kw && kw.trim()) terms.add(kw.trim());
  }

  return [...terms].slice(0, 8);
}

async function generateAiTags(req, productName, categoryName, brand, naverTags) {
  try {
    const googleKey = resolveGoogleKey(req);
    if (!googleKey) return [];

    const model = (req.headers['x-ai-model'] || process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim();
    const baseUrl = (req.headers['x-ai-base-url'] || '').trim();
    const apiUrl = baseUrl
      ? `${baseUrl}/v1beta/models/${model}:generateContent?key=${googleKey}`
      : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${googleKey}`;

    const topNaverTags = naverTags.slice(0, 10).map(t => t.text).join(', ');

    const prompt = `네이버 스마트스토어 상품 태그를 생성해주세요.

상품명: ${productName}
카테고리: ${categoryName}
브랜드: ${brand}
네이버 인기 태그 참고: ${topNaverTags || '없음'}

규칙:
1. 네이버 쇼핑에서 실제로 검색되는 인기 키워드 위주로 생성
2. 상품 유형, 성분, 효과, 용도, 시즌 관련 태그만
3. 절대 금지: 브랜드명(${brand}), 캐릭터명(헬로키티,디즈니,산리오 등), 셀럽/연예인명
4. 각 태그는 2~15자
5. 특수문자 사용 금지 (한글, 영문, 숫자만)
6. 정확히 10개 생성

JSON 배열로만 응답하세요:
["태그1", "태그2", ...]`;

    const r = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 300 },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!r.ok) return [];
    const data = await r.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) return [];
    const tags = JSON.parse(match[0]);
    return tags.filter(t => typeof t === 'string' && t.length >= 2 && t.length <= 15);
  } catch (e) {
    console.warn('[tags] AI generation error:', e.message);
    return [];
  }
}

async function verifyTagsWithNaver(headers, aiTagTexts, alreadySeen) {
  const verified = [];
  for (const tagText of aiTagTexts) {
    if (alreadySeen.has(tagText)) continue;
    try {
      const url = `${RECOMMEND_TAGS_URL}?keyword=${encodeURIComponent(tagText)}`;
      const r = await proxyFetch(url, {
        headers: { ...headers, Accept: 'application/json;charset=UTF-8' },
      });
      if (r.ok) {
        const data = await r.json();
        const tags = Array.isArray(data) ? data : (data.tags || data.result || []);
        const exact = tags.find(t => (t.text || '').trim() === tagText);
        if (exact) {
          verified.push({ code: exact.code || 0, text: exact.text });
          alreadySeen.add(exact.text);
        } else if (tags.length > 0) {
          const first = tags[0];
          if (first.text && !alreadySeen.has(first.text)) {
            verified.push({ code: first.code || 0, text: first.text });
            alreadySeen.add(first.text);
          }
        }
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.warn('[tags] verify error for', tagText, ':', e.message);
    }
    if (verified.length >= 10) break;
  }
  return verified;
}

function selectFinalTags(naverTags, verifiedAiTags, productName, brand) {
  const selected = [];
  const seen = new Set();
  const brandLower = (brand || '').toLowerCase();

  for (const tag of verifiedAiTags) {
    if (tag.text && !seen.has(tag.text) && selected.length < 10) {
      if (brandLower && tag.text.toLowerCase().includes(brandLower)) continue;
      seen.add(tag.text);
      selected.push({ code: tag.code || 0, text: tag.text });
    }
  }

  for (const tag of naverTags) {
    if (!seen.has(tag.text) && selected.length < 10) {
      if (brandLower && tag.text.toLowerCase().includes(brandLower)) continue;
      seen.add(tag.text);
      selected.push({ code: tag.code || 0, text: tag.text });
    }
  }

  if (selected.length < 10) {
    const skipWords = new Set((brand || '').split(/\s+/).map(w => w.toLowerCase()).filter(Boolean));
    const words = productName.split(/\s+/).filter(w => w.length >= 2);
    for (const w of words) {
      const clean = w.replace(/[^가-힣a-zA-Z0-9]/g, '');
      if (clean.length >= 2 && !seen.has(clean) && !skipWords.has(clean.toLowerCase()) && selected.length < 10) {
        seen.add(clean);
        selected.push({ code: 0, text: clean });
      }
    }
  }

  return selected.slice(0, 10);
}

async function filterRestrictedTags(headers, tags) {
  if (!tags || tags.length === 0) return [];
  const restrictedSet = new Set();

  for (const tag of tags) {
    try {
      const url = `${RESTRICTED_TAGS_URL}?keyword=${encodeURIComponent(tag.text)}`;
      const r = await proxyFetch(url, {
        headers: { ...headers, Accept: 'application/json;charset=UTF-8' },
      });
      if (r.ok) {
        const data = await r.json();
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (item.restricted === true) {
            restrictedSet.add(tag.text);
          }
        }
      }
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.warn('[tags] restricted check error for', tag.text, ':', e.message);
    }
  }

  if (restrictedSet.size > 0) {
    console.log('[tags] 제한 태그 제거:', [...restrictedSet].join(', '));
  }
  return tags.filter(t => !restrictedSet.has(t.text));
}
