// =============================================================================
//  SISTEMA FADEFIL · Función del servidor "guardar".
//  Único camino para escribir operaciones (OT, envíos, recepciones, ajustes,
//  taller y revisión de ítems). Valida con el motor de reglas y guarda cada lote
//  completo o nada, de a un guardado por vez.
//
//  Pedido (POST, con el login del usuario):
//    { accion: 'validar',  ops: [{ clase, datos }] }
//    { accion: 'guardar',  ops: [...], aceptarAdvertencias: true|false }
//    { accion: 'anular',   id: 'OT-000123', motivo: '...' }        (ADMIN)
//    { accion: 'auditar' }                                         (ADMIN)
//  CO₂ (remitos de LINDE, inventario inicial, aprobación de series dudosas, facturas):
//    { accion: 'co2_validar' | 'co2_guardar', ops: [{ clase: 'REMITO' | 'ALTA', datos }] }
//    { accion: 'co2_enviar_aprobacion', remito }   { accion: 'co2_rechazar_pendiente', id }   (rechazar: ADMIN)
//    { accion: 'co2_validar_factura' | 'co2_guardar_factura', factura }   { accion: 'co2_anular_factura', id, motivo } (ADMIN)
//    { accion: 'co2_anular', id, motivo } (ADMIN)   { accion: 'co2_auditar' } (ADMIN)
//  Respuesta: { exito: true, datos } o { exito: false, error }.
// =============================================================================
import postgres from 'npm:postgres@3.4.7';
import {
  OPCIONES_POSTGRES, ErrorDeUsuario, usuarioPorEmail, validarLote, guardarLote, anularOperacion, auditar
} from '../_compartido/estado.js';
import {
  co2Validar, co2Guardar, co2EnviarAprobacion, co2RechazarPendiente, co2ValidarFactura, co2GuardarFactura, co2AnularFactura, co2Anular, co2Auditar
} from '../_compartido/co2_estado.js';
import { exigirRol } from '../_compartido/base.js';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { ...OPCIONES_POSTGRES, max: 3, prepare: false, idle_timeout: 20 });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

/** Email del usuario logueado: se le pregunta al servicio de login de Supabase (valida el token). */
async function emailDelLogin(req: Request): Promise<string> {
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth)) throw new ErrorDeUsuario('Tenés que iniciar sesión.');
  const r = await fetch(Deno.env.get('SUPABASE_URL') + '/auth/v1/user', {
    headers: { Authorization: auth, apikey: req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY') || '' }
  });
  if (!r.ok) throw new ErrorDeUsuario('Tu sesión venció. Volvé a iniciar sesión.');
  const u = await r.json();
  return String(u.email || '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ exito: false, error: 'Método no permitido.' }, 405);
  try {
    const usuario = await usuarioPorEmail(sql, await emailDelLogin(req));
    const p = await req.json().catch(() => ({}));
    let datos;
    switch (p.accion) {
      case 'validar': datos = await validarLote(sql, usuario, p.ops); break;
      case 'guardar': datos = await guardarLote(sql, usuario, p.ops, !!p.aceptarAdvertencias); break;
      case 'anular': datos = await anularOperacion(sql, usuario, p.id, p.motivo); break;
      case 'auditar': datos = await auditar(sql, usuario); break;
      case 'co2_validar': datos = await co2Validar(sql, usuario, p.ops); break;
      case 'co2_guardar': datos = await co2Guardar(sql, usuario, p.ops); break;
      case 'co2_enviar_aprobacion': datos = await co2EnviarAprobacion(sql, usuario, p.remito); break;
      case 'co2_rechazar_pendiente': datos = await co2RechazarPendiente(sql, usuario, p.id); break;
      case 'co2_validar_factura': exigirRol(usuario, ['ADMIN', 'CARGA']); datos = await co2ValidarFactura(sql, p.factura); break;
      case 'co2_guardar_factura': datos = await co2GuardarFactura(sql, usuario, p.factura); break;
      case 'co2_anular_factura': datos = await co2AnularFactura(sql, usuario, p.id, p.motivo); break;
      case 'co2_anular': datos = await co2Anular(sql, usuario, p.id, p.motivo); break;
      case 'co2_auditar': datos = await co2Auditar(sql, usuario); break;
      default: throw new ErrorDeUsuario('Acción desconocida: ' + p.accion);
    }
    return responder({ exito: true, datos });
  } catch (e) {
    if (e instanceof ErrorDeUsuario) return responder({ exito: false, error: e.message });
    console.error(e);
    return responder({ exito: false, error: 'Error inesperado del servidor: ' + (e instanceof Error ? e.message : String(e)) + '. No se guardó nada.' }, 500);
  }
});
