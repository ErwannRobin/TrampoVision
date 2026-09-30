import type { Session } from './session';

/** A difficulty value: one decimal. */
export const difficultyText = (v: number): string => v.toFixed(1);

/** A deduction as it is written on a score sheet: "−0.2", or "0.0" when there is none; an en dash when the skill was not judged. */
export const deductionText = (v: number | null): string => (v === null ? '–' : v === 0 ? '0.0' : `−${v.toFixed(1)}`);

/** The set as plain text, to paste into a message: what each skill was, its difficulty and execution, and what to work on next. */
export function summaryText(session: Session, title = 'TrampoVision'): string {
  const s = session.summary;
  const skills = session.jumps.filter((j) => j.isSkill && !j.pending && j.element);
  const lines: string[] = [
    `${title}: ${s.skills} ${s.skills === 1 ? 'skill' : 'skills'}${s.pending > 0 ? `, ${s.pending} to check` : ''}`,
  ];
  lines.push(
    [
      `Difficulty ${difficultyText(s.difficulty)}`,
      s.execution === null ? null : `execution about ${s.execution.toFixed(1)} out of 10`,
      s.flightS > 0 ? `${s.flightS.toFixed(1)} s in the air` : null,
    ]
      .filter(Boolean)
      .join(', '),
  );
  if (skills.length) lines.push('');
  for (const j of skills) {
    const d = j.deduction === null ? '' : `, execution ${j.deduction === 0 ? '0.0' : `-${j.deduction.toFixed(1)}`}`;
    lines.push(
      `${j.number}. ${j.element!.name}${j.source === 'auto' && j.certainty === 'tentative' ? ' (guess)' : ''}: difficulty ${difficultyText(j.counted)}${j.repeated ? ' (repeat)' : ''}${d}`,
    );
  }
  if (s.focus.length) {
    lines.push('', 'Work on next:');
    for (const f of s.focus) lines.push(`- ${f.title} (${f.summary}): ${f.text}`);
  }
  return lines.join('\n');
}
