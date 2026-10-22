// Trois signaux par résultat (composant ScanResult) : couleur, icône + mot, son et vibration.
// Un bip court (valide), deux bips (orange), un bip long (rouge).

export type Signal = 'success' | 'warning' | 'danger';

const patterns: Record<
  Signal,
  { beeps: Array<[frequency: number, ms: number]>; vibration: number[] }
> = {
  success: { beeps: [[880, 120]], vibration: [100] },
  warning: {
    beeps: [
      [660, 120],
      [660, 120],
    ],
    vibration: [100, 80, 100],
  },
  danger: { beeps: [[330, 600]], vibration: [500] },
};

let audio: AudioContext | null = null;

// Les navigateurs n'autorisent le son qu'après un geste : appelé au toucher « Commencer ».
export function unlockAudio() {
  audio ??= new AudioContext();
  void audio.resume();
}

// iOS suspend le son après un appel, un verrouillage ou un changement d'application.
export function resumeAudio() {
  if (audio && audio.state !== 'running') void audio.resume().catch(() => undefined);
}

export function playSignal(signal: Signal) {
  const { beeps, vibration } = patterns[signal];
  navigator.vibrate?.(vibration);
  if (!audio) return;
  let start = audio.currentTime;
  for (const [frequency, ms] of beeps) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.3;
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + ms / 1000);
    start += (ms + 100) / 1000;
  }
}
