/* ==========================================================================
   RadioStar — noticias musicales (función serverless de Vercel)

   Lee el RSS de la fuente en el servidor y lo devuelve como JSON ya limpio.
   Se hace aquí y no en el navegador por dos motivos: el feed no manda
   cabeceras CORS, y así la respuesta queda cacheada en el CDN de Vercel en
   lugar de pedirse una vez por visitante.

   Sin dependencias: Node trae fetch desde la v18 y el feed tiene una
   estructura fija, así que se extrae con expresiones regulares.
   ========================================================================== */

'use strict';

var FUENTES = [
  { nombre: '20minutos', url: 'https://www.20minutos.es/rss/musica/' }
];

var MAX_NOTICIAS = 12;
var TIMEOUT_MS = 8000;

// Cuánto cachea el CDN antes de volver a pedir el feed. Con esto la función
// se ejecuta ~4 veces por hora como mucho, da igual cuánta gente entre.
var CACHE_SEGUNDOS = 900;          // 15 min
var CACHE_OBSOLETO = 3600;         // durante 1 h más sirve lo viejo mientras refresca

/* ── Utilidades ─────────────────────────────────────────────────────────── */

var ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', deg: '°', eacute: 'é'
};

function decodifica(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) {
      return String.fromCodePoint(parseInt(h, 16));
    })
    .replace(/&#(\d+);/g, function (_, d) {
      return String.fromCodePoint(parseInt(d, 10));
    })
    .replace(/&([a-z]+);/gi, function (m, n) {
      var v = ENTIDADES[n.toLowerCase()];
      return v === undefined ? m : v;
    });
}

// Quita etiquetas, normaliza espacios y recorta sin partir una palabra.
function texto(s, limite) {
  var t = decodifica(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!limite || t.length <= limite) return t;
  var corte = t.slice(0, limite);
  var espacio = corte.lastIndexOf(' ');
  if (espacio > limite * 0.6) corte = corte.slice(0, espacio);
  return corte.replace(/[\s,;:.—-]+$/, '') + '…';
}

function campo(xml, etiqueta) {
  var m = xml.match(new RegExp('<' + etiqueta + '[^>]*>([\\s\\S]*?)</' + etiqueta + '>', 'i'));
  return m ? m[1] : '';
}

// La imagen puede venir como <enclosure>, como <media:content> o incrustada
// en la descripción; se prueban las tres por orden de fiabilidad.
function imagen(xml) {
  var m = xml.match(/<enclosure[^>]+url="([^"]+)"[^>]*type="image\//i)
       || xml.match(/<enclosure[^>]+type="image\/[^"]*"[^>]+url="([^"]+)"/i)
       || xml.match(/<media:(?:content|thumbnail)[^>]+url="([^"]+)"/i)
       || xml.match(/<img[^>]+src="([^"]+)"/i);
  if (!m) return null;
  var url = decodifica(m[1]);
  return /^https:\/\//i.test(url) ? url : null;   // sólo https, si no el navegador lo bloquea
}

function aISO(pubDate) {
  var d = new Date(decodifica(pubDate).trim());
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/* ── Lectura de un feed ─────────────────────────────────────────────────── */

async function leeFuente(fuente) {
  var ctrl = new AbortController();
  var reloj = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);

  try {
    var res = await fetch(fuente.url, {
      signal: ctrl.signal,
      headers: {
        // Sin User-Agent propio varios servidores devuelven 403.
        'User-Agent': 'RadioStarOnline/1.0 (+https://radiostaronline.com)',
        'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
      }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    var xml = await res.text();
    var bloques = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];

    return bloques.map(function (b) {
      var enlace = texto(campo(b, 'link')) || texto(campo(b, 'guid'));
      var titulo = texto(campo(b, 'title'), 110);
      if (!enlace || !titulo) return null;
      return {
        titulo: titulo,
        resumen: texto(campo(b, 'description'), 130),
        enlace: enlace,
        imagen: imagen(b),
        seccion: texto(campo(b, 'category'), 24) || 'Música',
        fuente: fuente.nombre,
        fecha: aISO(campo(b, 'pubDate'))
      };
    }).filter(Boolean);

  } finally {
    clearTimeout(reloj);
  }
}

/* ── Handler ────────────────────────────────────────────────────────────── */

module.exports = async function (req, res) {
  try {
    var tandas = await Promise.allSettled(FUENTES.map(leeFuente));
    var noticias = [];

    tandas.forEach(function (t) {
      if (t.status === 'fulfilled') noticias = noticias.concat(t.value);
    });

    // Si todas las fuentes fallaron es un error real; que el cliente conserve
    // lo que ya tuviera pintado en lugar de vaciar la sección.
    if (!noticias.length) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(502).json({ error: 'No se pudo leer ninguna fuente', noticias: [] });
      return;
    }

    // Quita repetidos por enlace y ordena de más nueva a más vieja.
    var vistos = Object.create(null);
    noticias = noticias.filter(function (n) {
      if (vistos[n.enlace]) return false;
      vistos[n.enlace] = true;
      return true;
    });
    noticias.sort(function (a, b) {
      return (b.fecha || '').localeCompare(a.fecha || '');
    });

    res.setHeader('Cache-Control',
      'public, s-maxage=' + CACHE_SEGUNDOS + ', stale-while-revalidate=' + CACHE_OBSOLETO);
    res.status(200).json({
      actualizado: new Date().toISOString(),
      noticias: noticias.slice(0, MAX_NOTICIAS)
    });

  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ error: String((e && e.message) || e), noticias: [] });
  }
};
