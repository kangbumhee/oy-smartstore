/* Register Queue Logic — 병렬 최적화 */
const Register = {
  _timer: null,
  _startTime: 0,
  _retryContexts: {},
  /** 재시도 모달: 옵션명 기반 속성 배열(옵션별). textarea 수정 시 null로 초기화 */
  _retryEditorPerOptionAttrs: null,
  _categorySelectorState: null,

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

  getCheckedOptionsForProduct(goodsNo, options = []) {
    const checkedIndices = Array.from(document.querySelectorAll('.opt-check:checked'))
      .filter((cb) => cb.dataset.goodsNo === String(goodsNo))
      .map((cb) => parseInt(cb.dataset.optIdx, 10))
      .filter((idx) => Number.isInteger(idx) && options[idx] !== undefined);

    if (checkedIndices.length === 0) return [];
    return checkedIndices.map((idx) => ({ ...options[idx] }));
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

  _logProgress(message, detail = null, type = 'info') {
    const suffix = detail == null
      ? ''
      : (typeof detail === 'string'
          ? ` ${detail}`
          : ` ${JSON.stringify(detail)}`);
    const line = `${String(message || '')}${suffix}`.trim();
    if (type === 'error') console.error(line);
    else if (type === 'warn') console.warn(line);
    else console.log(line);
    if (typeof UI !== 'undefined' && typeof UI.appendProgressLog === 'function') {
      UI.appendProgressLog(line, type);
    }
  },

  _isAbortLikeImageFailure(rawError) {
    const msg = String(rawError || '').toLowerCase();
    return (
      msg.includes('this operation was aborted') ||
      msg.includes('operation was aborted') ||
      msg.includes('aborted') ||
      msg.includes('시간 초과') ||
      msg.includes('timeout') ||
      msg.includes('err_connection_closed') ||
      msg.includes('networkerror')
    );
  },

  async _ensureFreshOptionData(goodsNo, opts = [], product = {}) {
    const list = Array.isArray(opts) ? opts.map((o) => ({ ...o })) : [];
    if (list.length === 0) return list;

    const currentImages = list.map((o) => String(o?.image || '').trim()).filter(Boolean);
    const currentPrices = list
      .map((o) => parseInt(o?.price || o?.finalPrice || o?.salePrice || 0, 10))
      .filter((v) => Number.isFinite(v) && v > 0);
    const uniqueImages = new Set(currentImages);
    const uniquePrices = new Set(currentPrices);
    const allSamePrice = currentPrices.length > 1 && uniquePrices.size <= 1;
    const needRefresh = list.length > 1 && (
      uniqueImages.size < Math.min(2, list.length) ||
      currentPrices.length === 0 ||
      allSamePrice
    );

    if (!needRefresh) return list;

    this._logProgress('[등록] 옵션 데이터 재조회 시작', {
      optionCount: list.length,
      uniqueImageCount: uniqueImages.size,
      uniquePriceCount: uniquePrices.size,
    });

    try {
      const latest = await API.getProductOptions(goodsNo);
      const latestOpts = Array.isArray(latest?.options) ? latest.options : [];
      if (latestOpts.length === 0) {
        this._logProgress('[등록] 옵션 데이터 재조회 결과 없음', null, 'warn');
        return list;
      }

      const byOptionNumber = new Map(
        latestOpts
          .filter((o) => String(o?.optionNumber || '').trim())
          .map((o) => [String(o.optionNumber).trim(), o])
      );
      const byName = new Map(
        latestOpts
          .filter((o) => String(o?.name || o?.optionName || '').trim())
          .map((o) => [String(o.name || o.optionName).trim(), o])
      );

      const merged = list.map((opt) => {
        const currentName = String(opt?.name || opt?.optionName || '').trim();
        const currentNo = String(opt?.optionNumber || '').trim();
        const latestOpt = byOptionNumber.get(currentNo) || byName.get(currentName);
        if (!latestOpt) return { ...opt };

        const currentPrice = parseInt(opt?.price || opt?.finalPrice || opt?.salePrice || 0, 10);
        const latestPrice = parseInt(latestOpt?.price || latestOpt?.finalPrice || latestOpt?.salePrice || 0, 10);

        return {
          ...opt,
          optionNumber: opt.optionNumber || latestOpt.optionNumber || '',
          image: opt.image || latestOpt.image || '',
          salePrice: (currentPrice > 0 && !allSamePrice) ? (opt.salePrice || currentPrice) : (latestOpt.salePrice || latestPrice || opt.salePrice || 0),
          finalPrice: (currentPrice > 0 && !allSamePrice) ? (opt.finalPrice || currentPrice) : (latestOpt.finalPrice || latestPrice || opt.finalPrice || 0),
          price: (currentPrice > 0 && !allSamePrice) ? currentPrice : (latestPrice || currentPrice || 0),
          quantity: Number.isFinite(parseInt(opt?.quantity, 10)) ? opt.quantity : latestOpt.quantity,
          stockQuantity: Number.isFinite(parseInt(opt?.stockQuantity, 10)) ? opt.stockQuantity : latestOpt.stockQuantity,
        };
      });

      this._logProgress('[등록] 옵션 데이터 재조회 완료', merged.map((o) => ({
        name: (o.name || o.optionName || '').trim(),
        price: parseInt(o.price || o.finalPrice || o.salePrice || 0, 10) || 0,
        image: String(o.image || '').trim() ? 'Y' : 'N',
      })));
      return merged;
    } catch (e) {
      this._logProgress('[등록] 옵션 데이터 재조회 실패', e?.message || String(e), 'warn');
      return list;
    }
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

  /** AI 스튜디오 참조용 — 고해상도(2000px)는 base64로 Ecco/게이트웨이 한도 초과·타임아웃 유발 */
  _toStudioRefImage(url) {
    if (!url) return '';
    try {
      const parsed = new URL(String(url), window.location.origin);
      parsed.searchParams.set('RS', '900x0');
      parsed.searchParams.set('QT', '82');
      return parsed.toString();
    } catch {
      const separator = String(url).includes('?') ? '&' : '?';
      return `${url}${separator}RS=900x0&QT=82`;
    }
  },

  /** 캔버스+toDataURL 시 crossOrigin으로 막히는 호스트(R2 등) */
  _imageUrlNeedsCanvasProxy(url) {
    const s = String(url || '');
    if (!s || s.startsWith('data:')) return false;
    try {
      const u = new URL(s, window.location.origin);
      if (u.origin === window.location.origin) return false;
      const h = u.hostname.toLowerCase();
      return h.endsWith('.r2.cloudflarestorage.com') || h.endsWith('.r2.dev');
    } catch {
      return false;
    }
  },

  async _cropImageBorder(imageUrl, cropPercent = 6) {
    const normalizedPercent = Math.max(0, Math.min(20, Number(cropPercent) || 0));
    if (!imageUrl || normalizedPercent <= 0) return imageUrl;

    let loadUrl = imageUrl;
    if (this._imageUrlNeedsCanvasProxy(imageUrl)) {
      try {
        const pr = await API.fetchImageForCanvas(imageUrl);
        if (pr?.success && pr.dataUrl) loadUrl = pr.dataUrl;
      } catch (e) {
        console.warn('[crop] R2 CORS 우회 프록시 실패 — 원본 URL로 시도:', e.message || e);
      }
    }

    return new Promise((resolve) => {
      const img = new Image();
      if (!String(loadUrl).startsWith('data:')) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => {
        try {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;
          if (!width || !height) return resolve(imageUrl);

          const cropX = Math.round(width * normalizedPercent / 100);
          const cropY = Math.round(height * normalizedPercent / 100);
          const cropW = Math.max(1, width - cropX * 2);
          const cropH = Math.max(1, height - cropY * 2);

          if (cropW <= 10 || cropH <= 10) {
            return resolve(imageUrl);
          }

          const canvas = document.createElement('canvas');
          canvas.width = cropW;
          canvas.height = cropH;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(imageUrl);
          ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
          resolve(canvas.toDataURL('image/png'));
        } catch {
          resolve(imageUrl);
        }
      };
      img.onerror = () => resolve(imageUrl);
      img.src = loadUrl;
    });
  },

  /** data URL이 크면 Vercel/네이버 업로드 한도에 걸림 → 긴 변 1600px JPEG로 축소 */
  async _shrinkDataUrlForUpload(imageUrl, maxEdge = 1600, quality = 0.82) {
    const s = String(imageUrl || '');
    if (!s.startsWith('data:image/')) return imageUrl;
    if (s.length < 450000 && !/^data:image\/(png|webp)/i.test(s)) {
      return imageUrl;
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const w0 = img.naturalWidth || img.width;
          const h0 = img.naturalHeight || img.height;
          if (!w0 || !h0) return resolve(imageUrl);
          const scale = Math.min(1, maxEdge / Math.max(w0, h0));
          const tw = Math.max(1, Math.round(w0 * scale));
          const th = Math.max(1, Math.round(h0 * scale));
          if (scale >= 1 && s.length < 700000) return resolve(imageUrl);
          const canvas = document.createElement('canvas');
          canvas.width = tw;
          canvas.height = th;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(imageUrl);
          ctx.drawImage(img, 0, 0, tw, th);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch {
          resolve(imageUrl);
        }
      };
      img.onerror = () => resolve(imageUrl);
      img.src = s;
    });
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
    name = name.replace(/[#"*?<>\\]/g, ' ');
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

  _clearCategorySelectorState(selection = null) {
    const state = this._categorySelectorState;
    this._categorySelectorState = null;
    if (state?.resolve) state.resolve(selection);
  },

  _getCategorySearchKeywords(product) {
    const oyCategory = `${product.category || ''} ${product.subCategory || ''}`.trim();
    const raw = [
      product.subCategory || '',
      product.category || '',
      oyCategory,
      product.brand || '',
      ...(String(product.name || '').split(/[\s/,+()[\]-]+/).filter(Boolean).slice(0, 8)),
    ];

    const keywords = [];
    for (const token of raw) {
      const normalized = String(token).trim();
      if (!normalized || normalized.length < 2) continue;
      if (!keywords.includes(normalized)) keywords.push(normalized);
      if (keywords.length >= 6) break;
    }
    return keywords;
  },

  _renderCategoryResultCards(results, goodsNo, style = 'outline') {
    if (!Array.isArray(results) || results.length === 0) return '';
    return results.map((r) => `
      <div style="padding:9px 12px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#fff;">
        <div style="min-width:0;">
          <div style="font-size:13px;color:#334155;word-break:break-word;">${this._escHtml(r.name)}</div>
          <div style="font-size:11px;color:#94a3b8;">${this._escHtml(r.id)}</div>
        </div>
        <button class="btn btn-sm btn-${style}" onclick="Register._applyCategory('${goodsNo}', '${String(r.id).replace(/'/g, "\\'")}', '${this._escHtml(r.name).replace(/'/g, "\\'")}')">선택</button>
      </div>
    `).join('');
  },

  async openCategorySelector(goodsNo, options = {}) {
    const queue = Storage.getQueue();
    const product = queue.find(p => p.goodsNo === goodsNo);
    if (!product) return null;
    const { requireSelection = false, title = '네이버 카테고리 선택' } = options;
    const oyCategory = `${product.category || ''} ${product.subCategory || ''}`.trim();
    const saved = product._naverCategory || Storage.getSavedCategory(oyCategory);
    const autoFallback = saved || null;

    const selectionPromise = new Promise((resolve) => {
      this._categorySelectorState = {
        goodsNo,
        oyCategory,
        requireSelection,
        resolve,
      };
    });

    UI.showModal(`
      <h3 style="margin:0 0 12px;">${this._escHtml(title)}</h3>
      <p style="font-size:13px;color:#666;margin:0 0 4px;">
        <strong>${this._escHtml(product.name)}</strong>
      </p>
      <p style="font-size:12px;color:#94a3b8;margin:0 0 8px;">올리브영: ${this._escHtml(oyCategory)}</p>
      ${requireSelection ? '<p style="font-size:12px;color:#6366f1;margin:0 0 16px;">등록 전에 추천 카테고리 중 하나를 직접 선택할 수 있습니다.</p>' : ''}

      <div id="cat-auto-section" style="margin-bottom:16px;">
        <div style="font-size:12px;font-weight:600;color:#6366f1;margin-bottom:6px;">🤖 자동 추천</div>
        <div id="cat-auto-result" style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;color:#64748b;">
          감지 중...
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <div style="font-size:12px;font-weight:600;color:#0f766e;margin-bottom:6px;">✨ 추천 카테고리</div>
        <div id="cat-recommend-results" style="max-height:220px;overflow-y:auto;padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;color:#64748b;">
          추천 목록을 불러오는 중...
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
        ${autoFallback ? `<button class="btn btn-primary btn-sm" onclick="Register._applyCategory('${goodsNo}', '${String(autoFallback.id).replace(/'/g, "\\'")}', '${this._escHtml(autoFallback.name).replace(/'/g, "\\'")}')">현재 추천으로 진행</button>` : ''}
        <button class="btn btn-outline btn-sm" onclick="Register._cancelCategorySelector()">${requireSelection ? '등록 취소' : '취소'}</button>
      </div>
    `);

    const searchInput = document.getElementById('cat-search-input');
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') Register._searchCategories();
      });
    }

    try {
      await API.obtainNaverToken(15);
    } catch {
      const autoEl = document.getElementById('cat-auto-result');
      if (autoEl) autoEl.textContent = '네이버 토큰 준비 실패 — 직접 검색으로 선택해주세요';
    }

    let autoCategory = null;
    try {
      const cat = await API.getBestCategory(oyCategory, product.name);
      autoCategory = cat?.id ? { id: cat.id, name: cat.name } : null;
      const autoEl = document.getElementById('cat-auto-result');
      if (autoEl) {
        autoEl.innerHTML = autoCategory
          ? this._renderCategoryResultCards([autoCategory], goodsNo, 'primary')
          : '자동 감지 실패 — 직접 검색해주세요';
      }
    } catch {
      const autoEl = document.getElementById('cat-auto-result');
      if (autoEl) autoEl.textContent = '자동 감지 실패 — 직접 검색해주세요';
    }

    const recommendEl = document.getElementById('cat-recommend-results');
    if (recommendEl) {
      try {
        const keywords = this._getCategorySearchKeywords(product);
        const seen = new Set();
        const recommended = [];
        for (const keyword of keywords) {
          const data = await API.searchCategories(keyword);
          for (const row of (data.results || [])) {
            if (!row?.id || seen.has(String(row.id))) continue;
            seen.add(String(row.id));
            recommended.push({ id: row.id, name: row.name });
            if (recommended.length >= 8) break;
          }
          if (recommended.length >= 8) break;
        }
        const merged = [];
        if (autoCategory) merged.push(autoCategory);
        for (const row of recommended) {
          if (!merged.some((m) => String(m.id) === String(row.id))) merged.push(row);
        }
        recommendEl.innerHTML = merged.length > 0
          ? this._renderCategoryResultCards(merged, goodsNo)
          : '<div style="padding:6px 4px;color:#94a3b8;">추천 목록이 없습니다. 직접 검색을 사용해주세요.</div>';
      } catch (e) {
        recommendEl.innerHTML = `<div style="padding:6px 4px;color:#dc2626;">추천 목록 조회 실패: ${this._escHtml(e.message)}</div>`;
      }
    }

    return selectionPromise;
  },

  _cancelCategorySelector() {
    UI.hideModal();
    this._clearCategorySelectorState(null);
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
          <button class="btn btn-sm btn-outline" onclick="Register._applyCategory('${this._categorySelectorState?.goodsNo || ''}', '${r.id}', '${this._escHtml(r.name).replace(/'/g, "\\'")}')">선택</button>
        </div>
      `).join('');
    } catch (e) {
      resultsEl.innerHTML = `<div style="padding:12px;color:#dc2626;font-size:13px;">검색 실패: ${e.message}</div>`;
    }
  },

  _applyCategory(goodsNo, catId, catName) {
    const saveMapping = document.getElementById('cat-save-mapping')?.checked;
    const oyCategory = this._categorySelectorState?.oyCategory;

    Storage.updateQueueItem(goodsNo, { _naverCategory: { id: catId, name: catName } });

    if (saveMapping && oyCategory) {
      Storage.setCategoryMapping(oyCategory, { id: catId, name: catName });
      UI.showToast(`"${oyCategory}" → "${catName}" 매핑 저장됨`, 'success');
    } else {
      UI.showToast(`카테고리 선택: ${catName}`, 'success');
    }

    UI.hideModal();
    this._clearCategorySelectorState({ id: catId, name: catName });
    this.render();
  },

  _applyCategoryFromSaved(goodsNo) {
    const oyCategory = this._categorySelectorState?.oyCategory;
    const saved = Storage.getSavedCategory(oyCategory);
    if (saved) this._applyCategory(goodsNo, saved.id, saved.name);
  },

  /** 그룹/일반 등록 API가 error에 객체·배열·failReason 등을 넣을 수 있음 → 항상 문자열 */
  _extractRegisterErrorMessage(errRaw, depth = 0) {
    if (depth > 8) return '오류 내용을 요약할 수 없습니다';
    if (errRaw == null) return '알 수 없는 오류';
    if (typeof errRaw === 'string') {
      const t = errRaw.trim();
      return t || '알 수 없는 오류';
    }
    if (typeof errRaw === 'number' || typeof errRaw === 'boolean') return String(errRaw);

    if (Array.isArray(errRaw)) {
      if (errRaw.length === 0) return '알 수 없는 오류';
      const first = errRaw[0];
      if (first && typeof first === 'object' && first.message != null) {
        return this._extractRegisterErrorMessage(first.message, depth + 1);
      }
      return this._extractRegisterErrorMessage(first, depth + 1);
    }

    if (typeof errRaw === 'object') {
      if (errRaw.error != null && typeof errRaw.errorMessage !== 'string') {
        const fromNested = this._extractRegisterErrorMessage(errRaw.error, depth + 1);
        if (fromNested && fromNested !== '알 수 없는 오류') return fromNested;
      }
      if (typeof errRaw.errorMessage === 'string' && errRaw.errorMessage.trim()) {
        return errRaw.errorMessage.trim();
      }
      if (errRaw.errorMessage != null && typeof errRaw.errorMessage === 'object') {
        return this._extractRegisterErrorMessage(errRaw.errorMessage, depth + 1);
      }
      if (typeof errRaw.message === 'string' && errRaw.message.trim()) {
        return errRaw.message.trim();
      }
      if (errRaw.message != null && typeof errRaw.message !== 'string') {
        return this._extractRegisterErrorMessage(errRaw.message, depth + 1);
      }
      if (typeof errRaw.failReason === 'string' && errRaw.failReason.trim()) {
        return errRaw.failReason.trim();
      }
      if (errRaw.failReason != null && typeof errRaw.failReason !== 'string') {
        return this._extractRegisterErrorMessage(errRaw.failReason, depth + 1);
      }
      if (Array.isArray(errRaw.invalidInputs) && errRaw.invalidInputs.length > 0) {
        return this._extractRegisterErrorMessage(errRaw.invalidInputs, depth + 1);
      }
      if (errRaw.data != null) {
        return this._extractRegisterErrorMessage(errRaw.data, depth + 1);
      }
      if (errRaw.progress != null) {
        return this._extractRegisterErrorMessage(errRaw.progress, depth + 1);
      }
      if (typeof errRaw.raw === 'string') return errRaw.raw.trim() || '알 수 없는 오류';
      if (errRaw.raw != null) return this._extractRegisterErrorMessage(errRaw.raw, depth + 1);
      try {
        const j = JSON.stringify(errRaw);
        return j && j !== '{}' ? j : '알 수 없는 오류';
      } catch {
        return '알 수 없는 오류';
      }
    }

    return String(errRaw);
  },

  _clipErr(text, maxLen) {
    let s = this._extractRegisterErrorMessage(text);
    if (typeof s !== 'string') s = String(s);
    if (s === '[object Object]') s = '알 수 없는 오류(상세는 콘솔 참고)';
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  },

  /** 옵션명(향·색 등)과 속성값 라벨 매칭 — 그룹상품은 옵션마다 productAttributes가 달라질 수 있음 */
  _pickAttributeValueForHint(vals, optionHint) {
    const hint = String(optionHint || '').trim();
    if (!hint || !Array.isArray(vals) || vals.length === 0) return vals[0] || null;
    const norm = (x) => String(x || '').trim().toLowerCase().replace(/\s+/g, '');
    const h = norm(hint);
    for (const v of vals) {
      const label = String(v.value || '').trim();
      if (!label) continue;
      const ln = norm(label);
      if (h.includes(ln) || ln.includes(h) || hint.includes(label) || label.includes(hint)) {
        return v;
      }
    }
    return vals[0] || null;
  },

  /** 카테고리 속성 API 응답 → 네이버 productAttributes[] (필수 속성만, 앞에서부터 maxPrimary개까지) */
  buildProductAttributesFromAttrData(attrData, opts = {}) {
    const maxPrimary = opts.maxPrimary != null && Number.isFinite(opts.maxPrimary)
      ? Math.max(0, Math.floor(opts.maxPrimary))
      : Infinity;
    const productAttributes = [];
    const attrs = Array.isArray(attrData?.attributes) ? attrData.attributes : [];
    let primaryCount = 0;
    for (const attr of attrs) {
      if (!attr.required) continue;
      if (primaryCount >= maxPrimary) break;
      primaryCount += 1;
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
      const chosen = this._pickAttributeValueForHint(vals, opts.optionHint) || vals[0];
      productAttributes.push({
        attributeSeq: attr.attributeSeq,
        attributeValueSeq: chosen.valueSeq,
      });
    }
    return productAttributes;
  },

  _extractInvalidInputs(regData) {
    const found = [];
    const seen = new Set();
    const addRows = (arr) => {
      if (!Array.isArray(arr)) return;
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue;
        const sig = JSON.stringify(item);
        if (seen.has(sig)) continue;
        seen.add(sig);
        found.push(item);
      }
    };
    const walk = (obj, depth) => {
      if (depth > 18 || obj == null) return;
      if (typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        if (
          obj.length > 0 &&
          typeof obj[0] === 'object' &&
          (Object.prototype.hasOwnProperty.call(obj[0], 'message') ||
            Object.prototype.hasOwnProperty.call(obj[0], 'type') ||
            Object.prototype.hasOwnProperty.call(obj[0], 'name'))
        ) {
          addRows(obj);
        } else {
          obj.forEach((x) => walk(x, depth + 1));
        }
        return;
      }
      addRows(obj.invalidInputs);
      for (const k of ['error', 'progress', 'failReason', 'data', 'raw', 'result']) {
        if (obj[k] != null) walk(obj[k], depth + 1);
      }
    };
    walk(regData, 0);
    const em =
      regData?.error &&
      typeof regData.error === 'object' &&
      typeof regData.error.errorMessage === 'string'
        ? regData.error.errorMessage.trim()
        : '';
    if (found.length === 0 && em) {
      addRows([{ name: '네이버 검증', message: em }]);
    } else if (found.length === 0 && regData?.error) {
      const msg = this._extractRegisterErrorMessage(regData.error);
      if (msg && msg !== '알 수 없는 오류') {
        addRows([{ name: '네이버 검증', message: msg }]);
      }
    }
    return found;
  },

  _mergeInvalidInputs(regData, groupFailureInfo) {
    const a = this._extractInvalidInputs(regData || {});
    const b = groupFailureInfo?.error
      ? this._extractInvalidInputs({ error: groupFailureInfo.error })
      : [];
    const seen = new Set();
    const out = [];
    for (const row of [...a, ...b]) {
      const sig = JSON.stringify(row);
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(row);
    }
    return out;
  },

  async _refreshRetryAttributePreview() {
    const previewEl = document.getElementById('retry-attr-preview');
    const attrsEl = document.getElementById('retry-attributes-json');
    const categoryEl = document.getElementById('retry-category-id');
    if (!previewEl || !attrsEl) return;
    const cat = (categoryEl?.value || '').trim();
    let parsed;
    try {
      parsed = JSON.parse(attrsEl.value || '[]');
      if (!Array.isArray(parsed)) throw new Error('not array');
    } catch {
      previewEl.innerHTML = '<span style="color:#dc2626;font-size:11px;">속성 JSON 형식 오류</span>';
      return;
    }
    if (parsed.length === 0) {
      previewEl.innerHTML =
        '<span style="color:#64748b;font-size:11px;">속성 없음 — 재시도 시 서버가 옵션별 <code>productAttributes: []</code>를 네이버에 명시 전송합니다. 이전에는 키가 빠져 같은 오류가 반복될 수 있었습니다. 그래도 실패하면「필수 1개만」 또는「속성 다시 채우기」를 시도하세요.</span>';
      return;
    }
    if (!cat) {
      previewEl.innerHTML = parsed
        .map(
          (r) =>
            `<div style="font-size:11px;color:#475569;">• 속성코드 <code>${this._escHtml(String(r.attributeSeq))}</code> → 값코드 <code>${this._escHtml(String(r.attributeValueSeq || r.attributeRealValue || '-'))}</code></div>`
        )
        .join('');
      return;
    }
    previewEl.innerHTML = '<span style="color:#64748b;font-size:11px;">속성 이름 조회 중…</span>';
    try {
      await API.obtainNaverToken(15);
      const attrData = await API.getCategoryAttributes(cat);
      const bySeq = {};
      for (const a of attrData.attributes || []) {
        bySeq[a.attributeSeq] = { name: a.name || `속성${a.attributeSeq}`, values: {} };
        for (const v of a.values || []) {
          bySeq[a.attributeSeq].values[v.valueSeq] = v.value || String(v.valueSeq);
        }
      }
      const lines = parsed.map((r) => {
        const meta = bySeq[r.attributeSeq];
        const nm = meta ? meta.name : `속성 #${r.attributeSeq}`;
        let vshow = '';
        if (r.attributeValueSeq != null && meta?.values?.[r.attributeValueSeq] != null) {
          vshow = meta.values[r.attributeValueSeq];
        } else if (r.attributeRealValue) {
          vshow = String(r.attributeRealValue);
        } else {
          vshow = r.attributeValueSeq != null ? `값코드 ${r.attributeValueSeq}` : '-';
        }
        return `<div style="font-size:11px;color:#334155;margin:2px 0;">• <strong>${this._escHtml(nm)}</strong> : ${this._escHtml(vshow)}</div>`;
      });
      previewEl.innerHTML = lines.join('');
    } catch (e) {
      previewEl.innerHTML = `<span style="color:#dc2626;font-size:11px;">이름 조회 실패: ${this._escHtml(String(e.message || e))}</span>`;
    }
  },

  _saveRetryContext(goodsNo, context) {
    if (!goodsNo || !context) return;
    this._retryContexts[goodsNo] = {
      ...context,
      savedAt: Date.now(),
    };
  },

  _getRetryContext(goodsNo) {
    return this._retryContexts[goodsNo] || null;
  },

  _clearRetryContext(goodsNo) {
    delete this._retryContexts[goodsNo];
  },

  _sanitizeDetailContent(html) {
    return String(html || '')
      .replace(/피부색상/gi, '피부 톤')
      .replace(/피부 색상/gi, '피부 톤');
  },

  _formatInvalidInputsHtml(invalidInputs) {
    if (!Array.isArray(invalidInputs) || invalidInputs.length === 0) {
      return '<div style="font-size:12px;color:#64748b;">상세 오류 목록이 없습니다.</div>';
    }
    return invalidInputs.map((item) => {
      const name = this._escHtml(item?.name || '-');
      const message = this._escHtml(item?.message || item?.type || '오류');
      return `<div style="padding:8px 10px;border:1px solid #fecaca;background:#fff7f7;border-radius:8px;font-size:12px;color:#991b1b;margin-bottom:6px;">
        <div style="font-weight:600;">${name}</div>
        <div>${message}</div>
      </div>`;
    }).join('');
  },

  _isGroupRequired(options = []) {
    return Array.isArray(options) && options.length >= 2;
  },

  async _submitRetryPayload(goodsNo, overrides = {}) {
    const ctx = this._getRetryContext(goodsNo);
    if (!ctx) {
      UI.showToast('재시도 가능한 임시 데이터가 없습니다. 다시 등록을 시도해 주세요.', 'error');
      return;
    }

    const queueProduct = Storage.getQueue().find((p) => p.goodsNo === goodsNo) || {};
    const retryOptions = Array.isArray(ctx.options) ? ctx.options : [];
    const mustKeepGroup = this._isGroupRequired(retryOptions);
    const useGroupRegister = overrides.forceNormal === true
      ? false
      : (mustKeepGroup ? true : !!ctx.useGroupRegister);

    const byOptRetry = Array.isArray(overrides.productAttributesByOption) && overrides.productAttributesByOption.length > 0
      ? overrides.productAttributesByOption
      : (Array.isArray(ctx.productAttributesByOption) && ctx.productAttributesByOption.length > 0
        ? ctx.productAttributesByOption
        : null);

    let omitGroupAttrs = true;
    if (useGroupRegister) {
      if (Object.prototype.hasOwnProperty.call(overrides, 'omitGroupProductAttributes')) {
        omitGroupAttrs = overrides.omitGroupProductAttributes === true;
      } else {
        omitGroupAttrs = ctx.retryOmitGroupAttrs !== false;
      }
    }

    const regPayload = {
      name: overrides.name || ctx.name,
      sellingPrice: Number(overrides.sellingPrice || ctx.sellingPrice || 0),
      categoryId: String(overrides.categoryId || ctx.categoryId || ''),
      detailHtml: overrides.detailHtml || ctx.detailHtml || '',
      uploadedImages: Array.isArray(ctx.uploadedImages) ? ctx.uploadedImages : [],
      options: Array.isArray(ctx.options) ? ctx.options : [],
      stock: Number(ctx.stock || 999),
      brand: ctx.brand || '',
      oliveyoungCategory: ctx.oliveyoungCategory || '',
      sellerTags: Array.isArray(ctx.sellerTags) ? ctx.sellerTags : [],
      brandName: ctx.brandName || undefined,
      manufacturerName: ctx.manufacturerName || undefined,
      deliveryProfile: ctx.deliveryProfile || undefined,
    };

    if (useGroupRegister) {
      regPayload.omitGroupProductAttributes = omitGroupAttrs;
    }

    if (!omitGroupAttrs && byOptRetry && useGroupRegister) {
      regPayload.productAttributesByOption = byOptRetry;
    } else if (byOptRetry && !useGroupRegister) {
      regPayload.productAttributes = Array.isArray(byOptRetry[0]) ? byOptRetry[0] : [];
    } else if (!useGroupRegister || !omitGroupAttrs) {
      const pa = Array.isArray(overrides.productAttributes)
        ? overrides.productAttributes
        : (Array.isArray(ctx.productAttributes) ? ctx.productAttributes : undefined);
      if (pa !== undefined) regPayload.productAttributes = pa;
    }

    if (Array.isArray(ctx.optionThumbnailUploads) && ctx.optionThumbnailUploads.length > 0) {
      regPayload.optionThumbnailUploads = ctx.optionThumbnailUploads;
    }
    if (Array.isArray(ctx.sharedOptionalUploads) && ctx.sharedOptionalUploads.length > 0) {
      regPayload.sharedOptionalUploads = ctx.sharedOptionalUploads;
    }

    UI.hideModal();
    UI.showProgress([
      { status: 'active', label: '저장된 이미지/설명 재사용 중...' },
      { status: 'wait', label: '스마트스토어 재등록 중...' },
    ], {
      productName: ctx.name || queueProduct.name || goodsNo,
      optionNames: Array.isArray(ctx.options) ? ctx.options.map((opt) => (opt.name || opt.optionName || '').trim()).filter(Boolean) : [],
      selectedOnly: Array.isArray(ctx.options) && ctx.options.length > 0,
    });
    this.startTimer();

    try {
      await API.obtainNaverToken(15);
      UI.updateProgressStep(0, 'done', '저장된 이미지/설명 재사용 준비 완료');
      UI.updateProgressStep(1, 'active', useGroupRegister ? '그룹상품 재등록 중...' : '일반상품 재등록 중...');

      let regData = useGroupRegister
        ? await API.registerGroupProduct(regPayload)
        : await API.registerProduct(regPayload);

      let groupFailureInfo = null;
      if (useGroupRegister && !regData.success) {
        groupFailureInfo = {
          error: regData.error,
          invalidInputs: this._extractInvalidInputs(regData),
        };
        if (overrides.forceNormal === true) {
          UI.updateProgressStep(1, 'active', '그룹등록 실패 → 선택하신 대로 일반등록으로 재시도...');
          regData = await API.registerProduct(regPayload);
        }
      }

      this.stopTimer();
      const totalTime = ((Date.now() - this._startTime) / 1000).toFixed(1);
      const isGroup = regData.isGroup === true;

      if (regData.success) {
        UI.updateProgressStep(1, 'done', isGroup ? `그룹상품 재등록 완료 (${totalTime}초)` : `재등록 완료 (${totalTime}초)`);

        const registered = {
          goodsNo,
          name: ctx.cleanedBaseName || queueProduct.name || ctx.name,
          brand: queueProduct.brand || ctx.brand || '',
          thumbnail: queueProduct.thumbnail || '',
          oyPrice: Margin.resolveProductPrice(queueProduct, queueProduct.options || ctx.options || []),
          sellingPrice: regPayload.sellingPrice,
          marginRate: queueProduct.marginRate || 15,
          categoryId: regPayload.categoryId,
          categoryName: ctx.categoryName || '',
          isGroup,
        };

        if (isGroup) {
          registered.groupProductNo = regData.groupProductNo || '';
          registered.requestId = regData.requestId || '';
          const pNos = Array.isArray(regData.productNos) ? regData.productNos : [];
          const enrichedProductNos = pNos.map((item, idx) => {
            const opt = regPayload.options[idx] || {};
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
          registered.syncedOptions = regPayload.options.map((opt) => {
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
        this._clearRetryContext(goodsNo);
        this._addCloseButton(totalTime, registered.name, true, null, isGroup);
        return regData;
      }

      const errMsg = this._extractRegisterErrorMessage(regData.error ?? regData.message ?? regData);
      const mergedGi = groupFailureInfo || ctx.groupFailureInfo;
      const invalidInputs = this._mergeInvalidInputs(regData, mergedGi ? { error: mergedGi.error } : null);
      this._saveRetryContext(goodsNo, {
        ...ctx,
        detailHtml: regPayload.detailHtml,
        categoryId: regPayload.categoryId,
        productAttributes: regPayload.productAttributes !== undefined ? regPayload.productAttributes : (ctx.productAttributes || []),
        productAttributesByOption: regPayload.productAttributesByOption || ctx.productAttributesByOption,
        retryOmitGroupAttrs: regPayload.omitGroupProductAttributes === true,
        lastError: errMsg,
        invalidInputs,
        forceNormalRetry: mustKeepGroup ? false : !!ctx.forceNormalRetry,
        mustKeepGroup,
        groupFailureInfo: mergedGi || ctx.groupFailureInfo,
      });

      UI.updateProgressStep(1, 'error', `재등록 실패 (${totalTime}초): ${this._clipErr(errMsg, 100)}`);
      this._addCloseButton(totalTime, queueProduct.name || ctx.name || goodsNo, false, errMsg, false, {
        goodsNo,
        allowRetry: true,
      });
      return regData;
    } catch (e) {
      this.stopTimer();
      const totalTime = ((Date.now() - this._startTime) / 1000).toFixed(1);
      this._saveRetryContext(goodsNo, {
        ...ctx,
        lastError: e.message,
        retryOmitGroupAttrs: ctx.retryOmitGroupAttrs !== false,
        forceNormalRetry: mustKeepGroup ? false : false,
        mustKeepGroup,
      });
      UI.updateProgressStep(1, 'error', `재등록 오류 (${totalTime}초): ${String(e.message).substring(0, 100)}`);
      this._addCloseButton(totalTime, queueProduct.name || ctx.name || goodsNo, false, e.message, false, {
        goodsNo,
        allowRetry: true,
      });
      return { success: false, error: e.message };
    }
  },

  openRetryEditor(goodsNo) {
    const ctx = this._getRetryContext(goodsNo);
    if (!ctx) {
      UI.showToast('수동 수정 가능한 임시 데이터가 없습니다', 'error');
      return;
    }

      const hasStoredByOption = Array.isArray(ctx.productAttributesByOption) && ctx.productAttributesByOption.length > 0;
    this._retryEditorPerOptionAttrs = hasStoredByOption
      ? ctx.productAttributesByOption.map((row) => (Array.isArray(row) ? row.map((a) => ({ ...a })) : []))
      : null;
    const attrJsonSeed = hasStoredByOption ? (ctx.productAttributesByOption[0] || []) : (ctx.productAttributes || []);

    const invalidInputsHtml = this._formatInvalidInputsHtml(ctx.invalidInputs);
    const groupFailureMsg = ctx.groupFailureInfo
      ? this._extractRegisterErrorMessage(ctx.groupFailureInfo.error)
      : '';
    const mustKeepGroup = !!ctx.mustKeepGroup || this._isGroupRequired(ctx.options);
    const forceNormalChecked = ctx.forceNormalRetry === true ? 'checked' : '';

    UI.showModal(`
      <h3 style="margin:0 0 12px;">수동 수정 후 재시도</h3>
      <div style="font-size:12px;color:#64748b;margin-bottom:12px;">이미 생성한 이미지/설명/업로드 결과를 그대로 재사용합니다. 다시 AI 생성하지 않습니다.</div>
      ${mustKeepGroup ? '<div style="margin-bottom:12px;padding:10px;border:1px solid #bfdbfe;background:#eff6ff;border-radius:8px;font-size:12px;color:#1d4ed8;">옵션이 2개 이상이면 기본은 <strong>그룹상품</strong> 재시도입니다. 그룹이 계속 실패하면 아래「일반상품 API로 재시도」를 체크한 뒤 재시도하세요 (네이버 옵션형 단일 상품).</div>' : ''}

      <div style="margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#991b1b;margin-bottom:6px;">현재 오류</div>
        <div style="padding:10px;border:1px solid #fecaca;background:#fff7f7;border-radius:8px;font-size:12px;color:#991b1b;">
          ${this._escHtml(ctx.lastError || '등록 실패')}
        </div>
      </div>

      ${groupFailureMsg ? `
        <div style="margin-bottom:12px;">
          <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:6px;">그룹등록 실패 사유</div>
          <div style="padding:10px;border:1px solid #fed7aa;background:#fff7ed;border-radius:8px;font-size:12px;color:#9a3412;">
            ${this._escHtml(groupFailureMsg)}
          </div>
        </div>
      ` : ''}

      <div style="margin-bottom:12px;padding:10px;border:1px solid #e0e7ff;background:#f5f7ff;border-radius:8px;font-size:12px;color:#3730a3;line-height:1.55;">
        <strong>연관 속성 오류가 날 때</strong><br/>
        네이버 그룹상품은 <strong>옵션(판매조합)마다</strong> <code>productAttributes</code>를 넣습니다. 향·색 등 옵션명이 다르면 <strong>모든 옵션에 똑같은 속성</strong>을 넣으면 연관 오류가 날 수 있습니다. 그럴 때는 <strong>「옵션명 반영 채우기」</strong>로 옵션별로 다시 생성하세요.<br/>
        「속성 다시 채우기」는 동일 속성을 모든 옵션에 복사합니다. 「속성 비우기」는 빈 배열을 명시합니다. 계속 실패하면 <strong>일반상품 API</strong> 또는 카테고리 변경을 검토하세요.
      </div>

      <div style="margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:6px;">네이버 검증 상세 (invalidInputs)</div>
        ${invalidInputsHtml}
      </div>

      <label style="display:block;font-size:12px;font-weight:700;color:#334155;margin-bottom:6px;">카테고리 ID</label>
      <input id="retry-category-id" type="text" value="${this._escHtml(ctx.categoryId || '')}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:12px;" />

      <label style="display:block;font-size:12px;font-weight:700;color:#334155;margin-bottom:6px;">상세설명 HTML</label>
      <textarea id="retry-detail-html" style="width:100%;height:220px;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;line-height:1.5;margin-bottom:8px;">${this._escHtml(ctx.detailHtml || '')}</textarea>
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
        <button type="button" class="btn btn-outline btn-sm" id="retry-sanitize-detail">금칙어 자동 치환</button>
      </div>

      <label style="display:block;font-size:12px;font-weight:700;color:#334155;margin-bottom:6px;">속성값 JSON (1번 옵션 예시 · 옵션별 전송 시 아래 버튼 우선)</label>
      ${hasStoredByOption ? '<div style="font-size:11px;color:#0369a1;margin:-4px 0 8px;">저장됨: 옵션별 속성 배열 — textarea는 첫 옵션만 표시합니다. 내용을 직접 고치면 옵션별 모드가 해제됩니다.</div>' : ''}
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;align-items:center;">
        <button type="button" class="btn btn-primary btn-sm" id="retry-refill-attrs-per-opt">옵션명 반영 채우기</button>
        <button type="button" class="btn btn-primary btn-sm" id="retry-refill-attrs">속성 다시 채우기</button>
        <button type="button" class="btn btn-outline btn-sm" id="retry-refill-attrs-1" title="필수 속성 앞에서 1건만 (연관 조합 완화)">필수 1개만</button>
        <button type="button" class="btn btn-outline btn-sm" id="retry-refill-attrs-3" title="필수 속성 앞에서 3건만">필수 3개만</button>
        <button type="button" class="btn btn-outline btn-sm" id="retry-clear-attrs">속성 비우기 ([])</button>
      </div>
      <textarea id="retry-attributes-json" style="width:100%;height:160px;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;line-height:1.5;">${this._escHtml(JSON.stringify(attrJsonSeed, null, 2))}</textarea>
      <div style="margin:8px 0 12px;padding:10px;border:1px dashed #cbd5e1;border-radius:8px;background:#fafafa;">
        <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px;">읽기 쉬운 미리보기</div>
        <div id="retry-attr-preview"></div>
      </div>

      <label style="display:flex;align-items:flex-start;gap:8px;margin:12px 0 8px;font-size:12px;color:#334155;cursor:pointer;line-height:1.45;">
        <input id="retry-omit-group-attrs" type="checkbox" ${ctx.retryOmitGroupAttrs !== false ? 'checked' : ''} style="margin-top:2px;" />
        <span><strong>그룹 등록 시 상품속성 API 생략</strong> (기본 체크 — 연관 속성 오류 완화. 검색·기타 속성은 스마트스토어센터에서 입력)</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;margin:12px 0 16px;font-size:12px;color:#334155;cursor:pointer;">
        <input id="retry-force-normal" type="checkbox" ${forceNormalChecked} ${mustKeepGroup ? 'disabled' : ''} />
        일반상품 API로 재시도 (체크 시 그룹 대신 옵션형 단일 상품 등록)
      </label>

      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-outline btn-sm" onclick="UI.hideModal()">닫기</button>
        <button class="btn btn-primary btn-sm" id="retry-submit-btn">수정 후 재시도</button>
      </div>
    `);

    const sanitizeBtn = document.getElementById('retry-sanitize-detail');
    const submitBtn = document.getElementById('retry-submit-btn');
    const detailEl = document.getElementById('retry-detail-html');
    const attrsEl = document.getElementById('retry-attributes-json');
    const categoryEl = document.getElementById('retry-category-id');
    const forceNormalEl = document.getElementById('retry-force-normal');
    const omitGroupAttrsEl = document.getElementById('retry-omit-group-attrs');

    if (sanitizeBtn && detailEl) {
      sanitizeBtn.onclick = () => {
        detailEl.value = this._sanitizeDetailContent(detailEl.value);
        UI.showToast('상세설명 금칙어 치환을 적용했습니다', 'success', 1800);
      };
    }

    if (submitBtn) {
      submitBtn.onclick = async () => {
        const base = {
          categoryId: categoryEl?.value || ctx.categoryId,
          detailHtml: detailEl?.value || ctx.detailHtml,
          forceNormal: !!forceNormalEl?.checked,
        };

        const omitAttrs = !!omitGroupAttrsEl?.checked;

        if (this._retryEditorPerOptionAttrs && this._retryEditorPerOptionAttrs.length > 0) {
          await this._submitRetryPayload(goodsNo, {
            ...base,
            omitGroupProductAttributes: omitAttrs,
            productAttributesByOption: omitAttrs ? undefined : this._retryEditorPerOptionAttrs.map((row) =>
              (Array.isArray(row) ? row.map((a) => ({ ...a })) : [])
            ),
          });
          return;
        }

        let parsedAttributes = [];
        try {
          parsedAttributes = JSON.parse(attrsEl?.value || '[]');
          if (!Array.isArray(parsedAttributes)) throw new Error('배열이 아닙니다');
        } catch (e) {
          UI.showToast('속성값 JSON 형식이 올바르지 않습니다: ' + e.message, 'error');
          return;
        }

        await this._submitRetryPayload(goodsNo, {
          ...base,
          omitGroupProductAttributes: omitAttrs,
          productAttributes: omitAttrs ? [] : parsedAttributes,
        });
      };
    }

    const perOptBtn = document.getElementById('retry-refill-attrs-per-opt');
    const refillBtn = document.getElementById('retry-refill-attrs');
    const refill1Btn = document.getElementById('retry-refill-attrs-1');
    const refill3Btn = document.getElementById('retry-refill-attrs-3');
    const clearBtn = document.getElementById('retry-clear-attrs');
    let previewTimer = null;
    const schedPreview = () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => this._refreshRetryAttributePreview(), 350);
    };
    if (attrsEl) {
      attrsEl.addEventListener('input', () => {
        this._retryEditorPerOptionAttrs = null;
        schedPreview();
      });
    }
    if (categoryEl) categoryEl.addEventListener('input', schedPreview);

    if (perOptBtn && attrsEl && categoryEl) {
      perOptBtn.onclick = async () => {
        const cat = categoryEl.value.trim();
        if (!cat) {
          UI.showToast('먼저 카테고리 ID를 입력하세요', 'error');
          return;
        }
        const opts = Array.isArray(ctx.options) ? ctx.options : [];
        if (opts.length < 2) {
          UI.showToast('옵션이 1개뿐이면「속성 다시 채우기」를 쓰면 됩니다', 'info');
          return;
        }
        perOptBtn.disabled = true;
        try {
          await API.obtainNaverToken(15);
          const attrData = await API.getCategoryAttributes(cat);
          const builtPer = opts.map((opt) => this.buildProductAttributesFromAttrData(attrData, {
            optionHint: (opt.name || opt.optionName || '').trim(),
          }));
          this._retryEditorPerOptionAttrs = builtPer;
          attrsEl.value = JSON.stringify(builtPer[0] || [], null, 2);
          await this._refreshRetryAttributePreview();
          UI.showToast(`옵션 ${builtPer.length}개 각각 속성 생성(옵션명 매칭). 재시도 시 옵션별로 전송합니다.`, 'success', 3500);
        } catch (e) {
          UI.showToast('속성 조회 실패: ' + String(e.message || e), 'error');
        } finally {
          perOptBtn.disabled = false;
        }
      };
    }

    const runRetryRefill = async (maxPrimary, label) => {
      const cat = categoryEl.value.trim();
      if (!cat) {
        UI.showToast('먼저 카테고리 ID를 입력하세요', 'error');
        return;
      }
      const btns = [refillBtn, refill1Btn, refill3Btn, perOptBtn].filter(Boolean);
      btns.forEach((b) => { b.disabled = true; });
      try {
        await API.obtainNaverToken(15);
        const attrData = await API.getCategoryAttributes(cat);
        const opts = maxPrimary != null ? { maxPrimary } : {};
        this._retryEditorPerOptionAttrs = null;
        const built = this.buildProductAttributesFromAttrData(attrData, opts);
        attrsEl.value = JSON.stringify(built, null, 2);
        await this._refreshRetryAttributePreview();
        UI.showToast(`${label}: 필수 속성 ${built.length}건`, 'success');
      } catch (e) {
        UI.showToast('속성 조회 실패: ' + String(e.message || e), 'error');
      } finally {
        btns.forEach((b) => { b.disabled = false; });
      }
    };

    if (refillBtn && attrsEl && categoryEl) {
      refillBtn.onclick = () => runRetryRefill(null, '전체 필수');
    }
    if (refill1Btn && attrsEl && categoryEl) {
      refill1Btn.onclick = () => runRetryRefill(1, '필수 1개만');
    }
    if (refill3Btn && attrsEl && categoryEl) {
      refill3Btn.onclick = () => runRetryRefill(3, '필수 3개만');
    }
    if (clearBtn && attrsEl) {
      clearBtn.onclick = async () => {
        this._retryEditorPerOptionAttrs = null;
        attrsEl.value = '[]';
        await this._refreshRetryAttributePreview();
        UI.showToast('속성을 비웠습니다 (빈 배열)', 'info', 2000);
      };
    }

    void this._refreshRetryAttributePreview();
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

    const checkedOpts = this.getCheckedOptionsForProduct(goodsNo, allOpts);
    let opts = checkedOpts.length > 0 ? checkedOpts : allOpts.map((o) => ({ ...o }));
    if (opts.length > 0) {
      if (checkedOpts.length > 0) {
        UI.showToast(`선택한 옵션 ${checkedOpts.length}개만 등록합니다`, 'info', 1800);
      }
      opts = await this.showStockPopup(opts, product);
    }
    opts = await this._ensureFreshOptionData(goodsNo, opts, product);
    calc = Margin.calculate(Margin.resolveProductPrice(product, opts), marginRate);

    const optCount = opts.length;
    const settings = Storage.getSettings();
    const oyCategory = `${product.category || ''} ${product.subCategory || ''}`.trim();

    let manualCat = product._naverCategory || Storage.getSavedCategory(oyCategory);
    if (!product._naverCategory) {
      const selectedCategory = await this.openCategorySelector(goodsNo, {
        requireSelection: true,
        title: '등록 전 카테고리 선택',
      });
      if (!selectedCategory?.id) {
        UI.showToast('카테고리 선택이 취소되어 등록을 중단했습니다', 'info');
        return;
      }
      manualCat = selectedCategory;
      product._naverCategory = selectedCategory;
      Storage.updateQueueItem(goodsNo, { _naverCategory: selectedCategory });
    }
    const skipCategoryApi = !!manualCat;

    const steps = [
      { label: skipCategoryApi ? '① 토큰 + 이미지 + 상세설명 (병렬)...' : '① 토큰 + 이미지 + 상세설명 + 카테고리 (병렬)...', status: 'active' },
      { label: '② 이미지 업로드 중...', status: 'pending' },
      { label: `③ 스마트스토어 등록 중... ${optCount > 0 ? `(옵션 ${optCount}개)` : ''}`, status: 'pending' },
    ];
    UI.showProgress(steps, {
      productName: product.name || cleanedBaseName,
      optionNames: opts.map((opt) => (opt.name || opt.optionName || '').trim()).filter(Boolean),
      selectedOnly: checkedOpts.length > 0,
    });
    this.startTimer();

    try {
      this._logProgress('[등록] 시작', {
        goodsNo,
        optionCount: opts.length,
        selectedOnly: checkedOpts.length > 0,
        imgSetting: settings.imgCount || 1,
        marginRate,
      });
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
      const isOptionProduct = opts.length > 1;
      const optionThumbnailList = opts.length > 1
        ? opts.map((o) => this._toHighResImage((o?.image) || product.thumbnail)).filter(Boolean)
        : [];
      const studioRefList = opts.length > 1
        ? opts.map((o) => this._toStudioRefImage((o?.image) || product.thumbnail)).filter(Boolean)
        : [];
      const totalThumbnails = isOptionProduct ? optionThumbnailList.length : 1;
      const genCount = isOptionProduct ? (totalThumbnails + sharedImageCount) : imgCount;
      const primaryThumbnail = optionThumbnailList[0] || this._toHighResImage((opts[0]?.image) || product.thumbnail || '');
      const studioPrimaryRef = studioRefList[0] || this._toStudioRefImage((opts[0]?.image) || product.thumbnail || '');
      this._logProgress('[등록] 이미지 생성 요청', {
        imgCount,
        optionCount: opts.length,
        totalThumbnails,
        sharedImageCount,
        genCount,
        optionImageCount: new Set(optionThumbnailList).size,
      });

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
          thumbnail: studioPrimaryRef || undefined,
          thumbnailList: studioRefList.length > 0 ? studioRefList : undefined,
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
          options: opts,
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
        UI.updateProgressStep(0, 'error', '토큰 발급 실패: ' + this._clipErr(tokenResult.reason?.message || tokenResult.reason, 80));
        this.stopTimer();
        return;
      }

      let imageUrls = [];
      let fallbackImagesCache = null;
      const fetchFallbackImages = async () => {
        if (fallbackImagesCache) return fallbackImagesCache;
        try {
          const fb = await API.getProductImages(goodsNo, product.thumbnail);
          fallbackImagesCache = (fb.success && Array.isArray(fb.images)) ? fb.images : [];
        } catch {
          fallbackImagesCache = [];
        }
        return fallbackImagesCache;
      };
      if (imgResult.status === 'fulfilled' && imgResult.value?.success && imgResult.value?.images?.length > 0) {
        imageUrls = imgResult.value.images;
        const imgErrors = Array.isArray(imgResult.value.errors) ? imgResult.value.errors : [];
        const hasAbortLikeError = imgErrors.some((err) => this._isAbortLikeImageFailure(err));
        this._logProgress('[등록] AI 이미지 응답', {
          requestedJobs: imgResult.value.requestedJobs ?? genCount,
          ranJobs: imgResult.value.ranJobs ?? imgResult.value.images.length,
          returnedImages: imgResult.value.images.length,
          truncated: !!imgResult.value.truncated,
          errors: imgErrors.length,
        }, imgResult.value.images.length < genCount ? 'warn' : 'success');
        if (imgErrors.length > 0) {
          this._logProgress('[등록] AI 이미지 세부 오류', imgErrors, hasAbortLikeError ? 'warn' : 'info');
        }
        if (imgResult.value.truncated) {
          const c = imgResult.value.concurrency != null ? ` (병렬 ${imgResult.value.concurrency})` : '';
          console.warn(
            '[등록] AI 이미지 일부만 생성됨 (Vercel 시간 한도)' + c + '. 요청',
            imgResult.value.requestedJobs,
            '건 →',
            imgResult.value.ranJobs,
            '건. 그룹 옵션 썸네일은 부족 시 첫 장을 공유합니다.'
          );
        }
        if (hasAbortLikeError && imageUrls.length < genCount) {
          throw new Error(
            `AI 이미지 요청은 ${imgResult.value.requestedJobs ?? genCount}건 실행됐지만, 응답이 중간에 끊겨 ${imageUrls.length}장만 회수했습니다. ` +
            '올리브영 이미지로 자동 대체하지 않았습니다. 이미지 장수를 줄이거나 다시 시도해 주세요.'
          );
        }
      } else {
        const imgErr = imgResult.status === 'fulfilled'
          ? (imgResult.value?.error || imgResult.value?.errors?.join?.('; ') || JSON.stringify(imgResult.value || {}).slice(0, 200))
          : String(imgResult.reason?.message || imgResult.reason || 'rejected');
        const abortLike = this._isAbortLikeImageFailure(imgErr) || Boolean(imgResult.value?.noRetry);
        this._logProgress('[등록] AI 이미지 실패', imgErr, abortLike ? 'error' : 'warn');
        if (abortLike) {
          throw new Error(
            'AI 이미지 생성 요청이 중간에 끊겨 결과를 회수하지 못했습니다. ' +
            '이번 시도는 올리브영 이미지로 자동 대체하지 않았습니다. 다시 시도하거나 이미지 장수를 줄여 주세요.'
          );
        }
        console.warn('[등록] AI 이미지 실패, 올리브영 이미지 대체 —', imgErr);
        imageUrls = await fetchFallbackImages();
        if (imageUrls.length === 0 && product.thumbnail) imageUrls.push(product.thumbnail);
      }
      const desiredImageCount = Math.max(1, genCount);
      if (imageUrls.length < desiredImageCount) {
        const merged = [];
        const seen = new Set();
        const pushUnique = (url) => {
          const s = String(url || '').trim();
          if (!s || seen.has(s)) return;
          seen.add(s);
          merged.push(s);
        };

        imageUrls.forEach(pushUnique);
        optionThumbnailList.forEach(pushUnique);
        if (product.thumbnail) {
          pushUnique(this._toHighResImage(product.thumbnail));
          pushUnique(product.thumbnail);
        }
        (await fetchFallbackImages()).forEach(pushUnique);

        const targetCount = Math.max(desiredImageCount, imageUrls.length);
        imageUrls = merged.slice(0, targetCount);

        if (imageUrls.length < desiredImageCount) {
          console.warn('[등록] 이미지가 설정값보다 적습니다. 요청', desiredImageCount, '장 / 확보', imageUrls.length, '장');
          this._logProgress('[등록] 이미지 부족', { requested: desiredImageCount, actual: imageUrls.length }, 'warn');
        } else {
          console.warn('[등록] AI 반환 수가 부족해 올리브영 이미지로 보완했습니다. 요청', desiredImageCount, '장 / 최종', imageUrls.length, '장');
          this._logProgress('[등록] 이미지 보완 완료', { requested: desiredImageCount, actual: imageUrls.length }, 'warn');
        }
      }
      if (imageUrls.length === 0) {
        UI.updateProgressStep(0, 'error', '이미지 없음 — EccoAPI 키를 확인하세요');
        this.stopTimer();
        return;
      }

      if (settings.thumbCropEnabled !== false && imageUrls.length > 0) {
        const cropCount = Math.min(totalThumbnails, imageUrls.length);
        for (let i = 0; i < cropCount; i++) {
          imageUrls[i] = await this._cropImageBorder(imageUrls[i], settings.thumbCropPercent || 6);
        }
      }

      for (let i = 0; i < imageUrls.length; i++) {
        imageUrls[i] = await this._shrinkDataUrlForUpload(imageUrls[i]);
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
      this._logProgress('[등록] 이미지 업로드 결과', {
        requested: imageUrls.length,
        uploaded: uploadedImages.length,
        uploadErrors: Array.isArray(uploadData.errors) ? uploadData.errors.length : 0,
      }, uploadedImages.length < imageUrls.length ? 'warn' : 'success');
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

      const attrs = Array.isArray(attrData.attributes) ? attrData.attributes : [];
      const productAttributes = this.buildProductAttributesFromAttrData(attrData);
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
      if (isOptionProduct) {
        imgsForDetailTop = [
          ...(thumbUploads[0]?.url ? [thumbUploads[0].url] : []),
          ...sharedUploads.map((u) => u.url).filter(Boolean),
        ];
        if (imgsForDetailTop.length === 0 && naverImgUrls.length > 0) {
          imgsForDetailTop = [naverImgUrls[0]];
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

      const useGroupRegister = registrationOptions.length >= 1;
      this._logProgress('[등록] 판매 옵션 요약', registrationOptions.map((o) => ({
        name: (o.name || o.optionName || '').trim(),
        oyPrice: parseInt(o.price || o.finalPrice || o.salePrice || 0, 10) || 0,
        sellingPrice: parseInt(o.sellingPrice || finalSellingPrice || 0, 10) || 0,
        stock: parseInt(o.stockQuantity ?? o.quantity ?? 0, 10) || 0,
      })));
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
        deliveryProfile,
      };

      if (!useGroupRegister && productAttributes.length > 0) {
        regPayload.productAttributes = productAttributes;
      }
      if (useGroupRegister) {
        regPayload.omitGroupProductAttributes = true;
      }

      if (useGroupRegister && registrationOptions.length > 0 && thumbUploads.length > 0) {
        regPayload.optionThumbnailUploads = thumbUploads;
        regPayload.sharedOptionalUploads = sharedUploads;
      }

      let regData;
      let groupFailureInfo = null;
      const mustKeepGroup = this._isGroupRequired(registrationOptions);
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
          groupFailureInfo = {
            error: regData.error,
            invalidInputs: this._extractInvalidInputs(regData),
          };
          console.warn('[등록] 그룹등록 실패 (일반상품으로 자동 전환하지 않음):', reason);
          UI.updateProgressStep(2, 'error', '③ 그룹등록 실패 — 카테고리·판매옵션 가이드를 조정하거나「수동 수정 후 재시도」를 사용하세요');
        }
      } else {
        regData = await API.registerProduct(regPayload);
      }

      this.stopTimer();
      const totalTime = ((Date.now() - this._startTime) / 1000).toFixed(1);
      const isGroup = regData.isGroup === true;

      if (regData.success) {
        if (regData.debug) {
          this._logProgress('[등록] 그룹 응답 디버그', regData.debug);
        }
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
        const errRaw = regData.error ?? regData.message ?? regData;
        const errMsg = this._extractRegisterErrorMessage(errRaw);
        const invalidInputs = this._mergeInvalidInputs(regData, groupFailureInfo);
        if (regData.debug) {
          this._logProgress('[등록] 그룹 실패 디버그', regData.debug, 'warn');
        }
        console.error('[등록 실패 상세]', errRaw);
        if (invalidInputs.length > 0) {
          console.error('[invalidInputs]', JSON.stringify(invalidInputs, null, 2));
        }
        this._saveRetryContext(goodsNo, {
          goodsNo,
          name: registrationName,
          cleanedBaseName,
          categoryId,
          categoryName,
          sellingPrice: finalSellingPrice,
          detailHtml,
          uploadedImages,
          options: registrationOptions,
          stock: defaultStock,
          brand: brandName || product.brand || '',
          oliveyoungCategory: oyCategory,
          sellerTags,
          brandName: brandName || undefined,
          manufacturerName: manufacturerName || undefined,
          productAttributes: regPayload.productAttributes !== undefined
            ? regPayload.productAttributes
            : (!regPayload.productAttributesByOption && productAttributes.length > 0 ? productAttributes : []),
          productAttributesByOption: regPayload.productAttributesByOption,
          deliveryProfile,
          optionThumbnailUploads: regPayload.optionThumbnailUploads || [],
          sharedOptionalUploads: regPayload.sharedOptionalUploads || [],
          useGroupRegister,
          forceNormalRetry: false,
          mustKeepGroup,
          lastError: errMsg,
          invalidInputs,
          groupFailureInfo,
          retryOmitGroupAttrs: true,
        });
        const failStep = groupFailureInfo
          ? `③ 그룹등록 실패 (${totalTime}초): ${this._clipErr(errMsg, 90)} — 「수동 수정 후 재시도」버튼을 눌러 주세요`
          : `등록 실패 (${totalTime}초): ${this._clipErr(errMsg, 100)}`;
        UI.updateProgressStep(2, 'error', failStep);
        this._addCloseButton(totalTime, product.name, false, errMsg, false, {
          goodsNo,
          allowRetry: true,
        });
      }
    } catch (e) {
      this.stopTimer();
      const totalTime = ((Date.now() - this._startTime) / 1000).toFixed(1);
      const outerErr = this._clipErr(e?.message != null ? e.message : e, 200);
      UI.updateProgressStep(0, 'error', '오류: ' + this._clipErr(outerErr, 80));
      this._addCloseButton(totalTime, product.name, false, outerErr, false, {
        goodsNo: typeof goodsNo !== 'undefined' ? goodsNo : '',
        allowRetry: !!goodsNo,
      });
    }
  },

  _addCloseButton(totalTime, productName, success, errMsg, isGroup, actions = {}) {
    const stepsEl = document.getElementById('progress-steps');
    if (!stepsEl) return;
    const groupLabel = isGroup ? ' (그룹상품 — 옵션별 개별 페이지)' : '';
    const msg = success
      ? `<div style="text-align:center;margin:16px 0 8px;color:var(--success);font-weight:600;">등록 완료!${groupLabel} (${totalTime}초)</div>`
      : `<div style="text-align:center;margin:16px 0 8px;color:var(--danger);font-weight:600;">등록 실패 (${totalTime}초)</div>`;
    const retryButton = !success && actions.allowRetry && actions.goodsNo
      ? `<button class="btn btn-outline btn-sm" onclick="Register.openRetryEditor('${String(actions.goodsNo).replace(/'/g, "\\'")}')" style="min-width:150px;">수동 수정 후 재시도</button>`
      : '';
    stepsEl.insertAdjacentHTML('beforeend', `
      ${msg}
      <div style="text-align:center;margin-top:8px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
        ${retryButton}
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
