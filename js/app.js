// ============================================================
//  Aplicación · Trabajos Críticos División Ventanas
// ============================================================

import { TIPOS, CLAVE_ADMIN, REFRESCO_SEGUNDOS, MAPA, PURGA } from './config.js';
import * as datos from './datos.js';
import * as mapa from './mapa.js';
import { pdfHistorial, pdfDeclaracion } from './pdf.js';
import {
  desdeCampos, validaVentana, limiteTermino, estadoDe,
  fechaHoraLarga, horaRelativa, soloHora, soloFecha, tiempoRestante, camposAhora, partesChile
} from './vigencia.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ------------------------------------------------------------
//  Estado en memoria
// ------------------------------------------------------------
const estado = {
  trabajos: new Map(),     // id -> trabajo
  filtro: '',              // '' | caliente | altura | confinado
  admin: false,
  editando: null,          // id del trabajo en edición
  punto: null,             // { x, y } elegido en el plano
  archivo: null,           // File del permiso
  fichaAbierta: null,
  ultimoGuardado: null     // trabajo recién creado, para su respaldo
};

const visiblesEnMapa = () =>
  [...estado.trabajos.values()].filter(t => estadoDe(t) === 'ACTIVO');

const paraElPanel = () =>
  [...estado.trabajos.values()]
    .filter(t => ['ACTIVO', 'PROGRAMADO'].includes(estadoDe(t)))
    .sort((a, b) => {
      const ea = estadoDe(a), eb = estadoDe(b);
      if (ea !== eb) return ea === 'ACTIVO' ? -1 : 1;
      return ea === 'ACTIVO'
        ? new Date(a.termino) - new Date(b.termino)   // los que vencen antes, arriba
        : new Date(a.inicio) - new Date(b.inicio);
    });

// ============================================================
//  Arranque
// ============================================================
async function inicia() {
  if (!datos.configurado()) {
    $('#cortina').classList.add('visible');
    return;
  }

  mapa.iniciaMapa({ alSeleccionar: abreFicha });
  conectaEventos();

  try {
    const lista = await datos.cargaVigentes();
    lista.forEach(t => estado.trabajos.set(t.id, t));
    dibujaTodo();
  } catch (e) {
    avisa('No se pudieron cargar los trabajos: ' + e.message, 'error');
  }

  datos.escuchaCambios({
    alAlta: (t) => { estado.trabajos.set(t.id, t); dibujaTodo(); anuncia(t); },
    alCambio: (t) => { estado.trabajos.set(t.id, t); dibujaTodo(); refrescaFichaSiCorresponde(t.id); },
    alBaja: (id) => {
      estado.trabajos.delete(id);
      dibujaTodo();
      if (estado.fichaAbierta === id) cierra('veloFicha');
    },
    alEstado: (s) => marcaConexion(s)
  });

  // Limpieza de permisos de trabajos ya terminados. Se ejecuta al
  // abrir la aplicación y cada cierto rato mientras siga abierta, así
  // que basta con que alguien la use un rato al día para que el
  // almacenamiento no crezca.
  limpiaPermisos();
  if (PURGA.activa) setInterval(limpiaPermisos, (PURGA.cadaMinutos || 10) * 60 * 1000);

  // Recalcula estados cada cierto tiempo: así un trabajo caduca solo
  // aunque nadie toque nada y nadie tenga que recargar la página.
  setInterval(() => { dibujaTodo(); actualizaReloj(); }, REFRESCO_SEGUNDOS * 1000);
  actualizaReloj();
  setInterval(actualizaReloj, 30000);

  // Al volver de segundo plano en el celular, resincroniza
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      try {
        const lista = await datos.cargaVigentes();
        estado.trabajos = new Map(lista.map(t => [t.id, t]));
        dibujaTodo();
      } catch { /* si falla, se conserva lo que ya había */ }
    }
  });
}

async function limpiaPermisos() {
  try {
    const r = await datos.purgaPermisos();
    if (r.archivos > 0) {
      console.info(`Permisos eliminados de trabajos terminados: ${r.archivos}`);
    }
  } catch { /* si falla, se reintenta en la siguiente pasada */ }
}

function marcaConexion(s) {
  const el = $('#enVivo');
  const txt = el.querySelector('.texto');
  if (s === 'SUBSCRIBED') { el.dataset.estado = 'vivo'; txt.textContent = 'En vivo'; }
  else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') { el.dataset.estado = 'caido'; txt.textContent = 'Sin conexión'; }
  else { el.dataset.estado = 'conectando'; txt.textContent = 'Conectando'; }
}

// ============================================================
//  Pintado
// ============================================================
function dibujaTodo() {
  const activos = visiblesEnMapa();
  mapa.pintaTrabajos(activos);
  pintaContadores(activos);
  pintaLista();
  pintaSala(activos);
}

