/* Search Page Logic */
const Search = {
  cachedProducts: {},

  extractProducts(data) {
    if (!data) return [];
    if (data.data?.inventory?.products) return data.data.inventory.products;
    if (data.inventory?.products) return data.inventory.products;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.products)) return data.products;
    return [];
  },

  parseInput(input) {
    input = input.trim();
    if (!input) return null;
    const urlMatch = input.match(/goodsNo[=\/]([A-Z]?\d{9,})/i) || input.match(/\/(\d{9,})/);
    if (urlMatch) return { type: 'goodsNo', value: urlMatch[1] };
    if (/^[A-Z]?\d{9,}$/.test(input)) return { type: 'goodsNo', value: input };
    return { type: 'keyword', value: input };
  },

  async search() {
    const input = document.getElementById('search-input').value;
    const parsed = this.parseInput(input);
    if (!parsed) return UI.showToast('검색어를 입력하세요', 'error');

    const resultsEl = document.getElementById('search-results');
    const emptyEl = document.getElementById('search-empty');
    resultsEl.innerHTML = '';
    emptyEl.style.display = 'none';
    UI.showLoading('search-loading');

    try {
      if (parsed.type === 'goodsNo') {
        const data = await API.getProductInfo(parsed.value);
        UI.hideLoading('search-loading');
        if (data.success && data.product) {
          this.cachedProducts[data.product.goodsNo] = data.product;
          resultsEl.innerHTML = UI.renderProductCard(data.product);
        } else {
          emptyEl.style.display = 'block';
        }
      } else {
        const data = await API.searchProducts(parsed.value);
        UI.hideLoading('search-loading');
        const rawProducts = this.extractProducts(data);
        if (rawProducts.length > 0) {
          const products = rawProducts.map((p) => ({
            goodsNo: p.goodsNumber || p.goodsNo || '',
            name: p.goodsName || p.goodsNm || p.name || '',
            brand: p.brandName || p.brandNm || p.brand || '',
            price: Number(p.priceToPay || p.salePrice || p.price || 0),
            originalPrice: Number(p.originPrice || p.originalPrice || p.normalPrice || 0),
            discount: p.discountRate || p.dcRate || '',
            thumbnail: p.imageUrl || p.goodsImage || p.goodsThumbnailImage || '',
            reviewCount: p.totalReviewCount || p.reviewCount || 0,
            avgRating: p.avgRating || p.averageRating || 0,
            soldOut: p.soldOutYn === 'Y' || p.soldOut === true || (p.inStock !== undefined && !p.inStock),
            category: p.categoryName || p.largeCateNm || '',
            subCategory: p.middleCateNm || p.smallCateNm || '',
            options: p.items || p.optionList || [],
          }));
          products.forEach((p) => { this.cachedProducts[p.goodsNo] = p; });
          resultsEl.innerHTML = products.map((p) => UI.renderProductCard(p)).join('');
        } else {
          emptyEl.style.display = 'block';
        }
      }
    } catch (e) {
      UI.hideLoading('search-loading');
      UI.showToast('검색 실패: ' + e.message, 'error');
    }
  },

  async openDetail(goodsNo) {
    let product = this.cachedProducts[goodsNo];
    if (!product || !product.name) {
      try {
        const data = await API.getProductInfo(goodsNo);
        if (data.success) product = data.product;
      } catch { /* use cached */ }
    }
    if (!product) return UI.showToast('상품 정보를 불러올 수 없습니다', 'error');

    const settings = Storage.getSettings();
    const marginRate = settings.marginRate || 15;
    const effectiveOyPrice = Margin.resolveProductPrice(product, product.options);
    const calc = Margin.calculate(effectiveOyPrice, marginRate);

    let optionsHtml = '';
    if (product.options && product.options.length > 1) {
      optionsHtml = `
        <div class="modal-options">
          <h4>옵션 (${product.options.length}개)</h4>
          <div class="option-list">
            ${product.options.map((o) => `<span class="option-tag ${o.soldOut ? 'sold-out' : ''}">${o.name || o.optionName}</span>`).join('')}
          </div>
        </div>
      `;
    }

    const thumb = product.thumbnail || '';
    const html = `
      <div class="modal-product-header">
        <div class="modal-product-images">
          <img class="modal-product-main-img" id="modal-main-img" src="${thumb}" alt="" onerror="this.style.background='#f1f5f9'" />
        </div>
        <div class="modal-product-info">
          <div class="modal-product-brand">${product.brand || ''}</div>
          <div class="modal-product-name">${product.name || ''}</div>
          <div class="modal-product-category">${product.category || ''} ${product.subCategory ? '> ' + product.subCategory : ''}</div>
          <div class="modal-price-section">
            <div class="modal-oy-price">
              <span class="price-current">${Number(effectiveOyPrice).toLocaleString()}원</span>
              ${product.originalPrice > effectiveOyPrice ? `<span class="price-original">${Number(product.originalPrice).toLocaleString()}원</span>` : ''}
              ${product.discount ? `<span class="price-discount">${product.discount}%</span>` : ''}
            </div>
          </div>
          <div class="modal-margin-section">
            <label>마진율 설정</label>
            <div class="margin-control">
              <input type="range" min="5" max="50" value="${marginRate}" id="modal-margin-range" />
              <input type="number" min="5" max="50" value="${marginRate}" id="modal-margin-num" />
              <span>%</span>
            </div>
          </div>
          <div class="modal-selling-price" id="modal-selling-price">${Margin.formatPrice(calc.sellingPrice)}</div>
          <div class="modal-profit" id="modal-profit">예상 순이익: ${Margin.formatPrice(calc.totalProfit)}</div>
          ${optionsHtml}
          <div class="modal-actions">
            <button class="btn btn-primary" onclick="Search.addToQueueFromModal('${goodsNo}')">등록 대기열에 추가</button>
            <button class="btn btn-outline" onclick="UI.hideModal()">닫기</button>
          </div>
        </div>
      </div>
    `;

    UI.showModal(html);

    const rangeEl = document.getElementById('modal-margin-range');
    const numEl = document.getElementById('modal-margin-num');
    const priceEl = document.getElementById('modal-selling-price');
    const profitEl = document.getElementById('modal-profit');

    function updateModal() {
      const c = Margin.calculate(Margin.resolveProductPrice(product, product.options), rangeEl.value);
      priceEl.textContent = Margin.formatPrice(c.sellingPrice);
      profitEl.textContent = `예상 순이익: ${Margin.formatPrice(c.totalProfit)}`;
    }

    rangeEl.addEventListener('input', () => { numEl.value = rangeEl.value; updateModal(); });
    numEl.addEventListener('input', () => { rangeEl.value = numEl.value; updateModal(); });
  },

  async enrichProduct(product) {
    if (product.options && product.options.length > 0) return product;
    if (!product.goodsNo) return product;

    // 1차: Vercel 서버 경유 시도 (OY가 차단할 수 있음)
    try {
      const optData = await API.getProductOptions(product.goodsNo);
      if (optData.success && optData.options?.length > 0) {
        product.options = optData.options;
        console.log(`[enrich] ${product.goodsNo} → 서버 API 성공: ${optData.options.length}개`);
        this.cachedProducts[product.goodsNo] = product;
        return product;
      }
    } catch (e) {
      console.log(`[enrich] 서버 API 실패 (${e.message}) → 팝업 방식으로 전환`);
    }

    // product-info로 기본 정보(thumbnail, brand, category) 보충
    try {
      const data = await API.getProductInfo(product.goodsNo);
      if (data.success && data.product) {
        if (data.product.thumbnail && !product.thumbnail) product.thumbnail = data.product.thumbnail;
        if (data.product.brand && !product.brand) product.brand = data.product.brand;
        if (data.product.category && !product.category) product.category = data.product.category;
        if (data.product.options?.length > 0 && (!product.options || product.options.length === 0)) {
          product.options = data.product.options;
        }
      }
    } catch { /* continue */ }

    if (product.options && product.options.length > 0) {
      this.cachedProducts[product.goodsNo] = product;
      return product;
    }

    // 2차: OptionModal 팝업 (서버 API 실패 시 항상 시도)
    if (typeof OptionModal !== 'undefined') {
      try {
        const modalOptions = await OptionModal.open(product);
        if (modalOptions && modalOptions.length > 0) {
          product.options = modalOptions;
          console.log(`[enrich] ${product.goodsNo} → 팝업/수동 성공: ${modalOptions.length}개`);
        }
      } catch (e) {
        if (e?.message === 'cancelled') return null;
        console.error('[enrich] OptionModal 실패:', e);
        UI.showToast('옵션 불러오기에 실패해 대기열 추가를 중단했습니다', 'error');
        return null;
      }
    }

    this.cachedProducts[product.goodsNo] = product;
    return product;
  },

  async addToQueue(goodsNo) {
    let product = this.cachedProducts[goodsNo];
    if (!product) return UI.showToast('상품 정보가 없습니다', 'error');

    UI.showToast('상품 정보 가져오는 중...', 'info', 2000);
    product = await this.enrichProduct(product);
    if (!product) {
      UI.showToast('옵션 선택이 취소되어 대기열에 추가하지 않았습니다', 'info');
      return;
    }

    const settings = Storage.getSettings();
    product.marginRate = settings.marginRate || 15;
    const added = Storage.addToQueue(product);
    if (added) {
      const optCount = (product.options || []).length;
      UI.showToast(`"${product.name}" 등록 대기열에 추가됨${optCount > 1 ? ` (옵션 ${optCount}개)` : ''}`, 'success');
      UI.updateBadge();
    } else {
      UI.showToast('이미 대기열에 있는 상품입니다', 'info');
    }
  },

  async addToQueueFromModal(goodsNo) {
    const rangeEl = document.getElementById('modal-margin-range');
    let product = this.cachedProducts[goodsNo];
    if (!product) return;

    product = await this.enrichProduct(product);
    if (!product) {
      UI.showToast('옵션 선택이 취소되어 대기열에 추가하지 않았습니다', 'info');
      return;
    }
    product.marginRate = rangeEl ? parseInt(rangeEl.value, 10) : 15;
    const added = Storage.addToQueue(product);
    if (added) {
      const optCount = (product.options || []).length;
      UI.showToast(`"${product.name}" 등록 대기열에 추가됨${optCount > 1 ? ` (옵션 ${optCount}개)` : ''}`, 'success');
      UI.updateBadge();
      UI.hideModal();
    } else {
      UI.showToast('이미 대기열에 있는 상품입니다', 'info');
    }
  },

  init() {
    const input = document.getElementById('search-input');
    const btn = document.getElementById('search-btn');
    btn.addEventListener('click', () => this.search());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.search(); });
  },
};
