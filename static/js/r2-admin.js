const PAGE_SIZE = 30;
const state = { files: [], page: 1, selecting: false, selected: new Set() };

const loginView = document.getElementById('loginView');
const adminView = document.getElementById('adminView');
const loginCss = document.getElementById('loginCss');
const adminCss = document.getElementById('adminCss');
const tokenInput = document.getElementById('adminToken');
const gallery = document.getElementById('gallery');
const pagination = document.getElementById('pagination');
const loading = document.getElementById('loading-indicator');
const selectButton = document.getElementById('selectMode');
const toolbar = document.getElementById('selectionToolbar');
const selectedCount = document.getElementById('selectedCount');

function getToken() {
    return (localStorage.getItem('pixpro-admin-token') || '').trim();
}

function auth() {
    return { Authorization: `Bearer ${getToken()}` };
}

function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtBytes(bytes = 0) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

function fmtDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false });
}

function toast(message, className = 'msg-green') {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
        stack = document.createElement('div');
        stack.className = 'toast-stack';
        document.body.appendChild(stack);
    }
    const item = document.createElement('div');
    item.className = `toast-item msg ${className}`;
    item.textContent = message;
    stack.appendChild(item);
    const close = () => {
        if (item.classList.contains('is-leaving')) return;
        item.classList.add('is-leaving');
        setTimeout(() => item.remove(), 800);
    };
    item.onclick = close;
    setTimeout(close, 2200);
}

function setLoading(show) {
    loading.style.display = show ? 'block' : 'none';
}

