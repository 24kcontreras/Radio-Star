/* ==========================================================================
   RadioStar — Top 40 real (función serverless de Vercel)

   El Top 40 se calcula contando lo que la emisora ha puesto de verdad al aire.
   AzuraCast guarda el historial completo de reproducciones, pero ese endpoint
   pide autenticación: la clave vive aquí, en el servidor, y nunca viaja al
   navegador. Por eso la lista se sirve desde esta función y no con un fetch
   directo desde la página.

   Método: se piden N ventanas de 7 días, se agrupa por canción y se ordena por
   número de emisiones. La ventana más reciente da la posición actual, la
   anterior da el «Ant.» y el resto dice cuántas semanas lleva en lista.

   Ventanas móviles, no semanas de calendario: así la lista está siempre
   completa y se mueve cada día, en lugar de vaciarse cada lunes.

   Sin dependencias: Node trae fetch desde la v18.
   ========================================================================== */

'use strict';

/* ── Configuración ──────────────────────────────────────────────────────── */

var BASE = (process.env.AZURACAST_BASE || 'https://radio.radiobendicion.cl').replace(/\/+$/, '');
var ESTACION = process.env.AZURACAST_STATION || 'radio-star-online';
var CLAVE = process.env.AZURACAST_API_KEY || '';

var TAMANO = 40;                   // puestos de la lista
var SEMANAS = 8;                   // ventanas de 7 días que se consultan
var DIA_MS = 86400000;
var SEMANA_MS = 7 * DIA_MS;
var TIMEOUT_MS = 15000;
var POR_PAGINA = 500;              // si la API pagina, se pide en tandas grandes
var MAX_PAGINAS = 40;              // tope de seguridad: 20.000 emisiones por ventana

// Una canción entra en la lista a partir de aquí. Con un solo pase puede ser
// una prueba del locutor o un archivo que se coló; no es rotación.
var MIN_EMISIONES = 2;

/* Cuñas, separadores y autopromos de la emisora. Suenan muchísimo más que
   cualquier canción —los separadores iban 56 y 28 pases frente a los 24 del
   tema más puesto—, así que sin esto copan la lista entera y el Top 40 deja
   de hablar de música.

   «^radio star» sólo descarta lo que EMPIEZA por el nombre de la emisora
   («Radio Star en Ingles»); si se buscara en cualquier posición se cargaría
   «Video Killed the Radio Star», que es una canción de verdad.

   Se compara sin acentos y por eso el patrón va sin ellos: la «ñ» de «cuña»
   llega unas veces compuesta y otras descompuesta (n + tilde) según el
   archivo, y con la forma descompuesta la cortinilla se colaba en la lista. */
var CORTINILLAS = /(\bseparador\w*\b|\bcuna\b|\bjingle\b|\bpromo(?:cion)?\b|\bbarrido\b|\brafaga\b|\bcareta\b|\bsweeper\b|\bbumper\b|\bmarca\s*poder\b|\bspot\b|^\s*radio\s*star\b)/i;

function esCortinilla(texto) {
  return CORTINILLAS.test(sinAcentos(String(texto || '')).toLowerCase());
}

// El CDN guarda el resultado una hora: por muchas visitas que haya, el
// historial de la emisora se lee como mucho 24 veces al día.
var CACHE_SEGUNDOS = 3600;
var CACHE_OBSOLETO = 21600;        // 6 h sirviendo lo viejo mientras refresca

// El navegador se guarda su propia copia mucho menos tiempo. Sin un max-age
// explícito aplica caché heurística y puede quedarse con una lista vieja
// durante horas, sin forma de saberlo desde la página.
var CACHE_NAVEGADOR = 300;         // 5 min

/* ── Limpieza de metadatos ──────────────────────────────────────────────── */
/* Las etiquetas de los archivos vienen del pool de remixes y están sucias:
   BPM pegado delante, el nombre del DJ entre corchetes, y a veces artista y
   título cambiados de sitio. Sin esta capa el Top 40 sale ilegible.

   Si algún caso concreto se resiste, añádelo a CORRECCIONES: es un mapa de
   «clave normalizada» → { artist, title } que se aplica al final.            */

// Correcciones escritas a mano. Ganan siempre sobre las automáticas.
var MANUALES = {
  // 'blue|eiffel65': { artist: 'Eiffel 65', title: 'Blue (Da Ba Dee)' },
};

/* Correcciones averiguadas por scripts/corrige-nombres.js cotejando cada
   etiqueta contra un catálogo musical. El archivo puede no existir —la función
   tiene que seguir funcionando sin él— y por eso el require va protegido.
   Se usa require y no readFileSync para que Vercel lo incluya en el paquete. */
