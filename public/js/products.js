/* Registered Products Page - sync & delete */
const Products = {
  _syncing: false,

  _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  },

  render() {
    const list = Storage.getRegistered();
    const listEl = document.getElementById('products-list');
    const emptyEl = document.getElementById('products-empty');

    if (!listEl || !emptyEl) return;

    if (list.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }

    emptyEl.style.display = 'none';
    listEl.innerHTML = `
      <div class="products-toolbar">
        <span class="products-count">총 ${list.length}개 상품</span>
        <div class="products-toolbar-actions">
          <button type="button" class="btn btn-primary btn-sm" onclick="Products.syncAll()" id="sync-all-btn">
            🔄 전체 재고 동기화
          </button>
          <button type="button" class="btn btn-danger btn-sm" onclick="Products.removeAll()" id="remove-all-btn">
            🗑 전체 목록 삭제
          </button>
        </div>
      </div>
      ${list.map((p, i) => this.renderItem(p, i)).join('')}
    `;
    this.bindRowActions();
  },

  renderItem(product, index) {
    const thumb = this._esc(product.thumbnail || '');
    const name = this._esc(product.name || '');
    const date = product.registeredAt ? new Date(product.registeredAt).toLocaleDateString('ko-KR') : '';
    const productNo = product.productNo || product.naverProductNo || '';
    const goodsNo = product.goodsNo || '';
    const rowId = `reg-row-${index}-${String(productNo || goodsNo || index).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const storeUrl = productNo ? `https://smartstore.naver.com/i/${encodeURIComponent(productNo)}` : '';
    const syncStatus = product.lastSyncAt
      ? `마지막 동기화: ${new Date(product.lastSyncAt).toLocaleString('ko-KR')}`
      : '동기화 안됨';
    const syncClass = product.lastSyncAt ? 'synced' : 'not-synced';
    const optionCount = (product.syncedOptions || []).length;

    const pnAttr = this._esc(productNo);
    const gAttr = this._esc(goodsNo);

    return `
      <div class="registered-item" id="${rowId}">
        <img class="registered-item-img" src="${thumb}" alt="" onerror="this.style.display='none'" />
        <div class="registered-item-info">
          <div class="registered-item-name">${name}</div>
          <div class="registered-item-meta">
            <span>판매가: ${Margin.formatPrice(product.sellingPrice)}</span>
            <span>등록일: ${date}</span>
            ${optionCount > 0 ? `<span>옵션: ${optionCount}개</span>` : ''}
            <span class="sync-status ${syncClass}">${this._esc(syncStatus)}</span>
          </div>
          <div class="registered-item-actions">
            ${storeUrl ? `<a class="btn btn-outline btn-xs" href="${storeUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">스토어 보기 ↗</a>` : ''}
            ${productNo && goodsNo ? `<button type="button" class="btn btn-primary btn-xs oy-btn-sync" data-product-no="${pnAttr}" data-goods-no="${gAttr}">🔄 재고 동기화</button>` : ''}
            ${productNo ? `<button type="button" class="btn btn-danger btn-xs oy-btn-delete" data-product-no="${pnAttr}" title="네이버 판매중지 + 목록 제거">🗑 삭제</button>` : ''}
            <button type="button" class="btn btn-outline btn-xs oy-btn-remove" data-product-no="${pnAttr}" data-goods-no="${gAttr}" title="목록에서만 제거 (네이버 상태 유지)">✕ 목록 제거</button>
          </div>
        </div>
      </div>
    `;
  },

  bindRowActions() {
    const listEl = document.getElementById('products-list');
    if (!listEl || listEl.dataset.bound === '1') return;
    listEl.dataset.bound = '1';
    listEl.addEventListener('click', (e) => {
      const syncEl = e.target.closest('.oy-btn-sync');
      if (syncEl) {
        const pn = syncEl.getAttribute('data-product-no') || '';
        const gn = syncEl.getAttribute('data-goods-no') || '';
        if (pn && gn) this.syncOne(pn, gn);
        return;
      }
      const delEl = e.target.closest('.oy-btn-delete');
      if (delEl) {
        const pn = delEl.getAttribute('data-product-no') || '';
        if (pn) this.deleteProduct(pn);
        return;
      }
      const removeEl = e.target.closest('.oy-btn-remove');
      if (removeEl) {
        const pn = removeEl.getAttribute('data-product-no') || '';
        const gn = removeEl.getAttribute('data-goods-no') || '';
        if (pn) this.removeFromList(pn);
        else if (gn) this.removeFromListByGoodsNo(gn);
        return;
      }
    });
  },

  removeFromList(productNo) {
    if (!productNo) return;
    const row = Storage.getRegistered().find((p) => (p.productNo || p.naverProductNo) === productNo);
    const label = (row?.name || productNo).substring(0, 40);
    if (!confirm(`"${label}..." 을(를) 목록에서 제거하시겠습니까?\n\n※ 네이버 스마트스토어에서는 삭제되지 않습니다.\n   (스토어 상품은 그대로 유지됩니다)`)) return;

    Storage.removeRegistered(productNo);
    this.render();
    UI.showToast('목록에서 제거됨', 'info');
  },

  removeFromListByGoodsNo(goodsNo) {
    if (!goodsNo) return;
    const row = Storage.getRegistered().find((p) => p.goodsNo === goodsNo);
    const label = (row?.name || goodsNo).substring(0, 40);
    if (!confirm(`"${label}..." 을(를) 목록에서 제거하시겠습니까?\n\n※ 네이버 스마트스토어에서는 삭제되지 않습니다.`)) return;

    const next = Storage.getRegistered().filter((p) => p.goodsNo !== goodsNo);
    Storage.set(Storage.KEYS.REGISTERED, next);
    this.render();
    UI.showToast('목록에서 제거됨', 'info');
  },

  removeAll() {
    const list = Storage.getRegistered();
    if (list.length === 0) return UI.showToast('삭제할 상품이 없습니다', 'info');

    if (!confirm(`등록된 상품 ${list.length}개를 모두 목록에서 제거하시겠습니까?\n\n※ 네이버 스마트스토어 상품은 삭제되지 않습니다.\n   (스토어 상품은 그대로 유지됩니다)`)) return;

    Storage.set(Storage.KEYS.REGISTERED, []);
    this.render();
    UI.showToast(`${list.length}개 상품 목록에서 제거됨`, 'success');
  },

  async deleteProduct(productNo) {
    if (!productNo) return;
    const row = Storage.getRegistered().find((p) => (p.productNo || p.naverProductNo) === productNo);
    const label = (row?.name || productNo).substring(0, 40);
    if (!confirm(`"${label}..." 상품을 삭제하시겠습니까?\n\n• 네이버 스마트스토어에서 판매중지 처리\n• 등록 목록에서 제거`)) return;

    UI.showToast('상품 삭제 중...', 'info', 2000);

    try {
      await API.obtainNaverToken();
      const result = await API.deleteNaverProduct(productNo);

      if (result.success) {
        Storage.removeRegistered(productNo);
        this.render();
        UI.showToast('삭제 완료 (판매중지)', 'success');
      } else {
        const errMsg = String(result.data?.message || result.error || result.data?.errorMessage || '삭제 실패');
        if (errMsg.includes('NOT_FOUND') || errMsg.includes('찾을 수 없')) {
          Storage.removeRegistered(productNo);
          this.render();
          UI.showToast('로컬에서 제거됨 (네이버에 해당 상품 없음)', 'info');
        } else {
          UI.showToast(`삭제 실패: ${errMsg.substring(0, 80)}`, 'error');
        }
      }
    } catch (e) {
      UI.showToast('삭제 에러: ' + String(e.message).substring(0, 60), 'error');
    }
  },

  async syncOne(productNo, goodsNo) {
    if (!productNo || !goodsNo) {
      UI.showToast('상품 정보가 부족합니다', 'error');
      return false;
    }

    const btn = document.querySelector(`.oy-btn-sync[data-product-no="${CSS.escape(productNo)}"]`);
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 동기화 중...'; }

    try {
      await API.obtainNaverToken();

      const naverDetail = await API.getNaverProductDetail(productNo);
      if (!naverDetail.success) {
        throw new Error(naverDetail.data?.message || naverDetail.error || '네이버 상품 조회 실패');
      }

      const originProduct = naverDetail.data?.originProduct || naverDetail.data || {};
      const optInfo = originProduct.detailAttribute?.optionInfo || {};
      const naverCombos = optInfo.optionCombinations || [];

      if (naverCombos.length === 0) {
        UI.showToast('옵션 없는 상품 — 재고 동기화 불필요', 'info');
        Storage.updateRegistered(productNo, { lastSyncAt: Date.now(), syncedOptions: [] });
        this.render();
        return true;
      }

      let oyOptions = [];
      try {
        const optData = await API.getProductOptions(goodsNo);
        if (optData.success && optData.options?.length > 0) {
          oyOptions = optData.options;
        }
      } catch { /* 서버 API 실패 */ }

      if (oyOptions.length === 0) {
        try {
          oyOptions = await this._fetchOptionsViaExtension(goodsNo);
        } catch {
          UI.showToast('올리브영 옵션 가져오기 실패 — 크롬 확장 확인', 'error');
          return false;
        }
      }

      if (oyOptions.length === 0) {
        UI.showToast('올리브영에서 옵션을 가져올 수 없습니다', 'error');
        return false;
      }

      const updatedCombos = this._matchAndUpdateOptions(naverCombos, oyOptions);

      if (updatedCombos.length === 0) {
        UI.showToast('매칭 가능한 옵션이 없습니다', 'error');
        return false;
      }

      const syncResult = await API.syncOptionStock({
        productNo,
        optionCombinations: updatedCombos,
      });

      if (syncResult.success) {
        Storage.updateRegistered(productNo, {
          lastSyncAt: Date.now(),
          syncedOptions: updatedCombos.map((c) => ({
            name: c.optionName1,
            stock: c.stockQuantity,
            usable: c.usable,
          })),
        });
        this.render();
        const soldOutCount = updatedCombos.filter((c) => !c.usable).length;
        UI.showToast(`재고 동기화 완료! ${updatedCombos.length}개 옵션 (품절 ${soldOutCount}개)`, 'success');
        return true;
      }
      const errMsg = String(syncResult.data?.message || syncResult.error || '동기화 실패');
      UI.showToast(`동기화 실패: ${errMsg.substring(0, 80)}`, 'error');
      return false;
    } catch (e) {
      UI.showToast('동기화 에러: ' + String(e.message).substring(0, 60), 'error');
      return false;
    } finally {
      const b = document.querySelector(`.oy-btn-sync[data-product-no="${CSS.escape(productNo)}"]`);
      if (b) { b.disabled = false; b.textContent = '🔄 재고 동기화'; }
    }
  },

  _matchAndUpdateOptions(naverCombos, oyOptions) {
    return naverCombos.map((combo) => {
      const naverName = (combo.optionName1 || '').trim().toLowerCase();

      let matched = oyOptions.find((oy) => {
        const oyName = (oy.name || oy.optionName || '').trim().toLowerCase();
        return oyName === naverName;
      });

      if (!matched) {
        matched = oyOptions.find((oy) => {
          const oyName = (oy.name || oy.optionName || '').trim().toLowerCase();
          return naverName.includes(oyName) || oyName.includes(naverName);
        });
      }

      if (matched) {
        const stock = parseInt(matched.quantity || matched.stockQuantity || 0, 10);
        const soldOut = matched.soldOut === true || matched.soldOutFlag === 'Y' || stock <= 0;
        return {
          id: combo.id,
          optionName1: combo.optionName1,
          stockQuantity: soldOut ? 0 : Math.min(stock, 999),
          price: combo.price || 0,
          usable: !soldOut,
        };
      }

      return {
        id: combo.id,
        optionName1: combo.optionName1,
        stockQuantity: combo.stockQuantity || 0,
        price: combo.price || 0,
        usable: combo.usable !== false,
      };
    });
  },

  _fetchOptionsViaExtension(goodsNo) {
    return new Promise((resolve, reject) => {
      const url = `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${encodeURIComponent(goodsNo)}&autoFetch=true`;
      const popup = window.open(url, 'oy_sync_' + goodsNo, 'width=800,height=600');

      let checkClosed = null;

      const cleanup = () => {
        if (checkClosed) clearInterval(checkClosed);
        checkClosed = null;
      };

      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler);
        cleanup();
        if (popup && !popup.closed) popup.close();
        reject(new Error('옵션 가져오기 시간 초과 (15초)'));
      }, 15000);

      function handler(event) {
        if (event.origin !== 'https://www.oliveyoung.co.kr') return;
        const data = event.data;
        if (data && data.type === 'oy-options-result' && data.goodsNo === goodsNo) {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          cleanup();
          if (popup && !popup.closed) popup.close();
          if (data.success && data.options?.length > 0) {
            resolve(data.options);
          } else {
            reject(new Error(data.error || '옵션 없음'));
          }
        }
      }

      window.addEventListener('message', handler);

      checkClosed = setInterval(() => {
        if (popup && popup.closed) {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          cleanup();
          reject(new Error('팝업이 닫힘'));
        }
      }, 1000);
    });
  },

  async syncAll() {
    if (this._syncing) return UI.showToast('이미 동기화 중입니다', 'info');
    this._syncing = true;

    const list = Storage.getRegistered();
    if (list.length === 0) {
      this._syncing = false;
      return UI.showToast('등록된 상품이 없습니다', 'info');
    }

    const syncBtn = document.getElementById('sync-all-btn');
    if (syncBtn) { syncBtn.disabled = true; syncBtn.textContent = '동기화 중... (0/' + list.length + ')'; }

    let successCount = 0;
    let failCount = 0;

    try {
      await API.obtainNaverToken();
    } catch (e) {
      UI.showToast('토큰 발급 실패: ' + e.message, 'error');
      this._syncing = false;
      if (syncBtn) { syncBtn.disabled = false; syncBtn.textContent = '🔄 전체 재고 동기화'; }
      return;
    }

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const productNo = p.productNo || p.naverProductNo;
      const goodsNo = p.goodsNo;
      if (syncBtn) syncBtn.textContent = `동기화 중... (${i + 1}/${list.length})`;

      if (!productNo || !goodsNo) {
        failCount++;
      } else {
        const ok = await this.syncOne(productNo, goodsNo);
        if (ok) successCount++;
        else failCount++;
      }

      if (i < list.length - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    this._syncing = false;
    if (syncBtn) { syncBtn.disabled = false; syncBtn.textContent = '🔄 전체 재고 동기화'; }
    this.render();
    UI.showToast(`전체 동기화 완료! 성공 ${successCount}개, 실패 ${failCount}개`, successCount > 0 ? 'success' : 'error');
  },
};
