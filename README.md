# Tablero estadístico del TSJ Chihuahua: demo pública

**Demo en línea: [franky-xing.github.io/demo-statistics-website](https://franky-xing.github.io/demo-statistics-website/)**

Demo pública del prototipo del tablero estadístico del **Poder Judicial del Estado de Chihuahua (TSJ)**. Cubre los juzgados en materia Civil, Familiar y Mercantil, con:
- **Indicadores:** Recibidos, Terminados, Sentencias, Audiencias celebradas, Apelaciones admitidas y tasa de resolución.
- **Filtros:** materia, distrito judicial, juzgado, año y mes.
- **Gráficas:** evolución anual, distribución por materia o por tipo, promedios mensuales y volumen por distrito o por juzgado.
- **Tabla de resumen:** agrupada por juzgado, con ordenamiento y exportación a CSV y Excel.

## Sin datos incluidos

La demo se publica **sin datos**. Tú cargas un archivo de Excel y se procesa **completamente en tu navegador**: no se sube ni se guarda nada, y al recargar la página los datos se borran.

## Pruébala

1. Descarga el archivo de ejemplo [`BASE_DEMO_FICTICIA.xlsx`](https://franky-xing.github.io/demo-statistics-website/samples/BASE_DEMO_FICTICIA.xlsx).
2. Abre la [demo](https://franky-xing.github.io/demo-statistics-website/) y haz clic en **Cargar Excel**.
3. Elige el archivo y espera unos segundos.

El archivo de ejemplo contiene **datos ficticios**: todas las cifras son aleatorias y no reflejan la actividad real de los juzgados. Los distritos Arteaga y Rayón están vacíos a propósito, para mostrar el interruptor **"Mostrar distritos sin datos"** de la barra de filtros.

## Usar tu propio archivo

La página lee:
- **La hoja de datos:** la primera hoja cuyo nombre contenga `dashboar`; si no existe, la primera con columnas `Tipo` y `Resultado`.
- **Estas columnas:** `MATERIA`, `Distrito`, `Juzgado/Tribunal`, `Cve_acuerdo`, `Anio`, `Mes`, `Tipo` y `Resultado`. No importan las mayúsculas ni los acentos en los nombres de las columnas.

El archivo de ejemplo muestra el formato exacto.

## Cómo se actualiza este repositorio

Los archivos del sitio en la rama `gh-pages` se **generan automáticamente** desde el repositorio privado de desarrollo cada vez que se publica una nueva versión (release) allí, y GitHub Pages sirve esa rama.

- No edites `gh-pages` a mano: la siguiente versión reemplaza sus archivos.
- La rama `main` sólo contiene este README y la licencia.

## Estado y tecnología

Es un **prototipo**: HTML y JavaScript con Tailwind CSS, Chart.js y SheetJS, cargados desde CDN. La versión final se construirá con Next.js y un backend propio.

## Licencia

Copyright (c) 2026 Poder Judicial del Estado de Chihuahua. Todos los derechos reservados.

Puedes ver el código y usar la demo en línea; cualquier otro uso requiere autorización por escrito del Poder Judicial del Estado de Chihuahua. El nombre y el escudo del Poder Judicial no se licencian con el código. Consulta [LICENSE](LICENSE).
