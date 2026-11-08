"""Audio sintético reproducible. Ejecutar: python test-audio/generar.py.

Edge necesita red y uvx; --solo-local permite reproducir con SAPI Helena.
No se reemplazan voces cacheadas. --regenerar permite rehacer los WAV derivados.
"""
from pathlib import Path
import argparse, json, math, os, re, shutil, subprocess, sys, wave
import numpy as np
from scipy.signal import butter, sosfilt, lfilter, iirpeak

ROOT = Path(__file__).resolve().parent
SR = 48000
TEXT = ('Hermanos, hoy caminamos con esperanza. La fe nos invita a servir con amor, '
        'a escuchar al que sufre y a compartir nuestro pan. Aunque llegue la tormenta, '
        'no estamos solos. Levantemos la mirada y demos gracias por un nuevo día. ')

def write(name, data):
    data = np.asarray(data)
    if np.max(np.abs(data), initial=0) > 1.0001:
        raise ValueError(f'Clipping en {name}')
    with wave.open(str(ROOT / name), 'wb') as f:
        f.setparams((1, 2, SR, 0, 'NONE', 'not compressed'))
        f.writeframes((np.clip(data, -1, 1) * 32767).round().astype('<i2').tobytes())

def read(path):
    with wave.open(str(path), 'rb') as f:
        assert f.getframerate() == SR and f.getnchannels() == 1 and f.getsampwidth() == 2
        return np.frombuffer(f.readframes(f.getnframes()), '<i2').astype(float) / 32768

def rms(x): return float(np.sqrt(np.mean(np.square(x))))
def db(x): return 20 * math.log10(max(rms(x), 1e-12))
def syllables(text):
    # Grupos vocálicos: aproximación explícita, no alineación fonética.
    return len(re.findall(r'[aeiouáéíóúü]+', text.lower()))

