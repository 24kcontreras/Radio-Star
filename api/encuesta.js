/* ==========================================================================
   RadioStar — encuesta del ranking en vídeo (función serverless de Vercel)

   Cuenta los votos de «cuál es el mejor tema del ranking». GET devuelve el
   recuento, POST suma un voto.

   El recuento vive en un Redis accesible por REST (Vercel KV o Upstash): es
   lo único que hace falta para tener un contador compartido sin arrastrar
   dependencias ni servidor propio. Las credenciales se leen del entorno y
   nunca viajan al navegador.

   Sin almacén configurado la función no falla: responde almacen:false y la
   página guarda el voto en el navegador de quien vota y lo dice claramente,
   en lugar de inventarse porcentajes.

   Sin dependencias: Node trae fetch desde la v18.
   ========================================================================== */

'use strict';

/* ── Configuración ──────────────────────────────────────────────────────── */

// La integración de Vercel KV publica KV_REST_API_*; Upstash a secas publica
// UPSTASH_REDIS_REST_*. Se aceptan las dos para no obligar a renombrar nada.
var REDIS_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
var REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

var CLAVE = 'radiostar:encuesta:ranking-top9';
var TIMEOUT_MS = 5000;

var CACHE_SEGUNDOS = 15;           // lo que el CDN sirve el recuento sin volver a Redis
var CACHE_OBSOLETO = 60;           // durante 1 min más sirve lo viejo mientras refresca

// Lista cerrada de respuestas válidas: son las nueve canciones del vídeo, en
// el mismo orden. Cualquier otra cosa que llegue por POST se descarta, que el
// cuerpo de la petición lo escribe quien quiere.
var OPCIONES = [
  'right-said-fred-im-too-sexy',
  'lighthouse-family-raincloud',
  'masterboy-dancing-forever',
  'duck-sauce-barbra-streisand',
  'edward-maya-stereo-love',
  'bob-sinclar-world-hold-on',
  'billy-more-up-and-down',
  'junior-jack-my-feeling',
  'paul-johnson-get-get-down'
];

/* ── Redis por REST ─────────────────────────────────────────────────────── */

var hayAlmacen = !!(REDIS_URL && REDIS_TOKEN);

// Un comando es un array: ['HINCRBY', clave, campo, 1]. La respuesta llega
// como { result: … }.
async function redis(comando) {
  var control = new AbortController();
  var reloj = setTimeout(function () { control.abort(); }, TIMEOUT_MS);

  try {
    var r = await fetch(REDIS_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + REDIS_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(comando),
      signal: control.signal
    });
    if (!r.ok) throw new Error('Redis HTTP ' + r.status);
    var data = await r.json();
    if (data && data.error) throw new Error(String(data.error));
    return data ? data.result : null;
  } finally {
    clearTimeout(reloj);
  }
}

// HGETALL devuelve una lista plana [campo, valor, campo, valor…]. Se convierte
// a objeto y se descarta lo que no esté en la lista de opciones, por si alguna
// vez cambia el vídeo y quedan campos viejos.
function aRecuento(plano) {
  var resultados = {};
  var total = 0;

  OPCIONES.forEach(function (id) { resultados[id] = 0; });

  if (Array.isArray(plano)) {
    for (var i = 0; i < plano.length; i += 2) {
      var id = String(plano[i]);
      var votos = Number(plano[i + 1]) || 0;
      if (OPCIONES.indexOf(id) === -1) continue;
      resultados[id] = votos;
      total += votos;
    }
  }

  return { resultados: resultados, total: total };
}

// El cuerpo llega ya parseado cuando el Content-Type es JSON, pero no siempre:
// con text/plain o sin cabecera llega como cadena.
function leeOpcion(req) {
  var cuerpo = req.body;
  if (typeof cuerpo === 'string') {
    try { cuerpo = JSON.parse(cuerpo); } catch (e) { return null; }
  }
  if (!cuerpo || typeof cuerpo !== 'object') return null;
  var opcion = String(cuerpo.opcion || '');
  return OPCIONES.indexOf(opcion) === -1 ? null : opcion;
}

/* ── Handler ────────────────────────────────────────────────────────────── */

module.exports = async function (req, res) {
  // El recuento cambia con cada voto: nada de caché, ni en el CDN ni en el
  // navegador. Es una respuesta diminuta y la función apenas trabaja.
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  // Sin almacén se responde 200 a propósito: no es un fallo, es que la
  // emisora todavía no ha conectado el contador. La página ya sabe qué hacer.
  if (!hayAlmacen) {
    res.status(200).json({
      almacen: false,
      total: 0,
      resultados: {},
      nota: 'Falta configurar KV_REST_API_URL y KV_REST_API_TOKEN para contar los votos.'
    });
    return;
  }

  try {
    if (req.method === 'POST') {
      var opcion = leeOpcion(req);
      if (!opcion) {
        res.status(400).json({ error: 'Opción no válida', almacen: true, total: 0, resultados: {} });
        return;
      }
      await redis(['HINCRBY', CLAVE, opcion, 1]);
    }

    var recuento = aRecuento(await redis(['HGETALL', CLAVE]));

    // El GET se cachea unos segundos en el CDN: con mucha visita, el recuento
    // se pide a Redis unas pocas veces por minuto en lugar de una por persona,
    // que es lo que agota la cuota de los planes gratuitos. Unos segundos de
    // retraso en un porcentaje no los nota nadie. El POST nunca se cachea: a
    // quien vota se le devuelve el recuento recién sumado.
    if (req.method === 'GET') {
      res.setHeader('Cache-Control',
        'public, s-maxage=' + CACHE_SEGUNDOS + ', stale-while-revalidate=' + CACHE_OBSOLETO);
    }

    res.status(200).json({
      almacen: true,
      actualizado: new Date().toISOString(),
      total: recuento.total,
      resultados: recuento.resultados
    });

  } catch (e) {
    res.status(502).json({
      error: String((e && e.message) || e),
      almacen: false,
      total: 0,
      resultados: {}
    });
  }
};

// Se exporta para poder probar el recuento sin tocar Redis.
module.exports.__test = { aRecuento: aRecuento, leeOpcion: leeOpcion, OPCIONES: OPCIONES };