function cargaGeneradas() {
  try {
    var datos = require('./correcciones.json');
    return (datos && datos.correcciones) || {};
  } catch (e) {
    return {};                       // sin archivo, sólo valen las manuales
  }
}

var CORRECCIONES = Object.assign(Object.create(null), cargaGeneradas(), MANUALES);

// Palabras que delatan un crédito de remezcla en lugar del nombre de la canción.
// Los prefijos sueltos son a propósito: en este pool aparecen pegados
// («raggamix», «antonydj», «lmix»), así que el límite de palabra sólo se exige
// por la izquierda de la raíz cuando la palabra puede ir sola.
var MARCAS = /([a-zá-ú]*mix|\bremix|\brmx|\bedit\b|\bintro\w*|\boutro\b|\bacapella\b|\bextended\b|\bversi[oó]n?\b|\bbootleg\b|\bmashup\b|[a-zá-ú]*dj\b|\bdj\s|\bbpm\b|\breload\b|\btransition\b)/i;

// Partículas que no se capitalizan salvo al principio.
var MINUSCULAS = /^(de|del|la|las|el|los|y|e|o|u|a|al|en|con|por|para|the|of|in|on|at|to|and|or|for|feat|ft|vs)$/;

function sinAcentos(s) {
  return s.normalize ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s;
}

// Quita todo lo que no sea el nombre: BPM, corchetes del DJ, paréntesis de
// remezcla, numeración de pool y espacios de más.
function limpia(s) {
  var t = String(s || '').toLowerCase();

  t = t.replace(/\[[^\]]*\]/g, ' ');                      // [ diego marti reload ]
  t = t.replace(/\(([^)]*)\)/g, function (m, dentro) {     // (dj jarol remix), (140)
    return MARCAS.test(dentro) || /^\s*\d+\s*$/.test(dentro) ? ' ' : m;
  });
  t = t.replace(/\{[^}]*\}/g, ' ');

  t = t.replace(/^[\s.\-_]*\d{2,3}\s*(?:bpm)?[\s.\-_]+/i, ' ');  // «130 dime», «113. baby alice»
  t = t.replace(/^\s*\d{1,3}[a-z]?\s*[-–.]\s+/i, ' ');           // «1a - mix essential rock»
  t = t.replace(/[\s.\-_]*\b\d{2,3}\s*bpm\b\.?/gi, ' ');         // «… 114 BPM»
  t = t.replace(/[~_]+\d*\s*$/, ' ');                            // «127dav~1»

  t = t.replace(/\s+/g, ' ').replace(/^[\s.,;:\-–—]+|[\s.,;:\-–—]+$/g, '');

  // Un campo que se queda en puros números no es un nombre: era el índice del
  // pool («91»), y vale más dejarlo vacío que enseñarlo como artista.
  return /^[\d\s.\-_]*$/.test(t) ? '' : t;
}

