const { resolveAIConfig, generateContent } = require('../../lib/ai-client');

const REQUIRED_NOTICE_HTML = `
<div style="max-width:100%;margin:40px auto 0;padding:24px;background-color:#f9f9f9;border:1px solid #ddd;border-radius:8px;font-size:16px;color:#666;line-height:2;">
  <h3 style="color:#333;font-size:20px;margin-bottom:12px;border-bottom:2px solid #ddd;padding-bottom:8px;">구매 안내</h3>
  <p>• 본 상품은 <strong>올리브영 공식 온라인몰</strong>에서 구매하여 국내 배송해드리는 상품입니다.</p>
  <p>• 올리브영에서 정식 유통되는 정품만 취급합니다.</p>
  <p>• 주문 확인 후 올리브영에서 구매 → 고객님께 직접 배송되며, 배송기간은 영업일 기준 2~5일 소요됩니다.</p>
  <p>• 이 제품은 구매대행을 통하여 유통되는 제품입니다.</p>
  <h3 style="color:#333;font-size:20px;margin:20px 0 12px;border-bottom:2px solid #ddd;padding-bottom:8px;">배송 안내</h3>
  <p>• 배송사: 한진택배</p>
  <p>• 배송비: 3,000원 (제주/도서산간 추가 5,000원)</p>
  <p>• 출고 후 1~2일 내 수령 가능 (주말/공휴일 제외)</p>
  <h3 style="color:#333;font-size:20px;margin:20px 0 12px;border-bottom:2px solid #ddd;padding-bottom:8px;">교환/반품 안내</h3>
  <p>• 상품 수령 후 7일 이내 교환/반품 가능</p>
  <p>• 단, 개봉 후 사용한 상품은 교환/반품이 불가합니다.</p>
  <p>• 고객 변심에 의한 반품 시 왕복 배송비 6,000원이 발생합니다.</p>
  <p>• 상품 하자/오배송의 경우 배송비는 판매자가 부담합니다.</p>
</div>`;

function buildImageHtml(imageUrls) {
  if (!imageUrls || imageUrls.length === 0) return { top: '', middle: [] };
  const top = `<div style="margin:0 0 20px 0;text-align:center;"><img src="${imageUrls[0]}" alt="" style="max-width:100%;height:auto;display:block;margin:0 auto;" /></div>`;
  const middle = imageUrls.slice(1).map((u) =>
    `<div style="margin:20px 0;text-align:center;"><img src="${u}" alt="" style="max-width:100%;height:auto;display:block;margin:0 auto;" /></div>`
  );
  return { top, middle };
}

function insertImagesBetweenSections(html, middleImages) {
  if (!middleImages.length) return html;
  const parts = html.split('</section>');
  if (parts.length <= 2) return html;
  let result = parts[0];
  let imgIdx = 0;
  for (let i = 1; i < parts.length; i++) {
    result += '</section>';
    if (imgIdx < middleImages.length && i % 2 === 0) result += middleImages[imgIdx++];
    result += parts[i];
  }
  return result;
}

