// Photo mode: copy the rendered scene into a PNG, optionally with a small
// watermark, then download it or (on phones) offer the system share sheet.
//
// No preserveDrawingBuffer: main.ts calls snapshot() right after a frame is
// drawn, in the same task, while the drawing buffer still holds that frame.
// The HUD is DOM, never part of the canvas, so the photo is the scene only.

export const APP_NAME = 'Gesture Space Explorer';

export const watermarkText = (planetName: string) => `${APP_NAME} · ${planetName}`;

/** e.g. gesture-space-explorer_saturn_2026-10-23_14-05-09.png (local time). */
export function photoFileName(bodyId: string, at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
  const time = `${p(at.getHours())}-${p(at.getMinutes())}-${p(at.getSeconds())}`;
  return `gesture-space-explorer_${bodyId}_${date}_${time}.png`;
}

/**
 * How to hand the photo over. The share sheet needs a fresh tap (browsers
 * require user activation, which a hand gesture or a slow PNG encode doesn't
 * give us), so on phones we show a Share button; elsewhere we just download.
 */
export function deliveryFor(env: { mobile: boolean; canShareFiles: boolean }): 'share-button' | 'download' {
  return env.mobile && env.canShareFiles ? 'share-button' : 'download';
}

/** Copies the canvas as it is right now and stamps the watermark into the copy. */
export function snapshot(source: HTMLCanvasElement, watermark: string | null): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  const ctx = copy.getContext('2d')!;
  ctx.drawImage(source, 0, 0);
  if (watermark) {
    const size = Math.round(Math.max(12, copy.height * 0.022));
    ctx.font = `600 ${size}px system-ui, 'Hiragino Sans', 'Yu Gothic UI', 'Myanmar Text', sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = size * 0.4;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText(watermark, copy.width - size, copy.height - size * 0.8);
  }
  return copy;
}

export const toPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );

export function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const canShareFile = (file: File) =>
  typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

// ------------------------------------------------------------- sound ----
// A synthesized shutter (no audio file: stays offline-friendly). Browsers only
// allow audio after the user has clicked, tapped or pressed a key on the page,
// so the context is created on the first such event; a photo taken purely by
// hand gesture before that is silent.

let audio: AudioContext | null = null;

export function unlockAudioOnFirstInput() {
  const unlock = () => {
    audio ??= new AudioContext();
    void audio.resume();
    removeEventListener('pointerdown', unlock);
    removeEventListener('keydown', unlock);
  };
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);
}

export function playShutter() {
  if (!audio || audio.state !== 'running') return;
  const click = (at: number, gain: number) => {
    const length = Math.floor(audio!.sampleRate * 0.04);
    const buffer = audio!.createBuffer(1, length, audio!.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    const source = audio!.createBufferSource();
    source.buffer = buffer;
    const filter = Object.assign(audio!.createBiquadFilter(), { type: 'bandpass' });
    filter.frequency.value = 2500;
    const volume = audio!.createGain();
    volume.gain.value = gain;
    source.connect(filter).connect(volume).connect(audio!.destination);
    source.start(audio!.currentTime + at);
  };
  click(0, 0.6); // open
  click(0.07, 0.4); // close
}
