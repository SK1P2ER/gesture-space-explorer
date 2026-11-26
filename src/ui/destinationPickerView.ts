// Opt-in 3D destination picker (?flags=picker3d): what it draws. Loaded only when the flag is on.
//
// Ownership: while the picker owns destination selection, its card is the one destination UI — the selected
// destination, its state, one Confirm, and "All destinations" (the text list, collapsed until asked for). The base
// sheet's travel list and Guided's own list/Confirm step aside for that time (main.ts / guidedMission.ts).
//
// Orbs: real spheres in the existing scene, drawn by the existing renderer. Each reuses its body's own sphere geometry
// and surface texture (shared, never copied or disposed here) on a cheap unlit material of its own, shaded in view
// space (a fixed key light and a rim) so it reads as a lit globe anywhere on screen. Until the body's texture has
// loaded (the app's usual loading path is asked for it) a body-coloured, banded globe stands in; after a failed load
// the app's own procedural texture is used. Off the view axis each sphere is squeezed by cos θ so it stays round.
import * as THREE from 'three';
import { baseById } from '../data/bases';
import { BODIES, type Lang } from '../data/bodies';
import type { BodyNode } from '../planets/planet';
import { ellipseCompensation, layoutPicker, layoutTargets, orbDrawScale, orbLook, pickerDestinations, type PickerTarget, type Rect } from '../app/destinationPicker';
import { t as i18n } from './i18n';
import { studioLayout } from './studioLayout';
import { BASE_LAYER } from '../scene/baseKit/baseLighting';
import './destinationPicker.css';

const WORDS = {
  en: { studioTitle: 'Choose a destination', studioReady: 'Ready for departure', none: 'Point 👆 at a destination', holding: 'Keep holding 👍…', release: 'Lower your thumb while keeping your hand visible, then show 👍 again.', selected: 'selected', loading: 'loading',
    gesture: '👆 point to choose · 👍 hold to confirm · or tap', keyboard: 'Tab to a destination or Confirm · Enter',
    all: 'All destinations', back: '← Back to spaceport', backBase: '← Back to base', open: '🪐 Choose a destination',
    step: 'Step {n} of 3', selectedLabel: 'Selected —', confirmDest: '👍 Confirm destination', change: '← Change destination',
    confirmed: '✓ Destination confirmed', led: 'Thank you for travelling with us.', from: 'From', to: 'To',
    release3: 'Release 👍, then hold again to launch', hint3: '👍 hold to launch · or tap', keyboard3: 'Tab to Launch · Enter',
    refused: 'This destination can’t be confirmed right now.', view: 'View journey —', saved: 'Saved destination —',
    savedNote: 'Confirm this destination again before launch.',
    map: 'Surface map', mapGenerated: 'Colour illustration', details: 'Details', see: 'What you’ll see', close: 'Close',
    paused: 'While you view the details, hand selection and confirmation are paused.' },
  ja: { studioTitle: '行き先を選ぶ', studioReady: '出発準備', none: '👆 で行き先を指してください', holding: '👍 をそのままキープ…', release: '手をカメラに映したまま親指を下ろし、もう一度👍を見せてください。', selected: '選択中', loading: '読み込み中',
    gesture: '👆 で選択 · 👍 キープで確認 · タップも可', keyboard: 'Tab で行き先か確認へ · Enter',
    all: 'すべての行き先', back: '← 宇宙港に戻る', backBase: '← 基地に戻る', open: '🪐 行き先を選ぶ',
    step: 'ステップ {n}/3', selectedLabel: '選択中 —', confirmDest: '👍 行き先を確定', change: '← 行き先を選び直す',
    confirmed: '✓ 行き先が確定しました', led: 'ご利用ありがとうございます。', from: '出発', to: '到着',
    release3: '👍 を一度戻してから、もう一度キープで打ち上げ', hint3: '👍 キープで打ち上げ・タップも可', keyboard3: 'Tab で打ち上げへ · Enter',
    refused: '今はこの行き先を確定できません。', view: '旅程を確認 —', saved: '保存された行き先 —',
    savedNote: '出発前に行き先をもう一度確認してください。',
    map: '表面マップ', mapGenerated: '色による表現', details: '詳細', see: '見どころ', close: '閉じる',
    paused: '詳細を見ている間、ハンドでの選択と確定は一時停止します。' },
  my: { studioTitle: 'သွားမည့်နေရာ ရွေးရန်', studioReady: 'ထွက်ခွာရန် အသင့်', none: '👆 ဖြင့် သွားမည့်နေရာကို ညွှန်ပါ', holding: '👍 ဆက်ကိုင်ထားပါ…', release: 'လက်ကို ကင်မရာမြင်ကွင်းထဲမှာထားပြီး လက်မကို အရင်ချပါ။ ပြီးမှ 👍 ပြန်ပြပါ။', selected: 'ရွေးထားပါတယ်', loading: 'ပုံ ဖွင့်နေသည်',
    gesture: '👆 ညွှန်ပြီး ရွေးပါ · 👍 ကိုင်ထားပြီး အတည်ပြုပါ · နှိပ်လည်း ရပါတယ်', keyboard: 'Tab ဖြင့် နေရာ သို့မဟုတ် အတည်ပြုခလုတ် · Enter',
    all: 'နေရာအားလုံး', back: '← အာကာသဆိပ်ကမ်းသို့ ပြန်ရန်', backBase: '← စခန်းသို့ ပြန်ရန်', open: '🪐 သွားမည့်နေရာ ရွေးရန်',
    step: 'အဆင့် {n}/၃', selectedLabel: 'ရွေးထားသည့်နေရာ —', confirmDest: '👍 အတည်ပြုရန်', change: '← သွားမည့်နေရာ ပြန်ရွေးရန်',
    confirmed: '✓ သွားမည့်နေရာ အတည်ပြုပြီးပါပြီ', led: 'အသုံးပြုသည့်အတွက် ကျေးဇူးတင်ပါတယ်။', from: 'ထွက်ခွာရာ', to: 'သွားမည့်နေရာ',
    release3: '👍 ကို အရင်ဖြုတ်ပါ။ ပြန်ပြပြီး လွှတ်တင်နိုင်ပါတယ်။', hint3: '👍 ကိုင်ထားပြီး လွှတ်တင်ပါ · နှိပ်လည်း ရပါတယ်', keyboard3: 'Tab ဖြင့် လွှတ်တင်ရန်ခလုတ် · Enter',
    refused: 'ဒီနေရာကို အခု အတည်ပြုလို့ မရသေးပါ။', view: 'ခရီးစဉ်ကြည့်ရန် —', saved: 'သိမ်းထားသည့်နေရာ —',
    savedNote: 'လွှတ်တင်မီ သွားမည့်နေရာကို ထပ်မံအတည်ပြုပါ။',
    map: 'မျက်နှာပြင်မြေပုံ', mapGenerated: 'အရောင်ဖြင့် သရုပ်ဖော်ပုံ', details: 'အသေးစိတ်', see: 'ဘာတွေမြင်ရမလဲ', close: 'ပိတ်ရန်',
    paused: 'အသေးစိတ်ကြည့်နေစဉ် လက်ဟန်ဖြင့် ရွေးချယ်ခြင်းနှင့် အတည်ပြုခြင်းကို ခဏရပ်ထားပါသည်။' },
} satisfies Record<Lang, Record<string, string>>;
const myDigits = (s: string) => s.replace(/\d/g, (d) => '၀၁၂၃၄၅၆၇၈၉'[Number(d)]);

