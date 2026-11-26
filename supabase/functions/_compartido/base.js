// =============================================================================
//  SISTEMA FADEFIL · Utilidades comunes del servidor (conexión, fechas, numeración,
//  bloqueo, roles). Las usan el guardado de equipos/stock (estado.js) y el de CO₂.
// =============================================================================

/** Opciones de conexión: fechas como texto 'AAAA-MM-DD' y números como números (igual que en los motores). */
export const OPCIONES_POSTGRES = {
  types: {
    fecha: { to: 1082, from: [1082], serialize: (x) => x, parse: (x) => x },
    numero: { to: 1700, from: [1700], serialize: (x) => String(x), parse: (x) => Number(x) }
  }
};

const ZONA = 'America/Argentina/Buenos_Aires';
/** Un solo guardado a la vez en todo el sistema (como el bloqueo de Apps Script). */
export const BLOQUEO = 4207001;

export function hoyArgentina(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function fechaHora(d = new Date()) {
  return new Intl.DateTimeFormat('es-AR', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

export const iso = (v) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
export const nulo = (v) => (v === '' || v == null ? null : v);
export const num = (v) => Number(v) || 0;

/** Error que se le muestra tal cual al usuario. */
export class ErrorDeUsuario extends Error {}

export function exigirRol(usuario, roles) {
  if (!usuario || roles.indexOf(usuario.rol) < 0) throw new ErrorDeUsuario('Tu rol (' + ((usuario && usuario.rol) || 'sin rol') + ') no permite esta acción.');
}

export async function insertar(sql, tabla, filas) {
  for (let i = 0; i < filas.length; i += 500) await sql`insert into ${sql(tabla)} ${sql(filas.slice(i, i + 500))}`;
}

/** Numeración dentro del bloqueo: se leen los contadores, se numera en memoria y se guardan al final de la transacción. */
export async function contadores(sql) {
  const filas = await sql`select prefijo, ultimo from contadores`;
  const ultimo = {};
  filas.forEach((r) => { ultimo[r.prefijo] = Number(r.ultimo); });
  const tocados = new Set();
  return {
    siguiente(prefijo, digitos = 6) { ultimo[prefijo] = (ultimo[prefijo] || 0) + 1; tocados.add(prefijo); return prefijo + '-' + String(ultimo[prefijo]).padStart(digitos, '0'); },
    async guardar() {
      const f = [...tocados].map((p) => ({ prefijo: p, ultimo: ultimo[p] }));
      if (f.length) await sql`insert into contadores ${sql(f)} on conflict (prefijo) do update set ultimo = excluded.ultimo`;
      tocados.clear();
    }
  };
}

export async function anotar(sql, usuario, accion, detalle, resultado = 'OK') {
  await sql`insert into log (usuario, accion, detalle, resultado) values (${usuario}, ${accion}, ${String(detalle).slice(0, 4000)}, ${String(resultado).slice(0, 500)})`;
}
