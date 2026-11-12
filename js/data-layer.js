// ============================================================================
// CAPA DE DATOS — Dashboard Estadístico Judicial (TSJ Chihuahua)
// ----------------------------------------------------------------------------
// Sin acceso al DOM. Contiene:
//   1. Catálogos institucionales (distritos, meses, materias, categorías)
//   2. Normalización de texto, meses y clasificación de la columna TIPO
//   3. Fuentes de datos: base embebida (data/embedded-data.js) y lector Excel
//   4. Consultas y agregaciones sobre los registros (filtros, sumas, tasas)
//
// Se expone como el objeto global `TSJData`. Orden de carga en index.html:
//   pako + SheetJS (CDN) → data/embedded-data.js → js/data-layer.js → js/dashboard.js
//
// Todo registro, venga de la base embebida o de un Excel, pasa por
// crearRegistro() y queda CANÓNICO: Materia normalizada
// (mayúsculas, sin acentos), Mes con el nombre oficial ('Enero'...), Distrito
// y Juzgado en MAYÚSCULAS con acentos y sin espacios dobles, y un JuzgadoId
// único (distrito + nombre).
// Por eso los filtros comparan valores directamente.
//
// La materia de cada fila la define su Cve_acuerdo (5xxx Civil, 6xxx Mercantil,
// 7xxx Familiar): un juzgado de distrito pequeño atiende varias materias.
// La base embebida se genera con tools/build_embedded_data.py usando las
// mismas reglas que parseWorkbook(), así que cargar el Excel fuente produce
// exactamente los mismos registros.
//
// Forma de cada registro:
//   {
//     Materia:      'CIVIL' | 'FAMILIAR' | 'MERCANTIL' | ...
//     Distrito:     MAYÚSCULAS con acentos ('MORELOS', 'BENITO JUÁREZ', ...)
//     Juzgado:      nombre del órgano en MAYÚSCULAS con acentos (nombreOficial)
//     JuzgadoId:    'DISTRITO::NOMBRE' normalizados, sin acentos (identifica al órgano)
//     Anio:         number
//     Mes:          'Enero' ... 'Diciembre'
//     TIPO:         texto original de la columna TIPO
//     CategoriaKPI: una de CATEGORIAS_TODAS
//     Resultado:    number
//     Juicio?, Cve_acuerdo?   // sólo en registros leídos de Excel
//   }
//
// Objeto de filtros que reciben las consultas. Cada campo es un Set con los
// valores elegidos, o null = todo seleccionado (sin restricción). Un Set
// vacío no deja pasar ningún registro.
//   {
//     materias:  Set<'CIVIL' | 'MERCANTIL' | 'FAMILIAR'> | null,
//     distritos: Set<distrito> | null,
//     juzgados:  Set<JuzgadoId> | null,
//     anios:     Set<number> | null,
//     meses:     Set<'Enero' ...> | null
//   }
// ============================================================================

