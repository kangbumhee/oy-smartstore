const { oyFetchWithRetry } = require('../../lib/oy-fetch');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { goodsNo, thumbnail, max = '5' } = req.query || {};
  if (!goodsNo) return res.status(400).json({ success: false, message: 'goodsNo required' });

  const maxImages = Math.min(parseInt(max, 10) || 5, 10);

  try {
    const oyUrl = `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${encodeURIComponent(goodsNo)}`;
    const r = await oyFetchWithRetry(oyUrl);
    if (!r.ok) throw new Error(`OY page ${r.status}`);

    const html = await r.text();
    const images = [];

    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const gd = nextData?.props?.pageProps?.goodsDetail ||
                   nextData?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data || {};

        const mainImg = gd.goodsImage || gd.imageUrl || gd.goodsThumbnailImage || '';
        if (mainImg) images.push(toHighRes(mainImg));

        const imgList = gd.goodsImageList || gd.imageList || gd.goodsImages || [];
        if (Array.isArray(imgList)) {
          for (const img of imgList) {
            const url = img.imageUrl || img.url || img.imgUrl || (typeof img === 'string' ? img : '');
            if (url && images.length < maxImages) {
              const hr = toHighRes(url);
              if (!images.includes(hr)) images.push(hr);
            }
          }
        }

        const optList = gd.optionList || gd.itemList || [];
        if (Array.isArray(optList)) {
          for (const opt of optList) {
            if (opt.soldOutYn === 'Y' || opt.soldOut) continue;
            const url = opt.imageUrl || opt.imgUrl || opt.image || '';
            if (url && images.length < maxImages) {
              const hr = toHighRes(url);
              if (!images.includes(hr)) images.push(hr);
            }
          }
        }
      } catch { /* fall through */ }
    }

    if (images.length === 0) {
      const ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
      if (ogMatch) images.push(toHighRes(ogMatch[1]));
    }

    if (images.length === 0 && thumbnail) {
      images.push(toHighRes(thumbnail));
    }

    return res.status(200).json({ success: true, goodsNo, images: images.slice(0, maxImages), source: 'page_scrape' });
  } catch (e) {
    if (thumbnail) {
      return res.status(200).json({ success: true, goodsNo, images: [toHighRes(thumbnail)], source: 'fallback', error: e.message });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
};

function toHighRes(url) {
  if (!url) return url;
  return url.replace(/\?RS=\d+x\d+/, '?RS=1000x0').replace(/&QT=\d+/, '&QT=95');
}
