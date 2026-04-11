/* Margin Calculator Logic */
const Margin = {
  SS_SHIPPING: 3000,
  OY_SHIPPING: 2500,
  BUFFER: 500,

  init(settings) {
    if (settings) {
      this.SS_SHIPPING = settings.smartstoreShippingFee || 3000;
      this.OY_SHIPPING = settings.oliveyoungShippingFee || 2500;
      this.BUFFER = settings.shippingProfitBuffer || 500;
    }
  },

  resolveProductPrice(product, options) {
    const opts = Array.isArray(options) ? options : (Array.isArray(product?.options) ? product.options : []);
    const optPrices = opts
      .map((o) => Number(o?.price ?? o?.sellingPrice ?? 0))
      .filter((p) => p > 0);

    if (optPrices.length === 1) return optPrices[0];
    if (optPrices.length > 1) return Math.min(...optPrices);
    return Number(product?.price || 0);
  },

  calculate(oyPrice, marginRate) {
    oyPrice = Number(oyPrice) || 0;
    marginRate = Number(marginRate) || 15;

    const marginMultiplier = 1 + marginRate / 100;
    const sellingPrice = Math.ceil((oyPrice * marginMultiplier + this.BUFFER) / 100) * 100;
    const marginAmount = sellingPrice - oyPrice - this.BUFFER;
    const shippingProfit = oyPrice >= 20000 ? this.SS_SHIPPING : this.SS_SHIPPING - this.OY_SHIPPING;
    const estimatedNetProfit = marginAmount + shippingProfit;

    return {
      oyPrice,
      marginRate,
      sellingPrice,
      marginAmount,
      shippingProfit,
      totalProfit: marginAmount,
      estimatedNetProfit,
      oyShippingFree: oyPrice >= 20000,
    };
  },

  formatPrice(n) {
    return Number(n).toLocaleString('ko-KR') + '원';
  },

  getDisplayProfit(calc) {
    const estimated = Number(calc?.estimatedNetProfit);
    if (Number.isFinite(estimated)) return estimated;
    return Number(calc?.totalProfit || 0);
  },
};

(function initCalcPage() {
  const oyInput = document.getElementById('calc-oy-price');
  const rangeInput = document.getElementById('calc-margin-range');
  const numInput = document.getElementById('calc-margin-input');
  const sellingEl = document.getElementById('calc-selling-price');
  const profitEl = document.getElementById('calc-profit');
  const shippingProfitEl = document.getElementById('calc-shipping-profit');

  function update() {
    const r = Margin.calculate(oyInput.value, rangeInput.value);
    sellingEl.textContent = Margin.formatPrice(r.sellingPrice);
    profitEl.textContent = Margin.formatPrice(Margin.getDisplayProfit(r));
    shippingProfitEl.textContent = r.oyShippingFree
      ? `+${Margin.formatPrice(r.shippingProfit)} (OY무료배송)`
      : `+${Margin.formatPrice(r.shippingProfit)}`;
  }

  if (oyInput) {
    oyInput.addEventListener('input', update);
    rangeInput.addEventListener('input', () => { numInput.value = rangeInput.value; update(); });
    numInput.addEventListener('input', () => { rangeInput.value = numInput.value; update(); });
  }
})();
