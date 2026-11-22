const SESSION = '__Host-forough_session';
const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();
let schemaReady;

const schema = [
  'CREATE TABLE IF NOT EXISTS content (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, revision INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS inquiries (id INTEGER PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, reply TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL, handled INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)'
];

function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }
  });
}

function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.batch(schema.map((statement) => db.prepare(statement))).catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  return schemaReady;
}

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hash(text) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}

async function equalSecret(candidate, expected) {
  const [left, right] = await Promise.all([hash(candidate), hash(expected)]);
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

async function allowAttempt(db, request, kind, period, maximum) {
  const now = Math.floor(Date.now() / 1000);
  const expires = (Math.floor(now / period) + 1) * period;
  const address = request.headers.get('CF-Connecting-IP') || 'local';
  const key = await hash(kind + ':' + expires + ':' + address);
  const results = await db.batch([
    db.prepare('DELETE FROM limits WHERE expires <= ?').bind(now),
    db.prepare('INSERT INTO limits (key, count, expires) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count').bind(key, expires)
  ]);
  return results[1].results[0].count <= maximum;
}

function requestError(status) {
  return Object.assign(new Error('Invalid request'), { status });
}

async function readJson(request, maxSize) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw requestError(415);
  const reader = request.body?.getReader();
  if (!reader) throw requestError(400);
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxSize) {
      await reader.cancel();
      throw requestError(413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw requestError(400);
  }
}

function clean(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw requestError(400);
  }
  return value.trim();
}

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw requestError(400);
  return value;
}

function list(value, max, map) {
  if (!Array.isArray(value) || value.length > max) throw requestError(400);
  return value.map(map);
}

function publicUrl(value, image = false) {
  const result = clean(value, 500);
  if (!result || (image && /^assets\/[a-z0-9][a-z0-9._-]*$/i.test(result))) return result;
  try {
    if (new URL(result).protocol === 'https:') return result;
  } catch {
    // Invalid URLs are rejected below.
  }
  throw requestError(400);
}

function locale(value) {
  const input = object(value);
  const sections = object(input.sections || {});
  return {
    brand: clean(input.brand, 80, true),
    tagline: clean(input.tagline, 150, true),
    intro: clean(input.intro, 1500, true),
    about: clean(input.about, 2000, true),
    address: clean(input.address, 300),
    services: list(input.services, 20, (item) => clean(item, 90, true)),
    steps: list(input.steps, 12, (item) => clean(item, 90, true)),
    sections: {
      headline: clean(sections.headline || '', 220),
      workTitle: clean(sections.workTitle || '', 120),
      workIntro: clean(sections.workIntro || '', 500),
      processTitle: clean(sections.processTitle || '', 120),
      teamTitle: clean(sections.teamTitle || '', 120),
      contactTitle: clean(sections.contactTitle || '', 160),
      contactIntro: clean(sections.contactIntro || '', 500)
    },
    process: list(input.process || [], 4, (entry) => {
      const step = object(entry);
      return { title: clean(step.title, 125), description: clean(step.description, 400) };
    })
  };
}

function sanitizeContent(raw) {
  const input = object(raw);
  const english = object(input.english);
  const email = clean(input.email, 254);
  const phone = clean(input.phone, 36);
  if (email && !/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(email)) throw requestError(400);
  if (phone && !/^\+?[0-9 ()-]+$/.test(phone)) throw requestError(400);
  return {
    ...locale(input), email, phone,
    team: list(input.team, 12, (entry) => {
      const person = object(entry);
      return {
        name: clean(person.name, 100, true), role: clean(person.role, 175, true),
        image: publicUrl(person.image, true)
      };
    }),
    projects: list(input.projects, 30, (entry) => {
      const project = object(entry);
      return {
        name: clean(project.name, 100, true), description: clean(project.description, 1400),
        image: publicUrl(project.image, true), url: publicUrl(project.url)
      };
    }),
    english: {
      ...locale(english),
      team: list(english.team, 12, (entry) => {
        const person = object(entry);
        return { name: clean(person.name, 100), role: clean(person.role, 175) };
      }),
      projects: list(english.projects, 30, (entry) => {
        const project = typeof entry === 'string' ? { name: entry } : object(entry);
        return { name: clean(project.name, 100), description: clean(project.description || '', 1400) };
      })
    }
  };
}

function sessionCookie(token, maxAge) {
  return SESSION + '=' + token + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=' + maxAge;
}

function sessionToken(request) {
  return request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-forough_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}

async function sessionHash(token, env) {
  return hash(token + ':' + env.ADMIN_PASSWORD + ':' + (env.ADMIN_USERNAME || 'forough'));
}

async function hasSession(db, request, env) {
  const token = sessionToken(request);
  if (!token) return false;
  const row = await db.prepare('SELECT token_hash FROM sessions WHERE token_hash = ? AND expires > ?')
    .bind(await sessionHash(token, env), Date.now()).first();
  return Boolean(row);
}