async function verifyToken(token) {
    const response = await fetch('/api/images?limit=1', { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json().catch(() => ({}));
    return response.ok && data.ok;
}

function enterAdmin() {
    loginView.style.display = 'none';
    loginCss.disabled = true;
    adminCss.disabled = false;
    adminView.style.display = 'block';
    document.body.classList.add('page-admin');
}

function enterLogin() {
    adminView.style.display = 'none';
    adminCss.disabled = true;
    loginCss.disabled = false;
    loginView.style.display = 'block';
    document.body.classList.remove('page-admin');
}

async function fetchAllImages() {
    let cursor = null;
    const files = [];
    let rounds = 0;
    do {
        const url = new URL('/api/images', location.origin);
        url.searchParams.set('limit', '1000');
        if (cursor) url.searchParams.set('cursor', cursor);
        const response = await fetch(url, { headers: auth() });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) throw new Error('登录已失效，请重新输入管理口令');
        if (!response.ok || !data.ok) throw new Error(data.error || '读取图库失败');
        files.push(...(data.files || []));
        cursor = data.cursor || null;
        rounds += 1;
    } while (cursor && rounds < 50);
    files.sort((a, b) => new Date(b.uploaded || 0) - new Date(a.uploaded || 0));
    return files;
}

async function loadGallery() {
    setLoading(true);
    try {
        state.files = await fetchAllImages();
        state.selected.clear();
        const totalPages = Math.max(1, Math.ceil(state.files.length / PAGE_SIZE));
        state.page = Math.min(state.page, totalPages);
        renderGallery();
    } catch (error) {
        toast(error.message || '读取图库失败', 'msg-red');
        if ((error.message || '').includes('登录')) {
            localStorage.removeItem('pixpro-admin-token');
            enterLogin();
        }
    } finally {
        setLoading(false);
    }
}

function currentPageFiles() {
    const start = (state.page - 1) * PAGE_SIZE;
    return state.files.slice(start, start + PAGE_SIZE);
}

function renderGallery() {
    const files = currentPageFiles();
    if (!files.length) {
        gallery.innerHTML = '<div class="empty-state"><div class="empty-icon"></div><p>暂无图片</p></div>';
    } else {
        gallery.innerHTML = files.map((file) => {
            const name = escapeHtml(file.originalName || file.key.split('/').pop());
            const key = escapeHtml(file.key);
            const url = escapeHtml(file.url);
            const selected = state.selected.has(file.key) ? ' selected' : '';
            return `
            <div class="gallery-item${selected}" data-key="${key}" data-url="${url}">
                <div class="image-wrapper">
                    <div class="image-placeholder"><div class="spinner"></div></div>
                    <a href="${url}" class="image-link" data-fancybox="gallery" data-caption="${name}">
                        <img class="lazy" src="${url}" alt="${name}">
                    </a>
                </div>
                <div class="action-buttons">
                    <button type="button" class="copy-btn glass-btn" data-url="${url}" title="复制链接">
                        <svg class="icon" aria-hidden="true"><use xlink:href="#icon-link"></use></svg>
                    </button>
                    <button type="button" class="delete-btn glass-btn" data-key="${key}" title="删除图片">
                        <svg class="icon" aria-hidden="true"><use xlink:href="#icon-xmark"></use></svg>
                    </button>
                </div>
                <div class="image-info">
                    <p class="info-p">名称: <span>${name}</span></p>
                    <p class="info-p">大小: <span>${fmtBytes(file.size)}</span></p>
                    <p class="info-p">时间: <span>${fmtDate(file.uploaded)}</span></p>
                </div>
            </div>`;
        }).join('');
    }

    gallery.classList.toggle('multi-select-mode', state.selecting);
    gallery.querySelectorAll('img.lazy').forEach((img) => {
        const done = () => {
            img.classList.add('loaded');
            img.closest('.image-wrapper')?.querySelector('.image-placeholder')?.remove();
        };
        if (img.complete && img.naturalWidth) done();
        else {
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', () => img.closest('.image-wrapper')?.classList.add('load-error'), { once: true });
        }
    });

    renderPagination();
    updateSelectionUi();

    if (window.Fancybox) {
        try { Fancybox.destroy(); } catch (_) {}
        Fancybox.bind('[data-fancybox="gallery"]', {
            Toolbar: { display: { right: ['slideshow', 'thumbs', 'close'] } },
            Thumbs: { showOnStart: false },
        });
    }
}

function renderPagination() {
    const totalPages = Math.max(1, Math.ceil(state.files.length / PAGE_SIZE));
    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }
    const pages = new Set([1, totalPages, state.page - 1, state.page, state.page + 1]);
    const valid = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
    const html = [];
    if (state.page > 1) html.push(`<a class="page-link prev-page glass-btn" data-page="${state.page - 1}" href="#">&laquo;</a>`);
    let previous = 0;
    for (const page of valid) {
        if (previous && page - previous > 1) html.push('<span class="page-ellipsis">…</span>');
        html.push(`<a class="page-link glass-btn${page === state.page ? ' active' : ''}" data-page="${page}" href="#">${page}</a>`);
        previous = page;
    }
    if (state.page < totalPages) html.push(`<a class="page-link next-page glass-btn" data-page="${state.page + 1}" href="#">&raquo;</a>`);
    pagination.innerHTML = html.join('');
}

function updateSelectionUi() {
    selectButton.classList.toggle('active', state.selecting);
    toolbar.classList.toggle('show', state.selecting);
    toolbar.style.display = state.selecting ? 'flex' : 'none';
    selectedCount.textContent = `已选择 ${state.selected.size} 张`;
}

function toggleSelectMode(force) {
    state.selecting = typeof force === 'boolean' ? force : !state.selecting;
    if (!state.selecting) state.selected.clear();
    renderGallery();
}

function toggleSelected(key) {
    if (state.selected.has(key)) state.selected.delete(key);
    else state.selected.add(key);
    renderGallery();
}

async function copyText(text) {
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
    } catch (_) {
        const area = document.createElement('textarea');
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
    }
    toast('已复制到剪贴板');
}

function confirmAction(message) {
    return new Promise((resolve) => {
        document.querySelector('.custom-confirm')?.remove();
        const box = document.createElement('div');
        box.className = 'custom-confirm glass-dialog';
        box.innerHTML = `<div class="confirm-message">${escapeHtml(message)}</div><div class="confirm-buttons"><button class="glass-btn" id="confirm-delete">确认</button><button class="glass-btn" id="cancel-delete">取消</button></div>`;
        document.body.appendChild(box);
        requestAnimationFrame(() => box.classList.add('show'));
        const finish = (value) => { box.remove(); resolve(value); };
        box.querySelector('#confirm-delete').onclick = () => finish(true);
        box.querySelector('#cancel-delete').onclick = () => finish(false);
    });
}

