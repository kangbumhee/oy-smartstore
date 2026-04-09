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

  calculate(oyPrice, marginRate) {
    oyPrice = Number(oyPrice) || 0;
    marginRate = Number(marginRate) || 15;

    const marginMultiplier = 1 + marginRate / 100;
    const sellingPrice = Math.ceil((oyPrice * marginMultiplier + this.BUFFER) / 100) * 100;
    const marginAmount = sellingPrice - oyPrice - this.BUFFER;
    const shippingProfit = oyPrice >= 20000 ? this.SS_SHIPPING : this.SS_SHIPPING - this.OY_SHIPPING;
    const totalProfit = marginAmount + shippingProfit;

    return {
      oyPrice,
      marginRate,
      sellingPrice,
      marginAmount,
      shippingProfit,
      totalProfit,
      oyShippingFree: oyPrice >= 20000,
    };
  },

  formatPrice(n) {
    return Number(n).toLocaleString('ko-KR') + '원';
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
    profitEl.textContent = Margin.formatPrice(r.totalProfit);
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
