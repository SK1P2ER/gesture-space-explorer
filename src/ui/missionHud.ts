import type { Lang } from '../data/bodies';
import { mapPoint } from '../sim/route';
import { numberFormat, t } from './i18n';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export interface MissionReadout {
  /** The base you're at, or flying to. */
  base: string;
  /** 0 … 1. */
  fuel: number;
  /** Distance still to go, km (null at a base). */
  km: number | null;
  /** Seconds until arrival (null at a base). */
  eta: number | null;
}

export interface MapView {
  /** Bodies on the map: scene x, z; the ones with bases are marked. */
  bodies: { x: number; z: number; color: string; base: boolean; here: boolean }[];
  /** The rocket while it's flying. */
  rocket: { x: number; z: number } | null;
  /** The trip's two ends. */
  route: [{ x: number; z: number }, { x: number; z: number }] | null;
  /** Scene distance of the outermost planet, for the log scale. */
  maxRadius: number;
}

/** "1.52 AU" from far away, "384,400 km" near. */
export function distanceLabel(km: number, lang: Lang): string {
  const au = km / 149_597_870.7;
  if (au >= 0.1) return `${numberFormat(lang, { maximumFractionDigits: 2 }).format(au)} AU`;
  return `${numberFormat(lang, { maximumFractionDigits: 0 }).format(km)} km`;
}

/** Bases, rockets and landings: fuel, distance, ETA, where you are, and a map of the system. */
export class MissionHud {
  private readonly root = $('#mission-hud');
  private readonly canvas = $<HTMLCanvasElement>('#mission-hud canvas');
  private last = '';

  render(r: MissionReadout | null, map: MapView | null, lang: Lang) {
    this.root.hidden = r === null;
    if (!r) return;
    // The readout changes a few times a second at most; the map is redrawn every frame (cheap: ~15 dots).
    const fmt = numberFormat(lang, { maximumFractionDigits: 0 });
    const key = JSON.stringify([r.base, Math.round(r.fuel * 100), r.km === null ? null : distanceLabel(r.km, lang), r.eta === null ? null : Math.ceil(r.eta), lang]);
    if (key !== this.last) {
      this.last = key;
      const rows: [string, string][] = [
        [t('currentBase', lang), r.base],
        [t('fuel', lang), `${fmt.format(Math.round(r.fuel * 100))}%`],
      ];
      if (r.km !== null) rows.push([t('distance', lang), distanceLabel(r.km, lang)]);
      if (r.eta !== null) rows.push([t('eta', lang), `${fmt.format(Math.ceil(r.eta))} s`]);
      const dl = this.root.querySelector('dl')!;
      dl.replaceChildren(...rows.flatMap(([k, v]) => {
        const [dt, dd] = [document.createElement('dt'), document.createElement('dd')];
        dt.textContent = k;
        dd.textContent = v;
        return [dt, dd];
      }));
      const bar = this.root.querySelector<HTMLElement>('.fuel .fill')!;
      bar.style.width = `${Math.round(r.fuel * 100)}%`;
      bar.classList.toggle('low', r.fuel < 0.25);
      this.canvas.setAttribute('aria-label', t('miniMap', lang));
    }
    if (map) this.draw(map);
  }

  private draw(m: MapView) {
    const c = this.canvas;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const size = c.clientWidth || 140;
    if (c.width !== Math.round(size * dpr)) c.width = c.height = Math.round(size * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    const half = c.width / 2;
    const R = half * 0.9;
    const at = (p: { x: number; z: number }) => {
      const [x, z] = mapPoint(p.x, p.z, m.maxRadius);
      return [half + x * R, half + z * R] as const;
    };
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#ffcc33';
    g.beginPath();
    g.arc(half, half, 3 * dpr, 0, Math.PI * 2);
    g.fill();
    if (m.route) {
      const [a, b] = m.route.map(at);
      g.strokeStyle = '#ffffff55';
      g.setLineDash([3 * dpr, 3 * dpr]);
      g.lineWidth = dpr;
      g.beginPath();
      g.moveTo(...a);
      g.lineTo(...b);
      g.stroke();
      g.setLineDash([]);
    }
    for (const b of m.bodies) {
      const [x, y] = at(b);
      g.fillStyle = b.color;
      g.beginPath();
      g.arc(x, y, (b.base ? 2.6 : 1.8) * dpr, 0, Math.PI * 2);
      g.fill();
      if (b.here) {
        g.strokeStyle = '#ffd34d';
        g.lineWidth = 1.5 * dpr;
        g.beginPath();
        g.arc(x, y, 5 * dpr, 0, Math.PI * 2);
        g.stroke();
      }
    }
    if (m.rocket) {
      const [x, y] = at(m.rocket);
      g.fillStyle = '#ff5a3c';
      g.beginPath();
      g.moveTo(x, y - 4 * dpr);
      g.lineTo(x + 3 * dpr, y + 3 * dpr);
      g.lineTo(x - 3 * dpr, y + 3 * dpr);
      g.closePath();
      g.fill();
    }
  }
}
