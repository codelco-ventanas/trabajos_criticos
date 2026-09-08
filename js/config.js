// ============================================================
//  CONFIGURACIÓN  ·  Trabajos Críticos División Ventanas
//  Este es el único archivo que necesitas editar para poner en
//  marcha la aplicación.
// ============================================================

export const SUPABASE = {
  // >>> REEMPLAZA ESTOS DOS VALORES <<<
  // Supabase > Project Settings > Data API
  url:     'https://mustvffwbwqslejpqsau.supabase.co',
  // Esta es la clave "anon public". Está pensada para vivir en el
  // navegador: no da acceso administrativo, sólo lo que permitan las
  // políticas de la base de datos. Nunca pongas aquí la clave
  // "service_role".
  anonKey: 'sb_publishable_-DCzxMm4c45qYM6x_b6RIA_2cE1cJcx'
};

// Clave para entrar en modo administrador (editar, extender y eliminar).
export const CLAVE_ADMIN = 'codelcoventanas';

// ------------------------------------------------------------
//  Mapa base
//  Las coordenadas se guardan normalizadas (0 a 1), no en píxeles.
//  Gracias a eso puedes reemplazar la imagen por una versión de
//  mayor resolución, o recomprimida, sin mover ningún marcador:
//  basta con dejar el mismo encuadre y actualizar ancho/alto.
//  Si algún día cambias a una fotografía con OTRO encuadre, sube
//  también el número de version para poder distinguir en el
//  historial los puntos tomados sobre el plano antiguo.
// ------------------------------------------------------------
export const MAPA = {
  imagen:  'assets/mapa-ventanas.jpg',
  ancho:   4032,
  alto:    2268,
  version: 'ventanas-aerea-2024'
};

// ------------------------------------------------------------
//  Tipos de trabajo crítico
//  Para agregar uno nuevo en el futuro basta con añadirlo aquí y
//  ampliar el CHECK de la columna "tipo" en la base de datos.
// ------------------------------------------------------------
export const TIPOS = {
  caliente: {
    nombre: 'Trabajo en caliente', corto: 'Caliente',
    color: '#FF4F3B', icono: 'assets/iconos/caliente.png'
  },
  altura: {
    nombre: 'Trabajo en altura', corto: 'Altura',
    color: '#FFB020', icono: 'assets/iconos/altura.png'
  },
  confinado: {
    nombre: 'Espacio confinado', corto: 'Confinado',
    color: '#31B6F2', icono: 'assets/iconos/confinado.png'
  }
};

// ------------------------------------------------------------
//  Identidad institucional
//  Se usa en el encabezado de la aplicación y en todos los PDF.
// ------------------------------------------------------------
export const MARCA = {
  antetitulo: 'Codelco Ventanas',
  titulo: 'Mapa de Trabajos Críticos',
  copyright: '2026 © CODELCO CHILE. TODOS LOS DERECHOS RESERVADOS.',
  // Deja aquí el logo con este nombre exacto. Si el archivo no existe,
  // la aplicación y los PDF se generan igual, sin logo.
  logo: 'assets/logo-codelco-ssb.png'
};

// Zona horaria usada para interpretar los turnos.
export const ZONA = 'America/Santiago';

// Cada cuántos segundos se recalculan los estados en pantalla
// (para que un trabajo caduque solo, sin recargar).
export const REFRESCO_SEGUNDOS = 20;

// ------------------------------------------------------------
//  Purga de permisos de trabajo
//
//  El sistema está pensado para uso en vivo: el permiso sirve
//  mientras el trabajo está en ejecución. Al terminar, el archivo
//  se borra del almacenamiento y sólo queda el registro de que
//  existió. Así el espacio no crece sin control.
//
//  horasGracia: cuánto se conserva el archivo DESPUÉS de que el
//  trabajo termina. En 0 se borra en la siguiente pasada. Si la
//  Unidad de Emergencia necesita poder revisar el permiso de un
//  trabajo recién cerrado, sube este número (por ejemplo, a 4).
// ------------------------------------------------------------
export const PURGA = {
  activa: true,
  horasGracia: 0,
  cadaMinutos: 10
};
