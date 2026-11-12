// ============================================================================
// FUNCIONALIDAD / UI — Dashboard Estadístico Judicial (TSJ Chihuahua)
// ----------------------------------------------------------------------------
// Estado de la vista, filtros en cascada, KPIs, tasas, gráficas (Chart.js),
// tabla consolidada, exportaciones (CSV / Excel), carga de Excel y avisos.
//
// Toda la lectura, filtrado y cálculo de datos se delega a `TSJData`
// (js/data-layer.js), que debe cargarse ANTES que este archivo.
// Las funciones de nivel superior son globales porque index.html las invoca
// desde atributos onclick / onchange / oninput.
// ============================================================================

const { DISTRITOS_OFICIALES, MESES_LISTA, MATERIAS } = TSJData;

// Colores del tema dorado para las gráficas. Son los mismos valores que
// tailwind.config en index.html (gold / tsj): si cambias uno, cambia el otro.
const TEMA = {
  fuente: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  tarjeta: '#12141a',     // tsj-card
  rejilla: '#1f2430',
  texto: '#cbd5e1',
  textoSuave: '#94a3b8',
  oro: '#d4af37',         // gold
  oroClaro: '#f5d77f'     // gold-light
};

// ============================================================================
// 1. ESTADO GLOBAL DE LA VISTA
// ============================================================================
let rawDataset = [];
let filteredDataset = [];
let currentPage = 1;
const pageSize = 12;
let tableSearchQuery = '';
// Orden de la tabla: campo de la columna y 'desc' | 'asc'; null = por defecto
let tableSort = { campo: null, direccion: null };
let fuenteDatos = 'Sin datos';

// Instancias de Gráficas Chart.js
let chartEvolucion = null;
let chartMaterias = null;
let chartDistritos = null;
let chartMensual = null;

// Lee los filtros en el formato que espera TSJData: un Set por filtro, o
// null si está todo seleccionado (ver FILTROS en la sección 3)
function leerFiltros() {
  return {
    materias: seleccion('materia'),
    distritos: seleccion('distrito'),
    juzgados: seleccion('juzgado'),
    anios: seleccion('anio'),
    meses: seleccion('mes')
  };
}

// Escapa texto antes de insertarlo con innerHTML (nombres que vienen del Excel)
function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const fmt = n => Number(n || 0).toLocaleString('es-MX');
const fmtK = v => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

// ============================================================================
// 2. AVISOS (TOAST)
// ============================================================================
let toastTimer = null;
function showToast(msg, type = 'success', duracionMs = 5000) {
  const toast = document.getElementById('toastNotification');
  const icon = document.getElementById('toastIcon');
  document.getElementById('toastMessage').textContent = msg;

  const esError = type === 'error';
  toast.classList.toggle('border-rose-500/60', esError);
  toast.classList.toggle('border-gold', !esError);
  icon.className = esError
    ? 'fa-solid fa-triangle-exclamation text-rose-400 text-lg mt-0.5'
    : 'fa-solid fa-circle-check text-gold-light text-lg mt-0.5';

  toast.classList.remove('translate-y-24', 'opacity-0', 'pointer-events-none');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('translate-y-24', 'opacity-0', 'pointer-events-none');
  }, duracionMs);
}

// ============================================================================
// 3. FILTROS DE SELECCIÓN MÚLTIPLE (Materia, Distrito, Juzgado, Año y Meses)
// ----------------------------------------------------------------------------
// Los cinco filtros funcionan igual: un botón con el resumen de lo elegido,
// un menú con casillas, "Seleccionar todos" / "Deseleccionar" y el contador
// "N sel.". Sin nada seleccionado no hay datos. Con todo seleccionado el
// filtro no restringe (leerFiltros entrega null a TSJData).
// El marcado de cada filtro está en index.html con los ids ms<Id>Btn,
// ms<Id>Texto, ms<Id>Conteo, ms<Id>Menu y ms<Id>Lista.
// Un menú con campo ms<Id>Buscar (hoy sólo Juzgado) filtra su lista por texto
// sin importar acentos; mientras hay texto, "Seleccionar todos" /
// "Deseleccionar" actúan sólo sobre los resultados (ids ms<Id>Todos y
// ms<Id>Ninguno). La búsqueda se borra al cerrar el menú.
// ============================================================================
const FILTROS = {
  materia:  { id: 'Materia',  todos: 'Todas las Materias',  ninguno: 'Ninguna Materia', plural: 'Materias',  opciones: [], sel: new Set(), busqueda: '' },
  distrito: { id: 'Distrito', todos: 'Todos los Distritos', ninguno: 'Ningún Distrito', plural: 'Distritos', opciones: [], sel: new Set(), busqueda: '' },
  juzgado:  { id: 'Juzgado',  todos: 'Todos los Juzgados',  ninguno: 'Ningún Juzgado',  plural: 'Juzgados',  opciones: [], sel: new Set(), busqueda: '', altoMax: 320 },
  anio:     { id: 'Anio',     todos: 'Todos los Años',      ninguno: 'Ningún Año',      plural: 'Años',      opciones: [], sel: new Set(), busqueda: '' },
  mes:      { id: 'Mes',      todos: 'Todos los Meses',     ninguno: 'Ningún Mes',      plural: 'Meses',     opciones: [], sel: new Set(), busqueda: '' }
};

const NOMBRE_MATERIA = { CIVIL: 'Civil', MERCANTIL: 'Mercantil', FAMILIAR: 'Familiar' };

function todoSeleccionado(clave) {
  const f = FILTROS[clave];
  return f.opciones.every(o => f.sel.has(o.valor));
}

// Lo que recibe TSJData: null si está todo seleccionado; si no, un Set
function seleccion(clave) {
  return todoSeleccionado(clave) ? null : new Set(FILTROS[clave].sel);
}

// Texto del botón: "Todos los ...", "Ningún ...", la opción elegida o "N ... Sel."
function textoFiltro(clave) {
  const f = FILTROS[clave];
  const elegidas = f.opciones.filter(o => f.sel.has(o.valor));
  if (elegidas.length === f.opciones.length) return f.todos;
  if (elegidas.length === 0) return f.ninguno;
  if (elegidas.length === 1) return elegidas[0].texto;
  return `${elegidas.length} ${f.plural} Sel.`;
}

function actualizarEtiquetaFiltro(clave) {
  const f = FILTROS[clave];
  const n = f.opciones.filter(o => f.sel.has(o.valor)).length;
  document.getElementById(`ms${f.id}Conteo`).textContent = `${n} sel.`;
  document.getElementById(`ms${f.id}Texto`).textContent = textoFiltro(clave);
}

