/* Registered Products Page — checkbox select + sync + delete */
const Products = {
  _syncing: false,
  SYNC_CONCURRENCY: 3,

  _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  },

  _normalizeOptionKey(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[\[\]\(\)\{\}\/+,&._-]/g, '');
  },

  _matchProductNo(record, productNo) {
    const target = String(productNo || '').trim();
    if (!target) return false;

    const topLevelCandidates = [
      record?.productNo,
      record?.naverProductNo,
      record?.groupProductNo,
      record?.channelProductNo,
    ];
    if (topLevelCandidates.some((candidate) => String(candidate || '').trim() === target)) {
      return true;
    }

    const productEntries = Array.isArray(record?.productNos) ? record.productNos : [];
    return productEntries.some((entry) => {
      const entryCandidates = [
        entry?.originProductNo,
        entry?.productNo,
        entry?.naverProductNo,
        entry?.smartstoreChannelProductNo,
        entry?.channelProductNo,
      ];
      return entryCandidates.some((candidate) => String(candidate || '').trim() === target);
    });
  },

  _findRegistered(productNo) {
    return Storage.getRegistered().find((record) => this._matchProductNo(record, productNo)) || null;
  },

  _isGroupRecord(record) {
    const groupFlag = record?.isGroup;
    if (groupFlag === true || groupFlag === 'true' || groupFlag === 'Y' || groupFlag === 'y' || groupFlag === 1 || groupFlag === '1') {
      return true;
    }

    if (Array.isArray(record?.productNos) && record.productNos.length > 0) {
      return true;
    }

    return Boolean(record?.requestId || record?.groupProductNo);
  },

  _getRecordKey(record, fallbackProductNo = '') {
    return String(record?.productNo || record?.naverProductNo || fallbackProductNo || '').trim();
  },

  _hasUsableGroupEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    return Boolean(
      entry.originProductNo ||
      entry.productNo ||
      entry.naverProductNo ||
      entry.smartstoreChannelProductNo ||
      entry.channelProductNo
    );
  },

  async _ensureGroupProductEntries(record, fallbackProductNo = '') {
    const currentEntries = Array.isArray(record?.productNos) ? record.productNos.filter(Boolean) : [];
    const requestId = String(record?.requestId || '').trim();
    const needsRecovery = currentEntries.length === 0 || currentEntries.some((entry) => !this._hasUsableGroupEntry(entry) || !entry?.originProductNo);

    if (!needsRecovery) {
      return { ...record, productNos: currentEntries };
    }

    if (!requestId) {
      return { ...record, productNos: [] };
    }

    try {
      const statusResult = await API.getGroupStatus(requestId);
      const recoveredEntries = Array.isArray(statusResult?.data?.productNos)
        ? statusResult.data.productNos.filter(Boolean)
        : [];

      if (recoveredEntries.length === 0) {
        return { ...record, productNos: [] };
      }

      const previousOptions = Array.isArray(record?.syncedOptions) ? record.syncedOptions : [];
      const mergedEntries = recoveredEntries.map((entry, index) => {
        const currentEntry = currentEntries[index] || {};
        const previousOption = previousOptions[index] || {};
        const parsedStock = parseInt(
          entry?.stockQuantity ?? currentEntry?.stockQuantity ?? previousOption?.stock ?? 0,
          10
        );
        const stockQuantity = Number.isFinite(parsedStock) ? Math.max(0, parsedStock) : 0;
        const usable = currentEntry?.usable !== undefined
          ? currentEntry.usable
          : (
              previousOption?.usable !== undefined
                ? previousOption.usable
                : (entry?.usable !== undefined ? entry.usable : stockQuantity > 0)
            );

        return {
          ...currentEntry,
          ...entry,
          optionName: entry?.optionName || currentEntry?.optionName || previousOption?.name || '',
          optionNumber: entry?.optionNumber || currentEntry?.optionNumber || previousOption?.optionNumber || '',
          stockQuantity,
          usable,
        };
      });

      const mergedRecord = {
        ...record,
        isGroup: true,
        groupProductNo: statusResult?.data?.groupProductNo || record?.groupProductNo || '',
        productNos: mergedEntries,
      };

      const recordKey = this._getRecordKey(record, fallbackProductNo) || mergedEntries[0]?.originProductNo || '';
      if (recordKey) {
        Storage.updateRegistered(recordKey, {
          isGroup: true,
          groupProductNo: mergedRecord.groupProductNo,
          requestId,
          productNos: mergedEntries,
        });
      }

      return mergedRecord;
    } catch (error) {
      console.warn('[sync] group record recovery failed:', error?.message || error);
      return { ...record, productNos: [] };
    }
  },

  _getOptionStock(option) {
    const raw = option?.quantity ?? option?.stockQuantity ?? 0;
    const stock = parseInt(raw, 10);
    return Number.isFinite(stock) ? stock : 0;
  },

  _isSoldOutOption(option) {
    const flag = option?.soldOutFlag;
    return option?.soldOut === true || flag === true || flag === 'Y' || flag === 'true' || this._getOptionStock(option) <= 0;
  },

  _findMatchedOption(targetName, oyOptions, indexHint = -1) {
    const normalizedTarget = this._normalizeOptionKey(targetName);
    if (normalizedTarget) {
      let matched = oyOptions.find((oy) => this._normalizeOptionKey(oy.name || oy.optionName) === normalizedTarget);
      if (matched) return matched;

      matched = oyOptions.find((oy) => {
        const normalized = this._normalizeOptionKey(oy.name || oy.optionName);
        return normalized && (normalized.includes(normalizedTarget) || normalizedTarget.includes(normalized));
      });
      if (matched) return matched;
    }

    if (indexHint >= 0 && indexHint < oyOptions.length) {
      return oyOptions[indexHint];
    }
    return null;
  },

  async _getOliveYoungOptions(goodsNo, preferExtension = false, allowExtension = true) {
    const fetchers = preferExtension
      ? [
          ...(allowExtension ? [() => this._fetchOptionsViaExtension(goodsNo)] : []),
          async () => {
            const data = await API.getProductOptions(goodsNo);
            return (data.success && data.options?.length > 0) ? data.options : [];
          },
        ]
      : [
          async () => {
            const data = await API.getProductOptions(goodsNo);
            return (data.success && data.options?.length > 0) ? data.options : [];
          },
          ...(allowExtension ? [() => this._fetchOptionsViaExtension(goodsNo)] : []),
        ];

    let lastError = null;
    for (const fetcher of fetchers) {
      try {
        const options = await fetcher();
        if (Array.isArray(options) && options.length > 0) return options;
      } catch (e) {
        lastError = e;
      }
    }
    if (lastError) throw lastError;
    return [];
  },

  async _syncGroupProduct(record, oyOptions) {
    const productEntries = Array.isArray(record?.productNos) ? record.productNos : [];
    if (productEntries.length === 0) {
      return { success: false, updatedCount: 0, failedCount: 0, syncedOptions: [], error: '그룹상품 항목 정보가 없습니다' };
    }

    const updates = productEntries.map((entry, index) => {
      const productNo = entry.originProductNo || entry.productNo || entry.naverProductNo || '';
      const optionName = entry.optionName || entry.name || entry.optionName1 || record?.syncedOptions?.[index]?.name || '';
      const matched = this._findMatchedOption(optionName, oyOptions, index);
      if (!productNo || !matched) return null;

      const stock = this._getOptionStock(matched);
      const soldOut = this._isSoldOutOption(matched);
      const stockQuantity = soldOut ? 0 : Math.min(stock, 999);

      return {
        index,
        productNo,
        optionName: optionName || matched.name || matched.optionName || `옵션${index + 1}`,
        optionNumber: matched.optionNumber || entry.optionNumber || '',
        stockQuantity,
        usable: !soldOut,
        statusType: soldOut ? 'OUTOFSTOCK' : 'SALE',
      };
    }).filter(Boolean);

    if (updates.length === 0) {
      return { success: false, updatedCount: 0, failedCount: 0, syncedOptions: [], error: '그룹상품 옵션 매칭 실패' };
    }

    let groupProductNo = String(record?.groupProductNo || '').trim();
    if (!groupProductNo) {
      const fallbackProductNo = updates[0]?.productNo || this._getRecordKey(record);
      if (fallbackProductNo) {
        const detailResult = await API.getNaverProductDetail(fallbackProductNo);
        if (detailResult?.success) {
          groupProductNo = String(detailResult.data?.groupProduct?.groupProductNo || '').trim();
        }
      }
    }

    if (!groupProductNo) {
      return { success: false, updatedCount: 0, failedCount: updates.length, syncedOptions: [], error: '그룹상품 번호를 찾을 수 없습니다' };
    }

    const groupDetailResult = await API.getNaverGroupProduct(groupProductNo);
    const currentGroup = groupDetailResult?.data?.groupProduct || groupDetailResult?.data || null;
    const currentSpecificProducts = Array.isArray(currentGroup?.specificProducts) ? currentGroup.specificProducts : [];

    if (!groupDetailResult?.success || !currentGroup || currentSpecificProducts.length === 0) {
      return {
        success: false,
        updatedCount: 0,
        failedCount: updates.length,
        syncedOptions: [],
        error: String(groupDetailResult?.data?.message || groupDetailResult?.error || '그룹상품 조회 실패'),
      };
    }

    const updateMap = new Map(updates.map((item) => [String(item.productNo), item]));
    let matchedCount = 0;
    const nextSpecificProducts = currentSpecificProducts.map((specific, index) => {
      const candidates = [
        specific?.originProductNo,
        productEntries[index]?.originProductNo,
        productEntries[index]?.productNo,
        productEntries[index]?.naverProductNo,
      ].filter(Boolean).map((value) => String(value));

      const matchedUpdate = candidates.map((candidate) => updateMap.get(candidate)).find(Boolean);
      if (!matchedUpdate) {
        return specific;
      }

      matchedCount += 1;
      return {
        ...specific,
        stockQuantity: matchedUpdate.stockQuantity,
      };
    });

    if (matchedCount === 0) {
      return { success: false, updatedCount: 0, failedCount: updates.length, syncedOptions: [], error: '그룹상품 상세 옵션 매칭 실패' };
    }

    const groupUpdateResult = await API.updateNaverGroupProduct({
      groupProductNo,
      groupProduct: {
        ...currentGroup,
        specificProducts: nextSpecificProducts,
      },
    });

    if (!groupUpdateResult?.success) {
      return {
        success: false,
        updatedCount: 0,
        failedCount: updates.length,
        syncedOptions: [],
        error: String(groupUpdateResult?.error || groupUpdateResult?.data?.message || '그룹상품 수정 실패'),
      };
    }

    const syncedOptions = [];
    const mergedProductNos = productEntries.map((entry, index) => ({ ...entry }));

    updates.forEach((item) => {
      syncedOptions.push({
        name: item.optionName,
        stock: item.stockQuantity,
        usable: item.usable,
      });
      mergedProductNos[item.index] = {
        ...mergedProductNos[item.index],
        optionName: item.optionName,
        optionNumber: item.optionNumber,
        stockQuantity: item.stockQuantity,
        usable: item.usable,
      };
    });

    const returnedProductNos = Array.isArray(groupUpdateResult?.productNos) ? groupUpdateResult.productNos : [];
    returnedProductNos.forEach((returned) => {
      const targetIndex = mergedProductNos.findIndex((entry) => {
        return String(entry?.originProductNo || entry?.productNo || entry?.naverProductNo || '') === String(returned?.originProductNo || '');
      });

      if (targetIndex >= 0) {
        mergedProductNos[targetIndex] = {
          ...mergedProductNos[targetIndex],
          originProductNo: returned.originProductNo || mergedProductNos[targetIndex].originProductNo || '',
          smartstoreChannelProductNo: returned.smartstoreChannelProductNo || mergedProductNos[targetIndex].smartstoreChannelProductNo || '',
        };
      }
    });

    return {
      success: true,
      updatedCount: syncedOptions.length,
      failedCount: 0,
      syncedOptions,
      productNos: mergedProductNos,
      groupProductNo,
      error: '',
    };
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
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;">
          <input type="checkbox" id="products-select-all" onchange="Products.toggleAll(this.checked)" />
          전체 선택
        </label>
        <span class="products-count">총 ${list.length}개 상품</span>
        <div class="products-toolbar-actions">
          <button type="button" class="btn btn-primary btn-sm" onclick="Products.syncSelected()" id="sync-selected-btn">동기화 중... (0/0)</button>
          <button type="button" class="btn btn-danger btn-sm" onclick="Products.removeSelected()" id="remove-selected-btn">선택 삭제</button>
        </div>
      </div>
      ${list.map((p, i) => this.renderItem(p, i)).join('')}
    `;
    this.bindRowActions();
    this._updateSyncBtn();
  },

  renderItem(product, index) {
    const thumb = this._esc(product.thumbnail || '');
    const name = this._esc(product.name || '');
    const date = product.registeredAt ? new Date(product.registeredAt).toLocaleDateString('ko-KR') : '';
    const productNo = product.productNo || product.naverProductNo || '';
    const channelNo = product.channelProductNo || productNo;
    const goodsNo = product.goodsNo || '';
    const settings = Storage.getSettings();
    const storeName = settings.storeName || '';
    const storeUrl = channelNo && storeName
      ? `https://smartstore.naver.com/${encodeURIComponent(storeName)}/products/${encodeURIComponent(channelNo)}`
      : channelNo
        ? `https://smartstore.naver.com/i/${encodeURIComponent(channelNo)}`
        : '';
    const syncStatus = product.lastSyncAt
      ? `동기화: ${new Date(product.lastSyncAt).toLocaleString('ko-KR')}`
      : '';
    const syncClass = product.lastSyncAt ? 'synced' : 'not-synced';
    const optionCount = (product.syncedOptions || []).length || (product.productNos || []).length;
    const pnAttr = this._esc(productNo);
    const gAttr = this._esc(goodsNo);

    return `
      <div class="registered-item" data-idx="${index}">
        <input type="checkbox" class="product-checkbox" data-idx="${index}" style="flex-shrink:0;width:18px;height:18px;cursor:pointer;margin-right:8px;" />
        <img class="registered-item-img" src="${thumb}" alt="" onerror="this.style.display='none'" />
        <div class="registered-item-info">
          <div class="registered-item-name">${name}</div>
          <div class="registered-item-meta">
            <span>판매가: ${Margin.formatPrice(product.sellingPrice)}</span>
            <span>등록일: ${date}</span>
            ${this._isGroupRecord(product) ? '<span style="color:#6366f1;font-weight:600;">그룹상품</span>' : ''}
            ${optionCount > 0 ? `<span>옵션: ${optionCount}개</span>` : ''}
            ${syncStatus ? `<span class="sync-status ${syncClass}">${this._esc(syncStatus)}</span>` : ''}
          </div>
          <div class="registered-item-actions">
            ${storeUrl ? `<a class="btn btn-outline btn-xs" href="${storeUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">스토어 보기 ↗</a>` : ''}
            ${productNo && goodsNo ? `<button type="button" class="btn btn-primary btn-xs oy-btn-sync" data-product-no="${pnAttr}" data-goods-no="${gAttr}">재고 동기화</button>` : ''}
            ${productNo ? `<button type="button" class="btn btn-danger btn-xs oy-btn-delete" data-product-no="${pnAttr}" title="네이버 판매중지 + 목록 제거">삭제</button>` : ''}
          </div>
        </div>
      </div>
    `;
  },

  toggleAll(checked) {
    document.querySelectorAll('.product-checkbox').forEach((cb) => { cb.checked = checked; });
    this._updateSyncBtn();
  },

  _updateSyncBtn() {
    const btn = document.getElementById('sync-selected-btn');
    if (!btn) return;
    const count = this.getSelectedIndices().length;
    const total = Storage.getRegistered().length;
    if (count > 0) {
      btn.textContent = `선택 동기화 (${count}개)`;
    } else {
      btn.textContent = `동기화 (전체 ${total}개)`;
    }
  },

  getSelectedIndices() {
    const indices = [];
    document.querySelectorAll('.product-checkbox:checked').forEach((cb) => {
      indices.push(parseInt(cb.dataset.idx, 10));
    });
    return indices;
  },

  removeSelected() {
    const indices = this.getSelectedIndices();
    if (indices.length === 0) return UI.showToast('삭제할 상품을 선택하세요', 'info');

    if (!confirm(`선택한 ${indices.length}개 상품을 목록에서 제거하시겠습니까?\n\n※ 네이버 스마트스토어 상품은 삭제되지 않습니다.`)) return;

    const list = Storage.getRegistered();
    const remaining = list.filter((_, i) => !indices.includes(i));
    Storage.set(Storage.KEYS.REGISTERED, remaining);
    this.render();
    UI.showToast(`${indices.length}개 상품 목록에서 제거됨`, 'success');
  },

  bindRowActions() {
    const listEl = document.getElementById('products-list');
    if (!listEl || listEl.dataset.bound === '1') return;
    listEl.dataset.bound = '1';
    listEl.addEventListener('change', (e) => {
      if (e.target.classList.contains('product-checkbox') || e.target.id === 'products-select-all') {
        this._updateSyncBtn();
      }
    });
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
    });
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
        if (errMsg.includes('NOT_FOUND') || errMsg.includes('찾을 수 없') || errMsg.includes('존재하지 않는')) {
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

  async syncOne(productNo, goodsNo, options = {}) {
    if (!productNo || !goodsNo) {
      if (!options.silent) UI.showToast('상품 정보가 부족합니다', 'error');
      return false;
    }

    const record = this._findRegistered(productNo);
    const recordKey = this._getRecordKey(record, productNo);
    const isGroupProduct = this._isGroupRecord(record);
    const btn = document.querySelector(`.oy-btn-sync[data-product-no="${CSS.escape(productNo)}"]`);
    if (btn) { btn.disabled = true; btn.textContent = '동기화 중...'; }

    try {
      if (!options.skipToken) {
        await API.obtainNaverToken();
      }

      if (isGroupProduct) {
        const hydratedRecord = await this._ensureGroupProductEntries(record, productNo);
        if (!Array.isArray(hydratedRecord.productNos) || hydratedRecord.productNos.length === 0) {
          if (!options.silent) UI.showToast('그룹상품 옵션 정보를 복구하지 못했습니다. 다시 등록이 필요할 수 있습니다', 'error');
          return false;
        }

        const oyOptions = await this._getOliveYoungOptions(goodsNo, !options.silent, !options.silent);
        if (oyOptions.length === 0) {
          if (!options.silent) UI.showToast('올리브영에서 옵션을 가져올 수 없습니다', 'error');
          return false;
        }

        const groupResult = await this._syncGroupProduct(hydratedRecord, oyOptions);
        if (groupResult.updatedCount > 0) {
          Storage.updateRegistered(recordKey, {
            lastSyncAt: Date.now(),
            syncedOptions: groupResult.syncedOptions,
            productNos: groupResult.productNos || hydratedRecord.productNos,
            isGroup: true,
            requestId: hydratedRecord.requestId || '',
            groupProductNo: groupResult.groupProductNo || hydratedRecord.groupProductNo || '',
          });
          this.render();
        }

        if (!groupResult.success) {
          if (!options.silent) {
            UI.showToast(`그룹상품 동기화 실패: ${String(groupResult.error || '일부 옵션 실패').substring(0, 80)}`, 'error');
          }
          return false;
        }

        if (!options.silent) {
          const soldOutCount = groupResult.syncedOptions.filter((c) => !c.usable).length;
          UI.showToast(`그룹상품 동기화 완료! ${groupResult.updatedCount}개 옵션 (품절 ${soldOutCount}개)`, 'success');
        }
        return true;
      }

      const naverDetail = await API.getNaverProductDetail(productNo);
      if (!naverDetail.success) {
        const errMsg = String(naverDetail.data?.message || naverDetail.error || '');
        if (naverDetail.status === 404 || errMsg.includes('NOT_FOUND') || errMsg.includes('존재하지 않')) {
          if (!options.silent) UI.showToast(`동기화 에러: 존재하지 않는 상품입니다. (${productNo})`, 'error');
          return false;
        }
        throw new Error(errMsg || '네이버 상품 조회 실패');
      }

      const originProduct = naverDetail.data?.originProduct || naverDetail.data || {};
      const optInfo = originProduct.detailAttribute?.optionInfo || {};
      const naverCombos = optInfo.optionCombinations || [];

      if (naverCombos.length === 0) {
        if (!options.silent) UI.showToast('옵션 없는 상품 — 재고 동기화 불필요', 'info');
        Storage.updateRegistered(recordKey, { lastSyncAt: Date.now(), syncedOptions: [] });
        this.render();
        return true;
      }

      const oyOptions = await this._getOliveYoungOptions(goodsNo, false, !options.silent);
      if (oyOptions.length === 0) {
        if (!options.silent) UI.showToast('올리브영에서 옵션을 가져올 수 없습니다', 'error');
        return false;
      }

      const updatedCombos = this._matchAndUpdateOptions(naverCombos, oyOptions);
      if (updatedCombos.length === 0) {
        if (!options.silent) UI.showToast('매칭 가능한 옵션이 없습니다', 'error');
        return false;
      }

      const syncResult = await API.syncOptionStock({ productNo, optionCombinations: updatedCombos });
      if (syncResult.success) {
        Storage.updateRegistered(recordKey, {
          lastSyncAt: Date.now(),
          syncedOptions: updatedCombos.map((c) => ({ name: c.optionName1, stock: c.stockQuantity, usable: c.usable })),
        });
        this.render();
        if (!options.silent) {
          const soldOutCount = updatedCombos.filter((c) => !c.usable).length;
          UI.showToast(`동기화 완료! ${updatedCombos.length}개 옵션 (품절 ${soldOutCount}개)`, 'success');
        }
        return true;
      }
      const errMsg = String(syncResult.data?.message || syncResult.error || '동기화 실패');
      if (!options.silent) UI.showToast(`동기화 실패: ${errMsg.substring(0, 80)}`, 'error');
      return false;
    } catch (e) {
      if (!options.silent) UI.showToast('동기화 에러: ' + String(e.message).substring(0, 60), 'error');
      return false;
    } finally {
      const b = document.querySelector(`.oy-btn-sync[data-product-no="${CSS.escape(productNo)}"]`);
      if (b) { b.disabled = false; b.textContent = '재고 동기화'; }
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
        const stock = this._getOptionStock(matched);
        const soldOut = this._isSoldOutOption(matched);
        return { id: combo.id, optionName1: combo.optionName1, stockQuantity: soldOut ? 0 : Math.min(stock, 999), price: combo.price || 0, usable: !soldOut };
      }
      return { id: combo.id, optionName1: combo.optionName1, stockQuantity: combo.stockQuantity || 0, price: combo.price || 0, usable: combo.usable !== false };
    });
  },

  _fetchOptionsViaExtension(goodsNo) {
    return new Promise((resolve, reject) => {
      const url = `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${encodeURIComponent(goodsNo)}&autoFetch=true`;
      const popup = window.open(url, 'oy_sync_' + goodsNo, 'width=800,height=600');
      let checkClosed = null;
      const cleanup = () => { if (checkClosed) clearInterval(checkClosed); checkClosed = null; };

      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler);
        cleanup();
        if (popup && !popup.closed) popup.close();
        reject(new Error('시간 초과 (15초)'));
      }, 15000);

      function handler(event) {
        if (event.origin !== 'https://www.oliveyoung.co.kr') return;
        const data = event.data;
        if (data && data.type === 'oy-options-result' && data.goodsNo === goodsNo) {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          cleanup();
          if (popup && !popup.closed) popup.close();
          if (data.success && data.options?.length > 0) resolve(data.options);
          else reject(new Error(data.error || '옵션 없음'));
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

  async syncSelected() {
    if (this._syncing) return UI.showToast('이미 동기화 중입니다', 'info');
    this._syncing = true;

    const allList = Storage.getRegistered();
    if (allList.length === 0) { this._syncing = false; return UI.showToast('등록된 상품이 없습니다', 'info'); }

    const selectedIdx = this.getSelectedIndices();
    const targets = selectedIdx.length > 0
      ? selectedIdx.map(i => allList[i]).filter(Boolean)
      : allList;
    const label = selectedIdx.length > 0 ? `선택 ${targets.length}개` : `전체 ${targets.length}개`;

    if (targets.length === 0) { this._syncing = false; return UI.showToast('동기화할 상품이 없습니다', 'info'); }

    const syncBtn = document.getElementById('sync-selected-btn');
    if (syncBtn) { syncBtn.disabled = true; syncBtn.textContent = `동기화 중... (0/${targets.length})`; }

    let successCount = 0;
    let failCount = 0;

    try {
      await API.obtainNaverToken();
    } catch (e) {
      UI.showToast('토큰 실패: ' + e.message, 'error');
      this._syncing = false;
      if (syncBtn) { syncBtn.disabled = false; }
      this._updateSyncBtn();
      return;
    }

    const concurrency = Math.max(1, Math.min(this.SYNC_CONCURRENCY, targets.length));
    let completed = 0;
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        const current = nextIndex;
        nextIndex += 1;
        if (current >= targets.length) return;

        const p = targets[current];
        const productNo = p.productNo || p.naverProductNo;
        const goodsNo = p.goodsNo;

        let ok = false;
        if (productNo && goodsNo) {
          ok = await this.syncOne(productNo, goodsNo, { skipToken: true, silent: true });
        }

        if (ok) successCount++;
        else failCount++;

        completed += 1;
        if (syncBtn) syncBtn.textContent = `동기화 중... (${completed}/${targets.length})`;
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    this._syncing = false;
    if (syncBtn) syncBtn.disabled = false;
    this.render();
    UI.showToast(`동기화 완료! (${label}) 성공 ${successCount}, 실패 ${failCount}`, successCount > 0 ? 'success' : 'error');
  },
};
