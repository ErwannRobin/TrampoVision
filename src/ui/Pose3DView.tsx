import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { sampleIndexAt } from '../analysis/lookup';
import type { AnalysisResult, PoseTrack } from '../analysis/types';
import { drawPose3D, twistSinceTakeoff, type View } from '../pose3d/draw';
import type { TwistAnalysis } from '../pose3d/twist';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { canExportVideo, exportPose3DVideo, exportSideBySideVideo, saveBlob } from '../video/exportVideo';
import type { CalibrationDraw, OverlayOptions } from '../video/overlay';
import { formatPercent, t, useLocale } from '../i18n';
import { useElementSize } from './hooks';
import { Badge, Button, IconButton, Segmented } from './kit';
import { usePlayheadTime, type Playhead } from './playhead';
import { pose3dColors, useThemeVersion } from './theme';

const presets = (): { value: string; label: string; view: View; title: string }[] => [
  { value: 'camera', label: t('p3d.camera'), view: { yaw: 0, pitch: 0 }, title: t('p3d.cameraTitle') },
  { value: 'side', label: t('p3d.side'), view: { yaw: 90, pitch: 0 }, title: t('p3d.sideTitle') },
  { value: 'above', label: t('p3d.above'), view: { yaw: 0, pitch: 90 }, title: t('p3d.aboveTitle') },
];

/** The height of the view when it is not asked to fill its parent. */
const FIXED_HEIGHT = 320;

/** What the side-by-side export needs to paint the annotated video next to the 3D view. */
export interface SideBySideSource {
  url: string;
  fps: number;
  skills: SkillAnalysis | null;
  overlay: OverlayOptions;
  calibration: CalibrationDraw | null;
}

interface Props {
  track: PoseTrack;
  result: AnalysisResult;
  twist: TwistAnalysis;
  selected: number;
  playhead: Playhead;
  /** File name (without extension) for the exported video. */
  baseName?: string;
  /** Video and its annotations; without it there is no side-by-side export. */
  sideBySide?: SideBySideSource | null;
  /** Fill the space of the parent (the stage pane) instead of the fixed height. */
  fill?: boolean;
}

/**
 * The 3D skeleton at the playhead, with the torso, the longitudinal axis and the twist dial. Drag to turn it. It is an
 * experimental reading: the classifier never uses it.
 */
export function Pose3DView({
  track,
  result,
  twist,
  selected,
  playhead,
  baseName = 'trampovision',
  sideBySide = null,
  fill = false,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useElementSize(wrapRef);
  const width = Math.max(1, Math.round(size.width));
  const height = fill ? Math.max(1, Math.round(size.height)) : FIXED_HEIGHT;
  useLocale();
  const [preset, setPreset] = useState('camera');
  const [view, setView] = useState<View>({ yaw: 0, pitch: 0 });
  const [legend, setLegend] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [exporting, setExporting] = useState<number | null>(null);
  const [exportKind, setExportKind] = useState<'3d' | 'side'>('3d');
  const [exportError, setExportError] = useState('');
  const exportAbort = useRef<AbortController | null>(null);
  useEffect(() => () => exportAbort.current?.abort(), []);
  const theme = useThemeVersion();
  const time = usePlayheadTime(playhead);
  const i = sampleIndexAt(result.meta, time);
  const cycle = result.jumps.cycles[selected];
  const estimate = twist.jumps[selected];

  async function onExport(kind: '3d' | 'side') {
    const ctl = new AbortController();
    exportAbort.current = ctl;
    setExportError('');
    setExportKind(kind);
    setExporting(0);
    try {
      const common = {
        track,
        result,
        twist,
        takeoff: cycle?.takeoff ?? null,
        view,
        signal: ctl.signal,
        onProgress: setExporting,
      };
      if (kind === 'side' && sideBySide) {
        saveBlob(await exportSideBySideVideo({ ...common, ...sideBySide }), `${baseName}-side-by-side.mp4`);
      } else {
        saveBlob(await exportPose3DVideo(common), `${baseName}-3d-pose.mp4`);
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError'))
        setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(null);
    }
  }

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || size.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawPose3D(ctx, width, height, {
      world: track.world?.[i] ?? null,
      twist,
      takeoff: cycle?.takeoff ?? null,
      i,
      view,
      colors: pose3dColors(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, twist, i, view, width, height, size.width, theme, cycle]);

  const rel = twistSinceTakeoff(twist, cycle?.takeoff ?? null, i);
  const move = (e: PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setPreset('');
    setView((v) => ({ yaw: v.yaw + dx * 0.5, pitch: Math.max(-90, Math.min(90, v.pitch + dy * 0.5)) }));
  };
  const choose = (value: string) => {
    const p = presets().find((x) => x.value === value);
    if (!p) return;
    setPreset(value);
    setView(p.view);
  };

  return (
    <div className={fill ? 'p3d' : 'p3d p3d--fixed'} ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="p3d__canvas"
        style={{ width, height }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        aria-label={t('p3d.canvas')}
      />

      <div className="p3d__top">
        <Badge tone="outline">{t('twist.experimental')}</Badge>
        {estimate && estimate.available && !estimate.reliable && <Badge tone="warn">{t('p3d.notReliable')}</Badge>}
        <IconButton
          icon="info"
          label={t('p3d.howToRead')}
          size="sm"
          pressed={legend}
          onClick={() => setLegend((v) => !v)}
        />
      </div>
      {legend && (
        <p className="p3d__legend" role="note">
          {rel !== null
            ? t('p3d.legendNow', { now: `${rel >= 0 ? '+' : '−'}${Math.abs(Math.round(rel))}` })
            : t('p3d.legend')}
        </p>
      )}

      <div className="p3d__bottom">
        <Segmented
          ariaLabel={t('p3d.pointOfView')}
          size="sm"
          value={preset}
          onChange={choose}
          options={presets().map(({ value, label, title }) => ({ value, label, title }))}
        />
        {canExportVideo() && (
          <div className="p3d__exports">
            {exporting !== null ? (
              <Button size="sm" onClick={() => exportAbort.current?.abort()}>
                {t(exportKind === 'side' ? 'p3d.cancelSide' : 'p3d.cancel3d', {
                  percent: formatPercent(exporting),
                })}
              </Button>
            ) : (
              <>
                <IconButton
                  icon="download"
                  label={t('p3d.download3d')}
                  size="sm"
                  variant="solid"
                  onClick={() => void onExport('3d')}
                />
                {sideBySide && (
                  <IconButton
                    icon="split"
                    label={t('p3d.downloadSide')}
                    size="sm"
                    variant="solid"
                    onClick={() => void onExport('side')}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>
      {exportError && <p className="p3d__error">{exportError}</p>}
    </div>
  );
}