// Opciones que coinciden con la búsqueda del menú (todas si no hay texto)
function opcionesVisibles(clave) {
  const f = FILTROS[clave];
  const q = TSJData.normalizar(f.busqueda);
  return q ? f.opciones.filter(o => TSJData.normalizar(o.texto).includes(q)) : f.opciones;
}

// Casillas del menú (textContent: los nombres pueden venir de un Excel)
function renderFiltro(clave) {
  const f = FILTROS[clave];
  const lista = document.getElementById(`ms${f.id}Lista`);
  if (!lista) return;
  lista.innerHTML = '';

  const buscando = Boolean(f.busqueda.trim());
  const todos = document.getElementById(`ms${f.id}Todos`);
  const ninguno = document.getElementById(`ms${f.id}Ninguno`);
  if (todos) todos.textContent = buscando ? 'Marcar resultados' : 'Seleccionar todos';
  if (ninguno) ninguno.textContent = buscando ? 'Desmarcar resultados' : 'Deseleccionar';

  const visibles = opcionesVisibles(clave);
  if (buscando && visibles.length === 0) {
    const vacio = document.createElement('p');
    vacio.className = 'text-xs text-gray-400 px-1.5 py-1';
    vacio.textContent = 'Sin coincidencias.';
    lista.appendChild(vacio);
  }
  visibles.forEach(o => {
    const label = document.createElement('label');
    label.className = 'flex items-start gap-2 text-xs text-gray-300 hover:text-white cursor-pointer px-1.5 py-1 rounded hover:bg-tsj-line transition';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = f.sel.has(o.valor);
    cb.className = 'mt-0.5 shrink-0 rounded border-tsj-edge bg-tsj-card accent-gold focus:ring-0 focus:ring-offset-0';
    cb.addEventListener('change', () => onFiltroCheck(clave, o.valor, cb.checked));
    const texto = document.createElement('span');
    texto.textContent = o.texto;
    label.append(cb, texto);
    lista.appendChild(label);
  });
  actualizarEtiquetaFiltro(clave);
}

// Cambia las opciones de un filtro conservando lo elegido: si estaba todo
// seleccionado, las opciones nuevas también quedan marcadas; si no, se
// conservan las que siguen existiendo y, si no queda ninguna, vuelve a todo
// (p. ej. al cambiar de distrito con un juzgado de otro distrito elegido).
function definirOpciones(clave, opciones) {
  const f = FILTROS[clave];
  const estabaTodo = f.opciones.length === 0 || todoSeleccionado(clave);
  const valores = opciones.map(o => o.valor);
  const conservadas = valores.filter(v => f.sel.has(v));
  f.opciones = opciones;
  f.sel = new Set(estabaTodo || conservadas.length === 0 ? valores : conservadas);
  renderFiltro(clave);
}

function seleccionarTodo(clave) {
  FILTROS[clave].sel = new Set(FILTROS[clave].opciones.map(o => o.valor));
  renderFiltro(clave);
}

function cerrarMenusFiltro() {
  Object.entries(FILTROS).forEach(([clave, f]) => {
    document.getElementById(`ms${f.id}Menu`)?.classList.add('hidden');
    document.getElementById(`ms${f.id}Btn`)?.setAttribute('aria-expanded', 'false');
    if (f.busqueda) {
      f.busqueda = '';
      const campo = document.getElementById(`ms${f.id}Buscar`);
      if (campo) campo.value = '';
      renderFiltro(clave);
    }
  });
}

// Texto escrito en el buscador de un menú
function buscarEnFiltro(clave, texto) {
  FILTROS[clave].busqueda = texto;
  renderFiltro(clave);
}

// Abre un menú (y cierra los demás). Su alto se limita al espacio visible
// bajo el botón para que en el teléfono no quede cortado.
function toggleFiltroMenu(clave, e) {
  if (e) e.stopPropagation();
  const { id, altoMax = 256 } = FILTROS[clave];
  const menu = document.getElementById(`ms${id}Menu`);
  const btn = document.getElementById(`ms${id}Btn`);
  const abrir = menu.classList.contains('hidden');
  cerrarMenusFiltro();
  if (!abrir) return;
  const espacio = window.innerHeight - btn.getBoundingClientRect().bottom - 12;
  menu.style.maxHeight = `${Math.max(140, Math.min(altoMax, espacio))}px`;
  menu.scrollTop = 0;
  menu.classList.remove('hidden');
  btn.setAttribute('aria-expanded', 'true');
  // Con ratón, el cursor va directo al buscador (en el teléfono no, para no
  // abrir el teclado sobre la lista)
  const buscador = document.getElementById(`ms${id}Buscar`);
  if (buscador && window.matchMedia('(pointer: fine)').matches) buscador.focus();
}

// "Seleccionar todos" / "Deseleccionar". Con texto en el buscador, sólo
// marcan o desmarcan los resultados visibles y dejan el resto como está.
function marcarTodos(clave, marcar) {
  const f = FILTROS[clave];
  if (f.busqueda.trim()) {
    opcionesVisibles(clave).forEach(o => (marcar ? f.sel.add(o.valor) : f.sel.delete(o.valor)));
    renderFiltro(clave);
  } else if (marcar) {
    seleccionarTodo(clave);
  } else {
    f.sel = new Set();
    renderFiltro(clave);
  }
  alCambiarFiltro(clave);
}

function onFiltroCheck(clave, valor, marcado) {
  const f = FILTROS[clave];
  if (marcado) f.sel.add(valor);
  else f.sel.delete(valor);
  actualizarEtiquetaFiltro(clave);
  alCambiarFiltro(clave);
}

// Materia y Distrito cambian la lista de juzgados (cascada)
function alCambiarFiltro(clave) {
  if (clave === 'materia' || clave === 'distrito') actualizarOpcionesJuzgado();
  applyFilters();
}

// ============================================================================
// 4. OPCIONES DE LOS FILTROS (catálogos + valores presentes en la base)
// ============================================================================
// DEMO: interruptor "Mostrar distritos sin datos" (barra de filtros).
// Marcado: el filtro de Distrito lista los 14 distritos oficiales (más los que
// traiga la base) y la gráfica muestra los que están en 0. Desmarcado: los
// distritos sin registros en la base (p. ej. ARTEAGA y RAYÓN) salen del filtro
// de Distrito, y la gráfica oculta además los que quedan en 0 con la
// selección actual.
let mostrarDistritosSinDatos = true;

function opcionesDistrito() {
  const conDatos = new Set(rawDataset.map(r => r.Distrito));
  const extra = [...conDatos].filter(d => !DISTRITOS_OFICIALES.includes(d)).sort();
  return [...DISTRITOS_OFICIALES, ...extra]
    .filter(d => mostrarDistritosSinDatos || conDatos.has(d))
    .map(d => ({ valor: d, texto: d }));
}

