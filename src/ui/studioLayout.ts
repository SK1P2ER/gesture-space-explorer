// SPIKE (?flags=picker3d,studio): the approved studio layout (prototype of 2026-11-16) as a pure function.
// A title row, a planet stage and a console cell inside the free area of the page. The slots depend on the area, the
// viewport's shape and the destinations only: never on selection, hold or camera state.
import { PICKER, type PickerTarget, type Rect } from '../app/destinationPicker';

export interface StudioLayout {
  header: Rect; stage: Rect; cell: Rect; targets: PickerTarget[];
  arrangement: 'arc' | 'row' | 'grid'; portrait: boolean;
}

const clamp = (lo: number, v: number, hi: number) => Math.max(lo, Math.min(hi, v));
const HIT = 44, TITLE = 28;

export function studioLayout(ids: readonly string[], area: Rect, view: { width: number; height: number }): StudioLayout {
  const portrait = view.height > view.width, short = !portrait && view.height <= 500;
  const pad = short ? 8 : 12, gap = short ? 8 : 12, n = ids.length, LABEL = PICKER.labelPx;
  const left = area.left + pad, right = area.right - pad, top = area.top + pad, bottom = area.bottom - pad;
  const header = { left, top, right, bottom: top + TITLE };
  const bodyTop = header.bottom + gap;
  let stage: Rect, cell: Rect;
  if (portrait) {
    const two = (right - left) / n < 2 * HIT;
    // 22 % of the height (the prototype used 27 %): in the app the status header and the footer stay on screen.
    const stageH = two ? 264 : Math.round(clamp(150, view.height * 0.22, 240));
    stage = { left, top: bodyTop, right, bottom: bodyTop + stageH };
    cell = { left, top: stage.bottom + gap, right, bottom };
  } else {
    const cw = short ? Math.max(300, (right - left) * 0.46) : clamp(320, view.width * 0.31, 420);
    cell = { left: right - cw, top: bodyTop, right, bottom };
    stage = { left, top: bodyTop, right: cell.left - gap, bottom };
  }
  const W = stage.right - stage.left, H = stage.bottom - stage.top;
  // one row where every hit box (at least 88 px wide) fits side by side, otherwise two
  const rows = W / n >= 2 * HIT ? 1 : 2;
  const arc = rows === 1 && !short; // the arc needs one row and some height; otherwise the simple row or the grid
  const cols = Math.ceil(n / rows), slotW = W / cols, rowH = H / rows;
  const amp = arc ? Math.min(rowH * 0.16, 46) : 0;
  const r = Math.max(22, Math.min(74, slotW / 3, (rowH - LABEL - amp - 12) / 2 / 1.15));
  const targets = ids.map((baseId, i) => {
    const row = Math.floor(i / cols), col = i % cols, inRow = row === rows - 1 ? n - cols * (rows - 1) : cols;
    const x = stage.left + (rows === 1 ? (col + 0.5) * slotW : (col + 0.5 + (cols - inRow) / 2) * slotW);
    const k = cols > 1 ? (col - (cols - 1) / 2) / ((cols - 1) / 2) : 0;
    const y = stage.top + (row + 0.5) * rowH - LABEL / 2 + (arc ? amp * (0.5 - k * k) : 0); // the ends a little higher
    return { baseId, x, y, r };
  });
  return { header, stage, cell, targets, arrangement: arc ? 'arc' : rows === 2 ? 'grid' : 'row', portrait };
}
