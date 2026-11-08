# Resultados: c-velocidad

Picos de envolvente: diferencia de LP 10 Hz y 2 Hz, muestreo de envolvente 100 Hz, refractario 100 ms.

|Archivo|Picos|Sílabas aproximadas|Estimado /s|Referencia /s|Error %|CPU ms/128|
|---|---:|---:|---:|---:|---:|---:|
|voz-normal.wav|56|71|3.406|4.319|-21.127|0.021066|
|voz-rapida.wav|76|111|4.172|6.094|-31.532|0.016207|
|voz-lenta.wav|46|46|2.9|2.9|0|0.015631|

Retardo mínimo de decisión de pico: 10 ms más los filtros; actualización 10 ms, cuantización <=10 ms. Peso DSP 5.628 KiB. La referencia cuenta grupos vocálicos del texto; su error lingüístico no está cuantificado y no constituye conteo fonético exacto.

[Web Speech](./speech.html): comprobar con wifi apagado en dispositivo; disponibilidad de la API no demuestra que funcione offline. El botón solicitará reconocimiento local cuando el navegador lo permita.

Medido 2026-11-08T15:11:38.658Z; v24.14.1; Intel(R) Core(TM) i7-6820HK CPU @ 2.70GHz. Bloque de audio: 128 muestras / 48 kHz = 2,667 ms. CPU de Node no equivale a tablet.

Datos completos: [resultados.json](./resultados.json).