def formant_speech(text, rate=1., pitch=130):
    """Último recurso: voz robótica por formantes, NO una voz neuronal.

    Secuencia española aproximada grafema-fonema, fuente glotal y ruido determinista.
    Permite probar envolvente/pitch sin descargar ni grabar voces. Limitada inteligibilidad.
    """
    rng = np.random.default_rng(719)
    vowels = {'a':(800,1200,2500), 'e':(450,2000,2600), 'i':(280,2300,3000),
              'o':(500,850,2500), 'u':(320,650,2400)}
    clean = text.lower().translate(str.maketrans('áéíóúü','aeiouu'))
    chunks=[];phase=0
    for i,c in enumerate(clean):
        if c in vowels:
            duration=.185/rate
            t=np.arange(round(duration*SR))/SR
            f0=pitch*(1+.045*np.sin(2*np.pi*3*t)+.03*np.sin(i))
            phasev=phase+np.cumsum(f0)/SR;phase=phasev[-1]%1
            source=np.zeros(len(t))
            for h in range(1,35):source+=np.sin(2*np.pi*h*phasev)/(h**1.25)
            y=np.zeros_like(source)
            for f in vowels[c]:
                b,a=iirpeak(f,8,fs=SR);y+=lfilter(b,a,source)
            y/=max(np.max(np.abs(y)),1e-8)
            fade=min(int(.015*SR),len(y)//3);env=np.ones(len(y));env[:fade]=np.linspace(0,1,fade);env[-fade:]=np.linspace(1,0,fade)
            chunks.append(.6*y*env)
        elif c.isalpha():
            n=round(.045*SR/rate);t=np.arange(n)/SR
            if c in 'sfjzxc':
                y=sosfilt(butter(2,2200,fs=SR,btype='highpass',output='sos'),rng.normal(0,.1,n))
            elif c in 'mnrlñ':y=.13*np.sin(2*np.pi*pitch*t)+.05*np.sin(4*np.pi*pitch*t)
            elif c in 'ptkbdg':y=np.concatenate([np.zeros(n*2//3),rng.normal(0,.12,n-n*2//3)])
            else:y=np.zeros(n)
            chunks.append(y*np.sin(np.linspace(0,np.pi,n)))
        elif c in ',.;':chunks.append(np.zeros(round((.12 if c==',' else .22)*SR/rate)))
        elif c==' ':chunks.append(np.zeros(round(.018*SR/rate)))
    return np.concatenate(chunks)

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--solo-local', action='store_true')
    p.add_argument('--regenerar', action='store_true')
    args = p.parse_args()
    cache = ROOT / 'fuentes'
    cache.mkdir(exist_ok=True)
    # Todas las cachés y temporales de procesos hijos quedan dentro del proyecto.
    tmp = ROOT / '.tmp'; tmp.mkdir(exist_ok=True)
    env = dict(os.environ, TMP=str(tmp), TEMP=str(tmp), UV_CACHE_DIR=str(tmp / 'uv'))
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg: raise RuntimeError('Se requiere ffmpeg para convertir TTS a PCM.')
    metadata = {'sample_rate': SR, 'canales': 1, 'bits': 16, 'voz_solicitada': 'es-MX-JorgeNeural',
                'silabas_metodo': 'grupos vocálicos españoles; aproximación, sin alineación', 'archivos': {}}
    configs = [('normal', '+0%', '+0Hz', 1, TEXT),
               ('rapida', '+40%', '+0Hz', 4, TEXT + TEXT[:TEXT.index('Aunque')]),
               ('lenta', '-30%', '+0Hz', -3, TEXT[:TEXT.index('Aunque')]+'No estamos solos. '),
               ('efusiva', '+40%', '+25Hz', 4, TEXT + TEXT[:TEXT.index('Aunque')])]
    edge_failure = None
    sources = {}
    for name, rate, pitch, sapi_rate, text in configs:
        target = ROOT / f'voz-{name}.wav'
        infofile = cache / f'{name}.json'
        if target.exists() and infofile.exists() and not args.regenerar:
            info = json.loads(infofile.read_text(encoding='utf8'))
            sources[name] = read(target); metadata['archivos'][target.name] = info
            continue
        mp3, raw = cache / f'{name}.mp3', cache / f'{name}-sapi.wav'
        engine = 'edge-tts'
        try:
            if args.solo_local: raise RuntimeError('--solo-local seleccionado')
            # Usa uvx si existe; si no, el paquete edge-tts instalado con pip (python -m edge_tts).
            cmd = ['uvx', 'edge-tts'] if shutil.which('uvx') else [sys.executable, '-m', 'edge_tts']
            subprocess.run(cmd + ['--voice', 'es-MX-JorgeNeural', '--text', text,
                            '--rate=' + rate, '--pitch=' + pitch, '--write-media', str(mp3)],
                           check=True, timeout=100, env=env, capture_output=True)
            source = mp3
        except (RuntimeError, subprocess.SubprocessError) as exc:
            edge_failure = str(exc)
            print('AVISO: Edge TTS falló:', edge_failure, file=sys.stderr)
            engine = 'SAPI Microsoft Helena Desktop (es-ES); alternativa sintética local'
            # SAPI no tiene un control equivalente de pitch: elevar después con resampling.
            textpath = cache / f'{name}.txt'; textpath.write_text(text, encoding='utf-8-sig')
            ps = ("$ErrorActionPreference='Stop'; $s=New-Object -ComObject SAPI.SpVoice; "
                  "$voices=$s.GetVoices(); for($i=0;$i -lt $voices.Count;$i++){if($voices.Item($i).GetDescription() -like '*Helena*'){$s.Voice=$voices.Item($i)}}; "
                  f"$s.Rate={sapi_rate}; $stream=New-Object -ComObject SAPI.SpFileStream; "
                  f"$stream.Open('{str(raw).replace(chr(39), chr(39)*2)}',3,$false); $s.AudioOutputStream=$stream; "
                  f"$s.Speak([IO.File]::ReadAllText('{str(textpath).replace(chr(39), chr(39)*2)}'),0); $stream.Close()")
            try:
                subprocess.run(['powershell', '-NoProfile', '-Command', ps], check=True, timeout=15, env=env, capture_output=True)
                source = raw
            except subprocess.SubprocessError as sapi_error:
                print('AVISO: SAPI tampoco funciona; se usa sintetizador propio por formantes.', file=sys.stderr)
                engine='formantes propios (grafemas españoles); voz robótica, inteligibilidad limitada'
                # Porcentajes exactos de duración en el sintetizador de emergencia.
                speed={'normal':1.,'rapida':1.4,'lenta':.7,'efusiva':1.4}[name]
                y=formant_speech(text,speed,165 if name=='efusiva' else 130)
                write(f'fuentes/{name}-formantes.wav',y)
                source=cache/f'{name}-formantes.wav'
        cmd = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source), '-ac', '1', '-ar', str(SR), '-c:a', 'pcm_s16le']
        if name == 'efusiva' and engine.startswith('SAPI'):
            cmd += ['-af', 'asetrate=26460,aresample=48000']
        subprocess.run(cmd + [str(target)], check=True, env=env)
        x = read(target)
        sources[name] = x
        info = {'texto': text, 'silabas_aproximadas': syllables(text), 'duracion_s': len(x)/SR,
                'silabas_por_s_aproximadas': syllables(text)/(len(x)/SR), 'rate_solicitado': rate,
                'pitch_solicitado': pitch, 'motor_real': engine, 'rms_dbfs': db(x),
                'advertencia': None if engine == 'edge-tts' else ('rate SAPI aproximado, no equivale al porcentaje Edge' if engine.startswith('SAPI') else 'No es Edge TTS; alternativa por formantes para no bloquear las mediciones')}
        infofile.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding='utf8')
        metadata['archivos'][target.name] = info

    # Duración exacta 120 s. Los silencios tienen nivel esperado 1 (reposo),
    # y quedan identificados en un archivo adicional para medir voz por separado.
    schedule = [(0, 23, 1), (25, 48, 2), (51, 74, 3), (82, 105, 4), (109, 120, 4)]
    levels = {1: -30, 2: -18, 3: -10, 4: -4}
    sermon = np.zeros(120 * SR)
    segments = []
    for start, end, level in schedule:
        x = sources['efusiva' if level == 4 else 'normal']
        x = np.tile(x, math.ceil((end-start)*SR/len(x)))[:(end-start)*SR].copy()
        # Compresión suave: conserva envolvente y permite RMS -4 sin recorte.
        # Se resuelve la ganancia de tanh para alcanzar exactamente el RMS objetivo.
        target = 10 ** (levels[level]/20)
        lo, hi = 0., 100000.
        for _ in range(55):
            gain = (lo + hi)/2
            if rms(np.tanh(x*gain)*.98) < target: lo = gain
            else: hi = gain
        x = np.tanh(x*(lo+hi)/2)*.98
        fade = int(.01*SR); x[:fade] *= np.linspace(0, 1, fade); x[-fade:] *= np.linspace(1, 0, fade)
        sermon[start*SR:end*SR] = x
        segments.append({'inicio_s': start, 'fin_s': end, 'nivel_esperado': level,
                         'rms_dbfs_medido': db(x)})
    timeline = []
    cursor = 0
    for seg in segments:
        if seg['inicio_s'] > cursor:
            timeline.append({'inicio_s': cursor, 'fin_s': seg['inicio_s'], 'nivel_esperado': 1})
        timeline.append({k:seg[k] for k in ['inicio_s','fin_s','nivel_esperado']}); cursor = seg['fin_s']
    write('sermon-simulado.wav', sermon)
    # Pad determinista con acordes I-V-vi-IV, sin muestras externas.
    t = np.arange(len(sermon))/SR
    music = np.zeros_like(t)
    chords = [[48,52,55], [43,47,50], [45,48,52], [41,45,48]]
    for start in range(0, 120, 4):
        sl = slice(start*SR, min((start+4)*SR, len(t)))
        tt = np.arange(sl.stop-sl.start)/SR
        envpad = np.minimum(1, tt/.3)*np.minimum(1, (4-tt)/.5)
        for midi in chords[(start//4)%4]:
            hz = 440*2**((midi-69)/12)
            music[sl] += envpad*(np.sin(2*np.pi*hz*tt)+.3*np.sin(2*np.pi*hz*1.003*tt))
    music = sosfilt(butter(2, 1600, fs=SR, output='sos'), music)
    music *= 10**(-20/20)/rms(music)
    # Atenuación común mínima, si la suma supera 0 dBFS; referencia coherente.
    mix_gain = min(1., .999/float(np.max(np.abs(sermon + music))))
    write('musica-sola.wav', music)
    write('sermon-con-musica.wav', (sermon+music)*mix_gain)
    # Calibración independiente: cinco segundos normal y cinco fuerte.
    calibration = np.concatenate([sermon[25*SR:30*SR], sermon[51*SR:56*SR]])
    write('calibracion.wav', calibration)
    tone_truth = []
    tones = np.zeros(5*SR)
    for i, hz in enumerate([110, 196, 261.625565, 440, 880]):
        tones[i*SR:(i+1)*SR] = .3*np.sin(2*np.pi*hz*np.arange(SR)/SR)
        tone_truth.append({'inicio_s':i, 'fin_s':i+1, 'hz':hz})
    write('tonos.wav', tones)
    metadata.update({'edge_tts_error': edge_failure, 'duracion_sermon_s':len(sermon)/SR,
                     'segmentos_voz':segments, 'musica_rms_dbfs':db(music), 'ganancia_mezcla':mix_gain,
                     'referencia_resta':'mezcla / ganancia_mezcla - musica-sola; alineación digital ideal',
                     'tonos':tone_truth})
    (ROOT/'ground-truth.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf8')
    (ROOT/'sermon-simulado.json').write_text(json.dumps(timeline, indent=2), encoding='utf8')
    print(json.dumps({'voces':{k:round(v['duracion_s'],2) for k,v in metadata['archivos'].items()},
                      'sermon_s':120, 'musica_dbfs':db(music), 'ganancia_mezcla':mix_gain, 'edge_error':edge_failure}, ensure_ascii=False))

if __name__ == '__main__': main()
