# Resultados: f-sonido

Progresión I-V-vi-IV en Do y Sol. Pad: dos osciladores detune ±7 cents por nota + filtro; bajo seno; kick con caída de frecuencia; hat/crash por ruido determinista. Misma función para síntesis en vivo y OfflineAudioContext.

Síntesis: 4.817 KiB de código compartido. Loop do: 773.48 KiB; 12 tonalidades 9.064 MiB. Loop sol: 773.48 KiB; 12 tonalidades 9.064 MiB.

{"navegador":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36","render":[{"tonalidad":"Do","duracion_s":8.25,"render_ms":1169.3999999985099,"programacion_ms":70.89999999850988,"cpu_render_equivalente_ms_por128":0.37798787878739715,"peso_kib":773.48046875,"peso_12_mib":9.064224243164062,"error_pcm16_rms_dbfs":-100.97437236502869,"pico_dbfs":-11.410015867159567,"muestras_recortadas":0},{"tonalidad":"Sol","duracion_s":8.25,"render_ms":771.5,"programacion_ms":39.600000001490116,"cpu_render_equivalente_ms_por128":0.2493737373737374,"peso_kib":773.48046875,"peso_12_mib":9.064224243164062,"error_pcm16_rms_dbfs":-100.972562030133,"pico_dbfs":-11.205919367550992,"muestras_recortadas":0}]}

Jitter: el inicio usa el reloj de audio; ver prueba de e. Error de cuantización PCM16 y métricas de render se guardan al ejecutar el navegador.

Medido 2026-11-08T15:11:47.652Z; v24.14.1; Intel(R) Core(TM) i7-6820HK CPU @ 2.70GHz. Bloque de audio: 128 muestras / 48 kHz = 2,667 ms. CPU de Node no equivale a tablet.

Datos completos: [resultados.json](./resultados.json).
