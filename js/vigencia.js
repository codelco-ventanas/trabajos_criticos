// ============================================================
//  Reglas de vigencia de los permisos de trabajo
//
//  Inicio 08:00 – 19:59  ->  término máximo 19:59 del mismo día
//  Inicio 20:00 – 07:59  ->  término máximo 07:59
//  Duración máxima: 12 horas
//
//  Las mismas reglas están replicadas como trigger en la base de
//  datos (sql/schema.sql). Aquí sirven para avisar al usuario
//  mientras completa el formulario; allá para que nadie pueda
//  saltárselas.
// ============================================================

import { ZONA } from './config.js';

const dosDigitos = (n) => String(n).padStart(2, '0');

/** Convierte "2026-09-07" + "14:30" en un objeto Date real,
 *  interpretando la hora como hora de Chile aunque el equipo
 *  esté configurado en otra zona. */
export function desdeCampos(fecha, hora) {
  if (!fecha || !hora) return null;
  const [a, m, d] = fecha.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  // Punto de partida en UTC y corrección por el desfase de Chile
  const tentativa = new Date(Date.UTC(a, m - 1, d, hh, mm));
  // Dos pasadas: la segunda corrige los casos que caen justo en el
  // cambio de horario de verano.
  let r = new Date(tentativa.getTime() + desfaseZona(tentativa));
  r = new Date(tentativa.getTime() + desfaseZona(r));
  return r;
}

/** Milisegundos que hay que sumar a una hora "de pared" chilena
 *  para obtener el instante UTC correcto. */
function desfaseZona(fecha) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = Object.fromEntries(fmt.formatToParts(fecha).map(x => [x.type, x.value]));
  const comoSiFueraUTC = Date.UTC(+p.year, +p.month - 1, +p.day,
                                  +p.hour % 24, +p.minute, +p.second);
  return fecha.getTime() - comoSiFueraUTC;
}

/** Partes de una fecha expresadas en hora de Chile. */
export function partesChile(fecha) {
  const fmt = new Intl.DateTimeFormat('es-CL', {
    timeZone: ZONA, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
  const p = Object.fromEntries(fmt.formatToParts(fecha).map(x => [x.type, x.value]));
  return {
    anio: +p.year, mes: +p.month, dia: +p.day,
    hora: +p.hour % 24, minuto: +p.minute
  };
}

/** "07-09-2026 14:30" */
export function fechaHoraLarga(iso) {
  const f = new Date(iso);
  const p = partesChile(f);
  return `${dosDigitos(p.dia)}-${dosDigitos(p.mes)}-${p.anio} ${dosDigitos(p.hora)}:${dosDigitos(p.minuto)}`;
}

/** "07-09-2026" */
export function soloFecha(iso) {
  const p = partesChile(new Date(iso));
  return `${dosDigitos(p.dia)}-${dosDigitos(p.mes)}-${p.anio}`;
}

/** "14:30" */
export function soloHora(iso) {
  const p = partesChile(new Date(iso));
  return `${dosDigitos(p.hora)}:${dosDigitos(p.minuto)}`;
}

/** "hoy 14:30", "mañana 07:59" o la fecha completa si está más lejos. */
export function horaRelativa(iso) {
  const hoy = partesChile(new Date());
  const f = partesChile(new Date(iso));
  const hhmm = `${dosDigitos(f.hora)}:${dosDigitos(f.minuto)}`;
  const diaHoy = Date.UTC(hoy.anio, hoy.mes - 1, hoy.dia);
  const diaF = Date.UTC(f.anio, f.mes - 1, f.dia);
  const dif = Math.round((diaF - diaHoy) / 86400000);
  if (dif === 0) return `hoy ${hhmm}`;
  if (dif === 1) return `mañana ${hhmm}`;
  if (dif === -1) return `ayer ${hhmm}`;
  return `${dosDigitos(f.dia)}-${dosDigitos(f.mes)} ${hhmm}`;
}

/** Tiempo que falta, en texto corto: "3 h 20 min" o "18 min". */
export function tiempoRestante(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/**
 * Calcula el término máximo permitido para un inicio dado.
 * Devuelve { fecha, hora, texto } listos para los campos del formulario.
 */
export function limiteTermino(inicio) {
  const p = partesChile(inicio);
  let dia = { anio: p.anio, mes: p.mes, dia: p.dia };

  if (p.hora >= 8 && p.hora < 20) {
    // Turno día
  } else if (p.hora >= 20) {
    // Turno noche antes de medianoche: el límite cae al día siguiente
    const siguiente = new Date(Date.UTC(p.anio, p.mes - 1, p.dia + 1));
    dia = {
      anio: siguiente.getUTCFullYear(),
      mes: siguiente.getUTCMonth() + 1,
      dia: siguiente.getUTCDate()
    };
  }
  const hora = (p.hora >= 8 && p.hora < 20) ? '19:59' : '07:59';
  const fecha = `${dia.anio}-${dosDigitos(dia.mes)}-${dosDigitos(dia.dia)}`;
  return {
    fecha,
    hora,
    texto: `${dosDigitos(dia.dia)}-${dosDigitos(dia.mes)}-${dia.anio} ${hora}`,
    instante: desdeCampos(fecha, hora)
  };
}

/**
 * Valida el par inicio/término.
 * Devuelve { ok: true } o { ok: false, mensaje: '...' }.
 */
export function validaVentana(inicio, termino) {
  if (!inicio || !termino) {
    return { ok: false, mensaje: 'Falta completar la fecha y hora de inicio o de término.' };
  }
  if (termino <= inicio) {
    return { ok: false, mensaje: 'La hora de término debe ser posterior a la de inicio.' };
  }
  if (termino - inicio > 12 * 3600 * 1000) {
    return { ok: false, mensaje: 'Un permiso de trabajo no puede superar 12 horas.' };
  }
  const limite = limiteTermino(inicio);
  if (termino > limite.instante) {
    const p = partesChile(inicio);
    const turno = (p.hora >= 8 && p.hora < 20) ? 'día' : 'noche';
    return {
      ok: false,
      mensaje: `El permiso no puede cruzar el cambio de turno. Con inicio a las ` +
               `${dosDigitos(p.hora)}:${dosDigitos(p.minuto)} (turno ${turno}), ` +
               `el término máximo es ${limite.texto}.`
    };
  }
  return { ok: true };
}

/** Estado operativo de un trabajo, calculado contra el reloj actual. */
export function estadoDe(trabajo, ahora = Date.now()) {
  if (trabajo.cerrado) return 'FINALIZADO';
  const ini = new Date(trabajo.inicio).getTime();
  const fin = new Date(trabajo.termino).getTime();
  if (ahora < ini) return 'PROGRAMADO';
  if (ahora >= fin) return 'FINALIZADO';
  return 'ACTIVO';
}

/** Valores por defecto para un formulario nuevo: ahora, redondeado
 *  a los 5 minutos siguientes. */
export function camposAhora() {
  const d = new Date(Math.ceil(Date.now() / 300000) * 300000);
  const p = partesChile(d);
  return {
    fecha: `${p.anio}-${dosDigitos(p.mes)}-${dosDigitos(p.dia)}`,
    hora: `${dosDigitos(p.hora)}:${dosDigitos(p.minuto)}`
  };
}
