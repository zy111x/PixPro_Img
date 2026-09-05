const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

function unauthorized() {
  return json({ ok: false, error: 'Unauthorized' }, 401, {
    'www-authenticate': 'Bearer realm="PixPro R2"',
  });
}

function tokenFrom(request) {
  const auth = request.headers.get('authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

function isAuthorized(request, env) {
  return Boolean(env.ADMIN_TOKEN) && tokenFrom(request) === env.ADMIN_TOKEN;
}

function safeName(name = 'image') {
  return name
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'image';
}

function extFromType(type = '') {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
  };
  return map[type] || 'bin';
}

function makeKey(fileLike = {}) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const original = safeName(fileLike.name || `image.${extFromType(fileLike.type)}`);
  const ext = original.includes('.') ? original.split('.').pop() : extFromType(fileLike.type);
  return `images/${yyyy}/${mm}/${dd}/${id}.${safeName(ext).toLowerCase()}`;
}

function publicBaseUrl(request, env) {
  return String(env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, '');
}

function imageUrl(request, env, key) {
  return `${publicBaseUrl(request, env)}/i/${key.replace(/^images\//, '')}`;
}

function allowedImageTypes() {
  return new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif']);
}

function maxUploadBytes(env) {
  return Math.max(1, Number(env.MAX_UPLOAD_MB || 10)) * 1024 * 1024;
}

async function storeImage(request, env, { body, name, size, type }) {
  const key = makeKey({ name, type });
  await env.IMAGES.put(key, body, {
    httpMetadata: {
      contentType: type,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      originalName: name || '',
      uploadedAt: new Date().toISOString(),
      size: String(size || 0),
    },
  });

  return {
    key,
    name: name || key.split('/').pop(),
    size: Number(size || 0),
    type,
    url: imageUrl(request, env, key),
  };
}

async function upload(request, env) {
  if (!isAuthorized(request, env)) return unauthorized();

  const form = await request.formData();
  const files = [...form.getAll('files'), ...form.getAll('image')]
    .filter((file) => file && typeof file.arrayBuffer === 'function');
  if (!files.length) return json({ ok: false, error: 'No image files provided' }, 400);

  const maxBytes = maxUploadBytes(env);
  const allowed = allowedImageTypes();
  const uploaded = [];

  for (const file of files) {
    if (!allowed.has(file.type)) {
      return json({ ok: false, error: `Unsupported type: ${file.type || file.name}` }, 415);
    }
    if (file.size > maxBytes) {
      return json({ ok: false, error: `${file.name} exceeds ${env.MAX_UPLOAD_MB || 10} MB` }, 413);
    }

    uploaded.push(await storeImage(request, env, {
      body: file.stream(),
      name: file.name,
      size: file.size,
      type: file.type,
    }));
  }

  return json({ ok: true, files: uploaded });
}

function isPrivateHostname(hostname) {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d{1,3})\./);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

async function uploadFromUrl(request, env) {
  if (!isAuthorized(request, env)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  let remote;
  try {
    remote = new URL(String(body.url || ''));
  } catch (_) {
    return json({ ok: false, error: 'Invalid image URL' }, 400);
  }

  if (!['http:', 'https:'].includes(remote.protocol) || isPrivateHostname(remote.hostname)) {
    return json({ ok: false, error: 'Unsupported image URL' }, 400);
  }

  const response = await fetch(remote.toString(), {
    headers: { 'user-agent': 'PixPro-R2/1.0' },
    redirect: 'follow',
  });
  if (!response.ok) return json({ ok: false, error: `Remote server returned ${response.status}` }, 400);

  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!allowedImageTypes().has(type)) {
    return json({ ok: false, error: `Remote resource is not a supported image (${type || 'unknown'})` }, 415);
  }

  const maxBytes = maxUploadBytes(env);
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize && declaredSize > maxBytes) {
    return json({ ok: false, error: `Remote image exceeds ${env.MAX_UPLOAD_MB || 10} MB` }, 413);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    return json({ ok: false, error: `Remote image exceeds ${env.MAX_UPLOAD_MB || 10} MB` }, 413);
  }

  let remoteName = decodeURIComponent(remote.pathname.split('/').pop() || 'image');
  if (!remoteName.includes('.')) remoteName = `${remoteName}.${extFromType(type)}`;

  const uploaded = await storeImage(request, env, {
    body: buffer,
    name: remoteName,
    size: buffer.byteLength,
    type,
  });

  return json({ ok: true, files: [uploaded] });
}

async function listImages(request, env) {
  if (!isAuthorized(request, env)) return unauthorized();
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 60), 1), 1000);
  const cursor = url.searchParams.get('cursor') || undefined;
  const result = await env.IMAGES.list({
    prefix: 'images/',
    limit,
    cursor,
    include: ['customMetadata', 'httpMetadata'],
  });

  return json({
    ok: true,
    cursor: result.truncated ? result.cursor : null,
    truncated: result.truncated,
    files: result.objects
      .sort((a, b) => new Date(b.uploaded || 0) - new Date(a.uploaded || 0))
      .map((object) => ({
        key: object.key,
        size: object.size,
        uploaded: object.uploaded,
        type: object.httpMetadata?.contentType || '',
        originalName: object.customMetadata?.originalName || '',
        url: imageUrl(request, env, object.key),
      })),
  });
}

async function deleteImages(request, env) {
  if (!isAuthorized(request, env)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const keys = Array.isArray(body.keys)
    ? body.keys.map(String)
    : body.key
      ? [String(body.key)]
      : [];

  const valid = [...new Set(keys.filter((key) => key.startsWith('images/')))];
  if (!valid.length || valid.length !== keys.length) {
    return json({ ok: false, error: 'Invalid image key' }, 400);
  }

  await env.IMAGES.delete(valid);
  return json({ ok: true, deleted: valid.length, keys: valid });
}

async function serveImage(request, env, pathname) {
  const key = `images/${decodeURIComponent(pathname.slice('/i/'.length))}`;
  const object = await env.IMAGES.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  if (!headers.has('cache-control')) headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
}

async function serveUpstreamStaticAlias(request, env) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/static/, '') || '/';
  return env.ASSETS.fetch(new Request(url.toString(), request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/health') return json({ ok: true, service: 'pixpro-r2' });
      if (path === '/api/upload' && request.method === 'POST') return upload(request, env);
      if (path === '/api/upload-url' && request.method === 'POST') return uploadFromUrl(request, env);
      if (path === '/api/images' && request.method === 'GET') return listImages(request, env);
      if (path === '/api/images' && request.method === 'DELETE') return deleteImages(request, env);
      if (path === '/api/delete' && request.method === 'POST') return deleteImages(request, env);
      if (path.startsWith('/i/') && request.method === 'GET') return serveImage(request, env, path);
      if (path.startsWith('/static/') && ['GET', 'HEAD'].includes(request.method)) return serveUpstreamStaticAlias(request, env);

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ ok: false, error: error?.message || 'Internal error' }, 500);
    }
  },
};
