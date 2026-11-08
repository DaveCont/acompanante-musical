# Resultados: b-energia

Calibración independiente: exactamente 10 s de calibracion.wav (5 normal + 5 fuerte), sin usar las etiquetas del sermón para calcular umbrales. Se conservan los cuatro métodos anteriores y su calibración p65/histéresis 1,5 dB. La mezcla usa los mismos umbrales sin compensar su atenuación ni restar una referencia.

## Voz neural sola

|Método|Acierto %|Tras 800 ms %|Reacción mediana ms|Subida med./máx. ms|Subidas detectadas|Cruda 1 dB ms|Parpadeos|CPU ms/128|
|---|---:|---:|---:|---:|---:|---:|---:|---:|
|RMS 10/200|61.247|61.896|213.333|210.667 / 213.333|2/4|50.667|74|0.006625|
|RMS 20/300|62.191|63.246|285.333|213.333 / 221.333|2/4|50.667|60|0.006846|
|RMS 30/400|62.704|63.905|400|221.333 / 226.667|2/4|50.667|34|0.008961|
|LUFS K 400ms|79.278|80.251|384|378.667 / 445.333|4/4|50.667|128|0.019084|
|HP100 RMS 30/800|63.844|65.485|864|221.333 / 237.333|2/4|50.667|22|0.017754|
|HP100 RMS 50/1500|62.778|64.369|248|232 / 248|2/4|50.667|6|0.013281|
|HP100 RMS 80/2500|59.344|60.742|269.333|240 / 269.333|2/4|50.667|2|0.012146|
|VAD hold 1500|66.707|67.884|402.667|226.667 / 1165.333|4/4|50.667|80|0.008199|
|Voz p85 1500ms|67.189|69.035|1514.667|221.333 / 229.333|2/4|50.667|5|0.012442|
|HP100 + VAD + p85|94.144|96.927|360|232 / 360|4/4|50.667|3|0.015429|

## Sermón con música

|Método|Acierto %|Tras 800 ms %|Reacción mediana ms|Subida med./máx. ms|Subidas detectadas|Cruda 1 dB ms|Parpadeos|CPU ms/128|
|---|---:|---:|---:|---:|---:|---:|---:|---:|
|RMS 10/200|48.28|49.284|226.667|208 / 226.667|2/4|50.667|115|0.006625|
|RMS 20/300|50.053|51.104|234.667|210.667 / 234.667|2/4|50.667|90|0.006846|
|RMS 30/400|50.898|52.47|661.333|213.333 / 240|2/4|50.667|73|0.008961|
|LUFS K 400ms|46.678|47.487|410.667|410.667 / 10466.667|4/4|50.667|111|0.019084|
|HP100 RMS 30/800|61.544|62.981|722.667|221.333 / 253.333|2/4|50.667|19|0.017754|
|HP100 RMS 50/1500|61.327|62.953|394.667|229.333 / 394.667|2/4|50.667|13|0.013281|
|HP100 RMS 80/2500|58.96|60.511|464|245.333 / 464|2/4|50.667|5|0.012146|
|VAD hold 1500|49.222|50.584|240|210.667 / 240|2/4|50.667|83|0.008199|
|Voz p85 1500ms|55.582|57.47|530.667|418.667 / 530.667|2/4|50.667|9|0.012442|
|HP100 + VAD + p85|66.653|68.915|1352|418.667 / 538.667|2/4|50.667|7|0.015429|

## Parámetros y medición

Pasaaltos Butterworth 100 Hz (segundo orden). RMS asimétrico sobre potencia. Se prueban attack/release 30/800, 50/1500 y 80/2500 ms. VAD por umbral relativo: p65 de la envolvente rápida normal menos 18 dB, apertura/cierre ±1 dB. Hold congela el nivel mientras no hay voz durante 1500 ms; luego vuelve directamente a 1. No es un separador de voz y música.

Percentil causal p85 sobre 1500 ms de reloj, únicamente bloques con voz; histograma de 0,25 dB, sin relleno futuro. Su envolvente tiene attack/release 30/80 ms. Híbrido: HP100 + esa envolvente + VAD/hold + p85 + histéresis 1,5 dB. Ventana parcial al arrancar, sin esperar a llenarla.

Acierto total incluye arranques y todos los silencios etiquetados 1; acierto tras 800 ms excluye solo los primeros 800 ms de cada segmento. Reacción: primera coincidencia correcta sostenida 100 ms; mediana general incluye bajadas deliberadamente lentas. Subida se informa aparte (4 transiciones); fallos y reacciones individuales están en JSON. Parpadeos: cambios de nivel después de los primeros 800 ms del segmento, incluyendo descensos de silencio.

Se mantiene la definición del script anterior: mediana = p50 discreto inferior, sin interpolación. Las reacciones nulas no entran en el p50: por eso se informa cuántas subidas fueron detectadas. El híbrido detecta 4/4 subidas en voz sola y 2/4 con música; los dos segmentos de nivel 4 de la mezcla nunca alcanzan acierto sostenido. La mezcla atenúa toda la voz (véase ground-truth.json); no se ajustan umbrales con esa información. La meta ≥90% y subida <400 ms se cumple en voz sola, no con música.

Cruda: salida rápida independiente para golpes (HP si corresponde, RMS 30/80 ms), tiempo hasta quedar a 1 dB del destino en escalón senoidal 1 kHz de −30 a −10 dBFS. No usa percentil ni hold. No equivale a latencia acústica ni de salida. También se guarda el escalón de clasificación en JSON. Cuantización temporal: 2,667 ms. CPU: media y p95 en JSON, todos los bloques de la mezcla, camino completo incluido clasificador.

## Recomendación (3 líneas)

Elegir HP100 + VAD + p85: 94.144% de acierto y 3 parpadeos en voz sola.  
Usar salida rápida RMS 30/80 ms para golpes y salida estabilizada para niveles; mantener calibración de 10 s.  
Con música alcanza 66.653% y falla 2 subidas: mejorar discriminación de voz/pad y validar micrófono/PA real y tablet.

## Verificación y pendientes

Ejecutado node experiments/b-energia/verificar.mjs: trazas anteriores idénticas; pausa corta conservada; descenso por silencio; subida continua sin pausa en 242,667 ms. Paridad exacta del worklet simulado con Node: 5625 mensajes por cada audio; calibración de PCM continuo de 10 s idéntica y cambio de los 10 métodos. Evidencia: [verificacion.json](./verificacion.json).

La página selecciona el ganador por defecto, permite todos los métodos y aplica la misma calibración por método tanto en vivo como al medir WAV. La validación real de navegador está pendiente: node experiments/b-energia/verificar-navegador.mjs no pudo lanzar Chrome por el sandbox (spawn EPERM); no se afirma prueba visual ni de audio del navegador. La revisión cruzada con Claude se intentó y la aprobación automática del MCP la rechazó porque la política de esta sesión no permite aprobaciones. Sin commit.

DSP local 5.007 KiB + compartido 5.628 KiB. Ejecutar: node experiments/b-energia/medir.mjs.

Medido 2026-11-08T15:12:39.080Z; v24.14.1; Intel(R) Core(TM) i7-6820HK CPU @ 2.70GHz. Bloque de audio: 128 muestras / 48 kHz = 2,667 ms. CPU de Node no equivale a tablet.

Datos completos: [resultados.json](./resultados.json).
