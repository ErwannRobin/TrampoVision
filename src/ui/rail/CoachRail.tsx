import type { ReactNode } from 'react';
import type { AnalysisResult } from '../../analysis/types';
import { t } from '../../i18n';
import type { TwistAnalysis } from '../../pose3d/twist';
import type { SkillAnalysis } from '../../skills/analyzeSkills';
import type { SkillConfig } from '../../skills/config';
import { Button, IconButton, panelId, tabId, Tabs, type TabDef } from '../kit';
import type { Playhead } from '../playhead';
import type { CoachTab } from '../types';
import { ClassificationTab } from './coach/ClassificationTab';
import { DataTab } from './coach/DataTab';
import { MetricsTab } from './coach/MetricsTab';
import { SkillTab } from './coach/SkillTab';
import { TwistTab } from './coach/TwistTab';

export interface CoachRailProps {
  tab: CoachTab;
  onTab: (tab: CoachTab) => void;
  result: AnalysisResult;
  skills: SkillAnalysis;
  /** Selected jump, 0-based (0 when the clip has none). */
  selected: number;
  /** Choose a jump: select it and move the video to its takeoff. */
  onSelect: (jump: number) => void;
  onPlayJump: () => void;
  playhead: Playhead;
  config: SkillConfig;
  onConfig: (config: SkillConfig) => void;
  /** Null only while no analysis exists. */
  twist: TwistAnalysis | null;
  /** The annotator's count of half twists for the selected jump, if any. */
  annotation: number | null;
  onAnnotate: (halfTwists: number | null) => void;
  canAnnotate: boolean;
  /** The Review tab: the shell builds it (labels and dataset), the rail only places it. */
  review: ReactNode;
  /** Things worth double-checking before trusting the numbers (from analysisWarnings). */
  notes: string[];
}

const tabs = (): TabDef<CoachTab>[] => [
  { value: 'skill', label: t('coach.tab.skill') },
  { value: 'metrics', label: t('coach.tab.metrics') },
  { value: 'twist', label: t('coach.tab.twist') },
  { value: 'review', label: t('coach.tab.review') },
  { value: 'classification', label: t('coach.tab.classification') },
  { value: 'data', label: t('coach.tab.data') },
];

const ID = 'coach';

/** The coach's depth: the skill and its evidence, every measurement, the twist, the review of the labels, the classification by Jev, the data quality. */
export function CoachRail({
  tab,
  onTab,
  result,
  skills,
  selected,
  onSelect,
  onPlayJump,
  playhead,
  config,
  onConfig,
  twist,
  annotation,
  onAnnotate,
  canAnnotate,
  review,
  notes,
}: CoachRailProps) {
  const total = skills.jumps.length;
  const k = Math.min(Math.max(selected, 0), Math.max(total - 1, 0));
  const TABS = tabs();

  return (
    <div className="coach">
      <div className="coach__top">
        <header className="coach__head">
          <div className="coach__nav">
            <IconButton
              icon="chevron-left"
              label={t('coach.previous')}
              size="sm"
              disabled={total === 0 || k === 0}
              onClick={() => onSelect(k - 1)}
            />
            <span className="coach__jump num">
              {total > 0 ? t('ins.jumpOf', { n: k + 1, total }) : t('coach.noJumps')}
            </span>
            <IconButton
              icon="chevron-right"
              label={t('coach.next')}
              size="sm"
              disabled={total === 0 || k >= total - 1}
              onClick={() => onSelect(k + 1)}
            />
          </div>
          <Button size="sm" icon="play" disabled={total === 0} onClick={onPlayJump}>
            {t('ins.playJump')}
          </Button>
        </header>
        <Tabs idPrefix={ID} ariaLabel={t('coach.sections')} value={tab} onChange={onTab} tabs={TABS} />
      </div>

      <div
        key={tab}
        className="coach__panel"
        role="tabpanel"
        id={panelId(ID)}
        aria-labelledby={tabId(ID, tab)}
        tabIndex={0}
      >
        <h2 className="sr-only">{TABS.find((t) => t.value === tab)?.label}</h2>
        {tab === 'skill' && <SkillTab skills={skills} selected={k} config={config} onConfig={onConfig} />}
        {tab === 'metrics' && (
          <MetricsTab result={result} skills={skills} selected={k} playhead={playhead} onSelect={onSelect} />
        )}
        {tab === 'twist' && (
          <TwistTab
            result={result}
            twist={twist}
            selected={k}
            playhead={playhead}
            annotation={annotation}
            onAnnotate={onAnnotate}
            canAnnotate={canAnnotate}
          />
        )}
        {tab === 'review' && review}
        {tab === 'classification' && <ClassificationTab skills={skills} selected={k} />}
        {tab === 'data' && <DataTab result={result} notes={notes} playhead={playhead} />}
      </div>
    </div>
  );
}