function pintaContadores(activos) {
  const c = { caliente: 0, altura: 0, confinado: 0 };
  activos.forEach(t => c[t.tipo]++);
  $('#cuentaTotal').textContent = activos.length;
  $('#cuentaCaliente').textContent = c.caliente;
  $('#cuentaAltura').textContent = c.altura;
  $('#cuentaConfinado').textContent = c.confinado;

  $$('#filtros .cifra').forEach(el => {
    const t = el.dataset.cuenta;
    el.textContent = t ? c[t] : activos.length;
  });
}

function pintaLista() {
  const cont = $('#lista');
  const todos = paraElPanel();
  const lista = estado.filtro ? todos.filter(t => t.tipo === estado.filtro) : todos;

  const activos = lista.filter(t => estadoDe(t) === 'ACTIVO');
  const programados = lista.filter(t => estadoDe(t) === 'PROGRAMADO');
  const personas = activos.reduce((s, t) => s + t.n_trabajadores, 0);

  $('#resumenPanel').textContent = activos.length
    ? `${activos.length} en ejecución · ${personas} ${personas === 1 ? 'persona' : 'personas'} en terreno`
    : 'Ningún trabajo crítico en ejecución.';

  $('#tiradorTexto').textContent = activos.length
    ? `${activos.length} ${activos.length === 1 ? 'trabajo activo' : 'trabajos activos'} · ` +
      `${personas} ${personas === 1 ? 'persona' : 'personas'}`
    : 'Sin trabajos activos';

  cont.innerHTML = '';

  if (!lista.length) {
    cont.innerHTML = `<div class="vacio">
        <strong>No hay trabajos que mostrar</strong>
        ${estado.filtro ? 'Prueba con otro filtro.' : 'Registra el primero con el botón «Nuevo trabajo».'}
      </div>`;
    return;
  }

  if (activos.length) {
    activos.forEach(t => cont.appendChild(tarjeta(t)));
  }
  if (programados.length) {
    const h = document.createElement('div');
    h.className = 'grupo-titulo';
    h.textContent = `Programados (${programados.length})`;
    cont.appendChild(h);
    programados.forEach(t => cont.appendChild(tarjeta(t)));
  }
}

function tarjeta(t) {
  const tipo = TIPOS[t.tipo];
  const est = estadoDe(t);
  const restante = tiempoRestante(t.termino);
  const porVencer = est === 'ACTIVO' && restante &&
                    (new Date(t.termino) - Date.now()) < 60 * 60 * 1000;

  const b = document.createElement('button');
  b.className = `tarjeta ${est.toLowerCase()} ${porVencer ? 'por-vencer' : ''}`;
  b.style.setProperty('--tono', tipo.color);
  b.innerHTML = `
    <div class="tarjeta-fila">
      <span class="tarjeta-tipo"><i class="icono-tipo ${t.tipo}"></i> ${tipo.corto}</span>
      <span class="tarjeta-empresa">${escapa(t.empresa)}</span>
    </div>
    <div class="tarjeta-lugar">${escapa(t.area)} · ${escapa(t.equipo)}</div>
    <div class="tarjeta-pie">
      <span class="personas">${t.n_trabajadores} ${t.n_trabajadores === 1 ? 'persona' : 'personas'}</span>
      <span>${escapa(t.supervisor)}</span>
      <time>${est === 'PROGRAMADO'
        ? 'inicia ' + horaRelativa(t.inicio)
        : 'hasta ' + soloHora(t.termino) + (restante ? ` · ${restante}` : '')}</time>
    </div>`;
  b.addEventListener('click', () => {
    if (estadoDe(t) === 'ACTIVO') mapa.enfoca(t.id);
    abreFicha(t.id);
  });
  return b;
}

