// ============================================================
//  Mapa interactivo
//
//  Se usa Leaflet con CRS.Simple: en lugar de latitud y longitud
//  reales, el plano de la división se trata como un lienzo plano
//  de 4032 x 2268 unidades. Encima se dibuja la fotografía aérea
//  como una sola capa de imagen.
//
//  Las coordenadas viajan a la base de datos normalizadas (0 a 1),
//  no en píxeles, de modo que un mismo punto significa el mismo
//  lugar para todos los usuarios y sigue siendo válido si mañana
//  reemplazas la imagen por una de mayor resolución.
// ============================================================

import { MAPA, TIPOS } from './config.js';
import { estadoDe } from './vigencia.js';

let mapa;
let grupo;                 // agrupador de marcadores
let marcadores = new Map(); // id -> marcador
let marcadorProvisional;   // el punto que se está eligiendo
let alElegirPunto = null;  // callback del modo "elegir ubicación"
let alAbrirTrabajo = null;
let seMovioElUsuario = false;
let conjuntoDibujado = null;   // qué marcadores están puestos ahora

const limites = [[0, 0], [MAPA.alto, MAPA.ancho]];

const aLatLng = (x, y) => [(1 - y) * MAPA.alto, x * MAPA.ancho];
const aNormalizado = (latlng) => ({
  x: Math.min(1, Math.max(0, latlng.lng / MAPA.ancho)),
  y: Math.min(1, Math.max(0, 1 - latlng.lat / MAPA.alto))
});

export function iniciaMapa({ alSeleccionar }) {
  alAbrirTrabajo = alSeleccionar;

  mapa = L.map('mapa', {
    crs: L.CRS.Simple,
    // Los límites de zoom DEBEN ser enteros. El agrupador de
    // marcadores construye un índice interno por nivel de zoom
    // recorriendo de mínimo a máximo; con límites fraccionarios ese
    // índice queda desalineado con el nivel actual y sencillamente
    // descarta marcadores, dejando el mapa incompleto o vacío tras
    // cambiar de filtro. El zoom en uso sí puede ser fraccionario.
    minZoom: -8,
    maxZoom: 2,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 140,
    attributionControl: false,
    zoomControl: false,
    maxBounds: limites,
    maxBoundsViscosity: 0.9,
    doubleClickZoom: false
  });

  L.imageOverlay(MAPA.imagen, limites, { className: 'plano-base' }).addTo(mapa);
  fijaZoomMinimo();
  encuadraInicial();

  // Leaflet necesita saber el tamaño real del contenedor. Al girar el
  // teléfono o al cambiar el tamaño de la ventana hay que recalcularlo,
  // o el plano queda descuadrado o directamente en negro.
  const recalcula = () => {
    mapa.invalidateSize({ animate: false });
    if (!seMovioElUsuario) encuadraInicial();
  };
  setTimeout(recalcula, 60);
  setTimeout(recalcula, 400);
  window.addEventListener('resize', recalcula);
  window.addEventListener('orientationchange', () => setTimeout(recalcula, 250));
  mapa.on('zoomstart dragstart', () => { seMovioElUsuario = true; });

  L.control.zoom({ position: 'bottomright' }).addTo(mapa);

  creaGrupo();

  mapa.on('click', (e) => {
    if (!alElegirPunto) return;
    ponProvisional(e.latlng);
    alElegirPunto(aNormalizado(e.latlng));
  });

  return mapa;
}

// ------------------------------------------------------------
//  Modo "elegir ubicación"
// ------------------------------------------------------------
export function activaSeleccion(callback) {
  alElegirPunto = callback;
  document.getElementById('mapa').classList.add('eligiendo');
}

export function cancelaSeleccion() {
  alElegirPunto = null;
  document.getElementById('mapa').classList.remove('eligiendo');
  quitaProvisional();
}

function ponProvisional(latlng) {
  quitaProvisional();
  marcadorProvisional = L.marker(latlng, {
    icon: L.divIcon({
      className: 'marcador-envoltorio',
      html: '<div class="marcador provisional"><span>+</span></div>',
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    }),
    zIndexOffset: 1000,
    interactive: false
  }).addTo(mapa);
}

export function quitaProvisional() {
  if (marcadorProvisional) {
    mapa.removeLayer(marcadorProvisional);
    marcadorProvisional = null;
  }
}

