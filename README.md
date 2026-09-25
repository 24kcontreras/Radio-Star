# RadioStar — web de la emisora

Sitio estático que sigue la estructura de la maqueta `RadioStar - standalone.html`.
HTML, CSS y JavaScript planos: sin framework, sin build step, sin dependencias externas.
Se sirve tal cual desde cualquier hosting estático (Netlify, Vercel, GitHub Pages, Apache, nginx).

## Estructura

```
index.html                  Página completa
assets/css/styles.css       Tokens de diseño + componentes + layout
assets/js/app.js            Reproductor, Top 40, filtros, boletín, encuesta
assets/img/logo.png         Logotipo (extraído de la maqueta)
assets/img/top.mp4          Ranking non stop en vídeo (9 temas, 72 s)
assets/img/top-poster.jpg   Fotograma de portada del vídeo
assets/img/cover.webp       Carátula de ejemplo
assets/fonts/*.woff2        Archivo 400/600/800, autoalojada
RadioStar - standalone.html Maqueta original (referencia, no se sirve)
```

## Secciones

Las mismas de la maqueta y en el mismo orden:

1. **Cabecera fija** — logo, navegación, frecuencia y botón *Escuchar*. En móvil la
   navegación pasa a una tira horizontal desplazable.
2. **`#directo`** — emisión en directo: reloj, canción actual, play/pausa,
   ecualizador, volumen, me gusta, compartir, historial, y panel de señal con
   conmutador audio / vídeo y estadísticas.
3. **`#ranking`** — el ranking en vídeo y la encuesta. Sustituyó a la antigua
   lista Top 40 (ver §4).
4. **`#programas`** — tarjetas de programas y podcasts, filtrables por Todo / Directo / Podcast.
5. **`#locutores`** — rejilla del equipo.
6. **`#noticias`** — actualidad musical.
7. **`#comunidad`** — redes y boletín semanal.
8. **Patrocinadores** y **pie**.
9. **Barra de reproducción fija** que aparece al desplazar.

## Puesta en marcha

Cualquier servidor estático. Para probar en local:

```sh
npx serve .
```

Abrir `index.html` con doble clic también funciona, salvo las fuentes
autoalojadas, que algunos navegadores bloquean bajo `file://`.

## Qué hay que conectar

Estos son los puntos donde entran los datos reales. La página funciona sin ellos
(se comporta como demostración visual), pero no emite.

### 1. El stream de audio

En `index.html`:

```html
<audio id="rs-audio" preload="none" data-stream="https://stream.tuemisora.com/live.mp3"></audio>
```

En cuanto `data-stream` tenga valor, los botones de play/pausa (hero, vídeo y
barra fija) y el control de volumen actúan sobre esa emisión. Sin valor, la
interfaz sigue respondiendo pero no suena nada.

### 2. El vídeo del estudio

El panel de vídeo muestra ahora un marcador gris:

```html
<div class="media grayscale" style="background:var(--color-neutral-800)"></div>
```

Sustitúyelo por el reproductor real, por ejemplo:

```html
<video class="media" muted playsinline poster="assets/img/estudio.jpg"></video>
```

Para HLS (`.m3u8`) hará falta hls.js en los navegadores que no lo soportan de forma nativa.

### 2 bis. Imágenes derivadas: si cambias el original, hay que regenerarlas

**Esto ya ha mordido una vez.** Varias imágenes y vídeos de la web no se sirven
tal cual: son versiones recortadas y optimizadas del archivo que mandó la
emisora. Cambiar el original **no actualiza la web**; hay que regenerar el
derivado, subir el `?v=` si lo lleva, y volver a desplegar.

| Se sirve | Sale de | Qué se le hace |
| --- | --- | --- |
| `estudio.webp` | `portada estudio.jpg` | quitar el marco de maqueta, 800×800 |
| `locutor-arturo.webp` | el retrato original | recorte 3:4, 900×1200 |
| `top-poster.jpg` | `top.mp4` | fotograma del segundo 3 |
| `entrada.mp4` + `entrada-poster.jpg` | `video entrada.mp4` | copia sin espacios + fotograma |

Los originales llegan con un marco gris de presentación alrededor (la imagen
cuadrada va dentro, con sombra). Hay que recortarlo o la carátula sale con
bordes. Las medidas del recorte **cambian con cada archivo**: conviene medirlas
en lugar de reutilizar las de la vez anterior.

Comandos de referencia (con ffmpeg):

