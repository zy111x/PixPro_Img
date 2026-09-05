const $ = (id) => document.getElementById(id);

const els = {
    imageInput: $('imageInput'),
    imageUploadBox: $('imageUploadBox'),
    previewContainer: $('imagePreviewContainer'),
    preview: $('imagePreview'),
    prev: $('prevButton'),
    next: $('nextButton'),
    counter: $('imageCounter'),
    deleteBtn: $('deleteImageButton'),
    thumbnailStrip: $('thumbnailStrip'),
    thumbnails: $('thumbnailScrollContainer'),
    urlInput: $('pasteOrUrlInput'),
    quality: $('qualityInput'),
    qualityOutput: $('qualityOutput'),
    progressContainer: $('progressContainer'),
    progressBar: $('progressBar'),
    originalWidth: $('originalWidth'),
    originalSize: $('originalSize'),
    compressedWidth: $('compressedWidth'),
    compressedSize: $('compressedSize'),
    compressionRatio: $('compressionRatio'),
    savedSpace: $('savedSpace'),
    urlLinkText: $('urlLinkText'),
    markdownLinkText: $('markdownLinkText'),
    htmlLinkText: $('htmlLinkText'),
};

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif']);
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const state = { items: [], current: -1 };

function getToken(interactive = true) {
    let token = (localStorage.getItem('pixpro-admin-token') || '').trim();
    if (!token && interactive) {
        token = (window.prompt('请输入 PixPro ADMIN_TOKEN（仅保存在当前浏览器）') || '').trim();
        if (token) localStorage.setItem('pixpro-admin-token', token);
    }
    return token;
}

function auth() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
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
    item.addEventListener('click', close);
    setTimeout(close, 2200);
}

function fmtBytes(bytes = 0) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

function setProgress(percent) {
    els.progressContainer.style.display = 'block';
    els.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    els.progressBar.textContent = `${Math.round(percent)}%`;
    if (percent >= 100) {
        setTimeout(() => {
            els.progressContainer.style.display = 'none';
            els.progressBar.style.width = '0%';
            els.progressBar.textContent = '';
        }, 450);
    }
}

function readDimensions(blob) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            const result = { width: img.naturalWidth || img.width || 0, height: img.naturalHeight || img.height || 0 };
            URL.revokeObjectURL(url);
            resolve(result);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve({ width: 0, height: 0 });
        };
        img.src = url;
    });
}

async function optimize(file) {
    const original = await readDimensions(file);
    const quality = Number(els.quality.value) / 100;
    if (!['image/jpeg', 'image/png'].includes(file.type) || quality >= 1 || !original.width || !original.height) {
        return { uploadFile: file, original, compressed: original };
    }

    try {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        bitmap.close?.();
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
        if (!blob || blob.size >= file.size) return { uploadFile: file, original, compressed: original };
        const base = (file.name || 'image').replace(/\.[^.]+$/, '');
        const uploadFile = new File([blob], `${base}.webp`, { type: 'image/webp', lastModified: Date.now() });
        return { uploadFile, original, compressed: { width: canvas.width, height: canvas.height } };
    } catch (error) {
        console.warn('客户端压缩失败，改用原图：', error);
        return { uploadFile: file, original, compressed: original };
    }
}

function uploadFile(file) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        if (!token) return reject(new Error('未设置 ADMIN_TOKEN'));
        const form = new FormData();
        form.append('files', file, file.name || 'image');
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload', true);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) setProgress((event.loaded / event.total) * 95);
        };
        xhr.onload = () => {
            let data = {};
            try { data = JSON.parse(xhr.responseText); } catch (_) {}
            if (xhr.status >= 200 && xhr.status < 300 && data.ok && data.files?.[0]) {
                setProgress(100);
                resolve(data.files[0]);
            } else {
                if (xhr.status === 401) localStorage.removeItem('pixpro-admin-token');
                reject(new Error(data.error || `上传失败 (${xhr.status})`));
            }
        };
        xhr.onerror = () => reject(new Error('网络请求失败'));
        xhr.send(form);
    });
}

