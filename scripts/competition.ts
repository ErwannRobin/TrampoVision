/**
 * The synthetic check of fast skills: double and triple somersaults through a pose model that fails on a fast athlete
 * (src/skills/competitionEval.ts). No file needed: the athletes are made up, with known answers.
 *   make eval-competition                      400 jumps per row, at 30 and 25 frames a second
 *   make eval-competition ROUTINES=20 FPS=30   100 jumps per row, at 30 frames a second
 *   make eval-competition PLAIN=1              each row again with the orientation taken as the model gives it and no frame put right
 * It says what the analysis does with a pose model that fails like the simulated one, not how a real model fails on real footage.
 */
import {
  CLEAN,
  HARD,
  MILD,
  evaluateCompetition,
  formatBySomersaults,
  formatCompetition,
  formatPose,
} from '../src/skills/competitionEval';

const args = process.argv.slice(2);
const value = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const routines = Math.max(1, Math.round(Number(value('--routines', '80'))));
const rates = value('--fps', '30,25')
  .split(',')
  .map(Number)
  .filter((f) => f > 0);
const plain = args.includes('--plain');

for (const fps of rates) {
  console.log(`\n${fps} frames a second, ${routines * 5} jumps per row`);
  for (const failure of [CLEAN, MILD, HARD]) {
    const rows = [{ label: '', analysis: {} }];
    if (plain && failure !== CLEAN) rows.push({ label: ' (no repair)', analysis: { repairOrientation: false } });
    for (const row of rows) {
      const s = evaluateCompetition(failure, { routines, fps, analysis: row.analysis });
      console.log(`  ${formatCompetition(s).replace(':', `${row.label}:`)}`);
      console.log(`    by somersaults: ${formatBySomersaults(s)}`);
      console.log(`    pose: ${formatPose(s)}`);
    }
  }
}
