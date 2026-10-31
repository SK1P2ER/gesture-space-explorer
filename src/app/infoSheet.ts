import type { IntentBus } from '../intents';
import { BottomSheet } from '../ui/sheet';

/**
 * Phones: the info card is a bottom sheet. Collapsed, the time bar sits on top of it
 * (still usable); expanded, the time bar and footer step aside. (The camera keeps the
 * focused body clear of it, and of every other panel: ui/chrome.ts.)
 */
export function setupInfoSheet(bus: IntentBus) {
  const infoCard = document.querySelector<HTMLElement>('#info')!;
  const narrow = matchMedia('(max-width: 640px)');
  new BottomSheet(infoCard, () => narrow.matches, () => bus.emit({ type: 'dismiss', what: 'info' }));
  const updateSheet = () => {
    const open = narrow.matches && !infoCard.hidden;
    const collapsed = infoCard.classList.contains('collapsed');
    document.body.classList.toggle('sheet-expanded', open && !collapsed);
    document.body.classList.toggle('sheet-collapsed', open && collapsed);
    document.documentElement.style.setProperty('--sheet-h', `${infoCard.getBoundingClientRect().height}px`);
  };
  new ResizeObserver(updateSheet).observe(infoCard);
  narrow.addEventListener('change', updateSheet);
  addEventListener('resize', updateSheet);
}
