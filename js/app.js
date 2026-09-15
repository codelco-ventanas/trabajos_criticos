// ============================================================
//  Aplicación · Trabajos Críticos División Ventanas
// ============================================================

import { TIPOS, CLAVE_ADMIN, REFRESCO_SEGUNDOS, MAPA, PURGA, HORAS_FINALIZADOS } from './config.js';
import * as datos from './datos.js';
import * as mapa from './mapa.js';
import { pdfHistorial, pdfDeclaracion } from './pdf.js';
import {
  desdeCampos, validaVentana, limiteTermino, estadoDe,
  fechaHoraLarga, horaRelativa, soloHora, soloFecha, tiempoRestante, camposAhora, partesChile,
  validaNoPasado
} from './vigencia.js';

// Versión de la aplicación. Se muestra al pie de la ventana
// "Información de relevancia", para poder comprobar de un vistazo qué
// versión está realmente publicada en GitHub. Vive aquí y no en
// config.js para que actualizarla nunca ponga en riesgo las
// credenciales de la base de datos.
const VERSION = '2.1';

const ORDEN_TIPOS = ['caliente', 'altura', 'confinado'];

/** Tipos de una actividad, siempre como lista y en orden estable.
 *  Acepta también los registros antiguos, que tenían un solo tipo. */
function tiposDe(t) {
  const lista = Array.isArray(t.tipos) && t.tipos.length ? t.tipos : (t.tipo ? [t.tipo] : []);
  return ORDEN_TIPOS.filter(x => lista.includes(x));
}

/** "Caliente + Altura" */
const nombreTipos = (t, largo = false) =>
  tiposDe(t).map(x => largo ? TIPOS[x].nombre : TIPOS[x].corto).join(' + ');

const esDelTipo = (t, tipo) => !tipo || tiposDe(t).includes(tipo);

/** Filtro por prueba de comunicación radial. */
const pasaRadio = (t, valor) =>
  !valor || (valor === 'si' ? !!t.comunicacion_ok : !t.comunicacion_ok);

