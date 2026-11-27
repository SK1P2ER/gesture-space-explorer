/**
 * The short summary a compact place card shows (Item 3): the description's first sentence, cut only at a sentence end
 * (。！？ or the Burmese ။, or . ! ? before a space), never inside one, so no string is shortened mid-thought. A text
 * with one sentence is its own summary. The full text stays one tap away (Details).
 */
export function placeSummary(text: string): string {
  const match = /^[\s\S]*?(?:[。！？။]|[.!?](?=\s|$))/.exec(text.trim());
  return (match ? match[0] : text).trim();
}
