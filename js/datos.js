// ============================================================
//  Capa de datos · Supabase
//  Todo lo que toca la base de datos y el almacenamiento pasa
//  por aquí, para que el resto de la aplicación no dependa del
//  proveedor. Si algún día cambias Supabase por otro servicio,
//  este es el único archivo que hay que reescribir.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SUPABASE, MAPA, PURGA } from './config.js';

export const cliente = createClient(SUPABASE.url, SUPABASE.anonKey, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 5 } }
});

export const configurado = () =>
  !SUPABASE.url.includes('TU-PROYECTO') && !SUPABASE.anonKey.includes('TU_CLAVE');

// ------------------------------------------------------------
//  Lectura
// ------------------------------------------------------------

/** Trae lo que el panel necesita mostrar: los trabajos que aún no han
 *  terminado (activos y programados) y los finalizados de las últimas
 *  horas, para la sección de finalizados.
 *
 *  El estado no se consulta: se deduce después comparando las horas
 *  contra el reloj, así que basta con traer la ventana de tiempo
 *  correcta y clasificar en el navegador. */
export async function cargaTrabajos(horasFinalizados = 24) {
  const margen = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const desde = new Date(Date.now() - horasFinalizados * 60 * 60 * 1000).toISOString();
  const { data, error } = await cliente
    .from('trabajos')
    .select('*')
    .or(`termino.gte.${margen},inicio.gte.${desde}`)
    .order('inicio', { ascending: true })
    .limit(400);
  if (error) throw error;
  return data ?? [];
}

