/* =============================================================================
 *  SISTEMA FADEFIL · Lo común de todas las pantallas:
 *  login con Google (Supabase), llamadas a la función del servidor, archivos de LINDE
 *  (subida al espacio co2-linde), texto de los PDF (pdf.js) y descargas a Excel.
 *  La dirección de Supabase y su clave pública salen de config.js (lo arma la publicación).
 * ============================================================================= */
const CFG = window.FADEFIL_CONFIG || {};
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const FUNCION = CFG.supabaseUrl + '/functions/v1/guardar';
/* DEMO: el mismo sistema con datos inventados (config.js de la demo trae demo: true). Se entra sin Google
   y, al salir, todo vuelve a los datos de ejemplo. La app real trae demoUrl para ofrecer la demo. */
const ES_DEMO = !!CFG.demo;

/** Sesión activa; si no hay, muestra la pantalla de ingreso y no sigue. */
async function exigirSesion() {
  const { data } = await sb.auth.getSession();
  if (data && data.session) return data.session;
  if (ES_DEMO) return pantallaDemo();
  document.body.className = '';
  document.body.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;background:#0b0b0b;padding:24px">
      <div style="width:100%;max-width:380px;text-align:center;color:#fff">
        <img src="marca/logo-aqa-blanco.png" alt="AQA" style="height:64px;width:auto;margin-bottom:28px">
        <div style="background:#1f1f1f;border-radius:24px;padding:28px 26px">
          <h1 style="margin:0 0 6px;font-size:22px;font-weight:650;letter-spacing:-.02em">Sistema FADEFIL</h1>
          <p style="color:#a3a3a3;margin:0 0 22px;font-size:14px">Entrá con tu cuenta de Google. La primera vez, un administrador tiene que habilitar tu mail.</p>
          <button id="btn-google" style="width:100%;background:#eeff41;color:#0b0b0b;border:0;font-weight:650;padding:13px 18px">Entrar con Google</button>
          <p id="login-error" style="color:#ff8a80;font-size:13px;margin:12px 0 0"></p>
        </div>
        ${CFG.demoUrl ? `<p style="margin-top:18px;font-size:14px"><a href="${CFG.demoUrl}" target="_blank" rel="noopener" style="color:#eeff41">¿Querés verlo funcionando? Abrí la demo →</a></p>` : ''}
        <p style="color:#6e6e6e;font-size:12px;margin-top:18px">Premium Eco Water · AQA®</p>
      </div>
    </div>`;
  // Si Supabase rechazó el ingreso (por ejemplo, un mail que no está en Usuarios), vuelve con el motivo en la dirección.
  const q = new URLSearchParams(location.search + '&' + location.hash.slice(1));
  const motivo = q.get('error_description') || q.get('error');
  if (motivo) {
    document.getElementById('login-error').textContent = /habilitad|403|not allowed|signup/i.test(motivo) && !/FADEFIL/.test(motivo)
      ? 'Esta cuenta no está habilitada. Pedile a un administrador que agregue tu mail en Usuarios.' : motivo.replace(/\+/g, ' ');
    history.replaceState(null, '', location.pathname);
  }
  document.getElementById('btn-google').onclick = async () => {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href.split('#')[0], queryParams: { prompt: 'select_account' } } });
    if (error) document.getElementById('login-error').textContent = error.message;
  };
  throw new Error('SIN_SESION');
}

/** Pantalla de ingreso de la demo: un botón, sin cuenta. */
function pantallaDemo() {
  document.body.className = '';
  document.body.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;background:#0b0b0b;padding:24px">
      <div style="width:100%;max-width:400px;text-align:center;color:#fff">
        <img src="marca/logo-aqa-blanco.png" alt="AQA" style="height:64px;width:auto;margin-bottom:28px">
        <div style="background:#1f1f1f;border-radius:24px;padding:28px 26px">
          <span style="display:inline-block;background:#eeff41;color:#0b0b0b;font-weight:700;font-size:12px;letter-spacing:.08em;border-radius:999px;padding:4px 12px;margin-bottom:14px">DEMO</span>
          <h1 style="margin:0 0 6px;font-size:22px;font-weight:650;letter-spacing:-.02em">Sistema FADEFIL</h1>
          <p style="color:#a3a3a3;margin:0 0 22px;font-size:14px">Una copia del sistema con datos inventados, para mostrarlo y probarlo. Podés cargar lo que quieras: al salir, todo vuelve a los datos de ejemplo.</p>
          <button id="btn-demo" style="width:100%;background:#eeff41;color:#0b0b0b;border:0;font-weight:650;padding:13px 18px">Entrar a la demo</button>
          <p id="login-error" style="color:#ff8a80;font-size:13px;margin:12px 0 0"></p>
        </div>
        <p style="color:#6e6e6e;font-size:12px;margin-top:18px">Premium Eco Water · AQA®</p>
      </div>
    </div>`;
  document.getElementById('btn-demo').onclick = async () => {
    document.getElementById('btn-demo').disabled = true;
    const { error } = await sb.auth.signInAnonymously();
    if (error) { document.getElementById('login-error').textContent = error.message; document.getElementById('btn-demo').disabled = false; return; }
    location.reload();
  };
  throw new Error('SIN_SESION');
}

