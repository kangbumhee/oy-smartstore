const { oyFetchWithRetry } = require('../../lib/oy-fetch');

const OY_URLS = [
  (no) => `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${no}`,
  (no) => `https://m.oliveyoung.co.kr/m/goods/GoodsDetail.do?goodsNo=${no}`,
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { goodsNo } = req.query || {};
  if (!goodsNo) return res.status(400).json({ success: false, message: 'goodsNo required' });

  const errors = [];

  for (const urlFn of OY_URLS) {
    const oyUrl = urlFn(encodeURIComponent(goodsNo));
    try {
      const r = await oyFetchWithRetry(oyUrl, {}, 1);
      if (!r || !r.ok) {
        errors.push(`${oyUrl.substring(0, 40)}... → ${r?.status || 'no response'}`);
        continue;
      }

      const html = await r.text();

      const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!nextDataMatch) {
        const product = extractFromLegacyHtml(html, goodsNo);
        if (product) return res.status(200).json({ success: true, product, source: 'legacy_html' });
        errors.push('No __NEXT_DATA__ and no legacy data');
        continue;
      }

      const nextData = JSON.parse(nextDataMatch[1]);
      const pageProps = nextData?.props?.pageProps;
      if (!pageProps) { errors.push('No pageProps'); continue; }

      const gd = pageProps.goodsDetail ||
                 pageProps.dehydratedState?.queries?.[0]?.state?.data || {};

      const product = {
        goodsNo,
        name: gd.goodsNm || gd.goodsName || '',
        brand: gd.brandNm || gd.brandName || '',
        price: parseInt(gd.priceToPay || gd.salePrice || gd.price || '0', 10),
        originalPrice: parseInt(gd.originPrice || gd.normalPrice || '0', 10),
        discount: gd.discountRate || gd.dcRate || '',
        category: gd.categoryName || gd.largeCateNm || '',
        subCategory: gd.middleCateNm || gd.smallCateNm || '',
        thumbnail: gd.goodsImage || gd.imageUrl || gd.goodsThumbnailImage || '',
        reviewCount: parseInt(gd.totalReviewCount || gd.reviewCount || '0', 10),
        avgRating: parseFloat(gd.avgRating || gd.averageRating || '0'),
        soldOut: gd.soldOutYn === 'Y' || gd.soldOut === true,
      };

      const optionList = gd.optionList || gd.itemList || gd.items || [];
      if (Array.isArray(optionList) && optionList.length > 0) {
        product.options = optionList.map((item) => ({
          name: item.optNm || item.itemNm || item.optionName || item.name || '',
          price: parseInt(item.priceToPay || item.salePrice || item.price || '0', 10),
          soldOut: item.soldOutYn === 'Y' || item.soldOut === true || item.stockQty === 0,
          itemNo: item.itemNo || '',
          image: item.imageUrl || item.imgUrl || '',
        }));
      }

      // Fallback: parse <select> options if nextData had no options
      if (!product.options || product.options.length === 0) {
        const selectOptions = parseSelectOptions(html);
        if (selectOptions && selectOptions.length > 0) {
          product.options = selectOptions;
        }
      }

      return res.status(200).json({ success: true, product, source: 'nextData' });
    } catch (e) {
      errors.push(`${oyUrl.substring(0, 30)}... → ${e.message}`);
    }
  }

  return res.status(200).json({
    success: false,
    message: 'OliveYoung 서버 접근 실패 (모든 URL 시도 완료)',
    goodsNo,
    errors,
    hint: 'client_enrich',
  });
};

function parseSelectOptions(html) {
  const selectRegex = /<select[^>]*(?:id|name)=["']?goodsOptionValue["']?[^>]*>([\s\S]*?)<\/select>/i;
  const selectMatch = html.match(selectRegex);
  if (!selectMatch) return null;

  const optionRegex = /<option[^>]*value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi;
  const options = [];
  let m;
  while ((m = optionRegex.exec(selectMatch[1])) !== null) {
    const value = m[1].trim();
    const raw = m[2].replace(/<[^>]+>/g, '').trim();
    if (!value || raw.includes('선택해') || raw.includes('선택하세요')) continue;

    const soldOut = /sold_?out|disabled|data-stock=["']?N/i.test(m[0]) || raw.includes('품절');
    let name = raw, price = 0;

    const p1 = raw.match(/^(.+?)\s+\d+%\s*[\d,]+원\s+([\d,]+)원/);
    if (p1) { name = p1[1].trim(); price = parseInt(p1[2].replace(/,/g, ''), 10); }
    else {
      const p2 = raw.match(/^(.+?)\s+([\d,]+)원\s*$/);
      if (p2) { name = p2[1].trim(); price = parseInt(p2[2].replace(/,/g, ''), 10); }
    }
    if (name) options.push({ name, price, soldOut, itemNo: value });
  }
  return options.length > 0 ? options : null;
}

function extractFromLegacyHtml(html, goodsNo) {
  const nameMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
  const imageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/);
  if (!nameMatch) return null;

  const product = {
    goodsNo,
    name: nameMatch[1] || '',
    brand: '',
    price: 0,
    thumbnail: imageMatch ? imageMatch[1] : '',
  };

  const priceMatch = html.match(/priceToPay['":\s]+(\d+)/);
  if (priceMatch) product.price = parseInt(priceMatch[1], 10);

  // Try <select> options first (most reliable for legacy pages)
  const selectOptions = parseSelectOptions(html);
  if (selectOptions && selectOptions.length > 0) {
    product.options = selectOptions;
    return product;
  }

  // Fallback: JS variable parsing
  const optionMatches = html.match(/optionList['":\s]*\[([\s\S]*?)\]/);
  if (optionMatches) {
    try {
      const optArr = JSON.parse(`[${optionMatches[1]}]`);
      if (optArr.length > 0) {
        product.options = optArr.map((o) => ({
          name: o.optNm || o.itemNm || o.name || '',
          price: parseInt(o.priceToPay || o.salePrice || o.price || '0', 10),
          soldOut: o.soldOutYn === 'Y',
        }));
      }
    } catch { /* ignore */ }
  }

  return product;
}
