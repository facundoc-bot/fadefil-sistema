// La publicación (GitHub Actions → App) arma config.js con estos dos datos del proyecto de Supabase.
// La clave es la pública (anon / publishable): está pensada para ir en el navegador; lo que cada uno
// puede ver o cambiar lo controla la base con el login y los roles.
window.FADEFIL_CONFIG = {
  supabaseUrl: 'https://<proyecto>.supabase.co',
  supabaseKey: '<clave pública>'
};