function capitaliza(s) {
  return String(s || '')
    .split(' ')
    .map(function (p, i) {
      if (!p) return p;
      if (i > 0 && MINUSCULAS.test(p)) return p;
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join(' ');
}

// Clave de agrupación: dos variantes de la misma canción tienen que sumar en
// la misma fila, aunque una traiga el remixer y la otra no.
function clave(artista, titulo) {
  return sinAcentos((artista + '|' + titulo).toLowerCase()).replace(/[^a-z0-9|]/g, '');
}

// Descarta lo que no es una canción. Vale más una lista corta que una llena
// de restos de nombre de archivo.
function esUtil(nombre) {
  var t = String(nombre || '');
  // Tres letras en total, no seguidas: «oh le le» es un título de verdad, y
  // exigirlas consecutivas lo dejaba fuera de la lista.
  var letras = t.match(/[a-záéíóúñü]/gi);
  if (!letras || letras.length < 3) return false;
  // Una sola palabra con números dentro es un nombre de archivo truncado
  // («127dav»), no un título.
  if (/\d/.test(t) && !/\s/.test(t)) return false;
  return true;
}

/* Devuelve { artista, titulo } ya presentables, o null si no hay nada que
   mostrar. Aquí se resuelven los dos líos del pool:
     1. artista y título invertidos — el campo que lleva el crédito de
        remezcla es el título, porque ahí es donde se anota;
     2. artista vacío y todo metido en el título con el formato
        «<bpm> título . artista», que es la convención de la emisora.        */
function normaliza(cancion) {
  var artistaBruto = String((cancion && cancion.artist) || '');
  var tituloBruto = String((cancion && cancion.title) || '');
  var repartido = false;

  // Sin artista, AzuraCast mete la cadena entera en el título con el formato
  // de la casa: «<bpm> título . artista».
  if (!artistaBruto.trim() && tituloBruto.indexOf(' . ') > -1) {
    var partes = tituloBruto.split(' . ');
    tituloBruto = partes.shift();
    artistaBruto = partes.join(' . ');
    repartido = true;
  }

  var artista = limpia(artistaBruto);
  var titulo = limpia(tituloBruto);

  // Invertidos: el crédito de remezcla se anota junto al nombre de la canción,
  // así que el campo que lo lleva es el título, esté donde esté.
  // No se aplica cuando el reparto lo acabamos de hacer nosotros: ahí ya
  // sabemos qué lado es cuál y el corchete del DJ despistaría.
  if (!repartido && MARCAS.test(artistaBruto) && !MARCAS.test(tituloBruto) && titulo) {
    var tmp = artista; artista = titulo; titulo = tmp;
  }

  if (!esUtil(titulo)) return null;

  // Se comprueba sobre el texto original: la limpieza quita paréntesis y
  // corchetes, y alguna cortinilla se identifica justo por lo que va ahí.
  if (esCortinilla(tituloBruto) || esCortinilla(titulo)) return null;

  // La clave se calcula ANTES de corregir: es con la que el script de
  // correcciones indexa el archivo, y así sigue encontrando la entrada
  // aunque el nombre corregido sea muy distinto del original.
  var k = clave(artista, titulo);
  var corregido = CORRECCIONES[k];
  if (corregido) return { artista: corregido.artist, titulo: corregido.title, clave: k };

  return { artista: capitaliza(artista), titulo: capitaliza(titulo), clave: k };
}

/* ── Historial de la emisora ────────────────────────────────────────────── */

function iso(ms) { return new Date(ms).toISOString().slice(0, 19) + 'Z'; }

// Una página del historial entre dos fechas.
async function pidePagina(desde, hasta, pagina) {
  var ctrl = new AbortController();
  var reloj = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);

  try {
    var url = BASE + '/api/station/' + encodeURIComponent(ESTACION) + '/history'
      + '?start=' + encodeURIComponent(iso(desde))
      + '&end=' + encodeURIComponent(iso(hasta))
      + '&per_page=' + POR_PAGINA + '&page=' + pagina;

    var res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'X-API-Key': CLAVE,
        'Accept': 'application/json',
        'User-Agent': 'RadioStarOnline/1.0 (+https://radiostaronline.com)'
      }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' en el historial');
    return res.json();

  } finally {
    clearTimeout(reloj);
  }
}

/* Una ventana de 7 días completa.

   Según la versión, AzuraCast devuelve el array pelado o una respuesta
   paginada { rows, total_pages }. Con lo segundo hay que recorrer las páginas:
   quedarse con la primera daría un recuento corto y un Top 40 falso sin que se
   note por ninguna parte, que es justo lo que no queremos.                   */
async function leeVentana(desde, hasta) {
  var filas = [];

  for (var pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    var datos = await pidePagina(desde, hasta, pagina);

    if (Array.isArray(datos)) return filas.concat(datos);   // sin paginación

    var lote = (datos && Array.isArray(datos.rows)) ? datos.rows : [];
    filas = filas.concat(lote);

    var total = Number(datos && datos.total_pages) || 0;
    if (!lote.length || (total && pagina >= total) || (!total && lote.length < POR_PAGINA)) break;
  }

  return filas;
}

/* ── Recuento ───────────────────────────────────────────────────────────── */

/* Etiqueta tal y como la manda la emisora, en una única forma Unicode. Es la
   que usa la página para reconocer dentro de la lista la canción que suena,
   así que los dos lados tienen que escribirla igual: la misma «ñ» llega unas
   veces compuesta y otras descompuesta según de dónde salga el dato.          */
function etiquetaCruda(cancion) {
  var s = String((cancion && cancion.artist) || '') + '|' +
          String((cancion && cancion.title) || '');
  return (s.normalize ? s.normalize('NFC') : s).toLowerCase().trim();
}

