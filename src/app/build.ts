import type { BaseLayout } from '../data/baseLayout';
import type { Intent } from '../intents';
import { best, BUILD_KINDS, BUILD_RADIUS, cellAt, cellBlocked, evaluate, History, MAX_MODULES, parsePlaced, type BaseStatus, type BuildKind, type Placed, type SolConditions } from '../sim/buildRules';
import { t, tf, type StringKey } from '../ui/i18n';
import type { ModeMachine } from './modes';
import { storage } from './settings';
import type { AppState } from './state';

export interface BuildDeps {
  state: AppState;
  modes: ModeMachine;
  /** Which base (id) you're at, and its layout, if it can be built on. */
  site: () => { id: string; layout: BaseLayout } | null;
  /** A screen point (0–1) → the base's ground there (base units), if it hits. */
  groundAt: (x: number, y: number) => [number, number] | null;
  /** The Sun's path and the dust at the base on the shown date. */
  sol: () => SolConditions | null;
  flash: (text: string) => void;
  /** ?flags=build */
  enabled: boolean;
}

const layoutKey = (id: string) => `gse.build.${id}`;
const LEVELS_KEY = 'gse.baseLevels';

/** Sticky base levels from storage (malformed → none). */
export function readLevels(): Record<string, 1 | 2 | 3> {
  try {
    const data = JSON.parse(storage?.getItem(LEVELS_KEY) ?? '{}');
    const out: Record<string, 1 | 2 | 3> = {};
    if (data && typeof data === 'object') for (const [k, v] of Object.entries(data)) if (v === 1 || v === 2 || v === 3) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function write(key: string, value: unknown) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // not kept; still applies for this visit
  }
}

/**
 * Build mode (v2.1 prototype, ?flags=build): the layout and its history, the module
 * you've chosen and the one you hold, and what the rules make of it. Takes the build
 * intents; the scene and the panel only read from it.
 */
export class Build {
  private history: History<Placed[]> | null = null;
  private siteId: string | null = null;
  kind: BuildKind = 'solar';
  /** The cell under the cursor (hand, mouse or touch). */
  cursor: [number, number] | null = null;
  /** The module in your hand: where it would go (the cursor), and where it came from (null: new). */
  held: { item: Placed; from: Placed | null } | null = null;
  /** Bumped on every layout change (the scene rebuilds its modules). */
  version = 0;
  private statusCache: { key: string; status: BaseStatus } | null = null;
  /** The cursor before the latest intent (a second tap on the same cell places). */
  chosenBefore: [number, number] | null = null;

  constructor(private readonly d: BuildDeps) {}

  /** Building is on (?flags=build). */
  get enabled() {
    return this.d.enabled;
  }

  get active() {
    return this.d.modes.mode === 'build';
  }

  /** The layout at a base (loaded from the device the first time). */
  placed(id: string, layout: BaseLayout): readonly Placed[] {
    if (this.siteId !== id) {
      let saved: string | null = null;
      try {
        saved = storage?.getItem(layoutKey(id)) ?? null;
      } catch {
        // nothing kept
      }
      this.history = new History(parsePlaced(saved, layout));
      this.siteId = id;
      this.version++;
    }
    return this.history!.present;
  }

  get canUndo() {
    return this.history?.canUndo ?? false;
  }

  get canRedo() {
    return this.history?.canRedo ?? false;
  }

  /** The base's state over this sol (cached per layout and date). */
  status(): BaseStatus | null {
    const site = this.d.site();
    const sol = this.d.sol();
    if (!site || !sol) return null;
    const placed = this.placed(site.id, site.layout);
    const key = `${this.version}|${sol.latDeg.toFixed(2)}|${sol.decDeg.toFixed(2)}|${sol.dust.toFixed(3)}`;
    if (this.statusCache?.key !== key) this.statusCache = { key, status: evaluate(site.layout, placed, sol) };
    return this.statusCache.status;
  }

  /**
   * What's about to go down at the cursor: the module in your hand, or (hovering, or a first
   * tap) a new one of the chosen kind on an empty cell. Null over a built module.
   */
  ghost(): { item: Placed; from: Placed | null } | null {
    if (this.held) return this.held;
    if (!this.cursor || this.under()) return null;
    return { item: { kind: this.kind, i: this.cursor[0], j: this.cursor[1], rot: 0 }, from: null };
  }

  /** What putting the ghost down at the cursor would do: why not, or the base's state after. */
  preview(): { blocked: string | null; status: BaseStatus | null } | null {
    const site = this.d.site();
    const sol = this.d.sol();
    const ghost = this.ghost();
    if (!site || !sol || !ghost || !this.cursor) return null;
    const placed = this.placed(site.id, site.layout);
    const why = cellBlocked(site.layout, placed, ...this.cursor, ghost.from ?? undefined);
    if (why) return { blocked: why, status: null };
    const next = [...placed.filter((p) => p !== ghost.from), { ...ghost.item, i: this.cursor[0], j: this.cursor[1] }];
    return { blocked: null, status: evaluate(site.layout, next, sol) };
  }

