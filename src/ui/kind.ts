import { BODIES, type Body, type Lang } from '../data/bodies';
import { t, tf } from './i18n';

/** What a body is, for labels and the info card ("moon of Jupiter", "dwarf planet"); empty for the Sun and planets. */
export function kindLabel(body: Body, lang: Lang): string {
  if (body.kind === 'moon') {
    const parent = BODIES.find((b) => b.id === body.parent)!;
    return tf('kind.moon', lang, { parent: parent.name[lang] });
  }
  if (body.kind === 'dwarf') return t('kind.dwarf', lang);
  if (body.kind === 'comet') return t('kind.comet', lang);
  return '';
}

/** "Io · moon of Jupiter", or just the name. */
export function labelText(body: Body, lang: Lang): string {
  const kind = kindLabel(body, lang);
  return kind ? `${body.name[lang]} · ${kind}` : body.name[lang];
}