async function salir() {
  if (ES_DEMO) { try { await servidor('demo_reiniciar'); } catch (e) { /* se sale igual */ } }
  await sb.auth.signOut(); location.href = 'index.html';
}
/** Demo: vuelve a los datos de ejemplo sin salir. */
async function reiniciarDemo() {
  if (typeof ocupado === 'function') ocupado('Volviendo a los datos de ejemplo…');
  try { await servidor('demo_reiniciar'); location.reload(); } catch (e) { if (typeof libre === 'function') libre(); aviso(e.message, 'err'); }
}

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
  b.className = 'boton-icono boton-excel';
  b.innerHTML = icono('download') + '<span class="ocultar-movil">Excel</span>';
  b.title = 'Descarga a Excel las tablas de esta pantalla';
  b.onclick = async () => {
    try { await descargarTablas(obtenerElemento(), nombre() + ' ' + new Date().toISOString().slice(0, 10)); }
    catch (e) { alert(e.message); }
  };
  const tope = document.querySelector('.tope .espacio');
  if (tope) tope.after(b); else document.body.appendChild(b);
}

/* ---------------------------------------------------------------------------
 *  Estructura común de la app: menú lateral (computadora), barra inferior (celular),
 *  barra superior con el título de la sección. Las secciones de la misma página son
 *  botones con data-panel (las pantallas ya los manejan); las de otra página, enlaces.
 * ------------------------------------------------------------------------ */