```sh
# carátula del estudio: recortar el marco y optimizar
ffmpeg -i "assets/img/portada estudio.jpg" \
  -vf "crop=1648:1648:220:208,scale=800:800" -quality 84 assets/img/estudio.webp

# póster del vídeo del ranking
ffmpeg -ss 3 -i assets/img/top.mp4 -frames:v 1 -q:v 4 assets/img/top-poster.jpg
```

Después de regenerar `estudio.webp`, **sube el `?v=` de `ARTE_ESTUDIO`** en
`assets/js/app.js`: sin eso, quien ya tenga la imagen guardada seguirá viendo
la antigua aunque el despliegue sea correcto.

### 3. Las imágenes que faltan

Los bloques de programas, locutores, noticias y patrocinadores llevan
marcadores de posición con su descripción en `aria-label`. Cada uno se
reemplaza por una imagen real:

```html
<!-- antes -->
<div class="show-media grayscale" role="img" aria-label="Foto del programa · Partiendo la semana"></div>

<!-- después -->
<div class="show-media grayscale">
  <img src="assets/img/programa-1.jpg" alt="Foto del programa · Partiendo la semana">
</div>
```

El CSS ya contempla la `<img>` dentro (`object-fit: cover`), así que no hay que tocar estilos.
El filtro en blanco y negro es la clase `grayscale`: quítala si prefieres las fotos en color.

### 4. El Top 40 — retirado de la página, pero sigue vivo por dentro

> **La tabla del Top 40 ya no se enseña.** En su sitio va ahora la sección
> `#ranking` (el vídeo y la encuesta, §7). Lo que sigue describe la maquinaria,
> que **no se ha borrado** y se sigue usando para otra cosa.

La petición a `/api/top40` se mantiene a propósito: de ahí sale `NOMBRES`, el
diccionario que limpia las etiquetas de los archivos para la ficha de «suena
ahora». Sin él, el reproductor volvería a enseñar los nombres crudos de la
emisora. `renderChart()` no pinta nada si no encuentra la tabla, así que no
estorba.

**Para recuperar la lista** basta con devolver el `<table>` con `data-chart` al
HTML: el código que la calcula y la pinta sigue intacto.

Ya no hay lista de ejemplo. El Top 40 son las canciones que la emisora **más ha
puesto al aire en los últimos 7 días**, contadas sobre su historial real de
emisión. Lo calcula `api/top40.js` y lo pinta `assets/js/app.js`.

**Lo único que falta para que funcione es la variable de entorno
`AZURACAST_API_KEY`.** Sin ella la función responde 503 y la sección enseña un
aviso, nunca datos inventados.

Para obtenerla: en el panel de AzuraCast, *Mi cuenta → Claves de API → Añadir*.
La cuenta necesita permiso de **ver informes de la estación** (*View Station
Reports*) sobre `radio-star-online`. Luego, en Vercel:

```sh
vercel env add AZURACAST_API_KEY production
```

Se puede comprobar que la clave sirve sin desplegar nada:

```sh
curl -H "X-API-Key: LA_CLAVE"   "https://radio.radiobendicion.cl/api/station/radio-star-online/history?start=2026-09-12T00:00:00Z&end=2026-09-19T00:00:00Z"
```

Si devuelve `403 Tienes que iniciar sesión`, a la clave le falta el permiso.

Hay dos variables más, opcionales, con estos valores por defecto:
`AZURACAST_BASE` (`https://radio.radiobendicion.cl`) y `AZURACAST_STATION`
(`radio-star-online`).

#### Cómo se calcula

Se piden 8 ventanas móviles de 7 días. La más reciente da la posición actual;
la anterior, la columna *Ant.*; y el número de ventanas seguidas en que la
canción aparece da *Semanas*. Son ventanas móviles y no semanas de calendario
para que la lista esté siempre completa y se mueva a diario, en vez de vaciarse
cada lunes. Una canción entra a partir de **2 emisiones** en la ventana
(`MIN_EMISIONES`), para que un pase suelto de prueba no ocupe un puesto.

#### Los nombres de las canciones

Las etiquetas de los archivos vienen del pool de remezclas y están sucias:
`"130 dime . beth [ diego marti reload ]"`, BPM pegado delante, artista y título
cambiados de sitio. `api/top40.js` los limpia antes de publicarlos (quita BPM y
créditos de DJ, deshace las inversiones detectables, agrupa variantes de la
misma canción y descarta restos de nombre de archivo).

Acierta en la gran mayoría, pero **no en todos**: los casos donde artista y
título están invertidos sin ninguna marca que lo delate no se pueden resolver
automáticamente. Por ejemplo `"128 blue" / "eiffel 65 [ antonydj]"` sale como
*Eiffel 65 — Blue* en vez de *Blue — Eiffel 65*. Para esos, hay un mapa
`CORRECCIONES` al principio del archivo:

```js
var CORRECCIONES = {
  'eiffel65|blue': { artist: 'Eiffel 65', title: 'Blue' }
};
```

La clave es artista y título ya limpios, en minúsculas y sin espacios ni signos.

#### El corrector automático

Rellenar `MANUALES` a mano no escala. Para eso está `scripts/corrige-nombres.js`:
lee el historial de emisión, coge cada etiqueta distinta, la busca en el
catálogo de iTunes y escribe las coincidencias fiables en
`api/correcciones.json`, que `api/top40.js` carga solo si existe.

```sh
AZURACAST_API_KEY=xxx node scripts/corrige-nombres.js
AZURACAST_API_KEY=xxx node scripts/corrige-nombres.js --dry-run   # sin escribir
```

Esto es lo que resuelve las inversiones indetectables: prueba las dos
asignaciones posibles (tal cual y con artista y título intercambiados) y se
queda con la que más se parece a la ficha del catálogo. Así
`"128 blue" / "eiffel 65 [ antonydj]"` acaba siendo *Blue (Da Ba Dee)* de
*Eiffel 65*, que por texto solo era imposible de deducir.

**Lo que no supera el umbral de confianza no se aplica**: va a
`scripts/revisar.json` con la etiqueta original, la propuesta y su puntuación,
para que decidas tú. Es deliberado — una búsqueda difusa sobre texto sucio
devuelve resultados equivocados con mucho aplomo, y atribuir una canción al
artista que no es resulta peor que dejar el nombre feo.

Opciones: `--umbral 0.9` (más estricto), `--semanas 12` (mirar más atrás),
`--pais ES` (tienda de iTunes; por defecto `CL`, y esto importa: la tienda de
EE. UU. no encuentra «Better Off Alone» de Alice Deejay y la chilena sí),
`--pausa 800` (ms entre consultas).

Medido sobre doce etiquetas reales de la emisora: nueve corregidas, ninguna mal
atribuida, y tres intactas —un megamix de DJ, un nombre de archivo roto y una
canción que no está en el catálogo—. Esas tres no tienen arreglo automático.

Arreglarlo de raíz pasa por corregir las etiquetas en la biblioteca de
AzuraCast; tanto la limpieza como el corrector sólo tapan el problema de cara
al oyente.

#### Coste

La respuesta se cachea 1 h en el CDN y 5 min en el navegador, así que el
historial de la emisora se lee como mucho unas 24 veces al día, entre toda la
gente que visite la página.

### 5. El boletín

`assets/js/app.js` sólo valida el correo y enseña el mensaje de confirmación.
No envía nada. Conecta ahí tu servicio (Mailchimp, Brevo, un endpoint propio)
en el manejador de `submit`.

### 6. Metadatos "suena ahora"

Las emisoras suelen exponer la canción actual en un endpoint (Icecast, Shoutcast,
Radio.co, Azuracast). Para reflejarla en directo, sondéalo cada 15–30 s y usa la
función `bind()` que ya existe:

```js
bind('track-title', datos.titulo);
bind('track-artist', datos.artista);
```

`bind()` actualiza a la vez el hero, la carátula y la barra fija: los tres
comparten el mismo atributo `data-bind`.

Esto **ya está hecho**: la página sondea `data-nowplaying` y refleja la canción,
el historial, los oyentes y el locutor al aire. Además, cuando lo que suena
figura en el Top 40, se reutiliza el nombre ya limpio que devolvió
`/api/top40` —así la ficha y la lista no se contradicen— y la fila
correspondiente se marca en rojo.

### 7. El ranking en vídeo y la encuesta

Ocupa la sección `#ranking`, donde antes estaba la tabla del Top 40.
El vídeo `assets/img/top.mp4` se reproduce ahí. Al terminar se despliega sola la
encuesta: cuál de las nueve canciones del ranking es la mejor. También se puede
abrir sin esperar, con el botón «Votar ya».

Las nueve canciones están escritas en `index.html`, dentro del formulario
`[data-encuesta-form]`. El `value` de cada `<input>` tiene que coincidir con la
lista `OPCIONES` de `api/encuesta.js`: es una lista cerrada, y cualquier voto que
no esté en ella se descarta. Si algún día cambia el vídeo, hay que tocar los dos
sitios.

Los porcentajes los ve **todo el mundo**, haya votado o no: desde el botón «Ver
resultados» del formulario, y automáticamente al votar. La invitación anuncia
además cuánta gente lleva votado («Ya han votado 128 personas»), que es lo que
evita la sensación de encuesta vacía.

#### Conectar el recuento compartido (imprescindible)

