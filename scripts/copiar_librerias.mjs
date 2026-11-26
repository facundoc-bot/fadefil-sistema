// Copia a app/lib/ las librerías que usa el navegador (desde node_modules, versiones fijas en package.json):
// login y base (supabase-js), lectura de PDF (pdf.js) y Excel (ExcelJS). Así la app no depende de otros sitios.
import { copyFileSync, mkdirSync } from 'node:fs';
const destino = new URL('../app/lib/', import.meta.url);
mkdirSync(destino, { recursive: true });
const archivos = {
  'supabase.js': '@supabase/supabase-js/dist/umd/supabase.js',
  'pdf.min.mjs': 'pdfjs-dist/build/pdf.min.mjs',
  'pdf.worker.min.mjs': 'pdfjs-dist/build/pdf.worker.min.mjs',
  'exceljs.min.js': 'exceljs/dist/exceljs.min.js'
};
for (const [nombre, origen] of Object.entries(archivos)) copyFileSync(new URL('../node_modules/' + origen, import.meta.url), new URL(nombre, destino));
console.log('Librerías copiadas a app/lib/: ' + Object.keys(archivos).join(', '));