/**
 * Where a shipped colour map comes from, by the file actually shown (public/textures/LICENSE.txt): the USGS global
 * mosaics made from NASA mission data. Every other map (Solar System Scope's) is described neutrally.
 */
const MISSION_MOSAICS = new Set(['io.jpg', 'europa.jpg', 'ganymede.jpg', 'callisto.jpg', 'titan.jpg', 'pluto.jpg']);
type MapKind = 'mission' | 'illustration' | 'generated';
export const mapKind = (file: string | undefined, fellBack: boolean): MapKind => fellBack || !file ? 'generated' : MISSION_MOSAICS.has(file) ? 'mission' : 'illustration';
/** The thumbnail's accessible name: what the image is (never a photo of the base). */
const MAP_ALT: Record<Lang, (body: string, kind: MapKind) => string> = {
  en: (b, k) => k === 'mission' ? `${b} surface map: a mosaic made from spacecraft data (colours approximate), not a photo of the base`
    : k === 'illustration' ? `${b} surface illustration, not a photo of the base` : `${b}: a colour illustration (its surface map is unavailable), not a photo of the base`,
  ja: (b, k) => k === 'mission' ? `${b}の表面マップ：探査機のデータから作ったモザイク（色は近似）。基地の写真ではありません`
    : k === 'illustration' ? `${b}の表面の図。基地の写真ではありません` : `${b}：色による表現（表面マップを読み込めません）。基地の写真ではありません`,
  my: (b, k) => k === 'mission' ? `${b} ရဲ့ မျက်နှာပြင်မြေပုံ — အာကာသယာဉ် ဒေတာကနေ ပြုလုပ်ထားတဲ့ ပုံ (အရောင် ခန့်မှန်း)၊ စခန်းဓာတ်ပုံ မဟုတ်ပါ`
    : k === 'illustration' ? `${b} — ဂြိုလ်မျက်နှာပြင် သရုပ်ဖော်ပုံ — စခန်းဓာတ်ပုံ မဟုတ်ပါ` : `${b} — အရောင်ဖြင့် သရုပ်ဖော်ပုံ (မျက်နှာပြင်မြေပုံ မရပါ)၊ စခန်းဓာတ်ပုံ မဟုတ်ပါ`,
};

/** Which card: Guided's destination step (option A, unchanged), or the free-mode flow's screen 2 or 3. */
export type PickerScreen = 'guided' | 'select' | 'confirm';

export interface PickerFrame {
  active: boolean;
  camera: THREE.PerspectiveCamera;
  lang: Lang;
  currentBase: string | null;
  selected: string | null;
  hover: string | null;
  focusProgress: number;
  confirmProgress: number;
  waitingRelease: boolean;
  confirmLabel: string;
  reducedMotion: boolean;
  /** The picker was opened from the Tanegashima ground view: the card offers Back. */
  fromGround: boolean;
  /** Screen 1's way in: shown when the flow can open here; with the journey shortcut or the saved destination. */
  entry: { canOpen: boolean; journey: string | null; saved: string | null };
  screen: PickerScreen;
  /** The confirmed destination (screen 3) and where the journey starts. */
  confirmed: string | null;
  /** Screen 2's Confirm was just refused by the mission. */
  refused: boolean;
  /** Bumped on every screen change of the flow (card entrance, focus). */
  generation: number;
  dt: number;
  /** SPIKE: the studio draws this frame (its own scene and camera; the studio layout). Free mode's screens only. */
  studio?: boolean;
}
export interface PickerActions {
  choose(baseId: string): void;
  confirm(): void;
  /** Screen 1 → 2 (from the base view or the ground view). */
  open(): void;
  /** Screen 1's shortcut → screen 3 (never launches). */
  showJourney(): void;
  back(): void;
  /** The app's usual texture path for a body (no-op once asked). */
  requestTexture(bodyId: string): void;
  /** The Details dialog opened (👆 / 👍 pause, holds cancelled) or closed (fresh input needed). */
  details(open: boolean): void;
}

interface Item {
  baseId: string; node: BodyNode;
  holder: THREE.Object3D; orb: THREE.Mesh; material: THREE.MeshBasicMaterial; fallback: { value: number };
  halo: THREE.Mesh; haloMaterial: THREE.MeshBasicMaterial; button: HTMLButtonElement; state: string; place: string; look: string;
  /** The drawn scale (1, or up to PICKER.selectedScale when selected): never an input of the hit target. */
  drawScale: number;
}
const SELECTED = new THREE.Color(0x8fe0cc), HOVER = new THREE.Color(0x9fc8ff), IDLE = new THREE.Color(0xc9d6e8), CONFIRMING = new THREE.Color(0xffc58f);
const v = new THREE.Vector3(), axis = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0), q = new THREE.Quaternion();
const DEPTH = 1; // camera-space distance of the orbs (they ignore depth: only on-screen size matters)
const MEASURE_MS = 250;

