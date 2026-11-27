/**
 * ============================================================================
 *  SISTEMA FADEFIL — Módulo CO₂ (v2.1, integrado al sistema unificado)
 *  Archivo: co2_Pruebas.gs
 *  Pruebas del motor de reglas. NO tocan la planilla: trabajan con datos
 *  en memoria. Ejecutá co2_ejecutarPruebas() desde el editor y mirá el registro.
 * ============================================================================
 */

function co2_ctxPrueba_() {
  var n = 0;
  return {
    hoy: '2026-10-19',
    depositos: {
      'DEP-CBA': { id: 'DEP-CBA', nombre: 'Depósito Córdoba', plaza: 'CORDOBA', activo: true },
      'DEP-VMA': { id: 'DEP-VMA', nombre: 'Depósito Villa María', plaza: 'VILLA MARIA', activo: true },
      'DEP-MZA': { id: 'DEP-MZA', nombre: 'Depósito Mendoza', plaza: 'MENDOZA', activo: true }
    },
    clientes: {
      // v2: el depósito del cliente sale de su zona → plaza → depósito.
      'CLI-1': { id: 'CLI-1', nombre: 'Cliente Uno', zonaId: 'Z-CBA', depositoId: 'DEP-CBA', activo: true },
      'CLI-2': { id: 'CLI-2', nombre: 'Cliente Dos', zonaId: 'Z-VMA', depositoId: 'DEP-VMA', activo: true },
      'CLI-3': { id: 'CLI-3', nombre: 'Cliente Tres', zonaId: 'Z-MZA', depositoId: 'DEP-MZA', activo: true },
      'CLI-4': { id: 'CLI-4', nombre: 'Cliente Cuatro', zonaId: 'Z-CBA2', depositoId: 'DEP-CBA', activo: true },
      'CLI-9': { id: 'CLI-9', nombre: 'Cliente Inactivo', zonaId: 'Z-CBA', depositoId: 'DEP-CBA', activo: false }
    },
    cilindros: {},
    remitos: [],
    nuevoIdCircuito: function () { n++; return 'CIR-T' + n; }
  };
}

/** Aplica los estados simulados al contexto, como si se hubiera confirmado. */
function co2_confirmarEnCtx_(ctx, sim, remitosNuevos) {
  ctx.cilindros = sim.estadosFinales;
  (remitosNuevos || []).forEach(function (r) { ctx.remitos.push(r); });
}

function co2_remitoOp_(nro, fecha, dep, entregas, retiros, extra) {
  var lineas = (entregas || []).map(function (s) { return { tipo: 'ENTREGA', serie: s }; })
    .concat((retiros || []).map(function (s) { return { tipo: 'RETIRO', serie: s }; }));
  var d = { nroRemito: nro, fecha: fecha, idDeposito: dep, lineas: lineas };
  Object.keys(extra || {}).forEach(function (k) { d[k] = extra[k]; });
  return { clase: 'REMITO', datos: d };
}

function co2_trabajoOp_(fecha, tipo, cli, entregadas, retiradas) {
  return { clase: 'TRABAJO', datos: { fecha: fecha, tipo: tipo, idCliente: cli, entregadas: entregadas || [], retiradas: retiradas || [] } };
}

/** Deja A1 y A2 llenas en DEP-CBA (remito R-100 del 01/03/2026). */
function co2_ctxConDosLlenos_() {
  var ctx = co2_ctxPrueba_();
  var sim = co2_simularLote([co2_remitoOp_('R-100', '2026-03-01', 'DEP-CBA', ['A1', 'A2'])], ctx);
  co2_confirmarEnCtx_(ctx, sim, [{ idRemito: 'REM-1', nroNorm: co2_normalizarNroRemito('R-100'), idDeposito: 'DEP-CBA', estado: 'CONFIRMADO' }]);
  return ctx;
}

function co2_codigos_(sim) {
  var c = [];
  sim.resultados.forEach(function (r) { r.errores.forEach(function (e) { c.push(e.codigo); }); });
  return c;
}

function co2_advertencias_(sim) {
  var c = [];
  sim.resultados.forEach(function (r) { r.advertencias.forEach(function (e) { c.push(e.codigo); }); });
  return c;
}

