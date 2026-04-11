/* Register Queue Logic — 병렬 최적화 */
const Register = {
  _timer: null,
  _startTime: 0,

  render() {
    const queue = Storage.getQueue();
    const listEl = document.getElementById('register-queue');
    const emptyEl = document.getElementById('register-empty');
    if (queue.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    listEl.innerHTML = queue.map((p) => UI.renderQueueItem(p)).join('');
    UI.updateBadge();
  },

  updateMargin(goodsNo, marginRate) {
    marginRate = parseInt(marginRate, 10);
    if (isNaN(marginRate) || marginRate < 5) marginRate = 5;
    if (marginRate > 50) marginRate = 50;
    const queue = Storage.getQueue();
    const product = queue.find((p) => p.goodsNo === goodsNo);
    if (!product) return;
    Storage.updateQueueItem(goodsNo, { marginRate });
    const calc = Margin.calculate(Margin.resolveProductPrice(product, product.options), marginRate);
    const sellingEl = document.getElementById(`queue-selling-${goodsNo}`);
    const profitEl = document.getElementById(`queue-profit-${goodsNo}`);
    const numEl = document.getElementById(`queue-margin-num-${goodsNo}`);
    if (sellingEl) sellingEl.textContent = Margin.formatPrice(calc.sellingPrice);
    if (profitEl) profitEl.textContent = Margin.formatPrice(Margin.getDisplayProfit(calc));
    if (numEl) numEl.value = marginRate;
  },

  remove(goodsNo) {
    Storage.removeFromQueue(goodsNo);
    this.render();
    UI.showToast('대기열에서 제거됨', 'info');
  },

  selectAllOptionsForProduct(goodsNo) {
    document.querySelectorAll('.opt-check').forEach((cb) => {
      if (cb.dataset.goodsNo === String(goodsNo)) cb.checked = true;
    });
  },

  removeSelectedOptions(goodsNo) {
    const checkboxes = Array.from(document.querySelectorAll('.opt-check:checked')).filter((cb) => cb.dataset.goodsNo === String(goodsNo));
    if (checkboxes.length === 0) {
      UI.showToast('제거할 옵션을 선택하세요', 'info');
      return;
    }
    const queue = Storage.getQueue();
    const product = queue.find((p) => p.goodsNo === goodsNo);
    if (!product || !product.options?.length) return;

    const indices = checkboxes.map((cb) => parseInt(cb.dataset.optIdx, 10)).sort((a, b) => b - a);
    for (const idx of indices) {
      if (product.options[idx] !== undefined) product.options.splice(idx, 1);
    }
    Storage.updateQueueItem(goodsNo, { options: product.options });
    this.render();
    UI.showToast(`${indices.length}개 옵션 제거됨`, 'success');
  },

  startTimer() {
    this._startTime = Date.now();
    const timerEl = document.getElementById('progress-timer');
    if (!timerEl) return;
    this._timer = setInterval(() => {
      const elapsed = Math.round((Date.now() - this._startTime) / 1000);
      timerEl.textContent = `${elapsed}초 경과`;
    }, 500);
  },

  stopTimer() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  _escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  },

  _toHighResImage(url) {
    if (!url) return '';
    try {
      const parsed = new URL(String(url), window.location.origin);
      parsed.searchParams.set('RS', '2000x0');
      parsed.searchParams.set('QT', '95');
      return parsed.toString();
    } catch {
      const separator = String(url).includes('?') ? '&' : '?';
      return `${url}${separator}RS=2000x0&QT=95`;
    }
  },

  cleanProductName(rawName) {
    if (!rawName) return rawName;
    let name = rawName;
    const bracketPatterns = [
      /\[[^\]]*올영[^\]]*\]/gi, /\[[^\]]*증정[^\]]*\]/gi,
      /\[[^\]]*기획[^\]]*\]/gi, /\[[^\]]*에디션[^\]]*\]/gi,
      /\[[^\]]*PICK[^\]]*\]/gi, /\[[^\]]*공동개발[^\]]*\]/gi,
      /\[[^\]]*단독[^\]]*\]/gi, /\[[^\]]*한정[^\]]*\]/gi,
      /\[[^\]]*연속[^\]]*\]/gi, /\[[^\]]*NEW[^\]]*\]/gi,
      /\[[^\]]*컬러추가[^\]]*\]/gi, /\[[^\]]*본품[^\]]*\]/gi,
      /\[\d+\+\d+\]/g,
    ];
    for (const p of bracketPatterns) name = name.replace(p, '');
    name = name.replace(/\(단품[\/]?기획\)/g, '');
    name = name.replace(/\(본품[+][^\)]*\)/g, '');
    name = name.replace(/,?\s*FREE\s*\(One\s*size\)/gi, '');
    name = name.replace(/,?\s*FREE$/gi, '');
    name = name.replace(/,?\s*\(One\s*size\)/gi, '');
    name = name.replace(/\d+COLOR\s*/gi, '');
    name = name.replace(/증정[^)\]]*[\])]/gi, '');
    name = name.replace(/레디백\s*증정/gi, '');
    name = name.replace(/,\s*증정[^,]*/gi, '');
    name = name.replace(/\bfree\b/gi, '');
    name = name.replace(/,\s*$/, '');
    name = name.replace(/\s{2,}/g, ' ').trim();
    name = name.replace(/^[\s\/,]+|[\s\/,]+$/g, '').trim();
    return name || rawName;
  },

  _getCurrentShopKey() {
    const creds = Storage.getCredentials();
    return String(creds.naverClientId || 'default-shop').trim() || 'default-shop';
  },

  async resolveDeliveryProfile(forceRefresh = false) {
    const shopKey = this._getCurrentShopKey();
    if (!forceRefresh) {
      const cached = Storage.getDeliveryProfile(shopKey);
      if (cached?.shippingAddressId && cached?.returnAddressId && Object.prototype.hasOwnProperty.call(cached, 'deliveryBundleGroupId')) {
        return cached;
      }
    }

    const data = await API.getNaverDeliverySettings();
    if (!data.success || !data.profile?.shippingAddressId || !data.profile?.returnAddressId) {
      throw new Error(data.error || '스마트스토어 배송지/반품지 조회에 실패했습니다.');
    }

    Storage.setDeliveryProfile(shopKey, data.profile);
    return data.profile;
  },

  showStockPopup(opts, product) {
    return new Promise((resolve) => {
      const isSoldOutFlag = (o) => o.soldOut === true || o.soldOutFlag === 'Y';
      const workingOpts = (Array.isArray(opts) ? opts : []).map((o) => ({ ...o }));
      const getStockValue = (o) => {
        const rawStock = parseInt(o.stockQuantity ?? o.quantity ?? (isSoldOutFlag(o) ? 0 : 999), 10);
        return Number.isFinite(rawStock) ? Math.max(0, rawStock) : 0;
      };
      const syncStocksFromInputs = () => {
        document.querySelectorAll('#stock-popup-body .stock-input').forEach((inp) => {
          const idx = parseInt(inp.dataset.idx, 10);
          if (!workingOpts[idx]) return;
          const newStock = Math.max(0, parseInt(inp.value, 10) || 0);
          workingOpts[idx].stockQuantity = newStock;
          workingOpts[idx].quantity = newStock;
          workingOpts[idx].soldOut = newStock <= 0;
          if (workingOpts[idx].soldOutFlag !== undefined) workingOpts[idx].soldOutFlag = newStock > 0 ? 'N' : 'Y';
        });
      };

      UI.showModal(`
        <h3 style="margin:0 0 12px;">옵션 재고 확인</h3>
        <p id="stock-popup-summary" style="font-size:13px;color:#666;margin:0 0 12px;"></p>
        <div style="max-height:300px;overflow-y:auto;">
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#f1f5f9;">
              <th style="padding:6px 8px;text-align:left;font-size:12px;">옵션명</th>
              <th style="padding:6px 8px;text-align:right;font-size:12px;">가격</th>
              <th style="padding:6px 4px;text-align:center;font-size:12px;">재고</th>
            </tr></thead>
            <tbody id="stock-popup-body"></tbody>
          </table>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;">
          <button class="btn btn-outline btn-sm" id="stock-popup-skip">기본값 사용</button>
          <button class="btn btn-primary btn-sm" id="stock-popup-confirm">확인 후 등록</button>
        </div>
      `);

      const summaryEl = document.getElementById('stock-popup-summary');
      const bodyEl = document.getElementById('stock-popup-body');
      const renderRows = () => {
        const hasSoldOut = workingOpts.some((o) => isSoldOutFlag(o));
        const soldOutHint = hasSoldOut
          ? '<br><span style="color:#dc2626;font-size:12px;">⚠ 품절 옵션은 재고 0으로 표시됩니다. 재입고 시 재고를 입력하세요.</span>'
          : '';
        if (summaryEl) {
          summaryEl.innerHTML = `${this._escHtml(product.name)} — 옵션 ${workingOpts.length}개${soldOutHint}`;
        }
        if (!bodyEl) return;
        bodyEl.innerHTML = workingOpts.map((o, i) => {
          const isSoldOut = isSoldOutFlag(o);
          const stock = getStockValue(o);
          const rowStyle = isSoldOut ? 'background:#fff5f5;' : '';
          const soldOutBadge = isSoldOut ? ' <span style="color:#dc2626;font-size:11px;font-weight:600;">(품절)</span>' : '';
          const optLabel = this._escHtml(o.name || o.optionName || '옵션' + (i + 1));
          const borderColor = isSoldOut ? '#fca5a5' : '#ddd';
          const priceText = o.price ? o.price.toLocaleString() + '원' : '-';
          return `<tr style="${rowStyle}">
            <td style="padding:6px 8px;font-size:13px;">${optLabel}${soldOutBadge}</td>
            <td style="padding:6px 8px;text-align:right;font-size:13px;">${priceText}</td>
            <td style="padding:6px 4px;text-align:center;">
              <div style="display:flex;align-items:center;justify-content:center;gap:6px;">
                <input type="number" class="stock-input" data-idx="${i}"
                  value="${stock}" min="0" max="9999"
                  style="width:60px;padding:4px;border:1px solid ${borderColor};border-radius:4px;text-align:center;font-size:13px;" />
                <button type="button" class="stock-remove-btn" data-idx="${i}"
                  title="이 옵션 제외"
                  style="width:28px;height:28px;border:1px solid #fecaca;background:#fff1f2;color:#dc2626;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;line-height:1;">
                  ×
                </button>
              </div>
            </td>
          </tr>`;
        }).join('');
      };

      if (bodyEl) {
        bodyEl.addEventListener('click', (e) => {
          const removeBtn = e.target.closest('.stock-remove-btn');
          if (!removeBtn) return;
          if (workingOpts.length <= 1) {
            UI.showToast('옵션은 최소 1개 이상 남겨주세요', 'info');
            return;
          }
          syncStocksFromInputs();
          const idx = parseInt(removeBtn.dataset.idx, 10);
          if (!Number.isInteger(idx) || !workingOpts[idx]) return;
          workingOpts.splice(idx, 1);
          renderRows();
          UI.showToast('옵션 1개를 제외했습니다', 'info', 1500);
        });
      }

      renderRows();

      document.getElementById('stock-popup-confirm').onclick = () => {
        syncStocksFromInputs();
        UI.hideModal();
        resolve(workingOpts);
      };
      document.getElementById('stock-popup-skip').onclick = () => {
        UI.hideModal();
        resolve(workingOpts);
      };
    });
  },

  async openCategorySelector(goodsNo) {
    const queue = Storage.getQueue();
    const product = queue.find(p => p.goodsNo === goodsNo);
    if (!product) return;
    const oyCategory = `${product.category || ''} ${product.subCategory || ''}`.trim();
    const saved = product._naverCategory || Storage.getSavedCategory(oyCategory);

    let autoCategory = null;
    const tokenReady = localStorage.getItem('naver_token');

    UI.showModal(`
      <h3 style="margin:0 0 12px;">네이버 카테고리 선택</h3>
      <p style="font-size:13px;color:#666;margin:0 0 4px;">
        <strong>${this._escHtml(product.name)}</strong>
      </p>
      <p style="font-size:12px;color:#94a3b8;margin:0 0 16px;">올리브영: ${this._escHtml(oyCategory)}</p>

      <div id="cat-auto-section" style="margin-bottom:16px;">
        <div style="font-size:12px;font-weight:600;color:#6366f1;margin-bottom:6px;">🤖 자동 감지</div>
        <div id="cat-auto-result" style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;color:#64748b;">
          감지 중...
        </div>
      </div>

      ${saved ? `<div style="margin-bottom:16px;">
        <div style="font-size:12px;font-weight:600;color:#16a34a;margin-bottom:6px;">💾 저장된 매핑</div>
        <div style="padding:8px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:13px;display:flex;align-items:center;justify-content:space-between;">
          <span>${this._escHtml(saved.name)} <span style="color:#94a3b8;">(${saved.id})</span></span>
          <button class="btn btn-sm btn-outline" onclick="Register._applyCategoryFromSaved('${goodsNo}')" style="font-size:11px;">이것 사용</button>
        </div>
      </div>` : ''}

      <div style="margin-bottom:12px;">
        <div style="font-size:12px;font-weight:600;color:#334155;margin-bottom:6px;">🔍 직접 검색</div>
        <div style="display:flex;gap:8px;">
          <input type="text" id="cat-search-input" placeholder="카테고리 검색 (예: 립틴트, 선크림, 샴푸...)" style="flex:1;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;" />
          <button class="btn btn-primary btn-sm" onclick="Register._searchCategories()" id="cat-search-btn">검색</button>
        </div>
      </div>

      <div id="cat-search-results" style="max-height:250px;overflow-y:auto;margin-bottom:12px;"></div>

      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#64748b;cursor:pointer;">
          <input type="checkbox" id="cat-save-mapping" checked style="width:15px;height:15px;" />
          같은 올리브영 카테고리에 자동 적용 (${this._escHtml(oyCategory)})
        </label>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-outline btn-sm" onclick="UI.hideModal()">취소</button>
      </div>
    `);

    const searchInput = document.getElementById('cat-search-input');
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') Register._searchCategories();
    });

    this._catSelectorGoodsNo = goodsNo;
    this._catSelectorOyCategory = oyCategory;

    if (tokenReady) {
      try {
        const cat = await API.getBestCategory(oyCategory, product.name);
        autoCategory = { id: cat.id, name: cat.name };
        const autoEl = document.getElementById('cat-auto-result');
        if (autoEl) {
          autoEl.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span>${this._escHtml(cat.name)} <span style="color:#94a3b8;">(${cat.id})</span></span>
              <button class="btn btn-sm btn-primary" onclick="Register._applyCategory('${goodsNo}', '${cat.id}', '${this._escHtml(cat.name).replace(/'/g, "\\'")}')">선택</button>
            </div>`;
        }
        this._autoCategory = autoCategory;
      } catch {
        const autoEl = document.getElementById('cat-auto-result');
        if (autoEl) autoEl.textContent = '자동 감지 실패 — 직접 검색해주세요';
      }
    }
  },

  async _searchCategories() {
    const input = document.getElementById('cat-search-input');
    const keyword = (input?.value || '').trim();
    if (!keyword) return;

    const resultsEl = document.getElementById('cat-search-results');
    if (!resultsEl) return;
    resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:#94a3b8;font-size:13px;">검색 중...</div>';

    try {
      const data = await API.searchCategories(keyword);
      const results = data.results || [];
      if (results.length === 0) {
        resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:#94a3b8;font-size:13px;">검색 결과가 없습니다</div>';
        return;
      }
      resultsEl.innerHTML = results.map(r => `
        <div style="padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:4px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">
          <div>
            <div style="font-size:13px;color:#334155;">${this._escHtml(r.name)}</div>
            <div style="font-size:11px;color:#94a3b8;">${r.id}</div>
          </div>
          <button class="btn btn-sm btn-outline" onclick="Register._applyCategory('${this._catSelectorGoodsNo}', '${r.id}', '${this._escHtml(r.name).replace(/'/g, "\\'")}')">선택</button>
        </div>
      `).join('');
    } catch (e) {
      resultsEl.innerHTML = `<div style="padding:12px;color:#dc2626;font-size:13px;">검색 실패: ${e.message}</div>`;
    }
  },

  _applyCategory(goodsNo, catId, catName) {
    const saveMapping = document.getElementById('cat-save-mapping')?.checked;
    const oyCategory = this._catSelectorOyCategory;

    Storage.updateQueueItem(goodsNo, { _naverCategory: { id: catId, name: catName } });

    if (saveMapping && oyCategory) {
      Storage.setCategoryMapping(oyCategory, { id: catId, name: catName });
      UI.showToast(`"${oyCategory}" → "${catName}" 매핑 저장됨`, 'success');
    } else {
      UI.showToast(`카테고리 선택: ${catName}`, 'success');
    }

    UI.hideModal();
    this.render();
  },

  _applyCategoryFromSaved(goodsNo) {
    const oyCategory = this._catSelectorOyCategory;
    const saved = Storage.getSavedCategory(oyCategory);
    if (saved) this._applyCategory(goodsNo, saved.id, saved.name);
  },

  async registerOne(goodsNo) {
    const queue = Storage.getQueue();
    const product = queue.find((p) => p.goodsNo === goodsNo);
    if (!product) return UI.showToast('상품 정보를 찾을 수 없습니다', 'error');

    const marginRate = product.marginRate || 15;
    let calc = Margin.calculate(Margin.resolveProductPrice(product, product.options), marginRate);
    const cleanedBaseName = this.cleanProductName(product.name);
    let deliveryProfile;

    try {
      deliveryProfile = await this.resolveDeliveryProfile();
    } catch (e) {
      UI.showToast(e.message, 'error');
      return;
    }

    let allOpts = product.options || [];
    if (allOpts.length === 0 && typeof OptionModal !== 'undefined') {
      try {
        const mo = await OptionModal.open(product);
        if (mo?.length > 0) {
          product.options = mo;
          Storage.updateQueueItem(goodsNo, { options: mo });
          allOpts = mo;
        }
      } catch (e) {
        if (e?.message === 'cancelled') {
          UI.showToast('옵션 선택이 취소되어 등록을 중단했습니다', 'info');
          return;
        }
        console.error('[registerOne] OptionModal 실패:', e);
        UI.showToast('옵션 불러오기에 실패해 등록을 중단했습니다', 'error');
        return;
      }
    }

    let opts = allOpts;
    if (opts.length > 0) {
      opts = await this.showStockPopup(opts, product);
      product.options = opts;
      Storage.updateQueueItem(goodsNo, { options: opts });
    }
    calc = Margin.calculate(Margin.resolveProductPrice(product, opts), marginRate);

    const optCount = opts.length;
    const settings = Storage.getSettings();
    const oyCategory = `${product.category || ''} ${product.subCategory || ''}`.trim();

    const manualCat = product._naverCategory || Storage.getSavedCategory(oyCategory);
    const skipCategoryApi = !!manualCat;

    const steps = [
      { label: skipCategoryApi ? '① 토큰 + 이미지 + 상세설명 (병렬)...' : '① 토큰 + 이미지 + 상세설명 + 카테고리 (병렬)...', status: 'active' },
      { label: '② 이미지 업로드 중...', status: 'pending' },
      { label: `③ 스마트스토어 등록 중... ${optCount > 0 ? `(옵션 ${optCount}개)` : ''}`, status: 'pending' },
    ];
    UI.showProgress(steps);
    this.startTimer();

    try {
      UI.updateProgressStep(0, 'active', skipCategoryApi ? '① 토큰·이미지·설명 동시 진행 중... (카테고리 수동)' : '① 토큰·이미지·설명·카테고리 동시 진행 중...');

      const tpl = settings.imgPromptTemplate || 'studio_white';
      let tplForDetail = tpl;
      if (tpl === 'thumbnail_closeup' || tpl === 'thumbnail_closeup_male') {
        tplForDetail = 'studio_white';
      }
      let customPrompt = '';
      if (tplForDetail === 'custom') {
        customPrompt = settings.imgPromptCustom || '';
      } else if (App.PROMPT_TEMPLATES && App.PROMPT_TEMPLATES[tplForDetail]) {
        customPrompt = App.PROMPT_TEMPLATES[tplForDetail];
      }
      if (customPrompt) {
        customPrompt = customPrompt
          .replace(/\{product\}/g, product.name || '')
          .replace(/\{brand\}/g, product.brand || '')
          .replace(/\{option\}/g, '');
      }

      const thumbnailTpl = String(tpl || '').includes('male') ? 'thumbnail_closeup_male' : 'thumbnail_closeup';
      let thumbnailPrompt = App.PROMPT_TEMPLATES[thumbnailTpl] || App.PROMPT_TEMPLATES.thumbnail_closeup;
      thumbnailPrompt = thumbnailPrompt
        .replace(/\{product\}/g, product.name || '')
        .replace(/\{brand\}/g, product.brand || '')
        .replace(/\{option\}/g, '');

      const imgCount = Math.max(1, Math.min(5, settings.imgCount || 1));
      const sharedImageCount = Math.max(0, imgCount - 1);
      const totalThumbnails = opts.length > 1 ? Math.min(opts.length, 5) : 1;
      const genCount = Math.min(sharedImageCount + totalThumbnails, 8);
      const optionThumbnailList = opts.length > 1
        ? opts.slice(0, totalThumbnails).map((o) => this._toHighResImage(o.image || product.thumbnail)).filter(Boolean)
        : [];
      const primaryThumbnail = optionThumbnailList[0] || this._toHighResImage(product.thumbnail || '');

      const tokenP = API.obtainNaverToken(15);

      const [tokenResult, imgResult, descResult, catResult] = await Promise.allSettled([
        tokenP,
        API.generateProductImages({
          productName: product.name,
          brand: product.brand || '',
          category: oyCategory,
          count: genCount,
          prompt: customPrompt || undefined,
          thumbnailPrompt,
          thumbnail: primaryThumbnail || undefined,
          thumbnailList: optionThumbnailList.length > 0 ? optionThumbnailList : undefined,
          thumbnailCount: totalThumbnails,
          thumbnailOptions: opts.length > 1
            ? opts.slice(0, totalThumbnails).map((o) => (o.name || o.optionName || '').trim()).filter(Boolean)
            : undefined,
        }),
        API.generateDescription({
          name: cleanedBaseName,
          brand: product.brand,
          price: calc.sellingPrice,
          category: oyCategory,
          options: product.options || [],
          reviewCount: product.reviewCount || 0,
          avgRating: product.avgRating || 0,
          imageUrls: [],
          geminiModel: settings.geminiModel || undefined,
        }),
        skipCategoryApi
          ? Promise.resolve(manualCat)
          : (async () => {
              await tokenP;
              try {
                const cat = await API.getBestCategory(oyCategory, product.name);
                return { id: cat.id || cat.naver_category_id, name: cat.name || cat.naver_category_name };
              } catch {
                try {
                  const ai = await API.classifyCategory(product.name, oyCategory);
                  return { id: ai.naver_category_id, name: ai.naver_category_name };
                } catch {
                  return null;
                }
              }
            })(),
      ]);

      if (tokenResult.status === 'rejected' || !tokenResult.value) {
        UI.updateProgressStep(0, 'error', '토큰 발급 실패: ' + (tokenResult.reason?.message || '').substring(0, 80));
        this.stopTimer();
        return;
      }

      let imageUrls = [];
      if (imgResult.status === 'fulfilled' && imgResult.value?.success && imgResult.value?.images?.length > 0) {
        imageUrls = imgResult.value.images;
      } else {
        console.warn('[등록] AI 이미지 실패, 올리브영 이미지 대체');
        try {
          const fb = await API.getProductImages(goodsNo, product.thumbnail);
          imageUrls = (fb.success && fb.images) ? fb.images : [];
        } catch { /* ignore */ }
        if (imageUrls.length === 0 && product.thumbnail) imageUrls.push(product.thumbnail);
      }
      if (imageUrls.length === 0) {
        UI.updateProgressStep(0, 'error', '이미지 없음 — EccoAPI 키를 확인하세요');
        this.stopTimer();
        return;
      }

      let descHtml = '';
      if (descResult.status === 'fulfilled' && descResult.value?.html && !descResult.value?.fallback) {
        descHtml = descResult.value.html;
        console.log('[등록] 상세설명 AI 생성 성공:', descHtml.length, '자');
      } else {
        const reason = descResult.status === 'rejected' ? descResult.reason?.message : descResult.value?.error;
        console.warn('[등록] 상세설명 실패:', reason);
        descHtml = descResult.value?.html || '';
      }

      let categoryId;
      let categoryName;
      if (catResult.status === 'fulfilled' && catResult.value?.id) {
        categoryId = catResult.value.id;
        categoryName = catResult.value.name;
      }
      if (!categoryId) { categoryId = '50000803'; categoryName = '기타스킨케어 (폴백)'; }
      const catSourceLabel = skipCategoryApi ? '수동' : '자동';

      const step0Time = ((Date.now() - this._startTime) / 1000).toFixed(1);
      UI.updateProgressStep(0, 'done',
        `① 완료 (${step0Time}초) — 이미지 ${imageUrls.length}장 | 설명 ${descHtml.length > 100 ? 'AI' : '폴백'} | ${categoryName} (${catSourceLabel})`);

      UI.updateProgressStep(1, 'active', `② 이미지 ${imageUrls.length}장 업로드 + 태그 + 브랜드/속성 조회 중...`);

      const [uploadData, tagData, attrData] = await Promise.all([
        API.uploadImages(imageUrls),
        API.getProductTags({
          productName: cleanedBaseName,
          categoryName: categoryName || '',
          brand: product.brand || '',
        }).catch(e => { console.warn('[등록] 태그 생성 실패:', e.message); return { tags: [] }; }),
        API.getCategoryAttributes(categoryId).catch(e => {
          console.warn('[등록] 속성 조회 실패:', e.message);
          return { attributes: [], requiredCount: 0 };
        }),
      ]);
      const uploadedImages = (uploadData.uploaded?.length > 0) ? uploadData.uploaded : [];
      if (uploadData.errors?.length > 0) console.warn('[등록] 업로드 에러:', uploadData.errors);
      const sellerTags = tagData.tags || [];
      if (sellerTags.length > 0) console.log('[등록] 태그', sellerTags.length, '개:', sellerTags.map(t => t.text).join(', '));

      let brandName = (product.brand || '').trim();
      if (!brandName && cleanedBaseName) {
        const m = cleanedBaseName.match(/^([\w가-힣·&]+)/u);
        if (m) brandName = m[1];
      }
      const manufacturerName = brandName;
      if (brandName) console.log('[등록] 브랜드:', brandName, '| 제조사:', manufacturerName);

      let productAttributes = [];
      const attrs = Array.isArray(attrData.attributes) ? attrData.attributes : [];
      for (const attr of attrs) {
        if (!attr.required) continue;
        const vals = attr.values || [];
        const type = attr.type || 'SINGLE_SELECT';
        if (type === 'DIRECT_INPUT' || vals.length === 0) {
          productAttributes.push({
            attributeSeq: attr.attributeSeq,
            attributeRealValue: '상세페이지 참조',
          });
          continue;
        }
        if (type === 'RANGE' && vals.length > 0) {
          const v = vals[Math.min(1, vals.length - 1)] || vals[0];
          const num = String(v.value || '').replace(/[^\d.]/g, '') || '1';
          const row = {
            attributeSeq: attr.attributeSeq,
            attributeValueSeq: v.valueSeq,
            attributeRealValue: num,
          };
          if (attr.unitCode) row.attributeRealValueUnitCode = attr.unitCode;
          productAttributes.push(row);
          continue;
        }
        productAttributes.push({
          attributeSeq: attr.attributeSeq,
          attributeValueSeq: vals[0].valueSeq,
        });
      }
      if (productAttributes.length > 0) {
        console.log('[등록] 필수 속성', productAttributes.length, '건 자동 입력 (전체:', attrs.length + '건)');
      }

      if (uploadedImages.length === 0) {
        UI.updateProgressStep(1, 'error', '이미지 업로드 실패');
        this.stopTimer();
        return;
      }

      const tagSummary = sellerTags.length > 0
        ? `| 태그 ${sellerTags.length}개`
        : '| 태그 없음';

      const naverImgUrls = uploadedImages.map((img) => img.url).filter(Boolean);
      const thumbUploads = uploadedImages.slice(0, totalThumbnails);
      const sharedUploads = uploadedImages.slice(totalThumbnails, totalThumbnails + sharedImageCount);

      let imgsForDetailTop = naverImgUrls;
      if (opts.length > 1 && totalThumbnails >= 1) {
        if (sharedUploads.length > 0) {
          imgsForDetailTop = sharedUploads.map((u) => u.url).filter(Boolean);
        } else if (naverImgUrls.length > 0) {
          imgsForDetailTop = naverImgUrls.slice(0, 1);
        }
      }

      let detailHtml = descHtml;

      if (!detailHtml || detailHtml.length < 100) {
        console.warn('[등록] 상세설명 짧음 → 이미지 + 기본 템플릿');
        const imgHtml = imgsForDetailTop.map((u) =>
          `<div style="margin:20px 0;text-align:center;"><img src="${this._escHtml(u)}" alt="" style="max-width:100%;height:auto;display:block;margin:0 auto;border-radius:8px;" /></div>`
        ).join('');
        detailHtml = imgHtml + `
<div style="max-width:100%;margin:0 auto;font-family:'Noto Sans KR',sans-serif;padding:20px;">
  <div style="background:linear-gradient(135deg,#FF6B35,#FF8F60);color:#fff;padding:36px 20px;text-align:center;border-radius:16px;margin-bottom:24px;">
    <h1 style="margin:0;font-size:26px;line-height:1.4;">${this._escHtml(cleanedBaseName)}</h1>
    <p style="margin:10px 0 0;font-size:18px;opacity:0.9;">${this._escHtml(product.brand || '')}</p>
  </div>
  <section style="background:#fff;border-radius:12px;padding:24px;margin-bottom:20px;border:1px solid #eee;">
    <h2 style="font-size:22px;color:#004E89;margin:0 0 16px;">상품 소개</h2>
    <p style="font-size:16px;line-height:1.8;color:#333;">올리브영 인기상품 <strong>${this._escHtml(cleanedBaseName)}</strong>을(를) 소개합니다. 올리브영 공식 판매 정품입니다.</p>
  </section>
</div>`;
      } else {
        const imgHtml = imgsForDetailTop.map((u) =>
          `<div style="margin:20px 0;text-align:center;"><img src="${this._escHtml(u)}" alt="" style="max-width:100%;height:auto;display:block;margin:0 auto;border-radius:8px;" /></div>`
        ).join('');
        if (imgsForDetailTop[0] && !detailHtml.includes(imgsForDetailTop[0])) {
          detailHtml = imgHtml + detailHtml;
        }
      }

      const brandSummary = brandName ? `브랜드:${brandName}` : '';
      const attrSummary = productAttributes.length > 0 ? `속성:${productAttributes.length}건` : `속성:${attrs.length}건(선택)`;
      UI.updateProgressStep(1, 'done', `② 업로드 ${uploadedImages.length}장 ${tagSummary} | ${brandSummary} | ${attrSummary}`);

      const prefix = settings.namePrefix || '';
      const suffix = settings.nameSuffix || '';
      const registrationName = `${prefix}${prefix ? ' ' : ''}${cleanedBaseName}${suffix ? ' ' : ''}${suffix}`.trim();
      const defaultStock = settings.defaultStock || 999;

      let finalSellingPrice = calc.sellingPrice;
      let registrationOptions = opts;

      if (opts.length > 1) {
        const optPrices = opts.map((o) => o.price || 0).filter((p) => p > 0);
        const stockOut = (o) => {
          const sq = parseInt(o.stockQuantity ?? o.quantity ?? 0, 10);
          return sq === 0 || o.soldOut === true || o.soldOutFlag === 'Y';
        };
        if (optPrices.length > 0) {
          const minOyPrice = Math.min(...optPrices);
          const minCalc = Margin.calculate(minOyPrice, marginRate);
          finalSellingPrice = minCalc.sellingPrice;
          registrationOptions = opts.map((o) => ({
            ...o,
            sellingPrice: Margin.calculate(o.price || minOyPrice, marginRate).sellingPrice,
            statusType: stockOut(o) ? 'OUTOFSTOCK' : 'SALE',
          }));
        } else {
          registrationOptions = opts.map((o) => ({
            ...o,
            statusType: stockOut(o) ? 'OUTOFSTOCK' : 'SALE',
          }));
        }
      }

      const useGroupRegister = registrationOptions.length >= 2;
      UI.updateProgressStep(2, 'active',
        useGroupRegister
          ? `③ 그룹상품 등록 중... (옵션 ${registrationOptions.length}개 → 개별 페이지)`
          : opts.length > 0 ? `③ 등록 중... (옵션 ${opts.length}개)` : '③ 등록 중...');

      const regPayload = {
        name: registrationName,
        sellingPrice: finalSellingPrice,
        categoryId,
        detailHtml,
        uploadedImages,
        options: registrationOptions,
        stock: defaultStock,
        brand: brandName || product.brand || '',
        oliveyoungCategory: oyCategory,
        sellerTags,
        brandName: brandName || undefined,
        manufacturerName: manufacturerName || undefined,
        productAttributes: productAttributes.length > 0 ? productAttributes : undefined,
        deliveryProfile,
      };

      if (useGroupRegister && opts.length > 1 && thumbUploads.length > 0) {
        regPayload.optionThumbnailUploads = thumbUploads;
        regPayload.sharedOptionalUploads = sharedUploads;
      }

      let regData;
      if (useGroupRegister) {
        console.log('[등록] 그룹상품 등록 시도 (옵션', registrationOptions.length, '개)');
        try {
          regData = await API.registerGroupProduct(regPayload);
        } catch (groupErr) {
          console.warn('[등록] 그룹등록 예외:', groupErr.message);
          regData = { success: false, fallbackToNormal: true, error: groupErr.message };
        }

        if (!regData.success) {
          const reason = typeof regData.error === 'string' ? regData.error
            : regData.error?.message || JSON.stringify(regData.error || '알 수 없음');
          console.warn('[등록] 그룹등록 실패 → 일반등록 전환:', reason);
          UI.updateProgressStep(2, 'active', '③ 그룹등록 실패 → 일반등록으로 전환...');
          regData = await API.registerProduct(regPayload);
        }
      } else {
        regData = await API.registerProduct(regPayload);
      }

      this.stopTimer();
      const totalTime = ((Date.now() - this._startTime) / 1000).toFixed(1);
      const isGroup = regData.isGroup === true;

      if (regData.success) {
        const label = isGroup
          ? `③ 그룹등록 완료! (옵션별 개별 페이지 생성, ${totalTime}초)`
          : `③ 등록 완료! (총 ${totalTime}초)`;
        UI.updateProgressStep(2, 'done', label);

        const registered = {
          goodsNo: product.goodsNo,
          name: cleanedBaseName,
          brand: product.brand,
          thumbnail: product.thumbnail,
          oyPrice: Margin.resolveProductPrice(product, opts),
          sellingPrice: calc.sellingPrice,
          marginRate,
          categoryId,
          categoryName,
          isGroup,
        };

        if (isGroup) {
          registered.groupProductNo = regData.groupProductNo || '';
          registered.requestId = regData.requestId || '';
          const pNos = Array.isArray(regData.productNos) ? regData.productNos : [];
          const enrichedProductNos = pNos.map((item, idx) => {
            const opt = registrationOptions[idx] || {};
            const stockQuantity = Math.max(0, parseInt(opt.stockQuantity ?? opt.quantity ?? 0, 10) || 0);
            return {
              ...item,
              optionName: (opt.name || opt.optionName || '').trim(),
              optionNumber: opt.optionNumber || '',
              stockQuantity,
              usable: stockQuantity > 0 && opt.soldOut !== true && opt.soldOutFlag !== 'Y',
            };
          });
          registered.productNo = enrichedProductNos[0]?.originProductNo || '';
          registered.channelProductNo = enrichedProductNos[0]?.smartstoreChannelProductNo || '';
          registered.productNos = enrichedProductNos;
          registered.syncedOptions = registrationOptions.map((opt) => {
            const stockQuantity = Math.max(0, parseInt(opt.stockQuantity ?? opt.quantity ?? 0, 10) || 0);
            return {
              name: (opt.name || opt.optionName || '').trim(),
              stock: stockQuantity,
              usable: stockQuantity > 0 && opt.soldOut !== true && opt.soldOutFlag !== 'Y',
            };
          });
        } else {
          registered.productNo = regData.result?.originProductNo || '';
          registered.channelProductNo = regData.result?.smartstoreChannelProductNo || '';
        }

        Storage.addRegistered(registered);
        Storage.removeFromQueue(goodsNo);
        this._addCloseButton(totalTime, cleanedBaseName, true, null, isGroup);
      } else {
        const errRaw = regData.error;
        let errMsg;
        if (typeof errRaw === 'string') errMsg = errRaw;
        else if (errRaw?.message) errMsg = errRaw.message;
        else errMsg = JSON.stringify(errRaw || '알 수 없는 오류');
        console.error('[등록 실패 상세]', errRaw);
        if (regData.invalidInputs) {
          console.error('[invalidInputs]', JSON.stringify(regData.invalidInputs, null, 2));
        }
        UI.updateProgressStep(2, 'error', `등록 실패 (${totalTime}초): ${errMsg.substring(0, 100)}`);
        this._addCloseButton(totalTime, product.name, false, errMsg);
      }
    } catch (e) {
      this.stopTimer();
      const totalTime = ((Date.now() - this._startTime) / 1000).toFixed(1);
      UI.updateProgressStep(0, 'error', '오류: ' + e.message.substring(0, 80));
      this._addCloseButton(totalTime, product.name, false, e.message);
    }
  },

  _addCloseButton(totalTime, productName, success, errMsg, isGroup) {
    const stepsEl = document.getElementById('progress-steps');
    if (!stepsEl) return;
    const groupLabel = isGroup ? ' (그룹상품 — 옵션별 개별 페이지)' : '';
    const msg = success
      ? `<div style="text-align:center;margin:16px 0 8px;color:var(--success);font-weight:600;">등록 완료!${groupLabel} (${totalTime}초)</div>`
      : `<div style="text-align:center;margin:16px 0 8px;color:var(--danger);font-weight:600;">등록 실패 (${totalTime}초)</div>`;
    stepsEl.insertAdjacentHTML('beforeend', `
      ${msg}
      <div style="text-align:center;margin-top:8px;">
        <button class="btn btn-primary btn-sm" onclick="UI.hideProgress(); Register.render(); Products.render();" style="min-width:120px;">닫기</button>
      </div>
    `);
    if (success) {
      const toastMsg = isGroup
        ? `"${productName}" 그룹상품 등록 완료! 옵션별 개별 페이지 생성됨 (${totalTime}초)`
        : `"${productName}" 스마트스토어 등록 완료! (${totalTime}초)`;
      UI.showToast(toastMsg, 'success');
    }
  },
};
