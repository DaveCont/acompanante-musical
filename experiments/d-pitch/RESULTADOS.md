# Resultados: d-pitch

Ventana 2048 (42,667 ms), hop 128 (2,667 ms). CPU: una evaluación completa por hop; no se divide artificialmente el coste de la ventana.

|Método|MAE tonos Hz|MAE voz sintética Hz|CPU ms/hop128|p95 CPU ms|
|---|---:|---:|---:|---:|
|YIN propio|0.015|0.001|5.67525|8.1389|
|Autocorrelación propia|0|0.002|14.820888|17.2788|
|pitchy|0|0.002|0.875241|1.0664|
|Meyda centroid (NO F0)|7.08|622.982|1.409948|2.0632|

Voz sintética armónica con F0 conocida: 110,160,220,300 Hz y formantes. El TTS español no tiene referencia F0 absoluta: se reporta diferencia frente a YIN, no precisión verdadera; la comparación YIN consigo mismo es control y no validación. Jitter de frecuencia no equivale a jitter del planificador; ver errores por tono en JSON.

Meyda: no expone estimador F0; se mide spectralCentroid como descriptor NO equivalente

Peso propio 5.628 KiB; bibliotecas ausentes: peso pendiente, nunca cero.

Medido 2026-11-08T15:11:44.700Z; v24.14.1; Intel(R) Core(TM) i7-6820HK CPU @ 2.70GHz. Bloque de audio: 128 muestras / 48 kHz = 2,667 ms. CPU de Node no equivale a tablet.

Datos completos: [resultados.json](./resultados.json).
