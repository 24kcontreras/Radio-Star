/* ==========================================================================
   RadioStar — noticias musicales (cliente)

   Pide /api/noticias y pinta la rejilla. El HTML trae esqueletos para que la
   sección no salte de alto mientras carga; si la petición falla se deja un
   aviso con enlace a la fuente en lugar de un hueco vacío.
   JavaScript plano, sin dependencias.
   ========================================================================== */
(function () {
  'use strict';

  var grid = document.querySelector('[data-noticias]');
  if (!grid) return;

  var FECHA = { day: 'numeric', month: 'short' };

  function fechaCorta(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-CL', FECHA).replace('.', '');
  }

  // Todo lo que llega del feed es texto ajeno: se inserta con textContent y
  // nunca como HTML, para que un titular no pueda inyectar marcado.
  function el(tag, clase, contenido) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    if (contenido != null) n.textContent = contenido;
    return n;
  }

  function tarjeta(n) {
    var art = el('article', 'news-item');

    var media = el('div', 'news-media grayscale');
    if (n.imagen) {
      var img = new Image();
      img.src = n.imagen;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      // Si la imagen remota falla, queda el fondo gris de .news-media.
      img.addEventListener('error', function () { img.remove(); });
      media.appendChild(img);
    } else {
      media.setAttribute('role', 'img');
      media.setAttribute('aria-label', 'Imagen de la noticia · ' + n.titulo);
    }
    art.appendChild(media);

    var partes = [fechaCorta(n.fecha), n.seccion].filter(Boolean);
    art.appendChild(el('div', 'news-meta', partes.join(' · ')));

    var h3 = el('h3');
    var a = el('a', 'news-link', n.titulo);
    a.href = n.enlace;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    h3.appendChild(a);
    art.appendChild(h3);

    if (n.resumen) art.appendChild(el('p', null, n.resumen));

    // Atribución: la noticia no es nuestra, se dice de quién es.
    art.appendChild(el('div', 'news-fuente', 'vía ' + n.fuente));

    return art;
  }

  function pinta(noticias) {
    var frag = document.createDocumentFragment();
    noticias.forEach(function (n) { frag.appendChild(tarjeta(n)); });
    grid.textContent = '';
    grid.appendChild(frag);
    grid.removeAttribute('aria-busy');
  }

  function falla() {
    grid.textContent = '';
    grid.removeAttribute('aria-busy');
    var aviso = el('p', 'news-error',
      'Ahora mismo no podemos cargar las noticias. Vuelve a intentarlo en un rato.');
    grid.appendChild(aviso);
  }

  fetch('/api/noticias', { headers: { 'Accept': 'application/json' } })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      if (data && data.noticias && data.noticias.length) pinta(data.noticias);
      else falla();
    })
    .catch(falla);
})();