function toggleDistritosSinDatos(mostrar) {
  mostrarDistritosSinDatos = mostrar;
  definirOpciones('distrito', opcionesDistrito());
  actualizarOpcionesJuzgado();
  applyFilters();
}

function actualizarOpcionesFiltros() {
  const presentes = (campo, catalogo) =>
    [...new Set(rawDataset.map(r => r[campo]))].filter(v => !catalogo.includes(v)).sort();

  const materias = [...MATERIAS, ...presentes('Materia', MATERIAS)];
  definirOpciones('materia', materias.map(m => ({ valor: m, texto: NOMBRE_MATERIA[m] || m })));

  definirOpciones('distrito', opcionesDistrito());

  // Años del más reciente al más antiguo
  const anios = TSJData.listAnios(rawDataset).reverse();
  definirOpciones('anio', anios.map(a => ({ valor: a, texto: String(a) })));
  definirOpciones('mes', MESES_LISTA.map(m => ({ valor: m, texto: m })));
  actualizarOpcionesJuzgado();
}

// Juzgados de las materias y distritos elegidos. El valor es el JuzgadoId
// (distrito + nombre) porque el mismo nombre existe en varios distritos; si
// hay más de un distrito en juego, el texto lleva el distrito.
function actualizarOpcionesJuzgado() {
  const distritos = seleccion('distrito');
  const juzgados = TSJData.listJuzgados(rawDataset, { materias: seleccion('materia'), distritos });
  const variosDistritos = !distritos || distritos.size !== 1;
  definirOpciones('juzgado', juzgados.map(j => ({
    valor: j.id,
    texto: variosDistritos ? `${j.nombre} — ${j.distrito}` : j.nombre
  })));
}

function resetFilters() {
  // DEMO: Restablecer también vuelve a mostrar los distritos sin datos
  mostrarDistritosSinDatos = true;
  document.getElementById('toggleSinDatos').checked = true;
  definirOpciones('distrito', opcionesDistrito());
  seleccionarTodo('materia');
  seleccionarTodo('distrito');
  actualizarOpcionesJuzgado();
  seleccionarTodo('juzgado');
  seleccionarTodo('anio');
  seleccionarTodo('mes');
  cerrarMenusFiltro();
  const searchInp = document.getElementById('tableSearch');
  if (searchInp) searchInp.value = '';
  tableSearchQuery = '';
  tableSort = { campo: null, direccion: null };
  actualizarIndicadoresOrden();
  applyFilters();
  showToast('Filtros restablecidos.', 'success', 2500);
}

// ============================================================================
// 5. APLICACIÓN DE FILTROS, INDICADORES (KPIs) Y TASAS
// ============================================================================
function applyFilters() {
  filteredDataset = TSJData.filterRecords(rawDataset, leerFiltros());

  currentPage = 1;
  actualizarResumenFiltros();
  updateKPIs();
  renderCharts();
  renderTable();
}

// Filtros plegables en pantallas pequeñas (< lg). En escritorio el panel
// siempre está visible (lg:block) y el botón está oculto (lg:hidden).
function toggleFiltros() {
  const abierto = !document.getElementById('panelFiltros').classList.toggle('hidden');
  document.getElementById('btnToggleFiltros').setAttribute('aria-expanded', String(abierto));
  document.getElementById('iconoFiltros').classList.toggle('rotate-180', abierto);
}

// Resumen de los filtros activos que se ve en el botón con el panel plegado
function actualizarResumenFiltros() {
  const el = document.getElementById('resumenFiltros');
  if (!el) return;
  const partes = Object.keys(FILTROS).filter(c => !todoSeleccionado(c)).map(textoFiltro);
  if (!mostrarDistritosSinDatos) partes.push('Sólo distritos con datos');   // DEMO
  el.textContent = partes.length ? partes.join(' · ') : 'Todos los datos';
}

function setTasa(idTexto, idBarra, valor) {
  document.getElementById(idTexto).textContent = `${valor.toFixed(1)}%`;
  document.getElementById(idBarra).style.width = `${Math.min(100, valor)}%`;
}

function updateKPIs() {
  const sumas = TSJData.sumByCategoria(filteredDataset);
  const totalMeses = TSJData.countActiveMonths(rawDataset, leerFiltros());
  const prom = v => `x̄ ${fmt(TSJData.calcPromedio(v, totalMeses))}/m`;

  document.getElementById('kpiRecibidos').textContent = fmt(sumas.RECIBIDOS);
  document.getElementById('kpiRecibidosProm').textContent = prom(sumas.RECIBIDOS);

  document.getElementById('kpiTerminados').textContent = fmt(sumas.TERMINADOS);
  document.getElementById('kpiTerminadosProm').textContent = prom(sumas.TERMINADOS);

  document.getElementById('kpiSentencias').textContent = fmt(sumas.SENTENCIAS);
  document.getElementById('kpiSentenciasProm').textContent = prom(sumas.SENTENCIAS);

  document.getElementById('kpiAudiencias').textContent = fmt(sumas.AUDIENCIAS);
  document.getElementById('kpiAudienciasProm').textContent = prom(sumas.AUDIENCIAS);

  document.getElementById('kpiApelaciones').textContent = fmt(sumas.APELACIONES);
  document.getElementById('kpiApelacionesProm').textContent = prom(sumas.APELACIONES);

  // Tasas de conclusión
  const tasas = TSJData.calcTasas(sumas);
  document.getElementById('kpiTasa').textContent = `${tasas.resolucion.toFixed(1)}%`;
  document.getElementById('kpiMesesPeriodo').textContent = `${totalMeses} ${totalMeses === 1 ? 'mes' : 'meses'}`;
  setTasa('tasaResolucion', 'barResolucion', tasas.resolucion);
  setTasa('tasaSentencias', 'barSentencias', tasas.sentencias);
  setTasa('tasaApelacion', 'barApelacion', tasas.impugnacion);

  // Resumen del periodo
  document.getElementById('statMesesActivos').textContent = fmt(totalMeses);
  document.getElementById('statTotalRegistros').textContent = fmt(filteredDataset.length);
  const fuenteEl = document.getElementById('statFuente');
  fuenteEl.textContent = fuenteDatos;
  fuenteEl.title = fuenteDatos;
}

// ============================================================================
// 6. GRÁFICAS CHART.JS CON ETIQUETAS DE DATOS
// ============================================================================

