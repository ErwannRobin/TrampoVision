import { t } from '../../../i18n';
import { elementById, elementName } from '../../../skills/fig/elements';
import type { JevResult, QuestionId } from '../../../skills/jev/classify';
import { pct } from '../../format';

/**
 * The classifier and Jev side by side for one jump, as plain rows. Nothing here asks Jev anything: it words the answer of a
 * run that has already happened, so the comparison is testable without a network.
 */

export const PARTS: QuestionId[] = ['somersaults', 'twists', 'direction', 'position'];

/** What an element is made of, by part, in the words of the questions Jev answers ('none' for the direction of a jump with no somersault). */
export function partsOfElement(elementId: string | null | undefined): Record<QuestionId, string> | null {
  const e = elementId ? elementById(elementId) : undefined;
  if (!e) return null;
  return {
    somersaults: String(e.somersaults),
    twists: String(e.twists),
    direction: e.somersaults ? (e.direction ?? 'back') : 'none',
    position: e.position,
  };
}

export interface CompareLine {
  key: string;
  label: string;
  local: string;
  jev: string;
  /** Both said the same thing. */
  same: boolean;
}

const DASH = '–';

const nameOf = (id: string | null): string => {
  const e = id ? elementById(id) : undefined;
  return e ? elementName(e) : DASH;
};

/** The answers of the two classifiers for each of the four parts, then their top five by rank. */
export function compareLines(r: JevResult): { parts: CompareLine[]; top: CompareLine[]; agree: boolean | null } {
  const localId = r.local.skill !== 'unclassified' ? (r.local.elementId ?? null) : null;
  const local = partsOfElement(localId);
  const jev = r.answers;
  const parts = PARTS.map<CompareLine>((q) => {
    const l = local ? local[q] : null;
    const j = jev ? jev[q].choice : null;
    const jp = jev && j !== null ? (jev[q].probabilities[j] ?? 0) : null;
    return {
      key: q,
      label: t(`coach.jev.part.${q}`),
      local: l ?? DASH,
      jev: j === null ? DASH : `${j} ${pct(jp)}`,
      same: l !== null && j !== null && l === j,
    };
  });
  const localTop = (r.local.candidates ?? []).slice(0, 5);
  const top = Array.from({ length: 5 }, (_, i) => {
    const lc = localTop[i];
    const jc = r.candidates[i];
    return {
      key: `top${i}`,
      label: String(i + 1),
      local: lc ? `${nameOf(lc.elementId)} ${pct(lc.score ?? lc.posterior)}` : DASH,
      jev: jc ? `${nameOf(jc.elementId)} ${pct(jc.mass)}` : DASH,
      same: !!lc && !!jc && lc.elementId === jc.elementId,
    };
  });
  const agree = r.status === 'ok' ? localId !== null && localId === r.jevElementId : null;
  return { parts, top, agree };
}
