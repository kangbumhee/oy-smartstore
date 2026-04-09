/**
 * OptionModal — Chrome extension (content script on OY) + autoFetch URL + postMessage fallback.
 * Vercel/server cannot call OY API (403); browser app cannot (CORS); popup.eval fails (cross-origin).
 */

const OY_CONSOLE_SCRIPT =
  "(async()=>{var g=new URL(location.href).searchParams.get('goodsNo');var r=await fetch('/goods/api/v1/option?goodsNumber='+g);var d=await r.json();var list=(d.data&&d.data.optionList)||[];var o=list.map(i=>i.optionName);try{await navigator.clipboard.writeText(o.join(', '));}catch(e){}console.log('복사완료: '+o.length+'개 옵션');console.log(o.join(', '));})()";

const OY_ORIGIN = 'https://www.oliveyoung.co.kr';

const OptionModal = {
  _resolve: null,
  _reject: null,
  _popup: null,
  _fetchedOptions: null,
  _boundHandler: null,
  _timeout: null,

  _escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  },

  open(product) {
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      this._fetchedOptions = null;

      if (this._boundHandler) {
        window.removeEventListener('message', this._boundHandler);
      }
      this._boundHandler = this.handleMessage.bind(this);
      window.addEventListener('message', this._boundHandler);

      this.showModal(product.goodsNo || '', product.name || product.goodsName || '');
    });
  },

  showModal(goodsNo, goodsName) {
    const old = document.getElementById('oy-option-modal');
    if (old) old.remove();

    const safeName = this._escHtml(goodsName);
    const safeNo = this._escHtml(goodsNo);

    const modal = document.createElement('div');
    modal.id = 'oy-option-modal';
    modal.innerHTML = `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;">
        <div style="background:#fff;border-radius:16px;padding:28px 32px;max-width:680px;width:92%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:16px;">
            <div>
              <h3 style="margin:0 0 4px;font-size:18px;">옵션 정보 가져오기</h3>
              <p style="margin:0;font-size:13px;color:#6366f1;word-break:break-all;">${safeName} (${safeNo})</p>
            </div>
            <button type="button" onclick="OptionModal.cancel()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#999;">&times;</button>
          </div>

          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:16px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
              <span style="background:#22c55e;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">1</span>
              <strong style="font-size:15px;">자동 가져오기</strong>
            </div>
            <p style="margin:0 0 12px;font-size:13px;color:#666;">크롬 확장 프로그램 <strong>OY 옵션 가져오기</strong>를 설치한 뒤 아래 버튼을 누르면 올리브영 팝업에서 옵션 API가 실행되고 결과가 전달됩니다.</p>
            <button type="button" id="oy-auto-fetch-btn"
              style="background:#22c55e;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;width:100%;">
              올리브영에서 자동 가져오기
            </button>
            <div id="oy-auto-status" style="margin-top:8px;font-size:13px;color:#666;display:none;"></div>
          </div>

          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
              <span style="background:#6366f1;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">2</span>
              <strong style="font-size:15px;">수동 입력 (확장 없거나 자동 실패 시)</strong>
            </div>
            <p style="margin:0 0 8px;font-size:13px;color:#666;">올리브영 상품 페이지에서 F12 → Console에 아래 코드를 붙여넣으면 옵션명이 클립보드에 복사됩니다(크롬).</p>
            <div style="position:relative;margin-bottom:10px;">
              <pre id="oy-console-script" style="background:#1e1e1e;color:#d4d4d4;padding:36px 12px 12px;border-radius:8px;font-size:11px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:120px;margin:0;">${this._escHtml(OY_CONSOLE_SCRIPT)}</pre>
              <button type="button" id="oy-copy-console-btn"
                style="position:absolute;top:8px;right:8px;background:#6366f1;color:#fff;border:none;padding:4px 12px;border-radius:4px;font-size:12px;cursor:pointer;">스크립트 복사</button>
            </div>
            <p style="margin:0 0 8px;font-size:13px;color:#666;">복사한 옵션명·JSON을 아래에 붙여넣기:</p>
            <textarea id="oy-manual-input" rows="3" placeholder="쉼표로 구분된 옵션명 또는 JSON"
              style="width:100%;border:1px solid #d1d5db;border-radius:8px;padding:10px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea>
          </div>

          <div id="oy-option-preview" style="display:none;background:#faf5ff;border:1px solid #e9d5ff;border-radius:12px;padding:16px;margin-bottom:16px;">
            <h4 style="margin:0 0 8px;font-size:14px;color:#7c3aed;">옵션 미리보기</h4>
            <div id="oy-option-preview-list" style="font-size:13px;max-height:240px;overflow-y:auto;"></div>
          </div>

          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            <button type="button" onclick="OptionModal.apply()"
              style="background:#6366f1;color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;">옵션 적용</button>
            <button type="button" onclick="OptionModal.applyWithout()"
              style="background:#f1f5f9;color:#333;border:1px solid #d1d5db;padding:12px 24px;border-radius:8px;font-size:14px;cursor:pointer;">옵션 없이 등록</button>
            <button type="button" onclick="OptionModal.cancel()"
              style="background:#f1f5f9;color:#666;border:1px solid #d1d5db;padding:12px 24px;border-radius:8px;font-size:14px;cursor:pointer;">취소</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const autoBtn = document.getElementById('oy-auto-fetch-btn');
    if (autoBtn) {
      autoBtn.addEventListener('click', () => OptionModal.autoFetch(goodsNo));
    }

    const copyBtn = document.getElementById('oy-copy-console-btn');
    if (copyBtn) {
      copyBtn.onclick = () => OptionModal.copyConsoleScript(copyBtn);
    }
  },

  copyConsoleScript(btn) {
    navigator.clipboard.writeText(OY_CONSOLE_SCRIPT).then(() => {
      const t = btn.textContent;
      btn.textContent = '복사됨!';
      setTimeout(() => { btn.textContent = t; }, 1500);
      if (typeof UI !== 'undefined') UI.showToast('콘솔용 스크립트를 복사했습니다', 'success');
    }).catch(() => {
      if (typeof UI !== 'undefined') UI.showToast('복사 실패 — pre 영역을 직접 선택해 복사하세요', 'error');
    });
  },

  autoFetch(goodsNo) {
    const btn = document.getElementById('oy-auto-fetch-btn');
    const status = document.getElementById('oy-auto-status');
    if (this._timeout) clearTimeout(this._timeout);

    btn.disabled = true;
    btn.textContent = '가져오는 중...';
    status.style.display = 'block';
    status.style.color = '#666';
    status.textContent = '올리브영 페이지를 여는 중...';

    const oyUrl =
      OY_ORIGIN +
      '/store/goods/getGoodsDetail.do?goodsNo=' +
      encodeURIComponent(goodsNo) +
      '&autoFetch=true';
    this._popup = window.open(oyUrl, 'oy_option_popup', 'width=900,height=700');

    if (!this._popup) {
      status.textContent = '팝업이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.';
      status.style.color = '#dc2626';
      btn.disabled = false;
      btn.textContent = '다시 시도';
      return;
    }

    status.textContent = '확장 프로그램이 옵션을 가져오는 중입니다… (최대 15초)';

    setTimeout(() => {
      try {
        if (this._popup && !this._popup.closed) {
          this._popup.postMessage({ type: 'oy-fetch-options', goodsNo }, OY_ORIGIN);
        }
      } catch (e) {}
    }, 800);

    this._timeout = setTimeout(() => {
      if (this._fetchedOptions && this._fetchedOptions.length > 0) return;
      status.innerHTML =
        '시간 초과.<br>1) <code>chrome-extension/oy-options</code> 확장 프로그램 설치 여부<br>2) 올리브영 팝업에서 F12 → Console에 위 스크립트 실행 후 결과를 아래에 붙여넣기';
      status.style.color = '#dc2626';
      btn.disabled = false;
      btn.textContent = '다시 시도';
    }, 15000);
  },

  handleMessage(event) {
    const data = event.data;
    if (!data || data.type !== 'oy-options-result') return;
    if (event.origin !== OY_ORIGIN) return;

    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }

    const btn = document.getElementById('oy-auto-fetch-btn');
    const status = document.getElementById('oy-auto-status');

    if (data.success && data.options && data.options.length > 0) {
      this._fetchedOptions = data.options;

      if (this._popup && !this._popup.closed) {
        try {
          this._popup.close();
        } catch (e) {}
      }

      if (btn) {
        btn.disabled = false;
        btn.textContent = '가져오기 완료!';
        btn.style.background = '#16a34a';
      }
      if (status) {
        status.textContent = data.options.length + '개 옵션 로드 완료!';
        status.style.color = '#16a34a';
      }

      this.showPreview(data.options);
    } else {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '다시 시도';
      }
      if (status) {
        status.textContent = '실패: ' + (data.error || '옵션 없음') + ' — 수동 입력을 사용하세요.';
        status.style.color = '#dc2626';
      }
    }
  },

  showPreview(options) {
    const preview = document.getElementById('oy-option-preview');
    const list = document.getElementById('oy-option-preview-list');
    if (!preview || !list) return;

    preview.style.display = 'block';
    list.innerHTML = options
      .map((o, i) => {
        const st = o.soldOut
          ? '<span style="color:#dc2626;">품절</span>'
          : o.todayDelivery
            ? '<span style="color:#7c3aed;">오늘드림</span>'
            : '<span style="color:#22c55e;">판매중</span>';
        const img = o.image
          ? `<img src="${this._escHtml(o.image)}" alt="" style="width:32px;height:32px;border-radius:4px;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'" />`
          : '';
        const name = this._escHtml(o.optionName || o.name);
        return `<div style="padding:6px 0;border-bottom:1px solid #f3e8ff;display:flex;align-items:center;gap:8px;">
          ${img}
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${i + 1}. ${name}</span>
          <span style="white-space:nowrap;font-size:12px;">${Number(o.finalPrice || o.price).toLocaleString()}원 ${st} (${o.quantity})</span>
        </div>`;
      })
      .join('');
  },

  apply() {
    let options = this._fetchedOptions || [];

    if (options.length === 0) {
      const input = document.getElementById('oy-manual-input');
      const text = ((input && input.value) || '').trim();
      if (!text) {
        if (typeof UI !== 'undefined') UI.showToast('옵션을 가져오거나 입력해 주세요', 'error');
        return;
      }

      try {
        const parsed = JSON.parse(text);
        if (parsed.options) options = parsed.options;
        else if (Array.isArray(parsed)) options = parsed;
      } catch {
        options = text
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter((s) => s)
          .map((name) => ({
            name,
            optionName: name,
            price: 0,
            soldOut: false,
            quantity: 999,
            stockQuantity: 999,
          }));
      }
    }

    if (options.length === 0) {
      if (typeof UI !== 'undefined') UI.showToast('파싱된 옵션이 없습니다', 'error');
      return;
    }

    this.cleanup();
    if (this._resolve) {
      this._resolve(options);
      this._resolve = null;
      this._reject = null;
    }
  },

  applyWithout() {
    this.cleanup();
    if (this._resolve) {
      this._resolve([]);
      this._resolve = null;
      this._reject = null;
    }
  },

  cancel() {
    this.cleanup();
    if (this._reject) {
      this._reject(new Error('cancelled'));
      this._reject = null;
      this._resolve = null;
    }
  },

  cleanup() {
    const modal = document.getElementById('oy-option-modal');
    if (modal) modal.remove();
    if (this._popup && !this._popup.closed) {
      try {
        this._popup.close();
      } catch (e) {}
    }
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
    if (this._boundHandler) {
      window.removeEventListener('message', this._boundHandler);
      this._boundHandler = null;
    }
    this._fetchedOptions = null;
  },
};