async function login(db, request, env) {
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 12) return json({ error: 'setup_required' }, 503);
  if (!await allowAttempt(db, request, 'login', 900, 8)) return json({ error: 'rate_limit' }, 429);
  const input = object(await readJson(request, 4096));
  const user = clean(input.username, 100, true);
  if (typeof input.password !== 'string' || input.password.length > 512) throw requestError(400);
  const validPassword = await equalSecret(input.password, env.ADMIN_PASSWORD);
  if (user !== (env.ADMIN_USERNAME || 'forough') || !validPassword) return json({ error: 'bad_login' }, 401);
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires <= ?').bind(now),
    db.prepare('INSERT INTO sessions (token_hash, expires) VALUES (?, ?)').bind(await sessionHash(token, env), now + SESSION_SECONDS * 1000)
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token, SESSION_SECONDS) });
}

async function createInquiry(db, request) {
  if (!await allowAttempt(db, request, 'inquiry', 600, 10)) return json({ error: 'rate_limit' }, 429);
  const input = object(await readJson(request, 12000));
  const requestId = clean(input.requestId, 36, true);
  if (!/^[a-f0-9-]{36}$/i.test(requestId)) throw requestError(400);
  if (input.website) return json({ ok: true }, 201);
  const name = clean(input.name, 100, true);
  const reply = clean(input.reply, 180, true);
  const message = clean(input.message, 2500, true);
  await db.prepare('INSERT INTO inquiries (request_id, name, reply, message, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(request_id) DO NOTHING')
    .bind(requestId, name, reply, message, Date.now()).run();
  return json({ ok: true }, 201);
}

async function api(request, env, path, origin) {
  const method = request.method;
  if (!['GET', 'POST', 'PUT', 'PATCH'].includes(method)) return json({ error: 'method' }, 405);
  if (method !== 'GET' && request.headers.get('Origin') !== origin) return json({ error: 'origin' }, 403);
  if (!env.DB) return json({ error: 'setup_required' }, 503);
  const db = env.DB;
  await ensureSchema(db);
  const configured = env.ADMIN_PASSWORD?.length >= 12;

  if (path === '/api/site' && method === 'GET') {
    const row = await db.prepare('SELECT data, revision FROM content WHERE id = 1').first();
    return json({ content: row ? JSON.parse(row.data) : null, revision: row?.revision || 0, inbox: configured });
  }
  if (path === '/api/inquiries' && method === 'POST') {
    return configured ? createInquiry(db, request) : json({ error: 'setup_required' }, 503);
  }
  if (path === '/api/admin/login' && method === 'POST') return login(db, request, env);
  if (!path.startsWith('/api/admin/')) return json({ error: 'not_found' }, 404);
  if (!configured) return json({ error: 'setup_required' }, 503);
  if (!await hasSession(db, request, env)) return json({ error: 'unauthorized' }, 401);

  if (path === '/api/admin/session' && method === 'GET') return json({ ok: true });
  if (path === '/api/admin/logout' && method === 'POST') {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sessionHash(sessionToken(request), env)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }
  if (path === '/api/admin/content' && method === 'PUT') {
    const input = object(await readJson(request, 180000));
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw requestError(400);
    const content = sanitizeContent(input.content);
    const revision = input.revision + 1;
    const result = input.revision === 0
      ? await db.prepare('INSERT INTO content (id, data, revision) VALUES (1, ?, 1) ON CONFLICT(id) DO NOTHING').bind(JSON.stringify(content)).run()
      : await db.prepare('UPDATE content SET data = ?, revision = ? WHERE id = 1 AND revision = ?')
        .bind(JSON.stringify(content), revision, input.revision).run();
    if (!result.meta.changes) return json({ error: 'conflict' }, 409);
    return json({ content, revision });
  }
  if (path === '/api/admin/inquiries' && method === 'GET') {
    const url = new URL(request.url);
    const cursor = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(cursor) || cursor < 1) throw requestError(400);
    const { results } = await db.prepare('SELECT id, name, reply, message, created_at, handled FROM inquiries WHERE id < ? ORDER BY id DESC LIMIT 51')
      .bind(cursor).all();
    const next = results.length > 50 ? results[49].id : null;
    return json({ items: results.slice(0, 50), next });
  }
  const match = /^\/api\/admin\/inquiries\/([1-9]\d{0,14})$/.exec(path);
  if (match && method === 'PATCH') {
    const input = object(await readJson(request, 1000));
    if (typeof input.handled !== 'boolean') throw requestError(400);
    const result = await db.prepare('UPDATE inquiries SET handled = ? WHERE id = ?')
      .bind(Number(input.handled), Number(match[1])).run();
    return result.meta.changes ? json({ ok: true }) : json({ error: 'not_found' }, 404);
  }
  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url.pathname, url.origin);
      } catch (error) {
        if (!error.status) console.error('Forough API failed', url.pathname);
        return json({ error: error.status ? 'invalid_request' : 'server_error' }, error.status || 500);
      }
    }
    const response = await env.ASSETS.fetch(request);
    if (!/^\/admin(?:\.html|\/)?$/.test(url.pathname)) return response;
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', "default-src 'self'; img-src 'self' https:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
  }
};
