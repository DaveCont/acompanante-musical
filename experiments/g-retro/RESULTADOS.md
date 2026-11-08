# Resultados: g-retro

|Prueba|Tiempo nivel >=2 %|Acierto etiquetas %|Voz >=2 detectada %|
|---|---:|---:|---:|
|Música sola|72.144|23.053|72.033|
|Mezcla|77.662|50.053|95.607|
|Gate música|38.498|28.056|38.247|
|Gate mezcla|62.164|85.458|90.807|
|Resta ideal música|0|33.333|0|
|Resta ideal mezcla|63.676|62.191|92.653|
|Resta desalineada mezcla|97.902|47.822|100|

Gate fijo de nivel: umbrales -16,-12,-6 dBFS, histéresis 2 dB; su coste es perder voz normal. Resta digital ideal: mezcla / ganancia_mezcla - referencia alineada. Error RMS de reconstrucción -95.847 dBFS. CPU resta 0.002765 ms/128. Peso DSP 5.628 KiB. Reacción: misma envolvente RMS 20/300 ms de b; cuantización 2,667 ms.

Esto simula contaminación del micrófono, no realimentación acústica de lazo cerrado. La resta conocida solo es ideal con alineación y ganancia exactas; se incluye error de 5 ms / 10%. No demuestra cancelación en un recinto ni sustituye un filtro adaptativo.

Medido 2026-11-08T15:12:10.483Z; v24.14.1; Intel(R) Core(TM) i7-6820HK CPU @ 2.70GHz. Bloque de audio: 128 muestras / 48 kHz = 2,667 ms. CPU de Node no equivale a tablet.

Datos completos: [resultados.json](./resultados.json).
