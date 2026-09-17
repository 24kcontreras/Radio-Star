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

  /* ── Estado ────────────────────────────────────────────────────────────── */
  var state = {
    mode: 'audio',
    playing: false,
    vol: 7,
    idx: 0,
    liked: {},
    secs: 0,
    full: false,
    scrolled: false
  };

  var audio = document.getElementById('rs-audio');
  var bar = document.querySelector('[data-player-bar]');

  /* ── Utilidades ────────────────────────────────────────────────────────── */
  function pad(n) { return String(n).padStart(2, '0'); }

  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // Escribe el mismo valor en todos los puntos de anclaje con ese nombre:
  // el título de la canción aparece en el hero, en la carátula y en la barra.
  function bind(name, value) {
    $all('[data-bind="' + name + '"]').forEach(function (el) { el.textContent = value; });
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
    var t = CHART[state.idx] || CHART[0];

    document.body.classList.toggle('is-playing', state.playing);

    bind('track-title', t.title);
    bind('track-artist', t.artist);
    bind('track-album', t.album);
    bind('track-pos', pad(t.pos));
    bind('elapsed', elapsedText());
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

    // Me gusta.
    var likeBtn = document.querySelector('[data-action="like"]');
    if (likeBtn) {
      var liked = !!state.liked[state.idx];
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

    renderVolume();
  }

  /* ── Reproducción ──────────────────────────────────────────────────────── */
  // El <audio> sólo suena si se ha configurado data-stream; sin él la página
  // funciona igual como demostración visual.
  function syncAudio() {
    if (!audio || !audio.dataset.stream) return;
    if (!audio.src) audio.src = audio.dataset.stream;
    if (state.playing) {
      var p = audio.play();
      if (p && p.catch) p.catch(function () { /* autoplay bloqueado */ });
    } else {
      audio.pause();
    }
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
          state.vol = state.vol === 0 ? 7 : 0;
          render();
          return;

        case 'like':
          state.liked[state.idx] = !state.liked[state.idx];
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
    var t = CHART[state.idx] || CHART[0];
    var data = {
      title: 'RadioStar 104.7',
      text: 'Suena ' + t.title + ' — ' + t.artist + ' en RadioStar',
      url: location.href
    };
    if (navigator.share) {
      navigator.share(data).catch(function () { /* cancelado */ });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(data.text + ' ' + data.url).catch(function () {});
    }
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
    if (!state.playing) return;
    state.secs += 1;
    bind('elapsed', elapsedText());
  }, 1000);

  /* ── Arranque ──────────────────────────────────────────────────────────── */
  renderChart();
  render();
  onScroll();
})();
