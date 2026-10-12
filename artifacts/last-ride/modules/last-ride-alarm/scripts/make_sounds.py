"""
Builds the alarm tones in ../ios/sounds (lastride_pulse/chime/urgent.caf).

    python3 modules/last-ride-alarm/scripts/make_sounds.py

Needs numpy and macOS `afconvert`. Each tone is 44.1 kHz mono, about 4 seconds,
starts and ends in silence so it loops cleanly when iOS repeats it, and stays
well under the 30-second limit for notification sounds.
"""
import os
import subprocess
import tempfile
import wave

import numpy as np

RATE = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'ios', 'sounds')


def seconds(n):
    return int(n * RATE)


def envelope(length, attack, release):
    """Linear attack, exponential release (both in seconds)."""
    t = np.arange(length) / RATE
    env = np.minimum(1.0, t / max(attack, 1e-4))
    return env * np.exp(-t / max(release, 1e-4))


def tone(freq, length_s, partials, attack=0.006, release=0.25):
    """A note built from (ratio, level, decay-scale) partials."""
    n = seconds(length_s)
    t = np.arange(n) / RATE
    out = np.zeros(n)
    for ratio, level, decay in partials:
        out += level * np.sin(2 * np.pi * freq * ratio * t) * envelope(n, attack, release * decay)
    return out


def place(buffer, sound, at_s):
    start = seconds(at_s)
    end = min(len(buffer), start + len(sound))
    buffer[start:end] += sound[: end - start]


def room(signal, mix=0.18):
    """A little space: a few decaying early reflections."""
    out = signal.copy()
    for delay_ms, gain in [(23, 0.5), (41, 0.35), (67, 0.25), (97, 0.16), (139, 0.1)]:
        d = int(RATE * delay_ms / 1000)
        out[d:] += mix * gain * signal[:-d]
    return out


def finish(signal, peak=0.89, fade_s=0.02):
    fade = seconds(fade_s)
    signal[:fade] *= np.linspace(0, 1, fade)
    signal[-fade:] *= np.linspace(1, 0, fade)
    return signal / np.max(np.abs(signal)) * peak


def pulse():
    """Soft double beep (A5 then D6), three times, like a modern phone alarm."""
    buffer = np.zeros(seconds(4.0))
    beep = [(1, 1.0, 1.0), (2, 0.18, 0.6), (3, 0.06, 0.4)]
    for i in range(3):
        at = 0.05 + i * 1.3
        place(buffer, tone(880.0, 0.32, beep, attack=0.008, release=0.09), at)
        place(buffer, tone(1174.66, 0.38, beep, attack=0.008, release=0.11), at + 0.17)
    return finish(room(buffer, 0.12))


def chime():
    """Bell arpeggio (E5 G#5 B5 E6), played twice, with a ringing tail."""
    buffer = np.zeros(seconds(4.2))
    bell = [(1, 1.0, 1.0), (2.0, 0.42, 0.55), (3.01, 0.22, 0.35), (4.17, 0.12, 0.25), (5.43, 0.07, 0.18)]
    notes = [659.25, 830.61, 987.77, 1318.51]
    for repeat in range(2):
        for i, freq in enumerate(notes):
            place(buffer, tone(freq, 1.6, bell, attack=0.003, release=0.55), 0.04 + repeat * 2.0 + i * 0.16)
    return finish(room(buffer, 0.25))


def urgent():
    """Fast two-tone alarm (960/1280 Hz), band-limited square wave, building up over the first second."""
    length = seconds(4.0)
    t = np.arange(length) / RATE
    step = 0.125
    high = (np.floor(t / step) % 2).astype(bool)
    freq = np.where(high, 1280.0, 960.0)
    phase = 2 * np.pi * np.cumsum(freq) / RATE
    wave_ = sum(np.sin(k * phase) / k for k in (1, 3, 5, 7) if 1280 * k < 9000)
    # Short gap between bursts of eight tones so it reads as a rhythm, not a drone.
    burst = (t % 1.0) < 0.875
    gate = np.convolve(burst.astype(float), np.ones(seconds(0.004)) / seconds(0.004), mode='same')
    swell = np.minimum(1.0, 0.45 + 0.55 * t / 1.0)
    signal = np.tanh(0.9 * wave_ * gate * swell)
    # Loudest of the three, but kept below a harsh full-scale square wave.
    return finish(signal, peak=0.6, fade_s=0.01)


def write_caf(name, signal):
    pcm = (np.clip(signal, -1, 1) * 32767).astype('<i2')
    with tempfile.TemporaryDirectory() as tmp:
        wav_path = os.path.join(tmp, f'{name}.wav')
        with wave.open(wav_path, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(pcm.tobytes())
        out = os.path.join(OUT, f'{name}.caf')
        subprocess.run(['afconvert', '-f', 'caff', '-d', f'LEI16@{RATE}', wav_path, out], check=True)
        print(out)


if __name__ == '__main__':
    write_caf('lastride_pulse', pulse())
    write_caf('lastride_chime', chime())
    write_caf('lastride_urgent', urgent())