function fallbackTemplate(name, brand, price, imageUrls) {
  const { top } = buildImageHtml(imageUrls);
  const b = brand || '브랜드 미상';
  const p = Number(price) > 0 ? Number(price).toLocaleString() + '원' : '';
  return `${top}
<div style="max-width:100%;margin:0 auto;font-family:'Noto Sans KR',sans-serif;padding:20px;">
  <div style="background:linear-gradient(135deg,#FF6B35,#FF8F60);color:#fff;padding:36px 20px;text-align:center;border-radius:16px;margin-bottom:24px;">
    <h1 style="margin:0;font-size:26px;line-height:1.4;">${name}</h1>
    <p style="margin:10px 0 0;font-size:18px;opacity:0.9;">${b}${p ? ' | ' + p : ''}</p>
  </div>

  <section style="background:#fff;border-radius:12px;padding:24px;margin-bottom:20px;border:1px solid #eee;">
    <h2 style="font-size:22px;color:#004E89;margin:0 0 16px;border-bottom:2px solid #FF6B35;padding-bottom:8px;">상품 소개</h2>
    <p style="font-size:16px;line-height:1.8;color:#333;">${b}의 <strong>${name}</strong>을(를) 소개합니다. 올리브영에서 검증된 정품으로, 피부에 부담 없는 안심 포뮬러로 많은 분들께 사랑받고 있는 제품입니다.</p>
  </section>

  <section style="background:#fff;border-radius:12px;padding:24px;margin-bottom:20px;border:1px solid #eee;">
    <h2 style="font-size:22px;color:#004E89;margin:0 0 16px;border-bottom:2px solid #FF6B35;padding-bottom:8px;">주요 특징</h2>
    <div style="font-size:16px;line-height:2;color:#333;">
      <p>✅ 올리브영 공식 판매 정품</p>
      <p>✅ 뛰어난 사용감과 발림성</p>
      <p>✅ 다양한 피부 타입에 적합</p>
    </div>
  </section>

  <section style="background:#fff;border-radius:12px;padding:24px;margin-bottom:20px;border:1px solid #eee;">
    <h2 style="font-size:22px;color:#004E89;margin:0 0 16px;border-bottom:2px solid #FF6B35;padding-bottom:8px;">사용방법</h2>
    <p style="font-size:16px;line-height:1.8;color:#333;">1. 적당량을 덜어 해당 부위에 골고루 발라주세요.<br>2. 가볍게 두드려 흡수시켜 주세요.<br>3. 필요 시 덧바름하여 원하는 컬러감/효과를 조절하세요.</p>
  </section>

  <section style="background:#fff;border-radius:12px;padding:24px;margin-bottom:20px;border:1px solid #eee;">
    <h2 style="font-size:22px;color:#004E89;margin:0 0 16px;border-bottom:2px solid #FF6B35;padding-bottom:8px;">주의사항</h2>
    <p style="font-size:16px;line-height:1.8;color:#333;">• 사용 중 이상이 있을 경우 사용을 중지하고 전문의와 상담하세요.<br>• 직사광선을 피해 서늘한 곳에 보관하세요.<br>• 어린이 손에 닿지 않는 곳에 보관하세요.</p>
  </section>

  <section style="background:#fff;border-radius:12px;padding:24px;margin-bottom:20px;border:1px solid #eee;">
    <h2 style="font-size:22px;color:#004E89;margin:0 0 16px;border-bottom:2px solid #FF6B35;padding-bottom:8px;">제품 정보</h2>
    <table style="width:100%;border-collapse:collapse;margin:8px 0;">
      <tr style="border-bottom:1px solid #eee;"><td style="padding:12px;font-weight:600;width:120px;background:#f9f9f9;">제품명</td><td style="padding:12px;">${name}</td></tr>
      <tr style="border-bottom:1px solid #eee;"><td style="padding:12px;font-weight:600;background:#f9f9f9;">브랜드</td><td style="padding:12px;">${b}</td></tr>
      <tr style="border-bottom:1px solid #eee;"><td style="padding:12px;font-weight:600;background:#f9f9f9;">사용기간</td><td style="padding:12px;">개봉 후 12개월 이내 권장</td></tr>
      <tr style="border-bottom:1px solid #eee;"><td style="padding:12px;font-weight:600;background:#f9f9f9;">보관방법</td><td style="padding:12px;">직사광선을 피해 서늘하고 건조한 곳에 보관</td></tr>
    </table>
  </section>
</div>
${REQUIRED_NOTICE_HTML}`;
}

/* ============ Blog ============ */
const TONE_PROMPTS = {
  friendly: '친근하고 일상적인 말투로, 마치 친구에게 추천하듯이 자연스러운 리뷰체로 작성하세요. 이모지를 적절히 사용하세요.',
  professional: '전문적이고 분석적인 톤으로, 성분과 효과를 중심으로 신뢰감 있게 작성하세요.',
  trendy: '트렌디한 뷰티 블로거 스타일로, 핫한 표현과 감성적인 문체를 사용하세요. 이모지를 많이 활용하세요.',
  minimal: '미니멀하고 깔끔한 문체로, 핵심만 간결하게 전달하세요.',
};
const LENGTH_MAP = { short: 500, medium: 1000, long: 2000 };

