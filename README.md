# TrampoVision (MVP)

Browser-only prototype that extracts a clean skeleton, center of mass (COM), trajectory, angles and
rotation from a trampoline video. **No backend, no database, the video never leaves the browser.**

It deliberately does **not** recognize skills, score routines or coach. The goal is to check that the
video → skeleton → COM pipeline is reliable on real trampoline footage.

## Run

```bash
npm install          # also copies the MediaPipe WASM runtime + downloads the pose models into public/
npm run dev          # http://localhost:5173
npm test             # unit tests for the math (COM, angles, smoothing, rotation)
npm run build        # production build (adds a strict Content-Security-Policy)
```

`npm install` needs internet once (models come from Google's public MediaPipe bucket). Afterwards the app
works offline. If the download failed, run `npm run fetch-assets`.

## Use

1. Choose an MP4/MOV. The frame rate is measured automatically (editable).
2. Pick a model (Full is a good default; Heavy is the most accurate/slowest) and enter the athlete height.
3. **Analyze video**. It seeks frame by frame, so the result does not depend on machine speed.
4. Play, slow down (0.1×–2×), step frame by frame (`←` `→`, `Shift` = 10 frames, `Space` = play/pause), or click/drag
   on any chart to seek. Overlay: skeleton, COM marker, COM trajectory.
5. Export per-frame metrics (CSV) or everything including smoothed landmarks (JSON).

## Pipeline and code map

```
video file ──► extractPoseTrack ──► PoseTrack ──► computeAnalysis ──► AnalysisResult ──► UI
 (seek+detect)   src/analysis/        raw px         src/analysis/       arrays per       src/ui/
                 extractPoseTrack.ts  landmarks      computeAnalysis.ts  sample           src/video/
```

| Module | Role |
| --- | --- |
| `src/pose/types.ts` | `PoseEstimator` interface. Any backend that returns the 33-point BlazePose topology can be plugged in. |
| `src/pose/MediaPipePoseEstimator.ts` | MediaPipe Pose Landmarker, GPU delegate first, CPU (WASM) fallback. |
| `src/pose/selectAthlete.ts` | Picks the athlete when several people are visible (biggest first, then continuity). |
| `src/pose/skeleton.ts` | Pure geometry of the wireframe (head, shoulders, elbows, wrists, hips, knees, ankles). |
| `src/analysis/signal.ts` | Gap filling, Savitzky–Golay-style local polynomial smoothing/derivatives, angle unwrapping. |
| `src/analysis/com.ts` | Segment-based COM (14 segments, de Leva-style mass fractions). |
| `src/analysis/computeAnalysis.ts` | Smoothing, COM, height, velocity, joint angles, body angle, rotation, scale. |
| `src/video/overlay.ts`, `src/ui/*` | Canvas overlay, player, charts (custom canvas, no chart library). |
| `src/localOnlyGuard.ts` + CSP in `vite.config.ts` | Blocks any cross-origin network request (see below). |

`AnalysisResult` and `PoseTrack` are plain typed arrays/objects. A future temporal skill-recognition model can
consume them directly (or the JSON export) without touching the UI or the pose backend.

## What is computed

- **COM**: weighted average of segment centers (head, trunk, upper arms, forearms, hands, thighs, shanks, feet).
- **Vertical position**: COM height in meters above its lowest point in the clip. **Vertical velocity**: derivative of a local
  quadratic fit (window ≈ 0.2 s), up = positive.
- **Body angle**: trunk (hips → shoulders) and body line (ankles → head) versus vertical-up, (-180°, 180°], + = clockwise on screen.
- **Rotation**: trunk angle unwrapped over time (cumulative degrees / turns) plus angular velocity.
- **Joint angles**: elbows, shoulders, hips, knees (interior angle, 180° = straight).
- **Pose confidence** per frame (mean landmark visibility); low-confidence frames are shaded in the charts and drawn dashed on the video.

## Limitations (please read)

- **2D only.** Angles and rotation are image-plane projections. They are correct only for a fixed camera looking roughly
  perpendicular to the plane of the skill. Twists (rotation about the long axis) are not measured.
- **Scale is approximate.** Meters come from the athlete height you enter and the skeleton length (≈ 0.9 × height). Perspective and
  camera distance are not corrected. Treat meters and m/s as estimates.
- **COM is a model**, not a measurement, and MediaPipe landmarks are noisy for fast, inverted, tucked or occluded poses.
- **WebGPU is not used.** MediaPipe Tasks Vision only offers `GPU` (WebGL) and `CPU` (WASM) delegates. The estimator sits behind an
  interface so a real WebGPU backend (e.g. onnxruntime-web) can be added later.
- **Video codecs depend on the browser.** MP4 (H.264) is safest. HEVC `.mov` from iPhones plays in Safari and recent Chrome/Edge, not everywhere.
- **Privacy note.** The MediaPipe runtime contains a usage-logging call to `odml.pa.googleapis.com`. The app blocks all cross-origin
  requests at runtime (`localOnlyGuard.ts`) and the production build enforces `connect-src 'self' blob: data:` via CSP. Video frames are never uploaded.
- Multi-person scenes: the athlete is followed by continuity; a coach walking next to the athlete can still steal the track.

## Verified so far

- Unit tests: COM model, angles, smoothing, unwrapping, and a full synthetic somersault (analytic ground truth).
- Headless Chromium end to end (WebM input, both GPU and CPU delegates, dev server and CSP production build): upload → analysis →
  overlay → charts → frame stepping. On a synthetic video made from a real photo moving on a known arc, the apex height matched the
  ground truth, and a synthetic 360° flip was measured as 359°.
- **Not yet tested on real trampoline footage** (nor with MP4/MOV files, Safari or a real GPU).
