const UI_KEYS = [
  'button', 'a[href]', 'area[href]', 'input', 'textarea', 'select', 'option', 'label', 'summary', 'dialog',
  'audio[controls]', 'video[controls]', '[tabindex]', '[data-scene-shortcuts="off"]',
  ...[
    'button', 'link', 'checkbox', 'radio', 'radiogroup', 'switch', 'combobox', 'textbox', 'searchbox',
    'listbox', 'option', 'slider', 'spinbutton', 'scrollbar', 'menu', 'menubar', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'tab', 'tablist', 'tree', 'treegrid', 'treeitem',
    'grid', 'gridcell', 'toolbar', 'dialog', 'alertdialog',
  ].map((role) => `[role~="${role}"]`),
].join(',');

/** Native controls and custom widgets keep their keys, including across shadow boundaries. */
function uiOwnsKeys(node: EventTarget | null, scene: HTMLElement): boolean {
  for (let current = node instanceof Node ? node : null; current; ) {
    if (current instanceof Element && current !== scene) {
      const control = current.closest(UI_KEYS);
      if ((control && control !== scene) || (current instanceof HTMLElement && current.isContentEditable)) return true;
    }
    current = current.parentNode ?? (current instanceof ShadowRoot ? current.host : null);
  }
  return false;
}

function blockingModalOpen(doc: Document): boolean {
  if (doc.querySelector('dialog:modal')) return true;
  // ARIA dialogs rely on the component to manage focus; suppress scene keys even if focus escaped.
  return [...doc.querySelectorAll('[aria-modal="true"][role~="dialog"], [aria-modal="true"][role~="alertdialog"]')]
    .some((modal) => !modal.closest('[hidden], [inert], [aria-hidden="true"]') && modal.getClientRects().length > 0 &&
      !['hidden', 'collapse'].includes(getComputedStyle(modal).visibility));
}

/** Shift preserves the existing case-insensitive letter shortcuts (Shift+R records).
 * Command modifiers are reserved for the browser, except scene undo/redo mapping.
 */
export function canHandleShortcut(e: KeyboardEvent, scene: HTMLElement,
  options: { allowCommand?: boolean; allowRepeat?: boolean } = {}): boolean {
  if (e.defaultPrevented || e.isComposing || e.altKey ||
    ((e.ctrlKey || e.metaKey) && !options.allowCommand) || (e.repeat && !options.allowRepeat)) return false;
  const doc = scene.ownerDocument;
  if (blockingModalOpen(doc) || e.composedPath().some(node => uiOwnsKeys(node, scene))) return false;
  let focus = doc.activeElement;
  while (focus?.shadowRoot?.activeElement) focus = focus.shadowRoot.activeElement;
  return !uiOwnsKeys(focus, scene);
}
