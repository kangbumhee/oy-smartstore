/* Register Queue Logic with timer + stock popup */
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
    const calc = Margin.calculate(product.price, marginRate);
    const sellingEl = document.getElementById(`queue-selling-${goodsNo}`);
    const profitEl = document.getElementById(`queue-profit-${goodsNo}`);
    const numEl = document.getElementById(`queue-margin-num-${goodsNo}`);
    if (sellingEl) sellingEl.textContent = Margin.formatPrice(calc.sellingPrice);
    if (profitEl) profitEl.textContent = Margin.formatPrice(calc.totalProfit);
    if (numEl) numEl.value = marginRate;
  },

  remove(goodsNo) {
    Storage.removeFromQueue(goodsNo);
    this.render();
    UI.showToast('대기열에서 제거됨', 'info');
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

  showStockPopup(opts, product) {
    return new Promise((resolve) => {
      const available = opts.filter((o) => !o.soldOut);
      const rows = available.map((o, i) => {
        const stock = parseInt(o.quantity || o.stockQuantity || 999, 10);
        return `<tr>
          <td style="padding:6px 8px;font-size:13px;">${o.name || o.optionName || '옵션' + (i + 1)}</td>
          <td style="padding:6px 8px;text-align:right;font-size:13px;">${o.price ? o.price.toLocaleString() + '원' : '-'}</td>
          <td style="padding:6px 4px;text-align:center;"><input type="number" class="stock-input" data-idx="${i}" value="${stock}" min="0" max="9999" style="width:60px;padding:4px;border:1px solid #ddd;border-radius:4px;text-align:center;font-size:13px;" /></td>
        </tr>`;
      }).join('');

      const html = `
        <h3 style="margin:0 0 12px;">옵션 재고 확인</h3>
        <p style="font-size:13px;color:#666;margin:0 0 12px;">${product.name} — 옵션 ${available.length}개</p>
        <div style="max-height:300px;overflow-y:auto;">
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#f1f5f9;">
              <th style="padding:6px 8px;text-align:left;font-size:12px;">옵션명</th>
              <th style="padding:6px 8px;text-align:right;font-size:12px;">가격</th>
              <th style="padding:6px 4px;text-align:center;font-size:12px;">재고</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;">
          <button class="btn btn-outline btn-sm" id="stock-popup-skip">기본값 사용</button>
          <button class="btn btn-primary btn-sm" id="stock-popup-confirm">확인 후 등록</button>
        </div>
      `;

      UI.showModal(html);

      document.getElementById('stock-popup-confirm').onclick = () => {
        const inputs = document.querySelectorAll('.stock-input');
        inputs.forEach((inp) => {
          const idx = parseInt(inp.dataset.idx, 10);
          if (available[idx]) {
            available[idx].stockQuantity = Math.max(0, parseInt(inp.value, 10) || 0);
          }
        });
        UI.hideModal();
        resolve(opts);
      };

      document.getElementById('stock-popup-skip').onclick = () => {
        UI.hideModal();
        resolve(opts);
      };
    });
  },

  async registerOne(goodsNo) {
    const queue = Storage.getQueue();
    const product = queue.find((p) => p.goodsNo === goodsNo);
    if (!product) return UI.showToast('상품 정보를 찾을 수 없습니다', 'error');

    const marginRate = product.marginRate || 15;
    const calc = Margin.calculate(product.price, marginRate);

    // Re-check options before starting
    let opts = (product.options || []).filter((o) => !o.soldOut);
    if (opts.length === 0) {
      const nameHints = product.name || '';
      const hasOptionHint = /(\d+)\s*(COLOR|컬러|색상|종|타입|TYPE|SET|세트|개입)/i.test(nameHints);
      if (hasOptionHint && typeof OptionModal !== 'undefined') {
        try {
          const modalOptions = await OptionModal.open(product);
          if (modalOptions && modalOptions.length > 0) {
            product.options = modalOptions;
            Storage.updateQueueItem(goodsNo, { options: modalOptions });
            opts = modalOptions.filter((o) => !o.soldOut);
          }
        } catch { /* user cancelled */ }
      }
    }

    // Show stock popup if options exist
    if (opts.length > 0) {
      opts = await this.showStockPopup(opts, product);
    }

    const optCount = opts.length;
    const steps = [
      { label: '네이버 토큰 발급 + AI 이미지 생성 + 상세설명 (병렬)...', status: 'active' },
      { label: '카테고리 분류 중...', status: 'pending' },
      { label: '이미지 네이버 업로드 중...', status: 'pending' },
      { label: `스마트스토어 등록 중... ${optCount > 0 ? `(옵션 ${optCount}개)` : ''}`, status: 'pending' },
    ];

    UI.showProgress(steps);
    this.startTimer();

    try {
      // Step 0: PARALLEL - Token + AI Images + AI Description
      UI.updateProgressStep(0, 'active', '토큰 + AI 이미지 + 상세설명 병렬 생성 중...');

      const settings = Storage.getSettings();
      const oyCategory = `${product.category || ''} ${product.subCategory || ''}`.trim();

      const tpl = settings.imgPromptTemplate || 'model_female_elegant';
      let customPrompt = '';
      if (tpl === 'custom') {
        customPrompt = settings.imgPromptCustom || '';
      } else if (App.PROMPT_TEMPLATES && App.PROMPT_TEMPLATES[tpl]) {
        customPrompt = App.PROMPT_TEMPLATES[tpl];
      }
      if (customPrompt) {
        customPrompt = customPrompt
          .replace(/\{product\}/g, product.name || '')
          .replace(/\{brand\}/g, product.brand || '')
          .replace(/\{option\}/g, '');
      }

      const imgCount = Math.max(1, Math.min(5, settings.imgCount || 1));

      const [tokenResult, imgResult, descResult] = await Promise.allSettled([
        API.obtainNaverToken(15),
        API.generateProductImages({
          productName: product.name,
          brand: product.brand || '',
          category: oyCategory,
          options: opts.length > 1 ? opts.slice(0, 3) : undefined,
          count: imgCount,
          prompt: customPrompt || undefined,
          thumbnail: product.thumbnail || undefined,
        }),
        API.generateDescription({
          name: product.name, brand: product.brand, price: calc.sellingPrice,
          category: oyCategory, options: product.options || [],
          reviewCount: product.reviewCount || 0, avgRating: product.avgRating || 0,
          imageUrls: [], geminiModel: settings.geminiModel || undefined,
        }),
      ]);

      // Check token
      if (tokenResult.status === 'rejected' || !tokenResult.value) {
        UI.updateProgressStep(0, 'error', '토큰 발급 실패: ' + (tokenResult.reason?.message || '').substring(0, 80));
        this.stopTimer();
        return;
      }

      // Check images
      let imageUrls = [];
      if (imgResult.status === 'fulfilled' && imgResult.value?.success && imgResult.value?.images?.length > 0) {
        imageUrls = imgResult.value.images;
      } else {
        console.warn('AI 이미지 실패, 올리브영 이미지 대체');
        try {
          const fb = await API.getProductImages(goodsNo, product.thumbnail);
          imageUrls = (fb.success && fb.images) ? fb.images : [];
        } catch { /* ignore */ }
        if (imageUrls.length === 0 && product.thumbnail) imageUrls.push(product.thumbnail);
      }

      // Check description (may have failed in parallel — will retry later)
      let descHtmlBase = '';
      let descFailed = true;
      if (descResult.status === 'fulfilled' && descResult.value?.html) {
        descHtmlBase = descResult.value.html;
        descFailed = !!descResult.value.fallback;
      }
      if (descResult.status === 'rejected') {
        console.warn('[등록] 병렬 설명 생성 실패:', descResult.reason?.message);
      }

      if (imageUrls.length === 0) {
        UI.updateProgressStep(0, 'error', '이미지 없음 - EccoAPI 키를 확인하세요');
        this.stopTimer();
        return;
      }

      const parallelTime = ((Date.now() - this._startTime) / 1000).toFixed(1);
      UI.updateProgressStep(0, 'done', `병렬 완료 (${parallelTime}초) - 이미지 ${imageUrls.length}장${descFailed ? ', 설명 재시도 예정' : ', 설명 OK'}`);

      // Step 1: Classify category
      UI.updateProgressStep(1, 'active');
      let categoryId, categoryName;
      try {
        const catData = await API.getBestCategory(oyCategory, product.name);
        categoryId = catData.id || catData.naver_category_id;
        categoryName = catData.name || catData.naver_category_name;
      } catch {
        try {
          const aiCat = await API.classifyCategory(product.name, oyCategory);
          categoryId = aiCat.naver_category_id;
          categoryName = aiCat.naver_category_name;
        } catch { /* fallback below */ }
      }
      if (!categoryId) { categoryId = '50000803'; categoryName = '기타스킨케어 (폴백)'; }
      UI.updateProgressStep(1, 'done', `카테고리: ${categoryName}`);

      // Step 2: Upload images to Naver + embed in description
      UI.updateProgressStep(2, 'active', `이미지 ${imageUrls.length}장 네이버 업로드 중...`);
      let uploadedImages = [];
      if (imageUrls.length > 0) {
        const uploadData = await API.uploadImages(imageUrls);
        uploadedImages = (uploadData.uploaded && uploadData.uploaded.length > 0) ? uploadData.uploaded : [];
        if (uploadData.errors?.length > 0) console.warn('[등록] 업로드 에러:', uploadData.errors);
      }
      if (uploadedImages.length === 0) {
        UI.updateProgressStep(2, 'error', '이미지 업로드 실패');
        this.stopTimer();
        return;
      }
      UI.updateProgressStep(2, 'done', `이미지 ${uploadedImages.length}장 업로드 완료`);

      // Embed Naver image URLs into description HTML
      const naverImgUrls = uploadedImages.map(img => img.url).filter(Boolean);

      // Retry AI description if the parallel attempt failed/fell back
      if (descFailed) {
        UI.updateProgressStep(2, 'done', `이미지 ${uploadedImages.length}장 업로드 완료 → 상세설명 재생성 중...`);
        try {
          const retryDesc = await API.generateDescription({
            name: product.name, brand: product.brand, price: calc.sellingPrice,
            category: oyCategory, options: product.options || [],
            reviewCount: product.reviewCount || 0, avgRating: product.avgRating || 0,
            imageUrls: naverImgUrls, geminiModel: settings.geminiModel || undefined,
          });
          if (retryDesc?.html && !retryDesc.fallback) {
            descHtmlBase = retryDesc.html;
            console.log('[등록] 상세설명 재생성 성공:', descHtmlBase.length, '자');
          }
        } catch (e) {
          console.warn('[등록] 설명 재시도 실패:', e.message);
        }
      }

      let detailHtml = descHtmlBase;
      if (naverImgUrls.length > 0) {
        const imgHtml = naverImgUrls.map(u =>
          `<div style="margin:20px 0;text-align:center;"><img src="${u}" alt="" style="max-width:100%;height:auto;display:block;margin:0 auto;border-radius:8px;" /></div>`
        ).join('');
        detailHtml = imgHtml + detailHtml;
      }

      // Step 3: Register product
      UI.updateProgressStep(3, 'active', opts.length > 0 ? `스마트스토어 등록 중... (옵션 ${opts.length}개)` : '스마트스토어 등록 중...');
      const prefix = settings.namePrefix || '';
      const suffix = settings.nameSuffix || '';
      const registrationName = `${prefix}${prefix ? ' ' : ''}${product.name}${suffix ? ' ' : ''}${suffix}`.trim();
      const defaultStock = settings.defaultStock || 999;

      let finalSellingPrice = calc.sellingPrice;
      let registrationOptions = opts;

      if (opts.length > 1) {
        const optPrices = opts.map((o) => o.price || 0).filter((p) => p > 0);
        if (optPrices.length > 0) {
          const minOyPrice = Math.min(...optPrices);
          const minCalc = Margin.calculate(minOyPrice, marginRate);
          finalSellingPrice = minCalc.sellingPrice;
          registrationOptions = opts.map((o) => ({
            ...o,
            sellingPrice: Margin.calculate(o.price || minOyPrice, marginRate).sellingPrice,
          }));
        }
      }

      const regData = await API.registerProduct({
        name: registrationName, sellingPrice: finalSellingPrice, categoryId, detailHtml,
        uploadedImages, options: registrationOptions, stock: defaultStock,
        brand: product.brand || '', oliveyoungCategory: oyCategory,
      });

      this.stopTimer();
      const totalTime = ((Date.now() - this._startTime) / 1000).toFixed(1);

      if (regData.success) {
        UI.updateProgressStep(3, 'done', `스마트스토어 등록 완료! (총 ${totalTime}초)`);

        Storage.addRegistered({
          goodsNo: product.goodsNo, name: product.name, brand: product.brand,
          thumbnail: product.thumbnail, oyPrice: product.price, sellingPrice: calc.sellingPrice,
          marginRate, categoryId, categoryName,
          productNo: regData.result?.smartstoreChannelProductNo || regData.result?.originProductNo || '',
        });

        Storage.removeFromQueue(goodsNo);

        // Add close button - user must manually close
        this._addCloseButton(totalTime, product.name, true);
      } else {
        const errRaw = regData.error;
        let errMsg;
        if (typeof errRaw === 'string') errMsg = errRaw;
        else if (errRaw?.message) errMsg = errRaw.message;
        else errMsg = JSON.stringify(errRaw || '알 수 없는 오류');

        console.error('[등록 실패 상세]', errRaw);
        UI.updateProgressStep(3, 'error', `등록 실패 (${totalTime}초): ${errMsg.substring(0, 100)}`);
        this._addCloseButton(totalTime, product.name, false, errMsg);
      }
    } catch (e) {
      this.stopTimer();
      const totalTime = ((Date.now() - this._startTime) / 1000).toFixed(1);
      UI.updateProgressStep(0, 'error', '오류: ' + e.message.substring(0, 80));
      this._addCloseButton(totalTime, product.name, false, e.message);
    }
  },

  _addCloseButton(totalTime, productName, success, errMsg) {
    const stepsEl = document.getElementById('progress-steps');
    if (!stepsEl) return;

    const msg = success
      ? `<div style="text-align:center;margin:16px 0 8px;color:var(--success);font-weight:600;">등록 완료! (${totalTime}초)</div>`
      : `<div style="text-align:center;margin:16px 0 8px;color:var(--danger);font-weight:600;">등록 실패 (${totalTime}초)</div>`;

    stepsEl.insertAdjacentHTML('beforeend', `
      ${msg}
      <div style="text-align:center;margin-top:8px;">
        <button class="btn btn-primary btn-sm" onclick="UI.hideProgress(); Register.render(); Products.render();" style="min-width:120px;">닫기</button>
      </div>
    `);

    if (success) {
      UI.showToast(`"${productName}" 스마트스토어 등록 완료! (${totalTime}초)`, 'success');
    }
  },
};