function pintaSala(activos) {
  const c = { caliente: 0, altura: 0, confinado: 0 };
  activos.forEach(t => c[t.tipo]++);
  $('#salaTotal').textContent = activos.length;
  $('#salaCaliente').textContent = c.caliente;
  $('#salaAltura').textContent = c.altura;
  $('#salaConfinado').textContent = c.confinado;
  $('#salaPersonas').textContent = activos.reduce((s, t) => s + t.n_trabajadores, 0);

  const cuerpo = $('#salaCuerpo');
  cuerpo.innerHTML = '';
  if (!activos.length) {
    cuerpo.innerHTML = `<tr><td colspan="7" style="padding:26px;color:var(--tenue)">
      Ningún trabajo crítico en ejecución en este momento.</td></tr>`;
    return;
  }
  activos
    .sort((a, b) => new Date(a.termino) - new Date(b.termino))
    .forEach(t => {
      const tipo = TIPOS[t.tipo];
      const restante = tiempoRestante(t.termino);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="marca-tipo" style="--tono:${tipo.color}"></span>${tipo.corto}</td>
        <td>${escapa(t.area)}<br><span style="color:var(--tenue)">${escapa(t.equipo)}</span></td>
        <td>${escapa(t.empresa)}</td>
        <td>${escapa(t.supervisor)}</td>
        <td class="cifra">${t.n_trabajadores}</td>
        <td class="cifra">${soloHora(t.inicio)}</td>
        <td class="cifra">${soloHora(t.termino)}${restante ? `<br><span style="color:var(--tenue)">faltan ${restante}</span>` : ''}</td>`;
      tr.addEventListener('click', () => { salirSala(); mapa.enfoca(t.id); abreFicha(t.id); });
      cuerpo.appendChild(tr);
    });
}

function actualizaReloj() {
  const p = partesChile(new Date());
  const dd = (n) => String(n).padStart(2, '0');
  $('#reloj').textContent = `${dd(p.dia)}-${dd(p.mes)}-${p.anio}  ${dd(p.hora)}:${dd(p.minuto)}`;
}

function anuncia(t) {
  if (estadoDe(t) !== 'ACTIVO') return;
  avisa(`Nuevo trabajo en ${t.area}: ${t.empresa} (${TIPOS[t.tipo].corto})`, 'info');
}

// ============================================================
//  Ficha del trabajo
// ============================================================
function abreFicha(id) {
  const t = estado.trabajos.get(id);
  if (!t) return;
  estado.fichaAbierta = id;
  const tipo = TIPOS[t.tipo];
  const est = estadoDe(t);
  const restante = tiempoRestante(t.termino);

  $('#tituloFicha').innerHTML = `<span class="ficha-titulo">
      <span class="chip-tipo" style="--tono:${tipo.color}"><i class="icono-tipo ${t.tipo}"></i> ${tipo.nombre}</span>
      <span class="chip-estado ${est.toLowerCase()}">${est}</span>
    </span>`;

  $('#cuerpoFicha').innerHTML = `
    <div class="datos">
      <div class="dato ancho">
        <div class="dato-clave">Dónde</div>
        <div class="dato-valor">${escapa(t.area)} · ${escapa(t.equipo)}</div>
      </div>
      <div class="dato ancho">
        <div class="dato-clave">Actividad</div>
        <div class="dato-valor">${escapa(t.descripcion)}</div>
      </div>
      <div class="dato">
        <div class="dato-clave">Empresa</div>
        <div class="dato-valor">${escapa(t.empresa)}</div>
      </div>
      <div class="dato">
        <div class="dato-clave">Supervisor responsable</div>
        <div class="dato-valor">${escapa(t.supervisor)}</div>
      </div>
      <div class="dato">
        <div class="dato-clave">Personas en el lugar</div>
        <div class="dato-valor grande">${t.n_trabajadores}</div>
      </div>
      <div class="dato">
        <div class="dato-clave">${est === 'ACTIVO' ? 'Activo hasta' : 'Término'}</div>
        <div class="dato-valor grande ${restante && new Date(t.termino) - Date.now() < 3600000 ? 'urgente' : ''}">
          ${soloHora(t.termino)}</div>
        <div class="dato-clave">${restante ? `faltan ${restante}` : 'plazo cumplido'}</div>
      </div>
      <div class="dato">
        <div class="dato-clave">Inicio</div>
        <div class="dato-valor">${fechaHoraLarga(t.inicio)}</div>
      </div>
      <div class="dato">
        <div class="dato-clave">Término</div>
        <div class="dato-valor">${fechaHoraLarga(t.termino)}</div>
      </div>
      ${t.cerrado ? `<div class="dato ancho">
        <div class="dato-clave">Cerrado anticipadamente</div>
        <div class="dato-valor">${fechaHoraLarga(t.cerrado_en)}${t.cerrado_motivo ? ' · ' + escapa(t.cerrado_motivo) : ''}</div>
      </div>` : ''}
    </div>

    <div class="bloque-permiso">
      ${t.permiso_path
        ? `<button class="btn" id="btnVerPermiso" style="width:100%;justify-content:center">
             Ver permiso de trabajo
           </button>`
        : `<div class="permiso-purgado">
             El permiso ya no está disponible.
             <small>Se eliminó del almacenamiento ${t.permiso_purgado_en
               ? 'el ' + fechaHoraLarga(t.permiso_purgado_en)
               : 'al finalizar el trabajo'}, según la política del sistema.</small>
           </div>`}
    </div>

    <div class="trazas" id="trazas">
      <h4>Trazabilidad</h4>
      <div class="traza">
        <time>${fechaHoraLarga(t.creado_en)}</time>
        <span>Registrado por <b>${escapa(t.registrado_por)}</b></span>
      </div>
    </div>`;

  $('#btnVerPermiso')?.addEventListener('click', () => verPermiso(t));
  cargaTrazas(id);
  abre('veloFicha');
}

async function cargaTrazas(id) {
  try {
    const filas = await datos.auditoriaDe(id);
    const cont = $('#trazas');
    if (!cont || !filas.length) return;
    const etiqueta = { crear: 'Registró el trabajo', editar: 'Modificó', cerrar: 'Finalizó anticipadamente', eliminar: 'Eliminó' };
    cont.innerHTML = '<h4>Trazabilidad</h4>' + filas.map(f => {
      const campos = f.accion === 'editar' && f.cambios
        ? ' · ' + Object.keys(f.cambios).map(nombreCampo).join(', ')
        : '';
      return `<div class="traza">
          <time>${fechaHoraLarga(f.registrado_en)}</time>
          <span>${etiqueta[f.accion] || f.accion} — <b>${escapa(f.actor)}</b>${escapa(campos)}</span>
        </div>`;
    }).join('');
  } catch { /* la trazabilidad es complementaria: si falla, la ficha igual sirve */ }
}

const nombresCampos = {
  tipo: 'tipo', empresa: 'empresa', area: 'área', equipo: 'equipo',
  descripcion: 'descripción', n_trabajadores: 'nº de trabajadores',
  supervisor: 'supervisor', inicio: 'inicio', termino: 'término',
  x: 'ubicación', y: 'ubicación', cerrado: 'estado', permiso_path: 'permiso'
};
const nombreCampo = (k) => nombresCampos[k] || k;

function refrescaFichaSiCorresponde(id) {
  if (estado.fichaAbierta === id && $('#veloFicha').classList.contains('abierto')) abreFicha(id);
}

// ------------------------------------------------------------
//  Permiso de trabajo
// ------------------------------------------------------------
async function verPermiso(t) {
  const cuerpo = $('#cuerpoPermiso');
  cuerpo.innerHTML = '<p style="color:var(--tenue)">Abriendo el permiso…</p>';
  abre('veloPermiso');
  try {
    const url = await datos.enlacePermiso(t.permiso_path);
    $('#btnDescargarPermiso').href = url;
    cuerpo.innerHTML = t.permiso_tipo === 'application/pdf'
      ? `<iframe class="visor-permiso" src="${url}" title="Permiso de trabajo"></iframe>`
      : `<div class="visor-permiso"><img src="${url}" alt="Permiso de trabajo"></div>`;
  } catch {
    cuerpo.innerHTML = `<div class="vacio">
      <strong>El permiso no está disponible</strong>
      El archivo no se encuentra en el almacenamiento. Si este es un registro de ejemplo, es lo esperado.
    </div>`;
  }
}

// ============================================================
//  Formulario
// ============================================================
function abreFormularioNuevo() {
  estado.editando = null;
  estado.punto = null;
  estado.archivo = null;
  $('#tituloForm').textContent = 'Nuevo trabajo crítico';
  $('#formulario').reset();
  $('#errorForm').classList.remove('visible');

  const ahora = camposAhora();
  $('#fechaInicio').value = ahora.fecha;
  $('#horaInicio').value = ahora.hora;
  sugiereTermino();
  marcaUbicacion(null);
  marcaAdjunto(null);
  $('#btnGuardar').textContent = 'Guardar trabajo';
  modoFormulario('edicion');
  abre('veloForm');
}

function abreFormularioEdicion(t) {
  estado.editando = t.id;
  estado.punto = { x: t.x, y: t.y };
  estado.archivo = null;
  $('#tituloForm').textContent = 'Editar trabajo crítico';
  $('#errorForm').classList.remove('visible');

  $(`input[name="tipo"][value="${t.tipo}"]`).checked = true;
  $('#empresa').value = t.empresa;
  $('#area').value = t.area;
  $('#equipo').value = t.equipo;
  $('#descripcion').value = t.descripcion;
  $('#trabajadores').value = t.n_trabajadores;
  $('#supervisor').value = t.supervisor;
  $('#registradoPor').value = t.registrado_por || '';

  const ini = partesChile(new Date(t.inicio));
  const fin = partesChile(new Date(t.termino));
  const dd = (n) => String(n).padStart(2, '0');
  $('#fechaInicio').value = `${ini.anio}-${dd(ini.mes)}-${dd(ini.dia)}`;
  $('#horaInicio').value = `${dd(ini.hora)}:${dd(ini.minuto)}`;
  $('#fechaTermino').value = `${fin.anio}-${dd(fin.mes)}-${dd(fin.dia)}`;
  $('#horaTermino').value = `${dd(fin.hora)}:${dd(fin.minuto)}`;
  muestraLimite();

  marcaUbicacion(estado.punto);
  marcaAdjunto(null, 'Se conserva el permiso ya cargado. Adjunta uno nuevo sólo si lo reemplazas.');
  $('#btnGuardar').textContent = 'Guardar cambios';
  modoFormulario('edicion');
  cierra('veloFicha');
  abre('veloForm');
}

/** El formulario tiene dos estados: mientras se completa, y una vez
 *  guardado, cuando ofrece descargar el respaldo de la declaración. */
function modoFormulario(modo) {
  const guardado = modo === 'guardado';
  $('#formulario').style.display = guardado ? 'none' : '';
  $('#btnGuardar').hidden = guardado;
  $('#btnRespaldoDeclaracion').hidden = !guardado;
  $('#btnCancelarForm').textContent = guardado ? 'Cerrar' : 'Cancelar';
  $('#exitoForm').classList.toggle('visible', guardado);
  if (!guardado) $('#exitoForm').innerHTML = '';
}

/** Propone automáticamente el término máximo del turno. */
function sugiereTermino() {
  const inicio = desdeCampos($('#fechaInicio').value, $('#horaInicio').value);
  if (!inicio) return;
  const lim = limiteTermino(inicio);
  $('#fechaTermino').value = lim.fecha;
  $('#horaTermino').value = lim.hora;
  muestraLimite();
}

function muestraLimite() {
  const inicio = desdeCampos($('#fechaInicio').value, $('#horaInicio').value);
  const ayuda = $('#ayudaVentana');
  if (!inicio) {
    ayuda.textContent = 'El permiso dura como máximo 12 horas y no puede cruzar el cambio de turno.';
    ayuda.classList.remove('aviso');
    return;
  }
  const lim = limiteTermino(inicio);
  const p = partesChile(inicio);
  const turno = (p.hora >= 8 && p.hora < 20) ? 'día' : 'noche';
  const termino = desdeCampos($('#fechaTermino').value, $('#horaTermino').value);
  const v = validaVentana(inicio, termino);
  ayuda.textContent = v.ok
    ? `Turno ${turno}. El término máximo permitido es ${lim.texto}.`
    : v.mensaje;
  ayuda.classList.toggle('aviso', !v.ok);
}

function marcaUbicacion(punto) {
  const caja = $('#cajaUbicacion');
  const txt = $('#textoUbicacion');
  if (punto) {
    caja.classList.add('puesta');
    txt.innerHTML = `Punto marcado en el plano
      <small>Toca «Cambiar punto» si necesitas corregirlo.</small>`;
    $('#btnMarcar').textContent = 'Cambiar punto';
    mapa.muestraProvisionalEn(punto.x, punto.y);
  } else {
    caja.classList.remove('puesta');
    txt.innerHTML = `Sin marcar
      <small>El punto señala la ubicación exacta del trabajo para facilitar la respuesta ante una emergencia.</small>`;
    $('#btnMarcar').textContent = 'Marcar en el plano';
  }
}

function marcaAdjunto(archivo, notaAlterna) {
  const caja = $('#cajaAdjunto');
  const txt = $('#textoAdjunto');
  if (archivo) {
    caja.classList.add('cargado');
    txt.innerHTML = `${escapa(archivo.name)}
      <small>${(archivo.size / 1024 / 1024).toFixed(1)} MB · listo para subir</small>`;
    $('#btnAdjuntar').textContent = 'Cambiar';
  } else {
    caja.classList.remove('cargado');
    txt.innerHTML = `Sin adjuntar
      <small>${notaAlterna || 'Foto o PDF del permiso firmado. JPG, PNG o PDF, hasta 10 MB.'}</small>`;
    $('#btnAdjuntar').textContent = 'Adjuntar';
  }
}

/** Oculta el formulario para que el usuario pueda tocar el plano. */
function pideUbicacion() {
  $('#veloForm').classList.remove('abierto');
  $('#guia').classList.add('visible');
  mapa.activaSeleccion((punto) => {
    estado.punto = punto;
    $('#guia').classList.remove('visible');
    mapa.cancelaSeleccion();
    mapa.muestraProvisionalEn(punto.x, punto.y);
    $('#veloForm').classList.add('abierto');
    marcaUbicacion(punto);
  });
}

async function guarda() {
  const err = $('#errorForm');
  const muestraError = (m) => {
    err.textContent = m;
    err.classList.add('visible');
    $('#veloForm .modal-cuerpo').scrollTop = 0;
  };
  err.classList.remove('visible');

  const form = $('#formulario');
  const tipo = form.querySelector('input[name="tipo"]:checked')?.value;

  if (!tipo) return muestraError('Elige el tipo de trabajo crítico.');
  if (!estado.punto) return muestraError('Marca en el plano el lugar donde se realizará el trabajo.');
  if (!$('#empresa').value.trim()) return muestraError('Indica la empresa que ejecuta el trabajo.');
  if (!$('#area').value.trim()) return muestraError('Indica el área donde se realiza.');
  if (!$('#equipo').value.trim()) return muestraError('Indica el equipo o instalación específica.');
  if (!$('#descripcion').value.trim()) return muestraError('Describe brevemente la actividad.');
  const n = parseInt($('#trabajadores').value, 10);
  if (!n || n < 1) return muestraError('Indica cuántos trabajadores participan.');
  if (!$('#supervisor').value.trim()) return muestraError('Indica el supervisor responsable.');

  const inicio = desdeCampos($('#fechaInicio').value, $('#horaInicio').value);
  const termino = desdeCampos($('#fechaTermino').value, $('#horaTermino').value);
  const v = validaVentana(inicio, termino);
  if (!v.ok) return muestraError(v.mensaje);

  if (!estado.editando) {
    const problema = datos.revisaArchivo(estado.archivo);
    if (problema) return muestraError(problema);
  } else if (estado.archivo) {
    const problema = datos.revisaArchivo(estado.archivo);
    if (problema) return muestraError(problema);
  }

  const boton = $('#btnGuardar');
  boton.disabled = true;
  boton.textContent = 'Guardando…';

  try {
    let permiso = null;
    if (estado.archivo) {
      boton.textContent = 'Subiendo permiso…';
      permiso = await datos.subePermiso(estado.archivo);
    }

    const comun = {
      tipo,
      empresa: $('#empresa').value.trim(),
      area: $('#area').value.trim(),
      equipo: $('#equipo').value.trim(),
      descripcion: $('#descripcion').value.trim(),
      n_trabajadores: n,
      supervisor: $('#supervisor').value.trim(),
      inicio: inicio.toISOString(),
      termino: termino.toISOString(),
      x: estado.punto.x,
      y: estado.punto.y
    };

    if (estado.editando) {
      if (permiso) { comun.permiso_path = permiso.ruta; comun.permiso_tipo = permiso.tipo; }
      const actor = $('#registradoPor').value.trim() || 'Administrador';
      const t = await datos.actualizaTrabajo(estado.editando, comun, actor);
      estado.trabajos.set(t.id, t);
      avisa('Cambios guardados.');
    } else {
      const t = await datos.creaTrabajo({
        ...comun,
        permiso_path: permiso.ruta,
        permiso_tipo: permiso.tipo,
        registrado_por: $('#registradoPor').value.trim() || 'No identificado'
      });
      estado.trabajos.set(t.id, t);
      estado.ultimoGuardado = t;

      $('#exitoForm').innerHTML = `
        <strong>Trabajo registrado correctamente.</strong>
        ${estadoDe(t) === 'PROGRAMADO'
          ? 'Quedó programado: aparecerá en el mapa al llegar la hora de inicio.'
          : 'Ya está visible en el mapa para la Unidad de Emergencia.'}
        Puedes descargar el respaldo en PDF de esta declaración.`;
      modoFormulario('guardado');
      mapa.quitaProvisional();
      dibujaTodo();
      return;
    }

    mapa.quitaProvisional();
    dibujaTodo();
    cierra('veloForm');
  } catch (e) {
    muestraError(e.message);
  } finally {
    boton.disabled = false;
    boton.textContent = estado.editando ? 'Guardar cambios' : 'Guardar trabajo';
  }
}

// ============================================================
//  Modo administrador
// ============================================================
function entraAdmin() {
  const err = $('#errorAdmin');
  if ($('#claveAdmin').value === CLAVE_ADMIN) {
    estado.admin = true;
    document.body.classList.add('admin');
    $('#claveAdmin').value = '';
    err.classList.remove('visible');
    cierra('veloAdmin');
    avisa('Modo administrador activo. Ya puedes editar y eliminar.');
  } else {
    err.textContent = 'Clave incorrecta.';
    err.classList.add('visible');
  }
}

function saleAdmin() {
  estado.admin = false;
  document.body.classList.remove('admin');
  avisa('Modo administrador desactivado.', 'info');
}

// ============================================================
//  Historial
// ============================================================
let historialActual = [];

async function buscaHistorial() {
  const cuerpo = $('#cuerpoHistorial');
  cuerpo.innerHTML = '<tr><td colspan="8" style="color:var(--tenue);padding:20px">Buscando…</td></tr>';
  try {
    const filtros = {
      desde: $('#hDesde').value ? desdeCampos($('#hDesde').value, '00:00').toISOString() : null,
      hasta: $('#hHasta').value ? desdeCampos($('#hHasta').value, '23:59').toISOString() : null,
      tipo: $('#hTipo').value || null,
      empresa: $('#hEmpresa').value.trim() || null,
      area: $('#hArea').value.trim() || null,
      supervisor: $('#hSupervisor').value.trim() || null
    };
    historialActual = await datos.cargaHistorial(filtros);
    $('#resumenHistorial').textContent =
      `${historialActual.length} ${historialActual.length === 1 ? 'registro' : 'registros'}` +
      (historialActual.length === 500 ? ' (máximo por búsqueda; acota las fechas)' : '');

    if (!historialActual.length) {
      cuerpo.innerHTML = '<tr><td colspan="8" style="color:var(--tenue);padding:20px">Sin resultados para esos filtros.</td></tr>';
      return;
    }
    cuerpo.innerHTML = '';
    historialActual.forEach(t => {
      const tipo = TIPOS[t.tipo];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${soloFecha(t.inicio)}</td>
        <td class="cifra">${soloHora(t.inicio)}</td>
        <td class="cifra">${soloHora(t.termino)}</td>
        <td><span class="marca-tipo" style="--tono:${tipo.color}"></span>${tipo.corto}</td>
        <td>${escapa(t.empresa)}</td>
        <td>${escapa(t.area)} · ${escapa(t.equipo)}</td>
        <td>${escapa(t.supervisor)}</td>
        <td>${t.n_trabajadores}</td>`;
      tr.addEventListener('click', () => {
        estado.trabajos.set(t.id, t);
        cierra('veloHistorial');
        abreFicha(t.id);
      });
      cuerpo.appendChild(tr);
    });
  } catch (e) {
    cuerpo.innerHTML = `<tr><td colspan="8" style="color:#FFAA9C;padding:20px">${escapa(e.message)}</td></tr>`;
  }
}

