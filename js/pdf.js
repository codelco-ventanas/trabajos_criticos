// ============================================================
//  Documentos PDF
//
//  Dos formatos:
//   · pdfDeclaracion  → respaldo de un trabajo recién declarado
//   · pdfHistorial    → listado del historial con sus filtros
//
//  Ambos se generan en el navegador, así que no consumen nada del
//  plan de Supabase y funcionan igual en el celular.
// ============================================================

import { TIPOS, MARCA } from './config.js';
import { partesChile, soloHora, soloFecha } from './vigencia.js';

const dd = (n) => String(n).padStart(2, '0');
const ORDEN = ['caliente', 'altura', 'confinado'];

/** Tipos de la actividad, como lista y en orden estable. */
function tiposDe(t) {
  const l = Array.isArray(t.tipos) && t.tipos.length ? t.tipos : (t.tipo ? [t.tipo] : []);
  return ORDEN.filter(x => l.includes(x));
}

const RGB = {
  caliente:  [255, 79, 59],
  altura:    [255, 176, 32],
  confinado: [49, 182, 242],
  cobre:     [194, 112, 60],
  oscuro:    [17, 29, 40],
  texto:     [26, 32, 40],
  tenue:     [110, 128, 145],
  linea:     [214, 222, 230]
};

// ------------------------------------------------------------
//  Logo
//  Se carga una sola vez y queda en memoria. Si el archivo no
//  existe, los documentos se generan igual, sin logo.
// ------------------------------------------------------------
let logoCache;
async function cargaLogo() {
  if (logoCache !== undefined) return logoCache;
  try {
    const r = await fetch(MARCA.logo, { cache: 'force-cache' });
    if (!r.ok) throw new Error('sin logo');
    const blob = await r.blob();
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
    const medidas = await new Promise((res) => {
      const im = new Image();
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => res(null);
      im.src = dataUrl;
    });
    logoCache = medidas ? { dataUrl, ...medidas } : null;
  } catch {
    logoCache = null;
  }
  return logoCache;
}

// ------------------------------------------------------------
//  Tipografía Montserrat en los PDF
//
//  jsPDF sólo trae Helvetica, Times y Courier. Para que los
//  documentos usen la misma tipografía que la aplicación hay que
//  incrustar los archivos de la fuente. Se cargan una sola vez y
//  quedan en memoria.
//
//  Si por alguna razón no se pudieran cargar, los PDF se generan
//  igual con Helvetica en lugar de fallar.
// ------------------------------------------------------------
const FUENTES = [
  { archivo: 'assets/fuentes/Montserrat-Regular.ttf',  estilo: 'normal' },
  { archivo: 'assets/fuentes/Montserrat-SemiBold.ttf', estilo: 'bold' }
];

let fuentesCache;
async function cargaFuentes() {
  if (fuentesCache !== undefined) return fuentesCache;
  try {
    fuentesCache = await Promise.all(FUENTES.map(async (f) => {
      const r = await fetch(f.archivo, { cache: 'force-cache' });
      if (!r.ok) throw new Error('falta ' + f.archivo);
      const bytes = new Uint8Array(await r.arrayBuffer());
      // Se convierte por tramos: un solo String.fromCharCode con
      // 180.000 argumentos desborda la pila del navegador.
      let binario = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        binario += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      }
      return { ...f, base64: btoa(binario) };
    }));
  } catch {
    fuentesCache = null;
  }
  return fuentesCache;
}

/** Registra Montserrat en el documento y la deja activa. */
async function aplicaFuente(doc) {
  const fuentes = await cargaFuentes();
  if (!fuentes) return 'helvetica';
  try {
    fuentes.forEach((f) => {
      const nombre = f.archivo.split('/').pop();
      doc.addFileToVFS(nombre, f.base64);
      doc.addFont(nombre, 'Montserrat', f.estilo);
    });
    doc.setFont('Montserrat', 'normal');
    return 'Montserrat';
  } catch {
    return 'helvetica';
  }
}

let FUENTE = 'helvetica';   // se resuelve al generar cada documento

function requiereJsPDF() {
  if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
    throw new Error('No se pudo cargar el generador de PDF. Revisa la conexión e inténtalo otra vez.');
  }
  return window.jspdf.jsPDF;
}

function ahoraTexto() {
  const p = partesChile(new Date());
  return {
    largo: `${dd(p.dia)}-${dd(p.mes)}-${p.anio} a las ${dd(p.hora)}:${dd(p.minuto)}`,
    archivo: `${p.anio}${dd(p.mes)}${dd(p.dia)}-${dd(p.hora)}${dd(p.minuto)}`
  };
}

