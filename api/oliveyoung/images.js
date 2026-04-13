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
    // 1차: 내부 옵션 API (bookmark-memo 방식)
    let images = await fetchFromOptionAPI(goodsNo, maxImages);

    // 2차: HTML 스크래핑 폴백
    if (images.length === 0) {
      images = await fetchFromPageScrape(goodsNo, maxImages);
    }

    // 3차: og:image 또는 thumbnail 폴백
    if (images.length === 0 && thumbnail) {
      images.push(toHighRes(thumbnail));
    }

    return res.status(200).json({
      success: true,
      goodsNo,
      images: images.slice(0, maxImages),
      source: images.length > 0 ? 'option_api' : 'fallback',
    });
  } catch (e) {
    if (thumbnail) {
      return res.status(200).json({ success: true, goodsNo, images: [toHighRes(thumbnail)], source: 'fallback', error: e.message });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * 올리브영 내부 옵션 API로 이미지 가져오기.
 * bookmark-memo 2026 Chrome extension의 접근 방식과 동일.
 */
async function fetchFromOptionAPI(goodsNo, maxImages) {
  const images = [];
  try {
    const apiUrl = `https://www.oliveyoung.co.kr/goods/api/v1/option?goodsNumber=${encodeURIComponent(goodsNo)}`;
    const r = await oyFetchWithRetry(apiUrl, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    if (!r.ok) return images;

    const data = await r.json();
    const items = Array.isArray(data) ? data : (data.data || data.items || data.options || []);

    for (const item of items) {
      if (images.length >= maxImages) break;

      // optionImage.url + optionImage.path (bookmark-memo 방식)
      const optImg = item.optionImage || item.image || {};
      let url = '';
      if (optImg.url && optImg.path) {
        url = optImg.url + optImg.path;
      } else if (typeof optImg === 'string') {
        url = optImg;
      } else {
        url = item.imageUrl || item.imgUrl || '';
      }

      if (url) {
        const hr = toHighRes(url);
        if (!images.includes(hr)) images.push(hr);
      }
    }
  } catch (e) {
    console.warn('[images] Option API failed, will fall back:', e.message);
  }
  return images;
}

/**
 * HTML 페이지 스크래핑으로 이미지 가져오기 (기존 방식).
 */
async function fetchFromPageScrape(goodsNo, maxImages) {
  const images = [];
  try {
    const oyUrl = `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${encodeURIComponent(goodsNo)}`;
    const r = await oyFetchWithRetry(oyUrl);
    if (!r.ok) return images;

    const html = await r.text();

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
  } catch (e) {
    console.warn('[images] Page scrape failed:', e.message);
  }
  return images;
}

function toHighRes(url) {
  if (!url) return url;
  // RS=2000x0 + QT=95 for maximum resolution (bookmark-memo approach)
  let result = url;
  if (result.includes('?RS=')) {
    result = result.replace(/\?RS=\d+x\d+/, '?RS=2000x0');
  } else if (result.includes('?')) {
    result += '&RS=2000x0';
  } else {
    result += '?RS=2000x0';
  }
  if (result.includes('&QT=')) {
    result = result.replace(/&QT=\d+/, '&QT=95');
  } else {
    result += '&QT=95';
  }
  return result;
}
