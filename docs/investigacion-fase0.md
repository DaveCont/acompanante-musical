# Investigación Técnica – Fase 0: Seguimiento Instrumental de Sermón

Documento de referencia para la toma de decisiones arquitectónicas en `DECISIONS.md`.

---

## a) Captura de Audio (`getUserMedia`), `AudioWorklet` y Latencia en Móviles

### Qué hacen `echoCancellation`, `noiseSuppression` y `autoGainControl`
Por defecto, los navegadores activan estos tres procesadores DSP orientados a videollamadas (WebRTC):
- **`echoCancellation` (AEC):** Resta la señal reproducida en el dispositivo de la señal entrante del micrófono mediante un filtro adaptativo, pero introduce artefactos de fase y "bombeo" (*pumping*) cuando hay música continua.
- **`noiseSuppression` (NS):** Filtra frecuencias estacionarias (ventiladores, zumbidos, **pads musicales sostenidos**) y recorta colas de voz suave o susurros.
- **`autoGainControl` (AGC):** Normaliza dinámicamente el nivel de entrada. **Crítico para esta app:** si el predicador sube la voz en un clímax o baja a un susurro, el AGC comprime ese rango dinámico y sube el piso de ruido en las pausas, arruinando la medición real de energía (`b-energia`).

### ¿Se pueden desactivar realmente en Chrome y Safari iOS?
- **Chrome (Escritorio y Android):** Sí. Al pasar `{ echoCancellation: false, noiseSuppression: false, autoGainControl: false }`, Chromium desactiva el bloque de procesamiento de audio de WebRTC (`AudioProcessingModule`) y en Android solicita una ruta de entrada cruda (`VOICE_RECOGNITION` o `UNPROCESSED`).
- **Safari iOS (WebKit):** **Parcialmente.** Aunque `track.getSettings()` confirme `false` en los tres flags (soportados desde iOS 11+), existen dos trampas del sistema operativo:
  1. **Procesamiento oculto de CoreAudio:** Cuando se activa captura + reproducción simultánea, iOS asigna la sesión de audio a `AVAudioSessionCategoryPlayAndRecord`, la cual aplica ecualización y limitación de hardware en ciertos micrófonos integrados salvo que se use micrófono externo USB/TRRS.
  2. **Modo "Aislamiento de Voz" (Voice Isolation) de iOS:** Si el usuario activó *Aislamiento de Voz* en el Centro de Control de iOS para Safari, el sistema operativo **ignora `noiseSuppression: false`** y aplica una red neuronal agresiva a nivel de SO. Se debe instruir al usuario a dejar el micrófono en modo *Estándar* o *Espectro Amplio*.

### Soporte de `AudioWorklet` en Safari iOS
- **Soporte:** Nativo y estable desde **Safari 14.5 (iOS 14.5+)** ([Can I Use / MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)).
- **Particularidades en iOS:**
  - El `AudioContext` en iOS suele inicializarse a **48,000 Hz** (frecuencia nativa del hardware de Apple) en lugar de 44,100 Hz. Todo algoritmo en el worklet debe leer `sampleRate` dinámicamente.
  - Procesar bloques de 128 muestras (`2.67 ms` a 48 kHz) en el hilo de audio es seguro siempre que no se realicen asignaciones de memoria (`new Float32Array`) dentro de `process()` para evitar pausas del *Garbage Collector*.

### Valores típicos de `baseLatency` y `outputLatency`
| Plataforma | `baseLatency` típica | `outputLatency` típica | Latencia total estimada (salida) |
|---|---|---|---|
| **Chrome Escritorio (macOS/Win WASAPI)** | `2.6 ms – 10 ms` (128–512 muestras) | `10 ms – 25 ms` | `~15 – 35 ms` |
| **Safari iOS (altavoz/cable TRRS)** | `5.3 ms – 21.3 ms` (256–1024 muestras) | `15 ms – 35 ms` (a veces no reportado en versiones antiguas) | `~20 – 50 ms` |
| **Chrome Android (AAudio / OpenSL ES)** | `10 ms – 40 ms` | `25 ms – 80 ms` | `~35 – 120 ms` |
| **Cualquier móvil por Bluetooth** | Sin cambio en `baseLatency` | `+100 ms – 250 ms` | **`>150 ms` (inviable en vivo)** |

