import { formatNumber, t, tp } from '../i18n/core';
import { elementName } from '../skills/fig/elements';
import type { Session } from './session';

/** A difficulty value: one decimal. */
export const difficultyText = (v: number): string => formatNumber(v, 1);

/** A deduction as it is written on a score sheet: "−0.2", or "0.0" when there is none; an en dash when the skill was not judged. */
export const deductionText = (v: number | null): string =>
  v === null ? '–' : v === 0 ? formatNumber(0, 1) : `−${formatNumber(v, 1)}`;

/** The set as plain text, to paste into a message: what each skill was, its difficulty and execution, and what to work on next. */
export function summaryText(session: Session, title = 'TrampoVision'): string {
  const s = session.summary;
  const skills = session.jumps.filter((j) => j.isSkill && !j.pending && j.element);
  const count = tp('count.skills', s.skills);
  const lines: string[] = [
    s.pending > 0
      ? t('summary.headerPending', { title, skills: count, pending: s.pending })
      : t('summary.header', { title, skills: count }),
  ];
  lines.push(
    [
      t('summary.difficulty', { value: difficultyText(s.difficulty) }),
      s.execution === null ? null : t('summary.execution', { value: formatNumber(s.execution, 1) }),
      s.flightS > 0 ? t('summary.air', { value: formatNumber(s.flightS, 1) }) : null,
    ]
      .filter(Boolean)
      .join(t('list.separator')),
  );
  if (skills.length) lines.push('');
  for (const j of skills) {
    const execution =
      j.deduction === null
        ? ''
        : t('summary.executionOne', {
            value: j.deduction === 0 ? formatNumber(0, 1) : `-${formatNumber(j.deduction, 1)}`,
          });
    lines.push(
      t('summary.line', {
        n: j.number,
        name: elementName(j.element!),
        guess: j.source === 'auto' && j.certainty === 'tentative' ? t('summary.guess') : '',
        difficulty: difficultyText(j.counted),
        repeat: j.repeated ? t('summary.repeat') : '',
        execution,
      }),
    );
  }
  if (s.focus.length) {
    lines.push('', t('summary.next'));
    for (const f of s.focus) lines.push(t('summary.focusItem', { title: f.title, summary: f.summary, text: f.text }));
  }
  return lines.join('\n');
}
