import { currentDevice, isMobile } from '../quality';
import type { Lang } from '../data/bodies';
import {
  APP_NAME,
  canShareFile,
  deliveryFor,
  download,
  photoFileName,
  playShutter,
  snapshot,
  toPng,
  unlockAudioOnFirstInput,
  watermarkText,
} from '../ui/photo';
import { PhotoToast } from '../ui/photoToast';

/**
 * Photo mode: take() hides the HUD; the next rendered frame is captured right
 * after it's drawn (afterRender, same task, so no preserveDrawingBuffer), then
 * downloaded or offered for sharing.
 */
export class PhotoFlow {
  readonly toast = new PhotoToast();
  private requested = false;
  private busy = false;
  private last: File | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    /** What's in the picture, for the file name and watermark. */
    private readonly subject: () => { id: string; name: string },
    private readonly watermark: () => boolean,
    private readonly lang: () => Lang,
  ) {
    unlockAudioOnFirstInput();
  }

  take() {
    if (this.busy) return;
    this.busy = true;
    this.requested = true;
    this.toast.hide();
    document.body.classList.add('photo-mode');
  }

  /** The next rendered frame is the photo. */
  get pending() {
    return this.requested;
  }

  /** Call right after rendering a frame. */
  afterRender() {
    if (!this.requested) return;
    // Same task as the render: the drawing buffer still holds this frame.
    this.requested = false;
    const subject = this.subject();
    void this.finish(snapshot(this.canvas, this.watermark() ? watermarkText(subject.name) : null), subject.id);
  }

  /** Still inside the tap that asked for it, so the share sheet is allowed to open. */
  share() {
    // The address follows the view (deep links), so the link opens what the photo shows.
    if (this.last) void navigator.share({ files: [this.last], title: APP_NAME, url: location.href }).catch(() => {});
    this.toast.hide();
  }

  save() {
    if (this.last) download(this.last, this.last.name);
    this.toast.hide();
  }

  private async finish(copy: HTMLCanvasElement, subjectId: string) {
    const flash = document.querySelector<HTMLElement>('#photo-flash')!;
    flash.classList.remove('flash');
    void flash.offsetWidth; // restart the animation
    flash.classList.add('flash');
    playShutter();
    try {
      const name = photoFileName(subjectId, new Date());
      const file = new File([await toPng(copy)], name, { type: 'image/png' });
      this.last = file;
      if (deliveryFor({ mobile: isMobile(currentDevice()), canShareFiles: canShareFile(file) }) === 'share-button') {
        this.toast.show('ready', this.lang());
      } else {
        download(file, name);
        this.toast.show('saved', this.lang());
      }
    } catch (e) {
      console.error('[photo]', e);
    } finally {
      setTimeout(() => {
        document.body.classList.remove('photo-mode');
        this.busy = false;
      }, 600);
    }
  }
}