/** Historial con filtros opcionales. */
export async function cargaHistorial({ desde, hasta, tipo, empresa, area, supervisor } = {}) {
  let q = cliente.from('trabajos').select('*').order('inicio', { ascending: false }).limit(500);
  if (desde)      q = q.gte('inicio', desde);
  if (hasta)      q = q.lte('inicio', hasta);
  if (tipo)       q = q.contains('tipos', [tipo]);
  if (empresa)    q = q.ilike('empresa', `%${empresa}%`);
  if (area)       q = q.ilike('area', `%${area}%`);
  if (supervisor) q = q.ilike('supervisor', `%${supervisor}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function auditoriaDe(trabajoId) {
  const { data, error } = await cliente
    .from('auditoria')
    .select('*')
    .eq('trabajo_id', trabajoId)
    .order('registrado_en', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ------------------------------------------------------------
//  Escritura
// ------------------------------------------------------------

export async function creaTrabajo(datos) {
  const { data, error } = await cliente
    .from('trabajos')
    .insert({ ...datos, mapa_version: MAPA.version })
    .select()
    .single();
  if (error) throw traduce(error);
  return data;
}

export async function actualizaTrabajo(id, cambios, actor = 'Administrador') {
  const { data, error } = await cliente
    .from('trabajos')
    .update({ ...cambios, modificado_por: actor, modificado_en: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw traduce(error);
  return data;
}

export async function cierraTrabajo(id, motivo, actor = 'Administrador') {
  return actualizaTrabajo(id, {
    cerrado: true,
    cerrado_en: new Date().toISOString(),
    cerrado_motivo: motivo || null
  }, actor);
}

export async function eliminaTrabajo(id, ...rutas) {
  const { error } = await cliente.from('trabajos').delete().eq('id', id);
  if (error) throw traduce(error);
  const archivos = rutas.filter(r => r && !r.startsWith('ejemplo/'));
  if (archivos.length) {
    await cliente.storage.from('permisos').remove(archivos).catch(() => {});
  }
}

// ------------------------------------------------------------
//  Permisos de trabajo (archivos)
// ------------------------------------------------------------

const TIPOS_OK = ['image/jpeg', 'image/png', 'application/pdf'];
const PESO_MAX = 10 * 1024 * 1024;

// ------------------------------------------------------------
//  Compresión automática
//
//  Una foto de celular ronda los 4000 píxeles de ancho y pesa
//  varios MB, pero se consulta en pantallas de menos de 1000. Casi
//  todo ese peso son píxeles que nadie va a mirar.
//
//  La aplicación reduce la imagen antes de subirla, sin que el
//  usuario haga nada: la subida es mucho más rápida con la señal
//  irregular de planta, y el almacenamiento deja de crecer.
//
//  Los PDF se suben tal cual: no hay forma segura de comprimirlos
//  en el navegador sin arriesgar que queden ilegibles.
// ------------------------------------------------------------
const LADO_MAX = 1600;    // suficiente para leer un permiso a mano
const CALIDAD = 0.72;
const SIN_TOCAR = 400 * 1024;   // por debajo de esto no vale la pena

export async function comprimeImagen(archivo) {
  if (!archivo || archivo.type === 'application/pdf') return archivo;
  if (archivo.size <= SIN_TOCAR) return archivo;

  try {
    const imagen = await cargaImagen(archivo);
    const escala = Math.min(1, LADO_MAX / Math.max(imagen.width, imagen.height));
    if (escala === 1 && archivo.size <= SIN_TOCAR * 3) return archivo;

    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(imagen.width * escala);
    lienzo.height = Math.round(imagen.height * escala);
    const ctx = lienzo.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    imagen.close?.();

    const blob = await new Promise((res) =>
      lienzo.toBlob(res, 'image/jpeg', CALIDAD));
    if (!blob || blob.size >= archivo.size) return archivo;

    return new File([blob], 'imagen.jpg', { type: 'image/jpeg' });
  } catch {
    // Si algo falla, se sube el original: es preferible una subida
    // lenta a perder el registro del trabajo.
    return archivo;
  }
}

/** Decodifica el archivo respetando la orientación con que se tomó
 *  la foto. Sin esto, las fotos verticales de celular se suben
 *  acostadas. */
async function cargaImagen(archivo) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(archivo, { imageOrientation: 'from-image' });
    } catch { /* algunos navegadores no aceptan la opción */ }
  }
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(archivo);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); res(im); };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('imagen ilegible')); };
    im.src = url;
  });
}

export function revisaArchivo(archivo) {
  if (!archivo) return 'Adjunta el permiso de trabajo para poder guardar.';
  if (!TIPOS_OK.includes(archivo.type)) return 'El permiso debe ser un archivo JPG, PNG o PDF.';
  if (archivo.size > PESO_MAX) return 'El archivo supera los 10 MB. Sácale una foto de menor resolución.';
  return null;
}

// La extensión se deduce del tipo de archivo, nunca de su nombre.
// Los celulares entregan nombres impredecibles (sin extensión, con
// espacios, dos puntos o acentos según la cámara o la galería), y
// cualquiera de esos casos produce una ruta que el almacenamiento
// rechaza con "Invalid path specified in request URL".
const EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf'
};

/** Identificador único. crypto.randomUUID no existe en algunos
 *  navegadores antiguos de celular, así que hay alternativa. */
function identificador() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'p-' + Date.now().toString(36) + '-' +
         Math.random().toString(36).slice(2, 10);
}

async function sube(archivo, rotulo) {
  const listo = await comprimeImagen(archivo);
  const ext = EXTENSION[listo.type] || 'dat';
  const p = new Date();
  const carpeta = `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}`;
  const ruta = `${carpeta}/${identificador()}.${ext}`;
  const { error } = await cliente.storage
    .from('permisos')
    .upload(ruta, listo, { contentType: listo.type, upsert: false });
  if (error) throw new Error(`No se pudo subir ${rotulo}: ` + error.message);
  return { ruta, tipo: listo.type };
}

export const subePermiso   = (archivo, rotulo) =>
  sube(archivo, rotulo ? `el permiso de ${rotulo}` : 'el permiso de trabajo');
export const subeFotoLugar = (archivo) => sube(archivo, 'la foto del lugar');

/** Agrega o reemplaza la foto del lugar de un trabajo ya registrado.
 *  Es la única modificación permitida sin clave de administrador. */
export async function guardaFotoLugar(id, archivo, actor) {
  const foto = await subeFotoLugar(archivo);
  const { data, error } = await cliente
    .from('trabajos')
    .update({ lugar_path: foto.ruta, lugar_tipo: foto.tipo,
              modificado_por: actor || 'No identificado',
              modificado_en: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw traduce(error);
  return data;
}

/** Enlace temporal para ver el permiso. Vence en una hora, así el
 *  archivo no queda accesible de forma permanente por una URL suelta. */
export async function enlaceArchivo(ruta) {
  const { data, error } = await cliente.storage.from('permisos').createSignedUrl(ruta, 3600);
  if (error) throw new Error('El permiso no está disponible.');
  return data.signedUrl;
}

// ------------------------------------------------------------
//  Purga automática de permisos
//
//  Cuando un trabajo termina, su permiso deja de tener uso: el
//  sistema es una herramienta en vivo, no un archivador. El
//  archivo se borra y en el registro queda constancia de que
//  existió y de cuándo se eliminó.
//
//  IMPORTANTE: el borrado se hace con la API de Storage
//  (storage.remove), NO con una consulta SQL. Borrar filas de
//  storage.objects desde SQL elimina sólo la ficha del archivo y
//  deja el contenido huérfano en el bucket, ocupando espacio para
//  siempre y sin forma de recuperarlo. Es un error frecuente y
//  aquí está deliberadamente evitado.
// ------------------------------------------------------------
export async function purgaPermisos() {
  if (!PURGA.activa) return { archivos: 0 };

  const corte = new Date(Date.now() - (PURGA.horasGracia || 0) * 3600 * 1000).toISOString();

  // Trabajos ya terminados (por hora o por cierre manual) que todavía
  // conservan el archivo adjunto.
  const { data, error } = await cliente
    .from('trabajos')
    .select('id, permisos, lugar_path')
    .is('permiso_purgado_en', null)
    .or(`termino.lt.${corte},and(cerrado.eq.true,cerrado_en.lt.${corte})`)
    .limit(200);

  if (error || !data?.length) return { archivos: 0 };

  // Se borran todos los archivos del trabajo: un permiso por cada tipo
  // declarado, más la foto del lugar si la tiene.
  const rutas = data
    .flatMap(t => [...Object.values(t.permisos || {}).map(p => p?.path), t.lugar_path])
    .filter(r => r && !r.startsWith('ejemplo/'));

  if (rutas.length) {
    // Se borra de a 100, que es el máximo cómodo por llamada.
    for (let i = 0; i < rutas.length; i += 100) {
      const { error: eBorrado } = await cliente.storage
        .from('permisos')
        .remove(rutas.slice(i, i + 100));
      if (eBorrado) return { archivos: 0, error: eBorrado.message };
    }
  }

  // Recién ahora se marca el registro. Si algo falla antes, la
  // siguiente pasada vuelve a intentarlo sin dejar basura.
  const { error: eMarca } = await cliente
    .from('trabajos')
    .update({ permisos: {}, permiso_path: null, permiso_tipo: null,
              lugar_path: null, lugar_tipo: null,
              permiso_purgado_en: new Date().toISOString() })
    .in('id', data.map(t => t.id));

  if (eMarca) return { archivos: 0, error: eMarca.message };
  return { archivos: rutas.length };
}

// ------------------------------------------------------------
//  Tiempo real
//  Un solo canal escucha altas, cambios y bajas de la tabla.
// ------------------------------------------------------------
export function escuchaCambios({ alAlta, alCambio, alBaja, alEstado }) {
  return cliente
    .channel('trabajos-en-vivo')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trabajos' },
        (p) => alAlta?.(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trabajos' },
        (p) => alCambio?.(p.new))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'trabajos' },
        (p) => alBaja?.(p.old?.id))
    .subscribe((estado) => alEstado?.(estado));
}

// ------------------------------------------------------------
//  Mensajes de error legibles
// ------------------------------------------------------------
function traduce(error) {
  const m = error.message || '';
  if (m.includes('turno') || m.includes('12 horas')) return new Error(m.split('.')[0] + '.');
  if (m.includes('Falta adjuntar el permiso'))
    return new Error('Falta adjuntar el permiso de alguno de los tipos de trabajo declarados.');
  if (m.includes('tipos_validos') || m.includes('al menos un tipo'))
    return new Error('Debes elegir al menos un tipo de trabajo crítico.');
  if (m.includes('termino_posterior'))
    return new Error('La hora de término debe ser posterior a la de inicio.');
  if (m.includes('n_trabajadores'))
    return new Error('El número de trabajadores debe ser al menos 1.');
  if (m.includes('violates row-level security'))
    return new Error('La base de datos rechazó la operación. Revisa las políticas de seguridad.');
  if (m.includes('Failed to fetch'))
    return new Error('Sin conexión con el servidor. Revisa la red e inténtalo otra vez.');
  return new Error(m || 'Ocurrió un error inesperado.');
}

export const enlacePermiso = enlaceArchivo;
