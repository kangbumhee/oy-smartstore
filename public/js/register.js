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

  _escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  },

  cleanProductName(rawName) {
    if (!rawName) return rawName;
    let name = rawName;
    const patterns = [
      /\[[^\]]*올영[^\]]*\]/gi, /\[[^\]]*증정[^\]]*\]/gi,
      /\[[^\]]*기획[^\]]*\]/gi, /\[[^\]]*에디션[^\]]*\]/gi,
      /\[[^\]]*PICK[^\]]*\]/gi, /\[[^\]]*공동개발[^\]]*\]/gi,
      /\[[^\]]*단독[^\]]*\]/gi, /\[[^\]]*한정[^\]]*\]/gi,
      /\[[^\]]*연속[^\]]*\]/gi, /\[[^\]]*NEW[^\]]*\]/gi,
      /\[[^\]]*컬러추가[^\]]*\]/gi, /\[[^\]]*본품[^\]]*\]/gi,
      /\[\d+\+\d+\]/g,
    ];
    for (const p of patterns) name = name.replace(p, '');
    name = name.replace(/\(단품[\/]?기획\)/g, '');
    name = name.replace(/\(본품[+][^\)]*\)/g, '');
    name = name.replace(/\s{2,}/g, ' ').trim();
    name = name.replace(/^[\s\/]+|[\s\/]+$/g, '').trim();
    return name || rawName;
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

      UI.showModal(`
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
      `);

      document.getElementById('stock-popup-confirm').onclick = () => {
        document.querySelectorAll('.stock-input').forEach((inp) => {
          const idx = parseInt(inp.dataset.idx, 10);
          if (available[idx]) available[idx].stockQuantity = Math.max(0, parseInt(inp.value, 10) || 0);
        });
        UI.hideModal();
        resolve(opts);
      };
      document.getElementById('stock-popup-skip').onclick = () => { UI.hideModal(); resolve(opts); };
    });
  },

  async registerOne(goodsNo) {
    const queue = Storage.getQueue();
    const product = queue.find((p) => p.goodsNo === goodsNo);
    if (!product) return UI.showToast('상품 정보를 찾을 수 없습니다', 'error');

    const marginRate = product.marginRate || 15;
    const calc = Margin.calculate(product.price, marginRate);
    const cleanedBaseName = this.cleanProductName(product.name);

    let opts = (product.options || []).filter((o) => !o.soldOut);
    if (opts.length === 0 && typeof OptionModal !== 'undefined') {
      try {
        const mo = await OptionModal.open(product);
        if (mo?.length > 0) {
          product.options = mo;
          Storage.updateQueueItem(goodsNo, { options: mo });
          opts = mo.filter((o) => !o.soldOut);
        }
      } catch { /* cancelled */ }
    }
    if (opts.length > 0) opts = await this.showStockPopup(opts, product);

    const optCount = opts.length;
    const settings = Storage.getSettings();
    const oyCategory = `${product.category || ''} ${product.subCategory || ''}`.trim();

    const steps = [
      { label: '① 토큰 + 이미지 + 상세설명 + 카테고리 (병렬)...', status: 'active' },
      { label: '② 이미지 업로드 중...', status: 'pending' },
      { label: `③ 스마트스토어 등록 중... ${optCount > 0 ? `(옵션 ${optCount}개)` : ''}`, status: 'pending' },
    ];
    UI.showProgress(steps);
    this.startTimer();

    try {
      UI.updateProgressStep(0, 'active', '① 토큰·이미지·설명·카테고리 동시 진행 중...');

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

      const tokenP = API.obtainNaverToken(15);

      const [tokenResult, imgResult, descResult, catResult] = await Promise.allSettled([
        tokenP,
        API.generateProductImages({
          productName: product.name,
          brand: product.brand || '',
          category: oyCategory,
          options: opts.length > 1 ? opts.slice(0, 3) : undefined,
          count: imgCount,
          prompt: customPrompt || undefined,
          thumbnailPrompt,
          thumbnail: product.thumbnail || undefined,
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
        (async () => {
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

      const step0Time = ((Date.now() - this._startTime) / 1000).toFixed(1);
      UI.updateProgressStep(0, 'done',
        `① 완료 (${step0Time}초) — 이미지 ${imageUrls.length}장 | 설명 ${descHtml.length > 100 ? 'AI' : '폴백'} | ${categoryName}`);

      UI.updateProgressStep(1, 'active', `② 이미지 ${imageUrls.length}장 업로드 중...`);

      const uploadData = await API.uploadImages(imageUrls);
      const uploadedImages = (uploadData.uploaded?.length > 0) ? uploadData.uploaded : [];
      if (uploadData.errors?.length > 0) console.warn('[등록] 업로드 에러:', uploadData.errors);

      if (uploadedImages.length === 0) {
        UI.updateProgressStep(1, 'error', '이미지 업로드 실패');
        this.stopTimer();
        return;
      }

      const naverImgUrls = uploadedImages.map((img) => img.url).filter(Boolean);

      let detailHtml = descHtml;

      if (!detailHtml || detailHtml.length < 100) {
        console.warn('[등록] 상세설명 짧음 → 이미지 + 기본 템플릿');
        const imgHtml = naverImgUrls.map((u) =>
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
        const imgHtml = naverImgUrls.map((u) =>
          `<div style="margin:20px 0;text-align:center;"><img src="${this._escHtml(u)}" alt="" style="max-width:100%;height:auto;display:block;margin:0 auto;border-radius:8px;" /></div>`
        ).join('');
        if (naverImgUrls[0] && !detailHtml.includes(naverImgUrls[0])) {
          detailHtml = imgHtml + detailHtml;
        }
      }

      UI.updateProgressStep(1, 'done', `② 업로드 ${uploadedImages.length}장 + 설명 조합 완료`);

      const prefix = settings.namePrefix || '';
      const suffix = settings.nameSuffix || '';
      const registrationName = `${prefix}${prefix ? ' ' : ''}${cleanedBaseName}${suffix ? ' ' : ''}${suffix}`.trim();
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
        brand: product.brand || '',
        oliveyoungCategory: oyCategory,
      };

      let regData;
      if (useGroupRegister) {
        console.log('[등록] 그룹상품 등록 시도 (옵션', registrationOptions.length, '개)');
        regData = await API.registerGroupProduct(regPayload);

        if (!regData.success && regData.fallbackToNormal) {
          console.warn('[등록] 그룹등록 실패 → 일반등록 전환:', regData.error || regData.message);
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
          oyPrice: product.price,
          sellingPrice: calc.sellingPrice,
          marginRate,
          categoryId,
          categoryName,
          isGroup,
        };

        if (isGroup) {
          registered.groupProductNo = regData.groupProductNo || '';
          registered.requestId = regData.requestId || '';
          const pNos = regData.productNos || [];
          registered.productNo = pNos[0]?.originProductNo || '';
          registered.channelProductNo = pNos[0]?.smartstoreChannelProductNo || '';
          registered.productNos = pNos;
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
