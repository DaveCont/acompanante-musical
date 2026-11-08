# Plan – Fase 0: Investigación y decisión técnica

**Objetivo:** decidir con evidencia (prototipos + mediciones) cómo resolver captura, energía,
velocidad de habla, pitch, motor de audio, fuente de sonido y retroalimentación.
Entregable: `/experiments/*` + `DECISIONS.md` + resumen al usuario. **No se empieza la Fase 1 sin su aprobación.**

## Preparación (Claude)
- `git init`, `.gitignore`, estructura: `experiments/`, `app/`, `docs/`, `test-audio/`.

## Paso 1 – Investigación (Antigravity, en paralelo con el paso 2)
Investigar en web (docs MDN, WebKit, Tone.js, pitchy, Meyda, artículos) y escribir
`docs/investigacion-fase0.md` con fuentes para los puntos a–g. Claves:
- a) Qué hacen realmente echoCancellation/noiseSuppression/AGC en Chrome y Safari iOS; soporte de AudioWorklet en iOS; latencia típica (baseLatency/outputLatency).
- c) ¿SpeechRecognition funciona offline? (Chrome on-device, Safari) → confirmar.
- d) pitchy (McLeod) vs Meyda vs YIN propio: tamaño, licencia, uso en worklet.
- e) Tone.js: tamaño, estabilidad del Transport en móviles, problemas conocidos en iOS.
- g) Mitigaciones de retroalimentación en sistemas de sonido de iglesia.

## Paso 2 – Audio de prueba (Codex)
- Generar en `test-audio/` voces sintéticas en español (edge-tts) con distintos volúmenes/velocidades
  y un "sermón simulado" de ~2 min que suba de tranquilo a efusivo, con pausas. Más una versión
  con música mezclada (para simular retroalimentación). Si el usuario aporta una grabación real, se usa también.

## Paso 3 – Prototipos (Codex) en `/experiments`, cada uno con página HTML y script de medición
| Carpeta | Qué compara | Cómo se mide |
|---|---|---|
| `a-captura/` | constraints ON vs OFF, AudioWorklet vs AnalyserNode | página con mic real + reporte de baseLatency/outputLatency; con audio de prueba: forma de la señal |
| `b-energia/` | RMS attack/release vs LUFS simple (K-weighting) + calibración 10 s | script Node offline sobre los WAV: tiempo de reacción (ms) y estabilidad |
| `c-velocidad/` | picos de energía/seg vs Web Speech API | Node offline: sílabas/s estimadas vs velocidad real del TTS; página para probar Web Speech sin internet |
| `d-pitch/` | YIN propio vs autocorrelación vs pitchy vs Meyda | Node: precisión y ms de CPU por bloque; página que mide CPU en tablet |
| `e-motor/` | Tone.js vs Web Audio puro | página: jitter del programador de loops, tamaño, facilidad |
| `f-sonido/` | síntesis vs loops pregrabados | página que toca ambos en una tonalidad; peso en KB |
| `g-retro/` | gate por nivel + compuerta "ducking" que ignora la música propia | Node: con audio voz+música, ¿la música propia dispara niveles? |
- Una página índice `experiments/index.html` para abrir todo desde la tablet.

## Paso 4 – Verificación (Antigravity en navegador + Claude)
- Antigravity abre los prototipos en Chrome (con audio falso por archivo, `--use-file-for-fake-audio-capture`), captura resultados y latencias.
- Claude revisa números y código crítico.

## Paso 5 – Decisiones (Claude)
- `DECISIONS.md`: por punto a–g → opciones, pros, contras, latencia/CPU medida, decisión.
- Commit "Fase 0". Resumen al usuario y espera de aprobación.

## Límites
- Pruebas con micrófono real y en tablet/celular físicos las hace el usuario con páginas listas (yo no puedo usar su micrófono): se dejan marcadas como "pendiente de confirmar en dispositivo".
- Todo dentro de esta carpeta; no tocar nada fuera.