/** Distintivo de la prueba: verde con la hora si está hecha. */
function selloRadio(t, conPendiente = false) {
  if (t.comunicacion_ok) {
    return `<span class="sello-radio">Prueba de comunicación OK · ${soloHora(t.comunicacion_en)}</span>`;
  }
  return conPendiente
    ? '<span class="sello-radio pendiente">Prueba de comunicación pendiente</span>'
    : '';
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ------------------------------------------------------------
//  Estado en memoria
// ------------------------------------------------------------
const estado = {
  trabajos: new Map(),     // id -> trabajo
  filtro: '',              // '' | caliente | altura | confinado
  filtroFin: '',           // el mismo filtro, para la sección de finalizados
  empresa: '',             // '' = todas las empresas
  radio: '',               // '' | si | no  (prueba de comunicación)
  admin: false,
  editando: null,          // id del trabajo en edición
  punto: null,             // { x, y } elegido en el plano
  permisos: {},            // { caliente: File, altura: File, … }
  permisosPrevios: {},     // los ya guardados, al editar
  fichaAbierta: null,
  ultimoGuardado: null,    // trabajo recién creado, para su respaldo
  archivoLugar: null,      // foto del lugar en el formulario
  archivoLugarFicha: null  // foto del lugar añadida desde la ficha
};

/** El filtro de empresa se aplica en todas partes: mapa, lista de
 *  activos y lista de finalizados. */
const deLaEmpresa = (t) => !estado.empresa || t.empresa === estado.empresa;

const visiblesEnMapa = () =>
  [...estado.trabajos.values()].filter(t => estadoDe(t) === 'ACTIVO');

const paraElPanel = () =>
  [...estado.trabajos.values()]
    .filter(t => ['ACTIVO', 'PROGRAMADO'].includes(estadoDe(t)))
    .filter(deLaEmpresa)
    .filter(t => pasaRadio(t, estado.radio))
    .sort((a, b) => {
      const ea = estadoDe(a), eb = estadoDe(b);
      if (ea !== eb) return ea === 'ACTIVO' ? -1 : 1;
      return ea === 'ACTIVO'
        ? new Date(a.termino) - new Date(b.termino)   // los que vencen antes, arriba
        : new Date(a.inicio) - new Date(b.inicio);
    });

/** Hora de término real de la actividad.
 *
 *  La empresa declara una hora estimada al registrar. Si un
 *  administrador cierra el trabajo antes, la actividad terminó
 *  realmente en ese momento, y esa es la hora que debe figurar en el
 *  historial, en el panel y en los documentos. La estimada se
 *  conserva y se muestra como tal en la ficha. */
const terminoReal = (t) => (t.cerrado && t.cerrado_en) ? t.cerrado_en : t.termino;

const momentoFin = (t) => new Date(terminoReal(t)).getTime();

/** Finalizados recientes: los que llevan menos de HORAS_FINALIZADOS
 *  desde que terminaron. Pasado ese plazo desaparecen del panel, pero
 *  siguen en el historial. */
const finalizados = () => {
  const corte = Date.now() - HORAS_FINALIZADOS * 3600 * 1000;
  return [...estado.trabajos.values()]
    .filter(t => estadoDe(t) === 'FINALIZADO')
    .filter(t => momentoFin(t) >= corte)
    .filter(deLaEmpresa)
    .filter(t => pasaRadio(t, estado.radio))
    .sort((a, b) => momentoFin(b) - momentoFin(a));
};

// ============================================================
//  Arranque
// ============================================================
async function inicia() {
  if (!datos.configurado()) {
    $('#cortina').classList.add('visible');
    return;
  }

  $('#versionApp').textContent = `Versión ${VERSION}`;
  datos.sincronizaReloj();
  setInterval(() => datos.sincronizaReloj(), 30 * 60 * 1000);

  mapa.iniciaMapa({ alSeleccionar: abreFicha });
  conectaEventos();

  try {
    const lista = await datos.cargaTrabajos(HORAS_FINALIZADOS);
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
        const lista = await datos.cargaTrabajos(HORAS_FINALIZADOS);
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
  // Los filtros afectan también al mapa: se ven sólo los marcadores
  // del tipo y la empresa elegidos.
  const enElMapa = activos
    .filter(deLaEmpresa)
    .filter(t => pasaRadio(t, estado.radio))
    .filter(t => esDelTipo(t, estado.filtro));
  mapa.pintaTrabajos(enElMapa);
  pintaLista();
  pintaListaFinalizados();
  actualizaEmpresas();
  pintaSala(activos);
}

/** Actualiza las cifras que acompañan a cada filtro de tipo. */
function cifrasFiltros(contenedor, conjunto) {
  // Una actividad con dos tipos suma en los dos filtros, pero cuenta
  // una sola vez en "Todos": es un solo trabajo con dos riesgos.
  const c = { caliente: 0, altura: 0, confinado: 0 };
  conjunto.forEach(t => tiposDe(t).forEach(x => c[x]++));
  $$(`${contenedor} .cifra`).forEach(el => {
    const t = el.dataset.cuenta;
    el.textContent = t ? c[t] : conjunto.length;
  });
}

function pintaLista() {
  const cont = $('#lista');
  const todos = paraElPanel();
  cifrasFiltros('#filtros', todos);
  const lista = todos.filter(t => esDelTipo(t, estado.filtro));

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
    const hayFiltro = estado.filtro || estado.empresa;
    cont.innerHTML = `<div class="vacio">
        <strong>No hay trabajos que mostrar</strong>
        ${hayFiltro ? 'Prueba con otro filtro.' : 'Registra el primero con el botón «Nuevo trabajo».'}
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
  const tipos = tiposDe(t);
  const tipo = TIPOS[tipos[0]];
  const est = estadoDe(t);
  const restante = tiempoRestante(t.termino);
  const porVencer = est === 'ACTIVO' && restante &&
                    (new Date(t.termino) - Date.now()) < 60 * 60 * 1000;

  const b = document.createElement('button');
  b.className = `tarjeta ${est.toLowerCase()} ${porVencer ? 'por-vencer' : ''}` +
                (tipos.length > 1 ? ' combinada' : '');
  b.style.setProperty('--tono', tipo.color);
  if (tipos.length > 1) {
    const paso = 100 / tipos.length;
    b.style.setProperty('--franja', `linear-gradient(${tipos.map((x, i) =>
      `${TIPOS[x].color} ${i * paso}% ${(i + 1) * paso}%`).join(', ')})`);
  }
  b.innerHTML = `
    <div class="tarjeta-fila">
      <span class="tarjeta-tipos">${tipos.map(x =>
        `<span class="tarjeta-tipo" style="--tono:${TIPOS[x].color};color:${TIPOS[x].color}"
        ><i class="icono-tipo ${x}"></i>${TIPOS[x].corto}</span>`).join('')}</span>
      <span class="tarjeta-empresa">${escapa(t.empresa)}</span>
    </div>
    <div class="tarjeta-lugar">${escapa(t.area)} · ${escapa(t.equipo)}</div>
    ${t.comunicacion_ok ? `<div style="margin-top:3px">${selloRadio(t)}</div>` : ''}
    <div class="tarjeta-pie">
      <span class="personas">${t.n_trabajadores} ${t.n_trabajadores === 1 ? 'persona' : 'personas'}</span>
      <span class="supervisor">${escapa(t.supervisor)}</span>
      <time>${est === 'PROGRAMADO'
        ? 'inicia ' + horaRelativa(t.inicio)
        : est === 'FINALIZADO'
          ? 'terminó ' + soloHora(terminoReal(t))
          : 'hasta ' + soloHora(t.termino) + (restante ? ` · ${restante}` : '')}</time>
    </div>`;
  b.addEventListener('click', () => {
    if (estadoDe(t) === 'ACTIVO') mapa.enfoca(t.id);
    abreFicha(t.id);
  });
  return b;
}

function pintaListaFinalizados() {
  const todos = finalizados();
  cifrasFiltros('#filtrosFin', todos);
  $('#cuentaFinalizados').textContent = todos.length;

  const cont = $('#listaFin');
  if (!cont) return;
  const lista = todos.filter(t => esDelTipo(t, estado.filtroFin));

  cont.innerHTML = '';
  if (!lista.length) {
    cont.innerHTML = `<div class="vacio" style="margin:14px 4px">
        <strong>Sin trabajos finalizados</strong>
        Aquí aparecen los que terminaron hace menos de ${HORAS_FINALIZADOS} horas.
      </div>`;
    return;
  }
  lista.forEach(t => cont.appendChild(tarjeta(t)));
}

function pintaSala(activos) {
  const c = { caliente: 0, altura: 0, confinado: 0 };
  activos.forEach(t => tiposDe(t).forEach(x => c[x]++));
  $('#salaTotal').textContent = activos.length;
  $('#salaCaliente').textContent = c.caliente;
  $('#salaAltura').textContent = c.altura;
  $('#salaConfinado').textContent = c.confinado;
  $('#salaPersonas').textContent = activos.reduce((s, t) => s + t.n_trabajadores, 0);

  // Las empresas del desplegable salen de los trabajos en pantalla
  const sel = $('#salaEmpresa');
  const empresas = [...new Set(activos.map(t => (t.empresa || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
  const firma = empresas.join('|');
  if (sel.dataset.firma !== firma) {
    const elegida = sel.value;
    sel.dataset.firma = firma;
    sel.innerHTML = '<option value="">Todas</option>' +
      empresas.map(e => `<option value="${escapa(e)}">${escapa(e)}</option>`).join('');
    sel.value = empresas.includes(elegida) ? elegida : '';
  }

  const fTipo = $('#salaTipo').value;
  const fArea = $('#salaArea').value.trim().toLowerCase();
  const fEmpresa = sel.value;
  const fRadio = $('#salaRadio').value;

  const lista = activos
    .filter(t => esDelTipo(t, fTipo))
    .filter(t => !fArea ||
      `${t.area} ${t.equipo}`.toLowerCase().includes(fArea))
    .filter(t => !fEmpresa || t.empresa === fEmpresa)
    .filter(t => pasaRadio(t, fRadio))
    .sort((a, b) => new Date(a.termino) - new Date(b.termino));

  const cuerpo = $('#salaCuerpo');
  cuerpo.innerHTML = '';
  if (!lista.length) {
    cuerpo.innerHTML = `<tr><td colspan="8" style="padding:26px;color:var(--tenue)">
      ${activos.length ? 'Ningún trabajo coincide con los filtros aplicados.'
                       : 'Ningún trabajo crítico en ejecución en este momento.'}</td></tr>`;
    return;
  }

  lista.forEach(t => {
    const restante = tiempoRestante(t.termino);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${tiposDe(t).map(x =>
        `<span class="marca-tipo" style="--tono:${TIPOS[x].color}"></span>${TIPOS[x].corto}`)
        .join('<br>')}</td>
      <td>${escapa(t.area)}<br><span style="color:var(--tenue)">${escapa(t.equipo)}</span></td>
      <td>${escapa(t.empresa)}</td>
      <td>${t.comunicacion_ok
        ? `<span class="sello-radio">Sí · ${soloHora(t.comunicacion_en)}</span>`
        : '<span class="sello-radio pendiente">No</span>'}</td>
      <td>${escapa(t.supervisor)}</td>
      <td class="cifra">${t.n_trabajadores}</td>
      <td class="cifra">${soloHora(t.inicio)}</td>
      <td class="cifra">${soloHora(t.termino)}${restante ? `<br><span style="color:var(--tenue)">faltan ${restante}</span>` : ''}</td>`;
    tr.addEventListener('click', () => { salirSala(); mapa.enfoca(t.id); abreFicha(t.id); });
    cuerpo.appendChild(tr);
  });
}

