# Resultados: e-motor

Registro real de 200 callbacks Node a 10 ms: retraso medio 454.345 ms; p95 854.792 ms; jitter de intervalo p95 9.785 ms. Son callbacks del sistema, no golpes del reloj de audio.

La página programa 200 golpes a 20 ms con lookahead 100 ms, timer 25 ms y AudioContext; registra tiempos esperados/programados y margen. Comparación Tone: disponible. Peso propio 4.817 KiB; Tone 343.34 KiB. CPU/128: no aplica al planificador por evento; latencia acústica pendiente de dispositivo.

Registro navegador: {"navegador":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36","comparacion":[{"metodo":"propio","golpes":200,"jitter_programado_p95_ms":0,"jitter_programado_max_ms":0,"callback_jitter_p95_ms":2.2000000029802322,"margen_min_ms":77.99999999999984,"duracion_real_ms":4235.10000000149,"nota":"Jitter del tiempo programado y del callback; no mide latencia acústica. Lookahead 100 ms, timer 25 ms."},{"metodo":"tone","golpes":200,"jitter_programado_p95_ms":7.105427357601002e-12,"jitter_programado_max_ms":7.993605777301127e-12,"callback_jitter_p95_ms":null,"margen_min_ms":-191.33333333333331,"duracion_real_ms":4264.10000000149,"nota":"Jitter del tiempo programado y del callback; no mide latencia acústica. Lookahead 100 ms, timer 25 ms."}]}.

Medido 2026-11-08T15:11:47.633Z; v24.14.1; Intel(R) Core(TM) i7-6820HK CPU @ 2.70GHz. Bloque de audio: 128 muestras / 48 kHz = 2,667 ms. CPU de Node no equivale a tablet.

Datos completos: [resultados.json](./resultados.json).
