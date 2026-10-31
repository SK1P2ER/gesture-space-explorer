import { baseById } from '../data/bases';
import { BODIES, type Lang } from '../data/bodies';
import { AVATARS, departureById, type Booking } from '../travel/booking';
import { arrivalAt, wrapLines } from '../travel/memories';
import { LOCALE } from '../ui/i18n';
import { st, stf } from './strings';
import { route } from './screens/format';

// A postcard of a completed journey (decision 21): the scene as it is behind the shell, cropped to
// the part the panel leaves free, beside a paper side with the greeting and the journey's stamp.
// All text is drawn with fillText: nothing is parsed as HTML. 1600 × 1000, a PNG.

const W = 1600, H = 1000, PHOTO = 1000;
const FONT = "system-ui, 'Myanmar Text', 'Noto Sans Myanmar', Padauk, 'Hiragino Sans', 'Yu Gothic UI', Meiryo, 'Noto Sans JP', sans-serif";
const INK = '#1d2433', MUTED = '#5d6577', PAPER = '#f5f0e6', ACCENT = '#07657f', STAMP = '#c2502a';

/** How much of the free area the photo keeps, around its centre (where the camera frames the world). */
const ZOOM = 0.65;

/** The part of the scene the shell's panel doesn't cover (client pixels), where the world is framed, zoomed in. */
function freeArea(panel: DOMRect) {
  const right = { x: panel.right, y: 0, w: innerWidth - panel.right, h: innerHeight };
  const above = { x: 0, y: 0, w: innerWidth, h: panel.top };
  const a = right.w * right.h >= above.w * above.h ? right : above;
  return { x: a.x + (a.w * (1 - ZOOM)) / 2, y: a.y + (a.h * (1 - ZOOM)) / 2, w: a.w * ZOOM, h: a.h * ZOOM };
}

/** `scene` (a copy of the rendered canvas) cropped to cover a box, centered. */
function drawCover(ctx: CanvasRenderingContext2D, scene: HTMLCanvasElement, area: { x: number; y: number; w: number; h: number }, box: { w: number; h: number }) {
  const k = scene.width / innerWidth; // canvas pixels per CSS pixel
  let [sx, sy, sw, sh] = [area.x * k, area.y * k, Math.max(1, area.w * k), Math.max(1, area.h * k)];
  const want = box.w / box.h;
  if (sw / sh > want) { const w = sh * want; sx += (sw - w) / 2; sw = w; } else { const hh = sw / want; sy += (sh - hh) / 2; sh = hh; }
  ctx.drawImage(scene, sx, sy, sw, sh, 0, 0, box.w, box.h);
}

function stamp(ctx: CanvasRenderingContext2D, cx: number, cy: number, b: Booking, lang: Lang) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.12);
  ctx.strokeStyle = STAMP;
  ctx.fillStyle = STAMP;
  ctx.globalAlpha = 0.85;
  for (const [r, w] of [[118, 6], [104, 2]] as const) {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 24px ${FONT}`;
  const lines = wrapLines(baseById(b.to).name[lang], 170, (s) => ctx.measureText(s).width, 2);
  lines.forEach((line, i) => ctx.fillText(line, 0, -22 + (i - (lines.length - 1) / 2) * 28));
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText(new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'medium', timeZone: 'UTC' }).format(arrivalAt(b)), 0, 34);
  ctx.font = `600 16px ${FONT}`;
  ctx.fillText(`✦ ${b.ref} ✦`, 0, 66);
  ctx.restore();
}

/** Draws the postcard for a completed booking over `scene`, a copy of the rendered canvas. */
export function drawPostcard(scene: HTMLCanvasElement, b: Booking, lang: Lang): HTMLCanvasElement {
  const card = document.createElement('canvas');
  [card.width, card.height] = [W, H];
  const ctx = card.getContext('2d')!;
  const panel = document.querySelector('#shell-panel')?.getBoundingClientRect();
  drawCover(ctx, scene, panel ? freeArea(panel) : { x: 0, y: 0, w: innerWidth, h: innerHeight }, { w: PHOTO, h: H });
  ctx.fillStyle = PAPER;
  ctx.fillRect(PHOTO, 0, W - PHOTO, H);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.fillRect(PHOTO, 0, 3, H);

  const x = PHOTO + 56, max = W - PHOTO - 112;
  const measure = (s: string) => ctx.measureText(s).width;
  let y = 120;
  const text = (s: string, font: string, color: string, gap: number, limit = 3) => {
    ctx.font = `${font} ${FONT}`;
    ctx.fillStyle = color;
    for (const line of wrapLines(s, max, measure, limit)) { ctx.fillText(line, x, y); y += gap; }
  };
  ctx.textBaseline = 'alphabetic';
  text(stf('postcard.from', lang, { place: baseById(b.to).name[lang] }), '700 46px', INK, 58);
  y += 18;
  text(BODIES.find((body) => body.id === baseById(b.to).body)!.name[lang], '600 24px', ACCENT, 48, 1);
  y += 6;
  text(stf('postcard.flew', lang, { nick: `${AVATARS[b.traveller.avatar]} ${b.traveller.name}`, route: route(b, lang) }), '400 26px', INK, 38);
  text(stf('postcard.departed', lang, {
    date: new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'medium', timeZone: 'UTC' }).format(departureById(b.departure)!.at), flight: b.departure,
  }), '400 22px', MUTED, 34, 2);
  stamp(ctx, W - 190, H - 230, b, lang);
  ctx.font = `500 18px ${FONT}`;
  ctx.fillStyle = MUTED;
  ctx.fillText(st('postcard.footer', lang), x, H - 56);
  return card;
}

/** The postcard as a PNG file (`png`: the explorer's own encoder, ui/photo.ts, passed in by the host). */
export async function postcardFile(card: HTMLCanvasElement, b: Booking, png: (canvas: HTMLCanvasElement) => Promise<Blob>) {
  return new File([await png(card)], `astrolife-postcard-${b.ref}.png`, { type: 'image/png' });
}
