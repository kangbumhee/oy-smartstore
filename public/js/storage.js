/* LocalStorage Manager */
const Storage = {
  KEYS: {
    QUEUE: 'oy_register_queue',
    REGISTERED: 'oy_registered_products',
    SETTINGS: 'oy_settings',
    CREDENTIALS: 'oy_credentials',
    CATEGORY_MAP: 'oy_category_mappings',
    DELIVERY_PROFILES: 'oy_delivery_profiles',
  },

  get(key, fallback = null) {
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : fallback;
    } catch { return fallback; }
  },

  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
  },

  getQueue() { return this.get(this.KEYS.QUEUE, []); },

  addToQueue(product) {
    const queue = this.getQueue();
    if (queue.some((p) => p.goodsNo === product.goodsNo)) return false;
    queue.push({ ...product, addedAt: Date.now() });
    this.set(this.KEYS.QUEUE, queue);
    return true;
  },

  removeFromQueue(goodsNo) {
    const queue = this.getQueue().filter((p) => p.goodsNo !== goodsNo);
    this.set(this.KEYS.QUEUE, queue);
  },

  updateQueueItem(goodsNo, updates) {
    const queue = this.getQueue();
    const idx = queue.findIndex((p) => p.goodsNo === goodsNo);
    if (idx >= 0) {
      queue[idx] = { ...queue[idx], ...updates };
      this.set(this.KEYS.QUEUE, queue);
    }
  },

  getRegistered() { return this.get(this.KEYS.REGISTERED, []); },

  addRegistered(product) {
    const list = this.getRegistered();
    list.unshift({ ...product, registeredAt: Date.now() });
    this.set(this.KEYS.REGISTERED, list);
  },

  removeRegistered(productNo) {
    const list = this.getRegistered().filter((p) => (p.productNo || p.naverProductNo) !== productNo);
    this.set(this.KEYS.REGISTERED, list);
  },

  updateRegistered(productNo, updates) {
    const list = this.getRegistered();
    const idx = list.findIndex((p) => (p.productNo || p.naverProductNo) === productNo);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...updates };
      this.set(this.KEYS.REGISTERED, list);
    }
  },

  getSettings() {
    return this.get(this.KEYS.SETTINGS, {
      marginRate: 15,
      autoCategory: true,
      autoDescription: true,
    });
  },

  setSettings(settings) {
    this.set(this.KEYS.SETTINGS, settings);
  },

  getCredentials() {
    return this.get(this.KEYS.CREDENTIALS, {
      naverClientId: '',
      naverClientSecret: '',
      googleApiKey: '',
      aiBaseUrl: '',
      eccoApiKey: '',
    });
  },

  setCredentials(creds) {
    this.set(this.KEYS.CREDENTIALS, creds);
  },

  getCategoryMap() { return this.get(this.KEYS.CATEGORY_MAP, {}); },

  setCategoryMapping(oyCategory, naverCat) {
    const map = this.getCategoryMap();
    map[oyCategory] = { id: naverCat.id, name: naverCat.name, savedAt: Date.now() };
    this.set(this.KEYS.CATEGORY_MAP, map);
  },

  getSavedCategory(oyCategory) {
    const map = this.getCategoryMap();
    return map[oyCategory] || null;
  },

  removeCategoryMapping(oyCategory) {
    const map = this.getCategoryMap();
    delete map[oyCategory];
    this.set(this.KEYS.CATEGORY_MAP, map);
  },

  getDeliveryProfiles() {
    return this.get(this.KEYS.DELIVERY_PROFILES, {});
  },

  getDeliveryProfile(shopKey) {
    const profiles = this.getDeliveryProfiles();
    return profiles[shopKey] || null;
  },

  setDeliveryProfile(shopKey, profile) {
    if (!shopKey) return;
    const profiles = this.getDeliveryProfiles();
    profiles[shopKey] = { ...profile, savedAt: Date.now() };
    this.set(this.KEYS.DELIVERY_PROFILES, profiles);
  },

  removeDeliveryProfile(shopKey) {
    const profiles = this.getDeliveryProfiles();
    delete profiles[shopKey];
    this.set(this.KEYS.DELIVERY_PROFILES, profiles);
  },
};
