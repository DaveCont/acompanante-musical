# Decisiones técnicas – Fase 0

Fecha: 2026-11-08. Evidencia: prototipos en `experiments/*` (cada uno con `RESULTADOS.md`),
investigación con fuentes en `docs/investigacion-fase0.md`, audio de prueba en `test-audio/`
(voz neural es-MX generada con edge-tts: sermón simulado de 120 s de susurro a efusivo, con pausas,
y versión con música a −20 dBFS).

Las mediciones de CPU son de laptop (Node/Chrome, i7-6820HK). **Pendiente de confirmar en tablet/celular
y con micrófono real** usando `experiments/servir.cmd` → `experiments/index.html`.

---

## a) Captura de voz
| Opción | Pros | Contras |
|---|---|---|
| Filtros ON (echoCancellation/noiseSuppression/autoGainControl) | Menos ruido de fondo | **El AGC aplana la intensidad** (justo lo que queremos medir); el AEC diverge con la reverberación del templo y los pads sostenidos |
| Filtros OFF | Señal fiel a la dinámica real del orador | Entra más ruido/música → se compensa con calibración y gate |

**Decisión:** filtros **OFF** por defecto (opción para activarlos en Ajustes). Captura con **AudioWorklet**
(bloques de 128 muestras = 2,7 ms), no AnalyserNode.
- iOS: si el usuario activó "Aislamiento de voz" en el Centro de Control, Safari ignora `noiseSuppression:false` → avisarlo en el README.
- iOS: el interruptor de silencio enmudece Web Audio → usar `navigator.audioSession.type = 'playback'` (iOS 16.4+) con respaldo de `<audio>` silencioso.
- Pendiente en dispositivo: `baseLatency`/`outputLatency` reales (la página `a-captura` los muestra).

## b) Energía (volumen) — punto crítico
Con voz realista, los métodos simples fallan porque **las micro-pausas entre palabras hunden el nivel**:

| Método | Acierto % (voz sola) | Parpadeos |
|---|---:|---:|
| RMS 20/300 ms | 62 | 60 |
| LUFS momentáneo (K, 400 ms) | 79 | 128 |
| **Híbrido** | **94** (97 tras 800 ms) | **3** |

**Decisión: método híbrido**
1. Pasa-altos 100 Hz (quita golpes de micrófono y graves).
2. Envolvente RMS rápida attack 30 / release 80 ms → **50,7 ms de reacción**: alimenta platillos/redobles (meta < 150 ms ✔).
3. Detector de voz que **sostiene el nivel en pausas < 1,5 s** y solo baja tras silencio sostenido.
4. Nivel = percentil 85 de la envolvente en los últimos 1,5 s, solo en tramos con voz.
5. Mapa a 4 niveles con histéresis de 1,5 dB. Subida de nivel audible en ≤ 360 ms (243 ms sin silencio previo).
- CPU: < 0,02 ms por bloque de 128 (despreciable).
- **Calibración 10 s:** 5 s "habla normal" + 5 s "habla fuerte" → fija los umbrales de los 4 niveles para cada orador.
- Verificado: resultados idénticos en Node y dentro del AudioWorklet de Chrome.
- Con música mezclada el acierto cae a 67 % → ver punto g (se resuelve sobre todo con la conexión física).

## c) Velocidad de habla
| Opción | Offline | Latencia | Resultado |
|---|---|---|---|
| Picos de envolvente (2–10 Hz) por segundo | Sí | ~10 ms + ventana | Error 0–31 % vs. referencia aproximada; distingue lento/normal/rápido |
| Web Speech API (SpeechRecognition) | No fiable: requiere red en iOS/Android; corta sesiones; 0,3–1,2 s de retraso | Alta | Descartado |

**Decisión:** **picos de envolvente** (offline, barato). Se usará como **tendencia** (lento/normal/rápido) con
suavizado de varios segundos, solo para matices (tempo percibido), nunca para cambiar niveles.
La página `c-velocidad/speech.html` queda para comprobar en el dispositivo con el wifi apagado.

## d) Pitch (entonación)
| Método | Error en tonos | CPU por cálculo (ventana 2048) | Peso |
|---|---:|---:|---:|
| YIN propio | 0,015 Hz | 4,9 ms | ~1,5 KB |
| Autocorrelación propia | 0 Hz | 14,9 ms | — |
| **pitchy (McLeod)** | 0 Hz | **0,9 ms** | 8,6 KB |
| Meyda | No da F0 (solo centroide espectral) | 1,3 ms | 16 KB |