async function respaldoDeclaracion() {
  const t = estado.ultimoGuardado;
  if (!t) return;
  const boton = $('#btnRespaldoDeclaracion');
  boton.disabled = true;
  try {
    await pdfDeclaracion(t);
    avisa('Respaldo descargado.');
  } catch (e) {
    avisa(e.message, 'error');
  } finally {
    boton.disabled = false;
  }
}

async function exportaHistorialPDF() {
  if (!historialActual.length) return avisa('Primero haz una búsqueda.', 'info');
  try {
    await pdfHistorial(historialActual, filtrosLegibles());
    avisa('Historial descargado en PDF.');
  } catch (e) { avisa(e.message, 'error'); }
}

/** Describe en texto los filtros aplicados, para dejarlos escritos en
 *  el encabezado del PDF: sin eso, el documento impreso no dice a qué
 *  universo corresponde. */
function filtrosLegibles() {
  const f = [];
  const desde = $('#hDesde').value, hasta = $('#hHasta').value;
  const fmt = (v) => v.split('-').reverse().join('-');
  if (desde && hasta)      f.push({ k: 'Período', v: `${fmt(desde)} al ${fmt(hasta)}` });
  else if (desde)          f.push({ k: 'Período', v: `desde el ${fmt(desde)}` });
  else if (hasta)          f.push({ k: 'Período', v: `hasta el ${fmt(hasta)}` });
  else                     f.push({ k: 'Período', v: 'todos los registros' });

  const tipo = $('#hTipo').value;
  f.push({ k: 'Tipo de trabajo', v: tipo ? TIPOS[tipo].nombre : 'todos' });
  f.push({ k: 'Empresa', v: $('#hEmpresa').value.trim() || 'todas' });
  f.push({ k: 'Área', v: $('#hArea').value.trim() || 'todas' });
  f.push({ k: 'Supervisor', v: $('#hSupervisor').value.trim() || 'todos' });
  return f;
}

