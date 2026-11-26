type Pointer = Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY' | 'isPrimary' | 'button'>;

/** Picking owns an uninterrupted primary-button tap; orbit, pan and pinch own their gestures. */
export class SpaceportTap {
  private primary: number | null = null;
  private eligible = false;
  private x = 0;
  private y = 0;

  down(event: Pointer) {
    if (!event.isPrimary) { this.eligible = false; return; }
    this.primary = event.pointerId;
    this.eligible = event.button === 0;
    this.x = event.clientX; this.y = event.clientY;
  }
  move(event: Pointer) {
    if (event.pointerId === this.primary && this.distanceSquared(event) > 25) this.eligible = false;
  }
  up(event: Pointer): boolean {
    if (event.pointerId !== this.primary) return false;
    const tap = this.eligible && event.isPrimary && event.button === 0 && this.distanceSquared(event) <= 25;
    this.cancel();
    return tap;
  }
  cancel() { this.primary = null; this.eligible = false; }
  private distanceSquared(event: Pointer) { return (event.clientX-this.x)**2 + (event.clientY-this.y)**2; }
}