const ICONOS_URL = 'lib/iconos.svg';
const icono = (n, cl) => `<svg class="icono${cl ? ' ' + cl : ''}" aria-hidden="true"><use href="${ICONOS_URL}#${n}"/></svg>`;
const MENU = [
  { items: [{ pag: 'index', panel: 'p-inicio', t: 'Inicio', i: 'house' }] },
  { grupo: 'Operación', rol: 'carga', items: [
    { pag: 'index', panel: 'p-ot', t: 'Nueva OT', i: 'clipboard-plus', rol: 'carga' },
    { pag: 'index', panel: 'p-envios', t: 'Envíos', i: 'truck', rol: 'carga' },
    { pag: 'index', panel: 'p-revision', t: 'Revisión', i: 'scan-search', rol: 'carga' },
    { pag: 'index', panel: 'p-reparacion', t: 'Reparación', i: 'wrench', rol: 'carga' },
    { pag: 'index', panel: 'p-seguimiento', t: 'Seguimiento de OT', i: 'calendar-clock', rol: 'carga' }] },
  { grupo: 'Consultas', items: [
    { pag: 'index', panel: 'p-clientes', t: 'Clientes', i: 'users' },
    { pag: 'index', panel: 'p-maquinas', t: 'Máquinas', i: 'refrigerator' },
    { pag: 'index', panel: 'p-stock', t: 'Stock', i: 'boxes' },
    { pag: 'index', panel: 'p-tecnicos', t: 'Técnicos', i: 'hard-hat' }] },
  { grupo: 'CO₂', items: [
    { pag: 'co2', panel: 'p-remito', t: 'Remito de CO₂', i: 'file-text', rol: 'carga' },
    { pag: 'co2', panel: 'p-facturas', t: 'Remitos y facturas', i: 'receipt' },
    { pag: 'co2', panel: 'p-consulta', t: 'Cilindros', i: 'cylinder' },
    { pag: 'co2', panel: 'p-recambios', t: 'Recambios', i: 'repeat' },
    { pag: 'co2', panel: 'p-revision', t: 'Alertas de CO₂', i: 'list-checks' },
    { pag: 'co2', panel: 'p-alta', t: 'Inventario inicial', i: 'package-plus', rol: 'admin' }] },
  // Administración queda fija al pie del menú (siempre a la vista para el ADMIN; los demás no la ven).
  { grupo: 'Administración', rol: 'admin', fijo: true, items: [
    { pag: 'datos', panel: 'usuarios', t: 'Usuarios y datos', i: 'database', rol: 'admin' },
    { pag: 'datos', panel: 'carga', t: 'Carga masiva', i: 'upload', rol: 'admin' },
    { pag: 'index', panel: 'p-admin', t: 'Auditoría', i: 'shield-check', rol: 'admin' }] }
];
const INFERIOR = [
  { pag: 'index', panel: 'p-inicio', t: 'Inicio', i: 'house' },
  { pag: 'index', panel: 'p-ot', t: 'Nueva OT', i: 'clipboard-plus', rol: 'carga' },
  { pag: 'index', panel: 'p-clientes', t: 'Clientes', i: 'users' },
  { pag: 'co2', panel: 'p-consulta', t: 'CO₂', i: 'cylinder' }
];
let PAGINA = '';
function itemMenu(x, pagina) {
  const cl = (x.rol ? 'solo-' + x.rol : '') + (x.pag === pagina && !x.panel ? ' activo' : '');
  if (x.pag === 'datos') return `<a href="datos.html#${x.panel}" data-datos="${x.panel}" class="${cl}">${icono(x.i)}<span>${x.t}</span></a>`;
  if (x.pag === pagina && x.panel) return `<button data-panel="${x.panel}" class="${cl}">${icono(x.i)}<span>${x.t}</span></button>`;
  const url = x.pag + '.html' + (x.panel ? '#' + x.panel : '');
  return `<a href="${url}" class="${cl}">${icono(x.i)}<span>${x.t}</span></a>`;
}
function grupoMenu(g, pagina) {
  return (g.grupo ? `<div class="grupo-menu${g.rol === 'admin' ? ' solo-admin' : ''}">${g.grupo}</div>` : '') + g.items.map((x) => itemMenu(x, pagina)).join('');
}
/** En Datos: marca en el menú la parte abierta (Usuarios y datos / Carga masiva). */
function marcarMenuDatos(pestana) {
  document.querySelectorAll('a[data-datos]').forEach((a) => a.classList.toggle('activo', (pestana === 'carga') === (a.dataset.datos === 'carga')));
}
/** Arma el marco de la página. pagina: index | co2 | datos. contexto: HTML del selector de región/plaza/zona (solo la app principal). */
function armarMarco(pagina, opciones) {
  PAGINA = pagina;
  opciones = opciones || {};
  document.body.classList.add('con-marco');
  const lateral = document.createElement('aside');
  lateral.className = 'lateral';
  lateral.innerHTML = `<div class="marca"><img src="marca/logo-aqa-blanco.png" alt="AQA"><span>Sistema<br>FADEFIL</span>${ES_DEMO ? '<em class="marca-demo">DEMO</em>' : ''}</div>
    <nav id="pestanas">${MENU.filter((g) => !g.fijo).map((g) => grupoMenu(g, pagina)).join('')}</nav>
    <nav class="menu-fijo solo-admin">${MENU.filter((g) => g.fijo).map((g) => grupoMenu(g, pagina)).join('')}${CFG.demoUrl && !ES_DEMO
      ? `<a href="${CFG.demoUrl}" target="_blank" rel="noopener" title="El sistema con datos inventados, para mostrarlo">${icono('presentation')}<span>Abrir la demo</span></a>` : ''}</nav>
    <div class="pie"><div class="avatar" id="avatar">·</div><div class="quien"><b id="quien-nombre">Cargando…</b><small id="quien-rol"></small></div>
      <button onclick="salir()" title="${ES_DEMO ? 'Salir de la demo (todo vuelve a los datos de ejemplo)' : 'Cerrar la sesión'}">${icono('log-out')}</button></div>`;
  const tope = document.createElement('header');
  tope.className = 'tope';
  tope.innerHTML = `<button class="boton-icono boton-menu" onclick="document.body.classList.toggle('menu-abierto')" aria-label="Menú">${icono('menu')}</button>
    <h1 id="titulo-seccion"></h1><div class="espacio"></div>${opciones.extra || ''}
    <span class="usuario" id="usuario"></span>
    ${ES_DEMO ? `<button class="boton-icono demo-pill" onclick="reiniciarDemo()" title="Datos inventados. Vuelve a los datos de ejemplo (se borra lo que se cargó).">${icono('rotate-ccw')}<span>DEMO<span class="ocultar-movil"> · Reiniciar</span></span></button>` : ''}
    <button class="boton-icono" onclick="${opciones.actualizar || 'location.reload()'}" title="Volver a traer los datos (no borra lo que tengas sin guardar)">${icono('refresh-cw')}<span class="ocultar-movil">Actualizar</span></button>`;
  const inferior = document.createElement('nav');
  inferior.className = 'inferior';
  inferior.innerHTML = INFERIOR.map((x) => itemMenu(x, pagina)).join('') + `<a href="#" onclick="event.preventDefault();document.body.classList.add('menu-abierto')">${icono('ellipsis')}<span>Más</span></a>`;
  const velo = document.createElement('div');
  velo.className = 'velo';
  velo.onclick = () => document.body.classList.remove('menu-abierto');
  document.body.prepend(velo);
  document.body.prepend(inferior);
  document.body.prepend(tope);
  document.body.prepend(lateral);
  // Título según la sección elegida; el menú se cierra en el celular; la sección queda en la dirección (#) para volver o compartir.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-panel]');
    if (!b || !b.closest('nav')) return;
    document.body.classList.remove('menu-abierto');
    ponerTitulo(b.dataset.panel);
    history.replaceState(null, '', '#' + b.dataset.panel);
    window.scrollTo({ top: 0 });
  });
  window.addEventListener('scroll', () => tope.classList.toggle('con-borde', window.scrollY > 4), { passive: true });
  if (pagina === 'datos') ponerTitulo('');
}
function ponerTitulo(panel) {
  const todos = MENU.flatMap((g) => g.items);
  const x = todos.find((i) => i.pag === PAGINA && i.panel === panel) || todos.find((i) => i.pag === PAGINA && !i.panel) || (PAGINA === 'datos' && { t: 'Usuarios y datos' });
  const t = x ? x.t : 'Sistema FADEFIL';
  const h = document.getElementById('titulo-seccion');
  if (h) h.textContent = t;
  document.title = t + ' · Sistema FADEFIL';
  document.querySelectorAll('nav button[data-panel]').forEach((b) => b.classList.toggle('activo', b.dataset.panel === panel));
}
/** Abre la sección que viene en la dirección (#p-…), si existe. */
function abrirDesdeHash(porDefecto) {
  const id = (location.hash || '').slice(1) || porDefecto;
  const b = id && document.querySelector(`nav button[data-panel="${id}"]`);
  if (b && getComputedStyle(b).display !== 'none') b.click();
  else { const activo = document.querySelector('section.panel.activo'); ponerTitulo(activo ? activo.id : ''); }
}
/** Nombre, rol e iniciales en el menú; el rol habilita las secciones que corresponden. */
function ponerUsuario(u) {
  document.body.classList.remove('rol-ADMIN', 'rol-CARGA', 'rol-CONSULTA');
  document.body.classList.add('rol-' + u.rol);
  const nombre = u.nombre || u.email || '';
  const ini = nombre.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  const roles = { ADMIN: 'Administrador', CARGA: 'Carga', CONSULTA: 'Consulta' };
  const set = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
  set('avatar', ini || '·'); set('quien-nombre', nombre); set('quien-rol', roles[u.rol] || u.rol);
}
/* Textos de ayuda largos: se muestran en una línea y se abren con un toque. */
function plegarAyudas(raiz) {
  (raiz || document).querySelectorAll('p.ayuda:not(.plegable)').forEach((p) => {
    if ((p.textContent || '').length > 140) { p.classList.add('plegable'); p.title = 'Tocá para ver la explicación completa'; }
  });
}
document.addEventListener('click', (e) => { const p = e.target.closest('p.ayuda.plegable'); if (p) p.classList.toggle('abierta'); });
document.addEventListener('DOMContentLoaded', () => {
  plegarAyudas();
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) plegarAyudas(n); }))).observe(document.body, { childList: true, subtree: true });
});
/** Va a una sección de la misma página (como tocar el menú). */
function ir(panel) { const b = document.querySelector(`nav button[data-panel="${panel}"]`); if (b) b.click(); }

