import type { Lang } from '../data/bodies';
import type { AvatarId, CabinId } from '../travel/booking';
import type { TravelStore } from '../travel/store';
import type { Screen } from './nav';

// What the shell's screens share: building DOM safely, and what a screen can ask of the shell.

/** A booking being made: what the steps have chosen so far. Kept in memory until it's confirmed. */
export interface Draft {
  /** Made once per booking, so confirming twice books once (TravelStore.confirm). */
  attempt: string;
  to: string;
  name: string;
  avatar: AvatarId;
  departure: string;
  cabin: CabinId;
}

/** The explorer's photo helpers (ui/photo.ts). Passed in, not imported: importing them would split them out of the main bundle. */
export interface ShellFiles {
  png(canvas: HTMLCanvasElement): Promise<Blob>;
  download(blob: Blob, name: string): void;
  canShare(file: File): boolean;
}

/** What a screen can do: navigate, book, or hand over to the explorer. */
export interface ScreenContext {
  lang: Lang;
  go(screen: Screen): void;
  back(): void;
  /** Close the shell; with a base, the explorer opens there. */
  explore(baseId?: string): void;
  /** The bookings on this device. */
  store: TravelStore;
  /** The booking being made, or null when none is. */
  draft: Draft | null;
  /** Starts a booking to a destination, with the last traveller filled in. */
  book(to: string): void;
  /** A booking was confirmed: show it, with only the hub behind. */
  confirmed(ref: string): void;
  /** Boards a checked-in booking: the explorer opens at the spaceport, the clock at its departure. */
  begin(ref: string): void;
  /** A postcard of a completed journey, over the scene as it is now (shell/postcard.ts). */
  postcard(ref: string): Promise<File>;
  /** Saving and sharing files: the explorer's own (ui/photo.ts), passed in by the host. */
  files: ShellFiles;
  /** Deletes everything AstroLife keeps on this device, and goes home. */
  forget(): void;
  /** Something this screen shows has changed (a booking step): draw it again. */
  refresh(): void;
}

/** A DOM element. Children are nodes or text: text is never parsed as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string | null)[]) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  el.append(...children.filter((c): c is Node | string => c !== null));
  return el;
}

/** A button that does `action` when activated. */
export function button(label: string, action: () => void, kind: 'primary' | 'secondary' | 'small' | 'link' | 'tab' | 'danger' = 'secondary', attrs: Record<string, string> = {}) {
  const el = h('button', { type: 'button', class: `al-btn ${kind}`, ...attrs }, label);
  el.addEventListener('click', action);
  return el;
}

/** A screen's heading: it takes focus when the screen opens, so a screen reader reads it first. */
export const title = (text: string) => h('h2', { id: 'shell-title', tabindex: '-1' }, text);