// ------------------------------------------------------------
//  Encabezado institucional
//  Antetítulo y título a la izquierda, logo en la esquina superior
//  derecha, y el aviso de derechos como subtítulo.
// ------------------------------------------------------------
async function encabezado(doc, titulo) {
  const ancho = doc.internal.pageSize.getWidth();
  const alto = 30;

  doc.setFillColor(...RGB.oscuro);
  doc.rect(0, 0, ancho, alto, 'F');
  doc.setFillColor(...RGB.cobre);
  doc.rect(0, alto, ancho, 1.2, 'F');

  let margenTexto = ancho - 16;
  const logo = await cargaLogo();
  if (logo) {
    const altoLogo = 16;
    const anchoLogo = Math.min(52, (logo.w / logo.h) * altoLogo);
    doc.addImage(logo.dataUrl, 'PNG', ancho - 14 - anchoLogo, (alto - altoLogo) / 2,
                 anchoLogo, altoLogo, undefined, 'FAST');
    margenTexto = ancho - 20 - anchoLogo;
  }

  doc.setTextColor(...RGB.cobre);
  doc.setFont(FUENTE, 'bold');
  doc.setFontSize(8);
  doc.text(MARCA.antetitulo.toUpperCase(), 14, 10);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.text(titulo, 14, 18, { maxWidth: margenTexto - 14 });

  doc.setFont(FUENTE, 'normal');
  doc.setFontSize(7);
  doc.setTextColor(158, 176, 192);
  doc.text(MARCA.copyright, 14, 25);

  return alto + 9;
}

function pieDePagina(doc, nota) {
  const paginas = doc.internal.getNumberOfPages();
  const ancho = doc.internal.pageSize.getWidth();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    const alto = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...RGB.linea);
    doc.setLineWidth(0.2);
    doc.line(14, alto - 12, ancho - 14, alto - 12);
    doc.setFont(FUENTE, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...RGB.tenue);
    doc.text(nota, 14, alto - 7.5, { maxWidth: ancho - 60 });
    doc.text(`Página ${i} de ${paginas}`, ancho - 14, alto - 7.5, { align: 'right' });
  }
}

