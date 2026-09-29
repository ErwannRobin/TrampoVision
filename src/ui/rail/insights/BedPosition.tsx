import { Button, cx } from '../../kit';
import { bedMarkers, bedSentenceParts, bedUnavailable, type BedEvent, type BedPositions } from './bed';
import { Fade } from './Fade';

// The bar is drawn in a 60px band: the landing glyph above it pointing down, the takeoff glyph below it pointing up,
// the apex on it. The events therefore never cover each other, wherever on the bed they are.
const BAR_Y = 14;
const BAR_H = 12;
const GAP = 3;
const TRI = 4.5;
const GLYPH_Y: Record<BedEvent, number> = {
  landing: BAR_Y - GAP - TRI,
  apex: BAR_Y + BAR_H / 2,
  takeoff: BAR_Y + BAR_H + GAP + TRI,
};
const HEIGHT = 60;
const LABEL_Y = 54;

/** One event's mark around the origin: an up triangle for takeoff, a dot for the apex, a down triangle for landing. */
function GlyphShape({ event, beyond }: { event: BedEvent; beyond?: boolean }) {
  const className = cx('ins-glyph', `ins-glyph--${event}`, beyond && 'ins-glyph--beyond');
  if (event === 'apex') return <circle className={className} r={5.5} />;
  const points = event === 'takeoff' ? `-5,${TRI} 5,${TRI} 0,${-TRI}` : `-5,${-TRI} 5,${-TRI} 0,${TRI}`;
  return <polygon className={className} points={points} />;
}

interface Props {
  jump: number;
  bed: BedPositions | null;
  /** The jump has both a takeoff and a landing inside the clip. */
  complete: boolean;
  calibrated: boolean;
  calibrationError: string | null;
  onOpenSetup: () => void;
}

/**
 * Where the jump takes off, peaks and lands on the bed. The geometry is in percentages of the bar, so it needs no
 * measuring and never distorts. Without a marked bed, or without a position for this jump, a quiet line says why.
 */
export function BedPosition({ jump, bed, complete, calibrated, calibrationError, onOpenSetup }: Props) {
  const markers = bed ? bedMarkers(bed) : [];
  if (!bed || markers.length === 0) {
    const { text, setup } = bedUnavailable({ calibrated, calibrationError, complete });
    return (
      <section className="ins-section ins-quiet-row">
        <p className="ins-quiet">{text}</p>
        {setup && (
          <Button size="sm" onClick={onOpenSetup}>
            Open settings
          </Button>
        )}
      </section>
    );
  }

  return (
    <section className="ins-section">
      <h3 className="ins-h">Landing on the bed</h3>
      <Fade on={jump}>
        <div className="ins-bed">
          <svg className="ins-bed__svg" width="100%" height={HEIGHT} aria-hidden="true">
            <rect className="ins-bed__bar" x="0" y={BAR_Y} width="100%" height={BAR_H} rx={BAR_H / 2} />
            <line className="ins-bed__tick" x1="50%" x2="50%" y1={BAR_Y - GAP} y2={BAR_Y + BAR_H + GAP} />
            {markers.map((m) => (
              <svg key={m.event} x={`${m.t * 100}%`} y={GLYPH_Y[m.event]} overflow="visible">
                <GlyphShape event={m.event} beyond={m.beyond !== null} />
              </svg>
            ))}
            <text className="ins-bed__label" x="0" y={LABEL_Y} textAnchor="start">
              Left edge
            </text>
            <text className="ins-bed__label" x="50%" y={LABEL_Y} textAnchor="middle">
              Center
            </text>
            <text className="ins-bed__label" x="100%" y={LABEL_Y} textAnchor="end">
              Right edge
            </text>
          </svg>
        </div>
        <p className="ins-bed__sentence">
          {bedSentenceParts(bed).map((part, i) =>
            part.event ? (
              <span key={i} className="ins-ev">
                <svg className="ins-ev__glyph" width={12} height={12} viewBox="-7 -7 14 14" aria-hidden="true">
                  <GlyphShape event={part.event} />
                </svg>
                {part.text}
              </span>
            ) : (
              part.text
            ),
          )}
        </p>
      </Fade>
    </section>
  );
}
