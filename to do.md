# Pendientes — RadioStar

Lo que falta por hacer, ordenado por lo que más duele primero. Voy dejando aquí
todo lo que vaya saliendo.

Última revisión: 24 de septiembre de 2026.

---

## 1. Bloqueante: cosas que hoy no funcionan en producción

### 1.1 Conectar el almacén de votos de la encuesta

Ahora mismo **los porcentajes que se ven son simulados** (marcados como
«Demostración»). Para que sean votos reales de verdad falta conectar el almacén.
El código ya está escrito y probado; solo falta dónde guardar. Es gratis, y al
conectarlo la simulación se apaga sola.

- [ ] Panel de Vercel → proyecto **RadioStar** → pestaña **Storage** →
      **Create Database** → **Upstash for Redis** (plan gratuito).
- [ ] Conectarlo al proyecto (Vercel añade las variables de entorno solo).
- [ ] **Redeploy** — las variables nuevas no entran en el despliegue que ya
      estaba corriendo.
- [ ] Comprobar: abrir `tudominio.com/api/encuesta`. Si responde
      `"almacen": true`, ya está contando.

Variables que se leen: `KV_REST_API_URL` y `KV_REST_API_TOKEN` (también valen
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).

> Esto no lo puedo hacer yo: implica crear cuenta y manejar credenciales.

### 1.2 Verificar que `AZURACAST_API_KEY` está puesta en Vercel

La tabla del Top 40 ya no se enseña (la sustituyó la sección del ranking), pero
la clave **sigue haciendo falta**: de `/api/top40` sale el diccionario que limpia
los nombres de las canciones en «suena ahora». Sin ella, el reproductor enseña
las etiquetas crudas de los archivos.

- [ ] Comprobar en Vercel → Settings → Environment Variables.
- [ ] Si falta: AzuraCast → *Mi cuenta → Claves de API → Añadir*.
- [ ] Comprobar: abrir `tudominio.com/api/top40` y ver que devuelve `nombres`.

### 1.3 Publicar lo que está sin commitear

Ahora mismo hay trabajo hecho que **no está desplegado**:

- [ ] `api/encuesta.js` — la función de la encuesta (sin rastrear).
- [ ] `assets/img/top.mp4` — el vídeo del ranking, 12 MB (sin rastrear).
- [ ] `assets/img/top-poster.jpg` — portada del vídeo (sin rastrear).
- [ ] `assets/img/estudio.webp` — carátula del directo (sin rastrear).
- [ ] `assets/img/locutor-arturo.webp` — retrato de Arturo Moya (sin rastrear).
- [ ] `assets/img/entrada.mp4` + `entrada-poster.jpg` — cortinilla de bienvenida.
      Es copia de `video entrada.mp4` con nombre sin espacios; el original se
      puede dejar fuera del repo igual que `portada estudio.jpg`.
- [ ] **Originales pesados sueltos en `assets/img/`** que no usa la web:
      `portada estudio.jpg` (2,2 MB), `video entrada.mp4` y
      `Gemini_Generated_Image_wglofuwglofuwglo.jpg` (2,5 MB, el original del
      retrato de Arturo). De cada uno ya existe la versión optimizada que sí se
      usa. Yo los sacaría del repo o los movería a una carpeta de originales.
- [ ] Decidir si se commitea también `assets/img/portada estudio.jpg`, el
      original de 2,2 MB. Tiene un espacio en el nombre y un marco de maqueta
      alrededor; `estudio.webp` ya sale de él recortado y optimizado. Yo lo
      dejaría fuera del repo o lo movería a una carpeta de originales.

---

## 2. Contenido que falta (son huecos visibles en la web)

- [ ] **Fotos de los 3 programas** — hoy hay recuadros grises con su
      descripción. Van en `index.html`, sustituyendo cada
      `<div class="show-media grayscale" role="img" aria-label="…">` por un
      `<div class="show-media grayscale"><img src="…" alt="…"></div>`.
      El CSS ya está listo, no hay que tocar estilos.
- [ ] **Ficha de «ON THE MIX» en la sección Programas** — acordado que va, falta
      el texto. Para la tarjeta necesito tres cosas: descripción (1-2 frases),
      duración aproximada y si es en directo o podcast. En cuanto me las pases,
      la añado.
- [ ] **2 locutores sin nombre ni foto** — «Los Bailables» y «Chao chao»
      aparecen como *Por confirmar*.
- [ ] **5 logos de patrocinadores** — ahora ponen literalmente «Logo».
- [ ] **Enlaces reales de redes sociales** — los 9 enlaces de WhatsApp,
      Instagram, TikTok y YouTube apuntan a `#comunidad`, no salen a ningún
      sitio.
- [ ] **Vídeo del estudio en directo** — el panel «Señal» tiene un conmutador
      Audio/Vídeo que está oculto porque falta `data-video` en el `<audio>` de
      `index.html`. Hace falta la URL del HLS/MP4 de la emisión en vídeo.
      (Ojo: no confundir con el vídeo del ranking, que sí está puesto.)

---

## 3. Funcionalidad a medias

