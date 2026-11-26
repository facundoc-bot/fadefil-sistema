// Servidor de prueba local de la app: sirve app/, un login de mentira (/auth/v1/user) y reenvía
// /functions/v1/guardar a la función del servidor corriendo en Deno (puerto FUNCION_PUERTO).
// El token de prueba es "prueba:<email>". Solo para probar en una computadora; no se publica.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PUERTO = Number(process.env.PUERTO || 8787), FUNCION = 'http://127.0.0.1:' + (process.env.FUNCION_PUERTO || 8788);
const REST = 'http://127.0.0.1:' + (process.env.REST_PUERTO || 3000); // PostgREST (lo mismo que /rest/v1 de Supabase)
/** Email del token: un JWT de prueba (firmado para PostgREST) o "prueba:<email>". */
function emailDe(t) {
  if (t.startsWith('prueba:')) return t.slice(7);
  try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).email || ''; } catch { return ''; }
}
const RAIZ = new URL('../../app/', import.meta.url).pathname;
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (url.pathname === '/auth/v1/user') {
    const t = String(req.headers.authorization || '').replace(/^Bearer\s+/, '');
    const email = emailDe(t);
    if (!email) { res.writeHead(401, cors); return res.end('{}'); }
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ email }));
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    const cuerpo = await new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
    const h = { ...req.headers }; delete h.host; delete h['content-length']; delete h.apikey;
    const r = await fetch(REST + url.pathname.slice(8) + url.search, { method: req.method, headers: h, body: ['GET', 'HEAD'].includes(req.method) ? undefined : cuerpo });
    const out = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k)) out[k] = v; });
    res.writeHead(r.status, { ...cors, ...out, 'Access-Control-Expose-Headers': 'Content-Range' }); return res.end(Buffer.from(await r.arrayBuffer()));
  }
  if (url.pathname === '/functions/v1/guardar') {
    const cuerpo = await new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
    const r = await fetch(FUNCION, { method: req.method, headers: { Authorization: req.headers.authorization || '', apikey: 'x', 'Content-Type': 'application/json' }, body: req.method === 'POST' ? cuerpo : undefined });
    res.writeHead(r.status, { ...cors, 'Content-Type': 'application/json' }); return res.end(await r.text());
  }
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': TIPOS['.js'] });
    return res.end(`window.FADEFIL_CONFIG = { supabaseUrl: 'http://localhost:${PUERTO}', supabaseKey: 'clave-de-prueba' };`);
  }
  try {
    const ruta = normalize(join(RAIZ, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!ruta.startsWith(RAIZ)) throw new Error('fuera');
    const b = await readFile(ruta);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(ruta)] || 'application/octet-stream' }); res.end(b);
  } catch { res.writeHead(404); res.end('no'); }
}).listen(PUERTO, () => console.log('App de prueba en http://localhost:' + PUERTO));