/* ---------------------------------------------------------------------------
 *  Buscador de clientes (y otras listas largas): las pantallas tienen un campo para
 *  filtrar y una lista desplegable al lado. Se muestran como un solo campo: se escribe,
 *  aparecen las coincidencias (agrupadas como en la lista) y se elige con un toque o con
 *  las flechas y Enter. Por debajo sigue funcionando la lista de siempre.
 * ------------------------------------------------------------------------ */
function mejorarSelectores(raiz) {
  (raiz || document).querySelectorAll('.selector:not(.combo)').forEach((caja) => {
    const input = caja.querySelector('input'), select = caja.querySelector('select');
    if (!input || !select) return;
    caja.classList.add('combo');
    input.dataset.ph = input.placeholder || 'Buscar…';
    input.setAttribute('autocomplete', 'off');
    const lista = document.createElement('div');
    lista.className = 'combo-lista';
    caja.appendChild(lista);
    let activo = -1, opciones = [];
    const elegido = () => { const o = select.options[select.selectedIndex]; return o && o.value ? o.textContent : ''; };
    const reflejar = () => {
      if (document.activeElement === input) return;
      const t = elegido();
      input.placeholder = t || input.dataset.ph;
      caja.classList.toggle('con-valor', !!t);
    };
    const pintar = () => {
      opciones = [];
      let html = '';
      [...select.children].forEach((n) => {
        const items = n.tagName === 'OPTGROUP' ? [...n.children] : [n];
        const validos = items.filter((o) => o.value && !o.disabled);
        if (!validos.length) return;
        if (n.tagName === 'OPTGROUP') html += `<div class="combo-grupo">${esc(n.label)}</div>`;
        validos.forEach((o) => { opciones.push(o.value); html += `<div class="combo-op${o.value === select.value ? ' elegida' : ''}" data-i="${opciones.length - 1}">${esc(o.textContent)}</div>`; });
      });
      lista.innerHTML = html || `<div class="combo-vacio">${esc((select.options[0] && !select.options[0].value && select.options[0].textContent) || 'Sin resultados')}</div>`;
      activo = -1;
    };
    const abrir = () => { pintar(); caja.classList.add('abierto'); };
    const cerrar = () => { caja.classList.remove('abierto'); activo = -1; };
    const elegir = (i) => {
      const v = opciones[i];
      if (v == null) return;
      select.value = v;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true })); // la lista vuelve a mostrar todo, conservando lo elegido
      cerrar(); input.blur(); reflejar();
    };
    const marcar = () => lista.querySelectorAll('.combo-op').forEach((d) => { const on = Number(d.dataset.i) === activo; d.classList.toggle('activa', on); if (on) d.scrollIntoView({ block: 'nearest' }); });
    input.addEventListener('focus', () => { input.placeholder = elegido() || input.dataset.ph; abrir(); });
    input.addEventListener('input', () => { if (document.activeElement === input) abrir(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); activo = Math.min(opciones.length - 1, activo + 1); marcar(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activo = Math.max(0, activo - 1); marcar(); }
      else if (e.key === 'Enter') { e.preventDefault(); elegir(activo >= 0 ? activo : 0); }
      else if (e.key === 'Escape') { cerrar(); input.blur(); }
    });
    input.addEventListener('blur', () => setTimeout(() => { cerrar(); reflejar(); }, 150));
    lista.addEventListener('mousedown', (e) => { const d = e.target.closest('.combo-op'); if (d) { e.preventDefault(); elegir(Number(d.dataset.i)); } });
    new MutationObserver(reflejar).observe(select, { childList: true, subtree: true });
    select.addEventListener('change', reflejar);
    reflejar();
  });
}
document.addEventListener('DOMContentLoaded', () => mejorarSelectores());

