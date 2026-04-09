const { resolveAIConfig, generateContent } = require('../../lib/ai-client');
const { OLIVEYOUNG_TO_NAVER, BLOCKED_COSMETIC_IDS, SAFE_COSMETIC, getNaverCategory } = require('../../lib/category-data');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Google-Api-Key, X-AI-Base-URL, X-AI-Model');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const { productName = '', oliveyoungCategory = '', geminiModel } = body;
  if (!productName) return res.status(400).json({ error: 'productName required' });

  if (oliveyoungCategory) {
    const cat = getNaverCategory(oliveyoungCategory);
    if (cat) {
      const finalCat = BLOCKED_COSMETIC_IDS.has(cat.id) ? SAFE_COSMETIC : cat;
      return res.status(200).json({
        success: true, naver_category_id: finalCat.id, naver_category_name: finalCat.name,
        method: BLOCKED_COSMETIC_IDS.has(cat.id) ? 'rule_redirected' : 'rule_based',
      });
    }
  }

  const aiConfig = resolveAIConfig(req);
  if (geminiModel) aiConfig.model = geminiModel.trim();
  if (!aiConfig.apiKey) return res.status(400).json({ error: 'AI API Key가 설정되지 않았습니다.' });

  const categoryList = JSON.stringify(OLIVEYOUNG_TO_NAVER, null, 2);
  const prompt = `당신은 네이버 스마트스토어 카테고리 분류 전문가입니다.
상품명: ${productName}
올리브영 카테고리: ${oliveyoungCategory}
사용 가능한 네이버 카테고리 목록:
${categoryList}
반드시 아래 JSON 형식으로만 응답하세요:
{"naver_category_id": "카테고리ID", "naver_category_name": "카테고리명", "confidence": 0.95}`;

  try {
    let text = await generateContent(aiConfig, prompt);
    if (text.includes('```json')) text = text.split('```json')[1].split('```')[0].trim();
    else if (text.includes('```')) text = text.split('```')[1].split('```')[0].trim();
    const parsed = JSON.parse(text);

    if (BLOCKED_COSMETIC_IDS.has(parsed.naver_category_id)) {
      return res.status(200).json({ success: true, ...SAFE_COSMETIC, method: 'ai_redirected' });
    }
    return res.status(200).json({
      success: true, naver_category_id: parsed.naver_category_id,
      naver_category_name: parsed.naver_category_name, confidence: parsed.confidence, method: 'ai',
    });
  } catch (e) {
    return res.status(200).json({ success: true, ...SAFE_COSMETIC, method: 'fallback', confidence: 0, error: e.message });
  }
};