/** The orb's own material: the shared map, lit in view space, banded when it stands in for a texture still loading. */
function orbMaterial(fallback: { value: number }) {
  const m = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, transparent: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOrbFallback = fallback;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOrbN;\nvarying vec3 vOrbP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOrbN = normalize(normalMatrix * normal);\nvOrbP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOrbN;\nvarying vec3 vOrbP;\nuniform float uOrbFallback;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        if (uOrbFallback > 0.5) {
          vec3 p = normalize(vOrbP);
          diffuseColor.rgb *= 0.82 + 0.18 * sin(p.y * 13.0 + 1.6 * sin(atan(p.z, p.x) * 3.0));
        }
        vec3 n = normalize(vOrbN);
        // Enough fill that a dark world (Mars) still stands out from black space; the key light keeps it a globe.
        float lit = 0.3 + 0.85 * max(dot(n, normalize(vec3(-0.55, 0.6, 0.6))), 0.0);
        float rim = pow(1.0 - max(n.z, 0.0), 3.0) * 0.22;
        diffuseColor.rgb = diffuseColor.rgb * lit + vec3(rim);`);
  };
  m.customProgramCacheKey = () => 'destination-picker-orb';
  return m;
}

export class DestinationPickerView {
  readonly root = document.createElement('section');
  private readonly card = document.createElement('div');
  private readonly cardName = document.createElement('p');
  private readonly cardState = document.createElement('p');
  private readonly confirm = document.createElement('button');
  private readonly toggle = document.createElement('button');
  private readonly back = document.createElement('button');
  private readonly list = document.createElement('ul');
  private readonly hint = document.createElement('p');
  private readonly top = document.createElement('div');
  private readonly step = document.createElement('span');
  private readonly selLabel = document.createElement('p');
  /** Screen 3's state: the one live status, announced once when the screen opens. */
  private readonly chip = document.createElement('p');
  /** Screen 3's greeting: plain text, read in order, never announced. */
  private readonly led = document.createElement('p');
  private readonly route = document.createElement('p');
  private readonly routeLegs = [this.createRouteLeg(), this.createRouteLeg()];
  private readonly row = document.createElement('div');
  /** Screen 2's compact destination info: the body's surface map, base · body, two facts. */
  private readonly info = document.createElement('div');
  private readonly thumb = document.createElement('div');
  private readonly thumbCaption = document.createElement('span');
  private readonly infoName = document.createElement('p');
  private readonly facts = document.createElement('ul');
  private readonly detailsBtn = document.createElement('button');
  /** "What you'll see": a modal sheet over the card (the card keeps its size: nothing in the stage moves). */
  private readonly sheet = document.createElement('div');
  private readonly sheetTitle = document.createElement('h3');
  private readonly sheetClose = document.createElement('button');
  private readonly sheetSee = document.createElement('p');
  private readonly sheetPaused = document.createElement('p');
  /** Details' image, caption and facts: shown there in a short landscape card, which leaves them out (CSS). */
  private readonly sheetInfo = document.createElement('div');
  private readonly sheetThumb = document.createElement('div');
  private readonly sheetCaption = document.createElement('p');
  private readonly sheetFacts = document.createElement('ul');
  private infoKey = '';
  private sheetKey = '';
  /** Screen 1's way in (the base view or the ground view): an optional saved/journey line and the Choose button. */
  private readonly entryBox = document.createElement('div');
  private readonly entrySaved = document.createElement('p');
  private readonly entryJourney = document.createElement('button');
  /** Opens the flow (screen 2); in the ground view the ground view is set aside, then restored by Back. */
  readonly entry = document.createElement('button');
  private lastGeneration = -1;
  /** SPIKE (studio): the title row; whether the studio layout is in use; Mission Ready (no planet is a control). */
  private readonly studioTitle = document.createElement('h2');
  private studioOn = false;
  private hitOff = false;
  private lastScreen: PickerScreen | null = null;
  private prevScreen: PickerScreen | null = null;
  private readonly group = new THREE.Group();
  private readonly ring = new THREE.RingGeometry(1.04, 1.14, 48); // within the 1.15 r the layout leaves for it
  private readonly items = new Map<string, Item>();
  private targets: PickerTarget[] = [];
  private cardRect: Rect | null = null;
  private bandsCache: Rect[] = [];
  private measuredAt = -Infinity;
  private layoutKey = '';
  private measuredViewport = '';
  private listKey = '';
  /** Each screen's card heights as last measured (whole: border included), full and compact. */
  private readonly cardHeights: Record<PickerScreen, { full: number; compact: number }> = {
    guided: { full: 168, compact: 112 }, select: { full: 250, compact: 190 }, confirm: { full: 300, compact: 220 },
  };
  private requested = new Set<string>();
  /** Decorative animation state only; the camera and mission keep their existing lifecycle. */
  private readonly chargeVisibility = () => {
    this.root.dataset.pageHidden = String(document.hidden);
  };
  /** Where focus goes once the ground view ↔ picker swap has happened. */
  private pendingFocus: 'card' | 'entry' | null = null;
  private readonly coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;

  constructor(private readonly scene: THREE.Scene, private readonly nodes: BodyNode[], private readonly actions: PickerActions) {
    this.root.id = 'destination-picker';
    this.root.setAttribute('aria-label', 'Destinations');
    this.root.hidden = true;
    this.card.className = 'picker-card';
    this.card.addEventListener('animationend', () => delete this.card.dataset.enter);
    this.cardName.className = 'picker-name';
    this.cardState.className = 'picker-state';
    this.cardState.setAttribute('role', 'status');
    this.cardState.setAttribute('aria-live', 'polite');
    document.addEventListener('visibilitychange', this.chargeVisibility);
    this.chargeVisibility();
    for (const [b, cls] of [[this.confirm, 'picker-confirm'], [this.toggle, 'picker-all'], [this.back, 'picker-back']] as const) { b.type = 'button'; b.className = cls; }
    this.list.id = 'picker-list';
    this.list.className = 'picker-list';
    this.list.hidden = true;
    this.toggle.setAttribute('aria-controls', this.list.id);
    this.toggle.setAttribute('aria-expanded', 'false');
    this.confirm.addEventListener('click', () => actions.confirm());
    this.back.addEventListener('click', () => { this.closeList(false); this.pendingFocus = 'entry'; actions.back(); });
    this.toggle.addEventListener('click', () => (this.list.hidden ? this.openList() : this.closeList(true)));
    // Escape inside the list closes it and returns focus to its button (an element listener, not a page shortcut).
    this.list.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeList(true); } });
    // A held Enter / Space activates one button, once: its auto-repeat must not press the next screen's button that
    // focus moved to (Confirm → Back, Choose → the card). Element listeners on the picker's own elements only.
    const noRepeat = (e: KeyboardEvent) => { if (e.repeat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); } };
    this.root.addEventListener('keydown', noRepeat, true);
    this.entryBox.addEventListener('keydown', noRepeat, true);
    this.hint.className = 'picker-hint';
    // Back always in the same slot (top-left), with the step beside it.
    this.top.className = 'picker-top';
    this.step.className = 'picker-step';
    this.top.append(this.back, this.step);
    this.selLabel.className = 'picker-sel-label';
    this.chip.className = 'picker-confirmed';
    this.chip.setAttribute('role', 'status');
    this.led.className = 'picker-led';
    this.route.className = 'picker-route';
    this.route.append(this.routeLegs[0].row, '\n', this.routeLegs[1].row);
    this.row.className = 'picker-row';
    // Screen 2's info: the image is the body's own texture map (an existing asset), said so in words.
    this.info.className = 'picker-info';
    this.thumb.className = 'picker-thumb';
    this.thumb.setAttribute('role', 'img');
    this.thumbCaption.setAttribute('aria-hidden', 'true');
    // Caption is beside the miniature globe, not painted over it.
    this.infoName.className = 'picker-info-name';
    this.facts.className = 'picker-facts';
    this.info.append(this.thumb, this.infoName, this.facts, this.thumbCaption);
    this.thumbCaption.className = 'picker-image-description';
    this.detailsBtn.type = 'button';
    this.detailsBtn.className = 'picker-details';
    this.detailsBtn.setAttribute('aria-haspopup', 'dialog');
    this.detailsBtn.setAttribute('aria-controls', 'picker-sheet');
    this.detailsBtn.setAttribute('aria-expanded', 'false');
    this.detailsBtn.addEventListener('click', () => this.openDetails());
    this.sheet.id = 'picker-sheet';
    this.sheet.className = 'picker-sheet';
    this.sheet.hidden = true;
    this.sheet.setAttribute('role', 'dialog');
    this.sheet.setAttribute('aria-modal', 'true');
    this.sheet.setAttribute('aria-labelledby', 'picker-sheet-title');
    this.sheetTitle.id = 'picker-sheet-title';
    this.sheetClose.type = 'button';
    this.sheetClose.className = 'picker-sheet-close';
    this.sheetClose.addEventListener('click', () => this.closeDetails(true));
    this.sheetSee.className = 'picker-see';
    this.sheetPaused.className = 'picker-paused';
    const head = document.createElement('div');
    head.className = 'picker-sheet-head';
    head.append(this.sheetTitle, this.sheetClose);
    this.sheetInfo.className = 'picker-sheet-info';
    // Classes of their own: the card's selectors (.picker-thumb, .picker-facts) keep meaning the card's rows only.
    this.sheetThumb.className = 'picker-sheet-thumb';
    this.sheetThumb.setAttribute('role', 'img');
    this.sheetCaption.className = 'picker-sheet-caption';
    this.sheetFacts.className = 'picker-sheet-facts';
    this.sheetInfo.append(this.sheetThumb, this.sheetFacts, this.sheetCaption);
    this.sheet.append(head, this.sheetInfo, this.sheetSee, this.sheetPaused);
    // Escape closes it (focus back on Details); Tab stays on its one control. Element listeners only.
    this.sheet.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeDetails(true); }
      else if (e.key === 'Tab') { e.preventDefault(); this.sheetClose.focus(); }
    });
    this.row.append(this.detailsBtn, this.toggle);
    this.card.append(this.top, this.chip, this.led, this.selLabel, this.cardName, this.info, this.route, this.cardState, this.confirm, this.row, this.list, this.hint, this.sheet);
    this.root.append(this.card);
    this.studioTitle.className = 'picker-studio-title';
    this.studioTitle.hidden = true;
    this.root.insertBefore(this.studioTitle, this.card);
    this.entryBox.id = 'picker-entry';
    this.entryBox.hidden = true;
    this.entrySaved.className = 'picker-saved';
    this.entryJourney.type = 'button';
    this.entryJourney.className = 'picker-journey';
    this.entryJourney.addEventListener('click', () => { this.pendingFocus = 'card'; actions.showJourney(); });
    this.entry.type = 'button';
    this.entry.id = 'picker-open';
    this.entry.addEventListener('click', () => { this.pendingFocus = 'card'; actions.open(); });
    this.entryBox.append(this.entrySaved, this.entryJourney, this.entry);
    document.body.append(this.root, this.entryBox);
    this.group.name = 'destination-picker';
    this.group.visible = false;
    scene.add(this.group);
  }

  /** The orbs' group in the shared scene (for the base pass's root list). */
  get object3d(): THREE.Object3D { return this.group; }
  /** The on-screen targets the input logic picks from (CSS px); none while the text list is open. */
  get currentTargets(): readonly PickerTarget[] {
    return this.root.hidden || !this.list.hidden || this.hitOff || this.measuredViewport !== `${innerWidth}x${innerHeight}` ? [] : this.targets;
  }
  get listOpen() { return !this.list.hidden; }
  get detailsOpen() { return !this.sheet.hidden; }

  /**
   * Details: a modal dialog over the card. Everything else of the picker is inert meanwhile (the scene shortcuts stand
   * aside for an open modal dialog too); the app pauses 👆 / 👍 (actions.details). The choice is never touched.
   */
  private openDetails() {
    if (!this.sheet.hidden || this.detailsBtn.hidden) return;
    this.sheet.hidden = false;
    this.detailsBtn.setAttribute('aria-expanded', 'true');
    for (const e of this.background()) e.inert = true;
    this.actions.details(true);
    this.sheetClose.focus({ preventScroll: true });
  }
  private closeDetails(returnFocus: boolean) {
    if (this.sheet.hidden) return;
    this.sheet.hidden = true;
    this.detailsBtn.setAttribute('aria-expanded', 'false');
    for (const e of this.background()) e.inert = false;
    this.actions.details(false);
    if (returnFocus) this.detailsBtn.focus({ preventScroll: true });
  }
  /** What the open dialog makes inert: the card's other rows and the planets' labels. */
  private background(): HTMLElement[] {
    return [...[...this.card.children].filter((e) => e !== this.sheet) as HTMLElement[], ...[...this.items.values()].map((it) => it.button)];
  }

  private openList() {
    this.list.hidden = false;
    this.toggle.setAttribute('aria-expanded', 'true');
    this.card.dataset.expanded = 'true';
    const target = this.list.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ?? this.list.querySelector('button');
    target?.focus();
  }
  private closeList(returnFocus: boolean) {
    if (this.list.hidden) return;
    this.list.hidden = true;
    this.toggle.setAttribute('aria-expanded', 'false');
    delete this.card.dataset.expanded;
    if (returnFocus) this.toggle.focus();
  }

  private item(baseId: string): Item {
    let item = this.items.get(baseId);
    if (item) return item;
    const body = baseById(baseId).body;
    const node = this.nodes.find((n) => n.body.id === body)!;
    const fallback = { value: 1 };
    const material = orbMaterial(fallback);
    // The body's own sphere geometry (shared with the planets; never disposed here).
    const orb = new THREE.Mesh(node.mesh.geometry, material);
    orb.rotation.set(0.35, Math.random() * Math.PI * 2, 0); // a little axial tilt, a different face each
    const holder = new THREE.Object3D();
    holder.add(orb);
    const haloMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const halo = new THREE.Mesh(this.ring, haloMaterial);
    orb.renderOrder = 1000; halo.renderOrder = 1001;
    orb.frustumCulled = halo.frustumCulled = false;
    // Also in the base pass (drawn after the planets), so a base model never paints over an orb.
    orb.layers.enable(BASE_LAYER); halo.layers.enable(BASE_LAYER);
    this.group.add(holder, halo);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'picker-target';
    button.dataset.base = baseId;
    button.addEventListener('click', () => this.actions.choose(baseId));
    this.root.insertBefore(button, this.card);
    item = { baseId, node, holder, orb, material, fallback, halo, haloMaterial, button, state: '', place: '', look: '', drawScale: 1 };
    this.items.set(baseId, item);
    return item;
  }

  /**
   * Free rectangles between the HUD and the panels, from the page itself (no overlap by construction): every vertical
   * gap, across the full width and beside any tall column on the left or right.
   */
  /** The page's own HTML panels and controls on screen (what the picker never covers). */
  private obstacles(scene = true): DOMRect[] {
    // The footer is a full-width row; its visible items (the place name, Photo, Passport, Settings) are what occupy space.
    // The Japan marker is anchored to the 3D scene: left out where a place must not depend on the scene.
    return [...document.querySelectorAll<HTMLElement>(`header.hud, #mission-hud, #base-panel, #info, footer.hud > *, #timebar, #resume-mission, #mission-overlay .mission-card, #photo-toast, .spaceport-navigation, #clean-view${scene ? ', #japan-site-marker' : ''}`)]
      .filter((e) => !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden')
      .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  }

  private bands(scene = true): Rect[] {
    const w = innerWidth, h = innerHeight, m = 12;
    const rects = this.obstacles(scene);
    // Columns beside any side panel, short ones too (in a short landscape view the room beside the mission card is
    // what holds a whole destination card).
    const lefts = [m, ...rects.filter((r) => r.left < w * 0.3 && r.right < w * 0.5).map((r) => r.right + 8)];
    const rights = [w - m, ...rects.filter((r) => r.right > w * 0.7 && r.left > w * 0.5).map((r) => r.left - 8)];
    const out: Rect[] = [];
    for (const left of lefts) for (const right of rights) {
      if (right - left < 120) continue;
      const spans = rects.filter((r) => r.right > left && r.left < right).map((r) => [r.top - 8, r.bottom + 8] as const).sort((a, b) => a[0] - b[0]);
      let edge = m;
      for (const [top, bottom] of [...spans, [h - m, h] as const]) {
        if (top > edge) out.push({ left, top: edge, right, bottom: top });
        edge = Math.max(edge, bottom);
      }
    }
    return out;
  }

  update(f: PickerFrame, now: number) {
    this.updateEntry(f, now);
    const show = f.active && f.currentBase !== null;
    // While the picker owns the screen the planet labels step aside (removing the class restores whatever they were).
    if (document.body.classList.contains('picker-active') !== show) document.body.classList.toggle('picker-active', show);
    if (!show) {
      if (!this.root.hidden) { this.closeList(false); this.closeDetails(false); this.root.hidden = true; }
      this.group.visible = false;
      return;
    }
    const w = WORDS[f.lang];
    const all = pickerDestinations(f.currentBase).map((d) => d.baseId);
    for (const id of all) {
      const body = baseById(id).body;
      if (!this.requested.has(body)) { this.requested.add(body); this.actions.requestTexture(body); }
    }
    // Screen 3 shows the confirmed destination only; the other screens every destination.
    // SPIKE (studio): every destination keeps its slot on Mission Ready too (the others are a backdrop, not controls).
    const studio = !!f.studio && f.screen !== 'guided';
    this.studioOn = studio;
    this.hitOff = studio && f.screen === 'confirm';
    const ids = studio ? all : f.screen === 'confirm' && f.confirmed ? [f.confirmed] : all;
    const changed = f.generation !== this.lastGeneration || f.screen !== this.lastScreen;
    if (changed) this.screenChange(f);
    const key = `${ids.join()}|${f.lang}|${innerWidth}x${innerHeight}|${f.fromGround}|${f.screen}|${studio}`;
    if (key !== this.layoutKey || now - this.measuredAt > MEASURE_MS) {
      this.layoutKey = key; this.measuredAt = now;
      this.measuredViewport = `${innerWidth}x${innerHeight}`;
      this.bandsCache = this.bands();
      // The card's measured heights, full and compact (name beside Confirm, no hint). The full card if the orbs still
      // fit beside or above it; otherwise the compact one, so the 3D choices keep their room.
      // Its natural height (scrollHeight), not the height a short slot clamped it to, plus its border (the slot's
      // height is the card's whole height): measured for the screen whose content it shows now.
      const heights = this.cardHeights[f.screen];
      if (this.list.hidden && this.sheet.hidden && this.card.offsetHeight > 0 && this.card.dataset.screen === f.screen) {
        heights[this.card.dataset.compact ? 'compact' : 'full'] = this.card.scrollHeight + (this.card.offsetHeight - this.card.clientHeight);
      }
      // The flow's screens: a wider card (one line for the greeting and the route where there is room) in one stable
      // place, the bottom of the free area. Guided keeps its own card.
      const phonePortrait = innerWidth <= 640 && innerHeight >= innerWidth;
      const shortLandscape = innerWidth > innerHeight && innerHeight <= 500;
      const phone = !studio && f.screen !== 'guided' && (phonePortrait || shortLandscape);
      const mobile = phone ? this.layoutPhone(ids, phonePortrait, f.screen === 'confirm') : null;
      if (mobile) {
        this.card.dataset.phone = phonePortrait ? 'portrait' : 'landscape';
        delete this.card.dataset.compact;
        this.targets = mobile.targets;
        this.cardRect = mobile.card;
      } else {
        delete this.card.dataset.phone;
        if (studio) this.layoutStudio(all, heights.full);
        else {
          const flowCard = f.screen !== 'guided';
          const size = (h: number) => ({ width: flowCard ? Math.min(440, innerWidth - 24) : 320, minWidth: 220, height: h, preferBottom: flowCard });
          const full = layoutPicker(ids, this.bandsCache, size(heights.full));
          const compact = layoutPicker(ids, this.bandsCache, size(heights.compact));
          // Orbs and a whole card first; then orbs with a scrolling card; then the card alone.
          const whole = (l: typeof full, h: number) => !!l && l.targets.length > 0 && l.card.bottom - l.card.top >= h - 0.5;
          const layout = whole(full, heights.full) ? full : whole(compact, heights.compact) ? compact
            : full?.targets.length ? full : compact?.targets.length ? compact : full ?? compact;
          if (layout === compact && compact !== full) this.card.dataset.compact = 'true'; else delete this.card.dataset.compact;
          this.targets = layout?.targets ?? [];
          this.cardRect = layout?.card ?? null;
        }
      }
    }
    if (this.studioTitle.hidden === studio) this.studioTitle.hidden = !studio;
    if (studio) this.setText(this.studioTitle, f.screen === 'confirm' ? w.studioReady : w.studioTitle);
    else if (this.root.dataset.studio) delete this.root.dataset.studio;
    if (this.root.hidden) this.root.hidden = false;
    const listOpen = !this.list.hidden;
    // The text list open: it is the selection interface for now; the orbs and their labels step back.
    this.group.visible = !listOpen && this.targets.length > 0;
    const shown = new Set(listOpen ? [] : this.targets.map((t) => t.baseId));
    for (const item of this.items.values()) {
      const on = shown.has(item.baseId);
      item.holder.visible = on;
      if (!on) item.halo.visible = false;
      const labelled = on && !(this.hitOff && item.baseId !== f.selected);
      if (item.button.hidden === labelled) item.button.hidden = !labelled;
      if (item.button.disabled !== (on && this.hitOff)) item.button.disabled = on && this.hitOff;
    }
    if (this.group.visible) this.placeOrbs(f);
    // Opened from screen 1's buttons (which are now gone), or a new screen: focus goes into the card or selected planet.
    if (this.pendingFocus === 'card') { this.pendingFocus = null; this.focusTarget(f.screen, f.selected).focus({ preventScroll: true }); }

    // The card. Guided (option A): the choice, its state, Guided's Confirm, All destinations (Back only from the ground
    // view). Screen 2: Back, the preview, 👍 Confirm destination, All destinations. Screen 3: Back (change), the
    // confirmed state, the greeting, From/To, 🚀 Launch.
    const s = f.screen, confirmScreen = s === 'confirm';
    const label = (id: string) => { const b = baseById(id); return `${b.name[f.lang]} · ${BODIES.find((x) => x.id === b.body)!.name[f.lang]}`; };
    const sel = f.selected ? baseById(f.selected) : null;
    const name = sel ? label(sel.id) : w.none;
    const owed = sel && f.waitingRelease;
    const stateText = s === 'select' && f.refused ? w.refused : owed ? (confirmScreen ? w.release3 : w.release) : sel && f.confirmProgress > 0 ? w.holding : '';
    const keyboard = this.coarse && !this.coarse.matches;
    const hint = confirmScreen ? (keyboard ? w.keyboard3 : w.hint3) : keyboard ? w.keyboard : w.gesture;
    this.setText(this.cardName, confirmScreen ? '' : name);
    // Screen 2 shows the info block instead (reserved before a choice too, so choosing never resizes the card).
    this.cardName.hidden = confirmScreen || s === 'select';
    this.renderInfo(s === 'select', f);
    this.setText(this.cardState, stateText);
    this.card.style.setProperty('--hold', String(Math.round((sel ? f.confirmProgress : 0) * 100)));
    // Visual only: no new timer, no carried-over charge, no change to the 500 ms hold.
    const charge = sel && !f.waitingRelease && this.sheet.hidden ? Math.min(1, Math.max(0, f.confirmProgress)) : 0;
    this.card.style.setProperty('--charge', String(charge));
    this.card.dataset.charging = String(charge > 0);
    this.card.dataset.motion = f.reducedMotion ? 'reduced' : 'full';
    this.setText(this.confirm, s === 'select' ? w.confirmDest : f.confirmLabel);
    if (this.confirm.disabled !== !sel) this.confirm.disabled = !sel;
    const allText = `${w.all} (${f.lang === 'my' ? myDigits(String(all.length)) : all.length}) ${listOpen ? '▴' : '▾'}`;
    this.setText(this.toggle, allText);
    this.row.hidden = confirmScreen;
    const backText = confirmScreen ? w.change : f.fromGround || f.currentBase === 'cape' ? w.back : w.backBase;
    this.setText(this.back, backText);
    this.back.hidden = s === 'guided' && !f.fromGround;
    const stepText = s === 'guided' ? '' : w.step.replace('{n}', f.lang === 'my' ? myDigits(confirmScreen ? '3' : '2') : confirmScreen ? '3' : '2');
    this.setText(this.step, stepText);
    this.top.hidden = this.back.hidden && !stepText;
    this.selLabel.hidden = true; // screen 2's info block names the choice
    this.setText(this.selLabel, w.selectedLabel);
    this.chip.hidden = this.led.hidden = this.route.hidden = !confirmScreen;
    if (confirmScreen) {
      this.setText(this.led, w.led);
      this.renderRouteLeg(this.routeLegs[0], w.from, f.currentBase, f.lang);
      this.renderRouteLeg(this.routeLegs[1], w.to, f.confirmed, f.lang);
      // The live status speaks once: its words are set when screen 3 opens (screenChange) and only then.
      if (!this.chip.textContent) this.chip.textContent = w.confirmed;
    }
    this.setText(this.hint, hint);
    this.card.dataset.screen = s;
    this.renderList(all, f);
    this.placeCard(listOpen);
  }

  private layoutPhone(ids: string[], portrait: boolean, confirmation: boolean) {
    const bands = this.bandsCache;
    if (portrait) {
      const band = bands.filter((b) => b.left === 12 && b.right === innerWidth - 12)
        .sort((a, b) => (b.bottom - b.top) - (a.bottom - a.top))[0];
      const height = Math.min(352, Math.round(innerHeight * .45));
      if (!band) return null;
      const card = { ...band, top: band.bottom - height };
      const stage = { ...band, bottom: card.top - 12 };
      const targets = layoutTargets(ids, stage);
      if (!targets) return null;
      if (confirmation) targets[0].r = Math.max(targets[0].r, Math.min(64, (stage.bottom - stage.top - 58) / 2.4));
      return { card, targets };
    }

    const split = Math.round(innerWidth * .56);
    const obstacles = this.obstacles();
    const card = { left: split, right: innerWidth - 12, top: 12, bottom: innerHeight - 12 };
    for (const r of obstacles) {
      if (r.left >= card.right || r.right <= card.left) continue;
      if (r.top < innerHeight / 2) card.top = Math.max(card.top, r.bottom + 8);
      else card.bottom = Math.min(card.bottom, r.top - 8);
    }
    if (card.bottom - card.top < 210) return null;
    const stages = bands.map((b) => ({ ...b, right: Math.min(b.right, split - 12) }))
      .filter((b) => b.right - b.left >= 90)
      .sort((a, b) => (b.bottom - b.top) * (b.right - b.left) - (a.bottom - a.top) * (a.right - a.left));
    for (const stage of stages) {
      const targets = layoutTargets(ids, stage);
      if (!targets) continue;
      if (confirmation) targets[0].r = Math.max(targets[0].r, Math.min(64, (stage.bottom - stage.top - 58) / 2.4));
      return { card, targets };
    }
    return null;
  }

  /** SPIKE: the studio's fixed regions inside the page's free area (below the status header, above the footer). */
  private layoutStudio(ids: string[], cardHeight: number) {
    const h = innerHeight;
    let top = 0, bottom = h;
    const rects = this.obstacles(false);
    for (const r of rects) { if (r.bottom <= h * 0.4) top = Math.max(top, r.bottom); else if (r.top >= h * 0.6) bottom = Math.min(bottom, r.top); }
    const L = studioLayout(ids, { left: 0, top, right: innerWidth, bottom }, { width: innerWidth, height: h });
    if (!L.portrait) {
      // Landscape: the console column takes the whole height its own side of the page has free (the status header
      // and the footer's buttons sit on the left), so a phone on its side keeps a whole card.
      let cTop = 8, cBottom = h - 8;
      for (const r of rects) { if (r.right <= L.cell.left || r.left >= L.cell.right) continue; if (r.bottom <= h * 0.4) cTop = Math.max(cTop, r.bottom + 8); else if (r.top >= h * 0.6) cBottom = Math.min(cBottom, r.top - 8); }
      L.cell.top = cTop; L.cell.bottom = cBottom;
      L.header.right = L.cell.left - 8;
    }
    delete this.card.dataset.compact;
    this.targets = L.targets;
    const cellH = L.cell.bottom - L.cell.top, ch = Math.min(cardHeight, cellH);
    const cardTop = L.portrait ? L.cell.top : L.cell.top + (cellH - ch) / 2;
    this.cardRect = { left: L.cell.left, right: L.cell.right, top: cardTop, bottom: cardTop + ch };
    this.bandsCache = [L.cell];
    this.root.dataset.studio = L.arrangement;
    this.studioTitle.style.transform = `translate(${Math.round(L.header.left)}px, ${Math.round(L.header.top)}px)`;
    this.studioTitle.style.width = `${Math.round(L.header.right - L.header.left)}px`;
  }

  private setText(e: HTMLElement, text: string) { if (e.textContent !== text) e.textContent = text; }

  private createRouteLeg() {
    const row = document.createElement('span');
    const label = document.createElement('span');
    const base = document.createElement('span');
    const planet = document.createElement('span');
    row.className = 'picker-route-leg';
    label.className = 'picker-route-label';
    base.className = 'picker-route-base';
    planet.className = 'picker-route-planet';
    row.append(label, base, planet);
    return { row, label, base, planet };
  }

  private renderRouteLeg(leg: (typeof this.routeLegs)[number], label: string, id: string | null, lang: Lang) {
    if (!id) {
      leg.row.hidden = true;
      return;
    }
    leg.row.hidden = false;
    const base = baseById(id);
    const planet = BODIES.find((body) => body.id === base.body)!;
    this.setText(leg.label, `${label}: `);
    this.setText(leg.base, base.name[lang]);
    this.setText(leg.planet, ` · ${planet.name[lang]}`);
  }

  /** Screen 2's compact info: the surface map (or a generated colour), base · body, gravity and day; and the sheet. */
  private renderInfo(on: boolean, f: PickerFrame) {
    this.info.hidden = !on;
    const id = on ? f.selected : null;
    this.detailsBtn.hidden = !id;
    if (!id && !this.sheet.hidden) this.closeDetails(false);
    const w = WORDS[f.lang];
    this.setText(this.detailsBtn, `${w.details} ${this.sheet.hidden ? '▾' : '▴'}`);
    if (!on) return;
    const base = id ? baseById(id) : null;
    const body = base ? BODIES.find((b) => b.id === base.body)! : null;
    const node = body ? this.nodes.find((x) => x.body.id === body.id) : undefined;
    const generated = node?.surface.baseState === 'fallback';
    const kind = mapKind(body?.textures.map, generated);
    const key = `${id}|${f.lang}|${kind}`;
    if (key !== this.infoKey) {
      this.infoKey = key;
      if (base && body) {
        // The 1k colour map the app already ships (the same file the planet uses), or the body's colour if it failed.
        this.thumb.style.backgroundImage = generated ? 'none' : `url("${import.meta.env.BASE_URL}textures/1k/${body.textures.map}")`;
        this.thumb.style.backgroundColor = `#${body.color.toString(16).padStart(6, '0')}`;
        delete this.thumb.dataset.empty;
        this.thumbCaption.textContent = generated ? w.mapGenerated : ({ en: 'Surface illustration · not a photo of the base', ja: '表面のイメージ · 基地の写真ではありません', my: 'မျက်နှာပြင် သရုပ်ဖော်ပုံ · စခန်းဓာတ်ပုံ မဟုတ်ပါ' } as const)[f.lang];
        this.thumb.setAttribute('aria-label', MAP_ALT[f.lang](body.name[f.lang], kind));
        this.thumb.setAttribute('role', 'img');
        const baseSpan = document.createElement('span'); baseSpan.className = 'picker-base-name'; baseSpan.textContent = base.name[f.lang];
        const bodySpan = document.createElement('span'); bodySpan.className = 'picker-planet-name'; bodySpan.textContent = body.name[f.lang];
        this.infoName.replaceChildren(baseSpan, document.createTextNode(' · '), bodySpan);
        const g = f.lang === 'my' ? myDigits(String(body.gravity)) : String(body.gravity);
        const li = (text: string) => { const e = document.createElement('li'); e.textContent = text; return e; };
        this.facts.replaceChildren(li(`${i18n('gravityHere', f.lang)} ${g} m/s²`), li(`${i18n('day', f.lang)} ${body.facts.day[f.lang]}`));
        this.sheetTitle.textContent = this.infoName.textContent;
        const label = document.createElement('b'); label.textContent = w.see;
        this.sheetSee.replaceChildren(label, document.createTextNode(base.blurb[f.lang]));
        // Details' own copy of the image, its caption and the facts (shown there where a short card leaves them out).
        this.sheetThumb.style.backgroundImage = this.thumb.style.backgroundImage;
        this.sheetThumb.style.backgroundColor = this.thumb.style.backgroundColor;
        this.sheetThumb.setAttribute('aria-label', MAP_ALT[f.lang](body.name[f.lang], kind));
        this.sheetCaption.textContent = this.thumbCaption.textContent;
        this.sheetFacts.replaceChildren(...[...this.facts.children].map((e) => e.cloneNode(true)));
      } else {
        // Nothing chosen yet: the same rows, empty (a dashed place for the image).
        this.thumb.style.backgroundImage = 'none';
        this.thumb.style.backgroundColor = '';
        this.thumb.dataset.empty = '';
        this.thumbCaption.textContent = '';
        this.thumb.removeAttribute('aria-label');
        this.thumb.removeAttribute('role');
        this.infoName.textContent = w.none;
        this.facts.replaceChildren();
      }
    }
    const sheetKey = `${f.lang}`;
    if (sheetKey !== this.sheetKey) { this.sheetKey = sheetKey; this.sheetClose.textContent = w.close; this.sheetPaused.textContent = w.paused; }
  }

  /** The control focus goes to on a new screen: never the one whose activation would repeat the step just taken. */
  private focusTarget(screen: PickerScreen, selected: string | null): HTMLElement {
    // Screen 3: Back ("Change destination"), not Launch: a second Enter must not launch.
    if (screen === 'confirm') return this.back;
    // Returning from Change destination (screen 3 -> 2): return keyboard focus to the selected planet.
    if (screen === 'select' && this.prevScreen === 'confirm' && selected) {
      const planetBtn = this.items.get(selected)?.button;
      if (planetBtn && !planetBtn.hidden && !planetBtn.disabled) return planetBtn;
    }
    return this.toggle;
  }

  /** A new screen: the list closes, the card makes a short entrance (none under reduced motion), focus moves in. */
  private screenChange(f: PickerFrame) {
    const first = this.lastScreen === null;
    this.prevScreen = this.lastScreen;
    this.lastGeneration = f.generation;
    this.lastScreen = f.screen;
    this.closeList(false);
    this.closeDetails(false);
    // The confirmation status is spoken once per arrival on screen 3: cleared when leaving, set again on the next.
    this.chip.textContent = '';
    // Visual only: input never waits for it (the card's content is already the new screen's).
    delete this.card.dataset.enter;
    if (!f.reducedMotion && !first) {
      void this.card.offsetWidth; // restart the entrance
      this.card.dataset.enter = '';
    }
    const inside = this.root.contains(document.activeElement) || this.entryBox.contains(document.activeElement);
    if (!first && inside) this.pendingFocus = 'card';
  }

  private renderList(ids: string[], f: PickerFrame) {
    const key = `${ids.join()}|${f.lang}|${f.selected}`;
    if (key === this.listKey) return;
    this.listKey = key;
    const focused = this.list.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.base : null;
    this.list.replaceChildren(...ids.map((id) => {
      const base = baseById(id), body = BODIES.find((b) => b.id === base.body)!;
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.base = id;
      b.textContent = `${f.selected === id ? '✓ ' : ''}${base.name[f.lang]} · ${body.name[f.lang]}`;
      b.setAttribute('aria-pressed', String(f.selected === id));
      // Choosing from the list closes it and returns focus to its button.
      b.addEventListener('click', () => { this.actions.choose(id); this.closeList(true); });
      li.append(b);
      return li;
    }));
    if (focused) this.list.querySelector<HTMLButtonElement>(`button[data-base="${focused}"]`)?.focus();
  }

  private placeCard(listOpen: boolean) {
    const r = this.cardRect;
    if (!r) { this.card.style.transform = 'translate(-50%, 0) translate(50vw, 40vh)'; return; }
    // Anchored at its slot's bottom: taller than planned (a list opened, more lines in a language), the card grows upward
    // inside the band that holds it and then scrolls; it never reaches into what lies below the band.
    const band = this.bandsCache.find((b) => r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1) ?? r;
    const h = this.card.scrollHeight + (this.card.offsetHeight - this.card.clientHeight);
    const top = !this.card.dataset.phone && (listOpen || h > r.bottom - r.top) ? Math.max(band.top, r.bottom - h) : r.top;
    const maxH = `${Math.round(r.bottom - top)}px`;
    const height = this.card.dataset.phone ? maxH : '';
    const place = `${Math.round(r.left)},${Math.round(top)},${Math.round(r.right - r.left)},${maxH},${height}`;
    if (this.card.dataset.place === place) return;
    this.card.dataset.place = place;
    this.card.style.transform = `translate(${Math.round(r.left)}px, ${Math.round(top)}px)`;
    this.card.style.width = `${Math.round(r.right - r.left)}px`;
    this.card.style.maxHeight = maxH;
    this.card.style.height = height;
  }

  private placeOrbs(f: PickerFrame) {
    const camera = f.camera;
    camera.updateMatrixWorld();
    const pxToWorld = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / innerHeight; // at distance 1
    for (const t of this.targets) {
      const it = this.item(t.baseId);
      // The camera-space point DEPTH in front of the camera under the target's screen point (view offsets included).
      v.set((t.x / innerWidth) * 2 - 1, -(t.y / innerHeight) * 2 + 1, 0.5).unproject(camera).applyMatrix4(camera.matrixWorldInverse);
      v.multiplyScalar(DEPTH / -v.z);
      const c = ellipseCompensation(v.x, v.y, v.z);
      const rw = t.r * pxToWorld * DEPTH;
      it.holder.position.copy(v).applyMatrix4(camera.matrixWorld);
      q.setFromUnitVectors(X, axis.set(...c.axis));
      it.holder.quaternion.copy(camera.quaternion).multiply(q);
      const selected = f.selected === t.baseId, hovered = f.hover === t.baseId;
      const confirming = selected && f.confirmProgress > 0 && !f.waitingRelease;
      const dim = this.hitOff && !selected; // SPIKE: Mission Ready's other planets, a backdrop only
      // The emphasis is drawn only: t (the hit target) is the layout's and never scaled.
      it.drawScale = orbDrawScale(selected, it.drawScale, f.dt, f.reducedMotion);
      const ds = it.drawScale;
      it.holder.scale.set(rw * c.scale * ds, rw * ds, rw * ds);
      if (!f.reducedMotion) it.orb.rotation.y += f.dt * 0.25;
      // The body's own texture once the app has it (or its procedural fallback after a failed load); a banded,
      // body-coloured globe while it loads. Tinted like the planet itself (some maps are grayscale).
      const src = it.node.mesh.material as THREE.MeshStandardMaterial;
      const look = orbLook(it.node.surface.baseState);
      const map = look === 'texture' ? src.map : null;
      const sig = `${look}|${map?.uuid ?? ''}|${dim}`;
      if (sig !== it.look) {
        it.look = sig;
        it.material.map = map;
        it.material.color.set(map ? it.node.body.textures.tint ?? 0xffffff : it.node.body.color);
        if (dim) it.material.color.multiplyScalar(0.2);
        it.fallback.value = map ? 0 : 1;
        it.material.needsUpdate = true;
      }
      it.halo.position.copy(it.holder.position);
      it.halo.quaternion.copy(camera.quaternion);
      // Every orb has a faint ring, so its edge reads on any background. Pointing: blue; selected: teal, just outside
      // the enlarged planet; confirming (👍 held): warm orange.
      it.halo.visible = !dim;
      it.haloMaterial.color.copy(confirming ? CONFIRMING : selected ? SELECTED : hovered ? HOVER : IDLE);
      it.haloMaterial.opacity = selected ? 1 : hovered ? 0.55 : 0.35;
      it.halo.scale.setScalar(rw * (selected ? ds : 0.97));
      // SPIKE (studio): the label clears the enlarged planet and its ring (drawn up to 1.14 r × 1.12).
      const labelY = Math.round(this.studioOn ? t.y + t.r * 1.28 + 4 : t.y + t.r + 4);
      const place = `${Math.round(t.x)},${labelY},${Math.round(t.r * 3)}`;
      if (place !== it.place) {
        it.place = place;
        it.button.style.transform = `translate(-50%, 0) translate(${Math.round(t.x)}px, ${labelY}px)`;
        it.button.style.maxWidth = `${Math.round(t.r * 3)}px`;
      }
      const body = BODIES.find((b) => b.id === baseById(t.baseId).body)!;
      const state = selected ? (confirming ? 'confirming' : 'selected') : hovered ? 'hover' : 'idle';
      const progress = selected ? f.confirmProgress : hovered ? f.focusProgress : 0;
      const label = `${selected ? '✓ ' : ''}${body.name[f.lang]}`;
      const w = WORDS[f.lang];
      const sig2 = `${state}|${label}|${Math.round(progress * 20)}|${f.lang}|${look}`;
      if (sig2 !== it.state) {
        it.state = sig2;
        it.button.dataset.state = state;
        it.button.dataset.look = look;
        it.button.textContent = label;
        it.button.setAttribute('aria-pressed', String(selected));
        it.button.setAttribute('aria-label', `${baseById(t.baseId).name[f.lang]} · ${body.name[f.lang]}${selected ? ` · ${w.selected}` : ''}${look === 'fallback' ? ` · ${w.loading}` : ''}`);
        it.button.style.setProperty('--p', String(Math.round(progress * 100)));
      }
    }
  }

  private updateEntry(f: PickerFrame, now: number) {
    const show = f.entry.canOpen && !f.active;
    if (this.entryBox.hidden === show) this.entryBox.hidden = !show;
    if (!show) return;
    // Back from the picker: focus returns to the way in (the Back button it was on is gone).
    if (this.pendingFocus === 'entry') { this.pendingFocus = null; this.entry.focus({ preventScroll: true }); }
    const w = WORDS[f.lang];
    const label = (id: string) => { const b = baseById(id); return `${b.name[f.lang]} · ${BODIES.find((x) => x.id === b.body)!.name[f.lang]}`; };
    this.setText(this.entry, w.open);
    // A destination confirmed in this session: a shortcut to screen 3 (it never launches). One only restored from a
    // saved mission (or set another way): shown as saved, to be confirmed again.
    this.entryJourney.hidden = !f.entry.journey;
    if (f.entry.journey) this.setText(this.entryJourney, `${w.view} ${label(f.entry.journey)}`);
    this.entrySaved.hidden = !f.entry.saved;
    if (f.entry.saved) {
      const text = `${w.saved} ${label(f.entry.saved)}`;
      if (this.entrySaved.dataset.text !== text + w.savedNote) {
        this.entrySaved.dataset.text = text + w.savedNote;
        const strong = document.createElement('strong'); strong.textContent = text;
        const note = document.createElement('span'); note.textContent = w.savedNote;
        this.entrySaved.replaceChildren(strong, note);
      }
    }
    const sig = `${f.lang}|${f.entry.journey}|${f.entry.saved}`;
    if (now - this.measuredAt > MEASURE_MS || this.entryBox.dataset.sig !== sig) {
      this.measuredAt = now;
      this.entryBox.dataset.sig = sig;
      // A place in the HTML layout only, never derived from the 3D scene: the lowest free area of the page that holds
      // the whole group (then the leftmost), at its bottom-left, so it sits just above the HTML panel under it (the base
      // sheet, the footer) and never over the header or the mission card. Scene labels such as the vehicle marker move
      // with the camera; the way in stays where the page's own controls are and does not chase them.
      // At least 200 px wide (the group wraps to fit; the next measurement places it at its wrapped height).
      const m = 12, bh = this.entryBox.offsetHeight || 48, need = Math.min(this.entryBox.scrollWidth || 240, 200);
      const band = this.bands(false).filter((b) => b.bottom - b.top >= bh && b.right - b.left >= need)
        .sort((a, b) => b.bottom - a.bottom || a.left - b.left)[0];
      const x = band ? band.left : m, y = band ? band.bottom - bh : innerHeight - m - bh;
      const maxW = band ? Math.min(360, band.right - band.left) : 360;
      const place = `${Math.round(x)},${Math.round(y)},${Math.round(maxW)}`;
      if (place !== this.entryBox.dataset.place) {
        this.entryBox.dataset.place = place;
        this.entryBox.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        this.entryBox.style.maxWidth = `${Math.round(maxW)}px`;
      }
    }
  }

  /** The way in's box while it is shown (what scene labels must keep clear of); null otherwise. */
  entryZone(): Rect | null {
    if (this.entryBox.hidden || !this.entryBox.isConnected) return null;
    const r = this.entryBox.getBoundingClientRect();
    return r.width > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
  }

  dispose() {
    document.removeEventListener('visibilitychange', this.chargeVisibility);
    this.scene.remove(this.group);
    // Only what the picker made: its materials and its ring. The spheres' geometry and every texture belong to the planets.
    for (const it of this.items.values()) { it.material.dispose(); it.haloMaterial.dispose(); }
    this.ring.dispose();
    this.items.clear();
    this.root.remove();
    this.entryBox.remove();
    document.body.classList.remove('picker-active');
  }
}
