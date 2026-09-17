/* ==========================================================================
   RadioStar — lógica de la página
   Reproductor, Top 40, filtros de programas, boletín y barra fija.
   JavaScript plano, sin dependencias.
   ========================================================================== */
(function () {
  'use strict';

  /* ── Datos ─────────────────────────────────────────────────────────────── */
  var CHART = [
    { title: 'Self Control',        artist: 'Marea Nueva',  album: 'Cinta B',  pos: 1,  prev: 2,  weeks: 9  },
    { title: 'Bailables (edit)',    artist: 'Sonora Kilo',  album: 'Vueltas',  pos: 2,  prev: 1,  weeks: 14 },
    { title: 'Chao chao',           artist: 'Lupe Ferrer',  album: 'Chao chao',pos: 3,  prev: 7,  weeks: 4  },
    { title: 'Neón de barrio',      artist: 'Tres Azoteas', album: 'Azotea',   pos: 4,  prev: 4,  weeks: 11 },
    { title: 'Media noche exacta',  artist: 'Ala Norte',    album: 'Turnos',   pos: 5,  prev: 3,  weeks: 6  },
    { title: 'Cuenta atrás',        artist: 'Vera Molina',  album: 'Sal',      pos: 6,  prev: 12, weeks: 2  },
    { title: 'Tanto',               artist: 'El Radar',     album: 'Antena',   pos: 7,  prev: 5,  weeks: 8  },
    { title: 'Onda corta',          artist: 'Duo Litoral',  album: 'Faro',     pos: 8,  prev: 8,  weeks: 16 },
    { title: 'Se nos hizo tarde',   artist: 'Nico Paz',     album: 'Tarde',    pos: 9,  prev: 15, weeks: 3  },
    { title: 'Sal de la pista',     artist: 'Kiosko 7',     album: 'Pista',    pos: 10, prev: 6,  weeks: 10 },
    { title: 'Tormenta buena',      artist: 'Marea Nueva',  album: 'Cinta B',  pos: 11, prev: 18, weeks: 2  },
    { title: 'Ruido bonito',        artist: 'La Pausa',     album: 'Pausa',    pos: 12, prev: 9,  weeks: 7  }
  ];

  var VISIBLE_ROWS = 10;  // filas del Top 40 antes de "Ver los 40 completos"
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
    if (!url) return;
    $all('[data-bind="' + name + '"]').forEach(function (el) {
      if (el.getAttribute('src') !== url) el.setAttribute('src', url);
    });
  }

  // Lo que se muestra: si la estación ha respondido, manda la emisión en
  // directo; si no, el Top 40 sirve de demostración.
  function currentTrack() {
    return state.live || CHART[state.idx] || CHART[0];
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
  function movementCell(t) {
    var diff = Math.abs(t.prev - t.pos);
    if (t.prev > t.pos) return '<span class="move-up">▲ ' + diff + '</span>';
    if (t.prev < t.pos) return '<span class="move-down">▼ ' + diff + '</span>';
    return '<span class="move-flat">—</span>';
  }

  function trendText(t) {
    if (t.prev === t.pos) return 'se mantiene';
    return (t.prev > t.pos ? '▲ sube ' : '▼ baja ') + Math.abs(t.prev - t.pos);
  }

  function renderChart() {
    var tbody = document.querySelector('[data-chart]');
    if (!tbody) return;
    var limit = state.full ? CHART.length : Math.min(CHART.length, VISIBLE_ROWS);

    tbody.innerHTML = CHART.slice(0, limit).map(function (t, i) {
      return '' +
        '<tr data-row="' + i + '">' +
          '<td class="chart-pos">' + pad(t.pos) + '</td>' +
          '<td style="min-width:0">' +
            '<div class="chart-song">' +
              (i === state.idx ? '<span class="chart-cur" aria-hidden="true"></span>' : '') +
              '<div style="min-width:0">' +
                '<div class="chart-name">' + t.title + '</div>' +
                '<div class="chart-artist">' + t.artist + '</div>' +
                '<div class="chart-trend-mobile">' + trendText(t) + ' · ' + t.weeks + ' sem.</div>' +
              '</div>' +
            '</div>' +
          '</td>' +
          '<td class="col-prev">' + movementCell(t) + '</td>' +
          '<td class="col-weeks chart-weeks">' + t.weeks + '</td>' +
          '<td>' +
            '<button type="button" class="btn btn-secondary btn-icon" aria-label="Reproducir ' + t.title + '">' +
              '<span class="tri" style="--tri:9px;margin-left:2px" aria-hidden="true"></span>' +
            '</button>' +
          '</td>' +
        '</tr>';
    }).join('');
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

    bind('track-title', t.title);
    bind('track-artist', t.artist);
    bind('track-album', t.album);
    bind('track-pos', t.pos ? pad(t.pos) : '—');
    bindSrc('cover', t.art);
    bind('elapsed', elapsedText());

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
    bind('bar-kicker', state.mode === 'video'
      ? 'RadioStar TV · en directo'
      : 'RadioStar 104.7 · en directo');

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
      var liked = !!state.liked[likeKey(t)];
      likeBtn.setAttribute('aria-pressed', String(liked));
      var path = likeBtn.querySelector('svg');
      if (path) {
        path.setAttribute('fill', liked ? 'var(--color-accent)' : 'none');
        path.setAttribute('stroke', liked ? 'var(--color-accent)' : 'currentColor');
      }
      bind('like-label', liked ? 'Guardada' : 'Me gusta');
    }

    var fullBtn = document.querySelector('[data-action="toggle-full"]');
    if (fullBtn) fullBtn.textContent = state.full ? 'Ver el top 10' : 'Ver los 40 completos';

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
      if (p && p.catch) p.catch(function () { /* autoplay bloqueado */ });
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
    // Sólo se reconecta ante un fallo real o un corte del servidor: 'stalled'
    // salta también en pausas normales del búfer y cortaría el sonido.
    audio.addEventListener('error', reconnect);
    audio.addEventListener('ended', reconnect);
  }

  // Si se cae la conexión mientras se escucha, se reintenta solo: un corte de
  // red no debería obligar a recargar la página.
  var reconnectAt = 0;
  function reconnect() {
    if (!state.playing) return;
    if (Date.now() - reconnectAt < 4000) return;   // un intento cada 4 s

    reconnectAt = Date.now();
    state.status = 'error';
    render();

    setTimeout(function () {
      if (!state.playing) return;
      // El parámetro extra evita que el navegador reutilice la conexión rota.
      audio.src = audio.dataset.stream + '?_=' + Date.now();
      var p = audio.play();
      if (p && p.catch) p.catch(function () {});
    }, 2000);
  }

  function setPlaying(on) {
    state.playing = on;
    syncAudio();
    render();
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
          var key = likeKey(currentTrack());
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
    var suena = t.artist ? t.title + ' — ' + t.artist : t.title;
    var data = {
      title: 'RadioStar 104.7',
      text: 'Suena ' + suena + ' en RadioStar',
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
    // El progreso de la canción avanza aunque no se esté escuchando: la
    // emisora sigue emitiendo al otro lado.
    renderProgress();
  }, 1000);

  /* ── Canción en directo ────────────────────────────────────────────────── */
  // AzuraCast publica lo que está emitiendo en /api/nowplaying/<estación>;
  // la URL se configura en data-nowplaying. Sin ella la página no consulta
  // nada y sigue funcionando con el Top 40 de ejemplo.
  var NP_URL = audio && audio.dataset.nowplaying;
  var NP_EVERY = 15000;   // la API se cachea 15 s: pedirla más seguido no aporta
  var NP_RETRY = 30000;   // si la estación no responde, se espera más

  function chartPos(title) {
    var name = String(title || '').toLowerCase();
    for (var i = 0; i < CHART.length; i++) {
      if (CHART[i].title.toLowerCase() === name) return CHART[i].pos;
    }
    return null;
  }

  function songLine(song) {
    if (!song) return '';
    if (song.artist && song.title) return song.title + ' — ' + song.artist;
    return song.title || song.text || '';
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
      var li = document.createElement('li');

      // Se construye con nodos de texto: los títulos vienen de las etiquetas
      // de los archivos y no deben interpretarse como HTML.
      [
        ['recent-time', hourOf(item.played_at)],
        ['recent-title', song.title || song.text || ''],
        ['recent-artist', song.artist || '']
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
      artist: t.artist || 'RadioStar 104.7',
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

    if (data && data.listeners) {
      bind('listeners', Number(data.listeners.current || 0).toLocaleString('es-CL'));
    }

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

    var next = data && data.playing_next && data.playing_next.song;
    var nextBox = document.querySelector('[data-next]');
    if (nextBox) {
      nextBox.hidden = !next;
      if (next) bind('next-track', songLine(next));
    }

    renderHistory(data && data.song_history);

    if (!song) { render(); return NP_EVERY; }

    state.np = {
      elapsed: np.elapsed || 0,
      duration: np.duration || 0,
      syncAt: Date.now()
    };

    state.live = {
      title: song.title || song.text || 'En emisión',
      artist: song.artist || '',
      album: song.album || '',
      art: song.art || '',
      pos: chartPos(song.title)
    };

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

  /* ── Arranque ──────────────────────────────────────────────────────────── */
  // La parrilla escrita a mano se guarda para poder volver a ella cuando
  // termine una emisión en directo.
  var liveMeta = document.querySelector('[data-live-meta]');
  if (liveMeta) liveMeta.dataset.original = liveMeta.textContent.trim();

  // Sin señal de vídeo configurada (data-video) no se ofrece el conmutador:
  // más vale no enseñar un botón que no lleva a ninguna parte.
  if (!hasVideo) $all('[data-video-only]').forEach(function (el) { el.hidden = true; });

  // La fecha del Top 40 la pone el navegador, no queda congelada en el HTML.
  bind('chart-date', new Date().toLocaleDateString('es-CL', {
    day: 'numeric', month: 'short', year: 'numeric'
  }));

  // Los mandos del sistema (auriculares, pantalla de bloqueo) controlan la radio.
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', function () { setPlaying(true); });
      navigator.mediaSession.setActionHandler('pause', function () { setPlaying(false); });
    } catch (e) { /* navegador sin soporte completo */ }
  }

  renderChart();
  render();
  onScroll();
  if (NP_URL) pollNowPlaying();
})();
