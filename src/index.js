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

function makeKey(file) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const original = safeName(file.name || `image.${extFromType(file.type)}`);
  const ext = original.includes('.') ? original.split('.').pop() : extFromType(file.type);
  return `images/${yyyy}/${mm}/${dd}/${id}.${safeName(ext).toLowerCase()}`;
}

function imageUrl(request, key) {
  const url = new URL(request.url);
  return `${url.origin}/i/${key.replace(/^images\//, '')}`;
}

async function upload(request, env) {
  if (!isAuthorized(request, env)) return unauthorized();

  const form = await request.formData();
  const files = form.getAll('files').filter((f) => f && typeof f.arrayBuffer === 'function');
  if (!files.length) return json({ ok: false, error: 'No image files provided' }, 400);

  const maxBytes = Math.max(1, Number(env.MAX_UPLOAD_MB || 10)) * 1024 * 1024;
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif']);
  const uploaded = [];

  for (const file of files) {
    if (!allowed.has(file.type)) {
      return json({ ok: false, error: `Unsupported type: ${file.type || file.name}` }, 415);
    }
    if (file.size > maxBytes) {
      return json({ ok: false, error: `${file.name} exceeds ${env.MAX_UPLOAD_MB || 10} MB` }, 413);
    }

    const key = makeKey(file);
    await env.IMAGES.put(key, file.stream(), {
      httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: {
        originalName: file.name || '',
        uploadedAt: new Date().toISOString(),
        size: String(file.size),
      },
    });

    uploaded.push({
      key,
      name: file.name,
      size: file.size,
      type: file.type,
      url: imageUrl(request, key),
    });
  }

  return json({ ok: true, files: uploaded });
}

async function listImages(request, env) {
  if (!isAuthorized(request, env)) return unauthorized();
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 60), 1), 200);
  const cursor = url.searchParams.get('cursor') || undefined;
  const result = await env.IMAGES.list({ prefix: 'images/', limit, cursor, include: ['customMetadata', 'httpMetadata'] });

  return json({
    ok: true,
    cursor: result.truncated ? result.cursor : null,
    truncated: result.truncated,
    files: result.objects
      .sort((a, b) => new Date(b.uploaded || 0) - new Date(a.uploaded || 0))
      .map((o) => ({
        key: o.key,
        size: o.size,
        uploaded: o.uploaded,
        type: o.httpMetadata?.contentType || '',
        originalName: o.customMetadata?.originalName || '',
        url: imageUrl(request, o.key),
      })),
  });
}

async function removeImage(request, env) {
  if (!isAuthorized(request, env)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const key = String(body.key || '');
  if (!key.startsWith('images/')) return json({ ok: false, error: 'Invalid key' }, 400);
  await env.IMAGES.delete(key);
  return json({ ok: true });
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/health') return json({ ok: true, service: 'pixpro-r2' });
      if (path === '/api/upload' && request.method === 'POST') return upload(request, env);
      if (path === '/api/images' && request.method === 'GET') return listImages(request, env);
      if (path === '/api/images' && request.method === 'DELETE') return removeImage(request, env);
      if (path.startsWith('/i/') && request.method === 'GET') return serveImage(request, env, path);

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ ok: false, error: error?.message || 'Internal error' }, 500);
    }
  },
};