/** Rellena el desplegable con las empresas que tienen trabajos
 *  cargados, conservando la que esté elegida aunque ya no tenga
 *  trabajos vigentes. */
function actualizaEmpresas() {
  const sel = $('#selEmpresa');
  if (!sel) return;
  const empresas = [...new Set([...estado.trabajos.values()]
    .map(t => (t.empresa || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
  if (estado.empresa && !empresas.includes(estado.empresa)) empresas.push(estado.empresa);

  const firma = empresas.join('|');
  if (sel.dataset.firma !== firma) {
    sel.dataset.firma = firma;
    sel.innerHTML = '<option value="">Todas las empresas</option>' +
      empresas.map(e => `<option value="${escapa(e)}">${escapa(e)}</option>`).join('');
  }
  sel.value = estado.empresa;
  $('#btnQuitarEmpresa').hidden = !estado.empresa;
  $('#filtroEmpresa').classList.toggle('activo', !!estado.empresa);
}

function actualizaReloj() {
  const p = partesChile(new Date());
  const dd = (n) => String(n).padStart(2, '0');
  $('#reloj').textContent = `${dd(p.dia)}-${dd(p.mes)}-${p.anio}  ${dd(p.hora)}:${dd(p.minuto)}`;
}

function anuncia(t) {
  if (estadoDe(t) !== 'ACTIVO') return;
  avisa(`Nuevo trabajo en ${t.area}: ${t.empresa} (${nombreTipos(t)})`, 'info');
}

// ============================================================
//  Ficha del trabajo
// ============================================================
function abreFicha(id) {
  const t = estado.trabajos.get(id);
  if (!t) return;
  estado.fichaAbierta = id;
  const tipos = tiposDe(t);
  const est = estadoDe(t);
  const restante = tiempoRestante(t.termino);

  $('#tituloFicha').innerHTML = `<span class="ficha-titulo">
      <span class="chips-tipo">${tipos.map(x =>
        `<span class="chip-tipo" style="--tono:${TIPOS[x].color}"
          ><i class="icono-tipo ${x}"></i> ${TIPOS[x].nombre}</span>`).join('')}</span>
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
        <div class="dato-clave">${est === 'ACTIVO' ? 'Activo hasta'
          : est === 'FINALIZADO' ? 'Finalizado a las' : 'Inicia a las'}</div>
        <div class="dato-valor grande ${restante && new Date(t.termino) - Date.now() < 3600000 ? 'urgente' : ''}">
          ${est === 'FINALIZADO' ? soloHora(terminoReal(t))
            : est === 'PROGRAMADO' ? soloHora(t.inicio) : soloHora(t.termino)}</div>
        <div class="dato-clave">${est === 'FINALIZADO' ? 'actividad terminada'
          : restante ? `faltan ${restante}` : 'plazo cumplido'}</div>
      </div>
      <div class="dato">
        <div class="dato-clave">Hora de inicio</div>
        <div class="dato-valor">${fechaHoraLarga(t.inicio)}</div>
      </div>
      <div class="dato">
        <div class="dato-clave">Hora de término estimada</div>
        <div class="dato-valor">${fechaHoraLarga(t.termino)}</div>
      </div>
      <div class="dato ancho">
        <div class="dato-clave">Prueba de comunicación radial (Canal 7)</div>
        <div class="dato-valor">${t.comunicacion_ok
          ? `${selloRadio(t)} <span style="color:var(--tenue);font-size:12.5px">
               · registrada el ${fechaHoraLarga(t.comunicacion_en)}${
               t.comunicacion_por ? ' por ' + escapa(t.comunicacion_por) : ''}</span>`
          : '<span style="color:var(--tenue)">Sin registrar</span>'}</div>
      </div>
      ${t.cerrado ? `<div class="dato ancho">
        <div class="dato-clave">Hora de aviso de término</div>
        <div class="dato-valor">${fechaHoraLarga(t.cerrado_en)}${t.cerrado_motivo ? ' · ' + escapa(t.cerrado_motivo) : ''}</div>
      </div>` : ''}
    </div>

    <div class="interruptor-radio solo-admin" id="cajaRadio">
      <span class="texto-radio">¿Se realizó la prueba de comunicación?</span>
      <span class="conmutador">
        <button type="button" data-valor="si" aria-pressed="${t.comunicacion_ok}">Sí</button>
        <button type="button" data-valor="no" aria-pressed="${!t.comunicacion_ok}">No</button>
      </span>
      <button type="button" class="btn principal chico" id="btnGuardarRadio" disabled>Guardar</button>
    </div>

    <div class="bloque-permiso">
      ${t.lugar_path
        ? `<button class="btn" id="btnVerLugar" style="width:100%;justify-content:center;margin-bottom:8px">
             Ver foto del lugar
           </button>`
        : (est === 'FINALIZADO' ? '' :
          `<button class="btn" id="btnAgregarLugar" style="width:100%;justify-content:center;margin-bottom:8px">
             Agregar foto del lugar
           </button>
           <p class="sugerencia-lugar">Se recomienda incorporarla siempre: agiliza la
              respuesta ante una emergencia.</p>`)}

      ${permisosDe(t).length
        ? permisosDe(t).map(([x, p]) =>
            `<button class="btn permiso-ver" data-ruta="${escapa(p.path)}"
                     data-mime="${escapa(p.mime || '')}" data-tipo="${x}"
                     style="width:100%;justify-content:center;margin-bottom:8px;--tono:${TIPOS[x].color}">
               <i class="icono-tipo ${x}"></i> Ver permiso de ${escapa(TIPOS[x].permiso)}
             </button>`).join('')
        : `<div class="permiso-purgado">
             ${tipos.length > 1 ? 'Los permisos ya no están disponibles.' : 'El permiso ya no está disponible.'}
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

  // La elección no se envía hasta pulsar Guardar: así un toque
  // accidental no altera un dato que queda en la trazabilidad.
  radioElegido = !!t.comunicacion_ok;
  $$('#cajaRadio .conmutador button').forEach(b => b.addEventListener('click', () => {
    radioElegido = b.dataset.valor === 'si';
    $$('#cajaRadio .conmutador button').forEach(o =>
      o.setAttribute('aria-pressed', String((o.dataset.valor === 'si') === radioElegido)));
    $('#btnGuardarRadio').disabled = (radioElegido === !!t.comunicacion_ok);
  }));
  $('#btnGuardarRadio').addEventListener('click', () => cambiaComunicacion(t.id, radioElegido));

  $$('#cuerpoFicha .permiso-ver').forEach(b => b.addEventListener('click', () =>
    verArchivo(b.dataset.ruta, b.dataset.mime,
               `Permiso de ${TIPOS[b.dataset.tipo].permiso}`)));
  $('#btnVerLugar')?.addEventListener('click', () => verArchivo(t.lugar_path, t.lugar_tipo, 'Fotografía del lugar'));
  $('#btnAgregarLugar')?.addEventListener('click', () => abreFotoLugar(t.id));
  // Un trabajo ya terminado no se vuelve a finalizar, ni se edita ni
  // se elimina: su registro es el respaldo de lo que ocurrió.
  const terminado = (est === 'FINALIZADO');
  $('#btnFinalizar').hidden = terminado;
  $('#btnEditar').hidden = terminado;
  $('#btnEliminar').hidden = terminado;

  cargaTrazas(id);
  abre('veloFicha');
}

async function cargaTrazas(id) {
  try {
    const filas = await datos.auditoriaDe(id);
    const cont = $('#trazas');
    if (!cont || !filas.length) return;
    const etiqueta = {
      crear: 'Registró el trabajo', editar: 'Modificó',
      cerrar: 'Finalizó anticipadamente', eliminar: 'Eliminó'
    };
    cont.innerHTML = '<h4>Trazabilidad</h4>' + filas.map(f => {
      const detalle = describeCambios(f);
      return `<div class="traza">
          <time>${fechaHoraLarga(f.registrado_en)}</time>
          <span>${etiqueta[f.accion] || f.accion} — <b>${escapa(f.actor)}</b>${escapa(detalle)}</span>
        </div>`;
    }).join('');
  } catch { /* la trazabilidad es complementaria: si falla, la ficha igual sirve */ }
}

/**
 * Describe en palabras qué cambió. La prueba de comunicación merece
 * un texto propio: decir sólo "modificó prueba de comunicación" no
 * aclara si se marcó o se retiró, que es justamente el dato que
 * interesa al revisar la trazabilidad.
 */
function describeCambios(f) {
  const c = f.cambios;
  if (f.accion !== 'editar' || !c) return '';

  if ('comunicacion_ok' in c) {
    const ahora = c.comunicacion_ok?.despues;
    return ` · Prueba de comunicación ${ahora ? 'SÍ' : 'NO'}`;
  }

  const campos = Object.keys(c)
    .filter(k => !['comunicacion_en', 'comunicacion_por'].includes(k))
    .map(nombreCampo);
  return campos.length ? ' · ' + campos.join(', ') : '';
}

/** Permisos adjuntos, como pares [tipo, {path, mime}], en el orden
 *  en que se muestran los tipos. Sólo los que aún tienen archivo. */
function permisosDe(t) {
  const p = t.permisos || {};
  return tiposDe(t)
    .map(x => [x, p[x]])
    .filter(([, v]) => v && v.path);
}

const nombresCampos = {
  tipos: 'tipo de trabajo', empresa: 'empresa', area: 'área', equipo: 'equipo',
  permisos: 'permisos', lugar_path: 'foto del lugar',
  comunicacion_ok: 'prueba de comunicación',
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
async function verArchivo(ruta, tipo, titulo) {
  const cuerpo = $('#cuerpoPermiso');
  $('#veloPermiso .modal-cabecera h3').textContent = titulo;
  cuerpo.innerHTML = '<p style="color:var(--tenue)">Abriendo el archivo…</p>';
  abre('veloPermiso');
  try {
    const url = await datos.enlaceArchivo(ruta);
    $('#btnDescargarPermiso').href = url;
    cuerpo.innerHTML = tipo === 'application/pdf'
      ? `<iframe class="visor-permiso" src="${url}" title="${escapa(titulo)}"></iframe>`
      : `<div class="visor-permiso"><img src="${url}" alt="${escapa(titulo)}"></div>`;
  } catch {
    cuerpo.innerHTML = `<div class="vacio">
      <strong>El archivo no está disponible</strong>
      No se encuentra en el almacenamiento. Si el trabajo ya finalizó, es lo esperado.
    </div>`;
  }
}

/** Marca o retira la prueba de comunicación. Sólo el administrador
 *  puede hacerlo; el resto ve el dato pero no el interruptor. */
let radioElegido = false;

async function cambiaComunicacion(id, ok) {
  if (!estado.admin) return;
  const actual = estado.trabajos.get(id);
  if (!actual || !!actual.comunicacion_ok === ok) return;
  const boton = $('#btnGuardarRadio');
  boton.disabled = true;
  boton.textContent = 'Guardando…';
  try {
    const t = await datos.marcaComunicacion(id, ok, 'Administrador');
    estado.trabajos.set(t.id, t);
    dibujaTodo();
    abreFicha(t.id);
    avisa('Se guardó el cambio correctamente.');
  } catch (e) {
    avisa(e.message, 'error');
    boton.disabled = false;
    boton.textContent = 'Guardar';
  }
}

// ------------------------------------------------------------
//  Agregar la foto del lugar a un trabajo ya registrado.
//  Es la única modificación que puede hacer un usuario sin clave.
// ------------------------------------------------------------
let trabajoParaFoto = null;

function abreFotoLugar(id) {
  trabajoParaFoto = id;
  estado.archivoLugarFicha = null;
  $('#errorLugar').classList.remove('visible');
  marcaCaja('#cajaLugarFicha', '#textoLugarFicha', '#btnElegirLugar', null,
            'JPG o PNG. La aplicación reduce la imagen sola antes de subirla.');
  abre('veloLugar');
}

async function guardaFotoLugar() {
  const err = $('#errorLugar');
  const problema = datos.revisaArchivo(estado.archivoLugarFicha);
  if (problema) {
    err.textContent = problema.replace('el permiso de trabajo', 'la foto del lugar');
    err.classList.add('visible');
    return;
  }
  const boton = $('#btnGuardarLugar');
  boton.disabled = true;
  boton.textContent = 'Subiendo…';
  try {
    const t = await datos.guardaFotoLugar(
      trabajoParaFoto, estado.archivoLugarFicha, $('#quienAgrega').value.trim());
    estado.trabajos.set(t.id, t);
    dibujaTodo();
    cierra('veloLugar');
    avisa('Fotografía del lugar agregada.');
    if (estado.fichaAbierta === t.id) abreFicha(t.id);
  } catch (e) {
    err.textContent = e.message;
    err.classList.add('visible');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar foto';
  }
}

// ============================================================
//  Formulario
// ============================================================
function abreFormularioNuevo() {
  estado.editando = null;
  estado.punto = null;
  // (los permisos se manejan por tipo, ver estado.permisos)
  $('#tituloForm').textContent = 'Nuevo trabajo crítico';
  $('#formulario').reset();
  $$('input[name="tipo"]').forEach(c => { c.checked = false; });
  $('#errorForm').classList.remove('visible');

  const ahora = camposAhora(datos.ahoraServidor());
  $('#fechaInicio').value = ahora.fecha;
  $('#horaInicio').value = ahora.hora;
  sugiereTermino();
  estado.archivoLugar = null;
  estado.permisos = {};
  estado.permisosPrevios = {};
  marcaUbicacion(null);
  pintaPermisos();
  marcaAdjuntoLugar(null);
  $('#btnGuardar').textContent = 'Guardar trabajo';
  modoFormulario('edicion');
  abre('veloForm');
}

function abreFormularioEdicion(t) {
  estado.editando = t.id;
  estado.punto = { x: t.x, y: t.y };
  // (los permisos se manejan por tipo, ver estado.permisos)
  $('#tituloForm').textContent = 'Editar trabajo crítico';
  $('#errorForm').classList.remove('visible');

  $$('input[name="tipo"]').forEach(c => { c.checked = tiposDe(t).includes(c.value); });
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

  estado.archivoLugar = null;
  estado.permisos = {};
  estado.permisosPrevios = { ...(t.permisos || {}) };
  marcaUbicacion(estado.punto);
  pintaPermisos();
  marcaAdjuntoLugar(null);
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

function marcaCaja(selCaja, selTexto, selBoton, archivo, nota) {
  const caja = $(selCaja);
  const txt = $(selTexto);
  if (archivo) {
    caja.classList.add('cargado');
    txt.innerHTML = `${escapa(archivo.name || 'Imagen seleccionada')}
      <small>${(archivo.size / 1024 / 1024).toFixed(1)} MB · se reducirá al subir</small>`;
    $(selBoton).textContent = 'Cambiar';
  } else {
    caja.classList.remove('cargado');
    txt.innerHTML = `Sin adjuntar<small>${nota}</small>`;
    $(selBoton).textContent = 'Adjuntar';
  }
}

const NOTA_PERMISO = 'Foto o PDF del permiso firmado. JPG, PNG o PDF, hasta 10 MB.';

/** Tipos marcados ahora mismo en el formulario. */
const tiposElegidos = () =>
  ORDEN_TIPOS.filter(x => $(`input[name="tipo"][value="${x}"]`)?.checked);

/**
 * Dibuja una caja de adjunto por cada tipo de trabajo elegido, con su
 * propio rótulo: "Agregue el permiso de trabajo en caliente", etc.
 * Al desmarcar un tipo se descarta el archivo que se hubiera elegido
 * para él, para no subir un permiso que ya no corresponde.
 */
function pintaPermisos() {
  const cont = $('#permisosPorTipo');
  const tipos = tiposElegidos();

  Object.keys(estado.permisos).forEach(x => {
    if (!tipos.includes(x)) delete estado.permisos[x];
  });

  if (!tipos.length) {
    cont.innerHTML = '<span class="ayuda">Elija primero el tipo de trabajo para adjuntar su permiso.</span>';
    return;
  }

  cont.innerHTML = tipos.map(x => `
    <div class="permiso-tipo" data-tipo="${x}" style="--tono:${TIPOS[x].color}">
      <label><i class="icono-tipo ${x}"></i> Agregue el permiso de ${escapa(TIPOS[x].permiso)}
             <span class="obligatorio">*</span></label>
      <div class="adjunto" data-caja="${x}">
        <p data-texto="${x}"></p>
        <button type="button" class="btn chico" data-boton="${x}">Adjuntar</button>
      </div>
    </div>`).join('');

  tipos.forEach(x => {
    refrescaCajaPermiso(x);
    cont.querySelector(`[data-boton="${x}"]`)
        .addEventListener('click', () => pidePermiso(x));
  });
}

function refrescaCajaPermiso(x) {
  const caja = $(`#permisosPorTipo [data-caja="${x}"]`);
  if (!caja) return;
  const txt = caja.querySelector(`[data-texto="${x}"]`);
  const btn = caja.querySelector(`[data-boton="${x}"]`);
  const nuevo = estado.permisos[x];
  const previo = estado.permisosPrevios[x];

  if (nuevo) {
    caja.classList.add('cargado');
    txt.innerHTML = `${escapa(nuevo.name || 'Archivo')}
      <small>${(nuevo.size / 1024 / 1024).toFixed(1)} MB · se reducirá al subir</small>`;
    btn.textContent = 'Cambiar';
  } else if (previo) {
    caja.classList.add('cargado');
    txt.innerHTML = `Permiso ya cargado
      <small>Adjunte uno nuevo sólo si desea reemplazarlo.</small>`;
    btn.textContent = 'Reemplazar';
  } else {
    caja.classList.remove('cargado');
    txt.innerHTML = `Sin adjuntar<small>${NOTA_PERMISO}</small>`;
    btn.textContent = 'Adjuntar';
  }
}

/** Un único campo de archivo se reutiliza para todos los tipos. */
let tipoPidiendoPermiso = null;
function pidePermiso(x) {
  tipoPidiendoPermiso = x;
  const campo = $('#archivo');
  campo.value = '';
  campo.click();
}
const NOTA_LUGAR = 'Una foto del lugar exacto agiliza la respuesta ante una emergencia. ' +
  'Se recomienda incorporarla siempre; si no la tiene ahora, puede agregarla después ' +
  'desde la ficha del trabajo.';

function marcaAdjuntoLugar(archivo) {
  marcaCaja('#cajaLugar', '#textoLugar', '#btnAdjuntarLugar', archivo, NOTA_LUGAR);
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

  const tipos = tiposElegidos();

  if (!tipos.length) return muestraError('Elige al menos un tipo de trabajo crítico.');
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

  // Un trabajo crítico se declara antes de ejecutarlo. Al editar no
  // se revisa: lo habitual es que la actividad ya haya comenzado.
  if (!estado.editando) {
    const p = validaNoPasado(inicio, datos.ahoraServidor());
    if (!p.ok) return muestraError(p.mensaje);
  }

  // Cada tipo declarado necesita su permiso: el nuevo que se acaba de
  // elegir, o el que ya estaba guardado si se está editando.
  for (const x of tipos) {
    if (estado.permisos[x]) {
      const problema = datos.revisaArchivo(estado.permisos[x]);
      if (problema) return muestraError(`${TIPOS[x].nombre}: ${problema.toLowerCase()}`);
    } else if (!estado.permisosPrevios[x]?.path) {
      return muestraError(`Falta adjuntar el permiso de ${TIPOS[x].permiso}.`);
    }
  }

  const boton = $('#btnGuardar');
  boton.disabled = true;
  boton.textContent = 'Guardando…';

  try {
    // Se conservan los permisos ya guardados de los tipos que siguen
    // marcados, y se suben los nuevos.
    const permisos = {};
    for (const x of tipos) {
      if (estado.permisosPrevios[x]?.path) permisos[x] = estado.permisosPrevios[x];
    }
    for (const x of tipos) {
      if (!estado.permisos[x]) continue;
      boton.textContent = `Subiendo permiso de ${TIPOS[x].corto.toLowerCase()}…`;
      const subido = await datos.subePermiso(estado.permisos[x], TIPOS[x].permiso);
      permisos[x] = { path: subido.ruta, mime: subido.tipo };
    }

    let lugar = null;
    if (estado.archivoLugar) {
      boton.textContent = 'Subiendo foto del lugar…';
      lugar = await datos.subeFotoLugar(estado.archivoLugar);
    }

    const comun = {
      tipos,
      permisos,
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

    if (lugar) { comun.lugar_path = lugar.ruta; comun.lugar_tipo = lugar.tipo; }

    if (estado.editando) {
      const actor = $('#registradoPor').value.trim() || 'Administrador';
      const t = await datos.actualizaTrabajo(estado.editando, comun, actor);
      estado.trabajos.set(t.id, t);
      avisa('Cambios guardados.');
    } else {
      const t = await datos.creaTrabajo({
        ...comun,
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
    $('#textoAdmin').textContent = 'Modo Admin';
    $('#btnAdmin').title = 'Salir del modo administrador';
    $('#claveAdmin').value = '';
    err.classList.remove('visible');
    cierra('veloAdmin');
    avisa('Modo administrador activo. Ya tienes acceso a Sala, Historial y a editar trabajos.');
  } else {
    err.textContent = 'Clave incorrecta.';
    err.classList.add('visible');
  }
}

function saleAdmin() {
  estado.admin = false;
  document.body.classList.remove('admin');
  $('#textoAdmin').textContent = 'Admin';
  $('#btnAdmin').title = 'Modo administrador';
  // Sala e Historial son exclusivos del administrador: al salir hay
  // que abandonarlos, o quedarían a la vista de cualquiera.
  salirSala();
  cierra('veloHistorial');
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
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${soloFecha(t.inicio)}</td>
        <td class="cifra">${soloHora(t.inicio)}</td>
        <td class="cifra">${soloHora(terminoReal(t))}</td>
        <td>${tiposDe(t).map(x =>
          `<span class="marca-tipo" style="--tono:${TIPOS[x].color}"></span>${TIPOS[x].corto}`)
          .join('<br>')}</td>
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

async function respaldoDeFicha() {
  const t = estado.trabajos.get(estado.fichaAbierta);
  if (!t) return;
  const boton = $('#btnRespaldoFicha');
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
               'Supervisor', 'Inicio', 'Termino real', 'Estado', 'Registrado por', 'Creado en'];
  const filas = historialActual.map(t => [
    nombreTipos(t, true), t.empresa, t.area, t.equipo, t.descripcion, t.n_trabajadores,
    t.supervisor, fechaHoraLarga(t.inicio), fechaHoraLarga(terminoReal(t)),
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

  // Al marcar o desmarcar un tipo se rehacen las cajas de permiso
  $$('input[name="tipo"]').forEach(c => c.addEventListener('change', pintaPermisos));

  $('#archivo').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f || !tipoPidiendoPermiso) return;
    const problema = datos.revisaArchivo(f);
    if (problema) { avisa(problema, 'error'); e.target.value = ''; return; }
    estado.permisos[tipoPidiendoPermiso] = f;
    refrescaCajaPermiso(tipoPidiendoPermiso);
    tipoPidiendoPermiso = null;
  });

  $('#btnAdjuntarLugar').addEventListener('click', () => $('#archivoLugar').click());
  $('#archivoLugar').addEventListener('change', (e) => {
    const f = e.target.files[0];
    const problema = datos.revisaArchivo(f);
    if (problema) { avisa(problema, 'error'); e.target.value = ''; return; }
    estado.archivoLugar = f;
    marcaAdjuntoLugar(f);
  });

  // Foto del lugar desde la ficha
  $('#btnElegirLugar').addEventListener('click', () => $('#archivoLugarFicha').click());
  $('#archivoLugarFicha').addEventListener('change', (e) => {
    const f = e.target.files[0];
    const problema = datos.revisaArchivo(f);
    if (problema) { avisa(problema, 'error'); e.target.value = ''; return; }
    estado.archivoLugarFicha = f;
    marcaCaja('#cajaLugarFicha', '#textoLugarFicha', '#btnElegirLugar', f, '');
  });
  $('#btnGuardarLugar').addEventListener('click', guardaFotoLugar);

  // Filtro por empresa
  $('#selEmpresa').addEventListener('change', (e) => {
    estado.empresa = e.target.value;
    dibujaTodo();
  });
  $('#btnQuitarEmpresa').addEventListener('click', () => {
    estado.empresa = '';
    dibujaTodo();
  });

  // Filtro por prueba de comunicación
  $$('#filtrosRadio .filtro-radio').forEach(b => {
    b.addEventListener('click', () => {
      estado.radio = b.dataset.radio;
      $$('#filtrosRadio .filtro-radio').forEach(o =>
        o.setAttribute('aria-pressed', String(o === b)));
      dibujaTodo();
    });
  });

  // Filtros de la vista Sala
  ['#salaTipo', '#salaEmpresa', '#salaRadio'].forEach(sel =>
    $(sel).addEventListener('change', () => pintaSala(visiblesEnMapa())));
  $('#salaArea').addEventListener('input', () => pintaSala(visiblesEnMapa()));
  $('#salaLimpiar').addEventListener('click', () => {
    $('#salaTipo').value = ''; $('#salaEmpresa').value = '';
    $('#salaRadio').value = ''; $('#salaArea').value = '';
    pintaSala(visiblesEnMapa());
  });

  // Sección de finalizados
  $('#btnFinalizados').addEventListener('click', () => {
    const cuerpo = $('#cuerpoFinalizados');
    const abierta = cuerpo.hidden;
    cuerpo.hidden = !abierta;
    $('#btnFinalizados').setAttribute('aria-expanded', String(abierta));
  });
  $$('#filtrosFin .filtro').forEach(b => {
    b.addEventListener('click', () => {
      estado.filtroFin = b.dataset.tipo;
      $$('#filtrosFin .filtro').forEach(o => o.setAttribute('aria-pressed', String(o === b)));
      pintaListaFinalizados();
    });
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
      dibujaTodo();
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
      await datos.eliminaTrabajo(t.id, ...permisosDe(t).map(([, p]) => p.path), t.lugar_path);
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

  // Información de relevancia: disponible para todos, con o sin clave
  $('#btnInfo').addEventListener('click', () => abre('veloInfo'));

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
  $('#btnRespaldoFicha').addEventListener('click', respaldoDeFicha);

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
