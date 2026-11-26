// The destination screen flow (free mode, ?flags=picker3d): which screen is up, the preview, and the confirmed record.
// Pure state. main.ts describes the mission each frame as plain values, sends the mission's own intents, and reads the
// outcome back; this module never changes the mission itself.
//
//   1 base overview (closed) → 2 destination selection (select) → 3 journey confirmation (confirm) → launch
//
// Rules (the owner's contract, 2026-11-14):
// - On screen 2 a choice (👆, a tap, the list, ← →) is a preview only: the mission and its checkpoint do not change.
// - Confirm is the only thing that sets the destination; screen 3 opens only once the mission has accepted it.
// - "Confirmed" is a record of this session (never saved): the destination and the base it was confirmed at. It counts
//   only while both still match the mission and no flight is under way; once broken it is gone for good. So another
//   destination by any route, another base, Start fresh, a flight, a pending saved-mission offer or a reload all end it.
// - Every screen change bumps `generation`: the input logic restarts its focus and owes a release for a held 👍.

export type FlowScreen = 'closed' | 'select' | 'confirm';
/** The mission as the flow needs it, read fresh each time. */
export interface FlowMission {
  baseId: string | null;
  destinationId: string | null;
  /** The app's mode (baseView, launch, travel, docking, ...). */
  mode: string;
  /** A pending saved-mission offer (it blocks the flow and its actions). */
  blocked: boolean;
}
interface ConfirmedRecord { destinationId: string; baseId: string }

const canOpen = (m: FlowMission) => !m.blocked && m.mode === 'baseView' && m.baseId !== null;

export class DestinationFlow {
  screen: FlowScreen = 'closed';
  /** The highlighted destination on screen 2 (UI only). */
  preview: string | null = null;
  /** Opened from the Tanegashima ground view: Back from screen 2 returns there. */
  fromGround = false;
  /** Bumped on every screen change. */
  generation = 0;
  private record: ConfirmedRecord | null = null;

  /** The confirmed destination as recorded (main.ts keeps it current with sync()). */
  get confirmed() { return this.record?.destinationId ?? null; }

  private valid(m: FlowMission) {
    const r = this.record;
    return !!r && !m.blocked && m.baseId === r.baseId && m.destinationId === r.destinationId && (m.mode === 'baseView' || m.mode === 'launch');
  }
  private go(screen: FlowScreen) { this.screen = screen; this.generation++; }

  /** Screen 1 → 2 (from the base view, or from the ground view). */
  open(m: FlowMission, fromGround = false): boolean {
    if (!canOpen(m)) return false;
    this.preview = m.destinationId;
    this.fromGround = fromGround;
    this.go('select');
    return true;
  }

  /** A preview on screen 2 (👆, a tap, the list). */
  choose(baseId: string) { if (this.screen === 'select') this.preview = baseId; }
  /** ← → on screen 2: the next or previous destination as the preview. */
  step(ids: readonly string[], dir: 1 | -1) {
    if (this.screen !== 'select' || !ids.length) return;
    const i = this.preview ? ids.indexOf(this.preview) : dir === 1 ? -1 : 0;
    this.preview = ids[(i + dir + ids.length) % ids.length];
  }

  /** Screen 2's Confirm: the destination to send to the mission (null: nothing to confirm). */
  confirmRequest(): string | null { return this.screen === 'select' ? this.preview : null; }
  /** After sending it: screen 3 only if the mission now has exactly that destination. */
  afterConfirm(m: FlowMission): 'accepted' | 'refused' {
    if (this.screen !== 'select' || !this.preview || m.baseId === null || m.destinationId !== this.preview || !canOpen(m)) return 'refused';
    this.record = { destinationId: this.preview, baseId: m.baseId };
    this.go('confirm');
    return 'accepted';
  }

  /** Back: 3 → 2 (the confirmation stays, as the preview); 2 → 1 (the preview is discarded), or back to the ground view. */
  back(): 'select' | 'closed' | 'ground' {
    if (this.screen === 'confirm') {
      this.preview = this.record?.destinationId ?? this.preview;
      this.go('select');
      return 'select';
    }
    if (this.screen === 'closed') return 'closed';
    this.preview = null;
    const ground = this.fromGround;
    this.fromGround = false;
    this.go('closed');
    return ground ? 'ground' : 'closed';
  }

  /** Screen 1's shortcut ("View journey — X"): screen 3 for a valid confirmation. It never launches. */
  showJourney(m: FlowMission, fromGround = false): boolean {
    if (!canOpen(m) || !this.valid(m)) return false;
    this.preview = this.record!.destinationId;
    this.fromGround = fromGround;
    this.go('confirm');
    return true;
  }

  /** The confirmed destination if it is still valid for this mission (screen 1's shortcut). */
  confirmedFor(m: FlowMission) { return this.valid(m) ? this.record!.destinationId : null; }
  /** A destination the mission has that was not confirmed here (restored from a checkpoint, or set another way). */
  savedFor(m: FlowMission) { return m.destinationId !== null && !this.valid(m) ? m.destinationId : null; }

  /** Each frame: a broken confirmation is dropped for good; the flow leaves screens it can no longer show. */
  sync(m: FlowMission) {
    if (this.record && !this.valid(m)) this.record = null;
    if (this.screen === 'closed') return;
    if (!canOpen(m)) {
      this.preview = null;
      this.fromGround = false;
      this.go('closed');
    } else if (this.screen === 'confirm' && !this.record) {
      this.preview = m.destinationId;
      this.go('select');
    }
  }
}
