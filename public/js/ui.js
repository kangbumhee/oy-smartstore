/* UI Utilities */
const UI = {
  showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  showLoading(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'block';
  },

  hideLoading(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  },

  _escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  },

  renderProductCard(product) {
    const thumb = product.thumbnail || product.goodsImage || product.imageUrl || '';
    const price = Number(product.price || product.priceToPay || product.salePrice || 0);
    const originalPrice = Number(product.originalPrice || product.originPrice || product.normalPrice || 0);
    const discount = product.discount || product.discountRate || '';
    const brand = product.brand || product.brandName || product.brandNm || '';
    const name = product.name || product.goodsName || product.goodsNm || '';
    const goodsNo = product.goodsNo || product.goodsNumber || '';
    const reviewCount = product.reviewCount || product.totalReviewCount || 0;
    const avgRating = product.avgRating || product.averageRating || 0;
    const soldOut = product.soldOut || product.soldOutYn === 'Y';

    return `
      <div class="product-card" data-goods-no="${goodsNo}" onclick="Search.openDetail('${goodsNo}')">
        ${soldOut ? '<span class="sold-out-badge">품절</span>' : ''}
        <img class="product-card-img" src="${thumb}" alt="${name}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 200%22><rect fill=%22%23f1f5f9%22 width=%22200%22 height=%22200%22/><text x=%2250%%22 y=%2250%%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%2394a3b8%22 font-size=%2240%22>🖼</text></svg>'" />
        <div class="product-card-body">
          <div class="product-card-brand">${brand}</div>
          <div class="product-card-name">${name}</div>
          <div class="product-card-price">
            <span class="price-current">${Number(price).toLocaleString()}원</span>
            ${originalPrice > price ? `<span class="price-original">${Number(originalPrice).toLocaleString()}원</span>` : ''}
            ${discount ? `<span class="price-discount">${discount}%</span>` : ''}
          </div>
          <div class="product-card-meta">
            ${avgRating ? `<span>⭐ ${Number(avgRating).toFixed(1)}</span>` : ''}
            ${reviewCount ? `<span>💬 ${Number(reviewCount).toLocaleString()}</span>` : ''}
          </div>
        </div>
        <div class="product-card-actions" onclick="event.stopPropagation()">
          <button class="btn btn-primary btn-sm btn-block" onclick="Search.addToQueue('${goodsNo}').catch(()=>{})" ${soldOut ? 'disabled' : ''}>
            등록 대기열에 추가
          </button>
        </div>
      </div>
    `;
  },

  renderQueueItem(product) {
    const settings = Storage.getSettings();
    const marginRate = product.marginRate || settings.marginRate || 15;
    const calc = Margin.calculate(product.price, marginRate);
    const thumb = product.thumbnail || '';
    const oyCategory = `${product.category || ''} ${product.subCategory || ''}`.trim();
    const saved = Storage.getSavedCategory(oyCategory);
    const manualCat = product._naverCategory || saved;
    const catLabel = manualCat ? manualCat.name : (oyCategory || '미분류');
    const catSource = manualCat ? (product._naverCategory ? '수동' : '저장됨') : '자동';
    const catColor = manualCat ? '#16a34a' : '#6366f1';

    return `
      <div class="queue-item" id="queue-${product.goodsNo}">
        <div class="queue-item-header">
          <img class="queue-item-img" src="${thumb}" alt="" onerror="this.style.display='none'" />
          <div class="queue-item-info">
            <div class="queue-item-brand">${product.brand || ''}</div>
            <div class="queue-item-name">${product.name || ''}</div>
            <div class="queue-meta-row" style="margin:6px 0;display:flex;flex-wrap:wrap;gap:8px;font-size:12px;">
              <div style="display:flex;align-items:center;gap:4px;">
                <span style="color:#94a3b8;font-size:11px;">카테고리:</span>
                <span style="color:${catColor};font-weight:500;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${this._escHtml(catLabel)}">${this._escHtml(catLabel)}</span>
                <span style="font-size:10px;padding:1px 5px;border-radius:8px;background:${catColor}15;color:${catColor};border:1px solid ${catColor}40;">${catSource}</span>
                <button type="button" style="font-size:11px;padding:1px 5px;cursor:pointer;border:1px solid #e2e8f0;border-radius:5px;background:#fff;color:#6366f1;" onclick="Register.openCategorySelector('${product.goodsNo}')">변경</button>
              </div>
              <div style="display:flex;align-items:center;gap:4px;">
                <span style="color:#94a3b8;font-size:11px;">브랜드:</span>
                <span style="color:#334155;font-weight:500;">${this._escHtml(product.brand || '미설정')}</span>
              </div>
              <div style="display:flex;align-items:center;gap:4px;">
                <span style="color:#94a3b8;font-size:11px;">제조사:</span>
                <span style="color:#334155;">${this._escHtml(product._manufacturer || product.brand || '자동')}</span>
              </div>
            </div>
            <div class="queue-item-prices">
              <div class="price-box">
                <span class="label">올리브영가</span>
                <span class="value">${Margin.formatPrice(product.price)}</span>
              </div>
              <div class="price-box">
                <span class="label">판매가</span>
                <span class="value selling" id="queue-selling-${product.goodsNo}">${Margin.formatPrice(calc.sellingPrice)}</span>
              </div>
              <div class="price-box">
                <span class="label">예상 순이익</span>
                <span class="value profit" id="queue-profit-${product.goodsNo}">${Margin.formatPrice(calc.totalProfit)}</span>
              </div>
            </div>
            <div class="margin-control">
              <label>마진율</label>
              <input type="range" min="5" max="50" value="${marginRate}" oninput="Register.updateMargin('${product.goodsNo}', this.value)" />
              <input type="number" min="5" max="50" value="${marginRate}" id="queue-margin-num-${product.goodsNo}" oninput="Register.updateMargin('${product.goodsNo}', this.value)" />
              <span>%</span>
            </div>
          </div>
        </div>
        ${product.options && product.options.length > 0 ? `
          <div class="modal-options">
            <h4>옵션 (${product.options.length}개)</h4>
            <div class="option-list" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
              ${product.options.map((o, idx) => {
    const name = o.name || o.optionName || `옵션${idx + 1}`;
    const isSoldOut = o.soldOut === true || o.soldOutFlag === 'Y';
    const badgeStyle = isSoldOut
      ? 'background:#fef2f2;color:#dc2626;border:1px solid #fca5a5;'
      : 'background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;';
    const label = this._escHtml(name);
    const gn = String(product.goodsNo || '').replace(/"/g, '&quot;');
    return `<label style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:12px;cursor:pointer;margin:2px;${badgeStyle}">
      <input type="checkbox" class="opt-check" data-goods-no="${gn}" data-opt-idx="${idx}"
        style="width:14px;height:14px;cursor:pointer;" />
      ${label}${isSoldOut ? ' (품절)' : ''}
    </label>`;
  }).join('')}
            </div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
              <button type="button" class="btn btn-outline btn-sm" onclick='Register.removeSelectedOptions(${JSON.stringify(product.goodsNo)})'>선택 옵션 제거</button>
              <button type="button" class="btn btn-outline btn-sm" onclick='Register.selectAllOptionsForProduct(${JSON.stringify(product.goodsNo)})'>전체 옵션 선택</button>
            </div>
          </div>
        ` : ''}
        <div class="queue-item-actions">
          <button class="btn btn-outline btn-sm" onclick="Register.remove('${product.goodsNo}')">제거</button>
          <button class="btn btn-success btn-sm" onclick="Register.registerOne('${product.goodsNo}')">스마트스토어 등록</button>
        </div>
      </div>
    `;
  },

  renderRegisteredItem(product) {
    const thumb = product.thumbnail || '';
    const date = product.registeredAt ? new Date(product.registeredAt).toLocaleDateString('ko-KR') : '';
    const productNo = product.productNo || '';
    const storeUrl = productNo ? `https://smartstore.naver.com/i/${productNo}` : '';

    return `
      <div class="registered-item${storeUrl ? ' clickable' : ''}" ${storeUrl ? `onclick="window.open('${storeUrl}','_blank')"` : ''}>
        <img class="registered-item-img" src="${thumb}" alt="" onerror="this.style.display='none'" />
        <div class="registered-item-info">
          <div class="registered-item-name">${product.name}</div>
          <div class="registered-item-meta">
            <span>판매가: ${Margin.formatPrice(product.sellingPrice)}</span>
            <span>등록일: ${date}</span>
            ${productNo ? `<a class="product-link" href="${storeUrl}" target="_blank" onclick="event.stopPropagation()">스토어에서 보기 ↗</a>` : ''}
          </div>
        </div>
      </div>
    `;
  },

  showModal(contentHtml) {
    document.getElementById('modal-content').innerHTML = contentHtml;
    document.getElementById('modal-overlay').style.display = 'flex';
  },

  hideModal() {
    document.getElementById('modal-overlay').style.display = 'none';
  },

  showProgress(steps) {
    const html = `<div class="progress-timer" id="progress-timer">0초 경과</div>` + steps.map((s, i) => `
      <div class="progress-step" id="step-${i}">
        <div class="step-icon ${s.status}">${s.status === 'done' ? '✓' : s.status === 'error' ? '✗' : s.status === 'active' ? '⏳' : (i + 1)}</div>
        <span>${s.label}</span>
      </div>
    `).join('');
    document.getElementById('progress-steps').innerHTML = html;
    document.getElementById('progress-overlay').style.display = 'flex';
  },

  updateProgressStep(index, status, label) {
    const step = document.getElementById(`step-${index}`);
    if (!step) return;
    const icon = step.querySelector('.step-icon');
    icon.className = `step-icon ${status}`;
    icon.textContent = status === 'done' ? '✓' : status === 'error' ? '✗' : status === 'active' ? '⏳' : String(index + 1);
    if (label) step.querySelector('span').textContent = label;
  },

  hideProgress() {
    document.getElementById('progress-overlay').style.display = 'none';
  },

  updateBadge() {
    const badge = document.getElementById('queue-badge');
    const count = Storage.getQueue().length;
    if (count > 0) {
      badge.style.display = 'inline';
      badge.textContent = count;
    } else {
      badge.style.display = 'none';
    }
  },
};