Sin almacén, cada visitante sólo ve su propio voto. Para que los porcentajes
sean reales y comunes hay que darle a la función un Redis accesible por REST.
Es gratis y son cinco minutos:

1. En el panel de Vercel, proyecto **RadioStar** → pestaña **Storage** →
   **Create Database** → **Upstash for Redis**. El plan gratuito sobra.
2. Al conectarlo al proyecto, Vercel añade las variables de entorno solo.
3. **Redeploy** del proyecto (las variables nuevas no entran en el despliegue
   que ya estaba corriendo).

Las variables que se leen son:

```
KV_REST_API_URL         URL REST del Redis
KV_REST_API_TOKEN       Token de acceso
```

También valen `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`, que es como
las publica Upstash cuando se contrata por fuera de la integración de Vercel.

Para comprobar que quedó bien, basta abrir `/api/encuesta` en el navegador: si
responde `almacen: true`, está contando.

#### Recogerse y cerrarse

Tras votar, la banda **se recoge sola**: desaparece el vídeo, el titular encoge
y sólo quedan el podio (3 puestos) más la canción votada, aunque haya quedado
fuera del podio —es el dato que esa persona ha venido a ver—. «Ver las 9
canciones» despliega la lista entera y devuelve el vídeo; «Ver solo el podio»
la vuelve a recoger. Quien ya votó entra directamente al resultado recogido en
las siguientes visitas, sin pasar por la invitación.

La **X** de la esquina cierra la banda entera y lo recuerda en `localStorage`
(`rs-ranking-cerrado`). No se guarda un `true` sino la etiqueta
`RANKING_VERSION` de `assets/js/app.js`: así, **al cambiar el vídeo o las
canciones se sube esa etiqueta y la banda reaparece para todo el mundo**, en vez
de quedar enterrada para siempre a quien la cerró una vez. Hay que subirla a la
vez que las `OPCIONES` de `api/encuesta.js`.

#### Recuento simulado mientras no haya almacén

Sin las variables puestas, la función **no falla ni deja la encuesta vacía**:
devuelve un recuento simulado (`simulado: true`) para que se vea viva en
demostraciones. La página lo marca con una etiqueta «Demostración» y el pie
avisa de que es un recuento de muestra.

La simulación vive en `api/encuesta.js` (`SIMULACION`, `SIMULACION_INICIO`,
`SIMULACION_CURVA`) y sigue dos reglas para que no cante:

- **Determinista**: sale del reloj, no del azar. Todo el mundo ve los mismos
  números y no cambian al recargar.
- **Monótona y con freno**: crece con `horas^0,65`, así que sube deprisa al
  principio y se va apagando, como una encuesta de verdad. Ningún contador baja
  nunca. Arranca en 307 votos y al año va por unos 2.300, no por decenas de
  miles. Los ritmos por canción no son proporcionales a su base a propósito:
  si lo fueran los porcentajes quedarían clavados, y así la lista se mueve
  («Barbra Streisand» adelanta a «Stereo Love» sobre el sexto día).

El voto propio se suma en el navegador sobre esos números, para que quien vota
se vea reflejado; se guarda en `localStorage`, no en ningún servidor.

**En cuanto se añaden las variables y se redespliega, la simulación se apaga
sola**: la respuesta pasa a `almacen: true`, desaparece la etiqueta de
demostración y entran los votos reales. No hay que tocar código. Aviso menor:
por el `stale-while-revalidate` la primera visita tras el cambio puede ver los
números viejos hasta un minuto.

Para quitar la simulación y volver al mensaje honesto de «tu voto se guardó en
este navegador», basta borrar el bloque `SIMULACION` y devolver `total: 0` y
`resultados: {}` en la rama `if (!hayAlmacen)`.

Sobre la cuota: el GET del recuento se cachea 15 s en el CDN de Vercel, así que
Redis recibe unas pocas consultas por minuto por mucha gente que entre, y el
plan gratuito de Upstash (10.000 comandos al día) aguanta de sobra. Los votos no
se cachean nunca: quien vota ve su voto ya sumado.

Un apunte sobre el recuento: el «ya has votado» se guarda en `localStorage`
(`rs-voto-ranking`), así que evita el voto repetido por descuido, no a quien se
empeñe en votar varias veces. Para una votación con premio haría falta algo más
—sesión, límite por IP o captcha—, que hoy no lleva.

Dos detalles de comportamiento que conviene conocer: el vídeo lleva su propio
sonido, así que al darle al play se pausa la emisión en directo y vuelve sola al
acabar; y el archivo pesa 12 MB, por lo que va con `preload="none"` y un póster
(`top-poster.jpg`) y no se descarga hasta que alguien lo pide.