function co2_casosDePrueba_() {
  return [
    {
      nombre: 'Maestro §7.10 — LINDE entrega A1754410 y A542118 en Córdoba el 24/10/2025',
      fn: function (t) {
        var ctx = co2_ctxPrueba_();
        var sim = co2_simularLote([co2_remitoOp_('0001-00001001', '2025-10-24', 'DEP-CBA', ['A1754410', 'A542118'])], ctx);
        t.igual(sim.ok, true, 'el remito es válido');
        t.igual(sim.estadosFinales.A1754410.estado, co2_ESTADO.LLENO, 'A1754410 queda Lleno disponible');
        t.igual(sim.estadosFinales.A1754410.ubicId, 'DEP-CBA', 'A1754410 queda en Depósito Córdoba');
        t.igual(sim.estadosFinales.A542118.depOrigen, 'DEP-CBA', 'A542118 tiene origen de circuito Córdoba');
        t.distinto(sim.estadosFinales.A1754410.idCircuito, sim.estadosFinales.A542118.idCircuito, 'cada cilindro abre su propio circuito');
      }
    },
    {
      nombre: 'Maestro §7.10 — LINDE retira ambos el 26/12/2025 (sin movimientos en clientes cargados)',
      fn: function (t) {
        var ctx = co2_ctxPrueba_();
        var sim1 = co2_simularLote([co2_remitoOp_('0001-00001001', '2025-10-24', 'DEP-CBA', ['A1754410', 'A542118'])], ctx);
        co2_confirmarEnCtx_(ctx, sim1, [{ idRemito: 'REM-1', nroNorm: co2_normalizarNroRemito('0001-00001001'), idDeposito: 'DEP-CBA', estado: 'CONFIRMADO' }]);
        var sim2 = co2_simularLote([co2_remitoOp_('0001-00001877', '2025-12-26', 'DEP-CBA', [], ['A1754410', 'A542118'])], ctx);
        t.igual(sim2.ok, true, 'el retiro es válido');
        t.igual(sim2.estadosFinales.A1754410.estado, co2_ESTADO.LINDE, 'A1754410 queda Entregado a LINDE');
        t.igual(sim2.estadosFinales.A1754410.ubicTipo, co2_UBIC.LINDE, 'A1754410 queda ubicado en LINDE');
        t.contiene(co2_advertencias_(sim2), 'RETIRO_LINDE_LLENO', 'avisa que salen llenos: faltan los movimientos en clientes');
      }
    },
    {
      nombre: 'Ciclo completo: LINDE → cliente → depósito de origen → LINDE',
      fn: function (t) {
        var ctx = co2_ctxConDosLlenos_();
        var sim = co2_simularLote([
          co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-1', ['A1']),
          co2_trabajoOp_('2026-04-10', 'RETIRO', 'CLI-1', [], ['A1']),
          co2_remitoOp_('R-200', '2026-04-20', 'DEP-CBA', [], ['A1'])
        ], ctx);
        t.igual(sim.ok, true, 'las tres operaciones son válidas');
        t.igual(sim.resultados[0].movimientos[0].estadoNuevo, co2_ESTADO.EN_USO, 'en el cliente queda En uso');
        t.igual(sim.resultados[1].movimientos[0].destinoId, 'DEP-CBA', 'el retiro vuelve al depósito de origen');
        t.igual(sim.resultados[1].movimientos[0].estadoNuevo, co2_ESTADO.VACIO, 'vuelve Vacío disponible');
        t.igual(co2_advertencias_(sim).indexOf('RETIRO_LINDE_LLENO'), -1, 'sale vacío: sin advertencia');
        t.igual(sim.resultados[2].movimientos[0].circuitoCierra, true, 'el retiro de LINDE cierra el circuito');
      }
    },
    {
      nombre: 'Recambio: entrega una llena y retira la vacía en la misma visita',
      fn: function (t) {
        var ctx = co2_ctxConDosLlenos_();
        var sim = co2_simularLote([
          co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-1', ['A1']),
          co2_trabajoOp_('2026-04-10', 'RECAMBIO', 'CLI-1', ['A2'], ['A1'])
        ], ctx);
        t.igual(sim.ok, true, 'el recambio es válido');
        t.igual(sim.estadosFinales.A1.estado, co2_ESTADO.VACIO, 'A1 vuelve vacía');
        t.igual(sim.estadosFinales.A2.ubicId, 'CLI-1', 'A2 queda en el cliente');
        t.igual(sim.resultados[1].movimientos.length, 2, 'un movimiento por serie');
      }
    },
    {
      nombre: 'Retiro de cliente vuelve al depósito de ORIGEN aunque el cliente haya pasado a otra zona',
      fn: function (t) {
        var ctx = co2_ctxConDosLlenos_();
        var sim = co2_simularLote([co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-4', ['A1'])], ctx);
        t.igual(sim.ok, true, 'otra zona de la misma plaza: mismo depósito, válido');
        t.igual(sim.resultados[0].movimientos[0].zonaId, 'Z-CBA2', 'el movimiento guarda la zona del cliente');
        co2_confirmarEnCtx_(ctx, sim);
        ctx.clientes['CLI-4'].depositoId = 'DEP-VMA'; // el cliente cambió de zona
        var sim2 = co2_simularLote([co2_trabajoOp_('2026-04-10', 'RETIRO', 'CLI-4', [], ['A1'])], ctx);
        t.igual(sim2.ok, true, 'el retiro es válido');
        t.igual(sim2.estadosFinales.A1.ubicId, 'DEP-CBA', 'vuelve a Córdoba (origen del circuito), no a Villa María');
      }
    },
    {
      nombre: 'Reingreso: tras el retiro de LINDE, la misma serie abre un circuito nuevo (puede ser otra provincia)',
      fn: function (t) {
        var ctx = co2_ctxConDosLlenos_();
        var circuitoViejo = ctx.cilindros.A1.idCircuito;
        var sim = co2_simularLote([
          co2_remitoOp_('R-300', '2026-03-10', 'DEP-CBA', [], ['A1']),
          co2_remitoOp_('R-301', '2026-03-20', 'DEP-MZA', ['A1'])
        ], ctx);
        t.igual(sim.ok, true, 'válido');
        t.igual(sim.estadosFinales.A1.depOrigen, 'DEP-MZA', 'nuevo origen Mendoza');
        t.distinto(sim.estadosFinales.A1.idCircuito, circuitoViejo, 'nuevo número de circuito');
      }
    },
    {
      nombre: 'Validación 1 — serie duplicada en un mismo trabajo',
      fn: function (t) {
        var sim = co2_simularLote([co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-1', ['A1', 'a1 '])], co2_ctxConDosLlenos_());
        t.igual(sim.ok, false, 'se rechaza');
        t.contiene(co2_codigos_(sim), 'SERIE_DUPLICADA_EN_TRABAJO', 'código correcto (normaliza "a1 " = "A1")');
      }
    },
    {
      nombre: 'Validación 2 — entrega de una serie que no existe',
      fn: function (t) {
        var sim = co2_simularLote([co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-1', ['ZZ999'])], co2_ctxConDosLlenos_());
        t.contiene(co2_codigos_(sim), 'SERIE_INEXISTENTE', 'código correcto');
      }
    },
    {
      nombre: 'Validación 3 — entrega de un cilindro vacío',
      fn: function (t) {
        var sim = co2_simularLote([
          co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-1', ['A1']),
          co2_trabajoOp_('2026-03-06', 'RETIRO', 'CLI-1', [], ['A1']),
          co2_trabajoOp_('2026-03-07', 'ENTREGA', 'CLI-1', ['A1'])
        ], co2_ctxConDosLlenos_());
        t.contiene(co2_codigos_(sim), 'ENTREGA_CILINDRO_VACIO', 'código correcto');
      }
    },
    {
      nombre: 'Validación 4 — entrega de un cilindro que ya está en otro cliente',
      fn: function (t) {
        var sim = co2_simularLote([
          co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-1', ['A1']),
          co2_trabajoOp_('2026-03-06', 'ENTREGA', 'CLI-2', ['A1'])
        ], co2_ctxConDosLlenos_());
        t.contiene(co2_codigos_(sim), 'ENTREGA_YA_EN_CLIENTE', 'código correcto');
      }
    },
    {
      nombre: 'Validación 5 — retiro de una serie que no figura en el cliente',
      fn: function (t) {
        var sim = co2_simularLote([
          co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-1', ['A1']),
          co2_trabajoOp_('2026-03-06', 'RETIRO', 'CLI-2', [], ['A1'])
        ], co2_ctxConDosLlenos_());
        t.contiene(co2_codigos_(sim), 'RETIRO_NO_FIGURA_EN_CLIENTE', 'código correcto');
      }
    },
    {
      nombre: 'Validación 6 — LINDE retira un cilindro que figura en un cliente',
      fn: function (t) {
        var sim = co2_simularLote([
          co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-1', ['A1']),
          co2_remitoOp_('R-400', '2026-03-06', 'DEP-CBA', [], ['A1'])
        ], co2_ctxConDosLlenos_());
        t.contiene(co2_codigos_(sim), 'RETIRO_LINDE_EN_CLIENTE', 'código correcto');
      }
    },
    {
      nombre: 'Validación 7 — LINDE retira en un depósito distinto del que tiene el cilindro',
      fn: function (t) {
        var sim = co2_simularLote([co2_remitoOp_('R-401', '2026-03-06', 'DEP-VMA', [], ['A1'])], co2_ctxConDosLlenos_());
        t.contiene(co2_codigos_(sim), 'RETIRO_LINDE_OTRO_DEPOSITO', 'código correcto');
      }
    },
    {
      nombre: 'Validación 8 — nuevo circuito sin cerrar el anterior',
      fn: function (t) {
        var sim = co2_simularLote([co2_remitoOp_('R-402', '2026-03-06', 'DEP-CBA', ['A1'])], co2_ctxConDosLlenos_());
        t.contiene(co2_codigos_(sim), 'CIRCUITO_ABIERTO', 'código correcto');
      }
    },
    {
      nombre: 'Validación 9 — un cilindro no cambia de depósito sin LINDE (aunque sea la misma provincia)',
      fn: function (t) {
        var sim = co2_simularLote([co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-3', ['A1'])], co2_ctxConDosLlenos_());
        t.contiene(co2_codigos_(sim), 'CAMBIO_DEPOSITO_SIN_LINDE', 'Córdoba → cliente de Mendoza');
        var sim2 = co2_simularLote([co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-2', ['A1'])], co2_ctxConDosLlenos_());
        t.contiene(co2_codigos_(sim2), 'CAMBIO_DEPOSITO_SIN_LINDE', 'Córdoba → cliente de Villa María');
      }
    },
    {
      nombre: 'Validación 10 — doble registro del mismo remito (normalización de número)',
      fn: function (t) {
        var sim = co2_simularLote([co2_remitoOp_('0001-00000100', '2026-03-01', 'DEP-CBA', ['B7'])], co2_ctxConDosLlenos_());
        t.igual(co2_normalizarNroRemito('0001-00000100'), co2_normalizarNroRemito('1-100'), 'normaliza ceros a la izquierda');
        // "R-100" normaliza a "100", distinto de "1-100": no son el mismo número
        t.igual(co2_codigos_(sim).indexOf('REMITO_DUPLICADO'), -1, 'R-100 y 0001-00000100 no se confunden');
        var sim2 = co2_simularLote([co2_remitoOp_('R-100', '2026-03-01', 'DEP-CBA', ['B7'])], co2_ctxConDosLlenos_());
        t.contiene(co2_codigos_(sim2), 'REMITO_DUPLICADO', 'el mismo número en el mismo depósito se rechaza');
        var sim3 = co2_simularLote([co2_remitoOp_('R-100', '2026-03-01', 'DEP-MZA', ['B7'])], co2_ctxConDosLlenos_());
        t.contiene(co2_codigos_(sim3), 'REMITO_DUPLICADO', 'v1.6: en otro depósito también se rechaza');
      }
    },
    {
      nombre: 'Validación 10b — el mismo remito dos veces en una misma carga',
      fn: function (t) {
        var sim = co2_simularLote([
          co2_remitoOp_('R-500', '2026-03-01', 'DEP-MZA', ['C1']),
          co2_remitoOp_('R-500', '2026-03-01', 'DEP-MZA', ['C2'])
        ], co2_ctxPrueba_());
        t.contiene(co2_codigos_(sim), 'REMITO_DUPLICADO', 'código correcto');
      }
    },
    {
      nombre: 'Validación 11 — series duplicadas dentro de un remito',
      fn: function (t) {
        var sim = co2_simularLote([co2_remitoOp_('R-501', '2026-03-01', 'DEP-MZA', ['C1', 'C1'])], co2_ctxPrueba_());
        t.contiene(co2_codigos_(sim), 'SERIE_DUPLICADA_EN_REMITO', 'código correcto');
      }
    },
    {
      nombre: 'Validación 12 — serie incompatible con su estado (entregar una serie ya devuelta a LINDE)',
      fn: function (t) {
        var sim = co2_simularLote([
          co2_remitoOp_('R-502', '2026-03-06', 'DEP-CBA', [], ['A1']),
          co2_trabajoOp_('2026-03-07', 'ENTREGA', 'CLI-1', ['A1'])
        ], co2_ctxConDosLlenos_());
        t.contiene(co2_codigos_(sim), 'ENTREGA_FUERA_DE_CIRCUITO', 'código correcto');
        var sim2 = co2_simularLote([
          co2_remitoOp_('R-503', '2026-03-06', 'DEP-CBA', [], ['A1']),
          co2_remitoOp_('R-504', '2026-03-07', 'DEP-CBA', [], ['A1'])
        ], co2_ctxConDosLlenos_());
        t.contiene(co2_codigos_(sim2), 'RETIRO_LINDE_CIRCUITO_CERRADO', 'LINDE no puede retirar dos veces');
      }
    },
    {
      nombre: 'Validación 13 — ubicaciones imposibles por fecha (movimiento antes del último registrado)',
      fn: function (t) {
        var sim = co2_simularLote([co2_trabajoOp_('2026-02-15', 'ENTREGA', 'CLI-1', ['A1'])], co2_ctxConDosLlenos_());
        t.contiene(co2_codigos_(sim), 'FECHA_ANTERIOR_A_HISTORIAL', 'no se entrega antes de que LINDE lo haya traído');
      }
    },
    {
      nombre: 'Cabeceras: fecha futura, cliente inactivo, tipo de trabajo incompatible',
      fn: function (t) {
        var ctx = co2_ctxConDosLlenos_();
        t.contiene(co2_codigos_(co2_simularLote([co2_trabajoOp_('2027-01-01', 'ENTREGA', 'CLI-1', ['A1'])], ctx)), 'FECHA_FUTURA', 'fecha futura');
        t.contiene(co2_codigos_(co2_simularLote([co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-9', ['A1'])], ctx)), 'CLIENTE_INACTIVO', 'cliente inactivo');
        t.contiene(co2_codigos_(co2_simularLote([co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-1', ['A1'], ['A2'])], ctx)), 'TIPO_INCOMPATIBLE', 'entrega con retiradas');
        t.contiene(co2_codigos_(co2_simularLote([co2_trabajoOp_('2026-02-30', 'ENTREGA', 'CLI-1', ['A1'])], ctx)), 'FECHA_INVALIDA', '30 de febrero');
      }
    },
    {
      nombre: 'Lote: si una operación falla, el lote completo no se confirma',
      fn: function (t) {
        var sim = co2_simularLote([
          co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-1', ['A1']),
          co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-1', ['NOEXISTE'])
        ], co2_ctxConDosLlenos_());
        t.igual(sim.ok, false, 'lote rechazado');
        t.igual(sim.resultados[0].errores.length, 0, 'la primera operación estaba bien');
      }
    },
    {
      nombre: 'Inventario inicial: alta en cliente y luego retiro',
      fn: function (t) {
        var ctx = co2_ctxPrueba_();
        var sim = co2_simularLote([
          { clase: 'ALTA', datos: { fecha: '2026-01-02', serie: 'H55', idDepositoOrigen: 'DEP-CBA', ubicacion: 'CLIENTE', idCliente: 'CLI-1', estado: co2_ESTADO.EN_USO } },
          co2_trabajoOp_('2026-01-10', 'RETIRO', 'CLI-1', [], ['H55'])
        ], ctx);
        t.igual(sim.ok, true, 'válido');
        t.igual(sim.estadosFinales.H55.ubicId, 'DEP-CBA', 'vuelve al origen declarado');
        var sim2 = co2_simularLote([{ clase: 'ALTA', datos: { fecha: '2026-03-02', serie: 'A1', idDepositoOrigen: 'DEP-CBA', ubicacion: 'DEPOSITO', estado: co2_ESTADO.LLENO } }], co2_ctxConDosLlenos_());
        t.contiene(co2_codigos_(sim2), 'CIRCUITO_ABIERTO', 'no da de alta una serie con circuito abierto');
      }
    },
    {
      nombre: 'Reconstrucción por historial = estado simulado',
      fn: function (t) {
        var ctx = co2_ctxPrueba_();
        var sim = co2_simularLote([
          co2_remitoOp_('R-1', '2026-03-01', 'DEP-CBA', ['X1']),
          co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-1', ['X1']),
          co2_trabajoOp_('2026-03-09', 'RETIRO', 'CLI-1', [], ['X1']),
          co2_remitoOp_('R-2', '2026-03-15', 'DEP-CBA', [], ['X1'])
        ], ctx);
        var movs = [];
        sim.resultados.forEach(function (r, i) { r.movimientos.forEach(function (m) { m.refId = 'OP' + i; movs.push(m); }); });
        var rec = co2_reconstruirSerie('X1', movs);
        t.igual(rec.estado.estado, sim.estadosFinales.X1.estado, 'mismo estado');
        t.igual(rec.inconsistencias.length, 0, 'historial coherente');
        var ids = Object.keys(rec.circuitos);
        t.igual(ids.length, 1, 'un circuito');
        t.igual(rec.circuitos[ids[0]].estado, 'CERRADO', 'circuito cerrado');
        t.igual(rec.circuitos[ids[0]].refSalida, 'OP3', 'cerrado por el remito de retiro');
      }
    },
    {
      nombre: 'Alertas v1.1 — cilindro inmovilizado en cliente y vacío sin devolver',
      fn: function (t) {
        var ctx = co2_ctxConDosLlenos_();
        var sim = co2_simularLote([
          co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-1', ['A1', 'A2']),
          co2_trabajoOp_('2026-04-01', 'RETIRO', 'CLI-1', [], ['A2'])
        ], ctx);
        var op = { hoy: '2026-06-10', diasCliente: 60, diasVacio: 30, clientes: ctx.clientes, depositos: ctx.depositos };
        var al = co2_detectarAlertas(sim.estadosFinales, op);
        t.igual(al.length, 2, 'dos alertas');
        t.igual(al[0].codigo, 'CILINDRO_INMOVILIZADO', 'A1 lleva 97 días en el cliente');
        t.igual(al[0].dias, 97, 'cuenta bien los días (05/03 → 10/06)');
        t.igual(al[1].codigo, 'VACIO_SIN_DEVOLVER', 'A2 lleva 70 días vacía en el depósito');
        op.hoy = '2026-04-20';
        t.igual(co2_detectarAlertas(sim.estadosFinales, op).length, 0, 'dentro de los límites no alerta');
        op.diasCliente = 0; op.diasVacio = 0; op.hoy = '2027-01-01';
        t.igual(co2_detectarAlertas(sim.estadosFinales, op).length, 0, 'con límite 0 el control queda apagado');
      }
    },
    {
      nombre: 'v1.2 — carga obligatoria (5 o 10 kg) al entrar y fija para siempre',
      fn: function (t) {
        var ctx = co2_ctxPrueba_(); ctx.cargasValidas = [5, 10];
        var rem = co2_remitoOp_('R-700', '2026-03-01', 'DEP-CBA', ['K1']);
        t.contiene(co2_codigos_(co2_simularLote([rem], ctx)), 'CARGA_INVALIDA', 'sin carga se rechaza');
        rem.datos.lineas[0].pesoKg = 7;
        t.contiene(co2_codigos_(co2_simularLote([rem], ctx)), 'CARGA_INVALIDA', '7 kg no es una carga válida');
        rem.datos.lineas[0].pesoKg = 10;
        var sim = co2_simularLote([rem, co2_remitoOp_('R-701', '2026-03-10', 'DEP-CBA', [], ['K1'])], ctx);
        t.igual(sim.ok, true, 'con 10 kg entra y sale');
        t.igual(sim.estadosFinales.K1.pesoKg, 10, 'la serie conserva 10 kg aun en LINDE');
        co2_confirmarEnCtx_(ctx, sim, []);
        var otra = co2_remitoOp_('R-702', '2026-04-01', 'DEP-MZA', ['K1']); otra.datos.lineas[0].pesoKg = 5;
        t.contiene(co2_codigos_(co2_simularLote([otra], ctx)), 'CARGA_DISTINTA', 'al reingresar no puede cambiar a 5 kg');
        otra.datos.lineas[0].pesoKg = 10;
        t.igual(co2_simularLote([otra], ctx).ok, true, 'reingresa con la misma carga');
        var alta = { clase: 'ALTA', datos: { fecha: '2026-03-02', serie: 'K9', idDepositoOrigen: 'DEP-CBA', ubicacion: 'DEPOSITO', estado: co2_ESTADO.LLENO } };
        t.contiene(co2_codigos_(co2_simularLote([alta], ctx)), 'CARGA_INVALIDA', 'el inventario inicial también exige la carga');
      }
    },
    {
      nombre: 'v1.2 — cliente inactivo: se le puede retirar, no entregar',
      fn: function (t) {
        var ctx = co2_ctxConDosLlenos_();
        co2_confirmarEnCtx_(ctx, co2_simularLote([co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-1', ['A1'])], ctx), []);
        ctx.clientes['CLI-1'].activo = false;
        t.igual(co2_simularLote([co2_trabajoOp_('2026-03-09', 'RETIRO', 'CLI-1', [], ['A1'])], ctx).ok, true, 'retiro permitido');
        t.contiene(co2_codigos_(co2_simularLote([co2_trabajoOp_('2026-03-09', 'ENTREGA', 'CLI-1', ['A2'])], ctx)), 'CLIENTE_INACTIVO', 'entrega rechazada');
        t.contiene(co2_codigos_(co2_simularLote([co2_trabajoOp_('2026-03-09', 'RECAMBIO', 'CLI-1', ['A2'], ['A1'])], ctx)), 'CLIENTE_INACTIVO', 'recambio rechazado');
      }
    },
    {
      nombre: 'v2 — cliente sin depósito (zona sin plaza o plaza sin depósito)',
      fn: function (t) {
        var ctx = co2_ctxConDosLlenos_();
        ctx.clientes['CLI-1'].depositoId = '';
        var sim = co2_simularLote([co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-1', ['A1'])], ctx);
        t.contiene(co2_codigos_(sim), 'CLIENTE_SIN_DEPOSITO', 'no se le puede entregar');
      }
    },
    {
      nombre: 'v1.2 — referencias rotas: depósito o cliente que ya no existe',
      fn: function (t) {
        var ctx = co2_ctxConDosLlenos_();
        var sim = co2_simularLote([co2_trabajoOp_('2026-03-05', 'ENTREGA', 'CLI-1', ['A1'])], ctx);
        var deps = { 'DEP-MZA': ctx.depositos['DEP-MZA'] }; // se "borró" Córdoba
        var al = co2_detectarAlertas(sim.estadosFinales, { hoy: '2026-03-06', diasCliente: 0, diasVacio: 0, clientes: {}, depositos: deps });
        var cods = al.map(function (a) { return a.codigo + ':' + a.serie; });
        t.contiene(cods, 'DEPOSITO_INEXISTENTE:A1', 'A1 apunta a un depósito borrado');
        t.contiene(cods, 'DEPOSITO_INEXISTENTE:A2', 'A2 también');
        t.contiene(cods, 'CLIENTE_INEXISTENTE:A1', 'A1 está en un cliente borrado');
      }
    },
    {
      nombre: 'v1.5 — recambios: consumo por vacíos retirados, kg/mes y próximo recambio',
      fn: function (t) {
        var mv = function (fecha, tipo, serie, oT, oI, dT, dI, ref) {
          return { fecha: fecha, tipoMov: tipo, serie: serie, origenTipo: oT, origenId: oI, destinoTipo: dT, destinoId: dI, depOrigen: 'Córdoba', refId: ref };
        };
        var movs = [
          mv('2026-04-01', co2_MOV.ENTREGA_CLIENTE, 'A1', 'DEPOSITO', 'Córdoba', 'CLIENTE', 'CLI-1', 'T1'),
          mv('2026-04-01', co2_MOV.ENTREGA_CLIENTE, 'A2', 'DEPOSITO', 'Córdoba', 'CLIENTE', 'CLI-1', 'T1'),
          mv('2026-05-01', co2_MOV.RETIRO_CLIENTE, 'A1', 'CLIENTE', 'CLI-1', 'DEPOSITO', 'Córdoba', 'T2'),
          mv('2026-05-01', co2_MOV.RETIRO_CLIENTE, 'A2', 'CLIENTE', 'CLI-1', 'DEPOSITO', 'Córdoba', 'T2'),
          mv('2026-05-01', co2_MOV.ENTREGA_CLIENTE, 'A3', 'DEPOSITO', 'Córdoba', 'CLIENTE', 'CLI-1', 'T2'),
          mv('2026-06-01', co2_MOV.RETIRO_CLIENTE, 'A3', 'CLIENTE', 'CLI-1', 'DEPOSITO', 'Córdoba', 'T3'),
          mv('2026-06-01', co2_MOV.ENTREGA_CLIENTE, 'A4', 'DEPOSITO', 'Córdoba', 'CLIENTE', 'CLI-1', 'T3')
        ];
        var cils = { A1: { pesoKg: 10 }, A2: { pesoKg: 5 }, A3: { pesoKg: 10 }, A4: { pesoKg: 10, ubicTipo: 'CLIENTE', ubicId: 'CLI-1', estado: co2_ESTADO.EN_USO } };
        var r = co2_analizarRecambios(movs, { hoy: '2026-07-01', meses: 0, cilindros: cils, clientes: co2_ctxPrueba_().clientes, mesesGrafico: 12 });
        var c = r.clientes[0];
        t.igual(c.recambios, 2, 'dos visitas con retiro = dos recambios (aunque una retire dos cilindros)');
        t.igual(c.kg, 25, 'consumo = carga de los vacíos retirados (10 + 5 + 10)');
        t.igual(c.intervalo, 31, 'ciclos de 30 y 31 días → promedio 30,5, redondeado a 31');
        t.igual(c.ultimo, '2026-06-01', 'último recambio');
        t.igual(c.proximo, '2026-07-02', 'próximo = último + intervalo promedio');
        t.igual(c.diasParaProximo, 1, 'falta 1 día');
        t.igual(c.kgEnCliente, 10, 'tiene hoy 10 kg en uso');
        t.igual(c.kgMes, 8.4, '25 kg en 91 días ≈ 8,4 kg por mes');
        var may = r.mensual.filter(function (m) { return m.mes === '2026-05'; })[0];
        t.igual(may.total, 15, 'mayo: 15 kg consumidos');
        t.igual(may.porZona['Z-CBA'], 15, 'y se atribuyen a la zona del cliente');
        t.igual(r.mensual.length, 12, 'el gráfico tiene 12 meses');
        t.igual(r.mensual[11].enCurso, true, 'el último es el mes en curso');
        var r2 = co2_analizarRecambios(movs, { hoy: '2026-07-01', meses: 1, cilindros: cils, clientes: co2_ctxPrueba_().clientes });
        t.igual(r2.clientes[0].recambios, 1, 'con período de 1 mes cuenta solo el recambio de junio');
        t.igual(r2.clientes[0].kg, 10, 'y sus 10 kg');
        t.igual(co2_restarMesesIso('2026-03-31', 1), '2026-02-28', 'restar un mes a fin de mes no se pasa de mes');
      }
    },
    {
      nombre: 'v1.6 — carga inicial: borradores cargados en cualquier orden se procesan por fecha',
      fn: function (t) {
        var ctx = co2_ctxPrueba_(); ctx.cargasValidas = [5, 10];
        var rem = function (id, nro, fecha, dep, ent, ret) {
          var lineas = (ent || []).map(function (x) { return { tipo: 'ENTREGA', serie: x, pesoKg: 10 }; })
            .concat((ret || []).map(function (x) { return { tipo: 'RETIRO', serie: x }; }));
          return { id: id, nroNorm: co2_normalizarNroRemito(nro), fecha: fecha, estado: 'PENDIENTE', datos: { nroRemito: nro, fecha: fecha, idDeposito: dep, lineas: lineas } };
        };
        var opDe = function (b) { return { clase: 'REMITO', datos: b.datos }; };
        // Cargados en este orden: primero Mendoza (marzo), después Córdoba (febrero y enero).
        var bs = [
          rem('B1', '0002-00000001', '2025-03-01', 'DEP-MZA', ['X1']),
          rem('B2', '0001-00000002', '2025-02-10', 'DEP-CBA', [], ['X1']),
          rem('B3', '0001-00000001', '2025-01-10', 'DEP-CBA', ['X1', 'X2']),
          // Mismo día: retiro en Mendoza y nueva entrega en Córdoba; por número iría primero la entrega.
          rem('B4', '0002-00000009', '2025-04-01', 'DEP-MZA', [], ['X1']),
          rem('B5', '0001-00000003', '2025-04-01', 'DEP-CBA', ['X1']),
          rem('B6', '0001-00000004', '2025-04-02', 'DEP-CBA', [], ['ZZ9'])
        ];
        var r = co2_simularCargaInicial(bs, ctx, opDe);
        t.igual(r.aceptados.map(function (b) { return b.id; }).join(), 'B3,B2,B1,B4,B5', 'se procesan por fecha; B5 se reintenta después de B4');
        t.igual(r.fallidos.length, 1, 'solo falla el retiro de una serie que nunca entró');
        t.igual(r.fallidos[0].errores[0].codigo, 'RETIRO_LINDE_SERIE_INEXISTENTE', 'con el motivo');
        t.igual(ctx.cilindros.X1.ubicId, 'DEP-CBA', 'X1 termina llena en Córdoba (nuevo circuito)');
        var lote = co2_simularLote(r.aceptados.map(opDe), co2_ctxPrueba_());
        t.igual(lote.ok, true, 'los aceptados, en ese orden, forman un lote válido');

        var lista = bs.map(function (b) { return { id: b.id, nroNorm: b.nroNorm, idDeposito: b.datos.idDeposito, estado: 'PENDIENTE', entregas: b.datos.lineas.filter(function (l) { return l.tipo === 'ENTREGA'; }).map(function (l) { return l.serie; }) }; });
        var v = co2_validarBorradorRemito({ nroRemito: '0001 00000001', fecha: '2025-05-01', idDeposito: 'DEP-MZA', lineas: [{ tipo: 'ENTREGA', serie: 'Q1', pesoKg: 10 }] }, co2_ctxPrueba_(), lista);
        t.contiene(co2_codigos_({ resultados: [v] }), 'REMITO_DUPLICADO', 'el número ya cargado como borrador se rechaza, aunque sea otra plaza');
        var v2 = co2_validarBorradorRemito({ nroRemito: '0009-1', fecha: '2025-05-01', idDeposito: 'DEP-CBA', lineas: [{ tipo: 'ENTREGA', serie: 'Q1' }, { tipo: 'RETIRO', serie: 'X2' }, { tipo: 'RETIRO', serie: 'NUEVA' }] }, Object.assign(co2_ctxPrueba_(), { cargasValidas: [5, 10] }), lista);
        t.contiene(co2_codigos_({ resultados: [v2] }), 'CARGA_INVALIDA', 'la entrega sin carga se rechaza en el borrador');
        var avs = v2.advertencias.map(function (a) { return a.codigo + ':' + a.serie; });
        t.contiene(avs, 'RETIRO_SIN_ENTREGA_PREVIA:NUEVA', 'avisa el retiro de una serie que no aparece en ningún lado');
        t.igual(avs.indexOf('RETIRO_SIN_ENTREGA_PREVIA:X2'), -1, 'X2 está entregada en otro borrador: no avisa');
      }
    },
    {
      nombre: 'Anulación: solo si no hay movimientos posteriores',
      fn: function (t) {
        var movs = { A1: [
          { refId: 'REM-1', tipoMov: co2_MOV.ENTREGA_LINDE, fecha: '2026-03-01' },
          { refId: 'TRB-1', tipoMov: co2_MOV.ENTREGA_CLIENTE, fecha: '2026-03-05' }
        ] };
        t.igual(co2_validarAnulacion('REM-1', movs).ok, false, 'no se anula el remito si después hubo una entrega');
        t.igual(co2_validarAnulacion('TRB-1', movs).ok, true, 'sí se anula la última operación');
      }
    },
    {
      nombre: 'v2.1 — Dos proveedores en el mismo depósito: CABA con LINDE y GBA con Gases Nordelta',
      fn: function (t) {
        var ctx = co2_ctxPrueba_();
        ctx.proveedores = { LINDE: { id: 'LINDE', nombre: 'LINDE' }, GN: { id: 'GN', nombre: 'Gases Nordelta' } };
        ctx.plazas = { CABA: { id: 'CABA', depositoId: 'DEP-CBA', proveedor: 'LINDE' }, GBA: { id: 'GBA', depositoId: 'DEP-CBA', proveedor: 'GN' } };
        ctx.clientes['CLI-1'].plazaId = 'CABA'; ctx.clientes['CLI-4'].plazaId = 'GBA';
        ctx.cargasValidas = [2.5, 5, 10, 25];
        var rem = function (nro, prov, entregas, retiros, kg, fecha) {
          return { clase: 'REMITO', datos: { nroRemito: nro, fecha: fecha || '2026-03-01', idDeposito: 'DEP-CBA', proveedor: prov,
            lineas: (entregas || []).map(function (x) { return { tipo: 'ENTREGA', serie: x, pesoKg: kg || 10 }; }).concat((retiros || []).map(function (x) { return { tipo: 'RETIRO', serie: x }; })) } };
        };
        var sim = co2_simularLote([rem('100', 'GN', ['G1', 'G2'], [], 25), rem('100', 'LINDE', ['L1'], [], 2.5)], ctx);
        t.igual(sim.ok, true, 'el mismo número de remito puede venir de los dos proveedores');
        t.igual(sim.estadosFinales.G1.proveedor + '/' + sim.estadosFinales.G1.pesoKg + ' · ' + sim.estadosFinales.L1.proveedor + '/' + sim.estadosFinales.L1.pesoKg,
          'GN/25 · LINDE/2.5', 'cada serie queda con su proveedor y su carga');
        co2_confirmarEnCtx_(ctx, sim, [{ nroNorm: co2_normalizarNroRemito('100'), idDeposito: 'DEP-CBA', estado: 'CONFIRMADO', proveedor: 'GN' }]);
        t.contiene(co2_codigos_(co2_simularLote([rem('100', 'GN', ['G9'])], ctx)), 'REMITO_DUPLICADO', 'dentro de un proveedor el número no se repite');
        t.contiene(co2_codigos_(co2_simularLote([rem('101', 'GN', ['G9'], [], 7)], ctx)), 'CARGA_INVALIDA', 'una carga que no está en la configuración');
        t.contiene(co2_codigos_(co2_simularLote([rem('102', 'XX', ['G9'])], ctx)), 'PROVEEDOR_INEXISTENTE', 'proveedor que no existe');
        t.contiene(co2_codigos_(co2_simularLote([co2_trabajoOp_('2026-03-02', 'ENTREGA', 'CLI-4', ['L1'])], ctx)), 'PROVEEDOR_NO_CORRESPONDE', 'a un cliente de GBA no se le entrega LINDE');
        t.contiene(co2_codigos_(co2_simularLote([co2_trabajoOp_('2026-03-02', 'ENTREGA', 'CLI-1', ['G1'])], ctx)), 'PROVEEDOR_NO_CORRESPONDE', 'a un cliente de CABA no se le entrega GN');
        sim = co2_simularLote([co2_trabajoOp_('2026-03-02', 'ENTREGA', 'CLI-4', ['G1']), co2_trabajoOp_('2026-03-02', 'ENTREGA', 'CLI-1', ['L1']),
          co2_trabajoOp_('2026-03-10', 'RETIRO', 'CLI-4', [], ['G1'])], ctx);
        t.igual(sim.ok, true, 'cada cliente recibe de su proveedor y el retiro de un cliente no mira el proveedor');
        co2_confirmarEnCtx_(ctx, sim);
        t.contiene(co2_codigos_(co2_simularLote([rem('500', 'LINDE', [], ['G1'], 0, '2026-03-15')], ctx)), 'RETIRO_OTRO_PROVEEDOR', 'LINDE no se lleva un vacío de GN');
        sim = co2_simularLote([rem('103', 'GN', [], ['G1'], 0, '2026-03-15')], ctx);
        t.igual(sim.ok, true, 'GN retira su vacío');
        t.igual(co2_describirUbicacion_(sim.estadosFinales.G1, ctx), 'Gases Nordelta', 'queda en el proveedor');
        co2_confirmarEnCtx_(ctx, sim, [{ nroNorm: co2_normalizarNroRemito('103'), idDeposito: 'DEP-CBA', estado: 'CONFIRMADO', proveedor: 'GN' }]);
        t.contiene(co2_codigos_(co2_simularLote([rem('501', 'LINDE', ['G1'], [], 25, '2026-03-20')], ctx)), 'PROVEEDOR_DISTINTO', 'una serie no cambia de proveedor');
        t.contiene(co2_codigos_(co2_simularLote([rem('104', 'GN', ['G1'], [], 10, '2026-03-20')], ctx)), 'CARGA_DISTINTA', 'ni de carga');
        var alta = function (extra) { var a = { fecha: '2026-03-01', serie: 'X1', idDepositoOrigen: 'DEP-CBA', ubicacion: 'CLIENTE', idCliente: 'CLI-4', estado: co2_ESTADO.EN_USO, pesoKg: 5 };
          Object.keys(extra || {}).forEach(function (k) { a[k] = extra[k]; }); return { clase: 'ALTA', datos: a }; };
        sim = co2_simularLote([alta()], ctx);
        t.igual(sim.ok && sim.estadosFinales.X1.proveedor, 'GN', 'inventario inicial en un cliente de GBA: toma el proveedor de su plaza');
        t.contiene(co2_codigos_(co2_simularLote([alta({ proveedor: 'LINDE' })], ctx)), 'PROVEEDOR_NO_CORRESPONDE', 'inventario de LINDE en un cliente de GBA');
        var movs = [{ tipoMov: co2_MOV.ENTREGA_LINDE, estadoAnterior: '', estadoNuevo: co2_ESTADO.LLENO, destinoTipo: 'DEPOSITO', destinoId: 'DEP-CBA', pesoKg: 25, proveedor: 'GN', idCircuito: 'C1', fecha: '2026-03-01' },
          { tipoMov: co2_MOV.ENTREGA_CLIENTE, estadoAnterior: co2_ESTADO.LLENO, estadoNuevo: co2_ESTADO.EN_USO, destinoTipo: 'CLIENTE', destinoId: 'CLI-4', idCircuito: 'C1', fecha: '2026-03-02' }];
        t.igual(co2_reconstruirSerie('G7', movs).estado.proveedor, 'GN', 'el historial rearma el proveedor');
      }
    }
  ];
}

/** Ejecutá esta función desde el editor de Apps Script. */
function co2_ejecutarPruebas() {
  var log = (typeof Logger !== 'undefined') ? function (m) { Logger.log(m); } : function (m) { console.log(m); };
  var pasadas = 0, fallidas = 0, detalle = [];
  co2_casosDePrueba_().forEach(function (caso) {
    var fallas = [];
    var t = {
      igual: function (a, b, msg) { if (a !== b) fallas.push(msg + ' (obtuvo ' + JSON.stringify(a) + ', esperaba ' + JSON.stringify(b) + ')'); },
      distinto: function (a, b, msg) { if (a === b) fallas.push(msg + ' (ambos ' + JSON.stringify(a) + ')'); },
      contiene: function (lista, x, msg) { if (lista.indexOf(x) < 0) fallas.push(msg + ' (no apareció ' + x + '; hubo ' + JSON.stringify(lista) + ')'); }
    };
    try { caso.fn(t); } catch (e) { fallas.push('Excepción: ' + e.message); }
    if (fallas.length) { fallidas++; detalle.push('✗ ' + caso.nombre + '\n    - ' + fallas.join('\n    - ')); }
    else { pasadas++; detalle.push('✓ ' + caso.nombre); }
  });
  log(detalle.join('\n'));
  log('Resultado: ' + pasadas + ' pruebas OK, ' + fallidas + ' con fallas.');
  return { pasadas: pasadas, fallidas: fallidas, detalle: detalle };
}
