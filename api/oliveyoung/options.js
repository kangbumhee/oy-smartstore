/**
 * Olive Young Option API - uses /goods/api/v1/option endpoint
 * Returns option name, price, stock quantity, sold-out status, images, barcodes
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const goodsNo = (req.query && req.query.goodsNo) || '';
  if (!goodsNo) return res.status(400).json({ success: false, message: 'goodsNo required' });

  try {
    const options = await fetchOptionAPI(goodsNo);
    if (options && options.length > 0) {
      console.log(`[options] ${goodsNo} → ${options.length} options from OY API`);
      return res.status(200).json({
        success: true,
        source: 'oy_option_api',
        goodsNo,
        optionCount: options.length,
        options,
      });
    }
    return res.status(200).json({ success: false, message: 'No options found', goodsNo });
  } catch (e) {
    console.error(`[options] ${goodsNo} error:`, e.message);
    return res.status(200).json({ success: false, message: e.message, goodsNo });
  }
};

async function fetchOptionAPI(goodsNo) {
  const url = `https://www.oliveyoung.co.kr/goods/api/v1/option?goodsNumber=${goodsNo}`;

  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      Referer: `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${goodsNo}`,
      Origin: 'https://www.oliveyoung.co.kr',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) throw new Error(`OY option API ${resp.status}`);

  const data = await resp.json();
  const optionList = data?.data?.optionList;
  if (!Array.isArray(optionList) || optionList.length === 0) return null;

  return optionList.map((item) => ({
    name: item.optionName || '',
    optionName: item.optionName || '',
    optionNumber: item.optionNumber || '',
    standardCode: item.standardCode || '',
    salePrice: item.salePrice || 0,
    price: item.finalPrice || item.salePrice || 0,
    finalPrice: item.finalPrice || 0,
    soldOut: item.soldOutFlag === true,
    todayDelivery: item.todayDeliveryFlag === true,
    quantity: item.quantity || 0,
    stockQuantity: Math.min(item.quantity || 0, 999),
    image: item.optionImage ? `${item.optionImage.url}${item.optionImage.path}` : '',
    colorChip: item.colorChipImage ? `${item.colorChipImage.url}${item.colorChipImage.path}` : '',
    sortSeq: item.sortSeq || 0,
    isRepresent: item.representFlag === true,
  }));
}
