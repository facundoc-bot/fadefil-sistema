// Corre las pruebas originales del motor (Pruebas.gs de Sheets) contra el módulo motor.js.
// Uso: node tests/motor/pruebas_motor.mjs [ruta a Pruebas.gs]
import * as motor from '../../supabase/functions/_compartido/motor.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ruta = process.argv[2] || new URL('./Pruebas.gs', import.meta.url);
const silencioso = { log: () => {}, error: console.error };
const contexto = vm.createContext({ console: silencioso, JSON, Math, Date, Object, Array, String, Number });
for (const [k, v] of Object.entries(motor)) contexto[k] = v;
vm.runInContext(readFileSync(ruta, 'utf8'), contexto);
const r = contexto.ejecutarPruebas();
if (r.fallidas) { console.error(r.detalle.filter((x) => x.startsWith('✗')).join('\n')); process.exit(1); }
console.log(`Motor: ${r.pasadas} pruebas OK (${r.comprobaciones} comprobaciones).`);