  /** The module standing on the cursor's cell, if any. */
  private under(): Placed | null {
    const site = this.d.site();
    if (!site || !this.cursor) return null;
    return this.placed(site.id, site.layout).find((p) => p.i === this.cursor![0] && p.j === this.cursor![1]) ?? null;
  }

  private commit(next: Placed[]) {
    const site = this.d.site()!;
    this.history!.push(next);
    this.changed(site.id);
  }

  private changed(id: string) {
    this.version++;
    write(layoutKey(id), this.history!.present);
    const s = this.status();
    if (!s) return;
    // Levels are kept once earned; the live status shows the rest.
    const levels = this.d.state.baseLevels;
    const kept = best(levels[id], s.level);
    if (kept !== (levels[id] ?? 1)) {
      this.d.state.baseLevels = { ...levels, [id]: kept };
      write(LEVELS_KEY, this.d.state.baseLevels);
      this.d.flash(tf('levelReached', this.d.state.lang, { n: String(kept) }));
    }
  }

  /** Build-mode meanings of intents. Returns true if it took the intent. */
  handle(intent: Intent): boolean {
    const { modes, state } = this.d;
    if (intent.type === 'toggleBuild') {
      if (!this.d.enabled) return false;
      if (modes.mode === 'build') this.finish();
      else if (modes.mode === 'baseView' && this.d.site()) {
        modes.go('build');
        this.placed(this.d.site()!.id, this.d.site()!.layout);
      }
      return true;
    }
    if (modes.mode !== 'build') return false;
    const site = this.d.site();
    if (!site) return false;
    const placed = this.placed(site.id, site.layout);
    this.chosenBefore = this.cursor;
    switch (intent.type) {
      case 'buildPick':
        this.kind = intent.kind;
        if (this.held && !this.held.from) this.held.item = { ...this.held.item, kind: intent.kind };
        return true;
      case 'next':
      case 'prev': {
        const k = BUILD_KINDS.indexOf(this.kind) + (intent.type === 'next' ? 1 : -1);
        return this.handle({ type: 'buildPick', kind: BUILD_KINDS[(k + BUILD_KINDS.length) % BUILD_KINDS.length] });
      }
      case 'buildCursor': {
        const g = this.d.groundAt(intent.x, intent.y);
        this.cursor = g && Math.hypot(...g) <= BUILD_RADIUS + 0.3 ? cellAt(...g) : null;
        return true;
      }
      case 'buildGrab': {
        if (this.held || !this.cursor) return true;
        const there = this.under();
        if (there) this.held = { item: { ...there }, from: there };
        else if (placed.length >= MAX_MODULES) this.d.flash(tf('baseFull', state.lang, { n: String(MAX_MODULES) }));
        else this.held = { item: { kind: this.kind, i: this.cursor[0], j: this.cursor[1], rot: 0 }, from: null };
        return true;
      }
      case 'buildDrop':
        this.drop();
        return true;
      case 'select': // Enter: grab at the cursor, or put down what you hold (pointing at a planet: ignored here)
        if (intent.bodyId) return true;
        return this.handle({ type: this.held ? 'buildDrop' : 'buildGrab' });
      case 'buildTurn': {
        const turn = (p: Placed): Placed => ({ ...p, rot: ((p.rot + intent.dir + 4) % 4) as Placed['rot'] });
        if (this.held) this.held.item = turn(this.held.item);
        else {
          const there = this.under();
          if (there) this.commit(placed.map((p) => (p === there ? turn(p) : p)));
        }
        return true;
      }
      case 'buildDelete': {
        const gone = this.held?.from ?? (this.held ? null : this.under());
        this.held = null;
        if (gone) this.commit(placed.filter((p) => p !== gone));
        return true;
      }
      case 'buildUndo':
      case 'buildRedo':
        this.held = null;
        if (intent.type === 'buildUndo' ? this.history!.undo() : this.history!.redo()) this.changed(site.id);
        return true;
      case 'buildReset':
        this.held = null;
        if (placed.length) this.commit([]); // undoable
        return true;
      case 'dismiss':
        if (state.weightOpen || state.passportOpen || state.menuOpen) return false;
        if (this.held) this.held = null; // Esc: put it back
        else this.finish();
        return true;
      default:
        return false;
    }
  }

  /** Put down what you hold at the cursor: there if the cell's free, otherwise back where it was. */
  private drop() {
    const site = this.d.site();
    const held = this.held;
    this.held = null;
    if (!site || !held || !this.cursor) return;
    const placed = this.placed(site.id, site.layout);
    const why = cellBlocked(site.layout, placed, ...this.cursor, held.from ?? undefined);
    if (why) {
      this.d.flash(tf('cantBuild', this.d.state.lang, { why: t(`blocked.${why}` as StringKey, this.d.state.lang) }));
      return;
    }
    const item = { ...held.item, i: this.cursor[0], j: this.cursor[1] };
    if (held.from && held.from.i === item.i && held.from.j === item.j && held.from.rot === item.rot) return; // didn't move
    this.commit([...placed.filter((p) => p !== held.from), item]);
  }

  private finish() {
    this.held = null;
    this.cursor = null;
    this.d.modes.go('baseView');
  }
}
