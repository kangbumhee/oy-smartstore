/* Main App Controller */
const App = {
  currentPage: 'search',
  serverDefaults: null,

  async init() {
    this.initNavigation();
    this.initModals();
    this.initMobileMenu();
    this.initSettings();
    this.loadCredentialsToForm();
    Search.init();
    Register.render();
    Products.render();
    UI.updateBadge();
    await this.checkApiStatus();
  },

  initNavigation() {
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.dataset.page;
        if (page) this.navigate(page);
      });
    });
  },

  navigate(page) {
    this.currentPage = page;
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
    document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    document.getElementById(`page-${page}`)?.classList.add('active');
    if (page === 'register') Register.render();
    if (page === 'products') Products.render();
    if (page === 'settings') this.loadSettingsToForm();
    if (page === 'blog') Blog.populateProducts();
    document.getElementById('sidebar').classList.remove('open');
  },

  initModals() {
    document.getElementById('modal-close').addEventListener('click', UI.hideModal);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') UI.hideModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { UI.hideModal(); UI.hideProgress(); }
    });
  },

  initMobileMenu() {
    const toggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');
    toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.getElementById('main-content').addEventListener('click', () => sidebar.classList.remove('open'));
  },

  initSettings() {
    document.getElementById('save-settings-btn').addEventListener('click', () => this.saveSettings());
    document.getElementById('reset-settings-btn').addEventListener('click', () => this.resetSettings());
  },

  // ==================== Credentials ====================
  PROMPT_TEMPLATES: {
    model_female_elegant: 'Professional beauty advertisement photo. A young attractive Korean female model (early 20s, elegant and refined look, natural makeup) is gracefully holding or presenting "{product}" by "{brand}" near her face/shoulder. Clean white studio background, soft diffused studio lighting. The product is clearly visible and prominent. High-end K-beauty commercial quality. Model has a gentle, confident smile. NO text overlays, NO watermarks. Photorealistic.',
    model_female_fresh: 'Fresh and youthful K-beauty advertisement. A young Korean female model (early 20s, fresh dewy skin, bright smile) is cheerfully showcasing "{product}" by "{brand}". Bright, airy pastel background with soft natural light. The model radiates healthy glow and freshness. Product clearly visible in her hand. Clean, Instagram-worthy aesthetic. NO text, NO watermarks. Photorealistic.',
    model_female_luxe: 'Luxurious beauty campaign photo. A sophisticated young Korean female model (mid 20s, glamorous, polished makeup) poses elegantly with "{product}" by "{brand}". Dark moody background with dramatic lighting highlighting both the model and product. High-fashion editorial quality. Vogue-style composition. NO text, NO watermarks. Photorealistic.',
    model_male_clean: 'Professional grooming advertisement. A young handsome Korean male model (early-mid 20s, clean-shaven, clear skin) confidently holds "{product}" by "{brand}". Clean white studio background, professional lighting. Modern and approachable aesthetic. The product is clearly visible. NO text, NO watermarks. Photorealistic.',
    model_male_active: 'Active lifestyle grooming ad. A young athletic Korean male model (mid 20s, healthy tan, energetic vibe) presents "{product}" by "{brand}" in a bright, modern bathroom setting. Fresh morning light, clean and masculine aesthetic. Product prominently displayed. NO text, NO watermarks. Photorealistic.',
    model_male_premium: 'Premium men\'s grooming advertisement. A stylish young Korean male model (mid 20s, well-groomed, sharp jawline) in a sophisticated setting with "{product}" by "{brand}". Dark elegant background with warm accent lighting. Luxury magazine quality. NO text, NO watermarks. Photorealistic.',
    studio_white: 'Professional e-commerce product photograph of "{product}" by "{brand}". Clean white studio background, professional product photography with soft studio lighting. Product centered, occupying 70% of frame. Slight soft shadow underneath. High-end commercial quality. NO text, NO watermarks, NO hands, NO people. Photorealistic.',
    custom: '',
  },

  loadCredentialsToForm() {
    const creds = Storage.getCredentials();
    document.getElementById('cred-naver-id').value = creds.naverClientId || '';
    document.getElementById('cred-naver-secret').value = creds.naverClientSecret || '';
    document.getElementById('cred-google-key').value = creds.googleApiKey || '';
    document.getElementById('cred-ai-baseurl').value = creds.aiBaseUrl || '';

    const eccoEl = document.getElementById('cred-eccoapi-key');
    if (eccoEl) eccoEl.value = creds.eccoApiKey || '';

    const nbStatus = document.getElementById('nanobanana-status');
    if (nbStatus) {
      if (creds.eccoApiKey && creds.eccoApiKey.startsWith('nk_live_')) {
        nbStatus.textContent = 'EccoAPI 키 설정됨 - 나노바나나 3.1 활성';
        nbStatus.className = 'status-badge connected';
      } else if (creds.eccoApiKey) {
        nbStatus.textContent = '키 형식 확인 필요 (nk_live_ 로 시작)';
        nbStatus.className = 'status-badge warning';
      } else {
        nbStatus.textContent = '미설정 - 이미지 생성 불가';
        nbStatus.className = 'status-badge disconnected';
      }
    }

    const settings = Storage.getSettings();
    const templateSelect = document.getElementById('setting-img-prompt-template');
    const promptText = document.getElementById('setting-img-prompt-text');
    if (templateSelect && promptText) {
      const savedTemplate = settings.imgPromptTemplate || 'studio_white';
      templateSelect.value = savedTemplate;
      if (savedTemplate === 'custom') {
        promptText.value = settings.imgPromptCustom || '';
        promptText.readOnly = false;
      } else {
        promptText.value = this.PROMPT_TEMPLATES[savedTemplate] || this.PROMPT_TEMPLATES.studio_white;
        promptText.readOnly = true;
      }
    }
    const imgCountEl = document.getElementById('setting-img-count');
    if (imgCountEl) imgCountEl.value = settings.imgCount || 1;
  },

  applyPromptTemplate() {
    const templateSelect = document.getElementById('setting-img-prompt-template');
    const promptText = document.getElementById('setting-img-prompt-text');
    if (!templateSelect || !promptText) return;

    const val = templateSelect.value;
    if (val === 'custom') {
      const s = Storage.getSettings();
      promptText.value = s.imgPromptCustom || '';
      promptText.readOnly = false;
      promptText.focus();
    } else {
      promptText.value = this.PROMPT_TEMPLATES[val] || '';
      promptText.readOnly = true;
    }
  },

  saveCredentials() {
    const creds = {
      naverClientId: document.getElementById('cred-naver-id').value.trim(),
      naverClientSecret: document.getElementById('cred-naver-secret').value.trim(),
      googleApiKey: document.getElementById('cred-google-key').value.trim(),
      aiBaseUrl: document.getElementById('cred-ai-baseurl').value.trim(),
      eccoApiKey: (document.getElementById('cred-eccoapi-key')?.value || '').trim(),
    };
    Storage.setCredentials(creds);

    const s = Storage.getSettings();
    s.geminiModel = document.getElementById('setting-model').value;
    const tpl = document.getElementById('setting-img-prompt-template');
    if (tpl) s.imgPromptTemplate = tpl.value;
    const pTxt = document.getElementById('setting-img-prompt-text');
    if (pTxt && tpl && tpl.value === 'custom') s.imgPromptCustom = pTxt.value;
    s._initialized = true;
    Storage.setSettings(s);

    UI.showToast('API 키가 저장되었습니다', 'success');
    this.checkApiStatus();
  },

  clearCredentials() {
    if (!confirm('저장된 API 키를 모두 삭제하시겠습니까?')) return;
    Storage.setCredentials({ naverClientId: '', naverClientSecret: '', googleApiKey: '', aiBaseUrl: '', eccoApiKey: '' });
    this.loadCredentialsToForm();
    UI.showToast('API 키가 초기화되었습니다', 'info');
    this.checkApiStatus();
  },

  togglePassword(inputId) {
    const input = document.getElementById(inputId);
    input.type = input.type === 'password' ? 'text' : 'password';
  },

  saveCredentialsQuietly() {
    const creds = {
      naverClientId: document.getElementById('cred-naver-id').value.trim(),
      naverClientSecret: document.getElementById('cred-naver-secret').value.trim(),
      googleApiKey: document.getElementById('cred-google-key').value.trim(),
      aiBaseUrl: document.getElementById('cred-ai-baseurl').value.trim(),
      eccoApiKey: (document.getElementById('cred-eccoapi-key')?.value || '').trim(),
    };
    Storage.setCredentials(creds);

    const s = Storage.getSettings();
    s.geminiModel = document.getElementById('setting-model').value;
    const tpl = document.getElementById('setting-img-prompt-template');
    if (tpl) s.imgPromptTemplate = tpl.value;
    const pTxt = document.getElementById('setting-img-prompt-text');
    if (pTxt && tpl && tpl.value === 'custom') s.imgPromptCustom = pTxt.value;
    const imgCountEl = document.getElementById('setting-img-count');
    if (imgCountEl) s.imgCount = Math.max(1, Math.min(5, parseInt(imgCountEl.value, 10) || 1));
    Storage.setSettings(s);
  },

  async testNaverConnection() {
    const resultEl = document.getElementById('naver-test-result');
    resultEl.textContent = '테스트 중...';
    resultEl.className = 'cred-test-result loading';
    this.saveCredentialsQuietly();
    try {
      const data = await API.getNaverAuth();
      if (data.success) {
        resultEl.textContent = '연결 성공!';
        resultEl.className = 'cred-test-result success';
      } else {
        let errMsg = data.error || '알 수 없는 오류';
        if (errMsg.includes('IP_NOT_ALLOWED')) {
          const ip = data.serverIp || '알 수 없음';
          errMsg = `IP 제한 오류 (서버IP: ${ip}). 네이버에 이 IP를 등록하거나, 프록시를 설정하세요.`;
        }
        resultEl.textContent = '실패: ' + errMsg.substring(0, 100);
        resultEl.className = 'cred-test-result error';
      }
    } catch (e) {
      resultEl.textContent = '연결 오류: ' + e.message.substring(0, 60);
      resultEl.className = 'cred-test-result error';
    }
  },

  async testImageGeneration() {
    const resultEl = document.getElementById('nanobanana-test-result');
    resultEl.textContent = 'AI 이미지 생성 테스트 중... (최대 90초)';
    resultEl.className = 'cred-test-result loading';
    this.saveCredentialsQuietly();

    const promptText = document.getElementById('setting-img-prompt-text');
    let prompt = promptText?.value || '';
    prompt = prompt.replace(/\{product\}/g, '라네즈 워터 슬리핑 마스크')
                   .replace(/\{brand\}/g, '라네즈')
                   .replace(/\{option\}/g, '');

    try {
      const data = await API.generateProductImages({
        productName: '라네즈 워터 슬리핑 마스크',
        brand: '라네즈',
        category: '스킨케어',
        count: 1,
        prompt: prompt || undefined,
      });
      if (data.success && data.images?.length > 0) {
        resultEl.innerHTML = `성공! <a href="${data.images[0]}" target="_blank" style="color:var(--primary)">이미지 확인 ↗</a>`;
        resultEl.className = 'cred-test-result success';
      } else {
        resultEl.textContent = '실패: ' + (data.error || '알 수 없는 오류').substring(0, 80);
        resultEl.className = 'cred-test-result error';
      }
    } catch (e) {
      resultEl.textContent = '오류: ' + e.message.substring(0, 60);
      resultEl.className = 'cred-test-result error';
    }
  },

  async testGoogleConnection() {
    const resultEl = document.getElementById('google-test-result');
    resultEl.textContent = '테스트 중...';
    resultEl.className = 'cred-test-result loading';
    this.saveCredentialsQuietly();
    try {
      const data = await API.generateDescription({
        name: '테스트 상품', brand: '테스트', price: 10000, category: '스킨케어',
      });
      if (data.success) {
        resultEl.textContent = data.fallback ? '연결 실패 (폴백 사용): ' + (data.error || '').substring(0, 50) : '연결 성공!';
        resultEl.className = data.fallback ? 'cred-test-result error' : 'cred-test-result success';
      } else {
        resultEl.textContent = '실패: ' + (data.error || '').substring(0, 80);
        resultEl.className = 'cred-test-result error';
      }
    } catch (e) {
      resultEl.textContent = '연결 오류: ' + e.message.substring(0, 60);
      resultEl.className = 'cred-test-result error';
    }
  },

  // ==================== Settings ====================
  loadSettingsToForm() {
    const s = Storage.getSettings();
    document.getElementById('setting-margin').value = s.marginRate || 15;
    document.getElementById('setting-ss-ship').value = s.smartstoreShippingFee || 3000;
    document.getElementById('setting-oy-ship').value = s.oliveyoungShippingFee || 2500;
    document.getElementById('setting-buffer').value = s.shippingProfitBuffer || 500;
    document.getElementById('setting-name-prefix').value = s.namePrefix || '';
    document.getElementById('setting-name-suffix').value = s.nameSuffix || '';
    document.getElementById('setting-default-stock').value = s.defaultStock || 999;

    const modelSelect = document.getElementById('setting-model');
    const savedModel = s.geminiModel || 'gemini-3.1-pro-preview';
    let found = false;
    for (const opt of modelSelect.options) {
      if (opt.value === savedModel) { opt.selected = true; found = true; break; }
    }
    if (!found && savedModel) {
      const opt = document.createElement('option');
      opt.value = savedModel;
      opt.textContent = savedModel;
      opt.selected = true;
      modelSelect.appendChild(opt);
    }

    this.loadCredentialsToForm();

    const tplSelect = document.getElementById('setting-img-prompt-template');
    const pText = document.getElementById('setting-img-prompt-text');
    if (tplSelect && pText) {
      const savedTpl = s.imgPromptTemplate || 'studio_white';
      tplSelect.value = savedTpl;
      if (savedTpl === 'custom') {
        pText.value = s.imgPromptCustom || '';
        pText.readOnly = false;
      } else {
        pText.value = this.PROMPT_TEMPLATES[savedTpl] || this.PROMPT_TEMPLATES.studio_white;
        pText.readOnly = true;
      }
    }

    const imgCountEl = document.getElementById('setting-img-count');
    if (imgCountEl) imgCountEl.value = s.imgCount || 1;
  },

  saveSettings() {
    const s = Storage.getSettings();
    s.marginRate = parseInt(document.getElementById('setting-margin').value, 10) || 15;
    s.smartstoreShippingFee = parseInt(document.getElementById('setting-ss-ship').value, 10) || 3000;
    s.oliveyoungShippingFee = parseInt(document.getElementById('setting-oy-ship').value, 10) || 2500;
    s.shippingProfitBuffer = parseInt(document.getElementById('setting-buffer').value, 10) || 500;
    s.geminiModel = document.getElementById('setting-model').value;
    s.namePrefix = document.getElementById('setting-name-prefix').value.trim();
    s.nameSuffix = document.getElementById('setting-name-suffix').value.trim();
    s.defaultStock = parseInt(document.getElementById('setting-default-stock').value, 10) || 999;
    const tplSel = document.getElementById('setting-img-prompt-template');
    if (tplSel) s.imgPromptTemplate = tplSel.value;
    const ptx = document.getElementById('setting-img-prompt-text');
    if (ptx && tplSel && tplSel.value === 'custom') s.imgPromptCustom = ptx.value;
    const imgCountEl = document.getElementById('setting-img-count');
    if (imgCountEl) s.imgCount = Math.max(1, Math.min(5, parseInt(imgCountEl.value, 10) || 1));
    s._initialized = true;
    Storage.setSettings(s);

    Margin.SS_SHIPPING = s.smartstoreShippingFee;
    Margin.OY_SHIPPING = s.oliveyoungShippingFee;
    Margin.BUFFER = s.shippingProfitBuffer;

    const msg = document.getElementById('setting-saved-msg');
    msg.style.display = 'block';
    msg.textContent = '설정이 저장되었습니다.';
    setTimeout(() => { msg.style.display = 'none'; }, 3000);
    UI.showToast('설정이 저장되었습니다', 'success');
  },

  resetSettings() {
    if (!this.serverDefaults) return UI.showToast('서버 기본값을 불러오는 중...', 'info');
    const d = this.serverDefaults;
    const s = {
      marginRate: Math.round(d.defaultMarginRate * 100),
      smartstoreShippingFee: d.smartstoreShippingFee,
      oliveyoungShippingFee: d.oliveyoungShippingFee,
      shippingProfitBuffer: d.shippingProfitBuffer,
      geminiModel: 'gemini-3.1-pro-preview',
      namePrefix: '', nameSuffix: '', defaultStock: 999, _initialized: true,
    };
    Storage.setSettings(s);
    this.loadSettingsToForm();
    Margin.SS_SHIPPING = s.smartstoreShippingFee;
    Margin.OY_SHIPPING = s.oliveyoungShippingFee;
    Margin.BUFFER = s.shippingProfitBuffer;

    const msg = document.getElementById('setting-saved-msg');
    msg.style.display = 'block';
    msg.textContent = '서버 기본값으로 초기화되었습니다.';
    setTimeout(() => { msg.style.display = 'none'; }, 3000);
    UI.showToast('서버 기본값으로 초기화됨', 'info');
  },

  // ==================== API Status ====================
  async checkApiStatus() {
    const statusDot = document.querySelector('#api-status .status-dot');
    const statusText = document.querySelector('#api-status .status-text');
    statusDot.className = 'status-dot checking';
    statusText.textContent = '연결 확인 중...';

    try {
      const data = await API.getSettings();
      if (data.success) {
        const s = data.settings;
        this.serverDefaults = s;

        const naverStatus = document.getElementById('naver-status');
        const googleStatus = document.getElementById('google-status');
        const proxyStatus = document.getElementById('proxy-status');
        const serverIpDisplay = document.getElementById('server-ip-display');

        if (s.hasNaverCredentials) {
          naverStatus.textContent = '키 설정됨';
          naverStatus.className = 'status-badge connected';
        } else {
          naverStatus.textContent = '미설정';
          naverStatus.className = 'status-badge disconnected';
        }
        if (s.hasGoogleApiKey) {
          googleStatus.textContent = '키 설정됨';
          googleStatus.className = 'status-badge connected';
        } else {
          googleStatus.textContent = '미설정';
          googleStatus.className = 'status-badge disconnected';
        }

        if (proxyStatus) {
          if (s.hasProxy) {
            proxyStatus.textContent = '활성 (고정 IP)';
            proxyStatus.className = 'status-badge connected';
          } else {
            proxyStatus.textContent = '미설정 - IP 오류 발생 가능';
            proxyStatus.className = 'status-badge disconnected';
          }
        }

        if (serverIpDisplay && data.serverIp) {
          serverIpDisplay.textContent = data.serverIp;
          serverIpDisplay.className = 'status-badge mono';
        }

        const allConnected = s.hasNaverCredentials && s.hasGoogleApiKey;
        statusDot.className = allConnected ? 'status-dot online' : 'status-dot offline';
        statusText.textContent = allConnected ? 'API 연결됨' : 'API 설정 필요';

        const localSettings = Storage.getSettings();
        if (!localSettings._initialized) {
          localSettings.marginRate = Math.round(s.defaultMarginRate * 100);
          localSettings.smartstoreShippingFee = s.smartstoreShippingFee;
          localSettings.oliveyoungShippingFee = s.oliveyoungShippingFee;
          localSettings.shippingProfitBuffer = s.shippingProfitBuffer;
          localSettings.geminiModel = 'gemini-3.1-pro-preview';
          localSettings.defaultStock = 999;
          localSettings._initialized = true;
          Storage.setSettings(localSettings);
        }

        const ls = Storage.getSettings();
        Margin.SS_SHIPPING = ls.smartstoreShippingFee || s.smartstoreShippingFee;
        Margin.OY_SHIPPING = ls.oliveyoungShippingFee || s.oliveyoungShippingFee;
        Margin.BUFFER = ls.shippingProfitBuffer || s.shippingProfitBuffer;
        this.loadSettingsToForm();
      }
    } catch (e) {
      statusDot.className = 'status-dot offline';
      statusText.textContent = '서버 연결 실패';
    }
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
