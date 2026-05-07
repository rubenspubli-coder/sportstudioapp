const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = process.env.PORT || 8080;
const API_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const JWT_SECRET = process.env.JWT_SECRET || 'cinematic_secret_change_me_in_railway';
const DATABASE_URL = process.env.DATABASE_URL;

console.log('API_KEY length:', API_KEY.length);
console.log('API_KEY starts with:', API_KEY.substring(0, 15));
console.log('DATABASE_URL set:', !!DATABASE_URL);

// ── PostgreSQL Pool ──────────────────────────────────────────────────────────
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

// ── Inicializar banco de dados ───────────────────────────────────────────────
async function initDB() {
  if (!pool) { console.warn('No DATABASE_URL — DB features disabled'); return; }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(80) UNIQUE NOT NULL,
        password_hash VARCHAR(128) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS site_config (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Inserir admin padrão se não existir
    const exists = await pool.query('SELECT id FROM admin_users WHERE username = $1', ['admin']);
    if (exists.rows.length === 0) {
      const hash = sha256('pablo2025');
      await pool.query(
        'INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)',
        ['admin', hash]
      );
      console.log('Default admin user created (admin/pablo2025)');
    }

    // Inserir config padrão se não existir
    const defaults = {
      headline: 'Cinematic<br><span class="gradient-text">AI Studio</span>',
      subheadline: 'Agentes inteligentes que automatizam processos<br>e elevam o padrão profissional e performance do criativo/campanha.',
      videoUrl: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_065045_c44942da-53c6-4804-b734-f9e07fc22e08.mp4',
      navLinks: JSON.stringify([
        { label: 'Sports', url: 'sports.html' },
        { label: 'Illusion', url: 'illusion.html' },
        { label: 'Mascot', url: 'mascot.html' },
        { label: 'Lettering', url: 'lettering.html' },
        { label: 'Live Action', url: 'liveaction.html' },
        { label: 'Extrator', url: 'extraidor.html' }
      ]),
      tickerItems: JSON.stringify([
        { icon: 'A', label: 'Anthropic' },
        { icon: 'C', label: 'Claude' },
        { icon: 'U', label: 'Unreal 5' },
        { icon: 'P', label: 'RenderMan' },
        { icon: 'D', label: 'DreamWorks' },
        { icon: 'M', label: 'MoonRay' },
        { icon: 'S', label: 'Stable Diffusion' },
        { icon: 'R', label: 'Railway' }
      ])
    };
    for (const [k, v] of Object.entries(defaults)) {
      await pool.query(
        `INSERT INTO site_config (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING`,
        [k, v]
      );
    }

    console.log('DB initialized OK');
  } catch (err) {
    console.error('DB init error:', err.message);
  }
}

// ── Utils ────────────────────────────────────────────────────────────────────
function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function signJWT(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 8 * 3600 }));
  const sig = b64url(crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + body).digest());
  return header + '.' + body + '.' + sig;
}

function verifyJWT(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = b64url(crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + body).digest());
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

function getAuthUser(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  return verifyJWT(token);
}

// ── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = req.url.split('?')[0];

  // ── POST /api — proxy Anthropic ──────────────────────────────────────────
  if (req.method === 'POST' && url === '/api') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01'
        }
      };
      const apiReq = https.request(options, apiRes => {
        res.writeHead(apiRes.statusCode, {
          'Content-Type': apiRes.headers['content-type'] || 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        apiRes.pipe(res);
      });
      apiReq.on('error', err => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      });
      apiReq.write(body);
      apiReq.end();
    });
    return;
  }

  // ── POST /admin/login ────────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/admin/login') {
    const body = await parseBody(req);
    const { username, password } = body;
    if (!username || !password) return sendJSON(res, 400, { error: 'Missing fields' });

    if (!pool) {
      // Fallback sem banco: credenciais hardcoded
      const valid = (username === 'admin' && password === 'pablo2025') ||
                    (username === 'rubens' && password === 'pablo');
      if (!valid) return sendJSON(res, 401, { error: 'Invalid credentials' });
      const token = signJWT({ username });
      return sendJSON(res, 200, { token, username });
    }

    try {
      const hash = sha256(password);
      const result = await pool.query(
        'SELECT username FROM admin_users WHERE username = $1 AND password_hash = $2',
        [username, hash]
      );
      if (result.rows.length === 0) return sendJSON(res, 401, { error: 'Invalid credentials' });
      const token = signJWT({ username });
      sendJSON(res, 200, { token, username });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
    return;
  }

  // ── GET /admin/config — ler config ───────────────────────────────────────
  if (req.method === 'GET' && url === '/admin/config') {
    const user = getAuthUser(req);
    if (!user) return sendJSON(res, 401, { error: 'Unauthorized' });

    if (!pool) return sendJSON(res, 200, {});

    try {
      const result = await pool.query('SELECT key, value FROM site_config');
      const cfg = {};
      for (const row of result.rows) {
        try { cfg[row.key] = JSON.parse(row.value); }
        catch { cfg[row.key] = row.value; }
      }
      sendJSON(res, 200, cfg);
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
    return;
  }

  // ── PUT /admin/config — salvar config ────────────────────────────────────
  if (req.method === 'PUT' && url === '/admin/config') {
    const user = getAuthUser(req);
    if (!user) return sendJSON(res, 401, { error: 'Unauthorized' });

    const body = await parseBody(req);
    if (!pool) return sendJSON(res, 200, { ok: true });

    try {
      for (const [key, value] of Object.entries(body)) {
        const val = typeof value === 'string' ? value : JSON.stringify(value);
        await pool.query(
          `INSERT INTO site_config (key, value, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
          [key, val]
        );
      }
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
    return;
  }

  // ── POST /admin/change-password ──────────────────────────────────────────
  if (req.method === 'POST' && url === '/admin/change-password') {
    const user = getAuthUser(req);
    if (!user) return sendJSON(res, 401, { error: 'Unauthorized' });

    const body = await parseBody(req);
    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword) return sendJSON(res, 400, { error: 'Missing fields' });
    if (newPassword.length < 6) return sendJSON(res, 400, { error: 'Password too short (min 6)' });

    if (!pool) return sendJSON(res, 200, { ok: true });

    try {
      const currentHash = sha256(currentPassword);
      const check = await pool.query(
        'SELECT id FROM admin_users WHERE username = $1 AND password_hash = $2',
        [user.username, currentHash]
      );
      if (check.rows.length === 0) return sendJSON(res, 401, { error: 'Current password incorrect' });
      const newHash = sha256(newPassword);
      await pool.query(
        'UPDATE admin_users SET password_hash = $1 WHERE username = $2',
        [newHash, user.username]
      );
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
    return;
  }

  // ── GET /config.json — config pública para o index.html ─────────────────
  if (req.method === 'GET' && url === '/config.json') {
    if (!pool) return sendJSON(res, 200, {});
    try {
      const result = await pool.query('SELECT key, value FROM site_config');
      const cfg = {};
      for (const row of result.rows) {
        try { cfg[row.key] = JSON.parse(row.value); }
        catch { cfg[row.key] = row.value; }
      }
      sendJSON(res, 200, cfg);
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
    return;
  }

  // ── Servir arquivos estáticos ────────────────────────────────────────────
  const urlMap = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/home': 'index.html',
    '/admin': 'admin.html',
    '/admin.html': 'admin.html',
    '/sports': 'sports.html',
    '/sports.html': 'sports.html',
    '/illusion': 'illusion.html',
    '/illusion.html': 'illusion.html',
    '/mascot': 'mascot.html',
    '/mascot.html': 'mascot.html',
    '/lettering': 'lettering.html',
    '/lettering.html': 'lettering.html',
    '/liveaction': 'liveaction.html',
    '/liveaction.html': 'liveaction.html',
    '/extraidor': 'extraidor.html',
    '/extraidor.html': 'extraidor.html',
  };

  const fileName = urlMap[url] || null;
  if (!fileName) { res.writeHead(404); res.end('Not found'); return; }

  const filePath = path.join(__dirname, fileName);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(fileName);
    const mime = ext === '.html' ? 'text/html' : ext === '.json' ? 'application/json' : 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

// ── Boot ─────────────────────────────────────────────────────────────────────
initDB().then(() => {
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
