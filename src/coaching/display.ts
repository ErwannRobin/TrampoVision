import { t } from '../i18n/core';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { elementName } from '../skills/fig/elements';
import { legacyId } from '../skills/hierarchical';
import type { LiveJump, Session } from './session';

/** The name shown for a jump a person says is none of the elements of the list. */
export const otherLabel = (): string => t('live.other');

/** The name of a jump as the live view says it: the coach's label, else the guess (with a question mark when it is a tentative one). */
export function jumpName(j: LiveJump): string {
  if (j.other) return otherLabel();
  if (!j.element) return j.complete ? t('live.notNamed') : t('live.cutOff');
  const name = elementName(j.element);
  return j.source === 'auto' && j.certainty === 'tentative' ? `${name}?` : name;
}

/**
 * The skills as people see them on the video and on the timeline: each jump carries the name the session settled on (the coach's
 * label, else the classifier's guess) instead of the raw prediction. The raw analysis stays as it is for the records, the exports
 * and the coach's evidence tab; this copy only replaces the fields the labels are drawn from.
 */
export function withCalls(skills: SkillAnalysis, session: Session): SkillAnalysis {
  return {
    ...skills,
    jumps: skills.jumps.map((j, k) => {
      const live = session.jumps[k];
      const p = j.prediction;
      if (!live) return j;
      if (live.other)
        return {
          ...j,
          prediction: {
            ...p,
            skill: 'unclassified',
            label: otherLabel(),
            confidence: 0,
            certainty: undefined,
            elementId: undefined,
          },
        };
      if (!live.element) return j;
      const e = live.element;
      return {
        ...j,
        prediction: {
          ...p,
          skill: legacyId(e),
          label: elementName(e),
          elementId: e.id,
          movement: { direction: e.direction, somersaults: e.somersaults, twists: e.twists, position: e.position },
          confidence: live.confidence,
          certainty: live.certainty ?? p.certainty,
        },
      };
    }),
  };
}
