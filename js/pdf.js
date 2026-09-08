// ============================================================
//  Respaldo en PDF
//
//  Genera un documento imprimible con los trabajos que se le
//  entreguen. Se usa para dos cosas: el respaldo de lo que hay
//  ahora en el mapa, y la exportación del historial filtrado.
//
//  Se genera íntegramente en el navegador (jsPDF), así que no
//  consume nada del plan gratuito de Supabase ni necesita
//  servidor.
// ============================================================

import { TIPOS } from './config.js';
import { estadoDe, partesChile } from './vigencia.js';

const dd = (n) => String(n).padStart(2, '0');

/** "07-09\n19:34" — la fecha importa en un respaldo, porque los turnos
 *  de noche cruzan la medianoche y la hora sola sería ambigua. */
function fechaCompacta(iso) {
  const p = partesChile(new Date(iso));
  return `${dd(p.dia)}-${dd(p.mes)}\n${dd(p.hora)}:${dd(p.minuto)}`;
}

/** Colores en RGB, porque jsPDF no entiende hexadecimal. */
const RGB = {
  caliente:  [255, 79, 59],
  altura:    [255, 176, 32],
  confinado: [49, 182, 242],
  cobre:     [194, 112, 60],
  texto:     [26, 32, 40],
  tenue:     [110, 128, 145],
  linea:     [214, 222, 230]
};

function listo() {
  return typeof window.jspdf !== 'undefined' && window.jspdf.jsPDF;
}

/**
 * @param {Array}  trabajos  registros a incluir
 * @param {Object} opciones  { titulo, subtitulo, nombreArchivo, conResumen }
 */
export function generaPDF(trabajos, opciones = {}) {
  if (!listo()) {
    throw new Error('No se pudo cargar el generador de PDF. Revisa la conexión e inténtalo otra vez.');
  }

  const {
    titulo = 'Trabajos críticos activos',
    subtitulo = null,
    nombreArchivo = 'trabajos-criticos',
    conResumen = true
  } = opciones;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const ancho = doc.internal.pageSize.getWidth();

  const p = partesChile(new Date());
  const generado = `${dd(p.dia)}-${dd(p.mes)}-${p.anio} a las ${dd(p.hora)}:${dd(p.minuto)}`;

  // ---------------- Encabezado ----------------
  doc.setFillColor(...RGB.texto);
  doc.rect(0, 0, ancho, 22, 'F');
  doc.setFillColor(...RGB.cobre);
  doc.rect(0, 22, ancho, 1.2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(titulo, 14, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(198, 210, 222);
  doc.text('Codelco  ·  División Ventanas', 14, 17.5);
  doc.text(`Documento generado el ${generado}`, ancho - 14, 17.5, { align: 'right' });

  let y = 32;

  // ---------------- Resumen ----------------
  if (conResumen) {
    const cuenta = { caliente: 0, altura: 0, confinado: 0 };
    let personas = 0;
    trabajos.forEach(t => { cuenta[t.tipo]++; personas += t.n_trabajadores || 0; });

    const bloques = [
      { n: trabajos.length, r: trabajos.length === 1 ? 'trabajo' : 'trabajos', color: RGB.cobre },
      { n: cuenta.caliente, r: 'en caliente', color: RGB.caliente },
      { n: cuenta.altura, r: 'en altura', color: RGB.altura },
      { n: cuenta.confinado, r: 'espacio confinado', color: RGB.confinado },
      { n: personas, r: personas === 1 ? 'persona' : 'personas', color: RGB.texto }
    ];

    const anchoBloque = (ancho - 28) / bloques.length;
    bloques.forEach((b, i) => {
      const x = 14 + i * anchoBloque;
      doc.setFillColor(...b.color);
      doc.rect(x, y, 1.4, 15, 'F');
      doc.setTextColor(...RGB.texto);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(19);
      doc.text(String(b.n), x + 5, y + 8);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...RGB.tenue);
      doc.text(b.r, x + 5, y + 13);
    });
    y += 24;
  }

  if (subtitulo) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...RGB.tenue);
    doc.text(subtitulo, 14, y);
    y += 6;
  }

  // ---------------- Tabla ----------------
  if (!trabajos.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...RGB.tenue);
    doc.text('No hay trabajos que registrar en este documento.', 14, y + 6);
  } else {
    const filas = trabajos.map(t => {
      const est = estadoDe(t);
      return [
        TIPOS[t.tipo]?.corto || t.tipo,
        t.empresa || '',
        `${t.area || ''}\n${t.equipo || ''}`,
        t.descripcion || '',
        String(t.n_trabajadores ?? ''),
        t.supervisor || '',
        fechaCompacta(t.inicio),
        fechaCompacta(t.termino),
        est
      ];
    });

    doc.autoTable({
      startY: y,
      head: [['Tipo', 'Empresa', 'Área / equipo', 'Actividad',
              'Pers.', 'Supervisor', 'Inicio', 'Término', 'Estado']],
      body: filas,
      theme: 'grid',
      styles: {
        font: 'helvetica', fontSize: 8, cellPadding: 2.2,
        textColor: RGB.texto, lineColor: RGB.linea, lineWidth: 0.15,
        overflow: 'linebreak', valign: 'middle'
      },
      headStyles: {
        fillColor: [238, 242, 246], textColor: RGB.tenue,
        fontStyle: 'bold', fontSize: 7.8
      },
      alternateRowStyles: { fillColor: [250, 251, 252] },
      columnStyles: {
        0: { cellWidth: 20, fontStyle: 'bold' },
        1: { cellWidth: 42 },
        2: { cellWidth: 45 },
        3: { cellWidth: 'auto' },
        4: { cellWidth: 12, halign: 'center' },
        5: { cellWidth: 34 },
        6: { cellWidth: 17, halign: 'center' },
        7: { cellWidth: 17, halign: 'center', fontStyle: 'bold' },
        8: { cellWidth: 27, halign: 'center', fontSize: 7 }
      },
      // Una franja del color del tipo al inicio de cada fila
      didParseCell: (d) => {
        if (d.section !== 'body' || d.column.index !== 0) return;
        const tipo = trabajos[d.row.index]?.tipo;
        if (RGB[tipo]) d.cell.styles.textColor = RGB[tipo];
      },
      margin: { left: 14, right: 14, top: 28 }
    });
  }

  // ---------------- Pie de página ----------------
  const paginas = doc.internal.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    const alto = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...RGB.linea);
    doc.setLineWidth(0.2);
    doc.line(14, alto - 12, ancho - 14, alto - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...RGB.tenue);
    doc.text('Trabajos Críticos · División Ventanas · documento de respaldo, no reemplaza al permiso de trabajo',
             14, alto - 7.5);
    doc.text(`Página ${i} de ${paginas}`, ancho - 14, alto - 7.5, { align: 'right' });
  }

  const marca = `${p.anio}${dd(p.mes)}${dd(p.dia)}-${dd(p.hora)}${dd(p.minuto)}`;
  doc.save(`${nombreArchivo}-${marca}.pdf`);
}
