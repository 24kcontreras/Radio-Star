#!/usr/bin/env node
/* ==========================================================================
   RadioStar — corrector de nombres de canciones

   Las etiquetas de los archivos de la emisora vienen del pool de remezclas y
   están sucias. api/top40.js ya hace la limpieza *sintáctica* (quitar BPM,
   corchetes del DJ, deshacer inversiones evidentes), pero hay un techo: para
   saber que «Blue» es de Eiffel 65 y no al revés hace falta conocimiento
   externo. Eso es lo que añade este script.

   Qué hace: coge cada etiqueta distinta que ha sonado, la busca en el catálogo
   de iTunes, puntúa el parecido y, si supera el umbral, escribe la corrección
   en api/correcciones.json —que api/top40.js carga solo—. Lo que no llega al
   umbral NO se toca: se vuelca en scripts/revisar.json para que lo mires tú.

   Esa separación es deliberada. Una búsqueda difusa sobre texto basura
   devuelve resultados equivocados con total aplomo, y meter un artista falso
   es peor que dejar el nombre feo.

   No toca AzuraCast: sólo lee. La biblioteca de la emisora queda intacta.

   Uso:
     AZURACAST_API_KEY=xxx node scripts/corrige-nombres.js
     node scripts/corrige-nombres.js --dry-run      (no escribe nada)
     node scripts/corrige-nombres.js --umbral 0.9   (más estricto)
     node scripts/corrige-nombres.js --semanas 12   (mira más atrás)

   Sin dependencias.
   ========================================================================== */

'use strict';

var fs = require('fs');
var path = require('path');
var top40 = require('../api/top40.js');
var normaliza = top40.__test.normaliza;

/* ── Configuración ──────────────────────────────────────────────────────── */

var args = process.argv.slice(2);
function opcion(nombre, porDefecto) {
  var i = args.indexOf('--' + nombre);
  return i > -1 && args[i + 1] ? args[i + 1] : porDefecto;
}
var SOLO_PRUEBA = args.indexOf('--dry-run') > -1;

var BASE = (process.env.AZURACAST_BASE || 'https://radio.radiobendicion.cl').replace(/\/+$/, '');
var ESTACION = process.env.AZURACAST_STATION || 'radio-star-online';
var CLAVE_API = process.env.AZURACAST_API_KEY || '';

var SEMANAS = Number(opcion('semanas', 8));
var UMBRAL = Number(opcion('umbral', 0.82));   // confianza mínima para aplicar
var PAUSA_MS = Number(opcion('pausa', 500));   // entre consultas al catálogo
// Tienda de iTunes en la que buscar. Importa más de lo que parece: la de EE.UU.
// no encuentra "Better Off Alone" de Alice Deejay y la chilena sí.
var PAIS = opcion('pais', 'CL');
var MIN_EMISIONES = 2;                          // igual que el Top 40

var DIR = __dirname;
var SALIDA = path.join(DIR, '..', 'api', 'correcciones.json');
var REVISAR = path.join(DIR, 'revisar.json');
var CACHE = path.join(DIR, '.cache-busquedas.json');

/* ── Utilidades de texto ────────────────────────────────────────────────── */

