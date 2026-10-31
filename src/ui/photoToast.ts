import type { Lang } from '../data/bodies';
import { t } from './i18n';

/** The message after a photo. On phones it carries Share and Save buttons (the share sheet needs a tap). */
export class PhotoToast {
  private readonly el = document.querySelector<HTMLElement>('#photo-toast')!;
  private readonly msg = this.el.querySelector<HTMLElement>('.msg')!;
  readonly shareButton = this.el.querySelector<HTMLButtonElement>('.share')!;
  readonly saveButton = this.el.querySelector<HTMLButtonElement>('.save')!;
  private timer = 0;

  /** 'saved': it was downloaded. 'ready': offer Share / Save. */
  show(kind: 'saved' | 'ready', lang: Lang) {
    const offer = kind === 'ready';
    this.msg.textContent = t(offer ? 'photoReady' : 'photoSaved', lang);
    this.shareButton.textContent = t('share', lang);
    this.saveButton.textContent = t('save', lang);
    this.shareButton.hidden = this.saveButton.hidden = !offer;
    this.el.hidden = false;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), offer ? 8000 : 2500);
  }

  hide() {
    this.el.hidden = true;
  }
}
