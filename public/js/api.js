/* API Client - sends credentials + cached Naver token */
const API = {
  _naverToken: null,
  _tokenExpiry: 0,

  _credHeaders() {
    const creds = Storage.getCredentials();
    const settings = Storage.getSettings();
    const h = {};
    if (creds.naverClientId) h['X-Naver-Client-Id'] = creds.naverClientId;
    if (creds.naverClientSecret) h['X-Naver-Client-Secret'] = creds.naverClientSecret;
    if (creds.googleApiKey) h['X-Google-Api-Key'] = creds.googleApiKey;
    if (creds.aiBaseUrl) h['X-AI-Base-URL'] = creds.aiBaseUrl;
    if (creds.eccoApiKey) h['X-EccoAPI-Key'] = creds.eccoApiKey;
    if (settings.geminiModel) h['X-AI-Model'] = settings.geminiModel;
    return h;
  },

  _naverHeaders() {
    const h = this._credHeaders();
    if (this._naverToken && Date.now() < this._tokenExpiry) {
      h['X-Naver-Token'] = this._naverToken;
    }
    return h;
  },

  async get(url, useNaverToken) {
    const h = useNaverToken ? this._naverHeaders() : this._credHeaders();
    const r = await fetch(url, { headers: h });
    return r.json();
  },

  _withNaverTokenBody(body, useNaverToken) {
    if (!useNaverToken || !this._naverToken || body == null || typeof body !== 'object' || Array.isArray(body)) {
      return body;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'token')) return body;
    return { ...body, token: this._naverToken };
  },

  async post(url, body, useNaverToken) {
    const h = useNaverToken ? this._naverHeaders() : this._credHeaders();
    h['Content-Type'] = 'application/json';
    const payload = this._withNaverTokenBody(body, useNaverToken);
    const r = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(payload) });
    const text = await r.text();
    try { return JSON.parse(text); }
    catch { return { success: false, error: text || `HTTP ${r.status}`, status: r.status }; }
  },

  async put(url, body, useNaverToken) {
    const h = useNaverToken ? this._naverHeaders() : this._credHeaders();
    h['Content-Type'] = 'application/json';
    const payload = this._withNaverTokenBody(body, useNaverToken);
    const r = await fetch(url, { method: 'PUT', headers: h, body: JSON.stringify(payload) });
    return r.json();
  },

  async patch(url, body, useNaverToken) {
    const h = useNaverToken ? this._naverHeaders() : this._credHeaders();
    h['Content-Type'] = 'application/json';
    const payload = this._withNaverTokenBody(body, useNaverToken);
    const r = await fetch(url, { method: 'PATCH', headers: h, body: JSON.stringify(payload) });
    return r.json();
  },

  async delete(url, useNaverToken) {
    const h = useNaverToken ? this._naverHeaders() : this._credHeaders();
    const r = await fetch(url, { method: 'DELETE', headers: h });
    return r.json();
  },

  async obtainNaverToken(maxRetries = 15) {
    if (this._naverToken && Date.now() < this._tokenExpiry - 60000) {
      return this._naverToken;
    }
    const failedIps = [];
    for (let i = 0; i < maxRetries; i++) {
      const data = await this.post('/api/naver/auth', {});
      if (data.success && data.token) {
        this._naverToken = data.token;
        this._tokenExpiry = Date.now() + (data.expiresIn || 7200) * 1000;
        console.log(`네이버 토큰 발급 성공 (${i + 1}번째 시도, IP: ${data.serverIp})`);
        return this._naverToken;
      }
      if (data.serverIp) failedIps.push(data.serverIp);
      const errMsg = data.error || '';
      if (!errMsg.includes('IP_NOT_ALLOWED')) {
        throw new Error(errMsg || '토큰 발급 실패');
      }
      console.log(`토큰 재시도 ${i + 1}/${maxRetries} (IP: ${data.serverIp} 차단됨)`);
    }
    const uniqueIps = [...new Set(failedIps)];
    throw new Error(`${maxRetries}번 시도 실패. 차단된 IP: ${uniqueIps.join(', ')}. 이 IP들을 네이버에 등록하세요.`);
  },

  clearToken() { this._naverToken = null; this._tokenExpiry = 0; },

  // OliveYoung
  async searchProducts(keyword) { return this.get(`/api/oliveyoung/search?keyword=${encodeURIComponent(keyword)}`); },
  async getProductInfo(goodsNo) { return this.get(`/api/oliveyoung/product-info?goodsNo=${encodeURIComponent(goodsNo)}`); },
  async getProductOptions(goodsNo) { return this.get(`/api/oliveyoung/options?goodsNo=${encodeURIComponent(goodsNo)}`); },
  async getProductImages(goodsNo, thumbnail) {
    let url = `/api/oliveyoung/images?goodsNo=${encodeURIComponent(goodsNo)}`;
    if (thumbnail) url += `&thumbnail=${encodeURIComponent(thumbnail)}`;
    return this.get(url);
  },

  // Naver (uses cached token)
  async getNaverAuth() { return this.post('/api/naver/auth', {}); },
  async registerProduct(data) { return this.post('/api/naver/register', data, true); },
  async registerGroupProduct(data) { return this.post('/api/naver/register-group', data, true); },
  async uploadImages(imageUrls) { return this.post('/api/naver/upload-image', { imageUrls }, true); },
  async getCategories(params) { return this.get(`/api/naver/categories?${new URLSearchParams(params)}`, true); },
  async getBestCategory(oyCategory, productName) {
    return this.get(`/api/naver/categories?mode=best-match&oyCategory=${encodeURIComponent(oyCategory)}&productName=${encodeURIComponent(productName)}`, true);
  },
  async searchCategories(keyword) {
    return this.get(`/api/naver/categories?keyword=${encodeURIComponent(keyword)}`, true);
  },
  async getCategoryAttributes(categoryId) {
    return this.get(`/api/naver/attributes?categoryId=${encodeURIComponent(categoryId)}`, true);
  },
  async getNaverProducts(page = 1) { return this.get(`/api/naver/products?page=${page}`, true); },
  async getNaverProductDetail(productNo) { return this.get(`/api/naver/products?productNo=${encodeURIComponent(productNo)}`, true); },
  async getGroupStatus(requestId) {
    return this.get(`/api/naver/group-status?action=status&requestId=${encodeURIComponent(requestId)}`, true);
  },
  async getNaverGroupProduct(groupProductNo) {
    return this.get(`/api/naver/group-products?groupProductNo=${encodeURIComponent(groupProductNo)}`, true);
  },
  async updateNaverGroupProduct(data) {
    return this.put('/api/naver/group-products', data, true);
  },
  async updateNaverProduct(data) { return this.put('/api/naver/products', data, true); },
  async syncOptionStock(data) { return this.put('/api/naver/products', { ...data, action: 'syncStock' }, true); },
  async deleteNaverProduct(productNo) { return this.delete(`/api/naver/products?productNo=${encodeURIComponent(productNo)}`, true); },

  // Image - AI product image generation (나노바나나/Gemini)
  async generateProductImages(productInfo) {
    const h = this._credHeaders();
    h['Content-Type'] = 'application/json';
    const r = await fetch('/api/image/studio', {
      method: 'POST',
      headers: h,
      body: JSON.stringify(productInfo),
    });
    return r.json();
  },

  // Tags
  async getProductTags(data) { return this.post('/api/naver/tags', data, true); },

  // AI
  async generateDescription(data) { return this.post('/api/ai/description', data); },
  async classifyCategory(productName, oliveyoungCategory) {
    return this.post('/api/ai/classify', { productName, oliveyoungCategory });
  },
  async generateBlogPost(data) { return this.post('/api/ai/description', { ...data, type: 'blog' }); },

  // Settings
  async getSettings() { return this.get('/api/settings'); },
};