**Fuentes (a):**
- [MDN – MediaTrackSettings: echoCancellation, noiseSuppression, autoGainControl](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints#instance_properties_of_audio_tracks)
- [MDN – AudioContext.baseLatency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/baseLatency) y [AudioContext.outputLatency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency)
- [WebKit Bugzilla – getUserMedia audio constraints & iOS Voice Isolation quirks](https://bugs.webkit.org/show_bug.cgi?id=216798)

---

## b) Seguimiento de Intensidad: RMS con Attack/Release vs. LUFS (K-weighting)

### Comparativa técnica para voz en tiempo real
1. **RMS con envolvente Attack/Release (seguidor de envolvente asimétrico):**
   - Calcula la raíz cuadrada de la media cuadrática por bloque y aplica un filtro IIR de un polo con constantes distintas para subida ($\tau_{\text{attack}}$) y bajada ($\tau_{\text{release}}$).
   - **Problema sin filtrado previo:** Es plano en frecuencia. Golpes al micrófono, plosivas (`p`, `b`) o efecto de proximidad (<150 Hz) disparan el RMS aunque el oído humano no perciba un aumento real de volumen vocal.
2. **LUFS / Ponderación K (ITU-R BS.1770-4):**
   - Aplica dos filtros biquad en cascada antes de medir la energía:
     1. **High-shelf (+4 dB por encima de ~1.5 kHz):** Modela la resonancia acústica de la cabeza humana y enfatiza los formantes de proyección vocal (2–4 kHz, donde la voz "corta" en un sermón efusivo).
     2. **High-pass RLB (corte de graves <100 Hz):** Elimina retumbos de tarima, aire acondicionado y golpes de pie de micrófono.
   - El estándar BS.1770 usa ventanas rectangulares fijas (400 ms para *Momentary*, 3 s para *Short-Term*), las cuales son simétricas (tardan lo mismo en subir que en bajar).

### Mejor arquitectura para la app: Híbrido "K-Weighted RMS con Attack/Release"
Para acompañar un sermón, la combinación óptima une lo mejor de ambos mundos: **filtrar la señal con las dos etapas biquad de K-weighting (costo casi nulo en Web Audio / AudioWorklet) y alimentar con ella un seguidor de envolvente RMS con Attack/Release asimétrico**.
- **Valores típicos recomendados para seguimiento musical de voz:**
  - **Attack rápido (`30 ms – 80 ms`):** Permite reaccionar de inmediato cuando el predicador rompe un silencio o alza la voz con fuerza, sin que una sola consonante explosiva de 5 ms dispare el acompañamiento.
  - **Release lento (`800 ms – 2,500 ms`) + Hold (`200 ms – 400 ms`):** Crucial en oratoria. Un predicador hace pausas dramáticas de 1 a 2 segundos en medio de un clímax; si el *release* es corto (<300 ms), la música caerá abruptamente en cada respiración.

**Fuentes (b):**
- [ITU-R BS.1770-4 – Algorithms to measure audio programme loudness and true-peak audio level](https://www.itu.int/rec/R-REC-BS.1770)
- [Audio EQ Cookbook / Web Audio BiquadFilterNode (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/BiquadFilterNode)

---

## c) Velocidad de Habla: `SpeechRecognition` Offline vs. Envolvente de Energía

### ¿`SpeechRecognition` (Web Speech API) funciona sin conexión?
- **Chrome Escritorio (130+):** Introdujo soporte experimental para `SpeechRecognition.processLocally = true` y `SpeechRecognition.install({ langs: ['es-ES'], processLocally: true })`, descargando paquetes de idioma en el dispositivo.
- **Chrome Android y Safari iOS:** **NO es confiable sin internet.**
  - En Chrome Android, `webkitSpeechRecognition` delega al servicio del sistema de Google que por defecto envía audio a servidores en la nube y se detiene tras pocos segundos de silencio (requiriendo reinicios que en móviles disparan un pitido audible del sistema).
  - En Safari iOS, aunque iOS posee dictado en el dispositivo para ciertos idiomas, `webkitSpeechRecognition` falla frecuentemente sin red con `SpeechRecognitionErrorEvent: service-not-allowed` o `network`, e impone límites de sesión de ~60 segundos.
  - **Latencia de transcripción:** Incluso con red, los resultados parciales (`interimResults = true`) llegan con `300 ms – 1,200 ms` de retraso en bloques discretos de palabras, no como una curva continua de cadencia.

### Estimación de tasa de sílabas desde la envolvente de energía (DSP 100% offline)
El habla humana en todos los idiomas presenta un ritmo silábico universal cuyo espectro de modulación de amplitud tiene un pico dominante alrededor de **4 Hz (rango de 2 a 8 sílabas/segundo)**. Existen dos métodos probados y ligeros para tiempo real:
1. **Detección de núcleos silábicos por picos en banda vocal (Método De Jong & Wempe / Mermelstein):**
   - Filtrar paso-banda la señal entre **300 Hz y 3,000 Hz** (energía vocálica, ignorando fricativas sordas como `/s/` que tienen alta frecuencia pero no son núcleo silábico).
   - Extraer la envolvente suavizada (filtro paso-bajo a **~8–10 Hz** o ventana RMS de 25 ms).
   - Contar picos locales que superen el umbral de silencio y tengan una prominencia (caída mínima entre picos, *dip*) de al menos **2–3 dB**, con una distancia mínima entre picos de **90–110 ms** (máximo fisiológico ~9–10 sílabas/s) en una ventana deslizante de 3 a 5 segundos.
2. **Filtro paso-banda de la envolvente (Modulation Spectrum 2–8 Hz):**
   - Calcular la transformada o banco de filtros sobre la envolvente de energía entre 2 Hz y 8 Hz para hallar la frecuencia dominante de modulación. Es más costoso y requiere ventanas de 4–8 s para tener resolución en bajas frecuencias, por lo que **el conteo de picos con prominencia en ventana deslizante es superior en latencia y simplicidad**.

**Fuentes (c):**
- [MDN – SpeechRecognition.processLocally](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally) y [Web Speech API Specification (W3C)](https://webaudio.github.io/web-speech-api/)
- [De Jong & Wempe (2009) – Praat script to detect syllable nuclei and measure speech rate automatically](https://link.springer.com/article/10.3758/BRM.41.2.385)
- [Ding et al. (2017) – Temporal modulations in speech and music (4 Hz syllabic peak)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5606767/)

---

## d) Detección de Pitch: `pitchy` (McLeod), `Meyda` y `YIN`

| Librería / Algoritmo | Algoritmo de Pitch | Tamaño (minificado) | Licencia | ¿Funciona en `AudioWorklet`? | Costo de CPU (bloque 2048 @ 48 kHz) |
|---|---|---|---|---|---|
| **`pitchy` (v4.x)** | **MPM** (McLeod Pitch Method, NSDF + interpolación parabólica) | **~4.5 KB** min (~1.8 KB gzip), 0 dependencias | **MIT** | **Sí, directo.** Es ES module puro y opera sobre `Float32Array` sin usar `window` ni DOM. | Bajo (`~0.3 – 0.8 ms` en móvil moderno) |
| **`Meyda` (v5.x)** | No es detector de pitch dedicado (extrae ZCR, Spectral Centroid, Chroma, MFCC, RMS) | **~65–90 KB** min (~20 KB gzip) | **MIT** | Parcial (su analizador principal se acopla a `ScriptProcessorNode`/`AnalyserNode`; usar su extractor crudo en worklet añade peso innecesario). | Medio-Alto si se calculan FFTs + MFCC/Chroma (`~1.5 – 3.5 ms`) |
| **YIN propio** (de Cheveigné & Kawahara, 2002) | Función de diferencia media acumulada normalizada (CMNDF) + umbral absoluto (`0.10–0.15`) | **~1.5 KB** (~60 líneas de JS puro) | Propio / Dominio público | **Sí, nativo.** Cero asignaciones si se pre-aloca el buffer de diferencias en el constructor del worklet. | Bajo (`~0.2 – 0.6 ms` limitando el rango de lags a voz humana: 75–500 Hz) |

### Observaciones clave para voz hablada (sermón)
- **Ventaja de `pitchy` (MPM) y `YIN`:** Ambos devuelven una métrica de **claridad / periodicidad** (`clarity` en `pitchy` de 0 a 1; `1 - aperiodicity` en YIN). En voz hablada esto es vital para descartar consonantes sordas, respiraciones y ruido ambiente (aceptar solo muestras con `clarity > 0.80`).
- **Optimización para voz:** Mientras que `pitchy` evalúa todo el buffer por defecto, un **YIN propio acotado a 70 Hz – 500 Hz** (lags de 96 a 685 muestras a 48 kHz) reduce el bucle cuadrático en más de un 60% de CPU frente a un detector de rango completo.

**Fuentes (d):**
- [GitHub – ianprime0509/pitchy (McLeod Pitch Method in JS)](https://github.com/ianprime0509/pitchy)
- [GitHub – meyda/meyda (Audio feature extraction library)](https://github.com/meyda/meyda)
- [de Cheveigné & Kawahara (2002) – YIN, a fundamental frequency estimator for speech and musica](http://audition.ens.fr/adc/pdf/2002_JASA_YIN.pdf)

---

## e) Motor de Audio: `Tone.js` vs. Web Audio Puro con Lookahead Scheduler

### Estado actual y peso de `Tone.js`
- **Versión actual:** `v15.x` (`15.0.4` / `15.1.x`).
- **Tamaño:** El bundle completo minificado pesa **~150–200 KB** (`~45–55 KB` gzip). Aunque soporta *tree-shaking* vía ESM, importar `Transport`, `PolySynth` o `Player` arrastra `standardized-audio-context` y gran parte del núcleo (>100 KB min).

### Problemas conocidos en iOS (Safari / WebKit)
1. **Interruptor físico de silencio (Mute/Ringer Switch) en iPhone/iPad:**
   - Por defecto, Safari asigna Web Audio a la categoría `ambient` de iOS: **si el interruptor lateral del iPhone está en silencio (modo vibración), Web Audio y `Tone.js` no emiten ningún sonido**, aunque `AudioContext.state` sea `'running'`.
   - **Soluciones actuales:**
     - En **iOS 16.4+**, usar la nueva API estándar W3C: `navigator.audioSession.type = 'playback'` (o `'play-and-record'` si se usa junto con micrófono).
     - Como *fallback* universal en iOS: reproducir en bucle un elemento `<audio>` HTML5 con un WAV silencioso de 1 segundo dentro del evento `click`/`touchend` que inicia el sistema.
2. **Desbloqueo y suspensión (`interrupted` / `suspended`):**
   - El `AudioContext` debe crearse o reanudarse (`resume()`) síncronamente dentro de un gesto de usuario. Si la pantalla se bloquea o entra una llamada, iOS pasa el contexto al estado no estándar `'interrupted'` o `'suspended'`.
3. **Sobrecarga de `standardized-audio-context` en `Tone.js`:**
   - `Tone.js` envuelve el `AudioContext` nativo con el polyfill `standardized-audio-context`, lo que a veces complica compartir el mismo contexto con un `MediaStreamAudioSourceNode` y un `AudioWorklet` propio en Safari iOS.

### Comparativa frente a Web Audio API puro con Lookahead Scheduler
Siguiendo el patrón clásico de Chris Wilson (*"A Tale of Two Clocks"*): usar un `setInterval` o Worker cada `25 ms` que programe eventos con una ventana de anticipación (*lookahead*) de `100 ms` directamente sobre el reloj de hardware `audioCtx.currentTime`:
- **Jitter:** Idéntico o menor que `Tone.Transport` (`<1 ms`, exactitud a nivel de muestra en `AudioParam.setValueAtTime` / `linearRampToValueAtTime`).
- **Peso:** **~2–3 KB** de código propio frente a ~150 KB de `Tone.js`.
- **Control de recursos:** Evita nodos intermedios ocultos de `Tone.js` que consumen CPU en móviles de gama media.

**Fuentes (e):**
- [GitHub – Tonejs/Tone.js Releases & Bundle](https://github.com/Tonejs/Tone.js)
- [W3C Audio Session API (`navigator.audioSession`)](https://w3c.github.io/audio-session/)
- [MDN / Chris Wilson – Audio scheduling ("A Tale of Two Clocks")](https://web.dev/articles/audio-scheduling)

---

## f) Síntesis vs. Loops/Samples y Fuentes Gratuitas CC0

### Peso típico y calidad sonora para acompañamiento de sermón ("Worship Pad" + Shimmer/Cymbals)
| Enfoque | Peso en red (KB) | Uso de RAM / CPU | Calidad y expresividad en vivo |
|---|---|---|---|
| **Síntesis Web Audio pura** (2–4 `OscillatorNode` detuned saw/triangle + filtro paso-bajo modulable + ruido rosa filtrado + reverb por convolución/algorítmica) | **< 5 KB** (o **~30–60 KB** si incluye un Impulse Response `.ogg` corto para `ConvolverNode`) | RAM mínima; CPU baja (`<3%` para 4–6 voces con nodos nativos en C++) | **Muy alta adaptabilidad:** permite abrir la frecuencia de corte del filtro (`BiquadFilterNode.frequency`) de 250 Hz a 3,500 Hz de forma continua y orgánica según la energía de la voz, sin saltos de muestra. |
| **Loops / Samples pregrabados** (acordes de pad de 15–30 s en `.ogg`/`.aac` o `.mp3` + muestras de platillo *swell*) | **~400 KB – 2.5 MB** (según cantidad de tonalidades o si se hace *pitch-shifting* desde 2–3 muestras base) | Mayor RAM (buffers decodificados en PCM 32-bit ocupan ~3.5 MB por cada 30 s estéreo a 48 kHz); CPU muy baja | Textura acústica muy rica de entrada, pero **rígida**: cambiar de acorde o cruzar entre capas suaves/intensas requiere *crossfades* cuidadosos, y estirar el pitch más de ±3 semitonos degrada los formantes. |

- **Enfoque híbrido recomendado:** Síntesis sustractiva/aditiva + `ConvolverNode` para los pads continuos (permite modulación continua de filtro y volumen por energía vocal con 0 KB de samples) combinada con **1 o 2 muestras cortas en Ogg/Opus (~40–80 KB total)** para efectos percusivos suaves (*cymbal swell* / *shimmer* en clímax).

### Fuentes gratuitas con licencia CC0 (Dominio Público, sin atribución requerida)
1. **[Versilian Community Sample Library (VCSL)](https://github.com/sgossner/VCSL):** Biblioteca abierta en GitHub bajo licencia **CC0 1.0 Universal**. Contiene grabaciones limpias de platillos orquestales (*cymbal rolls/swells*), cuerdas y sintetizadores en WAV listos para convertir a Ogg/Opus.
2. **[Freesound.org (Filtro CC0)](https://freesound.org/search/?q=ambient+pad+OR+cymbal+swell&f=license:%22Creative+Commons+0%22):** Miles de pads ambientales, drones y *cymbal swells* bajo licencia CC0.
3. **[OpenGameArt.org (Sección Audio CC0)](https://opengameart.org/art-search-advanced?keys=pad&field_art_type_tid%5B%5D=12&field_art_licenses_tid%5B%5D=4):** Loops ambientales y texturas sintéticas en formato `.ogg` liviano bajo CC0.

---

## g) Mitigación de Realimentación (Feedback) Micrófono-Altavoz en Iglesias

El mayor riesgo en vivo ocurre cuando el micrófono del dispositivo (o del predicador) capta la música generada por la propia app saliendo por el sistema de sonido (PA) o monitores de piso, haciéndole creer al algoritmo que el predicador sigue hablando fuerte (**bucle de energía infinita**).

### Estrategias acústicas, de ruteo y de software
1. **Ruteo físico ideal (Separación en consola):**
   - La salida de audio de la tablet/celular o laptop debe enviarse por **caja directa (DI Box) o interfaz USB a un canal dedicado de la consola de la iglesia**, y **NO debe enviarse a los monitores de piso del púlpito** (o enviarse muy atenuada), o bien el predicador debe usar **monitores in-ear (IEM)**.
   - Si el dispositivo usa el mismo micrófono del predicador (ej. vía envío Aux/USB desde la consola), la consola debe enviar a la app **únicamente el canal directo del micrófono del predicador (*Pre-Fader Direct Out* o Aux exclusivo)**, jamás la mezcla principal (*Main Mix*). Con eso la realimentación desaparece de raíz.
2. **Tipo de micrófono cuando se capta por aire:**
   - **Micrófono de diadema (Headset) o solapa cardioide** a 2–3 cm de la boca del predicador ofrece entre **+12 dB y +18 dB más de ganancia antes de realimentación (GBF)** y relación señal-ruido frente a la música ambiental de la sala en comparación con el micrófono interno de una tablet puesta en el atril.
3. **¿Sirve `echoCancellation: true` del navegador contra los altavoces de la iglesia?**
   - **No es suficiente y suele ser contraproducente.** El cancelador de eco WebRTC del navegador está diseñado para ecos cortos del altavoz interno del dispositivo (`<50 ms`). En un templo con reverberación de `1.5 a 3 segundos` y retardo acústico desde las columnas de PA (`30–100 ms`), el filtro adaptativo diverge y distorsiona la voz.
4. **Mitigaciones algorítmicas en nuestro DSP (`g-retro`):**
   - **Filtrado espectral de detección:** Los pads musicales tendrán su energía fundamental concentrada en graves/medios-graves (`80–300 Hz`) o brillo muy alto, mientras que el detector de energía/sílabas puede enfocarse en la banda de presencia vocal (**400 Hz – 3,000 Hz**) o exigir **periodicidad/modulación de 2–8 Hz** (un pad sostenido tiene modulación ~0 Hz; si la señal es constante sin picos silábicos durante >2 segundos, el sistema distingue que es música de fondo o ruido y no voz hablada).
   - **Compuerta dinámica (Gate con histéresis) + Auto-Ducking de referencia:** El motor conoce exactamente qué nivel de salida ($L_{\text{out}}$) está generando en cada instante. Puede elevar dinámicamente el umbral de detección de voz en proporción a la energía musical emitida ($\text{Threshold}_{\text{efectivo}} = \text{Threshold}_{\text{base}} + k \cdot L_{\text{out}}$) para evitar que el propio pad mantenga abierto el detector cuando el predicador calla.

**Fuentes (g):**
- [Shure Audio Institute – Sound Reinforcement for Houses of Worship & Gain Before Feedback](https://www.shure.com/en-US/performance-production/louder/how-to-control-feedback-in-sound-reinforcement-systems)
- [WebRTC AEC3 Architecture & Acoustic Echo Cancellation Limitations (Chromium)](https://chromium.googlesource.com/external/webrtc/+/HEAD/modules/audio_processing/aec3/)
