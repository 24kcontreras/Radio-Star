/* ==========================================================================
   RadioStar — lógica de la página
   Reproductor, Top 40, filtros de programas, boletín y barra fija.
   JavaScript plano, sin dependencias.
   ========================================================================== */
(function () {
  'use strict';

  /* ── Datos ─────────────────────────────────────────────────────────────── */
  // El Top 40 sale del historial real de emisión: lo calcula /api/top40
  // contando lo que la emisora ha puesto al aire estos últimos 7 días.
  // Hasta que responda, la lista está vacía a propósito: antes un hueco
  // honesto que una lista inventada.
  var CHART = [];

  var VISIBLE_ROWS = 10;  // filas del Top 40 antes de "Ver los 40 completos"
  var CARGANDO = 'Contando las emisiones de la semana…';
  var SIN_LISTA = 'El Top 40 no está disponible ahora mismo. Vuelve a intentarlo en un rato.';
  var chartAviso = CARGANDO;   // lo que se enseña mientras la tabla está vacía
  // Lo que se anuncia mientras hay alguien al aire y el emisor no manda título.
  var EN_DIRECTO = 'Transmitiendo desde nuestro estudio';
  var VOL_STEPS = 10;

  /* ── Preferencias guardadas ────────────────────────────────────────────── */
  // Volumen y canciones marcadas sobreviven a la recarga. En navegación
  // privada localStorage puede fallar: entonces se sigue sin persistencia.
  function storeGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function storeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* sin espacio o bloqueado */ }
  }

  /* ── Estado ────────────────────────────────────────────────────────────── */
  var state = {
    mode: 'audio',
    playing: false,
    vol: storeGet('rs-vol', 7),
    lastVol: 7,       // nivel al que vuelve el botón de silencio
    idx: 0,
    liked: storeGet('rs-likes', {}),
    secs: 0,
    full: false,
    scrolled: false,
    live: null,       // lo que emite la estación ahora mismo (null = sin datos)
    liveIdx: null,    // fila del Top 40 que suena, si es que está en la lista
    liveSong: null,   // la canción con sus etiquetas crudas, para buscarla en la lista
    siguiente: null,  // la que viene después, para repintarla al llegar el diccionario
    np: null,         // respuesta completa de la emisora (oyentes, historial…)
    status: 'idle'    // idle | loading | playing | error
  };

  if (state.vol > 0) state.lastVol = state.vol;

  var audio = document.getElementById('rs-audio');
  var bar = document.querySelector('[data-player-bar]');
  var hasVideo = !!(audio && audio.dataset.video);
  var pageTitle = document.title;

  /* ── Utilidades ────────────────────────────────────────────────────────── */
  function pad(n) { return String(n).padStart(2, '0'); }

  function clock(secs) {
    var m = Math.floor(Math.max(secs, 0) / 60);
    return m + ':' + pad(Math.floor(Math.max(secs, 0) % 60));
  }

  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // Escribe el mismo valor en todos los puntos de anclaje con ese nombre:
  // el título de la canción aparece en el hero, en la carátula y en la barra.
  function bind(name, value) {
    $all('[data-bind="' + name + '"]').forEach(function (el) { el.textContent = value; });
  }

  // Igual que bind, pero para las imágenes (la carátula aparece en la ficha y
  // en la barra fija). Sin URL se conserva la que ya tuviera el HTML.
  function bindSrc(name, url) {
    $all('[data-bind="' + name + '"]').forEach(function (el) {
      if (!url) {
        // Sin imagen se esconde y queda el fondo del contenedor. Conservar la
        // anterior sería peor: enseñaría la portada de la canción pasada.
        el.hidden = true;
        el.removeAttribute('src');
        return;
      }
      if (el.getAttribute('src') !== url) el.setAttribute('src', url);
      el.hidden = false;
    });
  }

  // Lo que se muestra: manda siempre la emisión en directo. El Top 40 sólo
  // entra cuando el oyente ha pulsado una fila y la emisora aún no ha dicho
  // qué suena. Puede no haber nada: entonces se deja el texto del HTML.
  function currentTrack() {
    return state.live || CHART[state.idx] || null;
  }

  function likeKey(t) {
    return String(t.title || '').toLowerCase() + '|' + String(t.artist || '').toLowerCase();
  }

  function elapsedText() {
    var h = Math.floor(state.secs / 3600);
    var m = Math.floor((state.secs % 3600) / 60);
    var s = state.secs % 60;
    return h + ':' + pad(m) + ':' + pad(s);
  }

  /* ── Top 40 ────────────────────────────────────────────────────────────── */
  // Los nombres vienen de las etiquetas de los archivos de la emisora, así que
  // son texto ajeno: la tabla se construye con nodos, nunca con innerHTML.
  function el(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto != null) n.textContent = texto;
    return n;
  }

  function esNueva(t) { return t.prev === null || t.prev === undefined; }

  function movimiento(t) {
    if (esNueva(t)) return { clase: 'move-up', texto: 'NUEVA' };
    var diff = Math.abs(t.prev - t.pos);
    if (t.prev > t.pos) return { clase: 'move-up', texto: '▲ ' + diff };
    if (t.prev < t.pos) return { clase: 'move-down', texto: '▼ ' + diff };
    return { clase: 'move-flat', texto: '—' };
  }

  function trendText(t) {
    if (esNueva(t)) return 'entra nueva';
    if (t.prev === t.pos) return 'se mantiene';
    return (t.prev > t.pos ? '▲ sube ' : '▼ baja ') + Math.abs(t.prev - t.pos);
  }

  // Una fila ocupando toda la tabla, para «cargando» y para los errores.
  function filaAviso(texto) {
    var tr = document.createElement('tr');
    var td = el('td', 'chart-aviso', texto);
    td.colSpan = 5;
    tr.appendChild(td);
    return tr;
  }

  function filaCancion(t, i) {
    var tr = document.createElement('tr');
    tr.dataset.row = String(i);

    tr.appendChild(el('td', 'chart-pos', pad(t.pos)));

    var celda = el('td');
    celda.style.minWidth = '0';
    var song = el('div', 'chart-song');
    // La marca roja señala la canción que está sonando de verdad ahora mismo.
    if (i === state.liveIdx) {
      var cur = el('span', 'chart-cur');
      cur.setAttribute('aria-hidden', 'true');
      song.appendChild(cur);
    }
    var caja = el('div');
    caja.style.minWidth = '0';
    caja.appendChild(el('div', 'chart-name', t.title));
    caja.appendChild(el('div', 'chart-artist', t.artist));
    caja.appendChild(el('div', 'chart-trend-mobile', trendText(t) + ' · ' + t.weeks + ' sem.'));
    song.appendChild(caja);
    celda.appendChild(song);
    tr.appendChild(celda);

    var mov = movimiento(t);
    var tdPrev = el('td', 'col-prev');
    tdPrev.appendChild(el('span', mov.clase, mov.texto));
    tr.appendChild(tdPrev);

    tr.appendChild(el('td', 'col-weeks chart-weeks', t.weeks));

    var tdBtn = el('td');
    var btn = el('button', 'btn btn-secondary btn-icon');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Reproducir ' + t.title);
    var tri = el('span', 'tri');
    tri.style.setProperty('--tri', '9px');
    tri.style.marginLeft = '2px';
    tri.setAttribute('aria-hidden', 'true');
    btn.appendChild(tri);
    tdBtn.appendChild(btn);
    tr.appendChild(tdBtn);

    return tr;
  }

  function renderChart() {
    var tbody = document.querySelector('[data-chart]');
    if (!tbody) return;

    tbody.textContent = '';

    if (!CHART.length) {
      tbody.appendChild(filaAviso(chartAviso));
      tbody.setAttribute('aria-busy', chartAviso === CARGANDO ? 'true' : 'false');
      return;
    }

    var limit = state.full ? CHART.length : Math.min(CHART.length, VISIBLE_ROWS);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < limit; i++) frag.appendChild(filaCancion(CHART[i], i));
    tbody.appendChild(frag);
    tbody.setAttribute('aria-busy', 'false');
  }

  /* ── Volumen ───────────────────────────────────────────────────────────── */
  function renderVolume() {
    var box = document.querySelector('.vol-blocks');
    if (!box) return;
    if (box.children.length !== VOL_STEPS) {
      box.innerHTML = '';
      for (var i = 0; i < VOL_STEPS; i++) {
        var b = document.createElement('button');
        b.type = 'button';
        b.dataset.vol = String(i + 1);
        b.title = 'Volumen ' + (i + 1) + ' de ' + VOL_STEPS;
        b.setAttribute('aria-label', b.title);
        box.appendChild(b);
      }
    }
    $all('button', box).forEach(function (b, i) {
      // La altura crece de izquierda a derecha: la escala se lee de un vistazo.
      b.style.height = (8 + i * 1.8) + 'px';
      b.classList.toggle('is-on', i < state.vol);
    });
    if (audio) audio.volume = state.vol / VOL_STEPS;
  }

  /* ── Render general ────────────────────────────────────────────────────── */
  function render() {
    var t = currentTrack();

    document.body.classList.toggle('is-playing', state.playing);

    // Mientras la emisora no diga qué suena y nadie haya pulsado una fila, no
    // hay canción que anunciar: se deja el texto que trae el HTML en lugar de
    // pintar huecos. Lo demás del render sigue su curso.
    if (t) {
      bind('track-title', t.title);
      bind('track-artist', t.artist);
      bind('track-album', t.album);
      bind('track-pos', t.pos ? pad(t.pos) : '—');
      bindSrc('cover', t.art);

      // El distintivo "Nº X del Top 40" sólo tiene sentido si la canción figura
      // en la lista; lo que suena en directo muchas veces no está.
      $all('[data-bind="track-pos"]').forEach(function (el) {
        var tag = el.closest('.tag');
        if (tag) tag.hidden = !t.pos;
      });

      // Muchos archivos llegan sin artista o sin álbum en sus etiquetas: se
      // ocultan los separadores para no dejar guiones sueltos.
      $all('[data-sep="artist"]').forEach(function (el) { el.hidden = !t.artist; });
      $all('[data-sep="album"]').forEach(function (el) { el.hidden = !(t.artist && t.album); });
    } else if (state.online === false) {
      // La emisora no contesta: el "Conectando…" del HTML dejaría de ser cierto.
      bind('track-title', 'Sin señal de la emisora');
    }

    bind('elapsed', elapsedText());
    bind('bar-kicker', state.mode === 'video'
      ? 'RadioStar TV · en directo'
      : 'RadioStar · en directo');

    // Play / pausa en los tres reproductores (hero, vídeo, barra fija).
    $all('[data-when="playing"]').forEach(function (el) { el.hidden = !state.playing; });
    $all('[data-when="paused"]').forEach(function (el) { el.hidden = state.playing; });

    // Paneles de señal.
    $all('[data-mode-panel]').forEach(function (el) {
      el.hidden = el.dataset.modePanel !== state.mode;
    });
    $all('input[name="rs-mode"], input[name="rs-mode-bar"]').forEach(function (r) {
      r.checked = r.value === state.mode;
    });
    $all('.bar-swap [data-when]').forEach(function (el) {
      el.hidden = el.dataset.when !== state.mode;
    });

    // Me gusta: se guarda por canción, no por posición del Top 40, para que
    // siga valiendo cuando lo que suena viene de la emisora.
    var likeBtn = document.querySelector('[data-action="like"]');
    if (likeBtn) {
      likeBtn.disabled = !t;
      var liked = !!(t && state.liked[likeKey(t)]);
      likeBtn.setAttribute('aria-pressed', String(liked));
      var path = likeBtn.querySelector('svg');
      if (path) {
        path.setAttribute('fill', liked ? 'var(--color-accent)' : 'none');
        path.setAttribute('stroke', liked ? 'var(--color-accent)' : 'currentColor');
      }
      bind('like-label', liked ? 'Guardada' : 'Me gusta');
    }

    var fullBtn = document.querySelector('[data-action="toggle-full"]');
    if (fullBtn) {
      fullBtn.hidden = CHART.length <= VISIBLE_ROWS;
      fullBtn.textContent = state.full
        ? 'Ver el top ' + VISIBLE_ROWS
        : 'Ver los ' + CHART.length + ' completos';
    }

    if (bar) bar.classList.toggle('is-visible', state.scrolled);

    // El distintivo de directo dice la verdad: si la emisora no responde o
    // está parada, deja de anunciarse en rojo.
    var badge = document.querySelector('[data-live-badge]');
    var offAir = state.online === false;
    if (badge) badge.classList.toggle('is-off', offAir);
    bind('live-state', offAir ? 'FUERA DE AIRE' : 'EN DIRECTO');
    bind('elapsed-label', statusLabel());

    renderProgress();

    // La pestaña del navegador también canta lo que suena.
    document.title = (state.playing && state.live)
      ? '▶ ' + state.live.title + ' · RadioStar'
      : pageTitle;

    renderVolume();
  }

  function statusLabel() {
    if (state.status === 'loading') return 'Conectando';
    if (state.status === 'error') return 'Sin señal';
    if (state.playing) return 'Emitiendo';
    return 'En pausa';
  }

  /* ── Reproducción ──────────────────────────────────────────────────────── */
  // El <audio> sólo suena si se ha configurado data-stream; sin él la página
  // funciona igual como demostración visual.
  function syncAudio() {
    if (!audio || !audio.dataset.stream) return;
    if (!audio.src) audio.src = audio.dataset.stream;
    if (state.playing) {
      state.status = 'loading';
      var p = audio.play();
      if (p && p.catch) p.catch(function () {
        // El navegador puede negarse —la reproducción con sonido sin permiso
        // está bloqueada—. Hay que volver a "en pausa": si no, el botón
        // enseñaría "detener" sin que suene nada y habría que pulsarlo dos
        // veces para arrancar.
        if (!state.playing) return;
        state.playing = false;
        state.status = 'idle';
        esperaGesto();
        render();
      });
    } else {
      state.status = 'idle';
      // Un directo no se pausa: se corta y se vuelve a pedir al reanudar, así
      // nadie se queda escuchando un trozo viejo del búfer.
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
  }

  // Estados reales del audio: conectando, sonando, caído.
  if (audio) {
    audio.addEventListener('playing', function () {
      state.status = 'playing';
      render();
    });
    audio.addEventListener('waiting', function () {
      state.status = 'loading';
      render();
    });
    // 'stalled' no se escucha: salta también en pausas normales del búfer y
    // cortaría el sonido sin motivo. Los cortes silenciosos —que no lanzan
    // ningún evento— los detecta vigilaEmision() mirando el reloj.
    // Van envueltos a propósito: como listener directo, el objeto Event
    // llegaría como primer argumento y activaría la reconexión forzada.
    audio.addEventListener('error', function () { reconnect(); });
    audio.addEventListener('ended', function () { reconnect(); });

    // El sistema puede pausar el elemento por su cuenta: una llamada entrante,
    // otra app tomando el audio, o el navegador liberando recursos. Si para
    // nosotros seguíamos emitiendo, se reanuda.
    audio.addEventListener('pause', function () {
      if (!state.playing) return;
      setTimeout(function () {
        if (state.playing && audio.paused) {
          var p = audio.play();
          if (p && p.catch) p.catch(function () {});
        }
      }, 300);
    });
  }

  // Si se cae la conexión mientras se escucha, se reintenta solo: un corte de
  // red no debería obligar a recargar la página.
  var reconnectAt = 0;
  var reconexiones = [];        // marcas de tiempo de los últimos intentos

  /* Si hay que reconectar muchas veces seguidas, el problema es la conexión o
     el servidor, no un corte puntual. Insistir cada dos segundos entonces sólo
     empeora las cosas y es lo que se oye como audio entrecortado: cada intento
     tira el búfer. A partir del cuarto intento en un minuto se espera mucho
     más entre uno y otro. */
  function reconexionesRecientes() {
    var ahora = Date.now();
    reconexiones = reconexiones.filter(function (t) { return ahora - t < 60000; });
    return reconexiones.length;
  }

  // forzar = true salta la espera entre intentos y reconecta en el acto. Se usa
  // al volver de la pantalla bloqueada, donde hacer esperar al oyente dos
  // segundos más no tiene ningún sentido.
  function reconnect(forzar) {
    if (!state.playing) return;
    if (!forzar && Date.now() - reconnectAt < 4000) return;   // un intento cada 4 s

    var insistiendo = reconexionesRecientes() >= 3;
    reconexiones.push(Date.now());
    reconnectAt = Date.now();
    state.status = 'error';
    render();

    setTimeout(function () {
      if (!state.playing) return;
      // El parámetro extra evita que el navegador reutilice la conexión rota.
      audio.src = audio.dataset.stream + '?_=' + Date.now();
      var p = audio.play();
      if (p && p.catch) p.catch(function () {});
      marcaAvance();
    }, forzar && !insistiendo ? 0 : (insistiendo ? 15000 : 2000));
  }

  /* ── Vigilancia de la emisión ──────────────────────────────────────────── */
  /* Un directo que se corta muchas veces no avisa: el <audio> no lanza ni
     'error' ni 'ended', simplemente deja de avanzar y se queda así. Es lo que
     ocurre con el móvil bloqueado cuando el sistema suspende la red o se pasa
     de wifi a datos. La única señal fiable es que currentTime deje de correr. */
  var ultimoTiempo = -1;
  var ultimoAvance = 0;
  var intentoSuave = 0;

  /* Márgenes deliberadamente amplios. Reconectar de más es peor que tardar:
     tira el búfer y vuelve a empezar, que con mala cobertura empeora las
     cosas y suena entrecortado. Un directo muerto sigue muerto dentro de
     20 s; un rebuffer normal se resuelve mucho antes. */
  var SIN_AVANCE_MS = 20000;
  var REINTENTO_SUAVE_MS = 6000;

  function marcaAvance() {
    ultimoTiempo = -1;
    ultimoAvance = Date.now();
    intentoSuave = 0;
  }

  function vigilaEmision() {
    if (!audio || !audio.dataset.stream || !state.playing) return;
    if (audio.paused) return;              // de eso se encarga el listener de 'pause'

    if (audio.currentTime !== ultimoTiempo) {
      ultimoTiempo = audio.currentTime;
      ultimoAvance = Date.now();
      intentoSuave = 0;
      return;
    }

    if (!ultimoAvance || Date.now() - ultimoAvance <= SIN_AVANCE_MS) return;

    // Escalón 1, barato y silencioso: pedirle que siga. Conserva el búfer, así
    // que si la emisión estaba viva el oyente no nota nada.
    if (!intentoSuave) {
      intentoSuave = Date.now();
      var p = audio.play();
      if (p && p.catch) p.catch(function () {});
      return;
    }

    // Escalón 2: ni con esas arranca. Ahora sí se tira la conexión.
    if (Date.now() - intentoSuave > REINTENTO_SUAVE_MS) {
      intentoSuave = 0;
      reconnect();
    }
  }

  /* Al desbloquear el teléfono los temporizadores han estado parados o muy
     ralentizados, así que el vigilante puede llevar minutos sin ejecutarse. Se
     comprueba el estado en el acto en lugar de esperar al siguiente tic. */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !state.playing || !audio) return;

    /* Sólo se reconecta si está realmente muerto: parado, o sin ningún dato.
       Antes bastaba readyState < 3, y eso incluye el 2 —búfer bajo pero
       sonando—, que es un estado normal y pasajero: el resultado era cortar
       el sonido cada vez que el oyente volvía a la pestaña. */
    if (audio.paused || audio.readyState < 2) { reconnect(true); return; }

    marcaAvance();   // vivo: se le da margen y ya decidirá el vigilante
  });

  /* ── Arranque automático ───────────────────────────────────────────────── */
  /* La emisora quiere que suene nada más entrar. Los navegadores bloquean la
     reproducción automática con sonido salvo que el visitante ya tenga
     historial en el dominio, y en móvil la bloquean casi siempre, así que esto
     es un intento, no una garantía.

     Cuando lo deniegan no se toca el estado —el botón sigue diciendo
     "reproducir", que es la verdad— y se queda armado el arranque al primer
     toque en cualquier parte de la página, que es lo más cerca de "suena al
     entrar" que permite la web. */
  var gestoArmado = false;

  function esperaGesto() {
    if (gestoArmado || !audio || !audio.dataset.stream) return;
    gestoArmado = true;

    function arranca(e) {
      // Si el toque fue sobre un control, se desarma y se deja que lo maneje
      // quien corresponde: si no, el botón de play arrancaría aquí y su propio
      // manejador lo pararía acto seguido.
      var enControl = e.target && e.target.closest && e.target.closest('[data-action]');
      document.removeEventListener('pointerdown', arranca, true);
      gestoArmado = false;
      if (!enControl && !state.playing) setPlaying(true);
    }

    document.addEventListener('pointerdown', arranca, true);
  }

  function intentaAutoarranque() {
    if (!audio || !audio.dataset.stream) return;
    if (audio.dataset.autoplay === undefined) return;   // se activa desde el HTML

    if (!audio.src) audio.src = audio.dataset.stream;
    var p = audio.play();
    if (!p || !p.then) { esperaGesto(); return; }

    p.then(function () {
      // Concedido: se refleja sin haber prometido nada antes de tiempo.
      state.playing = true;
      marcaAvance();
      render();
      if ('mediaSession' in navigator) {
        try { navigator.mediaSession.playbackState = 'playing'; } catch (e) { /* sin soporte */ }
      }
    }).catch(function () {
      esperaGesto();
    });
  }

  function setPlaying(on) {
    state.playing = on;
    marcaAvance();               // el vigilante parte de cero en cada cambio
    syncAudio();
    render();
    // El sistema operativo necesita saberlo para mantener vivos los mandos de
    // la pantalla de bloqueo; sin esto se quedan desincronizados.
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = on ? 'playing' : 'paused'; }
      catch (e) { /* navegador sin soporte completo */ }
    }
  }

  function selectTrack(i) {
    state.idx = i;
    state.playing = true;
    syncAudio();
    renderChart();
    render();
  }

  /* ── Eventos ───────────────────────────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-action]');

    if (trigger) {
      switch (trigger.dataset.action) {
        case 'toggle':
          setPlaying(!state.playing);
          return;

        case 'play-here':
        case 'play-show':
          setPlaying(true);
          if (trigger.dataset.action === 'play-here') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
          return;

        case 'mute':
          if (state.vol === 0) {
            state.vol = state.lastVol || 7;
          } else {
            state.lastVol = state.vol;
            state.vol = 0;
          }
          storeSet('rs-vol', state.vol);
          render();
          return;

        case 'like':
          var actual = currentTrack();
          if (!actual) return;
          var key = likeKey(actual);
          if (state.liked[key]) {
            delete state.liked[key];
          } else {
            state.liked[key] = true;
          }
          storeSet('rs-likes', state.liked);
          render();
          return;

        case 'share':
          share();
          return;

        case 'toggle-full':
          state.full = !state.full;
          renderChart();
          render();
          return;

        case 'swap-mode':
          state.mode = state.mode === 'video' ? 'audio' : 'video';
          render();
          return;
      }
    }

    // Volumen: cada bloque fija su nivel.
    var volBtn = e.target.closest('.vol-blocks button');
    if (volBtn) {
      state.vol = Number(volBtn.dataset.vol);
      state.lastVol = state.vol;
      storeSet('rs-vol', state.vol);
      render();
      return;
    }

    // Fila del Top 40: la lleva al reproductor.
    var row = e.target.closest('[data-chart] tr[data-row]');
    if (row) selectTrack(Number(row.dataset.row));
  });

  // Cambio de señal audio / vídeo desde cualquiera de los dos selectores.
  document.addEventListener('change', function (e) {
    var r = e.target;
    if (r.name === 'rs-mode' || r.name === 'rs-mode-bar') {
      state.mode = r.value;
      render();
      return;
    }
    if (r.name === 'rs-pod') filterShows(Number(r.value));
  });

  function filterShows(group) {
    $all('.show-card').forEach(function (card) {
      var groups = (card.dataset.filters || '').split(',');
      card.hidden = groups.indexOf(String(group)) === -1;
    });
  }

  function share() {
    var t = currentTrack();
    var suena = t ? (t.artist ? t.title + ' — ' + t.artist : t.title) : '';
    var data = {
      title: 'RadioStar',
      text: suena ? 'Suena ' + suena + ' en RadioStar' : 'Escucha RadioStar en directo',
      url: location.href
    };
    if (navigator.share) {
      navigator.share(data).catch(function () { /* cancelado */ });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(data.text + ' ' + data.url)
        .then(function () { flashShare('Enlace copiado'); })
        .catch(function () {});
    }
  }

  // Sin Web Share no hay diálogo del sistema: el botón confirma por su cuenta.
  var shareTimer;
  function flashShare(msg) {
    bind('share-label', msg);
    clearTimeout(shareTimer);
    shareTimer = setTimeout(function () { bind('share-label', 'Compartir'); }, 2000);
  }

  // Boletín: validación mínima, sin backend. Conecta aquí tu servicio de correo.
  var form = document.querySelector('[data-newsletter]');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = form.querySelector('input[type="email"]');
      if (!email || email.value.indexOf('@') < 1) {
        if (email) email.focus();
        return;
      }
      form.hidden = true;
      var ok = document.querySelector('[data-newsletter-ok]');
      if (ok) ok.hidden = false;
    });
  }

  /* ── Barra fija al desplazar ───────────────────────────────────────────── */
  function onScroll() {
    var y = window.scrollY || document.documentElement.scrollTop || 0;
    var past = y > Math.max(240, window.innerHeight * 0.6);
    if (past !== state.scrolled) {
      state.scrolled = past;
      if (bar) bar.classList.toggle('is-visible', past);
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ── Sección activa en la navegación ───────────────────────────────────── */
  var navLinks = $all('.nav-main a, .nav-mobile a');
  var sections = navLinks
    .map(function (a) { return document.querySelector(a.getAttribute('href')); })
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var id = '#' + entry.target.id;
        navLinks.forEach(function (a) {
          a.classList.toggle('is-active', a.getAttribute('href') === id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ── Reloj de emisión ──────────────────────────────────────────────────── */
  setInterval(function () {
    if (state.playing) {
      state.secs += 1;
      bind('elapsed', elapsedText());
    }
    // Comprueba que la emisión sigue viva. Va aquí y no en su propio
    // temporizador porque con la pantalla apagada el navegador ralentiza los
    // temporizadores, y cuantos menos haya, mejor se porta.
    vigilaEmision();
    // El progreso de la canción avanza aunque no se esté escuchando: la
    // emisora sigue emitiendo al otro lado.
    renderProgress();
  }, 1000);

  /* ── Canción en directo ────────────────────────────────────────────────── */
  // AzuraCast publica lo que está emitiendo en /api/nowplaying/<estación>;
  // la URL se configura en data-nowplaying. Sin ella la página no consulta
  // nada y la ficha de "suena ahora" se queda con el texto del HTML.
  var NP_URL = audio && audio.dataset.nowplaying;
  var NP_EVERY = 15000;   // la API se cachea 15 s: pedirla más seguido no aporta
  var NP_RETRY = 30000;   // si la estación no responde, se espera más

  // /api/top40 devuelve, con cada puesto, las variantes de etiqueta
  // «artista|título» con las que esa canción ha salido al aire. Buscando por
  // ahí se reconoce lo que suena sin duplicar en el cliente la limpieza de
  // metadatos que ya hace el servidor.
  var porEtiqueta = Object.create(null);

  // Nombre presentable de CUALQUIER canción emitida esta semana, esté o no en
  // la lista. Es lo que evita que la ficha de "suena ahora" enseñe la etiqueta
  // cruda cada vez que suena algo que no llega al Top 40, que es a menudo.
  var NOMBRES = Object.create(null);

  function indexaEtiquetas() {
    porEtiqueta = Object.create(null);
    CHART.forEach(function (t, i) {
      (t.keys || []).forEach(function (k) {
        if (!(k in porEtiqueta)) porEtiqueta[k] = i;
      });
    });
  }

  // Devuelve la fila del Top 40 que corresponde a esta canción, o null.
  // Misma forma Unicode que usa el servidor al montar las claves: una «ñ»
  // descompuesta bastaría para no reconocer la canción.
  function etiquetaDe(song) {
    var s = String((song && song.artist) || '') + '|' + String((song && song.title) || '');
    return (s.normalize ? s.normalize('NFC') : s).toLowerCase().trim();
  }

  function chartIndex(song) {
    var etiqueta = etiquetaDe(song);
    return etiqueta in porEtiqueta ? porEtiqueta[etiqueta] : null;
  }

  // Nombre presentable de una canción. Si está en el Top 40 se aprovecha el
  // que ya limpió el servidor, para que la ficha de "suena ahora" y la lista
  // no se contradigan. Si no está, se enseña la etiqueta tal cual viene.
  function nombreLimpio(song) {
    // Sin etiquetas no hay nada que reconocer, y la clave vacía puede casar
    // con cualquier archivo mal etiquetado del catálogo: se devuelve lo que
    // venga tal cual antes de tocar el diccionario.
    if (!song || (!song.title && !song.artist)) {
      return { title: String((song && song.text) || ''), artist: '', art: '' };
    }

    // El diccionario general va primero: cubre toda la rotación, mientras que
    // la lista sólo llega a 40 puestos.
    var n = NOMBRES[etiquetaDe(song)];
    if (n) return { title: n.title, artist: n.artist, art: n.art || '' };

    var i = chartIndex(song);
    if (i !== null) return { title: CHART[i].title, artist: CHART[i].artist, art: CHART[i].art || '' };

    return {
      title: String((song && (song.title || song.text)) || ''),
      artist: String((song && song.artist) || ''),
      art: ''
    };
  }

  // "A continuación" sale de las mismas etiquetas sucias que todo lo demás:
  // se pasa por la limpieza para no contradecir a la lista y a la ficha.
  // "A continuación" se pinta aparte para poder repetirlo cuando llega el
  // diccionario: el primer sondeo suele adelantarse a /api/top40, y sin esto
  // se quedaba con la etiqueta cruda hasta el sondeo siguiente.
  function renderSiguiente() {
    var caja = document.querySelector('[data-next]');
    if (!caja) return;
    caja.hidden = !state.siguiente;
    if (state.siguiente) bind('next-track', songLine(state.siguiente));
  }

  function songLine(song) {
    if (!song) return '';
    var n = nombreLimpio(song);
    if (n.artist && n.title) return n.title + ' — ' + n.artist;
    return n.title || song.text || '';
  }

  function hourOf(epoch) {
    var d = new Date(epoch * 1000);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // "Ha sonado antes": historial real de la emisora, con la hora del oyente.
  function renderHistory(history) {
    var list = document.querySelector('[data-recent]');
    if (!list || !history || !history.length) return;

    list.textContent = '';
    history.slice(0, 4).forEach(function (item) {
      var song = item.song || {};
      var nombre = nombreLimpio(song);
      var li = document.createElement('li');

      // Se construye con nodos de texto: los títulos vienen de las etiquetas
      // de los archivos y no deben interpretarse como HTML.
      [
        ['recent-time', hourOf(item.played_at)],
        ['recent-title', nombre.title],
        ['recent-artist', nombre.artist]
      ].forEach(function (pair) {
        var span = document.createElement('span');
        span.className = pair[0];
        span.textContent = pair[1];
        li.appendChild(span);
      });

      list.appendChild(li);
    });
  }

  // Barra de progreso: la emisora informa del segundo en que va la canción y
  // entre consulta y consulta se sigue contando en local.
  function renderProgress() {
    var box = document.querySelector('[data-progress]');
    if (!box) return;

    var np = state.np;
    if (!np || !np.duration) { box.hidden = true; return; }

    var secs = Math.min(np.elapsed + (Date.now() - np.syncAt) / 1000, np.duration);
    box.hidden = false;
    box.style.setProperty('--np', (secs / np.duration * 100).toFixed(1) + '%');
    bind('np-elapsed', clock(secs));
    bind('np-duration', clock(np.duration));
  }

  // Mandos del sistema operativo / pantalla de bloqueo del móvil.
  function updateMediaSession(t) {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title || 'RadioStar',
      artist: t.artist || 'RadioStar',
      album: t.album || 'En directo',
      artwork: t.art ? [{ src: t.art, sizes: '512x512', type: 'image/jpeg' }] : []
    });
  }

  // Devuelve dentro de cuánto conviene volver a preguntar.
  function applyNowPlaying(data) {
    var np = data && data.now_playing;
    var song = np && np.song;
    var live = (data && data.live) || {};

    state.online = data ? data.is_online !== false : false;

    /* Cuando un locutor entra al aire (ZaraRadio y cualquier otro emisor),
       AzuraCast deja de programar canciones pero conserva en now_playing la
       última que puso el AutoDJ: se queda ahí congelada —remaining a cero—
       hasta que el emisor mande su propia etiqueta. Creérsela sería anunciar,
       con carátula y todo, una canción que terminó hace rato. La señal de que
       es un resto y no lo que suena: empezó antes de que arrancara el directo. */
    var enVivo = !!live.is_live;
    var restoDelAutoDJ = enVivo && !!live.broadcast_start && !!np &&
      !!np.played_at && np.played_at < live.broadcast_start;

    // El contador que se enseña es simulado (ver «Oyentes»). La audiencia
    // real se guarda aquí: es el número que habría que pintar para volver
    // al dato verdadero.
    if (data && data.listeners) state.oyentesReales = Number(data.listeners.current || 0);

    // Locutor al aire: si hay alguien pinchando en directo manda su nombre;
    // si no, se conserva la parrilla escrita en el HTML.
    var meta = document.querySelector('[data-live-meta]');
    if (meta) {
      if (live.is_live && live.streamer_name) {
        meta.textContent = 'En directo con ' + live.streamer_name;
      } else if (meta.dataset.original) {
        meta.textContent = meta.dataset.original;
      }
    }

    // "A continuación" sale de la cola del AutoDJ, que mientras hay alguien
    // pinchando en directo no va a sonar: prometerla sería mentir.
    state.siguiente = (!enVivo && data && data.playing_next && data.playing_next.song) || null;
    renderSiguiente();

    state.historial = (data && data.song_history) || null;
    renderHistory(state.historial);

    // Directo sin etiquetas propias: se anuncia el directo, no el resto de la
    // rotación. En cuanto el emisor mande su título, AzuraCast abre una entrada
    // nueva —ya posterior a broadcast_start— y esto deja de saltar solo.
    if (restoDelAutoDJ) {
      state.np = null;          // la barra de progreso no mediría nada real
      state.liveSong = null;
      state.live = {
        title: EN_DIRECTO,
        artist: '',
        album: '',
        art: live.art || '',
        pos: null
      };
      if (state.liveIdx !== null) {
        state.liveIdx = null;   // ninguna fila del Top 40 está sonando
        renderChart();
      }
      updateMediaSession(state.live);
      render();
      return NP_EVERY;
    }

    if (!song) { render(); return NP_EVERY; }

    state.np = {
      elapsed: np.elapsed || 0,
      duration: np.duration || 0,
      syncAt: Date.now()
    };

    var idx = chartIndex(song);
    var nombre = nombreLimpio(song);

    state.liveSong = song;
    state.live = {
      title: nombre.title || 'En emisión',
      artist: nombre.artist,
      album: song.album || '',
      /* Manda la carátula del propio archivo: es la que ha puesto la emisora
         y por tanto la autoritativa. La del catálogo queda de reserva para los
         archivos que todavía no llevan la suya incrustada.
         (Estuvo desactivada mientras AzuraCast servía la misma imagen por
         defecto para toda la rotación; ya no es el caso.) */
      art: song.art || nombre.art || '',
      pos: idx === null ? null : CHART[idx].pos
    };

    // Al cambiar de canción se repinta la tabla para mover la marca roja.
    if (idx !== state.liveIdx) {
      state.liveIdx = idx;
      renderChart();
    }

    updateMediaSession(state.live);
    render();

    // Al final de la canción se pregunta antes, para que el cambio se note
    // en el momento y no hasta 15 s después.
    var left = (np.remaining || 0) * 1000 + 2000;
    return Math.min(Math.max(left, 5000), NP_EVERY);
  }

  function pollNowPlaying() {
    fetch(NP_URL, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (data) { setTimeout(pollNowPlaying, applyNowPlaying(data)); })
      .catch(function () {
        // Emisora inalcanzable: se avisa en el distintivo y se reintenta.
        state.online = false;
        render();
        setTimeout(pollNowPlaying, NP_RETRY);
      });
  }

  /* ── Oyentes ───────────────────────────────────────────────────────────── */
  /* Cifra simulada, a petición de la emisora: NO es la audiencia real —esa
     llega en state.oyentesReales y no se publica— sino un número que sigue
     la curva de abajo según la hora del día y va subiendo y bajando de uno
     en uno, como si el público entrara y saliera.
     Para volver al dato verdadero: borrar arrancaOyentes() del arranque y
     pintar state.oyentesReales desde applyNowPlaying. */

  /* Oyentes típicos en cada hora, en HORA DE CHILE. El índice es la hora.
     Estos son los números que hay que tocar para ajustar la curva a la
     parrilla: sube las franjas donde tengas tus programas fuertes. */
  var OYENTES_CURVA = [
    /* 00 */ 35, /* 01 */ 25, /* 02 */ 18, /* 03 */ 14,
    /* 04 */ 12, /* 05 */ 15, /* 06 */ 30, /* 07 */ 65,
    /* 08 */ 85, /* 09 */ 80, /* 10 */ 70, /* 11 */ 65,
    /* 12 */ 70, /* 13 */ 75, /* 14 */ 70, /* 15 */ 65,
    /* 16 */ 65, /* 17 */ 70, /* 18 */ 85, /* 19 */ 90,
    /* 20 */ 80, /* 21 */ 70, /* 22 */ 55, /* 23 */ 45
  ];

  var OYENTES_VAIVEN = 0.18;           // cuánto oscila alrededor de su hora
  var OYENTES_CADENCIA = [2500, 7000]; // ms entre un movimiento y el siguiente
  var oyentes = 0;

  function entre(a, b) { return a + Math.random() * (b - a); }

  /* La curva va por la hora de Chile, no por la del visitante: la audiencia
     está aquí, así que quien abra la página desde otro huso tiene que ver el
     público que hay en Chile a esa hora, no el de su reloj. Intl resuelve
     solo el cambio de horario de verano. */
  function relojChile() {
    try {
      var partes = new Intl.DateTimeFormat('es-CL', {
        timeZone: 'America/Santiago', hour: 'numeric', minute: 'numeric', hour12: false
      }).formatToParts(new Date());
      var h = 0, m = 0;
      partes.forEach(function (p) {
        if (p.type === 'hour') h = Number(p.value) % 24;    // algunos navegadores dan 24
        if (p.type === 'minute') m = Number(p.value);
      });
      return h + m / 60;
    } catch (e) {
      var d = new Date();                                   // sin soporte de zonas
      return d.getHours() + d.getMinutes() / 60;
    }
  }

  // Oyentes esperados ahora mismo, interpolando entre horas para que al dar
  // la hora el número no pegue un salto delatador.
  // El medio punto es importante: el número de la tabla es el de la MITAD de
  // su franja (07 vale a las 07:30). Interpolando de HH:00 a HH+1:00 lo que se
  // vería durante la hora sería el promedio con la siguiente, y las franjas en
  // cuesta —el amanecer sobre todo— acababan enseñando bastante más de lo que
  // dice la curva.
  function centroOyentes() {
    var t = relojChile() - 0.5;
    if (t < 0) t += 24;
    var h = Math.floor(t) % 24;
    var avance = t - Math.floor(t);
    return OYENTES_CURVA[h] + (OYENTES_CURVA[(h + 1) % 24] - OYENTES_CURVA[h]) * avance;
  }

  function pintaOyentes(n, dir) {
    $all('[data-bind="listeners"]').forEach(function (el) {
      el.textContent = Number(n).toLocaleString('es-CL');
      if (!dir) return;
      el.classList.remove('is-up', 'is-down');
      void el.offsetWidth;   // fuerza el reinicio: sin esto no se repite la animación
      el.classList.add(dir > 0 ? 'is-up' : 'is-down');
    });
  }

  function tickOyentes() {
    var centro = centroOyentes();
    // Suelo de 3 para que en la madrugada, con la curva muy baja, el contador
    // no se quede completamente quieto.
    var margen = Math.max(3, centro * OYENTES_VAIVEN);
    var min = Math.max(1, Math.round(centro - margen));
    var max = Math.round(centro + margen);

    // Sesgo hacia la cifra que toca a esta hora. Hace dos cosas: evita que se
    // pegue a los topes, y arrastra el número cuando la curva cambia de franja.
    var tiron = (centro - oyentes) / Math.max(max - min, 1);
    var dir = Math.random() < 0.5 + tiron ? 1 : -1;
    var paso = Math.random() < 0.82 ? 1 : 2;   // casi siempre de uno en uno
    var next = Math.min(max, Math.max(min, oyentes + dir * paso));
    if (next !== oyentes) {
      oyentes = next;
      pintaOyentes(oyentes, dir);
    }
    setTimeout(tickOyentes, entre(OYENTES_CADENCIA[0], OYENTES_CADENCIA[1]));
  }

  function arrancaOyentes() {
    // Se entra ya dentro de la franja horaria que toca, un poco descentrado
    // para que dos visitantes no vean exactamente el mismo número.
    var centro = centroOyentes();
    oyentes = Math.max(1, Math.round(centro + entre(-1, 1) * centro * OYENTES_VAIVEN * 0.6));
    pintaOyentes(oyentes);
    setTimeout(tickOyentes, entre(1200, 2600));
  }

  /* ── Arranque ──────────────────────────────────────────────────────────── */
  // La parrilla escrita a mano se guarda para poder volver a ella cuando
  // termine una emisión en directo.
  var liveMeta = document.querySelector('[data-live-meta]');
  if (liveMeta) liveMeta.dataset.original = liveMeta.textContent.trim();

  // Sin señal de vídeo configurada (data-video) no se ofrece el conmutador:
  // más vale no enseñar un botón que no lleva a ninguna parte.
  if (!hasVideo) $all('[data-video-only]').forEach(function (el) { el.hidden = true; });

  // Los mandos del sistema (auriculares, pantalla de bloqueo) controlan la radio.
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', function () { setPlaying(true); });
      navigator.mediaSession.setActionHandler('pause', function () { setPlaying(false); });
    } catch (e) { /* navegador sin soporte completo */ }
  }

  /* ── Carga del Top 40 ──────────────────────────────────────────────────── */
  // La lista la calcula /api/top40 a partir del historial de emisión de la
  // estación: son las canciones que más ha puesto al aire en los últimos
  // siete días. Si la petición falla no se inventa nada, se dice.
  var FECHA_CHART = { day: 'numeric', month: 'short', year: 'numeric' };

  function cargaChart() {
    fetch('/api/top40', { headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.top || !data.top.length) throw new Error('lista vacía');

        CHART = data.top;
        NOMBRES = data.nombres || Object.create(null);
        indexaEtiquetas();

        // Si la emisora ya había dicho qué suena, ahora se puede situar en la
        // lista: el orden de llegada de las dos peticiones no está garantizado.
        if (state.liveSong) {
          state.liveIdx = chartIndex(state.liveSong);
          var nombre = nombreLimpio(state.liveSong);
          state.live.title = nombre.title || state.live.title;
          state.live.artist = nombre.artist;
          if (nombre.art) state.live.art = nombre.art;
          state.live.pos = state.liveIdx === null ? null : CHART[state.liveIdx].pos;
        }
        if (state.historial) renderHistory(state.historial);
        renderSiguiente();

        var cierre = new Date(data.actualizado);
        bind('chart-date', isNaN(cierre.getTime())
          ? ''
          : cierre.toLocaleDateString('es-CL', FECHA_CHART));

        renderChart();
        render();
      })
      .catch(function () {
        chartAviso = SIN_LISTA;
        CHART = [];
        renderChart();
        render();
      });
  }

  renderChart();
  render();
  onScroll();
  arrancaOyentes();
  cargaChart();
  intentaAutoarranque();
  if (NP_URL) pollNowPlaying();
})();