/** Muestra el punto de un trabajo que se está editando. */
export function muestraProvisionalEn(x, y) {
  ponProvisional(L.latLng(...aLatLng(x, y)));
}

// ------------------------------------------------------------
//  Marcadores de trabajos
// ------------------------------------------------------------
const DURACION_ONDA = 2600;   // debe coincidir con la animación del CSS

/** Firma visual del marcador: si no cambia, no hace falta reconstruirlo. */
const firmaDe = (t) => `${t.tipo}|${estadoDe(t)}`;

function iconoDeTrabajo(trabajo) {
  const t = TIPOS[trabajo.tipo];
  const estado = estadoDe(trabajo);
  // Retardo negativo para que todas las ondas latan en fase, sin
  // importar en qué momento se creó cada marcador. Sin esto, cada
  // marcador empieza su ciclo cuando nace y parecen parpadear en
  // desorden, uno tras otro.
  const fase = -((Date.now() % DURACION_ONDA) / 1000).toFixed(2);
  return L.divIcon({
    className: 'marcador-envoltorio',
    html: `<div class="marcador ${trabajo.tipo} ${estado.toLowerCase()}"
                style="--tono:${t.color}; --fase:${fase}s">
             <i class="icono-tipo ${trabajo.tipo}"></i>
           </div>`,
    iconSize: [33, 33],
    iconAnchor: [16, 16]
  });
}

/** Crea el agrupador de marcadores desde cero.
 *
 *  El agrupador mantiene un índice interno por nivel de zoom. Con
 *  CRS.Simple los zooms son negativos y fraccionarios, y ese índice se
 *  desordena al mezclar altas y bajas: el síntoma es que tras cambiar
 *  de filtro el mapa queda vacío. Rehacerlo entero cuando cambia el
 *  conjunto visible evita el problema de raíz, y con las decenas de
 *  marcadores de una jornada el costo es imperceptible.
 */
function creaGrupo() {
  if (grupo) mapa.removeLayer(grupo);
  grupo = L.markerClusterGroup({
    maxClusterRadius: 44,
    spiderfyDistanceMultiplier: 1.6,
    showCoverageOnHover: false,
    animate: false,
    iconCreateFunction: iconoDeGrupo
  });
  mapa.addLayer(grupo);
}

function iconoDeGrupo(grupoMarcadores) {
  const hijos = grupoMarcadores.getAllChildMarkers();
  const cuenta = { caliente: 0, altura: 0, confinado: 0 };
  hijos.forEach(m => { cuenta[m.options.tipoTrabajo] = (cuenta[m.options.tipoTrabajo] || 0) + 1; });
  const total = hijos.length;
  // El color del anillo refleja la proporción de cada tipo dentro del grupo
  let inicio = 0;
  const tramos = Object.entries(cuenta)
    .filter(([, n]) => n > 0)
    .map(([tipo, n]) => {
      const fin = inicio + (n / total) * 360;
      const tramo = `${TIPOS[tipo].color} ${inicio}deg ${fin}deg`;
      inicio = fin;
      return tramo;
    }).join(', ');
  return L.divIcon({
    className: 'grupo-envoltorio',
    html: `<div class="grupo" style="--anillo:conic-gradient(${tramos})">
             <b>${total}</b>
           </div>`,
    iconSize: [42, 42]
  });
}

export function pintaTrabajos(trabajos) {
  // 1. Crear o actualizar los objetos marcador. Se conservan entre
  //    redibujos para no reiniciar la animación sin motivo.
  trabajos.forEach((t) => {
    const existente = marcadores.get(t.id);
    if (existente) {
      existente.setLatLng(aLatLng(t.x, t.y));
      const firma = firmaDe(t);
      if (existente._firma !== firma) {
        existente.setIcon(iconoDeTrabajo(t));
        existente._firma = firma;
      }
      existente.options.tipoTrabajo = t.tipo;
      existente.trabajo = t;
    } else {
      const m = L.marker(aLatLng(t.x, t.y), {
        icon: iconoDeTrabajo(t),
        tipoTrabajo: t.tipo,
        riseOnHover: true
      });
      m.trabajo = t;
      m._firma = firmaDe(t);
      m.on('click', () => alAbrirTrabajo?.(m.trabajo.id));
      marcadores.set(t.id, m);
    }
  });

  // 2. Olvidar los que ya no vienen en los datos
  const vigentes = new Set(trabajos.map((t) => t.id));
  [...marcadores.keys()].forEach((id) => {
    if (!vigentes.has(id)) marcadores.delete(id);
  });

  // 3. Si el conjunto visible cambió, se rehace el agrupador entero.
  //
  //    Mezclar altas y bajas en una misma operación deja al agrupador
  //    en un estado inconsistente: se ha visto que el mapa queda vacío
  //    tras cambiar de filtro. Vaciar y rearmar es algo más costoso,
  //    pero el resultado es siempre exactamente lo que corresponde
  //    mostrar. Con decenas de marcadores el costo es imperceptible.
  const firmaConjunto = trabajos.map((t) => t.id).sort().join(',');
  if (firmaConjunto === conjuntoDibujado) return;
  conjuntoDibujado = firmaConjunto;

  creaGrupo();
  if (marcadores.size) grupo.addLayers([...marcadores.values()]);
  requestAnimationFrame(sincronizaOndas);
}

