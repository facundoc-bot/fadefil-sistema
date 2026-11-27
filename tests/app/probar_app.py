# Recorre la app en Chrome (Playwright) contra el servidor local y la base de prueba:
# login de prueba, arranque, cada pestaña de la app principal y de CO₂, sin errores en la consola.
import sys, json, re, os, hmac, hashlib, base64, time
from playwright.sync_api import sync_playwright
import openpyxl

def jwt(email):
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).rstrip(b'=').decode()
    cab, cuerpo = b({'alg': 'HS256', 'typ': 'JWT'}), b({'role': 'authenticated', 'email': email, 'aud': 'authenticated', 'exp': int(time.time()) + 3600 * 24, 'sub': '00000000-0000-0000-0000-000000000001'})
    firma = base64.urlsafe_b64encode(hmac.new(os.environ['JWT_SECRETO'].encode(), (cab + '.' + cuerpo).encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
    return cab + '.' + cuerpo + '.' + firma

BASE = 'http://localhost:8787'
SESION = {'access_token': jwt('facundoc@aqa.com.ar'), 'refresh_token': 'x', 'token_type': 'bearer', 'expires_in': 3600 * 24 * 365,
          'expires_at': 4102444800, 'user': {'id': '00000000-0000-0000-0000-000000000001', 'email': 'facundoc@aqa.com.ar', 'aud': 'authenticated', 'role': 'authenticated'}}
fallas = []
def bajado(d, n='/tmp/bajado.xlsx'):
    d.save_as(n); return n
with sync_playwright() as p:
    nav = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pag = nav.new_page(viewport={'width': 1280, 'height': 900})
    errores = []
    pag.on('console', lambda m: errores.append(m.text) if m.type == 'error' else None)
    pag.on('pageerror', lambda e: errores.append(str(e)))
    pag.goto(BASE + '/archivo.html?r=nada')
    pag.evaluate("s => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(s))", SESION)
    for pagina, esperar in [('index.html', 'ADMIN'), ('co2.html', 'ADMIN')]:
        pag.goto(BASE + '/' + pagina)
        pag.wait_for_function("() => document.body.classList.contains('rol-ADMIN')", timeout=30000)
        botones = pag.query_selector_all('aside nav button[data-panel]')
        for b in botones:
            if not b.is_visible(): continue
            nombre = b.inner_text()
            b.click(); pag.wait_for_timeout(1200)
            err = pag.inner_text('#error-global') if pag.query_selector('#error-global') else ''
            if err.strip(): fallas.append(f'{pagina} · {nombre}: {err.strip()[:200]}')
            pag.screenshot(path=f'/tmp/app_{pagina.split(".")[0]}_{re.sub(r"[^A-Za-z]", "", nombre)}.png', full_page=False)
            if pagina == 'index.html' and nombre.strip() in ('Inicio', 'Nueva OT'):
                movil = nav.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
                movil.goto(BASE + '/archivo.html?r=nada'); movil.evaluate("s => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(s))", SESION)
                movil.goto(BASE + '/index.html#' + b.get_attribute('data-panel')); movil.wait_for_function("() => document.body.classList.contains('rol-ADMIN')", timeout=30000)
                movil.wait_for_timeout(1500); movil.screenshot(path=f'/tmp/movil_{re.sub(r"[^A-Za-z]", "", nombre)}.png'); movil.close()
        print(pagina, 'pestañas:', [b.inner_text() for b in botones if b.is_visible()])
    # Excel desde una pantalla de la app (Stock)
    pag.goto(BASE + '/index.html')
    pag.wait_for_function("() => document.body.classList.contains('rol-ADMIN') && typeof S !== 'undefined' && S.ini", timeout=30000)
    pag.click('nav button[data-panel="p-stock"]'); pag.wait_for_timeout(800)
    with pag.expect_download(timeout=20000) as d: pag.click('.boton-excel')
    wb = openpyxl.load_workbook(bajado(d.value))
    print('Excel de Stock:', wb.sheetnames, 'filas', [wb[n].max_row for n in wb.sheetnames])
    if not any(wb[n].max_row > 1 for n in wb.sheetnames): fallas.append('El Excel de Stock salió vacío')

    # Datos: agregar una zona, renombrar un depósito, descargar y carga masiva
    # Administración a la vista: fija al pie del menú (sin desplazar) y accesos en el inicio que llevan a Datos
    pag.click('nav button[data-panel="p-inicio"]'); pag.wait_for_timeout(500)
    caja = pag.locator('.menu-fijo >> text=Carga masiva').bounding_box()
    if not caja or caja['y'] + caja['height'] > pag.viewport_size['height']: fallas.append('Administración no queda a la vista en el menú: ' + json.dumps(caja))
    pag.click('.bloque-admin >> text=Usuarios')
    pag.wait_for_selector('#filas tr', timeout=30000)
    llegada = pag.evaluate("() => [location.hash, S.pestana, document.getElementById('titulo-seccion').textContent, !!document.querySelector('.menu-fijo a.activo[data-datos=usuarios]')]")
    print('Inicio → Usuarios:', llegada)
    if llegada != ['#usuarios', 'usuarios', 'Datos · Usuarios', True]: fallas.append('Inicio → Usuarios: ' + json.dumps(llegada))
    pag.screenshot(path='/tmp/app_datos_usuarios.png')
    pag.click('#subpestanas >> text=Zonas'); pag.click('text=Agregar')
    pag.fill('#n-0', 'Godoy Cruz'); pag.select_option('#n-1', 'Mendoza'); pag.click('#filas >> text=Guardar')
    pag.wait_for_selector('#msg .nota', timeout=15000)
    if 'Agregado' not in pag.inner_text('#msg'): fallas.append('Datos · zona: ' + pag.inner_text('#msg'))
    pag.click('#subpestanas >> text=Depósitos')
    fila = pag.locator('#filas tr', has_text='Depósito Córdoba').first
    fila.locator('text=Editar').click(); pag.fill('#e-0', 'Depósito Córdoba Capital')
    pag.once('dialog', lambda dlg: dlg.accept()); pag.click('#filas >> text=Guardar')
    pag.wait_for_selector('#msg .nota', timeout=15000)
    if 'Cambios guardados' not in pag.inner_text('#msg'): fallas.append('Datos · renombrar: ' + pag.inner_text('#msg'))
    with pag.expect_download(timeout=20000) as d: pag.click('text=Descargar Excel')
    if openpyxl.load_workbook(bajado(d.value)).active.max_row < 3: fallas.append('Datos · Excel de depósitos vacío')
    # Carga masiva desde un Excel
    wb = openpyxl.Workbook(); wb.remove(wb.active)
    hojas = {'maquinas': [['serie', 'modelo', 'fecha_ingreso'], ['WEB-1', 'AQA 200', '2024-01-10']],
             'clientes': [['cliente_id', 'nombre_fantasia', 'zona', 'estado', 'serie', 'fecha_instalacion', 'sistema'], ['80001', 'Cliente web', 'Godoy Cruz', 'Activo', 'WEB-1', '2024-02-01', '4 Etapas'],
                          ['80002', 'Con error', 'Zona que no existe', 'Ex cliente', '', '', '']],
             'comodato': [['cliente_id', 'codigo', 'cantidad'], ['80001', 'BOT', 2]], 'stock': [['deposito', 'codigo', 'cantidad'], ['Depósito Mendoza', 'BOMBA', 3]]}
    for n, filas in hojas.items():
        ws = wb.create_sheet(n)
        for f in filas: ws.append(f)
    wb.save('/tmp/carga.xlsx')
    pag.screenshot(path='/tmp/app_datos.png')
    pag.click('#subpestanas >> text=Configuración >> nth=0')
    pag.wait_for_selector('#esq-config select')
    pag.select_option('#esq-config select >> nth=1', 'E'); pag.click('text=Guardar esquema')
    pag.wait_for_selector('#msg-esq .nota', timeout=15000)
    esq = pag.evaluate("() => [document.getElementById('msg-esq').textContent, S.esqConfig]")
    print('Esquema en Configuración:', esq)
    if esq[1] != '-;E;E;-;-;P' or 'guardado' not in esq[0]: fallas.append('Esquema en Configuración: ' + json.dumps(esq))
    pag.screenshot(path='/tmp/app_datos_config.png')
    pag.click('#subpestanas >> text=Carga masiva')
    with pag.expect_download(timeout=20000) as d: pag.click('text=Descargar plantilla')
    if 'clientes' not in openpyxl.load_workbook(bajado(d.value)).sheetnames: fallas.append('Plantilla sin la hoja clientes')
    pag.set_input_files('#imp-archivo', '/tmp/carga.xlsx'); pag.click('text=Validar')
    pag.wait_for_selector('#imp-res table', timeout=60000)
    res = pag.inner_text('#imp-res')
    print('Validación:', pag.inner_text('#imp-msg').replace('\n', ' · ')[:300])
    if 'Zona que no existe' not in res and 'no existe' not in res: fallas.append('Carga masiva: no marcó el error de zona')
    pag.once('dialog', lambda dlg: dlg.accept()); pag.click('#btn-importar')
    pag.wait_for_function("() => /Importados/.test(document.getElementById('imp-msg').textContent)", timeout=90000)
    msg = pag.inner_text('#imp-msg'); print('Importación:', msg.replace('\n', ' ')[:300])
    if '1 máquinas, 1 clientes' not in msg: fallas.append('Carga masiva: ' + msg[:300])
    pag.goto(BASE + '/index.html')
    pag.wait_for_function("() => document.body.classList.contains('rol-ADMIN') && typeof S !== 'undefined' && S.ini", timeout=30000)
    if not pag.evaluate("() => S.ini.clientes.some(c => c.id === '80001' && c.estado === 'ACTIVO')"): fallas.append('El cliente importado no aparece activo en la app')
    if not pag.evaluate("() => S.ini.depositos.some(d => d.id === 'Depósito Córdoba Capital')"): fallas.append('El depósito renombrado no aparece en la app')
    # Buscador de clientes de Nueva OT: escribir, ver coincidencias y elegir una
    pag.click('nav#pestanas >> text=Nueva OT'); pag.click('#ot-cliente-filtro'); pag.keyboard.type('Resto')
    pag.wait_for_selector('.selector.abierto .combo-op', timeout=5000)
    opciones = pag.locator('.selector.abierto .combo-op').all_text_contents()
    pag.click('.selector.abierto .combo-op >> nth=0')
    elegido = pag.evaluate("() => [document.getElementById('ot-cliente').value, S.ot.idCliente, document.getElementById('ot-cliente-filtro').placeholder]")
    print('Buscador de clientes:', opciones, elegido)
    if len(opciones) != 1 or elegido[0] != '10002' or elegido[1] != '10002' or 'Resto Dos' not in elegido[2]: fallas.append('Buscador de clientes: ' + json.dumps([opciones, elegido]))
    pag.screenshot(path='/tmp/app_buscador.png')
    # Mantenimiento: la OT propone el tipo según el esquema (Resto Dos: Express) y se puede cambiar
    tm = pag.evaluate("() => [S.ot.tipoMant, document.querySelector('#ot-tipo-mant button.activo').textContent, datosOT().d.tipoMant]")
    pag.click('#ot-tipo-mant >> text=Profundo')
    tm2 = pag.evaluate("() => datosOT().d.tipoMant")
    print('Tipo de mantenimiento en la OT:', tm, tm2)
    if tm[0] not in ('EXPRESS', 'PROFUNDO') or tm2 != 'PROFUNDO': fallas.append('Tipo de mantenimiento en la OT: ' + json.dumps([tm, tm2]))
    pag.screenshot(path='/tmp/app_ot_mant.png')
    # Ficha del cliente: esquema propio en 6 casilleros
    pag.click('nav#pestanas >> text=Clientes'); pag.evaluate("() => abrirFormCliente('10002')")
    pag.check('#cf-esq-propio'); pag.select_option('#cf-esquema select >> nth=0', 'P')
    esqCli = pag.evaluate("() => leerEsquemaHtml('cf-esquema')")
    print('Esquema propio en la ficha:', esqCli)
    if not esqCli.startswith('P;') or len(esqCli.split(';')) != 6: fallas.append('Esquema propio: ' + esqCli)
    pag.locator('#cli-form').screenshot(path='/tmp/app_cliente_esquema.png')
    pag.click('#cli-form >> text=Cancelar')
    # CO₂: con Gases Nordelta no se ofrece Leer PDF (se carga a mano)
    pag.goto(BASE + '/co2.html#p-remito')
    pag.wait_for_function("() => typeof S !== 'undefined' && S.ini && document.querySelector('#rem-prov-seg button')", timeout=30000)
    pag.click('#rem-prov-seg >> text=Gases Nordelta')
    leer = pag.evaluate("() => [getComputedStyle(document.getElementById('btn-leer')).display, document.getElementById('rem-prov-nota').textContent.trim().slice(0, 40)]")
    pag.click('#p-remito button:has-text("Cargar a mano")')
    pag.wait_for_function("() => S.remito", timeout=15000)
    prov = pag.evaluate("() => [S.remito.proveedor, document.getElementById('rem-proveedor').value, opRemito().datos.proveedor]")
    print('Remito de GN:', leer, prov)
    if leer[0] != 'none' or prov != ['GN', 'GN', 'GN']: fallas.append('Remito de GN: ' + json.dumps([leer, prov]))
    pag.select_option('#rem-lineas .c-carga select', '__OTRO__'); pag.fill('#rem-lineas .c-carga input', '6.5')
    otro = pag.evaluate("() => { const l = opRemito().datos.lineas[0]; return [l.pesoKg, !!l.cargaNueva]; }")
    print('Otro peso en el remito:', otro)
    if otro != [6.5, True]: fallas.append('Otro peso: ' + json.dumps(otro))
    pag.screenshot(path='/tmp/app_co2_gn.png', full_page=True)
    pag.goto(BASE + '/index.html')
    pag.wait_for_function("() => document.body.classList.contains('rol-ADMIN') && typeof S !== 'undefined' && S.ini", timeout=30000)
    # Carrito de envíos: CABA → Mendoza, queda reservado; después se despacha
    pag.click('nav#pestanas >> text=Envíos'); pag.wait_for_timeout(500)
    pag.select_option('#env-origen', 'Depósito CABA'); pag.select_option('#env-destino', 'Depósito Mendoza')
    pag.select_option('#env-item', 'FRENTE'); pag.fill('#env-cant', '1'); pag.click('#p-envios button:has-text("Agregar ítem")')
    pag.click('button:has-text("Agregar al carrito")')
    pag.wait_for_function("() => (S.ini.carritos || []).some(c => c.origen === 'Depósito CABA' && c.destino === 'Depósito Mendoza')", timeout=20000)
    car = pag.evaluate("() => { const i = carritosVisibles().findIndex(c => c.destino === 'Depósito Mendoza'); const el = document.querySelectorAll('#env-carritos .carrito')[i]; return [i, el ? el.innerText.includes('Reservado') : false, (S.ini.stock.find(s => s.deposito === 'Depósito CABA' && s.codigo === 'FRENTE') || {}).reservado]; }")
    print('Carrito en pantalla:', car)
    if car[0] < 0 or not car[1] or not car[2]: fallas.append('Carrito: ' + json.dumps(car))
    pag.locator('#env-carritos').screenshot(path='/tmp/app_carritos.png')
    pag.evaluate("(i) => despacharCarrito(i)", car[0])
    pag.wait_for_function("() => !(S.ini.carritos || []).some(c => c.origen === 'Depósito CABA' && c.destino === 'Depósito Mendoza')", timeout=20000)
    camino = pag.evaluate("() => S.ini.envios.filter(e => e.estado === 'EN_TRANSITO' && e.origen === 'Depósito CABA' && e.destino === 'Depósito Mendoza').length")
    print('Carrito despachado, envíos en camino:', camino)
    if not camino: fallas.append('El carrito despachado no quedó en camino')
    pag.screenshot(path='/tmp/app_envios.png')
    # Guardar una OT desde la app (navegador → función → base) y que la pantalla se actualice con la respuesta
    r = pag.evaluate("""async () => { const r = await llamar('apiConfirmar', [{ clase: 'OT', datos: { fecha: S.ini.hoy, idCliente: '80001', tipo: 'MANTENIMIENTO', items: [] } }], true);
      if (r.ok) aplicarIni(r.ini); return { ok: r.ok, ids: r.ids, err: JSON.stringify(r.resultados && r.resultados.map(x => x.errores)), mant: (S.ini.clientes.find(c => c.id === '80001') || {}).tipoUltimaVisita }; }""")
    print('OT desde la app:', r)
    if not r['ok'] or r['mant'] != 'MANTENIMIENTO': fallas.append('OT desde la app: ' + json.dumps(r))

    reales = [e for e in errores if 'favicon' not in e and 'Failed to load resource' not in e]
    if reales: fallas.append('Errores en la consola: ' + ' | '.join(reales[:8]))
    nav.close()
if fallas:
    print('FALLAS:\n' + '\n'.join(fallas)); sys.exit(1)
print('App: todas las pestañas abren sin errores.')