async function processOne(file) {
    const item = {
        id: crypto.randomUUID(),
        originalFile: file,
        uploadFile: file,
        previewUrl: URL.createObjectURL(file),
        original: { width: 0, height: 0 },
        compressed: { width: 0, height: 0 },
        status: 'uploading',
        result: null,
        error: null,
    };
    state.items.push(item);
    if (state.current < 0) state.current = 0;
    render();

    try {
        const optimized = await optimize(file);
        item.uploadFile = optimized.uploadFile;
        item.original = optimized.original;
        item.compressed = optimized.compressed;
        item.result = await uploadFile(item.uploadFile);
        item.status = 'completed';
    } catch (error) {
        item.status = 'error';
        item.error = error.message || '上传失败';
        toast(item.error, 'msg-red');
    }
    render();
}

async function addFiles(fileList) {
    const files = [...fileList].filter(Boolean);
    const valid = [];
    for (const file of files) {
        if (!allowedTypes.has(file.type)) {
            toast(`不支持的文件类型：${file.name || file.type}`, 'msg-red');
            continue;
        }
        if (file.size > MAX_FILE_SIZE) {
            toast(`${file.name} 超过 10 MB`, 'msg-red');
            continue;
        }
        valid.push(file);
    }
    if (!valid.length) return;
    if (!getToken()) return toast('需要 ADMIN_TOKEN 才能上传', 'msg-red');
    for (const file of valid) await processOne(file);
    els.imageInput.value = '';
}

function formatFor(item, type) {
    if (!item?.result?.url) return '';
    const url = item.result.url;
    const name = item.originalFile?.name || item.result.name || 'image';
    if (type === 'markdown') return `![${name}](${url})`;
    if (type === 'html') return `<img src="${url}" alt="${name}">`;
    return url;
}

async function copyText(text, success = '已复制到剪贴板') {
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
    toast(success);
}

function currentItem() {
    return state.current >= 0 ? state.items[state.current] : null;
}

function updateInfo(item) {
    if (!item) {
        els.originalWidth.textContent = '-';
        els.originalSize.textContent = '-';
        els.compressedWidth.textContent = '-';
        els.compressedSize.textContent = '-';
        els.compressionRatio.textContent = '-';
        els.savedSpace.textContent = '-';
        return;
    }
    const ow = item.original?.width || 0;
    const oh = item.original?.height || 0;
    const cw = item.compressed?.width || ow;
    const ch = item.compressed?.height || oh;
    const originalBytes = item.originalFile?.size || 0;
    const compressedBytes = item.uploadFile?.size || originalBytes;
    els.originalWidth.textContent = ow && oh ? `${ow} × ${oh} px` : '-';
    els.originalSize.textContent = fmtBytes(originalBytes);
    els.compressedWidth.textContent = cw && ch ? `${cw} × ${ch} px` : '-';
    els.compressedSize.textContent = fmtBytes(compressedBytes);
    const saved = Math.max(0, originalBytes - compressedBytes);
    const ratio = originalBytes ? (saved / originalBytes) * 100 : 0;
    els.compressionRatio.textContent = `${ratio.toFixed(1)}%`;
    els.savedSpace.textContent = fmtBytes(saved);
}

function updateCopy(item) {
    const ready = Boolean(item?.result?.url);
    document.querySelectorAll('.copy-tab-btn').forEach((button) => { button.disabled = !ready; });
    document.querySelectorAll('.copy-link-display').forEach((node) => node.classList.toggle('disabled', !ready));
    els.urlLinkText.textContent = formatFor(item, 'url');
    els.markdownLinkText.textContent = formatFor(item, 'markdown');
    els.htmlLinkText.textContent = formatFor(item, 'html');
}

function renderThumbnails() {
    els.thumbnails.innerHTML = '';
    state.items.forEach((item, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'thumbnail-wrapper';
        const thumb = document.createElement('div');
        thumb.className = `thumbnail${index === state.current ? ' active' : ''}`;
        thumb.title = item.originalFile?.name || '';
        const img = document.createElement('img');
        img.src = item.previewUrl || item.result?.url || '';
        img.alt = '';
        const status = document.createElement('span');
        status.className = `thumbnail-status ${item.status}`;
        thumb.append(img, status);
        thumb.addEventListener('click', (event) => {
            event.stopPropagation();
            state.current = index;
            render();
        });
        wrapper.appendChild(thumb);
        els.thumbnails.appendChild(wrapper);
    });
    els.thumbnailStrip.classList.toggle('active', state.items.length > 0);
}

