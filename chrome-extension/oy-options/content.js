/**
 * Injected on oliveyoung.co.kr — same-origin fetch to /goods/api/v1/option, then postMessage to opener.
 */

function mapOptionItem(item) {
  return {
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
    image: item.optionImage ? item.optionImage.url + item.optionImage.path : '',
    colorChip: item.colorChipImage ? item.colorChipImage.url + item.colorChipImage.path : '',
    sortSeq: item.sortSeq || 0,
    isRepresent: item.representFlag === true,
  };
}

async function fetchOptionsAndPost(goodsNo) {
  const resp = await fetch('/goods/api/v1/option?goodsNumber=' + encodeURIComponent(goodsNo));
  const data = await resp.json();
  const optionList = (data && data.data && data.data.optionList) || [];
  const options = optionList.map(mapOptionItem);

  const result = {
    type: 'oy-options-result',
    goodsNo: goodsNo,
    success: options.length > 0,
    optionCount: options.length,
    options: options,
  };

  if (window.opener) {
    window.opener.postMessage(result, '*');
  }
  if (window.parent !== window) {
    window.parent.postMessage(result, '*');
  }
  window.postMessage(result, '*');

  return result;
}

function postError(goodsNo, message) {
  const errResult = {
    type: 'oy-options-result',
    goodsNo: goodsNo || '',
    success: false,
    error: message,
  };
  if (window.opener) window.opener.postMessage(errResult, '*');
  window.postMessage(errResult, '*');
}

window.addEventListener('message', async function (event) {
  if (!event.data || event.data.type !== 'oy-fetch-options') return;

  var goodsNo = event.data.goodsNo;
  if (!goodsNo) return;

  try {
    await fetchOptionsAndPost(goodsNo);
  } catch (e) {
    postError(goodsNo, e.message);
  }
});

(function init() {
  var urlParams = new URLSearchParams(window.location.search);
  var goodsNo = urlParams.get('goodsNo');
  if (!goodsNo) return;

  window.postMessage({ type: 'oy-extension-ready', goodsNo: goodsNo }, '*');

  if (urlParams.get('autoFetch') !== 'true') return;

  (async function () {
    try {
      await fetchOptionsAndPost(goodsNo);
      if (window.opener) {
        setTimeout(function () {
          try {
            window.close();
          } catch (e) {}
        }, 2000);
      }
    } catch (e) {
      postError(goodsNo, e.message);
    }
  })();
})();