async function deleteKeys(keys) {
    if (!keys.length) return;
    setLoading(true);
    try {
        for (const key of keys) {
            const response = await fetch('/api/images', {
                method: 'DELETE',
                headers: { ...auth(), 'content-type': 'application/json' },
                body: JSON.stringify({ key }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.ok) throw new Error(data.error || `删除失败：${key}`);
        }
        const removed = new Set(keys);
        state.files = state.files.filter((file) => !removed.has(file.key));
        state.selected.clear();
        const totalPages = Math.max(1, Math.ceil(state.files.length / PAGE_SIZE));
        state.page = Math.min(state.page, totalPages);
        renderGallery();
        toast(`已删除 ${keys.length} 张图片`);
    } catch (error) {
        toast(error.message || '删除失败', 'msg-red');
    } finally {
        setLoading(false);
    }
}

document.getElementById('tokenForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = tokenInput.value.trim();
    if (!token) return;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    const old = button.textContent;
    button.textContent = '验证中…';
    try {
        if (!(await verifyToken(token))) throw new Error('管理口令错误');
        localStorage.setItem('pixpro-admin-token', token);
        enterAdmin();
        await loadGallery();
    } catch (error) {
        toast(error.message || '登录失败', 'msg-red');
    } finally {
        button.disabled = false;
        button.textContent = old;
    }
});

document.getElementById('togglePassword').addEventListener('click', () => {
    tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
});

document.getElementById('logout').addEventListener('click', (event) => {
    event.preventDefault();
    localStorage.removeItem('pixpro-admin-token');
    tokenInput.value = '';
    state.files = [];
    state.selected.clear();
    toggleSelectMode(false);
    enterLogin();
    toast('已退出登录');
});

selectButton.addEventListener('click', (event) => {
    event.preventDefault();
    toggleSelectMode();
});

document.getElementById('cancelSelect').addEventListener('click', () => toggleSelectMode(false));
document.getElementById('copySelected').addEventListener('click', () => {
    const urls = state.files.filter((file) => state.selected.has(file.key)).map((file) => file.url);
    if (!urls.length) return toast('请先选择图片', 'msg-red');
    copyText(urls.join('\n'));
});
document.getElementById('deleteSelected').addEventListener('click', async () => {
    const keys = [...state.selected];
    if (!keys.length) return toast('请先选择图片', 'msg-red');
    if (await confirmAction(`确定删除选中的 ${keys.length} 张图片吗？`)) await deleteKeys(keys);
});

document.getElementById('scroll-to-top').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
window.addEventListener('scroll', () => {
    const button = document.getElementById('scroll-to-top');
    const rightside = document.querySelector('.rightside');
    button.classList.toggle('visible', window.scrollY > 100);
    rightside.classList.toggle('shifted', window.scrollY > 100);
});

document.addEventListener('click', async (event) => {
    const pageLink = event.target.closest('.page-link[data-page]');
    if (pageLink) {
        event.preventDefault();
        state.page = Number(pageLink.dataset.page);
        state.selected.clear();
        renderGallery();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    const item = event.target.closest('.gallery-item');
    if (state.selecting && item) {
        event.preventDefault();
        event.stopPropagation();
        toggleSelected(item.dataset.key);
        return;
    }

    const copy = event.target.closest('.copy-btn');
    if (copy) {
        event.preventDefault();
        await copyText(copy.dataset.url);
        return;
    }

    const del = event.target.closest('.delete-btn');
    if (del) {
        event.preventDefault();
        if (await confirmAction('确定删除这张图片吗？')) await deleteKeys([del.dataset.key]);
    }
});

(async function init() {
    const saved = getToken();
    if (!saved) return enterLogin();
    tokenInput.value = saved;
    try {
        if (!(await verifyToken(saved))) throw new Error('invalid');
        enterAdmin();
        await loadGallery();
    } catch (_) {
        localStorage.removeItem('pixpro-admin-token');
        tokenInput.value = '';
        enterLogin();
    }
})();
