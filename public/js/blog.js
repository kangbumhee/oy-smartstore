/* Blog Promotion Page */
const Blog = {
  generatedText: '',
  generatedHtml: '',
  generatedTags: [],

  populateProducts() {
    const select = document.getElementById('blog-product-select');
    const products = Storage.getRegistered();
    const queue = Storage.getQueue();
    const all = [...products, ...queue];

    select.innerHTML = '<option value="">-- 등록된 상품을 선택하세요 --</option>';
    all.forEach((p, i) => {
      const label = `${p.brand ? p.brand + ' ' : ''}${p.name} (${Margin.formatPrice(p.sellingPrice || p.price)})`;
      const val = JSON.stringify({ idx: i, goodsNo: p.goodsNo });
      select.innerHTML += `<option value='${val}'>${label}</option>`;
    });
  },

  getSelectedProduct() {
    const select = document.getElementById('blog-product-select');
    if (!select.value) return null;
    try {
      const { idx, goodsNo } = JSON.parse(select.value);
      const products = [...Storage.getRegistered(), ...Storage.getQueue()];
      return products.find(p => p.goodsNo === goodsNo) || products[idx] || null;
    } catch { return null; }
  },

  async generate() {
    const product = this.getSelectedProduct();
    if (!product) return UI.showToast('상품을 선택하세요', 'error');

    const tone = document.getElementById('blog-tone').value;
    const length = document.getElementById('blog-length').value;
    const keywords = document.getElementById('blog-keywords').value.trim();
    const settings = Storage.getSettings();

    document.getElementById('blog-loading').style.display = 'block';
    document.getElementById('blog-result').style.display = 'none';
    document.getElementById('blog-empty').style.display = 'none';
    document.getElementById('blog-generate-btn').disabled = true;

    try {
      const data = await API.generateBlogPost({
        name: product.name,
        brand: product.brand || '',
        price: product.sellingPrice || product.price,
        category: product.category || product.categoryName || '',
        tone,
        length,
        keywords,
        geminiModel: settings.geminiModel || undefined,
        productNo: product.productNo || '',
        thumbnail: product.thumbnail || '',
      });

      if (data.success) {
        this.generatedText = data.text || '';
        this.generatedHtml = data.html || '';
        this.generatedTags = data.tags || [];
        this.renderResult(product);
      } else {
        UI.showToast('블로그 글 생성 실패: ' + (data.error || '알 수 없는 오류'), 'error');
      }
    } catch (e) {
      UI.showToast('블로그 글 생성 중 오류: ' + e.message, 'error');
    } finally {
      document.getElementById('blog-loading').style.display = 'none';
      document.getElementById('blog-generate-btn').disabled = false;
    }
  },

  renderResult(product) {
    document.getElementById('blog-result').style.display = 'block';
    document.getElementById('blog-result-title').textContent = `"${product.name}" 블로그 글`;

    const tagsEl = document.getElementById('blog-tags');
    tagsEl.innerHTML = this.generatedTags.map(t => `<span class="blog-tag">#${t}</span>`).join('');

    const previewEl = document.getElementById('blog-preview');
    previewEl.innerHTML = this.generatedHtml || this.generatedText.replace(/\n/g, '<br>');
  },

  async copyText() {
    if (!this.generatedText) return UI.showToast('생성된 글이 없습니다', 'error');
    try {
      await navigator.clipboard.writeText(this.generatedText);
      UI.showToast('텍스트가 클립보드에 복사되었습니다', 'success');
    } catch {
      this.fallbackCopy(this.generatedText);
    }
  },

  async copyHtml() {
    const html = this.generatedHtml || this.generatedText;
    if (!html) return UI.showToast('생성된 글이 없습니다', 'error');
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([this.generatedText], { type: 'text/plain' }),
        }),
      ]);
      UI.showToast('HTML이 클립보드에 복사되었습니다 (블로그 에디터에 붙여넣기 가능)', 'success');
    } catch {
      this.fallbackCopy(html);
    }
  },

  fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    UI.showToast('클립보드에 복사되었습니다', 'success');
  },

  openNaverBlog() {
    window.open('https://blog.naver.com/PostWriteForm.naver', '_blank');
    UI.showToast('네이버 블로그 에디터가 열렸습니다. HTML을 복사하여 붙여넣기 하세요.', 'info');
  },
};