**Decisión:** **pitchy**, calculado ~cada 20–40 ms (no en cada bloque de 2,7 ms) para que sobre CPU en tablet.
Se usa su "claridad" para ignorar tramos sin voz. El pitch solo modula el brillo del filtro (Fase 2).

## e) Motor de audio
| | Peso | Jitter medido (200 golpes) | iOS |
|---|---:|---|---|
| Tone.js 15.1 | 343 KB | — | Problemas conocidos de desbloqueo/suspensión |
| **Web Audio puro + planificador "lookahead"** (100 ms, timer 25 ms) | **5 KB** | 0 ms en reloj de audio; margen mínimo 78 ms | Control total |

**Decisión:** **Web Audio puro** con planificador propio. Más ligero, más estable y suficiente para loops simples.

## f) Fuente de sonido
| | Peso | Notas |
|---|---:|---|
| **Síntesis** (pad 2 osciladores ±7 cents + filtro, bajo seno, kick/hat/crash por ruido) | **5 KB** | Cualquier tonalidad al instante, siempre afinado |
| Loops pregrabados | 773 KB por tonalidad → **9 MB** las 12 | Calidad fija, pesado para offline |

**Decisión:** **síntesis** para pad, bajo y percusión, + **2–4 samples cortos CC0** (crash, redoble) para que el
clímax suene real (unos cientos de KB). Hay que oír los dos en `f-sonido` y afinar el timbre del pad en la Fase 1.

## g) Retroalimentación (la música entra al micrófono)
Medido: sin protección, **la música sola mantiene el nivel ≥ 2 el 72 % del tiempo** (falsos disparos).
Una compuerta fija por nivel la reduce, pero se come la voz normal. Restar la propia salida solo funciona con
alineación perfecta (con 5 ms de error, empeora).

**Decisión (en orden de importancia):**
1. **Conexión física** (lo que más funciona):
   - Micrófono de **diadema/cardioide cerca de la boca** → la voz llega 20–30 dB por encima de la música.
   - Mejor aún: la app toma la voz de una **salida auxiliar de la consola** (envío pre-fader del micrófono del predicador), y la música de la app va **a la consola**, no a una bocina junto al púlpito.
2. **En la app:**
   - Umbral que **sube automáticamente con el volumen de la propia música** (sabemos cuánto suena).
   - Exigir modulación silábica (2–8 Hz) para contar algo como voz: un pad sostenido no la tiene.
3. **Modo audífonos** para ensayar sin bocinas.
4. Los controles manuales de la Fase 3 (nivel 1–4, congelar, pánico) son la red de seguridad.

---

## Pruebas reales en celular (Android 10, Chrome 156) — 2026-11-08
Página `experiments/h-celular` (micrófono y bocina del mismo teléfono), datos del diagnóstico del usuario:
- La cadena completa funciona: audio a 48 kHz, AudioWorklet estable (~94 datos/s), sin errores.
- **Eco ON aplana la voz:** diferencia normal→fuerte de 1,3 dB en tres calibraciones. La prueba libre parpadeó
  (20 cambios en 30 s, 14 % de nivel alto sin voz). → **En celular, eco OFF por defecto.**
- **Eco OFF:** la mejor calibración dio 6,3 dB normal→fuerte (ideal ≥ 8). Prueba libre con música sonando:
  9 cambios en 30 s y **0 % de nivel alto sin voz**. Comportamiento aceptable.
- El rango dinámico del micrófono del teléfono es corto (normal ≈ −25 dBFS, fuerte ≈ −18 dBFS): la calibración
  debe pedir explícitamente "más fuerte" y rechazar diferencias < 4 dB.
- **"Brillo" de la voz (agudos/graves) no sirve de respaldo** en este teléfono: −2,9 dB y +1 dB, sin patrón. Descartado.
- Pendiente: prueba de silencio con eco OFF y música por la bocina (fuga).

## Pendiente de probar en dispositivo (usuario)
- [ ] Latencia real de entrada/salida en tablet y celular (`a-captura`).
- [ ] Filtros ON vs OFF con el micrófono real.
- [ ] Web Speech con wifi apagado (`c-velocidad/speech.html`), solo como dato.
- [ ] CPU de pitchy en tablet (`d-pitch`).
- [ ] Escuchar síntesis vs loops (`f-sonido`).

## Cómo reproducir
`cd experiments && npm install && npm run vendor && node medir-todo.mjs`
Audio: `python test-audio/generar.py` (requiere internet para edge-tts).
