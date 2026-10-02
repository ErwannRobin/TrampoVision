import { t } from '../../../i18n';
import { TIER_TEXT, type JumpHeadline } from '../../insights';
import { Button, ConfidenceMeter, cx } from '../../kit';
import { useRangeButton } from '../../playhead';
import { Fade } from './Fade';
import { headlineSize } from './layout';

interface Props {
  headline: JumpHeadline;
  total: number;
  onPlayJump: () => void;
}

/** The answer: which jump this is, what the skill is called, how sure the classifier is, and why it says so. */
export function Answer({ headline: h, total, onPlayJump }: Props) {
  // Best guesses and unclassified jumps are not an answer: the name is set quieter so it does not read as one.
  const named = h.tier === 'high' || h.tier === 'medium';
  // What the confidence bar is. Said in a tooltip and to screen readers instead of a percentage that looks precise.
  const scoreNote = t('ins.scoreNote');
  const play = useRangeButton('answer', onPlayJump);
  return (
    <section className="ins-answer">
      <div className="ins-answer__top">
        <p className="ins-count">{t('ins.jumpOf', { n: h.number, total })}</p>
        <Button
          size="sm"
          icon={play.playing ? 'pause' : 'play'}
          title={play.playing ? t('transport.pause') : t('ins.playJumpTitle')}
          onClick={play.press}
        >
          {play.playing ? t('transport.pause') : t('ins.playJump')}
        </Button>
      </div>
      <Fade on={h.index}>
        <h2
          className={cx(
            'ins-headline t-brand',
            `ins-headline--${headlineSize(h.label)}`,
            !named && 'ins-headline--open',
          )}
        >
          {h.label}
        </h2>
        <div className="ins-conf" title={scoreNote}>
          <div className="ins-conf__meter">
            <ConfidenceMeter value={h.confidence} tier={h.tier} label={t('ins.confidence')} />
          </div>
          <span className="ins-conf__text">{TIER_TEXT[h.tier]}</span>
          <span className="sr-only">. {scoreNote}.</span>
        </div>
        <p className="ins-summary">{h.summary}</p>
      </Fade>
    </section>
  );
}