// Etiquetas largas del eje Y en la gráfica de distritos / órganos.
// Chart.js limita el eje vertical a la mitad del ancho de la gráfica y corta
// por la izquierda lo que no cabe (p. ej. el Tribunal Especializado de
// MORELOS). Por eso los nombres se parten en líneas que caben en el ancho
// reservado: Chart.js dibuja cada elemento de un arreglo como una línea.
// Máximo 3 líneas; si aún sobra texto, la última termina en "…". El nombre
// completo siempre aparece en el tooltip.
const EJE_FUENTE_PX = 12;
const EJE_LINEA_PX = Math.ceil(EJE_FUENTE_PX * 1.2);   // lineHeight de Chart.js
const EJE_MAX_LINEAS = 3;
const medidorTexto = document.createElement('canvas').getContext('2d');

// Ancho para las etiquetas: 40% de la gráfica, entre 120 y 460 px
function anchoEtiquetasEje(anchoGrafica) {
  return Math.max(120, Math.min(460, anchoGrafica * 0.4));
}

// Parte `texto` por palabras en líneas de hasta `anchoMax` px
function partirEtiqueta(texto, anchoMax, maxLineas = EJE_MAX_LINEAS) {
  medidorTexto.font = `${EJE_FUENTE_PX}px ${TEMA.fuente}`;
  const cabe = t => medidorTexto.measureText(t).width <= anchoMax;
  const lineas = [];
  let actual = '';
  String(texto).split(' ').forEach(palabra => {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (!actual || cabe(prueba)) {
      actual = prueba;
    } else {
      lineas.push(actual);
      actual = palabra;
    }
  });
  if (actual) lineas.push(actual);
  if (lineas.length <= maxLineas) return lineas;

  let ultima = lineas.slice(maxLineas - 1).join(' ');
  while (ultima.length > 1 && !cabe(`${ultima}…`)) ultima = ultima.slice(0, -1);
  return [...lineas.slice(0, maxLineas - 1), `${ultima.trimEnd()}…`];
}

// Cifra de cada barra de distritos / órganos, p. ej. "12,345 (6.7%)"
const VALOR_FUENTE_PX = 10;
function textoValorBarra(val, ctx) {
  if (!val) return '0';
  const total = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
  const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
  return `${fmt(val)} (${pct}%)`;
}

// true si la cifra no cabe a la derecha de la barra (se cortaría en el borde
// del área de barras) pero sí cabe dentro de ella. Usa la posición final de
// la barra, no la de la animación.
function etiquetaDentroDeBarra(ctx) {
  const val = ctx.dataset.data[ctx.dataIndex];
  const x = ctx.chart.scales.x;
  if (!val || !x) return false;
  medidorTexto.font = `600 ${VALOR_FUENTE_PX}px ${TEMA.fuente}`;
  const ancho = medidorTexto.measureText(textoValorBarra(val, ctx)).width + 4;   // + offset
  const finBarra = x.getPixelForValue(val);
  const cabeFuera = finBarra + ancho <= x.right;
  const cabeDentro = finBarra - x.getPixelForValue(0) >= ancho + 4;
  return !cabeFuera && cabeDentro;
}

function initCharts() {
  if (window.ChartDataLabels) {
    Chart.register(ChartDataLabels);
  }
  Chart.defaults.font.family = TEMA.fuente;
  Chart.defaults.color = TEMA.textoSuave;

  const baseOpt = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 20, right: 30, left: 10, bottom: 8 } },
    plugins: {
      legend: { labels: { color: TEMA.texto, font: { size: 11 } } }
    }
  };

  const ejes = {
    x: { ticks: { color: TEMA.textoSuave }, grid: { color: TEMA.rejilla } },
    y: { ticks: { color: TEMA.textoSuave }, grid: { color: TEMA.rejilla } }
  };

  // 1. Evolución anual: Recibidos, Terminados y Sentencias por año
  const ctxEvol = document.getElementById('chartEvolucion').getContext('2d');
  chartEvolucion = new Chart(ctxEvol, {
    type: 'bar',
    data: { labels: [], datasets: [] },
    options: {
      ...baseOpt,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: baseOpt.plugins.legend.labels },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.raw)} asuntos`
          }
        },
        datalabels: {
          color: TEMA.oroClaro,
          anchor: 'end',
          align: 'top',
          offset: 2,
          font: { size: 9, weight: 'bold' },
          formatter: (val) => (val > 0 ? fmtK(val) : '')
        }
      },
      scales: ejes
    }
  });

  // 2. Dona: Carga por Materia, o Distribución por Tipo si hay una sola
  //    materia elegida (los datos y colores se ponen en renderCharts)
  const ctxMat = document.getElementById('chartMaterias').getContext('2d');
  const pctDona = ctx => {
    const total = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
    return total ? (ctx.raw ?? ctx.dataset.data[ctx.dataIndex]) / total * 100 : 0;
  };
  chartMaterias = new Chart(ctxMat, {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 2, borderColor: TEMA.tarjeta }] },
    options: {
      ...baseOpt,
      cutout: '68%',
      plugins: {
        legend: { position: 'bottom', labels: baseOpt.plugins.legend.labels },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${fmt(ctx.raw)} asuntos (${pctDona(ctx).toFixed(1)}%)`
          }
        },
        datalabels: {
          // Texto oscuro sobre los colores claros (amarillo / rosa claro)
          color: (ctx) => (esColorClaro(ctx.dataset.backgroundColor[ctx.dataIndex]) ? TEMA.tarjeta : '#ffffff'),
          font: { size: 11, weight: 'bold' },
          // En la vista por Tipo sólo se rotulan las rebanadas de 5% o más
          // (las chicas se ven en la lista de abajo y en el tooltip)
          formatter: (value, ctx) => {
            const pct = pctDona(ctx);
            if (!value || pct < (modoDona === 'tipo' ? 5 : 0.05)) return '';
            return `${pct.toFixed(1)}%`;
          }
        }
      }
    }
  });

  // 3. Comportamiento mensual (promedio por mes de los años filtrados)
  const ctxMen = document.getElementById('chartMensual').getContext('2d');
  chartMensual = new Chart(ctxMen, {
    type: 'line',
    data: { labels: MESES_LISTA.map(m => m.substring(0, 3)), datasets: [] },
    options: {
      ...baseOpt,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: baseOpt.plugins.legend.labels },
        tooltip: {
          callbacks: {
            label: (ctx) => (ctx.raw === null ? ` ${ctx.dataset.label}: sin datos` : ` ${ctx.dataset.label}: ${fmt(Math.round(ctx.raw))} asuntos`)
          }
        },
        datalabels: {
          align: 'top',
          offset: 4,
          color: (ctx) => ctx.dataset.borderColor,
          font: { size: 9, weight: 'bold' },
          formatter: (val) => (val > 0 ? fmtK(val) : '')
        }
      },
      scales: ejes
    }
  });

  // 4. Distribución Territorial por Distritos
  const ctxDist = document.getElementById('chartDistritos').getContext('2d');
  chartDistritos = new Chart(ctxDist, {
    type: 'bar',
    data: { labels: [], datasets: [] },
    options: {
      ...baseOpt,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            // Nombre completo, en varias líneas si es largo
            title: (items) => (items.length ? partirEtiqueta(items[0].label, 280, Infinity) : ''),
            label: (ctx) => ` ${fmt(ctx.raw)} asuntos acumulados`
          }
        },
        // Cifra y % a la derecha de la barra; si no cabe (barra muy larga en
        // pantallas angostas), dentro de la barra con texto oscuro. clip:
        // recorta al área de barras (mientras la barra crece, la cifra de
        // adentro no se encima en los nombres del eje).
        datalabels: {
          clip: true,
          anchor: 'end',
          align: ctx => (etiquetaDentroDeBarra(ctx) ? 'left' : 'right'),
          color: ctx => (etiquetaDentroDeBarra(ctx) ? TEMA.tarjeta : TEMA.texto),
          offset: 4,
          font: { size: VALOR_FUENTE_PX, weight: '600' },
          formatter: (val, ctx) => textoValorBarra(val, ctx)
        }
      },
      scales: {
        // grace: espacio extra a la derecha para que la cifra y el % de la
        // barra más larga no queden cortados. Chart.js aplica el porcentaje
        // sobre la MITAD del rango de datos: '40%' = 20% más sobre el máximo.
        x: { grace: '40%', ticks: { color: TEMA.textoSuave }, grid: { color: TEMA.rejilla } },
        y: {
          grid: { display: false },
          ticks: {
            color: TEMA.texto,
            autoSkip: false,
            font: { size: EJE_FUENTE_PX },
            // `this` es la escala; devuelve el nombre partido en líneas
            callback(valor) {
              return partirEtiqueta(this.getLabelForValue(valor), anchoEtiquetasEje(this.chart.width));
            }
          }
        }
      }
    }
  });
}

