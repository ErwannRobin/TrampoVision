# TrampoVision (prototype)

Browser-only prototype that turns a trampoline video into a **clean, normalized time series**: skeleton, center of
mass (COM), trajectory, body orientation and rotation, plus the jump cycle (takeoff, apex, landing). **No backend,
no database, no LLM: the video never leaves the browser and every number comes from simple, explainable math.**

It deliberately does **not** recognize skills, score routines (FIG) or coach. The one question it tries to answer:

> Can we reliably turn a trampoline video into a clean, normalized time series of skeleton + center of mass +
> trajectory + body rotation?

## Run

```bash
npm install          # also copies the MediaPipe WASM runtime + downloads the pose models into public/
npm run dev          # http://localhost:5173
npm test             # unit tests for the math (76 tests, synthetic ground truth)
npm run build        # production build (adds a strict Content-Security-Policy)
```

`npm install` needs internet once (models come from Google's public MediaPipe bucket). Afterwards the app
works offline. If the download failed, run `npm run fetch-assets`.

## Use

1. Choose an MP4/MOV. The frame rate is measured automatically (editable).
2. Pick a model (Full is a good default; Heavy is the most accurate/slowest) and enter the athlete height.
3. *(Optional, recommended)* **Trampoline → Set up calibration**: scrub to a frame where the bed is visible and click its
   four corners, going around it. Drag a corner to adjust, then **Done**. Enter the bed size if it is not 4.28 × 2.14 m and
   say whether side 1→2 is the long or the short side. The calibration is remembered for that file (browser storage only).
4. **Analyze video**. It seeks frame by frame, so the result does not depend on machine speed.
5. Play, slow down (0.1×–2×), step frame by frame (`←` `→`, `Shift` = 10 frames, `Space` = play/pause), or click/drag
   on any chart to seek. The video shows the skeleton, a solid COM dot with its trajectory, the bed outline and the current
   jump phase. The **analysis panel** shows, for the current frame: COM, height, vertical velocity, horizontal displacement
   from the bed center, body angle (wrapped and continuous), rotation count and jump phase, plus a table of all jumps and
   data-quality warnings. Click a jump row to go to its takeoff.
6. **Frames CSV**, **Jumps CSV**, or **Save data (JSON)**. The JSON is the complete frame-by-frame store (below). Use
   *open saved data* later to get the same results without running the pose model again.

## Pipeline and code map

```
video ─► extractPoseTrack ─► PoseTrack ─► stabilizePose ─► computeAnalysis ─► AnalysisResult ─► UI / exports
 (seek+detect)   raw landmarks     (clean joints)    (COM, calibration,       arrays per        buildPoseSeries
                                                      orientation, jumps)      sample            buildFeatureMatrix
```

| Module | Role |
| --- | --- |
| `src/pose/types.ts` | `PoseEstimator` interface. Any backend that returns the 33-point BlazePose topology can be plugged in. |
| `src/pose/MediaPipePoseEstimator.ts` | MediaPipe Pose Landmarker, GPU delegate first, CPU (WASM) fallback. |
| `src/analysis/stabilize.ts` | Low-confidence gating, glitch rejection, gap filling, confidence-weighted smoothing, per-joint state. |
| `src/analysis/signal.ts` | Median, spike mask, gap filling (linear / quadratic), weighted Savitzky–Golay-style fits, peak finder, angle unwrapping. |
| `src/analysis/com.ts` | Segment-based COM (14 segments, de Leva-style mass fractions). |
| `src/analysis/calibration.ts` | Four bed corners → scale, bed center, position normalized to the trampoline. |
| `src/analysis/jumpCycles.ts` | Apex / takeoff / landing detection, per-frame phase, jump metrics, rotation counting. |
| `src/analysis/computeAnalysis.ts` | Orchestrates the above and derives height, velocity, joint angles, body orientation. |
| `src/analysis/timeSeries.ts` | The frame-by-frame store (`PoseSeries` JSON, import/export) and a numeric feature matrix. |
| `src/video/overlay.ts`, `src/ui/*` | Canvas overlay, calibration tool, player, charts (custom canvas), analysis panel. |
| `src/localOnlyGuard.ts` + CSP in `vite.config.ts` | Blocks any cross-origin network request (see below). |
| `src/analysis/testTracks.ts` | Test-only synthetic routines with analytic ground truth. |

## What is computed

### 1. Frame-by-frame store (`PoseSeries`, JSON schema `trampovision.pose-series` v1)

One record per analyzed frame: timestamp `t`, frame number, `detected`, model `confidence`, **all 33 joints** as
`[x px, y px, score, state]`, the estimated **COM** (px, meters, bed-normalized, height, vertical velocity, mass coverage),
the **body orientation** (wrapped and continuous, angular velocity), the jump `phase` and jump number, and the running
rotation count. The header lists `landmarkNames` and `stateCodes` (0 missing, 1 measured, 2 interpolated,
3 corrected = a glitch was replaced). Next to the cleaned data the file keeps the **raw model output** (`raw`), so the
analysis can be re-run with other settings, and the calibration and the detected `jumps`.

For a temporal model, `buildFeatureMatrix(result)` returns a `[frames × features]` array (pose shape relative to the COM and
divided by body length, joint scores, height, vertical speed, bed-normalized position, orientation as sin/cos, turns, angular
speed) with a validity mask. Nothing in it is learned.

### 2. Pose stability (`stabilize.ts`)

1. Joints with model visibility < 0.4 are treated as missing (their position is not trusted).
2. **Glitches:** a joint farther than 20% of the body length from the median of its own neighbours in time (± 0.07 s) is
   rejected. If ≥ 40% of the core joints of a frame are glitches, the whole frame is dropped (the skeleton "jumped").
3. Gaps up to 0.3 s are bridged (a parabola through the samples on both sides, so a ballistic path is not flattened);
   longer gaps stay missing rather than invented.
4. Every joint path is smoothed with a **confidence-weighted local quadratic fit** over 0.15 s, so neighbouring frames are used and
   doubtful samples pull less.

Each joint sample keeps a state (measured / interpolated / corrected / missing) and a score; filled samples never look as sure as
measured ones. The COM is only reported when at least 50% of the body mass was visible.

### 3. Center of mass

Weighted average of segment centers (head, trunk, upper arms, forearms, hands, thighs, shanks, feet). Shown as a solid dot on the
video with its trajectory; charted as height, velocity, horizontal position and path.

### 4. Trampoline calibration (`calibration.ts`)

Four clicked corners + the bed size give the image → bed-plane mapping (a homography). The athlete is in the air, so the
athlete is **not** mapped through it (the ray through a point high above the bed hits the bed plane far away or behind the
camera). Instead the camera is assumed to be **level**, so vertical stays vertical in the image:

- `meters per pixel` = the bed's scale at its center along the on-screen horizontal;
- **horizontal displacement** = image x distance from the bed center × that scale (+ = right); `xNorm` = the same divided by the half-size
  of the bed along that direction (±1 = the bed edge);
- **height** = image y distance above the bed center × that scale, so height 0 is the bed surface.

Meters can come from the bed (default when calibrated) or from the athlete height (selectable). The panel compares the two
scales and warns when they disagree. **Limits, measured on a synthetic pinhole camera** (`calibration.test.ts`): exact for a level camera
with the athlete over the bed center; an athlete 1 m closer than the bed center to the camera reads about 11% too large; a camera
tilted down 8° reads within ~7% at 5 m height, 15° within ~13%, 25° within ~20%. Only the on-screen horizontal direction
can be measured with one camera (depth is invisible), and the panel says which side of the bed the camera sees.

### 5. Jump cycle (`jumpCycles.ts`)

From the COM height and vertical velocity only:

- **Apex:** a peak of the COM height that rises ≥ 0.3 m above its surroundings; height and time come from a parabola fitted to the
  middle of the flight.
- **Takeoff / landing:** found roughly as the largest upward / downward COM speed around the apex, then refined to the instant where
  free fall (a = −g) starts / ends, using a two-piece parabola fit (bed contact has a free acceleration, flight is forced to −g).
  This avoids the lag you get from reading the event off a smoothed velocity curve.
- **Phases per frame:** `ground`, `takeoff`, `ascent`, `apex`, `descent`, `landing`. A clip that starts or ends in the air reports
  the jump with takeoff or landing left empty.
- **Metrics per jump:** flight time, time to apex, apex height, height gained, vertical velocity at takeoff/landing (and the
  scale-free `g × time to apex`), horizontal displacement, rotation (see below).
- **Free-fall check:** the acceleration fitted to the middle of each flight should be 9.81 m/s². If it is not, the meters are off
  by roughly that ratio (this is the best check of the athlete height and the scale).

### 6. Body orientation and 7. rotations

Orientation = angle of the trunk vector (hips → shoulders) from vertical-up, clockwise = + as seen in the video. It is stored
wrapped to (−180°, 180°] and **unwrapped** so it keeps counting (350 → 355 → 360 → 365, never back to 0). Each new sample is put on the
360° branch closest to where the rotation was heading (last value + recent rate), so a dropout of more than half a turn is still
counted correctly when the rate is steady.

Per jump, `rotation = orientation(landing) − orientation(takeoff)` (interpolated between frames), reported as turns, rounded to the
nearest **quarter turn**, and `completed rotations = quarter turns / 4` toward zero (a 350° flip counts as 1, 310° as 0). A live
counter (turns since takeoff, reset at each takeoff, frozen at landing) is shown in the panel. The sign is the direction on screen; it
does not say forward or backward somersault.

## Accuracy: what has and has not been checked

Synthetic routines with analytic ground truth (`npm test`), 30 and 60 fps, up to 2 cm of landmark noise, glitches and dropouts:

- takeoff / landing times within ~35 ms, flight time within ~5%, apex within a frame, rotation within ~3% (quarter turns exact);
- calibration and normalization as described above;
- glitches, low-confidence joints and dropouts are removed or bridged without flattening the apex;
- the JSON store round-trips and the analysis can be re-run from it.

Browser end to end (headless Chromium, real MediaPipe on a synthetic video: a photo moved along an exact 4-jump trajectory in front of a
drawn bed, seen by a level pinhole camera; one jump has a full turn and one drifts 0.7 m): all 4 jumps found, flight times 1–4.5% short,
0.97 turns counted for a 1.0-turn jump, drift 0.66 m for 0.70 m, free-fall check 9.5 m/s², no network requests, save/open round trip works.

**Not yet tested:** real trampoline footage (the most important gap), MP4/MOV files, Safari, a real GPU, several people in the frame, and
cameras that are not level. Real COM estimates also move with arm and leg motion, so takeoff/landing will be noisier than on the synthetic data.

## Limitations (please read)

- **2D only.** Angles and rotation are image-plane projections. They are correct only for a fixed camera looking roughly
  perpendicular to the plane of the skill. Twists (rotation about the long axis) are not measured, and a somersault seen from an angle
  is under-counted.
- **Scale is approximate.** Meters come from the bed (calibrated) or from the athlete height (skeleton length ≈ 0.9 × height); both assume the
  athlete stays at the distance of the bed center. Treat meters and m/s as estimates and read the panel warnings.
- **COM is a model**, not a measurement, and MediaPipe landmarks are noisy for fast, inverted, tucked or occluded poses. Left/right swaps
  of limbs are not corrected (they do not change the COM or the trunk angle).
- **Rotation aliasing:** if the body turns more than about 120° between two analyzed frames, the count can be wrong; the panel warns.
  Analyze every frame for fast skills.
- **Segment constants** of the COM model (de Leva-style fractions) were written from memory: mass fractions sum to 1 (tested) but
  verify them before scientific use. The 4.28 × 2.14 m default bed is also from memory: enter the size of your trampoline.
- **WebGPU is not used.** MediaPipe Tasks Vision only offers `GPU` (WebGL) and `CPU` (WASM) delegates. The estimator sits behind an
  interface so a real WebGPU backend (e.g. onnxruntime-web) can be added later.
- **Video codecs depend on the browser.** MP4 (H.264) is safest. HEVC `.mov` from iPhones plays in Safari and recent Chrome/Edge, not everywhere.
- **Privacy note.** The MediaPipe runtime contains a usage-logging call to `odml.pa.googleapis.com`. The app blocks all cross-origin
  requests at runtime (`localOnlyGuard.ts`) and the production build enforces `connect-src 'self' blob: data:` via CSP. Video frames are never uploaded.
  The only thing stored in the browser is the calibration corners per file name and size (`localStorage`).
- Multi-person scenes: the athlete is followed by continuity; a coach walking next to the athlete can still steal the track.
