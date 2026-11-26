/* =============================================================================
 *  SISTEMA FADEFIL · Lo común de todas las pantallas:
 *  login con Google (Supabase), llamadas a la función del servidor, archivos de LINDE
 *  (subida al espacio co2-linde), texto de los PDF (pdf.js) y descargas a Excel.
 *  La dirección de Supabase y su clave pública salen de config.js (lo arma la publicación).
 * ============================================================================= */
const CFG = window.FADEFIL_CONFIG || {};
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const FUNCION = CFG.supabaseUrl + '/functions/v1/guardar';

/** Sesión activa; si no hay, muestra la pantalla de ingreso y no sigue. */
async function exigirSesion() {
  const { data } = await sb.auth.getSession();
  if (data && data.session) return data.session;
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1f3a5f;font:15px system-ui,sans-serif">
      <div style="background:#fff;border-radius:12px;padding:28px 30px;max-width:360px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.25)">
        <h1 style="margin:0 0 6px;font-size:20px;color:#1f3a5f">Sistema FADEFIL</h1>
        <p style="color:#5a6878;margin:0 0 20px">Entrá con tu cuenta de Google. Si es la primera vez, un administrador tiene que habilitar tu mail.</p>
        <button id="btn-google" style="font:inherit;font-weight:600;padding:11px 18px;border-radius:8px;border:1px solid #d9e0e8;background:#fff;cursor:pointer;width:100%">Entrar con Google</button>
        <p id="login-error" style="color:#a3261f;font-size:13px"></p>
      </div>
    </div>`;
  document.getElementById('btn-google').onclick = async () => {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href.split('#')[0], queryParams: { prompt: 'select_account' } } });
    if (error) document.getElementById('login-error').textContent = error.message;
  };
  throw new Error('SIN_SESION');
}

async function salir() { await sb.auth.signOut(); location.href = 'index.html'; }

/** Llama a la función del servidor. Devuelve "datos" o lanza el error con el mensaje para el usuario. */
async function servidor(accion, cuerpo) {
  const { data } = await sb.auth.getSession();
  if (!data || !data.session) { location.reload(); throw new Error('Tu sesión venció. Volvé a iniciar sesión.'); }
  let r;
  try {
    r = await fetch(FUNCION, { method: 'POST', headers: { Authorization: 'Bearer ' + data.session.access_token, apikey: CFG.supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ accion }, cuerpo || {})) });
  } catch (e) { throw new Error('No hay conexión con el servidor. Revisá internet y probá de nuevo.'); }
  let j;
  try { j = await r.json(); } catch (e) { throw new Error('El servidor respondió algo inesperado (' + r.status + '). Probá de nuevo en unos segundos.'); }
  if (!j.exito) throw new Error(j.error || 'Error del servidor.');
  return j.datos;
}

/* ---------------------------------------------------------------------------
 *  Archivos de LINDE (espacio privado co2-linde)
 * ------------------------------------------------------------------------ */
function base64ABytes(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
async function hashHex(bytes) { const h = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
/** Sube el archivo (archivo = { nombre, mimeType, base64 }) a remitos/ o facturas/ y devuelve { url, ruta, hash, nombre, bytes }. */
async function subirArchivo(archivo, carpeta) {
  const bytes = base64ABytes(archivo.base64);
  if (archivo.mimeType !== 'application/pdf') throw new Error('Por ahora se guardan solo PDF. Si tenés una foto, cargá el remito a mano.');
  const hash = await hashHex(bytes);
  const ruta = carpeta + '/' + new Date().getFullYear() + '/' + hash.slice(0, 16) + '.pdf';
  const { error } = await sb.storage.from('co2-linde').upload(ruta, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false });
  if (error && !/exists|Duplicate/i.test(error.message)) throw new Error('No se pudo guardar el archivo: ' + error.message);
  return { url: 'archivo.html?r=' + encodeURIComponent(ruta), ruta, hash, nombre: archivo.nombre, bytes };
}

/** Texto de un PDF, renglón por renglón (como lo leía Drive). Usa pdf.js (app/lib). */
let _pdfjs = null;
async function textoPDF(bytes) {
  if (!_pdfjs) {
    _pdfjs = await import(new URL('lib/pdf.min.mjs', location.href).href);
    _pdfjs.GlobalWorkerOptions.workerSrc = new URL('lib/pdf.worker.min.mjs', location.href).href;
  }
  const doc = await _pdfjs.getDocument({ data: bytes.slice() }).promise;
  const paginas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const renglones = [];
    tc.items.filter((i) => i.str && i.str.trim()).forEach((i) => {
      const x = i.transform[4], y = i.transform[5], h = Math.abs(i.transform[3]) || 8;
      let r = renglones.find((q) => Math.abs(q.y - y) <= h * 0.45);
      if (!r) { r = { y, items: [] }; renglones.push(r); }
      r.items.push({ x, s: i.str });
    });
    renglones.sort((a, b) => b.y - a.y);
    paginas.push(renglones.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.s.trim()).join(' ')).join('\n'));
  }
  return paginas.join('\n');
}

/* ---------------------------------------------------------------------------
 *  Excel (ExcelJS, app/lib)
 * ------------------------------------------------------------------------ */
let _excel = null;
function cargarExcelJS() {
  if (_excel) return _excel;
  _excel = new Promise((ok, mal) => {
    if (window.ExcelJS) return ok(window.ExcelJS);
    const s = document.createElement('script');
    s.src = 'lib/exceljs.min.js'; s.onload = () => ok(window.ExcelJS); s.onerror = () => mal(new Error('No se pudo cargar la librería de Excel.'));
    document.head.appendChild(s);
  });
  return _excel;
}
const nombreHoja = (t, usados) => {
  let n = String(t || 'Hoja').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Hoja', k = n, i = 2;
  while (usados.has(k)) k = n.slice(0, 25) + ' ' + i++;
  usados.add(k); return k;
};
async function bajarLibro(wb, archivo) {
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = archivo.replace(/[\\/:*?"<>|]/g, '-') + '.xlsx';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
/** Agrega una hoja con títulos en negrita, filtro y columnas a medida. */
function agregarHoja(wb, nombre, encabezado, filas, usados) {
  const ws = wb.addWorksheet(nombreHoja(nombre, usados));
  if (encabezado && encabezado.length) { ws.addRow(encabezado); ws.getRow(1).font = { bold: true }; ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: encabezado.length } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; }
  filas.forEach((f) => ws.addRow(f));
  ws.columns.forEach((c, i) => { let m = 8; ws.getColumn(i + 1).eachCell({ includeEmpty: false }, (x) => { m = Math.max(m, String(x.value == null ? '' : x.value).length); }); c.width = Math.min(60, m + 2); });
  return ws;
}
/** Un texto de la pantalla como número cuando lo es (1.234,5 → 1234.5), para que Excel pueda sumar. */
function valorCelda(t) {
  const s = String(t || '').trim();
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  const f = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (f) return new Date(Date.UTC(+f[3], +f[2] - 1, +f[1]));
  return s;
}
/** Descarga un Excel con varias hojas: hojas = [{ nombre, columnas?, filas: [{col: valor}] }]. */
async function descargarExcel(archivo, hojas) {
  const ExcelJS = await cargarExcelJS(), wb = new ExcelJS.Workbook(), usados = new Set();
  hojas.forEach((h) => {
    const cols = h.columnas || [...new Set(h.filas.flatMap((f) => Object.keys(f)))];
    agregarHoja(wb, h.nombre, cols, h.filas.map((f) => cols.map((c) => (f[c] == null ? '' : f[c]))), usados);
  });
  await bajarLibro(wb, archivo);
}
/** Descarga a Excel las tablas que se ven en un elemento de la pantalla (una hoja por tabla). */
async function descargarTablas(elemento, archivo) {
  const ExcelJS = await cargarExcelJS(), wb = new ExcelJS.Workbook(), usados = new Set();
  const tablas = [...(elemento || document).querySelectorAll('table')].filter((t) => t.offsetParent !== null && t.rows.length > 1);
  if (!tablas.length) throw new Error('No hay tablas con datos en esta pantalla.');
  const textoDe = (c) => { const x = c.cloneNode(true); x.querySelectorAll('input,select,textarea').forEach((e) => e.replaceWith(document.createTextNode(e.value || ''))); x.querySelectorAll('button').forEach((e) => e.remove()); return x.textContent.replace(/\s+/g, ' ').trim(); };
  tablas.forEach((t, i) => {
    const tarjeta = t.closest('.tarjeta'), h = tarjeta && tarjeta.querySelector('h2,h3');
    const filas = [...t.rows].map((r) => [...r.cells].map(textoDe));
    const enc = t.tHead && t.tHead.rows.length ? filas.shift() : null;
    agregarHoja(wb, h ? h.textContent : 'Tabla ' + (i + 1), enc, filas.map((f) => f.map(valorCelda)), usados);
  });
  await bajarLibro(wb, archivo);
}
/** Lee un Excel y devuelve { hoja: [filas como objetos con _fila] } (títulos en minúscula; fechas como AAAA-MM-DD). */
async function leerExcel(file) {
  const ExcelJS = await cargarExcelJS(), wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const valor = (v) => {
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object') {
      if ('result' in v) return valor(v.result);
      if (v.richText) return v.richText.map((x) => x.text).join('');
      if ('text' in v) return v.text;
      return '';
    }
    return v;
  };
  const out = {};
  wb.eachSheet((ws) => {
    let cab = [];
    const filas = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      const vals = []; row.eachCell({ includeEmpty: true }, (c, j) => { vals[j] = valor(c.value); });
      if (!cab.length) { cab = vals.map((v) => String(v == null ? '' : v).trim().toLowerCase()); return; }
      const o = { _fila: n };
      cab.forEach((k, j) => { if (k) o[k] = vals[j] == null ? '' : vals[j]; });
      filas.push(o);
    });
    out[ws.name.trim().toLowerCase()] = filas;
  });
  return out;
}
/** Botón flotante "Descargar Excel" que baja las tablas de la sección que se está viendo. */
function botonExcel(obtenerElemento, nombre) {
  const b = document.createElement('button');
  b.textContent = '⬇ Excel';
  b.title = 'Descarga a Excel las tablas de esta pantalla';
  b.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9;font:600 14px system-ui;padding:9px 13px;border-radius:999px;border:1px solid #1e7a4c;background:#1e7a4c;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.18);cursor:pointer';
  b.onclick = async () => {
    try { await descargarTablas(obtenerElemento(), nombre() + ' ' + new Date().toISOString().slice(0, 10)); }
    catch (e) { alert(e.message); }
  };
  document.body.appendChild(b);
}