async function handleBlog(body, aiConfig, res) {
  const {
    name, brand = '', price = 0, category = '',
    tone = 'friendly', length = 'medium', keywords = '',
    productNo = '', thumbnail = '',
  } = body;

  if (!name) return res.status(400).json({ error: 'name required' });
  const toneGuide = TONE_PROMPTS[tone] || TONE_PROMPTS.friendly;
  const targetLength = LENGTH_MAP[length] || 1000;
  const storeUrl = productNo ? `https://smartstore.naver.com/main/products/${productNo}` : '';

  const prompt = `당신은 네이버 블로그 뷰티 리뷰어입니다. 다음 상품에 대한 블로그 홍보 글을 작성하세요.

## 상품 정보
- 상품명: ${name}
- 브랜드: ${brand}
- 가격: ${Number(price).toLocaleString()}원
- 카테고리: ${category}
${keywords ? `- 추가 키워드: ${keywords}` : ''}
${storeUrl ? `- 구매 링크: ${storeUrl}` : ''}

## 작성 가이드
- ${toneGuide}
- 약 ${targetLength}자 내외로 작성하세요.
- 네이버 블로그에 최적화된 SEO 친화적 글을 작성하세요.

## 필수 포함 내용
1. 눈길을 끄는 제목
2. 도입부: 상품을 만나게 된 계기
3. 상품 소개: 브랜드와 특징
4. 사용 후기/장점 (3가지 이상)
5. 추천 대상
6. 가격 정보와 구매 안내
${storeUrl ? `7. 구매 링크: ${storeUrl}` : ''}

## 해시태그
관련 해시태그 5-8개를 생성하세요.

## 출력 형식 (JSON만 출력):
{"title":"블로그 제목","text":"블로그 본문 마크다운","html":"블로그 본문 HTML (inline CSS)","tags":["태그1","태그2"]}`;

  try {
    let raw = await generateContent(aiConfig, prompt);
    if (raw.includes('```json')) raw = raw.split('```json')[1].split('```')[0].trim();
    else if (raw.includes('```')) raw = raw.split('```')[1].split('```')[0].trim();

    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      parsed = { title: name + ' 리뷰', text: raw, html: raw.replace(/\n/g, '<br>'), tags: [brand, category, name].filter(Boolean) };
    }
    if (thumbnail && parsed.html) {
      parsed.html = `<div style="text-align:center;margin-bottom:20px;"><img src="${thumbnail}" alt="${name}" style="max-width:100%;border-radius:12px;" /></div>` + parsed.html;
    }
    return res.status(200).json({ success: true, title: parsed.title || '', text: parsed.text || '', html: parsed.html || '', tags: parsed.tags || [] });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

/* ============ Product description ============ */
async function handleDescription(body, aiConfig, res) {
  const { name, brand = '', price = 0, category = '', options = [], reviewCount = 0, avgRating = 0, imageUrls = [] } = body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const optSummary = Array.isArray(options) && options.length > 0
    ? options.slice(0, 10).map(o => o.name || o.optionName || '').filter(Boolean).join(', ')
    : '단일상품';

  const prompt = `당신은 네이버 스마트스토어 상세페이지 전문 디자이너입니다.
상품명: ${name}
브랜드: ${brand}
가격: ${Number(price).toLocaleString()}원
카테고리: ${category}
옵션: ${optSummary}
평점: ${avgRating}
리뷰수: ${reviewCount}개

요구사항:
1. 깔끔한 HTML (inline CSS만, <style> 태그 금지)
2. 반드시 아래 순서대로 섹션을 만들어:
   - 상품 소개 (매력적인 카피)
   - 주요 특징 (3-5개, 아이콘/이모지 사용)
   - 사용방법
   - 주의사항
   - 제품정보 테이블 (아래 형식 필수):
     <table> 형태로 제품명, 용량/수량, 사용기간, 브랜드, 보관방법을 포함
     (정보를 모를 경우 상품명에서 유추하여 작성)
   - 전성분 (화장품인 경우 일반적인 성분 추정 목록 작성, 아니면 생략)
3. 색상: 메인 #FF6B35, 서브 #004E89, 배경 #F7F7F7
4. 모바일 최적화: 텍스트 최소 16px, 제목 22px+, line-height 1.8+
5. 이미지 태그 없이 텍스트만
6. 매력적인 카피
7. 각 섹션 <section> 태그

제품정보 테이블 예시 (inline CSS로):
<section>
<h2>제품 정보</h2>
<table style="width:100%;border-collapse:collapse;margin:16px 0;">
<tr style="border-bottom:1px solid #eee;"><td style="padding:12px;font-weight:600;width:120px;background:#f9f9f9;">제품명</td><td style="padding:12px;">상품명</td></tr>
<tr style="border-bottom:1px solid #eee;"><td style="padding:12px;font-weight:600;background:#f9f9f9;">용량</td><td style="padding:12px;">추정 용량</td></tr>
<tr style="border-bottom:1px solid #eee;"><td style="padding:12px;font-weight:600;background:#f9f9f9;">사용기간</td><td style="padding:12px;">개봉 후 12개월 이내 권장</td></tr>
<tr style="border-bottom:1px solid #eee;"><td style="padding:12px;font-weight:600;background:#f9f9f9;">브랜드</td><td style="padding:12px;">브랜드명</td></tr>
<tr style="border-bottom:1px solid #eee;"><td style="padding:12px;font-weight:600;background:#f9f9f9;">보관방법</td><td style="padding:12px;">직사광선을 피해 서늘한 곳에 보관</td></tr>
</table>
</section>

HTML 코드만 출력 (\`\`\`html 태그 없이):`;

  try {
    let html = await generateContent(aiConfig, prompt);

    if (html.startsWith('```html')) html = html.slice(7);
    if (html.startsWith('```')) html = html.slice(3);
    if (html.endsWith('```')) html = html.slice(0, -3);
    html = html.trim();

    const { top, middle } = buildImageHtml(imageUrls);
    if (top) html = top + html;
    if (middle.length > 0) html = insertImagesBetweenSections(html, middle);
    html += REQUIRED_NOTICE_HTML;

    return res.status(200).json({ success: true, html, length: html.length });
  } catch (e) {
    const html = fallbackTemplate(name, brand, price, imageUrls);
    return res.status(200).json({ success: true, html, length: html.length, fallback: true, error: e.message });
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Google-Api-Key, X-AI-Base-URL, X-AI-Model, X-Naver-Client-Id, X-Naver-Client-Secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { body = {}; }

  const aiConfig = resolveAIConfig(req);
  if (body.geminiModel) aiConfig.model = body.geminiModel.trim();
  if (!aiConfig.apiKey) return res.status(400).json({ error: 'AI API Key가 설정되지 않았습니다. 설정에서 입력하세요.' });

  if (body.type === 'blog') return handleBlog(body, aiConfig, res);
  return handleDescription(body, aiConfig, res);
};