/* ---------------------------------------------------------------------------
 *  Esquema de mantenimientos: 6 meses, cada uno Profundo (P), Express (E) o nada (-).
 *  Se usa en Datos → Configuración (el de todos) y en la ficha del cliente (el propio).
 * ------------------------------------------------------------------------ */
const OPCIONES_ESQ = [['-', 'Nada'], ['E', 'Express'], ['P', 'Profundo']];
function htmlEsquema(id, valor) {
  const v = String(valor || '-;-;-;-;-;-').split(';');
  return `<div class="esquema" id="${id}">` + [0, 1, 2, 3, 4, 5].map((i) => {
    const x = OPCIONES_ESQ.some((o) => o[0] === v[i]) ? v[i] : '-';
    return `<label class="mes-esq" data-v="${x}"><span>Mes ${i + 1}</span><select aria-label="Mes ${i + 1}" onchange="this.parentNode.dataset.v=this.value">${OPCIONES_ESQ.map((o) => `<option value="${o[0]}"${o[0] === x ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></label>`;
  }).join('') + '</div>';
}
function leerEsquemaHtml(id) { return [...document.querySelectorAll('#' + id + ' select')].map((s) => s.value).join(';'); }
/** "-;-;E;-;-;P" → "Mes 3 Express · Mes 6 Profundo". */
function textoEsquema(v) {
  return String(v || '').split(';').map((x, i) => (x === 'P' ? 'Mes ' + (i + 1) + ' Profundo' : x === 'E' ? 'Mes ' + (i + 1) + ' Express' : '')).filter(String).join(' · ');
}