/** Pone a todos los marcadores en el mismo punto del ciclo de la onda.
 *  Se llama tras rearmar el agrupador, porque al recrearse los
 *  elementos cada uno empezaría su animación por su cuenta y
 *  parpadearían en desorden, uno tras otro. */
function sincronizaOndas() {
  const fase = `${-((Date.now() % DURACION_ONDA) / 1000).toFixed(2)}s`;
  document.querySelectorAll('.leaflet-marker-pane .marcador')
    .forEach((el) => el.style.setProperty('--fase', fase));
}

/** Centra la vista en un trabajo y lo hace destellar. */
export function enfoca(id) {
  const m = marcadores.get(id);
  if (!m) return;
  const ir = () => {
    mapa.setView(m.getLatLng(), Math.max(mapa.getZoom(), -1.5), { animate: true });
    const el = m.getElement();
    if (el) {
      el.classList.remove('destacado');
      void el.offsetWidth;          // reinicia la animación
      el.classList.add('destacado');
    }
  };
  // Si está dentro de un grupo, primero hay que abrirlo
  if (grupo.hasLayer(m)) grupo.zoomToShowLayer(m, ir);
  else ir();
}

/** Zoom que hace caber el plano completo en el espacio disponible. */
function zoomQueMuestraTodo() {
  const t = mapa.getSize();
  if (!t.x || !t.y) return null;
  return Math.min(Math.log2(t.x / MAPA.ancho), Math.log2(t.y / MAPA.alto));
}

/** El zoom mínimo se fija UNA sola vez y no se vuelve a tocar.
 *
 *  Cambiarlo en caliente rompe el agrupador de marcadores: mantiene
 *  una rejilla interna por cada nivel de zoom, y al mover el mínimo
 *  esas rejillas quedan descolocadas. A partir de ahí, quitar un
 *  marcador lanza un error y el mapa deja de responder a los filtros.
 *  El margen extra permite que el plano siga cabiendo aunque después
 *  se despliegue la hoja inferior y el mapa se achique. */
function fijaZoomMinimo() {
  const base = zoomQueMuestraTodo();
  if (base !== null) mapa.setMinZoom(Math.floor(base) - 1);
}

/** Encuadre de partida: el plano completo siempre visible.
 *  Se descartó recortar la imagen para que llenara la pantalla, porque
 *  eso dejaba fuera de vista los marcadores de los extremos, y en una
 *  emergencia un punto que no se ve es un punto que no existe. */
function encuadraInicial() {
  const verTodo = zoomQueMuestraTodo();
  if (verTodo === null) return;
  const z = Math.max(verTodo, mapa.getMinZoom());
  mapa.setView([MAPA.alto / 2, MAPA.ancho / 2], z, { animate: false });
}

/** Recalcula el tamaño del mapa cuando el espacio disponible cambia,
 *  por ejemplo al desplegar la hoja inferior en el celular. */
export function ajustaTamano() {
  if (!mapa) return;
  mapa.invalidateSize({ animate: false });
  if (!seMovioElUsuario) encuadraInicial();
}

export function encuadraTodo() {
  seMovioElUsuario = false;
  encuadraInicial();
}

export function refrescaIconos(trabajos) {
  trabajos.forEach((t) => {
    const m = marcadores.get(t.id);
    if (!m) return;
    m.trabajo = t;
    const firma = firmaDe(t);
    if (m._firma !== firma) { m.setIcon(iconoDeTrabajo(t)); m._firma = firma; }
  });
}

export const utilidades = { aLatLng, aNormalizado };
