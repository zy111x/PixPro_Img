const PAGE_SIZE = 30;
const state = { files: [], page: 1 };

const loginView = document.getElementById('loginView');
const adminView = document.getElementById('adminView');
const loginCss = document.getElementById('loginCss');
const adminCss = document.getElementById('adminCss');
const tokenInput = document.getElementById('adminToken');
const gallery = document.getElementById('gallery');
const pagination = document.getElementById('pagination');
const loading = document.getElementById('loading-indicator');
const currentTotal = document.getElementById('current-total-pages');

function getToken() {
    return (localStorage.getItem('pixpro-admin-token') || '').trim();
}

function auth() {
    return { Authorization: `Bearer ${getToken()}` };
}

function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtBytes(bytes = 0) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fmtDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false });
}

function showNotification(message, className = 'msg-green') {
    const notification = document.createElement('div');
    notification.className = `msg ${className}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.classList.add('msg-right');
        setTimeout(() => notification.remove(), 800);
    }, 1500);
}

function setLoading(show) {
    loading.style.display = show ? 'block' : 'none';
}

async function verifyToken(token) {
    const response = await fetch('/api/images?limit=1', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return false;
    const data = await response.json().catch(() => ({}));
    return Boolean(data.ok);
}

function enterAdmin() {
    loginView.style.display = 'none';
    loginCss.disabled = true;
    adminCss.disabled = false;
    adminView.style.display = 'block';
}

function enterLogin() {
    adminView.style.display = 'none';
    adminCss.disabled = true;
    loginCss.disabled = false;
    loginView.style.display = 'block';
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
    } while (cursor && rounds < 20);

    files.sort((a, b) => new Date(b.uploaded || 0) - new Date(a.uploaded || 0));
    return files;
}

async function loadGallery() {
    setLoading(true);
    try {
        state.files = await fetchAllImages();
        const totalPages = Math.max(1, Math.ceil(state.files.length / PAGE_SIZE));
        if (state.page > totalPages) state.page = totalPages;
        renderGallery();
    } catch (error) {
        showNotification(error.message || '读取图库失败', 'msg-red');
        if ((error.message || '').includes('登录')) {
            localStorage.removeItem('pixpro-admin-token');
            enterLogin();
        }
    } finally {
        setLoading(false);
    }
}

function renderGallery() {
    const totalPages = Math.max(1, Math.ceil(state.files.length / PAGE_SIZE));
    const start = (state.page - 1) * PAGE_SIZE;
    const files = state.files.slice(start, start + PAGE_SIZE);

    gallery.innerHTML = files.map((file, index) => {
        const name = escapeHtml(file.originalName || file.key.split('/').pop());
        const key = escapeHtml(file.key);
        const url = escapeHtml(file.url);
        return `
            <div class="gallery-item" id="image-${start + index}">
                <div class="placeholder-image"></div>
                <a href="${url}" data-fancybox="gallery" data-caption="${name}">
                    <img class="lazy-image" loading="lazy" src="${url}" alt="${name}">
                </a>
                <div class="action-buttons">
                    <button class="copy-btn" data-url="${url}" title="复制图片链接"><img src="/images/svg/link.svg" alt="复制"></button>
                    <button class="delete-btn" data-key="${key}" title="删除图片"><img src="/images/svg/xmark.svg" alt="删除"></button>
                </div>
                <div class="image-info">
                    <p class="info-p" title="${name}">${name}</p>
                    <p class="info-p">${fmtBytes(file.size)}</p>
                    <p class="info-p">${fmtDate(file.uploaded)}</p>
                </div>
            </div>`;
    }).join('');

    gallery.style.display = 'block';
    gallery.querySelectorAll('.lazy-image').forEach(img => {
        if (img.complete) img.classList.add('loaded');
        else img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
    });

    currentTotal.textContent = `${state.page}/${totalPages}`;
    renderPagination(totalPages);

    if (window.Fancybox) {
        Fancybox.bind('[data-fancybox="gallery"]', {
            Toolbar: { display: { right: ['slideshow', 'thumbs', 'close'] } },
            Thumbs: { showOnStart: false }
        });
    }
}

function renderPagination(totalPages) {
    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }

    const pages = new Set([1, totalPages, state.page - 1, state.page, state.page + 1]);
    const valid = [...pages].filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b);
    const chunks = [];
    if (state.page > 1) chunks.push(`<a class="page-link prev-page" data-page="${state.page - 1}" href="#">&laquo;</a>`);
    let previous = 0;
    valid.forEach(page => {
        if (previous && page - previous > 1) chunks.push('<a class="ellipsis page-link">...</a>');
        chunks.push(`<a class="page-link${page === state.page ? ' active' : ''}" data-page="${page}" href="#">${page}</a>`);
        previous = page;
    });
    if (state.page < totalPages) chunks.push(`<a class="page-link next-page" data-page="${state.page + 1}" href="#">&raquo;</a>`);
    pagination.innerHTML = chunks.join('');
}

function confirmDelete(key) {
    document.querySelector('.custom-confirm')?.remove();
    const box = document.createElement('div');
    box.className = 'custom-confirm';
    box.innerHTML = `
        <div class="confirm-message">确定删除这张图片吗？</div>
        <div class="confirm-buttons">
            <button id="confirm-delete">确认</button>
            <button id="cancel-delete">取消</button>
        </div>`;
    document.body.appendChild(box);

    box.querySelector('#cancel-delete').onclick = () => box.remove();
    box.querySelector('#confirm-delete').onclick = async () => {
        box.remove();
        await deleteImage(key);
    };
}

async function deleteImage(key) {
    setLoading(true);
    try {
        const response = await fetch('/api/images', {
            method: 'DELETE',
            headers: { ...auth(), 'content-type': 'application/json' },
            body: JSON.stringify({ key })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || '删除失败');
        state.files = state.files.filter(file => file.key !== key);
        const totalPages = Math.max(1, Math.ceil(state.files.length / PAGE_SIZE));
        state.page = Math.min(state.page, totalPages);
        renderGallery();
        showNotification('图片删除成功');
    } catch (error) {
        showNotification(error.message || '删除失败', 'msg-red');
    } finally {
        setLoading(false);
    }
}

document.getElementById('tokenForm').addEventListener('submit', async event => {
    event.preventDefault();
    const token = tokenInput.value.trim();
    if (!token) return;
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    button.textContent = '验证中...';
    try {
        if (!(await verifyToken(token))) throw new Error('管理口令错误');
        localStorage.setItem('pixpro-admin-token', token);
        enterAdmin();
        await loadGallery();
    } catch (error) {
        showNotification(error.message || '登录失败', 'msg-red');
    } finally {
        button.disabled = false;
        button.textContent = '登录';
    }
});

document.getElementById('logout').addEventListener('click', event => {
    event.preventDefault();
    localStorage.removeItem('pixpro-admin-token');
    tokenInput.value = '';
    state.files = [];
    gallery.innerHTML = '';
    enterLogin();
    showNotification('已退出登录');
});

document.getElementById('scroll-to-top').addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

window.addEventListener('scroll', () => {
    const button = document.getElementById('scroll-to-top');
    const rightside = document.querySelector('.rightside');
    button.classList.toggle('visible', window.scrollY > 100);
    rightside.classList.toggle('shifted', window.scrollY > 100);
});

document.addEventListener('click', async event => {
    const pageLink = event.target.closest('.page-link[data-page]');
    if (pageLink) {
        event.preventDefault();
        state.page = Number(pageLink.dataset.page);
        renderGallery();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    const copyButton = event.target.closest('.copy-btn');
    if (copyButton) {
        try {
            await navigator.clipboard.writeText(copyButton.dataset.url);
            showNotification('已复制到剪贴板');
        } catch (_) {
            showNotification('复制失败', 'msg-red');
        }
        return;
    }

    const deleteButton = event.target.closest('.delete-btn');
    if (deleteButton) confirmDelete(deleteButton.dataset.key);
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
