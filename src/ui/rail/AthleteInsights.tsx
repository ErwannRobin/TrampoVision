import { useMemo } from 'react';
import type { AnalysisResult } from '../../analysis/types';
import type { SkillAnalysis } from '../../skills/analyzeSkills';
import { compareJumps, jumpHeadline } from '../insights';
import { Button } from '../kit';
import { Answer } from './insights/Answer';
import { BedPosition } from './insights/BedPosition';
import { EmptyState } from './insights/EmptyState';
import { jumpFigures } from './insights/figures';
import { Figures } from './insights/FigureGrid';
import { JumpList } from './insights/JumpList';
import { WorthKnowing } from './insights/WorthKnowing';

export interface AthleteInsightsProps {
  result: AnalysisResult;
  skills: SkillAnalysis;
  /** Selected jump, 0-based (0 when the clip has none). */
  selected: number;
  /** Choose a jump: select it and move the video to its takeoff. */
  onSelect: (jump: number) => void;
  onPlayJump: () => void;
  /** Open the settings (for example to mark the trampoline). */
  onOpenSetup: () => void;
  /** Switch the interface to the coach's view. */
  onShowCoach: () => void;
  /** Things worth double-checking before trusting the numbers (from analysisWarnings). */
  notes: string[];
}

/**
 * The plain answers for the selected jump: what it was, four figures, where it landed on the bed, what is worth
 * double-checking, and every jump of the clip. Every value is read through `jumpHeadline` and `compareJumps`, so the
 * coach's view can never disagree with it.
 */
export function AthleteInsights({
  result,
  skills,
  selected,
  onSelect,
  onPlayJump,
  onOpenSetup,
  onShowCoach,
  notes,
}: AthleteInsightsProps) {
  const total = skills.jumps.length;
  const index = Math.min(Math.max(selected, 0), Math.max(total - 1, 0));
  const headline = useMemo(() => jumpHeadline(skills, result, index), [skills, result, index]);
  const rows = useMemo(() => compareJumps(skills), [skills]);

  return (
    <div className="ins">
      {headline ? (
        <>
          <Answer headline={headline} total={total} onPlayJump={onPlayJump} />
          <Figures jump={headline.index} figures={jumpFigures(headline)} />
          <BedPosition
            jump={headline.index}
            bed={headline.bed}
            complete={headline.complete}
            calibrated={result.meta.calibrated}
            calibrationError={result.meta.calibrationError}
            onOpenSetup={onOpenSetup}
          />
          <WorthKnowing jump={headline.index} limitations={headline.limitations} notes={notes} />
        </>
      ) : (
        <EmptyState notes={notes} onOpenSetup={onOpenSetup} />
      )}
      {rows.length > 1 && <JumpList rows={rows} selected={index} onSelect={onSelect} />}
      <section className="ins-section">
        <Button variant="ghost" size="sm" className="ins-coach" onClick={onShowCoach}>
          Show technical details
        </Button>
        <p className="ins-quiet">
          The coach's view adds the evidence behind each skill, every measurement, the twist analysis and all the
          charts.
        </p>
      </section>
    </div>
  );
}