function exportaCSV() {
  if (!historialActual.length) return avisa('Primero haz una búsqueda.', 'info');
  const cab = ['Tipo', 'Empresa', 'Area', 'Equipo', 'Descripcion', 'Trabajadores',
               'Supervisor', 'Inicio', 'Termino', 'Estado', 'Registrado por', 'Creado en'];
  const filas = historialActual.map(t => [
    TIPOS[t.tipo].nombre, t.empresa, t.area, t.equipo, t.descripcion, t.n_trabajadores,
    t.supervisor, fechaHoraLarga(t.inicio), fechaHoraLarga(t.termino),
    estadoDe(t), t.registrado_por, fechaHoraLarga(t.creado_en)
  ]);
  const csv = [cab, ...filas]
    .map(f => f.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
  // BOM para que Excel en español respete los acentos
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `trabajos-criticos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ============================================================
//  Utilidades de interfaz
// ============================================================
const abre = (id) => { $('#' + id).classList.add('abierto'); };
const cierra = (id) => {
  $('#' + id).classList.remove('abierto');
  if (id === 'veloForm') { mapa.cancelaSeleccion(); mapa.quitaProvisional(); }
  if (id === 'veloFicha') estado.fichaAbierta = null;
};

function avisa(texto, clase = '') {
  const el = document.createElement('div');
  el.className = `aviso ${clase}`;
  el.textContent = texto;
  $('#avisos').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 4200);
}

function escapa(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Despliega o pliega la hoja inferior del celular. Al cambiar de
 *  tamaño el mapa hay que avisarle, o queda descuadrado. */
function alternaHoja() {
  const p = $('#panel');
  const abierta = p.classList.toggle('desplegado');
  $('#tirador').setAttribute('aria-expanded', String(abierta));
  $('#btnDesplegar').setAttribute('aria-expanded', String(abierta));
  $('#textoDesplegar').textContent = abierta
    ? 'Ocultar información'
    : 'Ver más información';
  setTimeout(mapa.ajustaTamano, 260);
}

function entraSala() { document.body.classList.add('vista-sala'); }
function salirSala() { document.body.classList.remove('vista-sala'); }

// ============================================================
//  Conexión de eventos
// ============================================================
function conectaEventos() {
  $('#btnNuevo').addEventListener('click', abreFormularioNuevo);
  $('#btnEncuadrar').addEventListener('click', mapa.encuadraTodo);
  $('#btnGuardar').addEventListener('click', guarda);
  $('#btnMarcar').addEventListener('click', pideUbicacion);
  $('#btnCancelarPunto').addEventListener('click', () => {
    $('#guia').classList.remove('visible');
    mapa.cancelaSeleccion();
    if (estado.punto) mapa.muestraProvisionalEn(estado.punto.x, estado.punto.y);
    $('#veloForm').classList.add('abierto');
  });

  $('#btnAdjuntar').addEventListener('click', () => $('#archivo').click());
  $('#archivo').addEventListener('change', (e) => {
    const f = e.target.files[0];
    const problema = datos.revisaArchivo(f);
    if (problema) { avisa(problema, 'error'); e.target.value = ''; return; }
    estado.archivo = f;
    marcaAdjunto(f);
  });

  ['#fechaInicio', '#horaInicio'].forEach(sel =>
    $(sel).addEventListener('change', () => { sugiereTermino(); }));
  ['#fechaTermino', '#horaTermino'].forEach(sel =>
    $(sel).addEventListener('change', muestraLimite));

  // Filtros del panel
  $$('#filtros .filtro').forEach(b => {
    b.addEventListener('click', () => {
      estado.filtro = b.dataset.tipo;
      $$('#filtros .filtro').forEach(o => o.setAttribute('aria-pressed', String(o === b)));
      pintaLista();
    });
  });

  // Ficha
  $('#btnCentrar').addEventListener('click', () => {
    if (estado.fichaAbierta) { mapa.enfoca(estado.fichaAbierta); cierra('veloFicha'); }
  });
  $('#btnEditar').addEventListener('click', () => {
    const t = estado.trabajos.get(estado.fichaAbierta);
    if (t) abreFormularioEdicion(t);
  });
  $('#btnFinalizar').addEventListener('click', async () => {
    const t = estado.trabajos.get(estado.fichaAbierta);
    if (!t) return;
    if (!confirm(`¿Finalizar ahora el trabajo de ${t.empresa} en ${t.equipo}?\n\nDejará de verse en el mapa, pero seguirá en el historial.`)) return;
    try {
      const motivo = prompt('Motivo (opcional):') || null;
      const act = await datos.cierraTrabajo(t.id, motivo);
      estado.trabajos.set(act.id, act);
      dibujaTodo();
      cierra('veloFicha');
      avisa('Trabajo finalizado.');
    } catch (e) { avisa(e.message, 'error'); }
  });
  $('#btnEliminar').addEventListener('click', async () => {
    const t = estado.trabajos.get(estado.fichaAbierta);
    if (!t) return;
    if (!confirm(`¿Eliminar definitivamente este registro?\n\n${t.empresa} · ${t.equipo}\n\nSe borra también el permiso adjunto y no se puede deshacer. Si sólo quieres sacarlo del mapa, usa «Finalizar ahora».`)) return;
    try {
      await datos.eliminaTrabajo(t.id, t.permiso_path);
      estado.trabajos.delete(t.id);
      dibujaTodo();
      cierra('veloFicha');
      avisa('Registro eliminado.');
    } catch (e) { avisa(e.message, 'error'); }
  });

  // Administrador
  $('#btnAdmin').addEventListener('click', () => {
    if (estado.admin) saleAdmin();
    else { $('#errorAdmin').classList.remove('visible'); abre('veloAdmin'); setTimeout(() => $('#claveAdmin').focus(), 60); }
  });
  $('#btnEntrarAdmin').addEventListener('click', entraAdmin);
  $('#claveAdmin').addEventListener('keydown', (e) => { if (e.key === 'Enter') entraAdmin(); });

  // Sala e historial
  $('#btnSala').addEventListener('click', entraSala);
  $('#btnSalirSala').addEventListener('click', salirSala);
  $('#btnHistorial').addEventListener('click', () => { abre('veloHistorial'); buscaHistorial(); });
  $('#btnBuscarHistorial').addEventListener('click', buscaHistorial);
  $('#btnLimpiarHistorial').addEventListener('click', () => {
    ['#hDesde', '#hHasta', '#hEmpresa', '#hArea', '#hSupervisor'].forEach(s => $(s).value = '');
    $('#hTipo').value = '';
    buscaHistorial();
  });
  $('#btnExportar').addEventListener('click', exportaCSV);
  $('#btnExportarPdf').addEventListener('click', exportaHistorialPDF);
  $('#btnRespaldoDeclaracion').addEventListener('click', respaldoDeclaracion);

  // Cierre de ventanas
  $$('[data-cerrar]').forEach(b => b.addEventListener('click', () => cierra(b.dataset.cerrar)));
  $$('.velo').forEach(v => v.addEventListener('click', (e) => { if (e.target === v) cierra(v.id); }));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const abierto = $$('.velo.abierto').pop();
    if (abierto) cierra(abierto.id);
    else if (document.body.classList.contains('vista-sala')) salirSala();
  });

  // Menú compacto de la barra en celular
  $('#btnMas').addEventListener('click', (e) => {
    e.stopPropagation();
    const g = $('#grupoAcciones');
    const abierto = g.classList.toggle('abierto');
    $('#btnMas').setAttribute('aria-expanded', String(abierto));
  });
  document.addEventListener('click', () => {
    $('#grupoAcciones').classList.remove('abierto');
    $('#btnMas').setAttribute('aria-expanded', 'false');
  });
  $('#grupoAcciones').addEventListener('click', () => {
    $('#grupoAcciones').classList.remove('abierto');
  });

  // Hoja inferior en celular: el tirador y el botón hacen lo mismo
  $('#tirador').addEventListener('click', alternaHoja);
  $('#btnDesplegar').addEventListener('click', alternaHoja);
}

inicia();
