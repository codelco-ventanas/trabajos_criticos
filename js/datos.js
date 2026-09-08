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

/** Trae los trabajos que importan para el mapa: los que aún no han
 *  terminado (activos y programados). Se pide un margen hacia atrás
 *  para que un trabajo recién vencido no desaparezca de golpe si el
 *  reloj del equipo va levemente adelantado. */
export async function cargaVigentes() {
  const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await cliente
    .from('trabajos')
    .select('*')
    .gte('termino', desde)
    .order('inicio', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Historial con filtros opcionales. */
export async function cargaHistorial({ desde, hasta, tipo, empresa, area, supervisor } = {}) {
  let q = cliente.from('trabajos').select('*').order('inicio', { ascending: false }).limit(500);
  if (desde)      q = q.gte('inicio', desde);
  if (hasta)      q = q.lte('inicio', hasta);
  if (tipo)       q = q.eq('tipo', tipo);
  if (empresa)    q = q.ilike('empresa', `%${empresa}%`);
  if (area)       q = q.ilike('area', `%${area}%`);
  if (supervisor) q = q.ilike('supervisor', `%${supervisor}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** Valores ya usados antes, para autocompletar empresa y área y
 *  evitar que la misma empresa quede escrita de tres formas. */
export async function sugerencias() {
  const { data, error } = await cliente
    .from('trabajos')
    .select('empresa, area, supervisor')
    .order('creado_en', { ascending: false })
    .limit(400);
  if (error) return { empresas: [], areas: [], supervisores: [] };
  const unicos = (campo) =>
    [...new Set((data ?? []).map(r => (r[campo] || '').trim()).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, 'es'));
  return {
    empresas: unicos('empresa'),
    areas: unicos('area'),
    supervisores: unicos('supervisor')
  };
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

export async function eliminaTrabajo(id, permisoPath) {
  const { error } = await cliente.from('trabajos').delete().eq('id', id);
  if (error) throw traduce(error);
  if (permisoPath && !permisoPath.startsWith('ejemplo/')) {
    await cliente.storage.from('permisos').remove([permisoPath]).catch(() => {});
  }
}

// ------------------------------------------------------------
//  Permisos de trabajo (archivos)
// ------------------------------------------------------------

const TIPOS_OK = ['image/jpeg', 'image/png', 'application/pdf'];
const PESO_MAX = 10 * 1024 * 1024;

export function revisaArchivo(archivo) {
  if (!archivo) return 'Adjunta el permiso de trabajo para poder guardar.';
  if (!TIPOS_OK.includes(archivo.type)) return 'El permiso debe ser un archivo JPG, PNG o PDF.';
  if (archivo.size > PESO_MAX) return 'El archivo supera los 10 MB. Sácale una foto de menor resolución.';
  return null;
}

export async function subePermiso(archivo) {
  const ext = (archivo.name.split('.').pop() || 'dat').toLowerCase();
  const p = new Date();
  const carpeta = `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}`;
  const ruta = `${carpeta}/${crypto.randomUUID()}.${ext}`;
  const { error } = await cliente.storage
    .from('permisos')
    .upload(ruta, archivo, { contentType: archivo.type, upsert: false });
  if (error) throw new Error('No se pudo subir el permiso de trabajo: ' + error.message);
  return { ruta, tipo: archivo.type };
}

/** Enlace temporal para ver el permiso. Vence en una hora, así el
 *  archivo no queda accesible de forma permanente por una URL suelta. */
export async function enlacePermiso(ruta) {
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
    .select('id, permiso_path')
    .not('permiso_path', 'is', null)
    .or(`termino.lt.${corte},and(cerrado.eq.true,cerrado_en.lt.${corte})`)
    .limit(200);

  if (error || !data?.length) return { archivos: 0 };

  const reales = data.filter(t => !t.permiso_path.startsWith('ejemplo/'));
  const rutas = reales.map(t => t.permiso_path);

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
    .update({ permiso_path: null, permiso_tipo: null, permiso_purgado_en: new Date().toISOString() })
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