- [ ] **El boletín no envía nada.** `assets/js/app.js` valida el correo y enseña
      el mensaje de confirmación, pero no hay backend detrás. Hay que conectar
      Mailchimp, Brevo o un endpoint propio en el manejador de `submit`.
      Tal como está, quien se suscribe cree que se ha suscrito y no es verdad —
      esto yo lo subiría de prioridad.

---

## 4. Peso y rendimiento

- [ ] **`top.mp4` pesa 12 MB** para 72 segundos a 576×768. Recomprimido
      bajaría a 2–3 MB sin pérdida visible. No bloquea (va con `preload="none"`
      y solo se descarga al darle al play), pero quien lo vea en datos lo nota.
- [ ] **`RadioStar - standalone.html` pesa 918 KB** y se despliega a producción
      aunque no se sirva a nadie: es la maqueta original de referencia. Se puede
      sacar del repo o excluir del despliegue.
- [ ] **Imágenes sin usar en `assets/img/`**: `cover.webp` y `tatan.png`
      (2,6 MB) no se referencian desde ningún sitio. Borrarlas o usarlas.

---

## 5. Detalles y arreglos menores

- [ ] **`og:image` apunta al logotipo.** Al compartir la web en WhatsApp o redes
      sale el logo suelto. Queda mejor una imagen 1200×630 pensada para eso —
      `estudio.webp` serviría de base.
- [ ] **El README acaba con basura.** Las dos últimas líneas
      (`#   R a d i o - S t a r`) son restos en UTF-16 de cuando se creó el repo
      en GitHub. Por eso el archivo se detecta como binario.
- [ ] **Falta `.env.example`.** El `.gitignore` ya lo contempla
      (`!.env.example`) pero no existe. Ayudaría a saber qué variables hacen
      falta sin abrir el panel de Vercel.

---

## 6. Decisiones que necesito de ti o del cliente

- [x] **¿Simular la votación mientras no haya contador real?** — decidido: sí.
      Hecho el 24-09-2026. Los números salen del reloj, son iguales para todo el
      mundo, solo suben y llevan etiqueta «Demostración». Se apagan solos al
      conectar el almacén (punto 1.1).
      Queda una decisión pequeña: **¿se deja visible la etiqueta «Demostración»?**
      Yo la dejaría hasta conectar el contador real —protege a la emisora si
      alguien pregunta—, pero se quita en un minuto si prefieres que no salga.
- [ ] **Al cambiar el vídeo del ranking, sube `RANKING_VERSION`.** Está en
      `assets/js/app.js`, ahora vale `top9-2026-09`. Si no se sube, a quien cerró
      la banda con la X no le volverá a aparecer nunca, ni con el ranking nuevo.
      Hay que cambiarla a la vez que las `OPCIONES` de `api/encuesta.js` y las
      canciones de `index.html`.
- [ ] **¿Las fotos en blanco y negro?** Todo el sitio pasa las imágenes por un
      filtro de gris (clase `grayscale`). Es una decisión de diseño de la
      maqueta. La carátula del estudio ya va en color como excepción, porque
      lleva el logotipo en amarillo. Si prefieren color en todo, es quitar la
      clase.
- [ ] **¿La cortinilla debe verse con «reducir movimiento» activado?** Ahora se
      salta, por accesibilidad: es una animación a pantalla completa. **Tu Chrome
      lo tiene activado**, así que al probar la web no la verás —no está rota—.
      Si la emisora prefiere que salga siempre, es quitar una línea de
      `tocaBienvenida()` en `assets/js/app.js`.
- [ ] **¿Una vez por visita o con menos frecuencia?** Ahora sale una vez por
      sesión. Si resulta pesada, se puede pasar a una vez al día cambiando
      `sessionStorage` por `localStorage` con fecha.

---

## 7. Más adelante (del README)

- [ ] Páginas interiores: ficha de programa, noticia completa, parrilla semanal.
- [ ] Aviso legal, privacidad y banner de cookies si se añade analítica.
- [ ] Textos e imágenes definitivos: los actuales vienen de la maqueta.

---

## Hecho hace poco (para contexto)

- Vídeo del ranking en el hero, con encuesta de las 9 canciones al terminar.
- Los porcentajes los ve todo el mundo, haya votado o no, y la invitación
  anuncia cuánta gente lleva votado.
- Carátula de marca cuando emite el estudio, en color y sin el filtro gris.
- La radio se calla mientras suena el vídeo y vuelve sola al acabar.
- Votación simulada mientras no haya contador real, marcada como demostración.
- Cortinilla de bienvenida al entrar, una vez por visita y con botón de saltar.
- Arturo Moya «Dj. Arturo Mix» («ON THE MIX») añadido a Locutores, con foto.
- El ranking y la encuesta sustituyen a la tabla del Top 40, en su propia sección.
- Carátula del estudio actualizada al arte nuevo («Disco & Dance»), regenerada
  desde el original y con ?v= subido.
- Tras votar la banda se recoge (solo el podio + tu voto) y se puede cerrar con
  la X; el cierre se recuerda por versión de ranking.
