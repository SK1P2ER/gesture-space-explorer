// On phones the info card is a bottom sheet (style.css, ≤ 640 px): it keeps the
// focused body in view (the camera re-centers it above the sheet, see
// CameraRig.setBottomInset), and can be collapsed to its title and moon buttons.

export type SheetAction = 'expand' | 'collapse' | 'dismiss' | null;

/** How far a swipe must go to count, CSS px. */
export const SWIPE_PX = 40;

/** What a vertical swipe on the sheet's handle or header means (dy > 0: down). */
export function sheetSwipe(dy: number, collapsed: boolean): SheetAction {
  if (dy > SWIPE_PX) return collapsed ? 'dismiss' : 'collapse';
  if (dy < -SWIPE_PX) return 'expand';
  return null;
}

/**
 * Swipes and the handle on the card. The card's content is rebuilt whenever it
 * changes, so this listens on the card itself and keeps its state as a class.
 */
export class BottomSheet {
  private start: { y: number; id: number } | null = null;
  /** A swipe just ended: the click that follows it isn't a tap on the handle. */
  private swiped = false;

  /**
   * @param isSheet whether the card is shown as a sheet right now (a narrow screen)
   * @param dismiss close the card (as Esc does)
   */
  constructor(
    private readonly card: HTMLElement,
    private readonly isSheet: () => boolean,
    private readonly dismiss: () => void,
  ) {
    // The handle is a button: a tap, Enter or Space toggles.
    card.addEventListener('click', (e) => {
      if (this.swiped) return void (this.swiped = false);
      if ((e.target as Element).closest('.sheet-handle')) this.setCollapsed(!this.collapsed);
    });
    // Touch input stays with the element it started on, so these bubble up here for the whole swipe.
    card.addEventListener('pointerdown', (e) => {
      this.swiped = false;
      const target = e.target as Element;
      if (!this.isSheet() || !target.closest('.sheet-handle, .card-head') || target.closest('a, button:not(.sheet-handle)')) return;
      this.start = { y: e.clientY, id: e.pointerId };
      card.classList.add('dragging');
    });
    card.addEventListener('pointermove', (e) => {
      if (this.start?.id !== e.pointerId) return;
      card.style.transform = `translateY(${Math.max(0, e.clientY - this.start.y)}px)`; // follows the finger down
    });
    const end = (e: PointerEvent) => {
      if (this.start?.id !== e.pointerId) return;
      const dy = e.clientY - this.start.y;
      const action = e.type === 'pointerup' ? sheetSwipe(dy, this.collapsed) : null;
      this.swiped = Math.abs(dy) > 8;
      this.start = null;
      card.classList.remove('dragging');
      card.style.transform = '';
      if (action === 'dismiss') this.dismiss();
      else if (action) this.setCollapsed(action === 'collapse');
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
  }

  get collapsed() {
    return this.card.classList.contains('collapsed');
  }

  setCollapsed(collapsed: boolean) {
    this.card.classList.toggle('collapsed', collapsed);
    this.card.querySelector('.sheet-handle')?.setAttribute('aria-expanded', String(!collapsed));
  }
}