function render() {
    const item = currentItem();
    const count = state.items.length;
    const has = Boolean(item);
    els.previewContainer.classList.toggle('active', has);
    els.deleteBtn.style.display = has ? 'flex' : 'none';
    els.preview.src = has ? (item.previewUrl || item.result?.url || '') : '';
    els.counter.textContent = has && count > 1 ? `${state.current + 1} / ${count}` : '';
    els.prev.style.display = count > 1 ? 'flex' : 'none';
    els.next.style.display = count > 1 ? 'flex' : 'none';
    renderThumbnails();
    updateInfo(item);
    updateCopy(item);
}

function switchTo(delta) {
    if (state.items.length < 2) return;
    state.current = (state.current + delta + state.items.length) % state.items.length;
    render();
    const active = els.thumbnails.querySelector('.thumbnail.active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

function clearAll() {
    state.items.forEach((item) => item.previewUrl?.startsWith('blob:') && URL.revokeObjectURL(item.previewUrl));
    state.items = [];
    state.current = -1;
    els.urlInput.value = '';
    render();
    toast('已清除本地上传记录');
}

async function uploadRemoteUrl(value) {
    let url;
    try { url = new URL(value); } catch (_) { return toast('请输入有效图片 URL', 'msg-red'); }
    if (!getToken()) return toast('需要 ADMIN_TOKEN 才能上传', 'msg-red');
    toast('正在抓取网络图片…');
    try {
        const response = await fetch('/api/upload-url', {
            method: 'POST',
            headers: { ...auth(), 'content-type': 'application/json' },
            body: JSON.stringify({ url: url.toString() }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok || !data.files?.[0]) throw new Error(data.error || '网络图片上传失败');
        const result = data.files[0];
        const dims = await readDimensions(await fetch(result.url).then((r) => r.blob())).catch(() => ({ width: 0, height: 0 }));
        const placeholder = new File([], result.name || 'remote-image', { type: result.type || 'image/*' });
        const item = {
            id: crypto.randomUUID(), originalFile: placeholder, uploadFile: { size: result.size },
            previewUrl: result.url, original: dims, compressed: dims, status: 'completed', result,
        };
        Object.defineProperty(item.originalFile, 'size', { value: result.size, configurable: true });
        state.items.push(item);
        state.current = state.items.length - 1;
        els.urlInput.value = '';
        render();
        toast('网络图片上传成功');
    } catch (error) {
        toast(error.message || '网络图片上传失败', 'msg-red');
    }
}

els.quality.addEventListener('input', () => { els.qualityOutput.textContent = els.quality.value; });
els.imageInput.addEventListener('change', () => addFiles(els.imageInput.files));
els.prev.addEventListener('click', (event) => { event.stopPropagation(); switchTo(-1); });
els.next.addEventListener('click', (event) => { event.stopPropagation(); switchTo(1); });
els.deleteBtn.addEventListener('click', (event) => { event.stopPropagation(); clearAll(); });

els.imageUploadBox.addEventListener('dragover', (event) => { event.preventDefault(); els.imageUploadBox.classList.add('dragover'); });
els.imageUploadBox.addEventListener('dragleave', () => els.imageUploadBox.classList.remove('dragover'));
els.imageUploadBox.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    els.imageUploadBox.classList.remove('dragover');
    addFiles(event.dataTransfer.files);
});
els.imageUploadBox.addEventListener('wheel', (event) => {
    if (state.items.length < 2) return;
    event.preventDefault();
    switchTo(event.deltaY > 0 ? 1 : -1);
}, { passive: false });

document.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files || [])].filter((file) => allowedTypes.has(file.type));
    if (files.length) {
        event.preventDefault();
        addFiles(files);
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') switchTo(-1);
    if (event.key === 'ArrowRight') switchTo(1);
    if (event.key === 'Escape' && state.items.length) clearAll();
});

els.urlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        const value = els.urlInput.value.trim();
        if (value) uploadRemoteUrl(value);
    }
});

document.querySelectorAll('.copy-tab-btn, .copy-link-display').forEach((node) => {
    node.addEventListener('click', (event) => {
        if (node.classList.contains('disabled') || node.disabled) return;
        const type = node.dataset.type;
        if (event.ctrlKey || event.metaKey) {
            const text = state.items.map((item) => formatFor(item, type)).filter(Boolean).join('\n');
            copyText(text, `已批量复制 ${state.items.filter((item) => item.result?.url).length} 张图片`);
        } else {
            copyText(formatFor(currentItem(), type));
        }
    });
});

els.qualityOutput.textContent = els.quality.value;
render();
