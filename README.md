# TrampoVision (prototype)

Browser-only prototype that turns a trampoline video into a **clean, normalized time series**: skeleton, center of
mass (COM), trajectory, body orientation and rotation, plus the jump cycle (takeoff, apex, landing). **No backend,
no database, no LLM: the video never leaves the browser and every number comes from simple, explainable math.**

It does **not** score routines (FIG), use an LLM or coach. Stage 1 asks:

> Can we reliably turn a trampoline video into a clean, normalized time series of skeleton + center of mass +
> trajectory + body rotation?

Stage 2 (this version) is a first **skill-recognition prototype** for five basic skills, built to answer a different question:

> Do the extracted skeleton and temporal features contain enough information to reliably distinguish trampoline movements?

Where the answer is "not from this signal", the app says so and names the missing signal instead of guessing
(see *Skill recognition* below).

## Run

```bash
npm install          # also copies the MediaPipe WASM runtime + downloads the pose models into public/
npm run dev          # http://localhost:5173
npm test             # unit tests for the math and the skill logic (synthetic ground truth)
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
video ─► extractPoseTrack ─► PoseTrack ─► stabilizePose ─► computeAnalysis ─► AnalysisResult ─► analyzeSkills ─► per-jump sequence,
 (seek+detect)   raw landmarks     (clean joints)    (COM, calibration,       arrays per        (src/skills)     features, prediction
                                                      orientation, jumps)      sample                                 │
                                                                                  └─► UI / exports (PoseSeries JSON, CSV, skills JSON/CSV)
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
| `src/skills/frameShape.ts` | Per-sample pose measurements: hip/knee angles, knee-to-torso distance, compactness, leg separation, body-frame joint coordinates, facing cues. |
| `src/skills/jumpFeatures.ts` | One normalized sequence and one feature object (`JumpFeatures`) per detected jump. |
| `src/skills/bodyPosition.ts`, `rotation.ts`, `facing.ts` | Rule-based body position, rotation in half turns with confidence, facing direction. |
| `src/skills/classifier.ts` | `SkillClassifier` interface + the rule-based classifier (evidence, limitations). A learned model can replace it. |
| `src/skills/config.ts` | Every threshold in one object (editable in the UI, saved in the export). |
| `src/skills/export.ts` | Skills JSON, per-jump CSV, per-sample sequences CSV. |
| `src/skills/testMannequin.ts`, `evaluation.ts` | Test-only articulated athlete (known joint angles) and the synthetic evaluation harness. |
| `src/ui/PhaseTimeline.tsx`, `JumpView.tsx`, `SkillPanel.tsx` | Event timeline, per-jump normalized charts, prediction with evidence. |

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

## Skill recognition (prototype)

`video → skeleton time series → jump segmentation → movement features → skill classification`, all in the browser.

**Segmentation.** Takeoff, ascent, apex, descent and landing come from the COM trajectory (section 5). They are drawn on the
**timeline strip** under the video (ascent and descent shaded, `T` `A` `L` marks, the predicted skill of every jump, the COM height as a faint line).
Click it to seek and to pick a jump; the jump view follows the playhead.

**Normalized sequence per jump** (`JumpSequence`, 32 samples from takeoff `u=0` to landing `u=1`, 58 columns). Nothing depends on
resolution, position in the frame, athlete size or pixel coordinates:

- 19 joints in the athlete's own frame: origin at the hip center, y along the trunk (hips → shoulders), x to its right when upright, in body lengths;
- COM relative to its takeoff position in body lengths, and in **bed coordinates** (±1 = bed edge) when a calibration exists (meters are also included);
- orientation as turns since takeoff (plus sin/cos) and angular velocity in turns/s;
- hip angle, knee angle, knee-to-torso distance, leg separation, compactness, shoulder/hip axis, body-position code, pose quality.

**Features** (`JumpFeatures`, a plain object, exported as JSON/CSV): timing (flight time, time to apex), trajectory (max height, rise, takeoff speed, horizontal
displacement, bed position), orientation (at takeoff / apex / landing, max deviation, peak and mean angular velocity), shape statistics
(hip, knee, shoulder/hip axis, leg separation, knee-to-torso, compactness; min / max / mean / value at the most closed moment), body position,
rotation, facing, and data quality.

**Body position** (`bodyPosition.ts`), fuzzy rules on the hip angle (shoulder–hip–knee) and knee angle (hip–knee–ankle), read at the most closed moment of the flight:

| | hips | legs |
| --- | --- | --- |
| straight | open (≥ 155°) | straight (≥ 150°) |
| pike | folded (≤ 125°) | straight |
| tuck | folded | bent (≤ 115°); knees near the torso add up to 30% |

Between the limits the score falls linearly, and a shape between two definitions is reported as **unknown**, not forced. All thresholds are in `config.ts`
and editable in the panel (*Thresholds*). **These starting values are my estimates; they have not been tuned on real athletes.**

**Rotation** (`rotation.ts`): net trunk rotation between takeoff and landing, rounded to half turns (0 / 180 / 360 / 540 / 720°), with a confidence that is the
product of five checks: closeness to a multiple of 180°, how well the trunk joints were measured, no large orientation jump between samples (aliasing / pose flip),
the body line rotating like the trunk, and the orientation not going one way and back (a sign of a pose flip).

**Facing** (`facing.ts`): where the athlete faces in the body frame, from three cues (face points ahead of the ears, knee in front of the hip-ankle line, toes ahead of heels), read
over the bed contact and the flight. It can be set manually. Needed for front vs back.

**Classifier** (`classifier.ts`), rules only:

| rotation | rest | result |
| --- | --- | --- |
| ~0° | straight / tuck / pike position | Straight Jump / Tuck Jump / Pike Jump |
| ~360° | facing known | **Front** if the top of the body moved toward the face, **Back** if away |
| ~360° | facing unknown | *Somersault (front or back undetermined)* |
| anything else (180°, 540°, 720°, quarter turns) | | Unclassified, with the reason |

I read "Back" and "Front" as **back and front somersaults** (one full rotation). If drops (landing on back or front) were meant, that is not
implemented; quarter-turn rotations are reported as a limitation.

Each prediction returns the skill, a confidence (a heuristic product of the confidences it rests on, **not a calibrated probability**), the evidence
(hip angle, knee angle, body orientation, leg separation, rotation, knees to torso, compactness, position, facing, pose quality), a one-line reason, and a list
of **limitations**: what the data could not settle and what signal would fix it. A static list of what one side view can never tell (twists, straddle, quarter turns, camera view, pose-model failures) is in the panel.

**Swapping in a learned model.** `analyzeSkills(result, { classifier })` takes any `SkillClassifier { id, version, classify({ features, sequence, cycle, config }) }`. The
normalized sequence and the feature object are the model input; the rule-based classifier stays as the transparent baseline.

**Exports.** *Skills JSON* (`trampovision.jump-skills` v1: config, per jump the features, prediction and sequence), *Skills CSV* (one row per jump),
*Sequences CSV* (one row per jump and normalized sample).

### What has been checked for the skill stage

Synthetic athlete (`testMannequin.ts`): an articulated 2D body with known hip/knee angles, facing, and a COM on a ballistic path, rotated about the COM;
random heights, sizes, speeds, rotations (0.92–1.08 turns) and body angles, 60 routines × 5 jumps = 300 jumps per row. Rows are what `src/skills/evaluation.test.ts`
asserts (with fewer routines). Correct = the right skill; *declined* = unclassified or direction undetermined; *confident wrong* = a wrong skill at ≥ 60% confidence.

| condition | correct | declined | confident wrong |
| --- | --- | --- | --- |
| clean | 100% | 0 | 0 |
| landmark jitter 2% of height / 4% | 100% / 100% | 0 / 0 | 0 / 0 |
| jitter 2% + 10% of landmarks dropped | 100% | 0 | 0 |
| loose tucks, bent-knee pikes, piked layouts (jitter 1%) | 99% | 3 | 0 |
| pose model flips the athlete when inverted (simulated: mirror / rotate 180°) | 60% / 60% | 120 / 120 (all somersaults) | 0 / 0 |
| camera yaw 50° / 70° away from side-on | 100% / 59% | 0 / 121 | 0 / 1 |
| jitter 1% at 15 fps instead of 30 | 90% | 31 | 0 |

**How to read this.** It shows that *if* the pose estimator is as accurate as this simulated one, hip angle, knee angle, rotation and facing separate the five skills, and that the failure
modes I could simulate end in "declined" and a named limitation, not in a confident wrong answer. It does **not** show that a real model is that accurate: the classes were
generated from the same ideas as the rules (the textbook rows do not overlap), and the flip and yaw failures are my assumptions about how a pose model fails, not something I observed.
Rotation error grows with rotation speed (about 5% for a full turn) because the takeoff and landing times are known to a few hundredths of a second.

Browser end to end (headless Chromium): (a) a stick-figure video of straight, tuck, pike, back, front, straight (pose loaded from a saved series): all six named correctly at 85–100%,
timeline, position strip, normalized charts, exports and *Play jump* work, forcing the facing to the other side turns Back into Front; (b) real MediaPipe on the earlier photo video (calibrated, CPU): 4 jumps found; the
1-turn jump was read as 349° and named **Back** at 96% (the athlete in the photo faces left and turns clockwise: correct); the other three, which never leave a lunge pose, were called
"Straight Jump" at 88–96%, which shows that the rules only look at hip and knee angles. No network requests.

### Do the features contain enough information? Current answer

- **Yes, in principle, for** rotation amount and direction, and for straight vs tuck vs pike, *from a side-on camera*: hip angle, knee angle and orientation carry it, and the confidence drops when they are unreliable.
- **Only with an extra signal:** front vs back needs the facing direction (face, knee and toe cues; manual override when they are weak). Skills with half-turns or quarter turns need a landing-position rule.
- **Not from this signal:** twists (need 3D pose or a second camera), straddle / leg separation (need a front view), anything seen from the front or back of the athlete.
- **Unknown until real footage is tested:** how often a real pose model flips, drops or mislocates limbs on inverted, tucked or blurred athletes. This is the biggest risk and it cannot be judged from synthetic data.

## Accuracy: what has and has not been checked

Synthetic routines with analytic ground truth (`npm test`), 30 and 60 fps, up to 2 cm of landmark noise, glitches and dropouts:

- takeoff / landing times within ~35 ms, flight time within ~5%, apex within a frame, rotation within ~3% (quarter turns exact);
- calibration and normalization as described above;
- glitches, low-confidence joints and dropouts are removed or bridged without flattening the apex;
- the JSON store round-trips and the analysis can be re-run from it.

Browser end to end (headless Chromium, real MediaPipe on a synthetic video: a photo moved along an exact 4-jump trajectory in front of a
drawn bed, seen by a level pinhole camera; one jump has a full turn and one drifts 0.7 m): all 4 jumps found, flight times 1–4.5% short,
0.97 turns counted for a 1.0-turn jump, drift 0.66 m for 0.70 m, free-fall check 9.5 m/s², no network requests, save/open round trip works.

**Not yet tested:** real trampoline footage (the most important gap; public footage could not be downloaded here), MP4/MOV files, Safari, a real GPU, several people in the frame, and
cameras that are not level. Real COM estimates also move with arm and leg motion, so takeoff/landing will be noisier than on the synthetic data.

## Limitations (please read)

- **Skill thresholds and confidence are untuned.** The hip/knee limits, the rotation tolerance and the confidence formulas are my estimates. They need labeled real jumps to tune and to calibrate the confidence.
- **Front vs back** depends on the facing estimate; in a side view with pointed toes and a turned head the cues can be weak, in which case the app reports it and asks for a manual setting.
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
