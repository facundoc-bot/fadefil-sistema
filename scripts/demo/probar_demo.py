# Recorre la demo publicada como lo haría alguien: entra con el botón, abre las pantallas,
# carga un ajuste de stock, sale (vuelve a los datos de ejemplo) y comprueba que se borró.
import os, sys
from playwright.sync_api import sync_playwright

URL = os.environ['DEMO_URL'].rstrip('/')
fallas = []
with sync_playwright() as p:
    nav = p.chromium.launch()
    pag = nav.new_page(viewport={'width': 1366, 'height': 900})
    errores = []
    pag.on('pageerror', lambda e: errores.append(str(e)))
    pag.goto(URL + '/index.html')
    pag.click('#btn-demo')
    pag.wait_for_function("() => typeof S !== 'undefined' && S.ini && S.ini.clientes && S.ini.clientes.length", timeout=60000)
    datos = pag.evaluate("() => [S.ini.clientes.length, (S.ini.carritos || []).length, document.getElementById('quien-nombre').textContent, !!document.querySelector('.demo-pill')]")
    print('Inicio de la demo:', datos)
    if datos[0] < 20 or not datos[3]: fallas.append('inicio: ' + str(datos))
    for b in pag.locator('nav#pestanas button[data-panel]').all():
        b.click(); pag.wait_for_timeout(300)
    for pagina in ['co2.html', 'datos.html#usuarios']:
        pag.goto(URL + '/' + pagina); pag.wait_for_timeout(4000)
    pag.goto(URL + '/index.html')
    pag.wait_for_function("() => typeof S !== 'undefined' && S.ini && S.ini.clientes.length", timeout=60000)
    r = pag.evaluate("""async () => (await llamar('apiConfirmar', [{ clase: 'AJUSTE', datos: { fecha: S.ini.hoy, deposito: 'Depósito CABA', codigo: 'BOT', cantidad: 3, tipo: 'COMPRA', motivo: 'Prueba de la demo' } }], true)).ok""")
    antes = pag.evaluate("async () => (await sb.from('operaciones').select('op_id', { count: 'exact', head: true })).count")
    print('Cargado en la demo:', r, '· operaciones:', antes)
    pag.click('aside .pie button')
    pag.wait_for_selector('#btn-demo', timeout=60000)
    pag.click('#btn-demo')
    pag.wait_for_function("() => typeof S !== 'undefined' && S.ini && S.ini.clientes.length", timeout=60000)
    despues = pag.evaluate("async () => (await sb.from('operaciones').select('op_id', { count: 'exact', head: true })).count")
    print('Después de salir y volver a entrar · operaciones:', despues)
    if not r or despues != antes - 1: fallas.append('salir no volvió a los datos de ejemplo: %s → %s' % (antes, despues))
    if errores: fallas.append('errores en la página: ' + ' | '.join(errores[:5]))
    nav.close()
if fallas:
    print('FALLAS:\n' + '\n'.join(fallas)); sys.exit(1)
print('La demo funciona de punta a punta.')