### 8. La cortinilla de bienvenida

Al entrar salta `assets/img/entrada.mp4` (10,8 s, 2,1 MB) a pantalla completa,
por encima de todo. Se puede saltar en cualquier momento.

Tres reglas que conviene conocer antes de tocarla:

- **Una vez por visita, no por recarga.** Se marca en `sessionStorage`
  (`rs-bienvenida`), así que al cerrar la pestaña se olvida y vuelve a salir
  otro día. Repetirla en cada recarga castigaría justo al oyente habitual.
- **El sonido es un intento, no una promesa.** Los navegadores no dejan
  arrancar vídeo con sonido si el visitante no tiene historial en el dominio.
  Se intenta con sonido y, al primer no, se repite en silencio y aparece el
  botón «Activar sonido». Nunca se queda en negro esperando un permiso.
- **La radio espera.** La emisión no arranca mientras dura la cortinilla: lo
  hace `cierraBienvenida()` al terminar el vídeo o al saltarlo. Saltar es un
  gesto del visitante, así que por ahí la radio suele arrancar con sonido a la
  primera; si el vídeo acaba solo, se aplican las reglas de autoarranque de
  siempre.

**No se enseña a quien tiene activado «reducir movimiento»** en su sistema
(`prefers-reduced-motion`): es una animación a pantalla completa, que es
justo lo que ese ajuste pide evitar. Ojo con esto al probarla: Windows lo trae
activado en más equipos de los que parece, y da la sensación de que no funciona.
Para enseñarla siempre, quita esa línea de `tocaBienvenida()` en
`assets/js/app.js`.

Para quitar la cortinilla del todo, borra el bloque `[data-bienvenida]` de
`index.html`: el JS no hace nada si no encuentra la capa.

## Scripts

```
scripts/corrige-nombres.js   Corrige nombres contra el catálogo de iTunes
scripts/revisar.json         Lo generado que no llegó al umbral (no se aplica)
```

## Notas de implementación

- **Responsive por CSS, no por JavaScript.** La maqueta cambiaba de marcado
  según el ancho de ventana; aquí lo hace una media query en `max-width: 759px`.
  El HTML servido es uno solo, lo que evita saltos al cargar y mantiene el
  contenido accesible a los buscadores.
- **Contenido en el HTML.** Programas, locutores y noticias están escritos en
  `index.html` en lugar de generarse por JavaScript, para que se indexen. Sólo
  el Top 40 se pinta desde JS, porque sale del historial de emisión y cambia
  a diario.
- **La tabla se construye con nodos, no con `innerHTML`.** Los títulos vienen de
  las etiquetas de los archivos de la emisora: son texto ajeno y no deben poder
  inyectar marcado.
- **Sin peticiones externas.** Las fuentes van autoalojadas en `assets/fonts/`,
  así que la página no depende de Google Fonts ni de ningún CDN.
- **Reproducción automática: intento, no promesa.** `data-autoplay` en el
  `<audio>` hace que la radio intente sonar al entrar. Los navegadores
  bloquean el audio automático salvo que el visitante ya tenga historial en el
  dominio, y en móvil lo bloquean casi siempre. Cuando lo deniegan **no se
  toca el estado**: el botón sigue diciendo "reproducir", que es la verdad, y
  queda armado el arranque al primer toque en cualquier parte. Fingir que
  suena obligaría al oyente a pulsar dos veces. Quita `data-autoplay` para
  volver al arranque sólo con el botón.
- **La emisión se vigila, no se supone.** Un directo que se corta muchas veces
  no lanza `error` ni `ended`: el `<audio>` simplemente deja de avanzar. Pasa
  sobre todo con el móvil bloqueado, cuando el sistema suspende la red o se
  salta de wifi a datos. Por eso `vigilaEmision()` comprueba cada segundo que
  `currentTime` sigue corriendo y reconecta si lleva 12 s parado, y un
  `visibilitychange` fuerza la comprobación al desbloquear en lugar de esperar
  al siguiente tic. No se escucha `stalled`: salta también en pausas normales
  del búfer y cortaría el sonido sin motivo.
- **Accesibilidad.** Los tres botones de reproducción comparten estado,
  el *me gusta* expone `aria-pressed`, la navegación marca la sección activa y
  se respeta `prefers-reduced-motion`.

## Pendiente

- Páginas interiores (ficha de programa, noticia completa, parrilla semanal).
- Aviso legal, privacidad y banner de cookies si se añade analítica.
- Textos e imágenes definitivos: los actuales vienen de la maqueta.
#   R a d i o - S t a r  
 