const TSJData = (() => {
  'use strict';

  // ==========================================================================
  // 1. CATÁLOGOS INSTITUCIONALES
  // ==========================================================================
  // Catálogo oficial de 14 distritos. La base 2021-2026 sólo trae datos de 12
  // (no hay registros de ARTEAGA ni RAYÓN); se listan igualmente con 0.
  const DISTRITOS_OFICIALES = [
    "MORELOS", "BRAVOS", "BENITO JUÁREZ", "ABRAHAM GONZÁLEZ",
    "HIDALGO", "CAMARGO", "GUERRERO", "ARTEAGA",
    "ANDRÉS DEL RÍO", "JIMÉNEZ", "RAYÓN", "MANUEL OJINAGA",
    "GALEANA", "MINA"
  ];

  const MESES_LISTA = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];

  const MATERIAS = ['CIVIL', 'MERCANTIL', 'FAMILIAR'];

  // Categorías que se muestran como indicadores. Sólo éstas forman la "carga",
  // el "Total General" de la tabla y las gráficas de volumen.
  const CATEGORIAS_KPI = ['RECIBIDOS', 'TERMINADOS', 'SENTENCIAS', 'AUDIENCIAS', 'APELACIONES'];

  // Categorías adicionales presentes en la base. No son KPI ni se grafican;
  // en la tabla se suman en la columna "Otras categorías" y en el Total General
  // (igual que en la versión v2 del tablero). También van en la exportación.
  //   OTROS = Apelaciones NO admitidas + Audiencias pronunciadas
  const CATEGORIAS_ADICIONALES = ['AMPAROS', 'INTERLOCUTORIAS', 'SUCESIONES', 'OTROS'];
  const CATEGORIAS_TODAS = [...CATEGORIAS_KPI, ...CATEGORIAS_ADICIONALES];

  const CAMPO_POR_CATEGORIA = {
    RECIBIDOS: 'recibidos', TERMINADOS: 'terminados', SENTENCIAS: 'sentencias',
    AUDIENCIAS: 'audiencias', APELACIONES: 'apelaciones'
  };

  // Columna de la tabla para cada categoría (las adicionales van a 'otras')
  const CAMPO_TABLA = Object.assign({}, CAMPO_POR_CATEGORIA,
    Object.fromEntries(CATEGORIAS_ADICIONALES.map(c => [c, 'otras'])));

  // ==========================================================================
  // 2. NORMALIZACIÓN Y CLASIFICACIÓN
  // ==========================================================================

  // Normalizador de cadenas para tolerar acentos, dobles espacios y variaciones de caja
  function normalizar(txt) {
    return String(txt || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  // Versión con memoria para la ingesta (hay pocos valores distintos repetidos miles de veces)
  const cacheNormalizar = new Map();
  function normalizarCache(txt) {
    const key = String(txt || '');
    let val = cacheNormalizar.get(key);
    if (val === undefined) {
      val = normalizar(key);
      cacheNormalizar.set(key, val);
    }
    return val;
  }

  function limpiarEspacios(txt) {
    return String(txt || '').replace(/\s+/g, ' ').trim();
  }

  // Nombres de distrito y de órgano: la fuente trae "BENITO JUAREZ" o
  // "JUZGADO DE EJECUCION DE PENAS..." (mayúsculas sin acentos) junto a
  // "Juzgado Décimo Civil por Audiencias". Todos se muestran en MAYÚSCULAS con
  // acentos. Mientras la fuente no venga corregida, los acentos se restauran
  // con esta lista de palabras (si aparece un nombre nuevo sin acentos, se
  // agrega aquí). tools/build_embedded_data.py tiene la MISMA lista y la misma
  // regla: mantenerlas iguales.
  const PALABRAS_CON_ACENTO = [
    'ADMINISTRACIÓN', 'ANDRÉS', 'CHÍNIPAS', 'CONCILIACIÓN', 'CUAUHTÉMOC', 'DÉCIMO',
    'DUODÉCIMO', 'EJECUCIÓN', 'EXTINCIÓN', 'GONZÁLEZ', 'INSTRUCCIÓN', 'JIMÉNEZ',
    'JUÁREZ', 'MEDIACIÓN', 'PROTECCIÓN', 'RAYÓN', 'RECTIFICACIÓN', 'RÍO', 'SECCIÓN',
    'SÉPTIMO', 'UNDÉCIMO', 'ÚNICO'
  ];
  const ACENTOS = new Map(PALABRAS_CON_ACENTO.map(p => [normalizar(p), p]));

  // "Juzgado Decimo  Civil" -> "JUZGADO DÉCIMO CIVIL"; "Benito Juarez" ->
  // "BENITO JUÁREZ" (espacios colapsados)
  const cacheNombreOficial = new Map();
  function nombreOficial(txt) {
    const key = String(txt || '');
    let val = cacheNombreOficial.get(key);
    if (val === undefined) {
      val = limpiarEspacios(key).normalize('NFC').toUpperCase()
        .replace(/[A-ZÁÉÍÓÚÜÑ]+/g, p => ACENTOS.get(normalizar(p)) || p);
      cacheNombreOficial.set(key, val);
    }
    return val;
  }

  const MESES_NORMALIZADOS = MESES_LISTA.map(m => normalizar(m));

  // Devuelve el nombre oficial del mes ('Enero'...) a partir de un nombre en
  // cualquier caja/acentuación o de un número 1-12. null si no es un mes válido.
  function normalizarMes(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const num = Number(valor);
    if (Number.isInteger(num) && num >= 1 && num <= 12) return MESES_LISTA[num - 1];
    const idx = MESES_NORMALIZADOS.indexOf(normalizarCache(valor));
    return idx === -1 ? null : MESES_LISTA[idx];
  }

  function esAnioValido(anio) {
    return Number.isInteger(anio) && anio >= 2000 && anio <= 2100;
  }

  // La materia la define la clave de acuerdo: 5xxx CIVIL, 6xxx MERCANTIL,
  // 7xxx FAMILIAR. null si la clave no está en esos rangos.
  function materiaPorClave(cve) {
    if (!Number.isInteger(cve)) return null;
    if (cve >= 5000 && cve < 6000) return 'CIVIL';
    if (cve >= 6000 && cve < 7000) return 'MERCANTIL';
    if (cve >= 7000 && cve < 8000) return 'FAMILIAR';
    return null;
  }

  // Identificador único de un órgano: el mismo nombre existe en varios distritos
  function juzgadoId(distrito, juzgado) {
    return `${normalizarCache(distrito)}::${normalizarCache(juzgado)}`;
  }

  // Clasificador normativo de la columna TIPO. Reproduce el mismo mapeo que trae
  // la base embebida, para que un Excel cargado produzca las mismas categorías.
  // Devuelve null para 'SIN AGRUPAR', vacíos y tipos no reconocidos (se excluyen).
  function clasificarTipoNormativo(tipoTexto) {
    const norm = normalizar(tipoTexto);
    if (!norm || norm.includes('SIN AGRUPAR')) return null;
    if (norm.includes('RECIBIDO')) return 'RECIBIDOS';
    if (norm.includes('TERMINADO')) return 'TERMINADOS';
    if (norm.includes('SENTENCIA')) return 'SENTENCIAS';
    if (norm.includes('AUDIENCIA') && norm.includes('CELEBRADA')) return 'AUDIENCIAS';
    if (norm.includes('AUDIENCIA') && norm.includes('PRONUNCIADA')) return 'OTROS';
    if (norm.includes('APELACION') && norm.includes('NO ADMITIDA')) return 'OTROS';
    if (norm.includes('APELACION') && norm.includes('ADMITIDA')) return 'APELACIONES';
    if (norm.includes('AMPARO')) return 'AMPAROS';
    if (norm.includes('INTERLOCUTORIA')) return 'INTERLOCUTORIAS';
    if (norm.includes('SUCESION')) return 'SUCESIONES';
    return null;
  }

  // ==========================================================================
  // 3. FUENTES DE DATOS
  // ==========================================================================

  // Construye un registro canónico (ver forma en el encabezado)
  function crearRegistro({ materia, distrito, juzgado, anio, mes, tipo, categoria, resultado, extra }) {
    const Distrito = nombreOficial(distrito);
    const Juzgado = nombreOficial(juzgado);
    return Object.assign({
      Materia: normalizarCache(materia),
      Distrito,
      Juzgado,
      JuzgadoId: juzgadoId(Distrito, Juzgado),
      Anio: anio,
      Mes: mes,
      TIPO: String(tipo || '').trim(),
      CategoriaKPI: categoria,
      Resultado: resultado
    }, extra || {});
  }

  // --- 3a. Base embebida (data/embedded-data.js) ---------------------------
  // Descomprime window.TSJ_EMBEDDED_DATA (base64 + zlib) con pako.
  // Lanza Error si el archivo de datos o pako no están disponibles.
  function loadEmbeddedDataset(fuente) {
    const src = fuente || (typeof window !== 'undefined' ? window.TSJ_EMBEDDED_DATA : null);
    if (!src || !src.metadata || !src.b64) {
      throw new Error('No se encontraron los datos embebidos (data/embedded-data.js).');
    }
    if (typeof pako === 'undefined') {
      throw new Error('No se pudo cargar la librería pako para descomprimir los datos.');
    }

    const binario = atob(src.b64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    const texto = pako.inflate(bytes, { to: 'string' });

    const meta = src.metadata;
    const registros = [];
    texto.split(';').forEach(fila => {
      const p = fila.split(',');
      if (p.length < 8) return;
      registros.push(crearRegistro({
        materia: meta.materias[parseInt(p[0], 10)],
        distrito: meta.distritos[parseInt(p[1], 10)],
        juzgado: meta.juzgados[parseInt(p[2], 10)],
        anio: parseInt(p[3], 10),
        mes: meta.meses[parseInt(p[4], 10)],
        tipo: meta.tipos[parseInt(p[5], 10)],
        categoria: meta.kpis[parseInt(p[6], 10)],
        resultado: parseInt(p[7], 10)
      }));
    });
    return registros;
  }

  // --- 3b. Lector de Excel (SheetJS) ----------------------------------------
  // Primera fila de una hoja, sin convertir la hoja completa
  function leerEncabezado(ws) {
    if (!ws || !ws['!ref']) return [];
    const rango = XLSX.utils.decode_range(ws['!ref']);
    const encabezado = [];
    for (let c = rango.s.c; c <= rango.e.c; c++) {
      const celda = ws[XLSX.utils.encode_cell({ r: rango.s.r, c })];
      encabezado.push(celda ? celda.v : null);
    }
    return encabezado;
  }

  // Busca la hoja de datos: primero una cuyo nombre contenga 'DASHBOAR'
  // (dashboar2022-2026); si no existe, la primera hoja con columnas TIPO y Resultado.
  function encontrarHojaDatos(wb) {
    const porNombre = wb.SheetNames.find(n => normalizar(n).includes('DASHBOAR'));
    if (porNombre) return porNombre;
    return wb.SheetNames.find(n => {
      const encabezado = leerEncabezado(wb.Sheets[n]).map(normalizar);
      return encabezado.includes('TIPO') && encabezado.includes('RESULTADO');
    }) || null;
  }

  // Convierte el ArrayBuffer de BASE_DASH2_ACTUALIZADA.xlsx en registros con las
  // mismas reglas que tools/build_embedded_data.py: clasifica TIPO, toma la
  // materia de Cve_acuerdo y agrupa por materia × distrito × juzgado × año × mes
  // × tipo sumando Resultado. Así el Excel fuente produce los mismos registros
  // que la base embebida.
  // `onProgress(texto, porcentaje)` es opcional y sólo informa el avance.
  // Lanza Error si no hay hoja de datos, si está vacía o si ninguna fila es válida.
  // Devuelve { registros, hoja, filasLeidas, filasExcluidas, filasInvalidas, sumaCivilRec }.
  //   filasExcluidas: 'SIN AGRUPAR' o TIPO no reconocido
  //   filasInvalidas: materia, año o mes ausente / no válido
  function parseWorkbook(arrayBuffer, onProgress) {
    const progress = typeof onProgress === 'function' ? onProgress : () => {};

    const data = new Uint8Array(arrayBuffer);
    progress("Analizando hojas del libro...", 30);

    const wb = XLSX.read(data, { type: 'array' });

    const sheetName = encontrarHojaDatos(wb);
    if (!sheetName) {
      throw new Error(`No se encontró la hoja de datos (pestaña 'dashboar…' o con columnas TIPO y Resultado). Hojas encontradas: ${wb.SheetNames.join(', ')}`);
    }

    progress("Extrayendo registros de datos...", 50);
    // Filas como arreglos (más ligero que objetos para cientos de miles de filas)
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null, blankrows: false });

    if (filas.length < 2) {
      throw new Error(`La hoja '${sheetName}' no contiene filas de datos.`);
    }

    progress("Filtrando registros y excluyendo 'SIN AGRUPAR'...", 75);

    // Índices de columna por nombre normalizado (una sola vez). Cuando un dato
    // admite varios nombres de columna, en cada fila se toma el primero con valor.
    const encabezado = filas[0].map(normalizar);
    const cols = (...nombres) => nombres.map(n => encabezado.indexOf(normalizar(n))).filter(i => i !== -1);
    const C = {
      tipo: cols('TIPO'), materia: cols('MATERIA'), distrito: cols('Distrito'),
      juzgado: cols('Juzgado/Tribunal', 'Juzgado', 'Tribunal'), cve: cols('Cve_acuerdo'),
      anio: cols('Anio', 'Año'), mes: cols('Mes'), resultado: cols('Resultado')
    };
    const v = (fila, idxs) => {
      for (const i of idxs) {
        const x = fila[i];
        if (x !== null && x !== undefined && x !== '') return x;
      }
      return null;
    };

    const grupos = new Map();
    const cacheTipo = new Map();
    let filasLeidas = 0;
    let filasExcluidas = 0;
    let filasInvalidas = 0;
    let sumaCivilRec = 0;

    for (let i = 1; i < filas.length; i++) {
      const fila = filas[i];
      if (!fila || fila.every(x => x === null || x === '')) continue;
      filasLeidas++;

      const tipoRaw = String(v(fila, C.tipo) || '').trim();
      let catKPI = cacheTipo.get(tipoRaw);
      if (catKPI === undefined) {
        catKPI = clasificarTipoNormativo(tipoRaw);
        cacheTipo.set(tipoRaw, catKPI);
      }

      // Excluir registros sin clasificar o con 'SIN AGRUPAR'
      if (!catKPI) {
        filasExcluidas++;
        continue;
      }

      // Materia por clave de acuerdo; si la clave no es válida, la columna MATERIA.
      // Materia, año y mes son obligatorios para ubicar la fila.
      const cve = parseInt(parseFloat(v(fila, C.cve)), 10);
      const materia = materiaPorClave(cve) || normalizarCache(v(fila, C.materia)) || null;
      const anioNum = parseInt(parseFloat(v(fila, C.anio)), 10);
      const mes = normalizarMes(v(fila, C.mes));
      if (!materia || !esAnioValido(anioNum) || !mes) {
        filasInvalidas++;
        continue;
      }

      const resVal = parseFloat(String(v(fila, C.resultado) || '0').replace(/,/g, '')) || 0;
      if (catKPI === 'RECIBIDOS' && materia === 'CIVIL') {
        sumaCivilRec += resVal;
      }

      const distrito = v(fila, C.distrito) || 'DESCONOCIDO';
      const juzgado = v(fila, C.juzgado) || '';
      const clave = [materia, nombreOficial(distrito), nombreOficial(juzgado), anioNum, mes, tipoRaw].join('\u0001');
      const grupo = grupos.get(clave);
      if (grupo) {
        grupo.resultado += resVal;
      } else {
        grupos.set(clave, { materia, distrito, juzgado, anio: anioNum, mes, tipo: tipoRaw, categoria: catKPI, resultado: resVal });
      }
    }

    if (grupos.size === 0) {
      throw new Error(`Ninguna fila de la hoja '${sheetName}' es válida (excluidas: ${filasExcluidas}, materia/año/mes inválido: ${filasInvalidas}). Se conserva la base actual.`);
    }

    const registros = [];
    grupos.forEach(g => registros.push(crearRegistro(g)));

    return { registros, hoja: sheetName, filasLeidas, filasExcluidas, filasInvalidas, sumaCivilRec };
  }

  // ==========================================================================
  // 4. CONSULTAS Y AGREGACIONES
  // ==========================================================================

  // Set de valores canónicos, o null (= sin restricción) si no hay Set
  function conjunto(valores, canonico) {
    return valores ? new Set(Array.from(valores, canonico)) : null;
  }

  // Filtrado estricto por materias, distritos, órganos (JuzgadoId), años y
  // meses. Cada filtro es un Set de valores permitidos o null (todo
  // seleccionado). Un Set vacío no deja pasar nada: devuelve [].
  function filterRecords(registros, filtros) {
    const { materias, distritos, juzgados, anios, meses } = filtros;
    if ([materias, distritos, juzgados, anios, meses].some(s => s && s.size === 0)) return [];

    const mats = conjunto(materias, normalizar);
    const dists = conjunto(distritos, nombreOficial);
    const ans = conjunto(anios, Number);
    const ms = conjunto(meses, normalizarMes);

    return registros.filter(r =>
      r.CategoriaKPI &&
      (!mats || mats.has(r.Materia)) &&
      (!dists || dists.has(r.Distrito)) &&
      (!juzgados || juzgados.has(r.JuzgadoId)) &&
      (!ans || ans.has(r.Anio)) &&
      (!ms || ms.has(r.Mes)));
  }

  // Años presentes en la base, ordenados
  function listAnios(registros) {
    return Array.from(new Set(registros.map(r => r.Anio))).sort((a, b) => a - b);
  }

  // Órganos disponibles para la cascada Materias -> Distritos -> Juzgados
  // (materias / distritos: Set o null = todos).
  // Devuelve [{ id, nombre, distrito }] ordenado por nombre y distrito.
  function listJuzgados(registros, { materias, distritos }) {
    const mats = conjunto(materias, normalizar);
    const dists = conjunto(distritos, nombreOficial);
    const mapa = new Map();
    registros.forEach(r => {
      if (mats && !mats.has(r.Materia)) return;
      if (dists && !dists.has(r.Distrito)) return;
      if (!r.Juzgado) return;
      if (!mapa.has(r.JuzgadoId)) {
        mapa.set(r.JuzgadoId, { id: r.JuzgadoId, nombre: r.Juzgado, distrito: r.Distrito });
      }
    });
    return Array.from(mapa.values()).sort((a, b) =>
      a.nombre.localeCompare(b.nombre, 'es') || a.distrito.localeCompare(b.distrito, 'es'));
  }

  // --- Cobertura: qué meses tienen datos reportados por materia --------------
  // Se calcula sobre la base COMPLETA (no sobre lo filtrado): un órgano sin
  // actividad en un mes no tiene filas, pero el mes sí fue reportado.
  const cacheCobertura = new WeakMap();
  function cobertura(base) {
    let cov = cacheCobertura.get(base);
    if (!cov) {
      cov = new Map();
      base.forEach(r => {
        if (!cov.has(r.Materia)) cov.set(r.Materia, new Set());
        cov.get(r.Materia).add(`${r.Anio}|${r.Mes}`);
      });
      cacheCobertura.set(base, cov);
    }
    return cov;
  }

  // Periodos 'anio|mes' con datos para las materias, años y meses filtrados
  function periodosConDatos(base, { materias, anios, meses }, { ignorarAnio = false, ignorarMeses = false } = {}) {
    const mats = conjunto(materias, normalizar);
    const ans = ignorarAnio ? null : conjunto(anios, Number);
    const ms = ignorarMeses ? null : conjunto(meses, normalizarMes);
    const periodos = new Set();
    cobertura(base).forEach((set, m) => {
      if (mats && !mats.has(m)) return;
      set.forEach(p => {
        const [a, mes] = p.split('|');
        if (ans && !ans.has(Number(a))) return;
        if (ms && !ms.has(mes)) return;
        periodos.add(p);
      });
    });
    return periodos;
  }

  // Número de meses con datos del periodo filtrado (divisor de los promedios
  // mensuales). `base` es el dataset completo, no el filtrado.
  function countActiveMonths(base, filtros) {
    return periodosConDatos(base, filtros).size;
  }

  // Meses con datos por año para la materia filtrada (ignora filtros de año y mes).
  // Sirve para marcar años parciales, p. ej. '2026 (10m)'.
  function monthsByYear(base, filtros) {
    const conteo = {};
    periodosConDatos(base, filtros, { ignorarAnio: true, ignorarMeses: true }).forEach(p => {
      const a = Number(p.split('|')[0]);
      conteo[a] = (conteo[a] || 0) + 1;
    });
    return conteo;
  }

  // Promedio mensual seguro (0 si no hay meses)
  function calcPromedio(valor, divisor) {
    return divisor > 0 ? Math.round(valor / divisor) : 0;
  }

  // Suma de Resultado por categoría (todas las categorías conocidas)
  function sumByCategoria(registros) {
    const sumas = {};
    CATEGORIAS_TODAS.forEach(c => { sumas[c] = 0; });
    registros.forEach(r => {
      if (sumas[r.CategoriaKPI] !== undefined) sumas[r.CategoriaKPI] += (Number(r.Resultado) || 0);
    });
    return sumas;
  }

  // Serie anual por categoría: Recibidos, Terminados y Sentencias por año
  function sumByAnio(registros, anios) {
    const res = { recibidos: {}, terminados: {}, sentencias: {} };
    anios.forEach(a => { res.recibidos[a] = 0; res.terminados[a] = 0; res.sentencias[a] = 0; });

    registros.forEach(r => {
      if (res.recibidos[r.Anio] === undefined) return;
      const val = Number(r.Resultado) || 0;
      if (r.CategoriaKPI === 'RECIBIDOS') res.recibidos[r.Anio] += val;
      else if (r.CategoriaKPI === 'TERMINADOS') res.terminados[r.Anio] += val;
      else if (r.CategoriaKPI === 'SENTENCIAS') res.sentencias[r.Anio] += val;
    });

    return res;
  }

  // Comportamiento mensual: por cada mes del año, suma de lo filtrado dividida
  // entre el número de años que tienen datos en ese mes. Así noviembre y
  // diciembre (sin datos en 2026) no aparecen como una caída.
  // Meses no seleccionados o sin datos → null.
  function monthlyAverages(filtrados, base, filtros) {
    const aniosPorMes = MESES_LISTA.map(() => 0);
    periodosConDatos(base, filtros).forEach(p => {
      aniosPorMes[MESES_LISTA.indexOf(p.split('|')[1])]++;
    });

    const sumas = {
      RECIBIDOS: MESES_LISTA.map(() => 0),
      TERMINADOS: MESES_LISTA.map(() => 0),
      SENTENCIAS: MESES_LISTA.map(() => 0)
    };
    filtrados.forEach(r => {
      const serie = sumas[r.CategoriaKPI];
      if (!serie) return;
      const i = MESES_LISTA.indexOf(r.Mes);
      if (i !== -1) serie[i] += (Number(r.Resultado) || 0);
    });

    const promediar = serie => serie.map((v, i) => aniosPorMes[i] > 0 ? v / aniosPorMes[i] : null);
    return {
      recibidos: promediar(sumas.RECIBIDOS),
      terminados: promediar(sumas.TERMINADOS),
      sentencias: promediar(sumas.SENTENCIAS),
      aniosPorMes,
      esPromedio: aniosPorMes.some(n => n > 1)
    };
  }

  // Carga por materia: suma de las 5 categorías KPI
  function sumByMateria(registros) {
    const sumas = {};
    MATERIAS.forEach(m => { sumas[m] = 0; });
    registros.forEach(r => {
      if (!CAMPO_POR_CATEGORIA[r.CategoriaKPI]) return;
      if (sumas[r.Materia] !== undefined) sumas[r.Materia] += (Number(r.Resultado) || 0);
    });
    return sumas;
  }

  // Distribución por TIPO (la columna original), con TODAS las categorías.
  // Agrupa sin importar mayúsculas, acentos ni espacios. Devuelve
  // [{ tipo, categoria, valor }] de mayor a menor, sin tipos en 0.
  function sumByTipo(registros) {
    const mapa = new Map();
    registros.forEach(r => {
      if (!r.CategoriaKPI) return;
      const key = normalizarCache(r.TIPO);
      let g = mapa.get(key);
      if (!g) {
        g = { tipo: key, categoria: r.CategoriaKPI, valor: 0 };
        mapa.set(key, g);
      }
      g.valor += Number(r.Resultado) || 0;
    });
    return Array.from(mapa.values()).filter(g => g.valor > 0).sort((a, b) => b.valor - a.valor);
  }

  // Volumen por unidad (suma de las 5 categorías KPI). `distritos` es un Set o
  // null (todos). Con exactamente un distrito: por órgano dentro de él; si no,
  // por distrito. Los distritos seleccionados (los 14 oficiales si es null)
  // aparecen aunque no tengan datos (con 0), salvo que se pida
  // ocultarSinDatos. Devuelve etiquetas y valores de mayor a menor.
  function sumByUnidad(registros, distritos, { ocultarSinDatos = false } = {}) {
    const valores = new Map();
    const etiquetas = new Map();
    const dists = conjunto(distritos, nombreOficial);
    const porDistrito = !(dists && dists.size === 1);

    if (porDistrito) {
      (dists ? Array.from(dists) : DISTRITOS_OFICIALES).forEach(d => { valores.set(d, 0); etiquetas.set(d, d); });
    }

    registros.forEach(r => {
      if (!CAMPO_POR_CATEGORIA[r.CategoriaKPI]) return;
      const key = porDistrito ? r.Distrito : r.JuzgadoId;
      if (!valores.has(key)) {
        valores.set(key, 0);
        etiquetas.set(key, porDistrito ? r.Distrito : (r.Juzgado || 'ÓRGANO JURISDICCIONAL'));
      }
      valores.set(key, valores.get(key) + (Number(r.Resultado) || 0));
    });

    let keys = Array.from(valores.keys()).sort((a, b) => valores.get(b) - valores.get(a));
    if (ocultarSinDatos) keys = keys.filter(k => valores.get(k) > 0);
    return { etiquetas: keys.map(k => etiquetas.get(k)), valores: keys.map(k => valores.get(k)) };
  }

  // Concentrado de la tabla: agrupa por Materia + Órgano (JuzgadoId). Cada fila
  // trae las 5 categorías KPI, `otras` (Amparos, Interlocutorias, Sucesiones y
  // Otros) y `total` = las 5 + otras. Filtra por texto (sin acentos, en materia,
  // distrito u órgano) y ordena por total.
  function aggregateByJuzgado(registros, busqueda) {
    const mapa = new Map();

    registros.forEach(r => {
      const campo = CAMPO_TABLA[r.CategoriaKPI];
      if (!campo) return;
      const key = `${r.Materia}|${r.JuzgadoId}`;
      let g = mapa.get(key);
      if (!g) {
        g = {
          materia: r.Materia,
          distrito: r.Distrito,
          juzgado: r.Juzgado || 'JUZGADO DESCONOCIDO',
          recibidos: 0, terminados: 0, sentencias: 0, audiencias: 0, apelaciones: 0,
          otras: 0,
          total: 0
        };
        mapa.set(key, g);
      }
      const val = Number(r.Resultado) || 0;
      g[campo] += val;
      g.total += val;
    });

    let arr = Array.from(mapa.values());

    const q = normalizar(busqueda);
    if (q) {
      arr = arr.filter(g =>
        normalizar(g.materia).includes(q) ||
        normalizar(g.distrito).includes(q) ||
        normalizar(g.juzgado).includes(q)
      );
    }

    arr.sort((a, b) => b.total - a.total || b.recibidos - a.recibidos || a.juzgado.localeCompare(b.juzgado, 'es'));
    return arr;
  }

  // Orden de la tabla por una columna de aggregateByJuzgado.
  //   direccion: 'desc' (mayor a menor / Z-A), 'asc' (menor a mayor / A-Z)
  //   o null = orden por defecto (el que ya trae aggregateByJuzgado).
  // Columnas de texto en orden alfabético español; las demás, numéricas.
  // Los empates conservan el orden por defecto (sort estable).
  const COLUMNAS_TEXTO_TABLA = ['materia', 'distrito', 'juzgado'];
  function sortTableRows(filas, campo, direccion) {
    if (!campo || !direccion) return filas;
    const signo = direccion === 'asc' ? 1 : -1;
    const comparar = COLUMNAS_TEXTO_TABLA.includes(campo)
      ? (a, b) => String(a[campo]).localeCompare(String(b[campo]), 'es', { sensitivity: 'base' })
      : (a, b) => (Number(a[campo]) || 0) - (Number(b[campo]) || 0);
    return [...filas].sort((a, b) => signo * comparar(a, b));
  }

  // Tasas de conclusión (%):
  //   resolucion  = Terminados  / Recibidos
  //   sentencias  = Sentencias  / Terminados
  //   impugnacion = Apelaciones / Sentencias
  function calcTasas(sumas) {
    const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
    return {
      resolucion: pct(sumas.TERMINADOS, sumas.RECIBIDOS),
      sentencias: pct(sumas.SENTENCIAS, sumas.TERMINADOS),
      impugnacion: pct(sumas.APELACIONES, sumas.SENTENCIAS)
    };
  }

  // ==========================================================================
  // API PÚBLICA
  // ==========================================================================
  return Object.freeze({
    // Catálogos
    DISTRITOS_OFICIALES,
    MESES_LISTA,
    MATERIAS,
    CATEGORIAS_KPI,
    CATEGORIAS_ADICIONALES,
    CATEGORIAS_TODAS,
    // Normalización y clasificación
    normalizar,
    normalizarMes,
    clasificarTipoNormativo,
    materiaPorClave,
    juzgadoId,
    nombreOficial,
    // Fuentes de datos
    loadEmbeddedDataset,
    parseWorkbook,
    // Consultas y agregaciones
    filterRecords,
    listAnios,
    listJuzgados,
    countActiveMonths,
    monthsByYear,
    calcPromedio,
    sumByCategoria,
    sumByAnio,
    monthlyAverages,
    sumByMateria,
    sumByTipo,
    sumByUnidad,
    aggregateByJuzgado,
    COLUMNAS_TEXTO_TABLA,
    sortTableRows,
    calcTasas
  });
})();
