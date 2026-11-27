// Copia a app/lib/ las librerías que usa el navegador (desde node_modules, versiones fijas en package.json):
// login y base (supabase-js), lectura de PDF (pdf.js) y Excel (ExcelJS). Así la app no depende de otros sitios.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const destino = new URL('../app/lib/', import.meta.url);
mkdirSync(destino, { recursive: true });
const archivos = {
  'supabase.js': '@supabase/supabase-js/dist/umd/supabase.js',
  'pdf.min.mjs': 'pdfjs-dist/build/pdf.min.mjs',
  'pdf.worker.min.mjs': 'pdfjs-dist/build/pdf.worker.min.mjs',
  'exceljs.min.js': 'exceljs/dist/exceljs.min.js'
};
for (const [nombre, origen] of Object.entries(archivos)) copyFileSync(new URL('../node_modules/' + origen, import.meta.url), new URL(nombre, destino));

// Tipografía de la marca (Inter Tight) y los íconos (Lucide, de línea, como en la presentación de AQA) en un solo archivo.
mkdirSync(new URL('fuentes/', destino), { recursive: true });
for (const peso of [400, 500, 600, 700]) {
  copyFileSync(new URL(`../node_modules/@fontsource/inter-tight/files/inter-tight-latin-${peso}-normal.woff2`, import.meta.url), new URL(`fuentes/inter-tight-${peso}.woff2`, destino));
}
const ICONOS = ['house', 'clipboard-plus', 'truck', 'scan-search', 'wrench', 'users', 'refrigerator', 'boxes', 'hard-hat', 'file-text', 'receipt', 'cylinder',
  'repeat', 'list-checks', 'package-plus', 'shield-check', 'database', 'log-out', 'refresh-cw', 'rotate-ccw', 'presentation', 'map-pin', 'user-plus', 'menu', 'x', 'plug-zap', 'package', 'arrow-left-right',
  'circle-pause', 'circle-help', 'search', 'chevron-down', 'droplets', 'calendar-clock', 'triangle-alert', 'hammer', 'download', 'upload', 'ellipsis', 'plus',
  'circle-check', 'history', 'circle-user', 'archive-restore', 'unplug', 'clipboard-check', 'chevron-right', 'layout-grid', 'filter', 'info'];
const simbolos = ICONOS.map((n) => {
  const svg = readFileSync(new URL(`../node_modules/lucide-static/icons/${n}.svg`, import.meta.url), 'utf8');
  const cuerpo = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return `<symbol id="${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${cuerpo}</symbol>`;
});
writeFileSync(new URL('iconos.svg', destino), `<svg xmlns="http://www.w3.org/2000/svg">${simbolos.join('')}</svg>`);
console.log('Librerías copiadas a app/lib/: ' + Object.keys(archivos).join(', ') + ', fuentes e íconos (' + ICONOS.length + ').');
