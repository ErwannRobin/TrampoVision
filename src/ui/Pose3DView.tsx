import { useEffect, useMemo, useRef, useState } from 'react';
import { sampleIndexAt } from '../analysis/lookup';
import type { AnalysisResult, PoseTrack } from '../analysis/types';
import { drawPose3D, twistSinceTakeoff, type View } from '../pose3d/draw';
import type { TwistAnalysis } from '../pose3d/twist';
import { canExportVideo, exportPose3DVideo, saveBlob } from '../video/exportVideo';
import { Chart, type ChartBand, type ChartMarker } from './Chart';
import { Playhead, usePlayheadTime } from './playhead';
import { pose3dColors, useThemeVersion } from './theme';

const PRESETS: { name: string; view: View; title: string }[] = [
  { name: 'Camera view', view: { yaw: 0, pitch: 0 }, title: 'As the camera sees it: x to the right, y down' },
  {
    name: 'From the side',
    view: { yaw: 90, pitch: 0 },
    title: 'Looking along the camera’s x axis: shows the depth the model estimated',
  },
  { name: 'From above', view: { yaw: 0, pitch: 90 }, title: 'Looking down from above the athlete' },
];

const HEIGHT = 320;

interface Props {
  track: PoseTrack;
  result: AnalysisResult;
  twist: TwistAnalysis;
  selected: number;
  playhead: Playhead;
  /** File name (without extension) for the exported video. */
  baseName?: string;
}

/** The 3D skeleton at the playhead, with the torso, the longitudinal axis and the twist dial. */
export function Pose3DView({ track, result, twist, selected, playhead, baseName = 'trampovision' }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(420);
  const [view, setView] = useState<View>(PRESETS[0].view);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [exporting, setExporting] = useState<number | null>(null);
  const [exportError, setExportError] = useState('');
  const exportAbort = useRef<AbortController | null>(null);
  useEffect(() => () => exportAbort.current?.abort(), []);

  async function onExport() {
    const ctl = new AbortController();
    exportAbort.current = ctl;
    setExportError('');
    setExporting(0);
    try {
      const blob = await exportPose3DVideo({
        track,
        result,
        twist,
        takeoff: cycle?.takeoff ?? null,
        view,
        signal: ctl.signal,
        onProgress: setExporting,
      });
      saveBlob(blob, `${baseName}-3d-pose.mp4`);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError'))
        setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(null);
    }
  }
  const theme = useThemeVersion();
  const time = usePlayheadTime(playhead);
  const i = sampleIndexAt(result.meta, time);
  const cycle = result.jumps.cycles[selected];
  const estimate = twist.jumps[selected];

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(240, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(240, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = HEIGHT * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);
    drawPose3D(ctx, width, HEIGHT, {
      world: track.world?.[i] ?? null,
      twist,
      takeoff: cycle?.takeoff ?? null,
      i,
      view,
      colors: pose3dColors(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, twist, i, view, width, theme, cycle]);

  const rel = twistSinceTakeoff(twist, cycle?.takeoff ?? null, i);
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ yaw: v.yaw + dx * 0.5, pitch: Math.max(-90, Math.min(90, v.pitch + dy * 0.5)) }));
  };

  return (
    <div className="pose3d">
      <div className="pose3d-bar">
        <strong>3D pose</strong> <span className="badge weak">experimental</span>
        <span className="spacer" />
        {PRESETS.map((p) => (
          <button key={p.name} className="tiny" title={p.title} onClick={() => setView(p.view)}>
            {p.name}
          </button>
        ))}
        {canExportVideo() &&
          (exporting !== null ? (
            <>
              <progress value={exporting} max={1} />
              <button className="tiny" onClick={() => exportAbort.current?.abort()}>
                Cancel {Math.round(exporting * 100)}%
              </button>
            </>
          ) : (
            <button
              className="tiny"
              title="Video of the 3D skeleton for the whole clip, from the viewpoint selected here (no footage)"
              onClick={() => void onExport()}
            >
              ⬇ Download 3D video
            </button>
          ))}
      </div>
      {exportError && <p className="notice">{exportError}</p>}
      <div ref={wrapRef} className="pose3d-body" style={{ height: HEIGHT }}>
        <canvas
          ref={canvasRef}
          style={{ width, height: HEIGHT, cursor: 'grab', touchAction: 'none' }}
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={move}
          onPointerUp={() => (drag.current = null)}
          aria-label="3D skeleton. Drag to rotate."
        />
        {estimate && estimate.available && !estimate.reliable && (
          <div className="pose3d-flag">twist not reliable for this jump</div>
        )}
      </div>
      <p className="muted small">
        Blue = left, orange = right. Dashed amber = the longitudinal axis (hips to shoulders). Black dot = chest
        direction. The ring is the plane perpendicular to the axis: grey = where the shoulder line pointed at takeoff,
        amber arc = the twist since then
        {rel !== null ? ` (now ${rel >= 0 ? '+' : '−'}${Math.abs(Math.round(rel))}°)` : ''}. Drag to rotate.
      </p>
    </div>
  );
}

