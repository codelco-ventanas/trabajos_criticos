# Trabajos Críticos · Codelco División Ventanas

Mapa en tiempo real de los trabajos en caliente, en altura y en espacios confinados
que se están ejecutando en la división, pensado para quedar abierto de forma
permanente en una pantalla de la Unidad de Emergencia.

---

## 1. Puesta en marcha en 20 minutos

### Paso 1 · Crear el proyecto en Supabase

1. Entra a [supabase.com](https://supabase.com) y crea un proyecto nuevo.
2. Elige la región **South America (São Paulo)**: es la más cercana a Chile y baja la latencia.
3. Guarda la contraseña de la base de datos que te pide (no la necesitarás para esta app,
   pero sin ella no puedes recuperar el proyecto).

### Paso 2 · Crear las tablas

1. En el menú lateral, **SQL Editor → New query**.
2. Copia y pega **todo** el contenido de `sql/schema.sql`.
3. Presiona **Run**.

Eso crea las tablas, la validación de turnos, la auditoría, las políticas de seguridad,
el bucket de permisos y tres registros de ejemplo.

### Paso 3 · Conectar la aplicación

1. En Supabase ve a **Project Settings → Data API**.
2. Copia la **Project URL** y la clave **anon public**.
3. Abre `js/config.js` y reemplaza los dos valores:

```js
export const SUPABASE = {
  url:     'https://abcdefghijk.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6...'
};
```

La clave `anon` está diseñada para vivir en el navegador: no da acceso administrativo
y sólo permite lo que autoricen las políticas de la base de datos. **Nunca** pongas ahí
la clave `service_role`.

### Paso 4 · Publicar en GitHub Pages

```bash
# En la carpeta del proyecto
git init
git add .
git commit -m "Trabajos Críticos División Ventanas"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/trabajos-criticos.git
git push -u origin main
```

Después, en el repositorio de GitHub:

1. **Settings → Pages**
2. En *Source* elige **Deploy from a branch**
3. Branch: **main**, carpeta: **/ (root)**
4. **Save**

En uno o dos minutos tendrás la URL:
`https://TU-USUARIO.github.io/trabajos-criticos/`

> Si el repositorio es privado, GitHub Pages requiere plan de pago. Con repositorio
> público funciona gratis. Como el código no contiene secretos reales (ver sección 5),
> publicarlo no expone información de la división, pero sí revela la clave de administrador:
> si eso te preocupa, usa Vercel, que sirve repositorios privados gratis.

### Paso 5 · Primera prueba

1. Abre la URL. Deberías ver el plano con tres marcadores de ejemplo.
2. Registra un trabajo de prueba desde tu computador.
3. Abre la misma URL en el celular: el marcador nuevo debe aparecer **solo**, sin recargar.

> **Si ya habías instalado una versión anterior de este sistema**, ejecuta además
> `sql/migracion-purga.sql` en el SQL Editor. Añade el borrado automático de permisos
> sin tocar los datos existentes. En una instalación nueva no hace falta: `schema.sql`
> ya lo incluye todo.

### Paso 6 · Limpiar los datos de ejemplo

Cuando termines de probar, en el SQL Editor:

```sql
delete from public.trabajos where registrado_por = 'Datos de ejemplo';
```

---

## 2. Cómo se usa

**Cualquier persona con la URL puede:** ver el mapa, ver la lista de trabajos activos,
abrir la ficha de un trabajo, ver el permiso y **registrar** un trabajo nuevo.

**Con la clave de administrador** (`codelcoventanas`, botón *Admin*) además se puede:
editar un trabajo, extender su plazo, finalizarlo antes de tiempo y eliminarlo.

### Registrar un trabajo

1. **+ Nuevo trabajo**
2. Elegir el tipo, tocar **Marcar en el plano** y hacer click en el lugar exacto.
3. Completar los datos, adjuntar la foto o PDF del permiso y guardar.

El formulario propone automáticamente la hora de término máxima según el turno.

### Las tres vistas

| Vista | Para qué sirve |
|---|---|
| **Mapa** (inicio) | Operación diaria: dónde hay trabajos y registro de nuevos. |
| **Sala** | Pantalla de la Unidad de Emergencia: cifras grandes, personas expuestas y tabla ordenada por hora de término. |
| **Historial** | Consulta con filtros y exportación a PDF o Excel. |

Además, **Respaldo PDF** descarga en cualquier momento un documento con los trabajos
que hay en el mapa. No requiere clave.

---

## 3. Decisiones técnicas y por qué

### Mapa: Leaflet con `CRS.Simple`

| Alternativa | Evaluación |
|---|---|
| **Leaflet + CRS.Simple** ✅ | 42 KB, sin compilación, zoom y desplazamiento táctil resueltos, agrupación de marcadores con un complemento. Trata la foto como un lienzo plano de 4032×2268 unidades. |
| OpenLayers | Mucho más potente en proyecciones y capas WMS, pero pesa ~700 KB y su API es considerablemente más compleja. Nada de eso se necesita aquí. |
| SVG interactivo | Excelente si tuvieras un plano vectorial con las áreas dibujadas. Con una fotografía no aporta nada y el zoom hay que programarlo a mano. |
| Canvas puro | Habría que escribir zoom, desplazamiento, gestos táctiles y detección de clicks desde cero. Semanas de trabajo para reimplementar Leaflet peor. |
| Google Maps | Requiere tarjeta de crédito y coordenadas geográficas reales. Descartado. |

### El sistema de coordenadas

Las posiciones se guardan **normalizadas entre 0 y 1**, no en píxeles:

- `x = 0` borde izquierdo, `x = 1` borde derecho
- `y = 0` borde superior, `y = 1` borde inferior

Un punto en `x: 0.372, y: 0.395` significa "al 37,2 % del ancho y al 39,5 % del alto",
independientemente de la resolución de la imagen. Esto tiene una consecuencia práctica
importante: **puedes reemplazar la fotografía por una de mayor calidad sin mover ni un
solo marcador**, siempre que conserves el mismo encuadre.

### Base de datos: Supabase

| Alternativa | Evaluación |
|---|---|
| **Supabase** ✅ | Postgres + tiempo real + almacenamiento + autenticación en un solo servicio. Postgres permite hacer las validaciones de turno en el servidor, y las vistas con estado calculado resuelven la finalización automática sin ningún proceso programado. |
| Firebase / Firestore | Funciona, pero el modelo de documentos complica los filtros del historial, las reglas de seguridad son un lenguaje aparte, y desde 2024 Storage exige plan Blaze con tarjeta asociada. |
| Realtime Database | Más simple que Firestore, pero sus consultas son muy limitadas: el historial con seis filtros sería doloroso. |
| PocketBase | Muy bueno y liviano, pero hay que alojarlo uno mismo. No hay opción gratuita de alojamiento permanente confiable, y eso contradice el requisito de costo cero. |

### Alojamiento

**GitHub Pages** es lo que pediste y funciona perfectamente: la aplicación es 100 %
estática y no necesita compilación. La alternativa a considerar es **Vercel**, que
también es gratis, despliega automáticamente en cada `git push`, sirve repositorios
privados y permite variables de entorno reales. Si en algún momento quieres esconder
la clave de administrador del código público, ese es el camino.

### Stack completo

- **Frontend:** HTML, CSS y JavaScript nativo con módulos ES. Sin React, sin Vue, sin
  Vite, sin `npm install`. Un archivo se edita y ya está desplegado. En diez años este
  código seguirá funcionando sin actualizar dependencias.
- **Tipografía:** Barlow y Barlow Semi Condensed, desde Google Fonts.
- **Mapa:** Leaflet 1.9.4 + Leaflet.markercluster 1.5.3, desde CDN.
- **Backend:** Supabase (Postgres 15, Realtime, Storage).

---

## 4. Cómo funciona la finalización automática

Esta parte responde directamente a tu pregunta sobre qué pasa si nadie tiene la
aplicación abierta.

**El estado no se guarda en ninguna parte.** No existe una columna que diga "ACTIVO".
El estado se calcula cada vez que se consulta, comparando la hora actual contra
`inicio` y `termino`:

```
cerrado manualmente          → FINALIZADO
ahora < inicio               → PROGRAMADO
inicio ≤ ahora < termino     → ACTIVO
ahora ≥ termino              → FINALIZADO
```

Como consecuencia:

| Situación | Qué ocurre |
|---|---|
| El usuario cierra el navegador | Nada. El trabajo caduca igual a su hora. |
| Nadie tiene la aplicación abierta | Nada. No hay nada que ejecutar. |
| Se reinicia el computador | Nada. |
| La hora de término pasa de madrugada | El trabajo simplemente ya no aparece la próxima vez que alguien mire. |
| Cae internet en la sala | Al reconectar, la aplicación resincroniza sola. |

No hay tareas programadas que puedan fallar, ni un proceso que deba estar corriendo.
Es la arquitectura más robusta posible para este requisito.

El registro **nunca se borra**: sigue en la base de datos para el historial y las
estadísticas. Sólo deja de mostrarse en el mapa activo.

La pantalla se refresca sola cada 20 segundos para recalcular los estados, y además
recibe los cambios de otros usuarios al instante por WebSocket.

---

## 5. Seguridad: lo que hay y lo que falta

Decidimos en el levantamiento que la aplicación **no tendría inicio de sesión**.
Es importante que sepas exactamente qué implica eso.

### Lo que sí protege el sistema

- Los permisos de trabajo se guardan en un bucket **privado** y se abren con enlaces
  firmados que vencen en una hora. No quedan accesibles por una URL permanente, lo que
  importa porque suelen traer nombres y RUT.
- La regla de los turnos de 12 horas se aplica **en el servidor**. Aunque alguien
  manipule el navegador, Postgres rechaza el registro.
- La auditoría se puede leer y escribir, pero **no modificar ni borrar** desde la
  aplicación. El rastro de quién hizo qué no se puede alterar.
- Las validaciones de campos obligatorios y de coherencia de fechas están duplicadas
  en el navegador y en la base de datos.

### Lo que no protege

La clave de administrador está en `js/config.js`, un archivo que el navegador descarga
y que cualquiera puede leer. Sirve para evitar ediciones accidentales de un operador,
pero no para detener a alguien que quiera hacer daño a propósito: bastaría con abrir el
código fuente. Y como no hay sesión, la base de datos no puede distinguir un
administrador de un operador, así que las políticas permiten borrar a cualquier
conexión que tenga la URL de la aplicación.

En la práctica esto significa: **cualquiera que consiga la dirección de la aplicación
puede borrar todos los trabajos del mapa.**

Mientras la URL circule sólo dentro de la división, el riesgo es bajo. Si algún día
la aplicación queda expuesta, o si simplemente quieres dormir tranquilo, el arreglo es
pequeño y no obliga a rehacer nada.

### Cómo endurecerlo después (30 minutos)

1. En Supabase, **Authentication → Users → Add user**, crea una sola cuenta,
   por ejemplo `emergencias@ventanas.local`, con la contraseña que quieras.
2. Cambia las políticas para que sólo esa sesión pueda modificar:

```sql
drop policy trabajos_edicion on public.trabajos;
drop policy trabajos_borrado on public.trabajos;

create policy trabajos_edicion on public.trabajos
  for update to authenticated using (true) with check (true);

create policy trabajos_borrado on public.trabajos
  for delete to authenticated using (true);
```

3. En `js/app.js`, reemplaza la comparación de texto de la función `entraAdmin()` por
   una llamada real a Supabase:

```js
const { error } = await datos.cliente.auth.signInWithPassword({
  email: 'emergencias@ventanas.local',
  password: $('#claveAdmin').value
});
if (error) { /* mostrar "Clave incorrecta" */ } else { /* activar modo admin */ }
```

Desde ese momento la restricción la aplica Postgres, no el navegador: aunque alguien
lea el código, sin la contraseña correcta el servidor rechaza cualquier borrado.
La experiencia para el operador común no cambia en absoluto.

---

## 6. Costos reales

Todo el proyecto opera en $0. Ahora bien, los planes gratuitos tienen límites concretos,
y conviene saber cuáles son los que realmente podrías tocar.

### Plan gratuito de Supabase (vigente a 2026)

| Recurso | Límite | Tu consumo estimado |
|---|---|---|
| Base de datos | 500 MB | ~1 KB por trabajo. **50 trabajos diarios ≈ 18 MB al año.** Holgadísimo. |
| Almacenamiento de archivos | 1 GB | **Este es el límite real.** Ver abajo. |
| Ancho de banda | 5 GB al mes | La imagen del plano son 1,6 MB, pero se cachea. Los permisos son lo que pesa. |
| Conexiones en tiempo real | 200 simultáneas | Muy por encima de lo que necesitas. |
| Mensajes en tiempo real | 2 millones al mes | Inalcanzable con este volumen. |
| Usuarios | 50.000 al mes | No aplica, no hay sesiones. |
| Proyectos activos | 2 | Suficiente. |

### El almacenamiento, resuelto por la purga automática

Sin purga, 50 trabajos diarios con fotos de 2 MB consumirían 100 MB al día y agotarían
el gigabyte gratuito en unos diez días. Ese era el punto débil del proyecto.

Con la purga activada (ver sección 7) el espacio **deja de crecer**: en cualquier
momento sólo están guardados los permisos de los trabajos vigentes. Con 50 trabajos
simultáneos de 2 MB, eso son unos 100 MB, un décimo del límite gratuito.

El único caso en que igual conviene vigilar es si suben fotos muy pesadas desde
celulares modernos (algunas superan los 5 MB). El sistema rechaza cualquier archivo
sobre 10 MB, así que el techo absoluto está acotado.

### El ancho de banda, ahora el punto a vigilar

Con el almacenamiento controlado, el límite que queda más cerca es el **egreso de
5 GB mensuales**. Lo consumen principalmente dos cosas: la imagen del plano (1,6 MB,
pero el navegador la guarda en caché) y la visualización de los permisos. Si la Unidad
de Emergencia abre unos 30 permisos al día, son unos 1,8 GB al mes. Holgado, pero no
infinito: si el uso crece bastante, este será el primer límite que toques.

Llegado ese punto, el plan Pro cuesta 25 USD al mes, incluye 250 GB de egreso y elimina
de paso la pausa por inactividad.

### La pausa por inactividad

Los proyectos gratuitos de Supabase **se pausan tras 7 días sin actividad** en la base
de datos, y hay que reactivarlos a mano desde el panel. Para una herramienta que se usa
todos los días esto no debería ocurrir nunca, pero tenlo presente si el sistema queda
detenido durante unas vacaciones largas: la primera persona que entre después verá un
error hasta que alguien lo reactive.

### Qué es gratis para siempre

- GitHub Pages con repositorio público: sin límite práctico para este tamaño.
- Leaflet, Leaflet.markercluster y Google Fonts: gratuitos y sin cuota.

---

## 7. Los permisos se borran solos

El sistema es una herramienta **en vivo**: el permiso de trabajo sirve mientras la
actividad está en ejecución. Una vez que termina, el archivo se elimina del
almacenamiento y en el registro queda constancia de que existió y de cuándo se borró.

Esto resuelve de raíz el problema del 1 GB gratuito. Con purga activa, el espacio
ocupado deja de crecer: en todo momento sólo están guardados los permisos de los
trabajos vigentes, que con 50 trabajos diarios son unos 100 MB como máximo.

### Cómo funciona

Cada vez que alguien abre la aplicación —y luego cada 10 minutos mientras siga
abierta— se buscan los trabajos ya terminados que todavía conservan archivo y se
eliminan. Como el sistema se usa a diario, en la práctica la limpieza ocurre sola.

Un detalle técnico que vale la pena conocer: el borrado se hace llamando a la **API de
Storage**, nunca con una consulta SQL. Borrar filas de `storage.objects` con SQL elimina
sólo la ficha del archivo y deja el contenido huérfano dentro del bucket, ocupando
espacio de forma permanente y sin manera de recuperarlo ni de verlo en el panel. Es un
error muy frecuente y aquí está evitado a propósito.

### Conservar el permiso un rato más

Si la Unidad de Emergencia necesita poder revisar el permiso de un trabajo recién
cerrado, dale un margen en `js/config.js`:

```js
export const PURGA = {
  activa: true,
  horasGracia: 4,     // conserva el archivo 4 horas después del término
  cadaMinutos: 10
};
```

Con `activa: false` la purga se desactiva por completo y los permisos se acumulan.

### Si nadie abre la aplicación durante días

Para una herramienta de uso diario la limpieza desde el navegador es suficiente. Si
prefieres que ocurra igual durante una parada de planta o unas vacaciones largas, en
`sql/purga-servidor.sql` está la versión programada en el servidor con `pg_cron`.

Ojo con una cosa antes de instalarla: obliga a guardar la clave `service_role` dentro de
la base de datos (en la bóveda de Supabase, cifrada). Es la clave con permisos totales
sobre el proyecto. El archivo explica el procedimiento paso a paso, pero mi
recomendación es no instalarlo salvo que realmente lo necesites: menos piezas, menos
cosas que pueden salir mal.

---

## 8. Respaldo en PDF

Cualquier persona puede descargar un respaldo, sin clave de administrador.

**Respaldo PDF** (barra superior) genera un documento con los trabajos que hay ahora en
el mapa: cifras de resumen arriba y luego una tabla con tipo, empresa, área, equipo,
actividad, número de personas, supervisor, horario y estado. Incluye también los
programados que aún no comienzan.

Desde el **Historial** hay dos botones más: **PDF** y **CSV**, que exportan los
resultados de la búsqueda con los filtros aplicados. El CSV abre directamente en Excel
con los acentos correctos.

El PDF se genera dentro del navegador, así que no consume nada del plan de Supabase y
funciona igual de bien en el celular.

Un uso práctico: como los permisos se borran al terminar el trabajo, descargar el
respaldo al cierre de cada turno deja constancia en papel de qué se estuvo ejecutando,
sin ocupar almacenamiento.

---

## 9. Cambiar la imagen del plano

1. Deja la imagen nueva en `assets/` (por ejemplo `mapa-ventanas-2027.jpg`).
2. Edita `js/config.js`:

```js
export const MAPA = {
  imagen:  'assets/mapa-ventanas-2027.jpg',
  ancho:   6000,     // ancho real en píxeles
  alto:    3375,     // alto real en píxeles
  version: 'ventanas-aerea-2027'
};
```

**Si el encuadre es el mismo** (misma toma, más resolución), los marcadores existentes
siguen siendo válidos: no hay que hacer nada más.

**Si el encuadre es distinto**, sube el número de `version`. Los trabajos antiguos
quedan marcados con la versión anterior, de modo que en el historial se puede distinguir
qué puntos fueron tomados sobre qué plano. Los trabajos activos en ese momento habrá que
reubicarlos a mano.

### Una nota sobre la fotografía actual

La imagen es una toma aérea **oblicua**, no un plano cenital. Eso trae dos limitaciones
que conviene tener presentes:

- Las naves altas ocultan lo que está detrás. Un trabajo en la cara norte de la nave de
  electrorrefinación no tiene un punto visible donde marcarse.
- La zona del fondo está comprimida por la perspectiva: un centímetro arriba en la
  imagen equivale a muchos más metros que un centímetro abajo.

Por eso los campos **Área** y **Equipo/instalación** son obligatorios y el formulario
insiste en que sean específicos: cuando el punto es ambiguo, el texto es lo que permite
encontrar el trabajo en terreno. Si en el futuro consigues un plano cenital de la
división, cambiarlo es la mejora individual más grande que le puedes hacer a este sistema.

---

## 10. Estructura del proyecto

```
├── index.html              Estructura de la interfaz
├── assets/
│   └── mapa-ventanas.jpg   Fotografía aérea (4032 × 2268)
├── css/
│   └── estilos.css         Todos los estilos
├── js/
│   ├── config.js           ← el único archivo que necesitas editar
│   ├── vigencia.js         Reglas de turno, husos horarios y estados
│   ├── datos.js            Supabase: consultas, tiempo real y archivos
│   ├── mapa.js             Leaflet y marcadores
│   ├── pdf.js              Generación del respaldo en PDF
│   └── app.js              Lógica de la aplicación
└── sql/
    ├── schema.sql          Base de datos completa (instalación nueva)
    ├── migracion-purga.sql Sólo si ya tenías la versión anterior instalada
    └── purga-servidor.sql  Opcional: limpieza programada con pg_cron
```

---

## 11. Preparado para lo que viene

La arquitectura no cierra ninguna de las puertas que mencionaste:

- **Nuevos tipos de trabajo:** agregar la entrada en `TIPOS` (`config.js`) y ampliar el
  `check` de la columna `tipo`. Dos líneas, sin tocar el resto.
- **Estadísticas y tableros:** todos los registros quedan en la base con fecha, tipo,
  empresa, área, supervisor y número de personas. Las consultas de agregación son
  triviales en Postgres.
- **Exportación:** el historial ya exporta a CSV compatible con Excel.
- **Varias divisiones o varios planos:** el campo `mapa_version` ya existe. Bastaría con
  agregar una columna `division` y un selector.
- **Alertas y notificaciones:** Supabase Realtime ya entrega los eventos; sólo falta
  decidir qué hacer con ellos.
- **Riesgos de fatalidad:** una columna más y un campo en el formulario.
- **Integración con sistemas internos:** la API REST de Supabase queda disponible
  automáticamente para cualquier sistema que necesite consultar los trabajos activos.

La auditoría ya está funcionando desde el primer día: cada alta, modificación y cierre
queda registrada con quién, cuándo y qué campos cambiaron, visible en la propia ficha
de cada trabajo.
