// ============================================================
//  Empresas contratistas · División Ventanas
//
//  Lista que se ofrece en el formulario de nuevo trabajo crítico.
//  Vive en su propio archivo, separado de config.js, para que
//  actualizarla no obligue a volver a pegar las credenciales de
//  la base de datos.
//
//  PARA AGREGAR O QUITAR UNA EMPRESA
//  Edita la lista de abajo respetando el formato: el nombre entre
//  comillas y una coma al final de cada línea. Se muestran en el
//  mismo orden en que estén escritas aquí.
//
//  Escribe el nombre tal como quieres que quede guardado en el
//  historial: así se escribirá en todos los registros y las
//  búsquedas no se dividirán entre variantes del mismo nombre.
// ============================================================

export const EMPRESAS = [
  'AMECI',
  'ATECMA',
  'AXINNTUS',
  'BACHELET LABORATORIES CHILE SPA',
  'BELRAY',
  'CISFER LTDA',
  'CODELCO',
  'CRANE',
  'CVC INGENIERIA S.A',
  'FENIX INGENIERIA Y SERVICIOS',
  'FYL LTDA',
  'INCOLUR S.A.',
  'INDEMIN SPA',
  'INVERSIONES IMPACTO SA',
  'KDM INDUSTRIAL',
  'MECSA INGENIERIA SPA',
  'MIES SERVICIOS INDUSTRIALES LTDA.',
  'RIL-LIGHT'
];

// Valor interno de la opción que habilita escribir el nombre a mano.
// No es el nombre de ninguna empresa: nunca se guarda en la base.
export const OTRA_EMPRESA = '__otra__';