interface SectionProps extends Props {
  markers: ChartMarker[];
  bands: ChartBand[];
}

/** 3D view and the twist curves of the whole clip, with the events of the jumps marked. */
export function Pose3DSection({ track, result, twist, selected, playhead, markers, bands, baseName }: SectionProps) {
  const f = twist.frames;
  const guides = useMemo(() => {
    if (!f) return [];
    const v = Array.from(f.angle).filter(Number.isFinite);
    if (!v.length) return [];
    const lo = Math.ceil(Math.min(...v) / 180);
    const hi = Math.floor(Math.max(...v) / 180);
    const out: { value: number; label?: string }[] = [];
    for (let k = lo; k <= hi && out.length < 30; k++)
      out.push({
        value: k * 180,
        label: k === 0 ? undefined : `${Math.abs(k) / 2} twist${Math.abs(k) === 2 ? '' : 's'}`,
      });
    return out;
  }, [f]);
  return (
    <section className="panel pose3d-section">
      <Pose3DView
        track={track}
        result={result}
        twist={twist}
        selected={selected}
        playhead={playhead}
        baseName={baseName}
      />
      {f && (
        <div className="jumpcharts">
          <Chart
            title="Twist angle (accumulated)"
            unit="°, + = counter-clockwise seen from above the head"
            time={result.time}
            playhead={playhead}
            confidence={f.torso.visibility}
            decimals={0}
            zeroLine
            minSpan={200}
            guides={guides}
            markers={markers}
            bands={bands}
            series={[
              { label: 'Full 3D axis', values: f.angle, color: '--series-1' },
              { label: 'Axis in the image plane', values: f.anglePlane, color: '--series-2' },
            ]}
            height={150}
          />
          <Chart
            title="Twist angular velocity"
            unit="°/s"
            time={result.time}
            playhead={playhead}
            confidence={f.torso.visibility}
            decimals={0}
            zeroLine
            minSpan={200}
            markers={markers}
            bands={bands}
            series={[{ label: 'ω twist', values: f.angularVelocity, color: '--series-1' }]}
            height={150}
          />
          <Chart
            title="Trunk axis out of the image plane"
            unit="°: 0 = in the plane, large = pointing at the camera"
            time={result.time}
            playhead={playhead}
            decimals={0}
            minSpan={30}
            markers={markers}
            bands={bands}
            series={[{ label: 'Tilt', values: f.torso.axisTiltDeg, color: '--series-1' }]}
            height={150}
          />
          <Chart
            title="Shoulder width in 3D"
            unit="m: a rigid body keeps it constant; changes are depth error"
            time={result.time}
            playhead={playhead}
            decimals={2}
            minSpan={0.1}
            markers={markers}
            bands={bands}
            series={[
              { label: 'Shoulders', values: f.torso.shoulderWidthM, color: '--series-1' },
              { label: 'Hips', values: f.torso.hipWidthM, color: '--series-2' },
            ]}
            height={150}
          />
        </div>
      )}
      <p className="hint muted">
        Shaded = a jump. The faded parts of a curve are frames where the model was not sure of the shoulders and hips.
      </p>
    </section>
  );
}