function plano(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Coeficiente de Dice sobre bigramas: tolera erratas y palabras de más mejor
// que una comparación exacta, y es barato.
function bigramas(s) {
  var t = plano(s).replace(/\s/g, '');
  var out = [];
  for (var i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

function dice(a, b) {
  var A = bigramas(a), B = bigramas(b);
  if (!A.length || !B.length) return a === b ? 1 : 0;
  var cuenta = Object.create(null);
  A.forEach(function (g) { cuenta[g] = (cuenta[g] || 0) + 1; });
  var comunes = 0;
  B.forEach(function (g) { if (cuenta[g] > 0) { cuenta[g]--; comunes++; } });
  return (2 * comunes) / (A.length + B.length);
}

// Los paréntesis de versión («(Radio Edit)», «(Da Ba Dee)») no deben penalizar
// el parecido del título, así que se compara también sin ellos.
function sinParentesis(s) { return String(s || '').replace(/[\(\[][^)\]]*[\)\]]/g, ' ').trim(); }

function pareceTitulo(a, b) {
  return Math.max(dice(a, b), dice(sinParentesis(a), sinParentesis(b)));
}

/* ── Historial de la emisora ────────────────────────────────────────────── */

function iso(ms) { return new Date(ms).toISOString().slice(0, 19) + 'Z'; }

async function pideHistorial(desde, hasta, pagina) {
  var url = BASE + '/api/station/' + encodeURIComponent(ESTACION) + '/history'
    + '?start=' + encodeURIComponent(iso(desde)) + '&end=' + encodeURIComponent(iso(hasta))
    + '&per_page=500&page=' + pagina;
  var res = await fetch(url, {
    headers: { 'X-API-Key': CLAVE_API, 'Accept': 'application/json',
               'User-Agent': 'RadioStarOnline/1.0 (+https://radiostaronline.com)' }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' leyendo el historial');
  return res.json();
}

// Todas las etiquetas distintas que han sonado, con cuántas veces.
async function recogeCanciones() {
  var SEMANA = 7 * 86400000, ahora = Date.now();
  var vistas = Object.create(null);

  for (var w = 0; w < SEMANAS; w++) {
    var desde = ahora - (w + 1) * SEMANA, hasta = ahora - w * SEMANA;
    for (var pagina = 1; pagina <= 40; pagina++) {
      var datos;
      try {
        datos = await pideHistorial(desde, hasta, pagina);
      } catch (e) {
        console.error('  ventana ' + (w + 1) + ': ' + e.message);
        break;
      }
      var filas = Array.isArray(datos) ? datos : (datos && datos.rows) || [];
      filas.forEach(function (fila) {
        var c = (fila && fila.song) || fila;
        if (!c) return;
        var bruto = (String(c.artist || '') + '|' + String(c.title || '')).normalize('NFC').toLowerCase().trim();
        if (!vistas[bruto]) vistas[bruto] = { artist: c.artist || '', title: c.title || '', veces: 0 };
        vistas[bruto].veces++;
      });
      if (Array.isArray(datos)) break;
      var total = Number(datos && datos.total_pages) || 0;
      if (!filas.length || (total && pagina >= total)) break;
    }
    process.stdout.write('\r  ventanas leídas: ' + (w + 1) + '/' + SEMANAS +
                         '  ·  etiquetas distintas: ' + Object.keys(vistas).length + '   ');
  }
  process.stdout.write('\n');
  return Object.keys(vistas).map(function (k) { return vistas[k]; });
}

/* ── Catálogo musical ───────────────────────────────────────────────────── */

var cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) { cache = {}; }

function duerme(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// iTunes Search: sin clave, sin registro y devuelve artista y título por
// separado, que es justo lo que hace falta para deshacer las inversiones.
async function busca(consulta) {
  if (consulta in cache) return cache[consulta];

  var url = 'https://itunes.apple.com/search?media=music&entity=song&limit=5'
          + '&country=' + encodeURIComponent(PAIS)
          + '&term=' + encodeURIComponent(consulta);

  for (var intento = 1; intento <= 3; intento++) {
    try {
      var res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (res.status === 403 || res.status === 429) {   // nos están frenando
        await duerme(4000 * intento);
        continue;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var datos = await res.json();
      var lista = (datos.results || []).map(function (r) {
        // La miniatura viene a 100 px; el catálogo sirve cualquier tamaño en
        // la misma ruta, y la ficha del reproductor la pinta a 600.
        return {
          artist: r.artistName,
          title: r.trackName,
          art: r.artworkUrl100 ? String(r.artworkUrl100).replace('100x100', '600x600') : ''
        };
      });
      cache[consulta] = lista;
      await duerme(PAUSA_MS);
      return lista;
    } catch (e) {
      // A propósito no se guarda nada en la caché al fallar: si se guardara,
      // un corte de red dejaría esta canción marcada como "sin resultado"
      // para siempre y ninguna ejecución posterior la volvería a intentar.
      if (intento === 3) return [];
      await duerme(1500 * intento);
    }
  }
  return [];
}

/* ── Puntuación ─────────────────────────────────────────────────────────── */

/* Se prueban las dos asignaciones posibles —tal cual y con artista y título
   intercambiados— y gana la que más se parezca. Así es como se resuelven los
   casos invertidos que la limpieza sintáctica no puede detectar. */
function puntua(limpio, candidato) {
  function combina(titulo, artista) {
    var st = pareceTitulo(titulo, candidato.title);
    var sa = dice(artista, candidato.artist);
    // El título pesa más: es lo que identifica la canción. Pero se exige un
    // mínimo en ambos, para que un artista muy común no arrastre la decisión.
    if (st < 0.55 || sa < 0.5) return 0;
    return 0.6 * st + 0.4 * sa;
  }
  var directo = combina(limpio.titulo, limpio.artista);
  var girado = combina(limpio.artista, limpio.titulo);
  return girado > directo
    ? { puntos: girado, invertido: true }
    : { puntos: directo, invertido: false };
}

/* ── Principal ──────────────────────────────────────────────────────────── */

// Sólo se ejecuta al invocarlo directamente; si se importa, quedan expuestas
// las piezas de dentro para poder probarlas sin tocar la emisora.
module.exports = { plano: plano, dice: dice, pareceTitulo: pareceTitulo,
                   puntua: puntua, busca: busca, normaliza: normaliza };

if (require.main !== module) return;

(async function () {
  if (!CLAVE_API) {
    console.error('Falta AZURACAST_API_KEY. El script lee el historial de emisión para');
    console.error('saber qué canciones hay que corregir.');
    process.exit(1);
  }

  console.log('1. Leyendo el historial de la emisora (' + SEMANAS + ' semanas)…');
  var canciones = await recogeCanciones();
  if (!canciones.length) {
    console.error('No se obtuvo ninguna canción. ¿La clave tiene permiso de ver informes?');
    process.exit(1);
  }

  // Sólo interesa lo que puede llegar al Top 40; el resto es ruido de una sola
  // emisión y multiplicaría las consultas sin cambiar nada de lo que se ve.
  var candidatas = canciones.filter(function (c) { return c.veces >= MIN_EMISIONES; });
  console.log('   ' + canciones.length + ' etiquetas distintas, ' +
              candidatas.length + ' con ' + MIN_EMISIONES + '+ emisiones.\n');

  console.log('2. Cotejando con el catálogo de iTunes…');
  var correcciones = Object.create(null);
  var revisar = [];
  var saltadas = 0, sinResultado = 0, yaBien = 0;

  for (var i = 0; i < candidatas.length; i++) {
    var c = candidatas[i];
    var limpio = normaliza(c);
    if (!limpio) { saltadas++; continue; }          // descartada por la limpieza

    process.stdout.write('\r   ' + (i + 1) + '/' + candidatas.length +
                         '  ·  aplicadas: ' + Object.keys(correcciones).length +
                         '  ·  a revisar: ' + revisar.length + '      ');

    var consulta = (limpio.artista + ' ' + limpio.titulo).trim();
    var resultados = await busca(consulta);
    if (!resultados.length) { sinResultado++; continue; }

    var mejor = null;
    resultados.forEach(function (r) {
      var p = puntua(limpio, r);
      if (!mejor || p.puntos > mejor.puntos) mejor = { puntos: p.puntos, invertido: p.invertido, r: r };
    });

    if (!mejor || mejor.puntos === 0) { sinResultado++; continue; }

    var propuesta = { artist: mejor.r.artist, title: mejor.r.title };
    if (mejor.r.art) propuesta.art = mejor.r.art;
    var registro = {
      original: { artist: c.artist, title: c.title },
      limpio: { artist: limpio.artista, title: limpio.titulo },
      propuesta: propuesta,
      confianza: Number(mejor.puntos.toFixed(3)),
      invertido: mejor.invertido,
      emisiones: c.veces
    };

    if (mejor.puntos >= UMBRAL) {
      var mismoNombre = plano(limpio.artista) === plano(propuesta.artist) &&
                        plano(limpio.titulo) === plano(propuesta.title);
      if (mismoNombre) {
        yaBien++;
        // El nombre no hay que tocarlo, pero la carátula sí interesa: la
        // emisora sirve la misma imagen por defecto para todo.
        if (!propuesta.art) continue;
        correcciones[limpio.clave] = { artist: limpio.artista, title: limpio.titulo, art: propuesta.art };
        continue;
      }
      correcciones[limpio.clave] = propuesta;
    } else {
      revisar.push(registro);
    }
  }
  process.stdout.write('\n\n');

  revisar.sort(function (a, b) { return b.emisiones - a.emisiones; });

  console.log('3. Resultado');
  console.log('   correcciones aplicadas : ' + Object.keys(correcciones).length);
  console.log('   ya estaban bien        : ' + yaBien + ' (se les guarda la carátula igual)');
  console.log('   con carátula           : ' +
    Object.keys(correcciones).filter(function (k) { return correcciones[k].art; }).length);
  console.log('   para revisar a mano    : ' + revisar.length);
  console.log('   sin coincidencia       : ' + sinResultado + '  (megamixes, ediciones de DJ…)');
  console.log('   descartadas al limpiar : ' + saltadas);

  if (SOLO_PRUEBA) {
    console.log('\n--dry-run: no se ha escrito nada.');
    return;
  }

  fs.writeFileSync(SALIDA, JSON.stringify({
    generado: new Date().toISOString(),
    fuente: 'itunes-search',
    umbral: UMBRAL,
    correcciones: correcciones
  }, null, 1));

  fs.writeFileSync(REVISAR, JSON.stringify({
    generado: new Date().toISOString(),
    nota: 'Nada de aquí se aplica. Para aceptar una, copia su "propuesta" a MANUALES en api/top40.js usando la clave que aparece en "clave".',
    dudosas: revisar.map(function (r) {
      var l = normaliza({ artist: r.original.artist, title: r.original.title });
      r.clave = l ? l.clave : null;
      return r;
    })
  }, null, 1));

  try { fs.writeFileSync(CACHE, JSON.stringify(cache)); } catch (e) { /* la caché es opcional */ }

  console.log('\nEscrito:');
  console.log('  ' + path.relative(process.cwd(), SALIDA) + '   (lo carga api/top40.js solo)');
  console.log('  ' + path.relative(process.cwd(), REVISAR) + '   (para que lo revises)');
})();
