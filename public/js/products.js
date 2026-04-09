/* Registered Products Page */
const Products = {
  render() {
    const list = Storage.getRegistered();
    const listEl = document.getElementById('products-list');
    const emptyEl = document.getElementById('products-empty');

    if (list.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }

    emptyEl.style.display = 'none';
    listEl.innerHTML = list.map((p) => UI.renderRegisteredItem(p)).join('');
  },
};