function renderCharts() {
  const filtros = leerFiltros();

  // 1. Evolución anual: los años elegidos en el filtro de Año (en orden
  // cronológico), con todos los demás filtros aplicados
  const anios = TSJData.listAnios(rawDataset).filter(a => !filtros.anios || filtros.anios.has(a));
  const porAnio = TSJData.sumByAnio(filteredDataset, anios);
  const mesesPorAnio = TSJData.monthsByYear(rawDataset, filtros);

  // Promedio anual de Recibidos calculado por mes con datos (x 12): un año
  // parcial como 2026 pesa por sus 10 meses, no como un año completo
  const totalRecibidosEvol = anios.reduce((acc, a) => acc + porAnio.recibidos[a], 0);
  const mesesConDatos = TSJData.countActiveMonths(rawDataset, filtros);
  const promAnualRec = mesesConDatos > 0 ? Math.round(totalRecibidosEvol / mesesConDatos * 12) : 0;
  const badgeAnual = document.getElementById('promedioAnualBadge');
  badgeAnual.textContent = `Prom. Anual Rec: ${fmt(promAnualRec)}`;
  badgeAnual.title = `Recibidos ÷ ${mesesConDatos} ${mesesConDatos === 1 ? 'mes' : 'meses'} con datos × 12`;

  if (chartEvolucion) {
    chartEvolucion.data.labels = anios.map(a =>
      mesesPorAnio[a] > 0 && mesesPorAnio[a] < 12 ? `${a} (${mesesPorAnio[a]}m)` : String(a));
    chartEvolucion.data.datasets = [
      { label: 'Recibidos', data: anios.map(a => porAnio.recibidos[a]), backgroundColor: '#3b82f6', borderRadius: 4 },
      { label: 'Terminados', data: anios.map(a => porAnio.terminados[a]), backgroundColor: '#10b981', borderRadius: 4 },
      { label: 'Sentencias', data: anios.map(a => porAnio.sentencias[a]), backgroundColor: '#a855f7', borderRadius: 4 }
    ];
    chartEvolucion.update();
  }

  // 2. Dona: por materia; con exactamente una materia elegida, por Tipo
  const unaMateria = filtros.materias && filtros.materias.size === 1 ? [...filtros.materias][0] : null;
  if (unaMateria) renderDonaTipos(unaMateria);
  else renderDonaMaterias(filtros);

  // 3. Comportamiento mensual
  const mensual = TSJData.monthlyAverages(filteredDataset, rawDataset, filtros);
  document.getElementById('mensualSubtitulo').textContent = mensual.esPromedio
    ? 'Promedio por mes de los años seleccionados (cada mes se divide entre los años que tienen datos)'
    : 'Cifras por mes del periodo seleccionado';

  if (chartMensual) {
    chartMensual.data.datasets = [
      { label: 'Recibidos', data: mensual.recibidos, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.12)', borderWidth: 2.5, tension: 0.3, fill: true, spanGaps: false },
      { label: 'Terminados', data: mensual.terminados, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.12)', borderWidth: 2.5, tension: 0.3, fill: true, spanGaps: false },
      { label: 'Sentencias', data: mensual.sentencias, borderColor: '#a855f7', backgroundColor: 'rgba(168, 85, 247, 0.12)', borderWidth: 2.5, tension: 0.3, fill: true, spanGaps: false }
    ];
    chartMensual.update();
  }

  // 4. Distribución por Distrito / Órgano
  renderDistritosChart(filtros);
}

// --- Dona: Carga por Materia / Distribución por Tipo -----------------------
let modoDona = 'materia';   // 'materia' | 'tipo' (lo usa el formateador de la dona)

const CLASES_RESUMEN_MATERIA = 'grid grid-cols-3 gap-2 pt-3 border-t border-tsj-line text-center text-xs mt-3';
// Lista de tipos: 1 columna en teléfono y cuando la tarjeta es angosta (lg),
// 2 columnas cuando hay espacio (sm-md a ancho completo y xl o más)
const CLASES_RESUMEN_TIPO = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-x-4 gap-y-1.5 pt-3 border-t border-tsj-line text-left text-[10px] mt-3';

// Color de cada Tipo: el de su categoría (los mismos de las tarjetas KPI);
// "Audiencias pronunciadas" y "Apelaciones no admitidas" (categoría OTROS)
// en un tono claro de su familia
const COLOR_CATEGORIA = {
  RECIBIDOS: '#3b82f6', TERMINADOS: '#10b981', SENTENCIAS: '#a855f7',
  AUDIENCIAS: '#f59e0b', APELACIONES: '#f43f5e', AMPAROS: '#06b6d4',
  INTERLOCUTORIAS: '#6366f1', SUCESIONES: '#14b8a6', OTROS: '#64748b'
};
function colorTipo({ tipo, categoria }) {
  if (categoria === 'OTROS' && tipo.includes('AUDIENCIA')) return '#fcd34d';
  if (categoria === 'OTROS' && tipo.includes('APELACION')) return '#fda4af';
  return COLOR_CATEGORIA[categoria] || COLOR_CATEGORIA.OTROS;
}

