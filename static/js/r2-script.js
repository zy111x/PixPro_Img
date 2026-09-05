const elements = {
    imageInput: document.getElementById('imageInput'),
    imagePreview: document.getElementById('imagePreview'),
    qualityInput: document.getElementById('qualityInput'),
    qualityOutput: document.getElementById('qualityOutput'),
    progressBar: document.getElementById('progressBar'),
    progressContainer: document.getElementById('progressContainer'),
    originalWidth: document.getElementById('originalWidth'),
    originalHeight: document.getElementById('originalHeight'),
    originalSize: document.getElementById('originalSize'),
    compressedWidth: document.getElementById('compressedWidth'),
    compressedHeight: document.getElementById('compressedHeight'),
    compressedSize: document.getElementById('compressedSize'),
    pasteOrUrlInput: document.getElementById('pasteOrUrlInput'),
    deleteImageButton: document.getElementById('deleteImageButton'),
    imageUploadBox: document.getElementById('imageUploadBox')
};

const maxFileSize = 10 * 1024 * 1024;
const maxFilesPerUpload = 5;
const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif'];
let urlTimer = null;

function getToken(interactive = true) {
    let token = localStorage.getItem('pixpro-admin-token') || '';
    if (!token && interactive) {
        token = (window.prompt('请输入 PixPro ADMIN_TOKEN（只会保存在当前浏览器）') || '').trim();
        if (token) localStorage.setItem('pixpro-admin-token', token);
    }
    return token;
}

function authHeaders() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
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

function updateQualityOutput() {
    elements.qualityOutput.textContent = elements.qualityInput.value;
}

function setProgress(percent) {
    elements.progressContainer.style.display = 'block';
    elements.progressBar.style.width = `${percent}%`;
    elements.progressBar.textContent = `${Math.round(percent)}%`;
    if (percent >= 100) {
        setTimeout(() => {
            elements.progressContainer.style.display = 'none';
            elements.progressBar.style.width = '0%';
            elements.progressBar.textContent = '';
        }, 500);
    }
}

function previewImage(file) {
    const reader = new FileReader();
    reader.onload = () => {
        elements.imagePreview.src = reader.result;
        elements.deleteImageButton.style.display = 'block';
    };
    reader.readAsDataURL(file);
}

function readDimensions(blob) {
    return new Promise(resolve => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            const result = { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
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

async function optimizeImage(file) {
    const original = await readDimensions(file);
    const quality = Number(elements.qualityInput.value) / 100;
    if (!['image/jpeg', 'image/png'].includes(file.type) || quality >= 1 || !original.width || !original.height) {
        return { file, original, compressed: original };
    }

    try {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close?.();
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if (!blob) return { file, original, compressed: original };
        const base = (file.name || 'image').replace(/\.[^.]+$/, '');
        const optimized = new File([blob], `${base}.webp`, { type: 'image/webp', lastModified: Date.now() });
        return { file: optimized, original, compressed: { width: canvas.width, height: canvas.height } };
    } catch (error) {
        console.warn('浏览器压缩失败，使用原图上传：', error);
        return { file, original, compressed: original };
    }
}

function uploadBlob(file) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        if (!token) return reject(new Error('未设置 ADMIN_TOKEN'));
        const formData = new FormData();
        formData.append('files', file, file.name || 'image');
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload', true);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.upload.addEventListener('progress', event => {
            if (event.lengthComputable) setProgress((event.loaded / event.total) * 95);
        });
        xhr.onload = () => {
            let data = {};
            try { data = JSON.parse(xhr.responseText); } catch (_) {}
            if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
                setProgress(100);
                resolve(data.files[0]);
            } else {
                if (xhr.status === 401) localStorage.removeItem('pixpro-admin-token');
                reject(new Error(data.error || `上传失败 (${xhr.status})`));
            }
        };
        xhr.onerror = () => reject(new Error('网络请求失败'));
        xhr.send(formData);
    });
}

function createInput(value) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'copy-indicator blur';
    input.value = value;
    input.readOnly = true;
    input.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(value);
            showNotification('已复制到剪贴板');
        } catch (_) {
            input.select();
            document.execCommand('copy');
            showNotification('已复制到剪贴板');
        }
    });
    return input;
}

function appendResult(result) {
    const imageName = decodeURIComponent(result.url.split('/').pop().split('?')[0]);
    const values = [
        ['imageUrlContainer', result.url],
        ['markdownUrlContainer', `![${imageName}](${result.url})`],
        ['markdownLinkUrlContainer', `[![${imageName}](${result.url})](${result.url})`],
        ['htmlUrlContainer', `<img src="${result.url}" alt="${imageName}">`]
    ];
    values.forEach(([id, value]) => document.getElementById(id).appendChild(createInput(value)));
}

