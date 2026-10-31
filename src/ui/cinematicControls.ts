import type { Lang } from '../data/bodies';
import { CINEMATIC_VIEWS, type CinematicRequest } from '../scene/marsCinematicDirector';
import { t } from './i18n';

/** Native, explicitly requested controls. Reparented into the existing sheet or a horizon card. */
export class CinematicControls {
  readonly root = document.createElement('details');
  private readonly summary = document.createElement('summary');
  private readonly select = document.createElement('select');
  private readonly fly = document.createElement('button');
  private readonly skip = document.createElement('button');
  private readonly manual = document.createElement('button');
  private readonly exit = document.createElement('button');
  private readonly status = document.createElement('p');
  private readonly events = new AbortController();
  private disposed = false;

  constructor(request: (view: CinematicRequest) => void, cancel: () => void) {
    this.root.id = 'cinematic-panel'; this.root.hidden = true;
    this.root.className = 'hud cinematic';
    const choices = ['manual', ...CINEMATIC_VIEWS];
    for (const view of choices) {
      const option = document.createElement('option'); option.value = view; this.select.append(option);
    }
    const actions = document.createElement('div'); actions.className = 'cinematic-actions';
    for (const [button, name] of [[this.fly, 'flyover'], [this.skip, 'skip'], [this.manual, 'manual'], [this.exit, 'exit']] as const) {
      button.type = 'button'; button.dataset.action = name; actions.append(button);
    }
    this.status.setAttribute('aria-live', 'polite');
    this.root.append(this.summary, this.select, actions, this.status);
    document.body.append(this.root); // exists before Chrome's centralized blocker lookup
    const options = { signal: this.events.signal };
    this.root.addEventListener('toggle', () => { if (!this.root.open) cancel(); }, options);
    this.select.addEventListener('change', () => {
      if (this.select.value === 'manual') cancel();
      else request(this.select.value as CinematicRequest);
    }, options);
    this.fly.addEventListener('click', () => request('flyover'), options);
    this.skip.addEventListener('click', cancel, options);
    this.manual.addEventListener('click', cancel, options);
    this.exit.addEventListener('click', () => { cancel(); this.root.open = false; }, options);
  }

  render(enabled: boolean, horizon: boolean, lang: Lang, active: CinematicRequest | null, animating: boolean, reduced: boolean) {
    if (this.disposed) return;
    this.root.hidden = !enabled;
    if (!enabled) {
      if (this.root.parentElement !== document.body) document.body.append(this.root);
      return;
    }
    if (horizon && this.root.parentElement !== document.body) document.body.append(this.root);
    this.root.classList.toggle('cinematic-floating', horizon);
    this.summary.textContent = t('cinematic.title', lang);
    this.select.setAttribute('aria-label', t('cinematic.view', lang));
    for (const option of this.select.options) option.textContent = t(`cinematic.${option.value as 'manual' | typeof CINEMATIC_VIEWS[number]}`, lang);
    this.select.value = active === 'flyover' ? 'overview' : active ?? 'manual';
    for (const button of [this.fly, this.skip, this.manual, this.exit]) button.textContent = t(`cinematic.${button.dataset.action as 'flyover' | 'skip' | 'manual' | 'exit'}`, lang);
    this.fly.disabled = reduced; this.skip.disabled = !animating;
    this.manual.disabled = !active;
    const status = t(active ? 'cinematic.active' : 'cinematic.manual', lang);
    if (this.status.textContent !== status) this.status.textContent = status;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.events.abort(); this.root.hidden = true; this.root.remove();
  }
}