// ============================================================
//  1. Respaldo de una declaración
// ============================================================
export async function pdfDeclaracion(t) {
  const jsPDF = requiereJsPDF();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const ancho = doc.internal.pageSize.getWidth();
  const ahora = ahoraTexto();
  const tipos = tiposDe(t);

  FUENTE = await aplicaFuente(doc);
  let y = await encabezado(doc, 'Respaldo de declaración de trabajo crítico');

  // Una franja por tipo declarado, con su color
  const anchoFranja = (ancho - 28) / tipos.length;
  tipos.forEach((x, i) => {
    doc.setFillColor(...(RGB[x] || RGB.cobre));
    doc.rect(14 + i * anchoFranja, y, anchoFranja, 11, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont(FUENTE, 'bold');
    doc.setFontSize(tipos.length > 2 ? 9 : 11.5);
    doc.text((TIPOS[x]?.nombre || x).toUpperCase(), 14 + i * anchoFranja + 4, y + 7.4,
             { maxWidth: anchoFranja - 8 });
  });
  y += 18;

  doc.setFont(FUENTE, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...RGB.tenue);
  doc.text(`Declaración registrada el ${ahora.largo}.`, 14, y);
  y += 6;

  doc.autoTable({
    startY: y,
    body: [
      ['Empresa', t.empresa],
      ['Área', t.area],
      ['Equipo o instalación', t.equipo],
      ['Descripción de la actividad', t.descripcion],
      ['Número de trabajadores', String(t.n_trabajadores)],
      ['Supervisor responsable', t.supervisor],
      ['Fecha del trabajo', soloFecha(t.inicio)],
      ['Hora de inicio', soloHora(t.inicio)],
      ['Hora de término', soloHora(t.termino)],
      ['Registrado por', t.registrado_por || 'No identificado'],
      ['Ubicación en el plano', `X ${(t.x * 100).toFixed(1)} %   ·   Y ${(t.y * 100).toFixed(1)} %`],
      ['Permisos adjuntos', tipos.map(x => TIPOS[x]?.permiso || x).join('\n')],
      ['Identificador del registro', t.id]
    ],
    theme: 'grid',
    styles: {
      font: FUENTE, fontSize: 9.5, cellPadding: 3,
      textColor: RGB.texto, lineColor: RGB.linea, lineWidth: 0.15,
      overflow: 'linebreak', valign: 'middle'
    },
    columnStyles: {
      0: { cellWidth: 58, fillColor: [244, 247, 250], textColor: RGB.tenue,
           fontStyle: 'bold', fontSize: 8.5 },
      1: { cellWidth: 'auto' }
    },
    margin: { left: 14, right: 14, top: 40 }
  });

  y = doc.lastAutoTable.finalY + 16;
  doc.setDrawColor(...RGB.linea);
  doc.setLineWidth(0.3);
  doc.line(14, y, 90, y);
  doc.setFont(FUENTE, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...RGB.tenue);
  doc.text('Firma del supervisor responsable', 14, y + 5);

  pieDePagina(doc, 'Documento de respaldo de la declaración. No reemplaza al permiso de trabajo.');
  doc.save(`declaracion-trabajo-critico-${ahora.archivo}.pdf`);
}

// ============================================================
//  2. Historial filtrado
// ============================================================
export async function pdfHistorial(trabajos, filtros = []) {
  const jsPDF = requiereJsPDF();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const ancho = doc.internal.pageSize.getWidth();
  const ahora = ahoraTexto();

  FUENTE = await aplicaFuente(doc);
  let y = await encabezado(doc, 'Historial de trabajos críticos');

  // Los filtros quedan escritos en el documento: sin esto, el PDF
  // impreso no dice a qué universo de datos corresponde.
  const altoCaja = 20;
  doc.setFillColor(246, 248, 250);
  doc.setDrawColor(...RGB.linea);
  doc.setLineWidth(0.2);
  doc.rect(14, y, ancho - 28, altoCaja, 'FD');

  doc.setFont(FUENTE, 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...RGB.cobre);
  doc.text('FILTROS APLICADOS', 18, y + 6);

  const visibles = filtros.slice(0, 5);
  const anchoCol = (ancho - 36) / Math.max(visibles.length, 1);
  visibles.forEach((f, i) => {
    const x = 18 + i * anchoCol;
    doc.setFont(FUENTE, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...RGB.tenue);
    doc.text(f.k, x, y + 11.5);
    doc.setFont(FUENTE, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...RGB.texto);
    doc.text(String(f.v), x, y + 16.5, { maxWidth: anchoCol - 4 });
  });
  y += altoCaja + 7;

  const personas = trabajos.reduce((s, t) => s + (t.n_trabajadores || 0), 0);
  doc.setFont(FUENTE, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...RGB.tenue);
  doc.text(
    `${trabajos.length} ${trabajos.length === 1 ? 'trabajo registrado' : 'trabajos registrados'}` +
    `   ·   ${personas} ${personas === 1 ? 'persona involucrada' : 'personas involucradas'}` +
    `   ·   documento generado el ${ahora.largo}`, 14, y);
  y += 5;

  doc.autoTable({
    startY: y,
    head: [['Fecha', 'Inicio', 'Término', 'Tipo', 'Empresa',
            'Área / equipo', 'Actividad', 'Pers.', 'Supervisor']],
    body: trabajos.map(t => ([
      soloFecha(t.inicio),
      soloHora(t.inicio),
      soloHora(t.termino),
      tiposDe(t).map(x => TIPOS[x]?.corto || x).join('\n'),
      t.empresa || '',
      `${t.area || ''}\n${t.equipo || ''}`,
      t.descripcion || '',
      String(t.n_trabajadores ?? ''),
      t.supervisor || ''
    ])),
    theme: 'grid',
    styles: {
      font: FUENTE, fontSize: 8, cellPadding: 2.2,
      textColor: RGB.texto, lineColor: RGB.linea, lineWidth: 0.15,
      overflow: 'linebreak', valign: 'middle'
    },
    headStyles: { fillColor: [238, 242, 246], textColor: RGB.tenue,
                  fontStyle: 'bold', fontSize: 7.8 },
    alternateRowStyles: { fillColor: [250, 251, 252] },
    columnStyles: {
      0: { cellWidth: 21, halign: 'center' },
      1: { cellWidth: 15, halign: 'center' },
      2: { cellWidth: 16, halign: 'center' },
      3: { cellWidth: 20, fontStyle: 'bold' },
      4: { cellWidth: 40 },
      5: { cellWidth: 44 },
      6: { cellWidth: 'auto' },
      7: { cellWidth: 12, halign: 'center' },
      8: { cellWidth: 33 }
    },
    didParseCell: (d) => {
      // Con un solo tipo se colorea el texto; con varios se deja neutro
      // porque un color no puede representar a dos.
      if (d.section !== 'body' || d.column.index !== 3) return;
      const tipos = tiposDe(trabajos[d.row.index] || {});
      if (tipos.length === 1 && RGB[tipos[0]]) d.cell.styles.textColor = RGB[tipos[0]];
    },
    margin: { left: 14, right: 14, top: 40 }
  });

  pieDePagina(doc, 'Historial de trabajos críticos. Los permisos de trabajo se eliminan al finalizar cada actividad.');
  doc.save(`historial-trabajos-criticos-${ahora.archivo}.pdf`);
}