// true para colores claros (llevan texto oscuro encima)
function esColorClaro(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const luz = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luz > 0.7;
}

// "APELACIONES INTERPUESTAS NO ADMITIDAS" -> "Apelaciones no admitidas",
// "REPORTE DE SENTENCIAS" -> "Sentencias", "ASUNTOS RECIBIDOS" -> "Recibidos"
function nombreCortoTipo(tipo) {
  const t = String(tipo)
    .replace(/^REPORTE DE\s+/i, '')
    .replace(/^ASUNTOS\s+/i, '')
    .replace(/\s+INTERPUESTAS\b/i, '')
    .toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function tituloDona(titulo, subtitulo) {
  document.getElementById('tituloDona').textContent = titulo;
  document.getElementById('subtituloDona').textContent = subtitulo;
}

// Alto del lienzo de la dona: más alto en la vista por Tipo (más rebanadas)
function altoDona(porTipo) {
  const cont = document.getElementById('donaContenedor');
  if (!cont) return;
  cont.classList.toggle('h-72', porTipo);
  cont.classList.toggle('h-52', !porTipo);
}

// Carga por Materia: 5 categorías KPI; promedio con los meses de cada materia
function renderDonaMaterias(filtros) {
  modoDona = 'materia';
  tituloDona('Carga por Materia', 'Distribución y participación porcentual');
  altoDona(false);
  const matSums = TSJData.sumByMateria(filteredDataset);
  const totalMat = (matSums.CIVIL + matSums.MERCANTIL + matSums.FAMILIAR) || 1;
  const promMateria = m => TSJData.calcPromedio(matSums[m], TSJData.countActiveMonths(rawDataset, { ...filtros, materias: new Set([m]) }));

  if (chartMaterias) {
    chartMaterias.data.labels = ['Civil', 'Mercantil', 'Familiar'];
    chartMaterias.data.datasets[0].data = [matSums.CIVIL, matSums.MERCANTIL, matSums.FAMILIAR];
    chartMaterias.data.datasets[0].backgroundColor = ['#3b82f6', '#f59e0b', '#ec4899'];
    chartMaterias.options.plugins.legend.display = true;
    chartMaterias.update();
  }

  const summaryEl = document.getElementById('materiaSummary');
  if (summaryEl) {
    const tarjeta = (m, nombre, color, colorPct) => `
      <div class="bg-tsj-field p-2 rounded-lg border border-tsj-line">
        <span class="block text-[10px] uppercase font-bold ${color}">${nombre}</span>
        <span class="text-xs font-bold text-white">${fmt(matSums[m])}</span>
        <span class="block text-[9px] ${colorPct} font-semibold">${((matSums[m] / totalMat) * 100).toFixed(1)}%</span>
        <span class="block text-[8px] text-gray-500 font-mono mt-0.5">x̄ ${fmt(promMateria(m))}/m</span>
      </div>`;
    summaryEl.className = CLASES_RESUMEN_MATERIA;
    summaryEl.innerHTML =
      tarjeta('CIVIL', 'Civil', 'text-blue-400', 'text-blue-300') +
      tarjeta('MERCANTIL', 'Mercantil', 'text-amber-400', 'text-amber-300') +
      tarjeta('FAMILIAR', 'Familiar', 'text-pink-400', 'text-pink-300');
  }
}

// Distribución por Tipo de una materia: todos los tipos de la columna TIPO
// (también Amparos, Interlocutorias, Sucesiones y Otros). La lista de abajo
// hace de leyenda: color, nombre corto (en varias líneas si es largo), cifra
// y porcentaje.
function renderDonaTipos(materia) {
  modoDona = 'tipo';
  altoDona(true);
  const nombre = NOMBRE_MATERIA[materia] || materia;
  tituloDona(`Distribución por Tipo · ${nombre}`, `Participación de cada tipo de trámite en ${nombre} (todas las categorías)`);
  const tipos = TSJData.sumByTipo(filteredDataset);
  const total = tipos.reduce((a, t) => a + t.valor, 0);

  if (chartMaterias) {
    chartMaterias.data.labels = tipos.map(t => nombreCortoTipo(t.tipo));
    chartMaterias.data.datasets[0].data = tipos.map(t => t.valor);
    chartMaterias.data.datasets[0].backgroundColor = tipos.map(colorTipo);
    chartMaterias.options.plugins.legend.display = false;
    chartMaterias.update();
  }

  const summaryEl = document.getElementById('materiaSummary');
  if (!summaryEl) return;
  summaryEl.className = CLASES_RESUMEN_TIPO;
  if (!tipos.length) {
    summaryEl.innerHTML = '<p class="col-span-2 text-center text-gray-500">Sin datos con los filtros seleccionados.</p>';
    return;
  }
  summaryEl.innerHTML = tipos.map(t => `
    <div class="flex items-start gap-1.5 min-w-0 leading-snug" title="${escapeHtml(t.tipo)}">
      <span class="w-2 h-2 rounded-full shrink-0 mt-[3px]" style="background-color:${colorTipo(t)}"></span>
      <span class="flex-1 min-w-0 break-words text-gray-300">${escapeHtml(nombreCortoTipo(t.tipo))}</span>
      <span class="shrink-0 pl-1 text-right font-mono whitespace-nowrap">
        <span class="text-gray-200">${fmt(t.valor)}</span>
        <span class="text-gray-400 ml-1">${((t.valor / total) * 100).toFixed(1)}%</span>
      </span>
    </div>`).join('');
}

// Volumen por distrito (o por órgano si hay exactamente un distrito
// seleccionado), con las 5 categorías KPI. Las barras son los distritos del
// filtro de Distrito; con el interruptor "Mostrar distritos sin datos"
// apagado (DEMO) también se ocultan los que quedan en 0 con la selección.
function renderDistritosChart(filtros = leerFiltros()) {
  const distritos = filtros.distritos || new Set(FILTROS.distrito.opciones.map(o => o.valor));
  const unDistrito = distritos.size === 1 ? [...distritos][0] : null;
  const porDistrito = !unDistrito;

  const { etiquetas: distSorted, valores: distVals } =
    TSJData.sumByUnidad(filteredDataset, distritos, { ocultarSinDatos: porDistrito && !mostrarDistritosSinDatos });

  const total = FILTROS.distrito.opciones.length;
  document.getElementById('chartDistritosLabel').textContent = unDistrito
    ? `Juzgados de ${unDistrito}`
    : distSorted.length < total
      ? `${distSorted.length} de ${total} Distritos Judiciales`
      : `${total} Distritos Judiciales`;

  const sumaDist = distVals.reduce((a, b) => a + b, 0);
  const promDist = distVals.length > 0 ? Math.round(sumaDist / distVals.length) : 0;
  document.getElementById('promedioDistritoBadge').textContent = `Prom. Unidad: ${fmt(promDist)}`;

  const container = document.getElementById('distritoCanvasContainer');
  if (container) {
    // Las categorías se reparten de forma uniforme: la etiqueta con más líneas
    // define la altura de cada fila para que los nombres no se encimen.
    const ancho = anchoEtiquetasEje(container.clientWidth);
    const lineas = distSorted.reduce((max, l) => Math.max(max, partirEtiqueta(l, ancho).length), 1);
    const altoFila = Math.max(28, lineas * EJE_LINEA_PX + 12);
    container.style.height = `${Math.max(340, distSorted.length * altoFila)}px`;
  }

  if (chartDistritos) {
    chartDistritos.data.labels = distSorted;
    chartDistritos.data.datasets = [{
      label: 'Suma de Asuntos',
      data: distVals,
      backgroundColor: TEMA.oro,
      hoverBackgroundColor: TEMA.oroClaro,
      borderRadius: 5,
      barThickness: 14
    }];
    chartDistritos.update();
  }
}

// ============================================================================
// 7. TABLA CONSOLIDADA POR MATERIA / DISTRITO / ÓRGANO
// ============================================================================
function onSearchTable() {
  tableSearchQuery = document.getElementById('tableSearch').value.trim();
  currentPage = 1;
  renderTable();
}

function getAggregatedTableData() {
  const filas = TSJData.aggregateByJuzgado(filteredDataset, tableSearchQuery);
  return TSJData.sortTableRows(filas, tableSort.campo, tableSort.direccion);
}

// Clic en un encabezado (Distrito y columnas numéricas): 3 estados por
// columna. Numéricas: neutro -> mayor a menor -> menor a mayor -> neutro.
// Distrito (texto): el primer clic ordena de la A a la Z. Sólo una columna
// ordena a la vez.
function onSortTable(campo) {
  const ciclo = TSJData.COLUMNAS_TEXTO_TABLA.includes(campo)
    ? [null, 'asc', 'desc']
    : [null, 'desc', 'asc'];
  const actual = tableSort.campo === campo ? tableSort.direccion : null;
  const siguiente = ciclo[(ciclo.indexOf(actual) + 1) % ciclo.length];
  tableSort = { campo: siguiente ? campo : null, direccion: siguiente };
  currentPage = 1;
  actualizarIndicadoresOrden();
  renderTable();
}

// Chevron de cada encabezado: abajo = mayor a menor (o Z-A), arriba = menor a
// mayor (o A-Z), icono tenue = sin ordenar. aria-sort para lectores de
// pantalla. fa-fw: los tres iconos ocupan el mismo ancho (nada se recorre).
function actualizarIndicadoresOrden() {
  document.querySelectorAll('th[data-sort]').forEach(th => {
    const dir = th.dataset.sort === tableSort.campo ? tableSort.direccion : null;
    th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none');
    const icono = th.querySelector('[data-sort-icono]');
    if (!icono) return;
    icono.className = dir === 'desc'
      ? 'fa-solid fa-chevron-down fa-fw text-[9px] text-gold-light'
      : dir === 'asc'
        ? 'fa-solid fa-chevron-up fa-fw text-[9px] text-gold-light'
        : 'fa-solid fa-sort fa-fw text-[9px] opacity-40';
  });
}

function renderTable() {
  const data = getAggregatedTableData();
  const totalRows = data.length;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;

  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * pageSize;
  const pageData = data.slice(start, start + pageSize);

  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';

  if (pageData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-gray-500">No se encontraron órganos con los filtros seleccionados.</td></tr>`;
  } else {
    pageData.forEach(row => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-tsj-head transition-colors';
      tr.innerHTML = `
        <td class="px-4 py-2.5">
          <span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-tsj-chip text-gold-light border border-gold/30">${escapeHtml(row.materia)}</span>
        </td>
        <td class="px-4 py-2.5 text-gray-300 font-medium">${escapeHtml(row.distrito)}</td>
        <td class="px-4 py-2.5 font-medium text-white text-center">
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-landmark text-gold/60 text-[10px]"></i>
            <span class="truncate-pre-wrap max-w-[13rem]" title="${escapeHtml(row.juzgado)}">${escapeHtml(row.juzgado)}</span>
          </div>
        </td>
        <td class="px-4 py-2.5 text-right font-mono font-bold text-blue-400">${fmt(row.recibidos)}</td>
        <td class="px-4 py-2.5 text-right font-mono text-emerald-400">${fmt(row.terminados)}</td>
        <td class="px-4 py-2.5 text-right font-mono text-purple-400">${fmt(row.sentencias)}</td>
        <td class="px-4 py-2.5 text-right font-mono text-amber-400">${fmt(row.audiencias)}</td>
        <td class="px-4 py-2.5 text-right font-mono text-rose-400">${fmt(row.apelaciones)}</td>
        <td class="px-4 py-2.5 text-right font-mono text-gray-400">${fmt(row.otras)}</td>
        <td class="px-4 py-2.5 text-right font-mono font-bold text-gold-light">${fmt(row.total)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Totales en el pie de tabla (todas las filas, no sólo la página)
  const sumCol = campo => data.reduce((a, c) => a + c[campo], 0);

  const tfoot = document.getElementById('tableFoot');
  tfoot.innerHTML = `
    <tr>
      <td colspan="3" class="px-4 py-3 uppercase tracking-wider text-gray-300">Total Consolidado (${fmt(data.length)} órganos)</td>
      <td class="px-4 py-3 text-right font-mono text-blue-300">${fmt(sumCol('recibidos'))}</td>
      <td class="px-4 py-3 text-right font-mono text-emerald-300">${fmt(sumCol('terminados'))}</td>
      <td class="px-4 py-3 text-right font-mono text-purple-300">${fmt(sumCol('sentencias'))}</td>
      <td class="px-4 py-3 text-right font-mono text-amber-300">${fmt(sumCol('audiencias'))}</td>
      <td class="px-4 py-3 text-right font-mono text-rose-300">${fmt(sumCol('apelaciones'))}</td>
      <td class="px-4 py-3 text-right font-mono text-gray-400">${fmt(sumCol('otras'))}</td>
      <td class="px-4 py-3 text-right font-mono text-gold-light">${fmt(sumCol('total'))}</td>
    </tr>
  `;

  document.getElementById('tableInfo').textContent = `Mostrando ${totalRows === 0 ? 0 : start + 1} a ${Math.min(start + pageSize, totalRows)} de ${fmt(totalRows)} órganos consolidados`;
  document.getElementById('pageNumber').textContent = `${currentPage} / ${totalPages}`;
  document.getElementById('btnPrevPage').disabled = currentPage === 1;
  document.getElementById('btnNextPage').disabled = currentPage >= totalPages;
}

function changePage(dir) {
  currentPage += dir;
  renderTable();
}

// ============================================================================
// 8. EXPORTACIONES
// ============================================================================
function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// CSV del concentrado de la tabla (todas las páginas)
function exportToCSV() {
  const data = getAggregatedTableData();
  if (!data.length) {
    showToast('No hay órganos en la tabla para exportar.', 'error');
    return;
  }

  const texto = v => `"${String(v).replace(/"/g, '""')}"`;
  const headers = ["Materia", "Distrito", "Organo_Jurisdiccional", "Recibidos", "Terminados", "Sentencias", "Audiencias_Celebradas", "Apelaciones_Admitidas", "Otras_Categorias", "Total_General"];
  const csvRows = [headers.join(",")];

  data.forEach(r => {
    csvRows.push([
      texto(r.materia),
      texto(r.distrito),
      texto(r.juzgado),
      r.recibidos,
      r.terminados,
      r.sentencias,
      r.audiencias,
      r.apelaciones,
      r.otras,
      r.total
    ].join(","));
  });

  const blob = new Blob(["﻿" + csvRows.join("\n")], { type: 'text/csv;charset=utf-8;' });
  descargarBlob(blob, `Resumen_Consolidado_Judicial_${new Date().toISOString().slice(0, 10)}.csv`);
}

// Excel con las filas de datos filtradas (todas las categorías)
function exportToExcel() {
  if (!filteredDataset.length) {
    showToast('No hay datos con los filtros seleccionados para exportar.', 'error');
    return;
  }

  const filas = [['Materia', 'Distrito Judicial', 'Juzgado / Órgano', 'Año', 'Mes', 'Tipo de Trámite', 'Categoría', 'Resultado']];
  filteredDataset.forEach(r => {
    filas.push([r.Materia, r.Distrito, r.Juzgado, r.Anio, r.Mes, r.TIPO, r.CategoriaKPI, r.Resultado]);
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Datos_Jurisdiccionales');

  // Nombre del archivo: materias y años elegidos (TODAS / TODOS si no hay restricción)
  const parte = (clave, todos) => todoSeleccionado(clave)
    ? todos
    : FILTROS[clave].opciones.filter(o => FILTROS[clave].sel.has(o.valor)).map(o => o.valor).join('-');
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Estadistica_Judicial_${parte('materia', 'TODAS')}_${parte('anio', 'TODOS')}_${stamp}.xlsx`);
  showToast(`Excel generado con ${fmt(filteredDataset.length)} filas.`);
}

// ============================================================================
// 9. CARGA DE EXCEL (UI: archivo, overlay de progreso y avisos)
//    El parseo del libro vive en TSJData.parseWorkbook
// ============================================================================
function setupFileUpload() {
  const input = document.getElementById('fileInput');
  input.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    showLoading(true, "Leyendo archivo Excel...", "Cargando archivo en memoria sin congelar el navegador...");

    const reader = new FileReader();
    reader.onload = function(evt) {
      setTimeout(() => {
        try {
          const { registros, hoja, filasLeidas, filasExcluidas, filasInvalidas, sumaCivilRec } =
            TSJData.parseWorkbook(evt.target.result, updateLoadingProgress);

          updateLoadingProgress("Actualizando indicadores y gráficas...", 95);

          rawDataset = registros;
          fuenteDatos = `Excel: ${file.name} (${hoja})`;
          actualizarEstadoSinDatos();   // DEMO: muestra el tablero (antes de dibujar)
          actualizarOpcionesFiltros();
          applyFilters();

          showLoading(false);
          showToast(
            `¡Base procesada con éxito!\n` +
            `• Filas leídas: ${fmt(filasLeidas)} (agrupadas en ${fmt(registros.length)})\n` +
            `• Excluidas ('SIN AGRUPAR' / sin clasificar): ${fmt(filasExcluidas)}\n` +
            `• Excluidas por materia, año o mes inválido: ${fmt(filasInvalidas)}\n` +
            `• Suma Recibidos Civil: ${fmt(sumaCivilRec)}`,
            'success', 8000);

        } catch (err) {
          showLoading(false);
          console.error(err);
          showToast(`Error al procesar el archivo:\n${err.message}`, 'error', 8000);
        }
      }, 80);
    };

    reader.readAsArrayBuffer(file);
  });
}

function showLoading(show, title, subtitle) {
  const el = document.getElementById('loadingOverlay');
  if (show) {
    if (title) document.getElementById('loadingTitle').textContent = title;
    if (subtitle) document.getElementById('loadingSubtitle').textContent = subtitle;
    updateLoadingProgress("Iniciando lectura...", 10);
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function updateLoadingProgress(statusText, percent) {
  document.getElementById('progressStatus').textContent = statusText;
  document.getElementById('progressBar').style.width = `${percent}%`;
}

// ============================================================================
// 10. INICIALIZACIÓN GLOBAL
// ============================================================================
// DEMO: sin datos cargados sólo se ve la tarjeta "Carga la base de datos";
// el resto de las secciones de <main> se ocultan hasta cargar un Excel.
function actualizarEstadoSinDatos() {
  const vacio = rawDataset.length === 0;
  document.getElementById('estadoSinDatos')?.classList.toggle('hidden', !vacio);
  document.querySelectorAll('main > section:not(#estadoSinDatos)').forEach(s => s.classList.toggle('hidden', vacio));
}

window.addEventListener('DOMContentLoaded', () => {
  // DEMO: la página arranca sin datos (se publica sin datos reales) y se
  // cargan a mano con "Cargar Excel". Si en local existe una base embebida
  // (data/embedded-data.js + pako, ver index.html), se usa como antes.
  let errorCarga = null;
  if (window.TSJ_EMBEDDED_DATA) {
    try {
      rawDataset = TSJData.loadEmbeddedDataset();
      const anios = TSJData.listAnios(rawDataset);
      fuenteDatos = `Base embebida ${anios[0]}–${anios[anios.length - 1]}`;
    } catch (err) {
      console.error(err);
      rawDataset = [];
      errorCarga = err.message;
    }
  }
  actualizarEstadoSinDatos();

  // Opciones de los filtros y cierre de sus menús (clic fuera o Escape)
  actualizarOpcionesFiltros();
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-multiselect]')) cerrarMenusFiltro();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarMenusFiltro();
  });

  initCharts();
  setupFileUpload();
  applyFilters();

  if (errorCarga) showToast(`No se pudieron cargar los datos:\n${errorCarga}`, 'error', 10000);
});