// Cuenta emisiones de una ventana y devuelve el ranking ordenado.
function rankea(filas) {
  var porClave = Object.create(null);

  filas.forEach(function (fila) {
    var cancion = (fila && fila.song) || fila;
    var limpio = normaliza(cancion);
    if (!limpio) return;

    var k = clave(limpio.artista, limpio.titulo);
    var entrada = porClave[k] || (porClave[k] = {
      clave: k,
      artist: limpio.artista,
      title: limpio.titulo,
      album: '',
      art: '',
      plays: 0,
      last: 0,
      raw: Object.create(null)
    });

    entrada.plays += 1;

    // Se guardan las variantes tal cual llegan para que la página pueda
    // reconocer la canción que suena ahora y marcarla en la lista.
    entrada.raw[etiquetaCruda(cancion)] = true;

    var cuando = Number(fila && (fila.played_at || fila.timestamp)) || 0;
    if (cuando >= entrada.last) {
      entrada.last = cuando;
      if (cancion && cancion.album) entrada.album = String(cancion.album);
      if (cancion && cancion.art) entrada.art = String(cancion.art);
    }
  });

  return Object.keys(porClave)
    .map(function (k) { return porClave[k]; })
    .filter(function (e) { return e.plays >= MIN_EMISIONES; })
    .sort(function (a, b) {
      if (b.plays !== a.plays) return b.plays - a.plays;   // más emitida, más arriba
      if (b.last !== a.last) return b.last - a.last;       // a igualdad, la más reciente
      return a.title.localeCompare(b.title, 'es');         // desempate estable
    });
}

// Índice clave → posición, para leer de un vistazo dónde estaba una canción.
function posiciones(ranking) {
  var mapa = Object.create(null);
  ranking.forEach(function (e, i) { mapa[e.clave] = i + 1; });
  return mapa;
}

/* ── Handler ────────────────────────────────────────────────────────────── */

module.exports = async function (req, res) {
  if (!CLAVE) {
    // Sin clave no hay historial, y sin historial no hay lista real. Se dice
    // claramente en lugar de inventar un Top 40.
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({
      error: 'Falta AZURACAST_API_KEY: el Top 40 se calcula con el historial de emisión.',
      top: []
    });
    return;
  }

  try {
    var ahora = Date.now();

    // Ventanas de 7 días hacia atrás: [0] es la semana en curso.
    var ventanas = [];
    for (var i = 0; i < SEMANAS; i++) {
      ventanas.push([ahora - (i + 1) * SEMANA_MS, ahora - i * SEMANA_MS]);
    }

    var tandas = await Promise.all(ventanas.map(function (v) {
      // Una ventana vieja que falle sólo empeora el «semanas en lista»; no
      // debe tirar abajo la lista entera.
      return leeVentana(v[0], v[1]).catch(function () { return null; });
    }));

    if (!tandas[0]) throw new Error('La emisora no devolvió el historial de esta semana');

    var rankings = tandas.map(function (filas) { return filas ? rankea(filas) : null; });
    var actual = rankings[0];

    if (!actual.length) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(502).json({
        error: 'El historial de esta semana no trae emisiones utilizables.',
        top: []
      });
      return;
    }

    var anterior = rankings[1] ? posiciones(rankings[1]) : null;

    // «Semanas en lista»: ventanas consecutivas, empezando por esta, en las
    // que la canción estuvo entre las 40. Se corta en el primer hueco.
    var historicos = rankings.map(function (r) {
      return r ? posiciones(r) : null;
    });

    var top = actual.slice(0, TAMANO).map(function (e, idx) {
      var semanas = 1;
      for (var w = 1; w < historicos.length; w++) {
        var mapa = historicos[w];
        if (!mapa) break;                        // ventana sin datos: no se inventa
        if (!(e.clave in mapa) || mapa[e.clave] > TAMANO) break;
        semanas++;
      }

      var prev = anterior && (e.clave in anterior) ? anterior[e.clave] : null;

      return {
        pos: idx + 1,
        prev: prev !== null && prev <= TAMANO ? prev : null,   // null = entrada nueva
        weeks: semanas,
        plays: e.plays,
        title: e.title,
        artist: e.artist,
        album: e.album,
        art: e.art,
        keys: Object.keys(e.raw).slice(0, 8)
      };
    });

    res.setHeader('Cache-Control',
      'public, max-age=' + CACHE_NAVEGADOR +
      ', s-maxage=' + CACHE_SEGUNDOS +
      ', stale-while-revalidate=' + CACHE_OBSOLETO);
    res.status(200).json({
      actualizado: new Date(ahora).toISOString(),
      desde: new Date(ahora - SEMANA_MS).toISOString(),
      hasta: new Date(ahora).toISOString(),
      // Ventanas con datos, no simplemente leídas: una semana sin historial
      // devuelve un array vacío, y contarla como buena ocultaba que el
      // archivo de la emisora sólo llega a una semana atrás.
      ventanas: tandas.filter(function (t) { return t && t.length; }).length,
      emisiones: tandas[0].length,
      top: top
    });

  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String((e && e.message) || e), top: [] });
  }
};

// Se exporta para poder probar el recuento sin llamar a la emisora.
module.exports.__test = { normaliza: normaliza, limpia: limpia, rankea: rankea, clave: clave };