async function processFile(file) {
    if (!allowedTypes.includes(file.type)) {
        showNotification('不支持的文件类型', 'msg-red');
        return;
    }
    if (file.size > maxFileSize) {
        showNotification(`文件大小超过限制，最大允许 ${maxFileSize / 1024 / 1024}MB`, 'msg-red');
        return;
    }

    previewImage(file);
    elements.originalSize.textContent = (file.size / 1024).toFixed(2);
    const optimized = await optimizeImage(file);
    elements.originalWidth.textContent = optimized.original.width || '-';
    elements.originalHeight.textContent = optimized.original.height || '-';
    elements.compressedWidth.textContent = optimized.compressed.width || '-';
    elements.compressedHeight.textContent = optimized.compressed.height || '-';
    elements.compressedSize.textContent = (optimized.file.size / 1024).toFixed(2);

    try {
        const uploaded = await uploadBlob(optimized.file);
        appendResult(uploaded);
        showNotification('图片上传成功');
    } catch (error) {
        showNotification(error.message || '上传失败', 'msg-red');
    }
}

async function handleFileInput(files) {
    const list = [...files];
    if (!list.length) return;
    if (list.length > maxFilesPerUpload) {
        showNotification(`单次最多上传 ${maxFilesPerUpload} 张图片`, 'msg-red');
        return;
    }
    for (const file of list) await processFile(file);
    elements.imageInput.value = '';
}

async function uploadRemoteUrl(rawUrl) {
    const value = rawUrl.trim();
    if (!value) return;
    let parsed;
    try { parsed = new URL(value); } catch (_) { return; }
    if (!['http:', 'https:'].includes(parsed.protocol)) return;
    const token = getToken();
    if (!token) return;
    showNotification('正在抓取远程图片...');
    try {
        const response = await fetch('/api/upload-url', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ url: value })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || '远程图片上传失败');
        const uploaded = data.files[0];
        elements.imagePreview.src = uploaded.url;
        elements.deleteImageButton.style.display = 'block';
        elements.originalSize.textContent = (uploaded.size / 1024).toFixed(2);
        elements.compressedSize.textContent = (uploaded.size / 1024).toFixed(2);
        const img = new Image();
        img.onload = () => {
            elements.originalWidth.textContent = img.naturalWidth;
            elements.originalHeight.textContent = img.naturalHeight;
            elements.compressedWidth.textContent = img.naturalWidth;
            elements.compressedHeight.textContent = img.naturalHeight;
        };
        img.src = uploaded.url;
        appendResult(uploaded);
        showNotification('远程图片上传成功');
    } catch (error) {
        showNotification(error.message || '远程图片上传失败', 'msg-red');
    }
}

function clearImageInfo(event) {
    event?.preventDefault();
    elements.imagePreview.src = '/images/svg/up.svg';
    elements.deleteImageButton.style.display = 'none';
    [elements.originalWidth, elements.originalHeight, elements.originalSize,
     elements.compressedWidth, elements.compressedHeight, elements.compressedSize].forEach(el => el.textContent = '');
    ['imageUrlContainer', 'markdownUrlContainer', 'markdownLinkUrlContainer', 'htmlUrlContainer'].forEach(id => {
        document.getElementById(id).innerHTML = '';
    });
    elements.pasteOrUrlInput.value = '';
    showNotification('图片信息清理成功');
}

elements.qualityInput.addEventListener('input', updateQualityOutput);
elements.imageInput.addEventListener('change', () => handleFileInput(elements.imageInput.files));
elements.deleteImageButton.addEventListener('click', clearImageInfo);

elements.pasteOrUrlInput.addEventListener('paste', event => {
    const files = [...event.clipboardData.items]
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter(Boolean);
    if (files.length) {
        event.preventDefault();
        handleFileInput(files);
    }
});

elements.pasteOrUrlInput.addEventListener('input', () => {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => uploadRemoteUrl(elements.pasteOrUrlInput.value), 900);
});

elements.pasteOrUrlInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        event.preventDefault();
        clearTimeout(urlTimer);
        uploadRemoteUrl(elements.pasteOrUrlInput.value);
    }
});

elements.imageUploadBox.addEventListener('dragover', event => {
    event.preventDefault();
    elements.imageUploadBox.style.border = '2px dashed blue';
});
elements.imageUploadBox.addEventListener('dragleave', () => {
    elements.imageUploadBox.style.border = '2px dashed #ccc';
});
elements.imageUploadBox.addEventListener('drop', event => {
    event.preventDefault();
    event.stopPropagation();
    elements.imageUploadBox.style.border = '2px dashed #ccc';
    handleFileInput(event.dataTransfer.files);
});

document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
        const target = button.getAttribute('data-target');
        document.querySelectorAll('.tab-pane, .tab-button').forEach(el => el.classList.remove('active'));
        document.getElementById(target).classList.add('active');
        button.classList.add('active');
    });
});

updateQualityOutput();
