# TrampoVision (prototype)

Film a trampoline set and TrampoVision tells you **what each skill was, what it is worth (FIG difficulty), a proposed execution score and what to fix**. It is a browser-only prototype: **no backend, no database, no LLM. The video never leaves the browser and every number comes from simple, explainable math.**

Under the hood it turns the video into a **clean, normalized time series** (skeleton, center of mass, trajectory, body orientation and rotation, and the jump cycle: takeoff, apex, landing) and reads the skills from that.

The same explanation, written for users, is in the app: the **About** page (the info button in the top bar, or the address `#about`). It is available in English, French, German and Japanese.

## Contents

- [How it works in short](#how-it-works-in-short)
- [Run](#run) and [Live view](#live-view-the-default) (the default screen) and [Use (advanced)](#use-advanced)
- [Languages](#languages) and [Pipeline and code map](#pipeline-and-code-map)
- [What is computed](#what-is-computed), [Skill recognition](#skill-recognition-prototype) and [3D pose and twist](#3d-pose-and-twist-experimental)
- [Validation workflow](#validation-workflow-dataset-evaluation-failure-cases), [Review service](#review-service-optional) and [Accuracy](#accuracy-what-has-and-has-not-been-checked)
- [Limitations](#limitations-please-read), [Inspiration, rules and related work](#inspiration-rules-and-related-work) and [Asset host](#asset-host)

## How it works in short

1. **Read** the video frame by frame (about 30 analyzed frames a second, whatever the video's rate).
2. **Pose**: MediaPipe Pose Landmarker (BlazePose) finds 33 body points per frame, on the GPU when possible, else the CPU (WebAssembly).
3. **Clean**: low-confidence points dropped, glitches rejected, short gaps bridged, every path smoothed.
4. **Center of mass and jumps**: a 14-segment COM; takeoff, apex and landing from its height, where free fall starts and ends.
5. **Rotation and shape**: unwrapped trunk angle, hip and knee angles, facing direction.
6. **Name the skill**: a rule-based classifier against a table of FIG elements; always a best guess, flagged when unsure.
7. **Score**: difficulty by the FIG rule (§17.1, checked against the Code's 139 examples); execution proposed from the §20.2 deductions one side camera can see.

Two questions drove the work, and the app answers "not from this signal" where the signal is missing instead of guessing:

> Can we reliably turn a trampoline video into a clean, normalized time series of skeleton + center of mass + trajectory + body rotation?
>
> Do the extracted skeleton and temporal features contain enough information to reliably distinguish trampoline movements?

The **live view** (the default screen, see _Live view_) is the tool for a coach or an athlete on the trampoline: each skill gets a name (always a best guess), its **difficulty**, a proposed **execution** score and what to fix, and the coach corrects any guess in one tap, which the app learns from. Everything else is behind an **Advanced** switch in the settings.

A third line of work is **validating this scientifically**: you label jumps, the app saves them locally with everything it measured, and computes accuracy, precision, recall and a confusion matrix, with the failures and the numbers behind each one. It also has an **experimental 3D pose view and twist estimate** that says when it cannot be trusted (see _Validation workflow_ and _3D pose and twist_).

## Run

```bash
npm install          # also copies the MediaPipe WASM runtime + downloads the pose models into public/
npm run dev          # http://localhost:5173
npm test             # unit tests for the math and the skill logic (synthetic ground truth)
npm run build        # production build (adds a strict Content-Security-Policy)
```

`make help` lists shortcuts (`make dev`, `make check`, `make lint`, `make format`, `make build`, `make clean`). Lint is oxlint rather than ESLint because typescript-eslint does not support TypeScript 7 yet; formatting is Prettier. Node version is pinned in `.nvmrc`; CI (`.github/workflows/ci.yml`) runs `make check` and `make build`.

Link previews (Open Graph / Twitter card) use `public/og-image.png` (source: `scripts/og-image.html`, rendered at 1200×630). Crawlers need absolute URLs, so the build adds `og:url` and `og:image` from `SITE_URL`, else Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, else `https://trampo-vision.vercel.app`.

**Home screen.** The app can be added to a phone's or tablet's home screen (Share → Add to Home Screen on iOS, Install on Android and desktop Chrome) and then opens full screen with its own icon. It has a web manifest (`public/manifest.webmanifest`) and no service worker, so it still needs a connection to load. The icons in `public/` (`apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) are drawn from the logo by `scripts/icons.mjs`; `make icons` re-renders them.

`npm install` needs internet once (models come from Google's public MediaPipe bucket). Afterwards the app
works offline. If the download failed, run `npm run fetch-assets`.

Videos the browser cannot decode (iPhone HEVC `.mov` in desktop Chrome) are converted to H.264 (max 720p) in the browser with ffmpeg.wasm; expect it to take about as long as the video or longer. `make convert VIDEO=file.MOV` does the same with a local ffmpeg.

## Live view (the default)

Open the app, film a set (a phone opens its camera; a computer picks a file) or drop a video, and wait for the analysis: it starts by itself and needs nothing set up. Then:

- **The set at a glance**: number of skills, the **difficulty** (sum of the skills, a repeat counted once), the **execution** the pose earns (an estimate, out of 10 for ten skills like these, one judge's scale), the time in the air, and **what to work on next** (the two things that cost the most points, most often).
- **One row per skill**: its name, difficulty and execution deduction. Straight jumps between the skills are bounces and are folded into one line. **Copy summary** puts the set, the scores and the focus into a message.
- **Tap a skill** to see it on the video and to open it: what it was (with a **Yes, that is it** and a **Change** button), how its difficulty is made of parts, which deductions its execution has and how they were measured, what to fix, and the deduction you would give.
- **Full screen**: the button at the corner of the video fills the screen with the picture, the skill under the playhead with its difficulty and execution, and a slim bar (play, previous and next skill, speed, position). Swipe right or left on the video to move through it a frame at a time, tap it to play or pause.
- **The names are always a guess**: a jump the classifier is not sure of carries a dashed mark and a "?", with what it is (best guess, direction assumed) written under it. A somersault whose direction cannot be told is named a back (the commoner one) and says so, with what the front would be worth. **A guess the classifier would not have named** (the pose could not be trusted, or the rotation is a quarter turn off a whole somersault) is marked _not counted yet_ and stays out of the totals until you check it with one tap; when the pose looks untrustworthy, the same shape without rotation is the first thing offered (a straight jump that the pose model made look like a somersault).

**Difficulty** is the published rule of the FIG Code of Points 2025-2028 (Trampoline, Part I §17.1): a somersault, each quarter, each half twist, the pike or straight position, the backward multiple somersault and the twisting doubles and triples all have their value (`src/skills/fig/difficulty.ts`). It is not decided by any model: the recognized movement goes in and the rule gives the value. The test suite reproduces every one of the 139 values listed in the Code's own table of examples (Part II, appendix C). Not modelled: the exercise bonus of §17.1.7 and the limits of junior and age-group competitions. A twist counts by its total, whatever the phase. A skill whose body looked easier than its name (a "pike" that was a tuck) says what a judge would give.

**Execution** is a proposal, not a judge: the deductions of §20.2 that one side-on camera can see, measured on the same pose the classifier reads (`src/coaching/execution.ts`, `src/coaching/config.ts`): bent knees in a pike or a layout (0.1 to 0.2), a late opening (0.1, 0.2) or none before 3 o'clock (0.3), piking down after the opening (0.1, 0.2), a bent body line in a layout (0.1, 0.2), arms away from the body or bent (0.1), and, only when the 3D twist is reliable, a twist that finishes late (0.3). Nothing is judged after 3 o'clock, when the athlete prepares the landing, and a skill loses at most 0.5. Feet and knees together and pointed toes need a view from the front and are listed as **not checked**, never guessed. **The angles that decide whether a deduction applies are my estimates**, more lenient than the Code's because a 2D pose model reads a straight body a few degrees short; they have not been tuned on footage judged by FIG judges. The deduction you give a skill is saved next to the one the app proposed (`execution` in the record), which is what would tune them.

**Tips** come with the deductions (one cue for each thing that cost points, with what was measured), plus a note when a skill landed far from the center of the bed. The **focus** of a set groups them across the skills and ranks them by the points they cost. A long set whose last skills fly clearly lower than the first ones gets a note about keeping the height.

**Learning.** _Yes, that is it_, _Change_ and _It is none of these_ are saved in the local dataset (the skill becomes a reference example for the classifier at once, so the other skills of the clip and the next clips profit from it) and, when the review service is on, sent to it as a verdict (`confirm` or `correct`, reviewer `live`), so that every device learns from it. Verdicts wait in an outbox in the browser until they are delivered. Opening the same video again brings the labels back. With the upload off in the settings nothing is sent.

**The classifier always names a complete jump** (`SkillConfig.forceGuess`, on by default): the closest element of the table, flagged, with the reason it is weak. The synthetic evaluation checks that such guesses are never confidently wrong. A jump cut off by the clip is still not named.

**Advanced** (settings, off by default) brings back everything below: the athlete and coach views, the stage views and layer toggles, the trampoline outline, the engine settings, the exports and the saved analyses.

## Use (advanced)

1. Choose an MP4/MOV, drop one anywhere on the page, or use the sample. The frame rate is measured automatically (editable). With the advanced tools off the analysis then starts by itself, at about 30 analyzed frames a second whatever the video's rate.
2. The rail shows the **Settings** of the clip. Enter the athlete height. Pick a model if you like (Full is a good default; Heavy is the most accurate and the slowest) under _Analysis_.
3. _(Optional, recommended)_ **Trampoline → Mark the trampoline**: scrub to a frame where the bed is visible and click its
   four corners, going around it. Drag a corner to adjust, then **Done**. Enter the bed size if it is not 4.28 × 2.14 m and
   say whether side 1→2 is the long or the short side. The calibration is remembered for that file (browser storage only).
4. **Analyze video**. It seeks frame by frame, so the result does not depend on machine speed.
5. The result opens on the **timeline**: one strip of arches for the whole clip, with takeoff (▲), apex (●) and landing (▼)
   of every detected jump, a chip per jump with its skill, and the playhead. Press or drag on it to scrub, press inside a
   flight to select that jump, zoom to one jump, or play it with a loop. `[` and `]` go to the previous and next jump.
   Play, slow down (0.1×–2×), step frame by frame (`←` `→`, `Shift` = 10 frames, `Space` = play/pause, `Shift` + `Space` = play backwards) or click/drag on any chart to seek.
   A click or a tap on the video plays or pauses it, the reverse button plays it backwards, and the first button goes back to the
   start of the routine, or of the clip. The **routine start** is detected (the first jump that is not a straight jump, or that was
   given an execution point), shown by a flag on the timeline and in the list of skills, and can be moved to the selected jump
   or taken off from the flag menu of the timeline. On a wide screen the controls of the video and those of the selected jump share one row.
   A skill's detail gives the time in the air and the height gained that follows from it (g × time² / 8: no scale needed).
   The video shows the skeleton, the center of mass with its trajectory, the bed outline and labels; the layers can be toggled.
6. With the advanced tools on, the top bar switches the interface between **Athlete** and **Coach**:
   - _Athlete_: the plain answers for the selected jump (skill and how sure the classifier is, peak height, time in the air, rotation, body shape, where it landed on the bed) and every jump of the clip compared with the others of that clip.
   - _Coach_: the same analysis in depth. Tabs for the **Skill** (evidence, confidence parts, limitations, thresholds), **Metrics** (values at the playhead, every measurement, table of all jumps), **Twist** (experimental), **Review** (labels) and **Data** (warnings, data quality, joint angles), the stage view (video, split with the 3D skeleton, or 3D) and, below, all the charts (**Technical data**).
7. **Export** (top bar): the annotated video, **Frames CSV**, **Jumps CSV**, **Save analysis (JSON)** (the complete frame-by-frame store, below), and the skills JSON / CSV files. **Settings → Open saved analysis** later gives the same results without running the pose model again (the file also holds the 3D landmarks and the video id).
8. **Validate:** in the coach's _Review_ tab, watch each jump and give it a label (keys 1–6). Metrics, the confusion matrix and the failure cases appear under the charts; everything is stored in this browser and exported as JSON / CSV.
9. **3D pose (experimental):** in the coach's stage, _Split_ or _3D_ shows the 3D skeleton, the longitudinal axis and the twist estimate.

The interface adapts from phones to wide screens and follows the system's light or dark appearance (or the choice in _Settings_). Its design rules, tokens and parts are in [`docs/ui-design.md`](docs/ui-design.md).

## Languages

The whole interface is in **English, French, German and Japanese**: the skill names, the coaching text and tips, the classifier's explanations, the errors, the charts, the canvas labels and the About page and the review page (`review.html`). The app opens in the first language of the browser that it speaks (else English); the globe menu in the top bar changes it, and the choice is remembered. Files you export (JSON, CSV, the exported video) keep the English skill names and field names, so a dataset stays comparable whatever the language of the person who labelled it.

How it is built (`src/i18n/`):

- **English is the source.** `src/i18n/messages/en/*.ts` hold every message, one file per part of the app (`about.ts` holds the About page); `fr/`, `de/` and `ja/` have the same files. The type `Dictionary` makes a missing key a compile error, and `src/i18n/i18n.test.ts` checks that each language has exactly the keys of English, the same `{holes}` in every form, no untranslated English (a name or a shared word is listed on purpose), and no key written twice.
- **Reading a message.** `t(key, params)` fills the `{holes}`; `tp(key, count, params)` picks the singular or the plural form of the language (`Intl.PluralRules`); `tx(key, holes)` fills holes with React nodes; `formatNumber`, `formatDecimal` and `formatPercent` write numbers as the language does (0,6 in French and German). French gets its no-break spaces before `: ; ? !` from `t`, so the messages are written with plain spaces.
- **Loading.** A language is a separate chunk of the build and the first screen waits for the one in use, so a visitor downloads the one they read. Modules that are not UI (the analysis, the classifier, the review worker) import `i18n/core`, which has no React.
- **Text made by an analysis** (a prediction's summary, a tip, a limitation) is written in the language in use when it is made and is rebuilt when the language changes. A name stored in data (`FigElement.name`) stays English; `elementName(element)` gives the one to show. A saved record and its fingerprint do not depend on the language.
- **The words of the sport** are the ones coaches use in each language: _Difficulté / Exécution_ (French), _Schwierigkeit / Haltung_ and _Schraube_ for a twist (German), _難度 / 演技点_ and _ひねり_ (Japanese). French and German address the person formally (_vous_, _Sie_); Japanese is polite (です・ます).

To add a language: add it to `LOCALES` and `LANGUAGE_NAMES` in `src/i18n/locale.ts`, copy `src/i18n/messages/en/` to a folder named after it, translate, and add its loader in `src/i18n/messages/index.ts`. `make check` lists what is missing.

## Pipeline and code map

```
video ─► extractPoseTrack ─► PoseTrack ─► stabilizePose ─► computeAnalysis ─► AnalysisResult ─► analyzeSkills ─► per-jump sequence,
 (seek+detect)   raw landmarks     (clean joints)    (COM, calibration,       arrays per        (src/skills)     features, prediction
                                                      orientation, jumps)      sample                                 │
                                                                                  └─► UI / exports (PoseSeries JSON, CSV, skills JSON/CSV)
```

| Module                                                    | Role                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pose/types.ts`                                       | `PoseEstimator` interface. Any backend that returns the 33-point BlazePose topology can be plugged in.                                            |
| `src/pose/MediaPipePoseEstimator.ts`                      | MediaPipe Pose Landmarker, GPU delegate first, CPU (WASM) fallback.                                                                               |
| `src/analysis/stabilize.ts`                               | Low-confidence gating, glitch rejection, gap filling, confidence-weighted smoothing, per-joint state.                                             |
| `src/analysis/signal.ts`                                  | Median, spike mask, gap filling (linear / quadratic), weighted Savitzky–Golay-style fits, peak finder, angle unwrapping.                          |
| `src/analysis/com.ts`                                     | Segment-based COM (14 segments, de Leva-style mass fractions).                                                                                    |
| `src/analysis/calibration.ts`                             | Four bed corners → scale, bed center, position normalized to the trampoline.                                                                      |
| `src/analysis/jumpCycles.ts`                              | Apex / takeoff / landing detection, per-frame phase, jump metrics, rotation counting.                                                             |
| `src/analysis/computeAnalysis.ts`                         | Orchestrates the above and derives height, velocity, joint angles, body orientation.                                                              |
| `src/analysis/orientation.ts`                             | Continuous body orientation that puts back head/feet flips of the pose model (two readings per frame, smoothest path wins).                       |
| `src/analysis/timeSeries.ts`                              | The frame-by-frame store (`PoseSeries` JSON, import/export) and a numeric feature matrix.                                                         |
| `src/video/overlay.ts`                                    | Canvas overlay drawn on the video and in the exported video: skeleton, center of mass, trajectory comet, label chips, bed outline.                |
| `src/ui/*`, `src/styles/*`                                | The interface (see `docs/ui-design.md`): design tokens and kit, stage and transport, timeline, athlete and coach rails, charts, settings.         |
| `src/i18n/*`                                              | `t`, `tp`, `tx`, the number formats, the language in use and its loading, and the messages (English is the source, the others are checked).       |
| `src/localOnlyGuard.ts` + CSP in `vite.config.ts`         | Blocks any cross-origin network request (see below).                                                                                              |
| `src/analysis/testTracks.ts`                              | Test-only synthetic routines with analytic ground truth.                                                                                          |
| `src/skills/frameShape.ts`                                | Per-sample pose measurements: hip/knee angles, knee-to-torso distance, compactness, leg separation, body-frame joint coordinates, facing cues.    |
| `src/skills/jumpFeatures.ts`                              | One normalized sequence and one feature object (`JumpFeatures`) per detected jump.                                                                |
| `src/skills/bodyPosition.ts`, `rotation.ts`, `facing.ts`  | Rule-based body position, rotation in half turns with confidence, facing direction.                                                               |
| `src/skills/classifier.ts`                                | `SkillClassifier` interface + the rule-based classifier (evidence, limitations). A learned model can replace it.                                  |
| `src/skills/config.ts`                                    | Every threshold in one object (editable in the UI, saved in the export).                                                                          |
| `src/skills/export.ts`                                    | Skills JSON, per-jump CSV, per-sample sequences CSV.                                                                                              |
| `src/skills/testMannequin.ts`, `evaluation.ts`            | Test-only articulated athlete (known joint angles) and the synthetic evaluation harness.                                                          |
| `src/ui/Timeline.tsx`, `JumpView.tsx`, `rail/*`           | Event timeline, per-jump normalized charts, the athlete's insights and the coach's tabs (prediction with evidence).                               |
| `src/skills/fig/difficulty.ts`, `elements.ts`             | The FIG difficulty rule (§17.1), the table of examples it is checked against, and the element table it fills.                                     |
| `src/coaching/guess.ts`, `session.ts`, `display.ts`       | The call for every jump (the coach's label, else the classifier's guess), the set with its totals, and the names shown on the video.              |
| `src/coaching/execution.ts`, `config.ts`, `tips.ts`       | The proposed execution (FIG §20.2 deductions from the pose), its thresholds, and the tips and the focus of a set.                                 |
| `src/ui/About.tsx`, `src/ui/chrome/aboutRoute.ts`         | The About page (how it works, privacy, limits, inspiration and links) and its `#about` address; the top bar and the first screen link to it.      |
| `src/ui/live/*`, `styles/live.css`                        | The live rail: the set, one row per skill, the opened skill, the correction picker.                                                               |
| `src/dataset/record.ts`, `types.ts`, `videoId.ts`         | The saved jump record (`JumpRecord`), how records are built, matched and refreshed, and the stable video id.                                      |
| `src/dataset/store.ts`, `useDataset.ts`                   | Local storage in the browser (IndexedDB, memory fallback), merge on import.                                                                       |
| `src/dataset/metrics.ts`, `failures.ts`, `export.ts`      | Accuracy / precision / recall / confusion matrix, label-vs-measurement checks for failures, dataset and evaluation JSON/CSV.                      |
| `src/ui/EvaluationView.tsx`, `src/ui/review/*`            | The _Review_ tab (label the jumps), the metrics report and the failure cards.                                                                     |
| `src/ui/review/mode/*`, `src/dataset/stageLabel.ts`       | The review mode (one jump at a time, stage by stage) and how its answers are stored, exported and imported as a label file.                       |
| `src/pose3d/torso.ts`, `twist.ts`, `config.ts`, `vec3.ts` | Experimental 3D: torso frame from the 3D landmarks, twist about the longitudinal axis with reliability checks.                                    |
| `src/pose3d/capabilities.ts`                              | Measures what this browser can run (WebGPU, WebGL 2, WASM SIMD / threads).                                                                        |
| `src/skills/twist2d.ts`, `twistContext.ts`                | Twist counted from the 2D skeleton (shoulder and hip width, left/right order, face), and which twist (3D, 2D, both) the classifier is told about. |
| `src/pose3d/testTwistMannequin.ts`, `evaluation.ts`       | Test-only 3D athlete with known somersault and twist, and its degradations.                                                                       |
| `src/ui/Pose3DView.tsx`, `rail/coach/TwistTab.tsx`        | 3D skeleton view (torso, axis, twist dial), twist curves, twist numbers and limits.                                                               |

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

**Head/feet flips** (`orientation.ts`). A pose model sometimes puts the head where the feet are for a few frames when the athlete is inverted: the trunk angle is then 180° off, which the 360° rule above cannot tell from a real rotation (a double somersault turns about 15° per frame; half a turn in one frame is not physical). Every frame therefore has two readings, as measured and 180° away, and the path with the smoothest angular velocity wins, with a price for each switch (a small dynamic-programming search; per-frame trust from the visibility and length of the trunk). The ankles-to-head line and the center-of-mass-to-head direction lean on the choice only a little, because when the model flips the whole body they flip with it. Frames whose trunk joints were put in place of a rejected glitch are not trusted: their orientation is interpolated from the frames around them. A flip can only be put back while the athlete is in the air (on the bed a bent-double trunk is not a flip). On a clean track nothing changes. `AnalysisResult.meta.orientationFlippedFrames` and `orientationFlipRuns` say how much was put back; `repairOrientation: false` in the analysis options unwraps as before. Limits: on the one real clip checked (Dong Dong, 2011, 25 fps) the repair put back only 4 frames, so 180° flips are not what breaks its rotation counts: the pose model loses the trunk joints (visibility below 0.4) for much of the inverted tuck and the stabilizer bridges the gap by interpolating each joint, which can swing the trunk by 100° or more in one frame. Ignoring those frames too makes the orientation smooth but moved two double somersaults from 1.4 to 2.4 turns, which nobody has checked, so it is not on. A flip shorter than about the smoothing window (5 frames) is partly eaten by the stabilizer first, the repair does not touch the center of mass or the joint angles of a flipped frame (they stay wrong), and a flip that starts in the first frame and never ends cannot be told from the truth.

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

|          | hips            | legs                                              |
| -------- | --------------- | ------------------------------------------------- |
| straight | open (≥ 155°)   | straight (≥ 150°)                                 |
| pike     | folded (≤ 125°) | straight                                          |
| tuck     | folded          | bent (≤ 115°); knees near the torso add up to 30% |

Between the limits the score falls linearly, and a shape between two definitions is reported as **unknown**, not forced. All thresholds are in `config.ts`
and editable in the panel (_Thresholds_). **These starting values are my estimates; they have not been tuned on real athletes.**

**Rotation** (`rotation.ts`): net trunk rotation between takeoff and landing, rounded to half turns (0 / 180 / 360 / 540 / 720°), with a confidence that is the
product of five checks: closeness to a multiple of 180°, how well the trunk joints were measured, no large orientation jump between samples (aliasing / pose flip),
the body line rotating like the trunk, and the orientation not going one way and back (a sign of a pose flip).

**Facing** (`facing.ts`): where the athlete faces in the body frame, from three cues (face points ahead of the ears, knee in front of the hip-ankle line, toes ahead of heels), read
over the bed contact and the flight. It can be set manually. Needed for front vs back.

**Classifier** (`classifier.ts`), rules only:

| rotation                                        | rest                            | result                                                                   |
| ----------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| ~0°                                             | straight / tuck / pike position | Straight Jump / Tuck Jump / Pike Jump                                    |
| ~360°                                           | facing known                    | **Front** if the top of the body moved toward the face, **Back** if away |
| ~360°                                           | facing unknown                  | _Somersault (front or back undetermined)_                                |
| anything else (180°, 540°, 720°, quarter turns) |                                 | Unclassified, with the reason                                            |

I read "Back" and "Front" as **back and front somersaults** (one full rotation). If drops (landing on back or front) were meant, that is not
implemented; quarter-turn rotations are reported as a limitation.

Each prediction returns the skill, a confidence (a heuristic product of the confidences it rests on, **not a calibrated probability**), the evidence
(hip angle, knee angle, body orientation, leg separation, rotation, knees to torso, compactness, position, facing, pose quality), a one-line reason, and a list
of **limitations**: what the data could not settle and what signal would fix it. A static list of what one side view can never tell (twists, straddle, quarter turns, camera view, pose-model failures) is in the panel.

**Swapping in a learned model.** `analyzeSkills(result, { classifier })` takes any `SkillClassifier { id, version, classify({ features, sequence, cycle, config }) }`. The
normalized sequence and the feature object are the model input; the rule-based classifier stays as the transparent baseline.

**Exports.** _Skills JSON_ (`trampovision.jump-skills` v1: config, per jump the features, prediction and sequence), _Skills CSV_ (one row per jump),
_Sequences CSV_ (one row per jump and normalized sample).

### What has been checked for the skill stage

Synthetic athlete (`testMannequin.ts`): an articulated 2D body with known hip/knee angles, facing, and a COM on a ballistic path, rotated about the COM;
random heights, sizes, speeds, rotations (0.92–1.08 turns) and body angles, 60 routines × 5 jumps = 300 jumps per row. Rows are what `src/skills/evaluation.test.ts`
asserts (with fewer routines). Correct = the right skill; _declined_ = unclassified or direction undetermined; _confident wrong_ = a wrong skill at ≥ 60% confidence.

| condition                                                                    | correct     | declined                    | confident wrong |
| ---------------------------------------------------------------------------- | ----------- | --------------------------- | --------------- |
| clean                                                                        | 100%        | 0                           | 0               |
| landmark jitter 2% of height / 4%                                            | 100% / 100% | 0 / 0                       | 0 / 0           |
| jitter 2% + 10% of landmarks dropped                                         | 100%        | 0                           | 0               |
| loose tucks, bent-knee pikes, piked layouts (jitter 1%)                      | 99%         | 3                           | 0               |
| pose model flips the athlete when inverted (simulated: mirror / rotate 180°) | 60% / 64%   | 109 / 117 (all somersaults) | 0 / 0           |
| camera yaw 50° / 70° away from side-on                                       | 100% / 59%  | 0 / 121                     | 0 / 1           |
| jitter 1% at 15 fps instead of 30                                            | 90%         | 31                          | 0               |

**How to read this.** It shows that _if_ the pose estimator is as accurate as this simulated one, hip angle, knee angle, rotation and facing separate the five skills, and that the failure
modes I could simulate end in "declined" and a named limitation, not in a confident wrong answer. It does **not** show that a real model is that accurate: the classes were
generated from the same ideas as the rules (the textbook rows do not overlap), and the flip and yaw failures are my assumptions about how a pose model fails, not something I observed.
Rotation error grows with rotation speed (about 5% for a full turn) because the takeoff and landing times are known to a few hundredths of a second.
The flip row counts the declined answers (forced guesses off, 60 routines of 5 jumps): the head/feet repair (see _Head/feet flips_) takes the rotate-180° case from 60% to 64%, the mirror case is not a 180° flip and stays at 60%. With the app's forced guesses, rotate 180° goes from 60% to 100%, every somersault as a flagged tentative guess, because the orientation is now right but the flipped frames still bend the center of mass and the joint angles.

Browser end to end (headless Chromium): (a) a stick-figure video of straight, tuck, pike, back, front, straight (pose loaded from a saved series): all six named correctly at 85–100%,
timeline, position strip, normalized charts, exports and _Play jump_ work, forcing the facing to the other side turns Back into Front; (b) real MediaPipe on the earlier photo video (calibrated, CPU): 4 jumps found; the
1-turn jump was read as 349° and named **Back** at 96% (the athlete in the photo faces left and turns clockwise: correct); the other three, which never leave a lunge pose, were called
"Straight Jump" at 88–96%, which shows that the rules only look at hip and knee angles. No network requests.

### Do the features contain enough information? Current answer

- **Yes, in principle, for** rotation amount and direction, and for straight vs tuck vs pike, _from a side-on camera_: hip angle, knee angle and orientation carry it, and the confidence drops when they are unreliable.
- **Only with an extra signal:** front vs back needs the facing direction (face, knee and toe cues; manual override when they are weak). Skills with half-turns or quarter turns need a landing-position rule.
- **Not from this signal:** twists (the experimental 3D pose gives a twist estimate, but it is only as good as the model's depth: on the one real test it produced a phantom −94° and the app flagged it as not reliable; a count from 2D cues is a second opinion, checked on a simulated athlete only; see _3D pose and twist_ and _Twist from 2D cues_), straddle / leg separation (need a front view), anything seen from the front or back of the athlete.
- **Unknown until real footage is tested:** how often a real pose model flips, drops or mislocates limbs on inverted, tucked or blurred athletes. This is the biggest risk and it cannot be judged from synthetic data.

## Validation workflow: dataset, evaluation, failure cases

The goal is to find out whether the representation is good enough, with real numbers from real jumps. Everything stays in your browser.

**Saving jumps (local dataset).** In the coach's _Review_ tab, choose a label for the jump you are looking at (`Straight`, `Tuck`, `Pike`, `Back`, `Front`, `Unknown`; keys 1–6). The jump is
saved with everything the app measured. _Save all jumps_ stores the whole video without labels. Storage is the browser's own IndexedDB (database `trampovision`); if the browser blocks it, the app says so and keeps the
dataset in memory only. **Nothing is uploaded and the video is never stored, only numbers.** A record (`JumpRecord`, `src/dataset/types.ts`) holds:

| field                 | content                                                                                                                                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `videoId`             | `v-` + 12 hex digits of a SHA-256 over the file size and the first and last 256 KiB: the same file gives the same id after a reload or a rename. Saved series files carry it; without it a content-based `s-…` id is used.                     |
| `jumpId`              | number of the jump on screen (1 = first). A re-analysis keeps the saved id of a jump whose apex is within 0.2 s, so labels survive a change of settings.                                                                                       |
| `timestamps`          | takeoff, apex, landing, flight time                                                                                                                                                                                                            |
| `sequence`            | the normalized sequence (32 × 58): skeleton in the body frame, COM path, orientation, angular velocity, joint angles, shape measures (the ML input). The JSON export adds named views (`views.skeleton`, `views.signals`) of the same numbers. |
| `features`            | every extracted feature (`JumpFeatures`)                                                                                                                                                                                                       |
| `prediction`          | skill, confidence, evidence, confidence parts, limitations, summary                                                                                                                                                                            |
| `analysis`            | classifier id and version, the thresholds used, athlete height, scale source, calibration: enough to reproduce or compare a prediction                                                                                                         |
| `twist`               | the experimental 3D twist estimate and its curve (below)                                                                                                                                                                                       |
| `truth`, `twistTruth` | your label (with time and note); your optional count of half twists, kept apart from the skill label                                                                                                                                           |

**Review.** The _Review_ tab shows, for the jump on the timeline, the video with skeleton, COM and predicted skill on it (as everywhere), the classifier's answer and confidence, and the label buttons. _Play jump_ replays it; _Next unlabeled_ (key N) moves on. If
you change the thresholds or the athlete height after saving, the saved predictions are marked out of date and _Update predictions_ refreshes them (labels are kept). Metrics always use the saved predictions, so nothing changes under you.

**Metrics** (`src/dataset/metrics.ts`, tested by hand-computed cases):

- _Accuracy_ = right / jumps with one of the five labels. **A jump the classifier did not answer (unclassified, or "somersault, direction unknown") counts as wrong**, and the share it answered is shown separately, with the accuracy when it answered. It comes with a **Wilson 95% interval**, because "3 of 3" is not "certainly 100%".
- Per class: samples, how often it was predicted, **precision**, **recall** (the class's own accuracy) with its interval, and one-vs-rest accuracy. _Balanced accuracy_ = mean recall over classes that have examples.
- _Confusion matrix_: rows = your label (including Unknown), columns = the five skills, "somersault, direction unknown" and "not classified".
- _Unknown_ means you cannot tell or it is not one of the five. It is shown in the matrix but not counted in accuracy, precision or recall (my choice; it would be wrong to punish the classifier for a jump the labeler cannot name). "Unknown" agrees with "not classified" in the failure list.
- _Wrong at ≥ 60%_: wrong answers given with high confidence, and the mean confidence when right and when wrong. This is the number that shows whether the confidence can be trusted.
- The report can cover _this video_ or _all saved videos_. It warns when there are few jumps, when a class has no example, and when the predictions come from several threshold sets.

**Failure cases.** Every labeled jump whose prediction differs from the label is listed (low-confidence ones too, marked; wrong answers first, the most confident first). Each card shows a table
**label against measurement**: the label is turned into numbers (for example Tuck: hip ≤ 125°, knees ≤ 115°, no rotation; Back: about 360°, turning away from the face; with the thresholds the prediction used) and compared with what was measured, with ✓ / ✗ / ?.
It does not decide who is right (the label or the measurement); it shows where they differ. The card also shows the classifier's evidence and limitations, small plots of hip angle, knee angle, rotation and COM height, and **all extracted features**.

**Exports** (`src/dataset/export.ts`): _Dataset JSON_ (`trampovision.jump-dataset` v1, can be imported into another browser; a newer copy of a jump replaces an older one), _Dataset CSV_ (one row per jump: ids, label, prediction, whether it was right, all features, twist), _Evaluation JSON_
(`trampovision.evaluation` v1: metrics, matrix, per-jump results, failure ids) and _Evaluation CSV_ (one table: a row per true label with samples, precision, recall and the confusion matrix, then the overall numbers).

**Read the numbers with care.** One labeler, no second opinion. Few jumps give wide intervals. If you tune the thresholds while looking at the same jumps, the accuracy becomes training accuracy and will look better than it is: keep some labeled jumps you never tune on.

## Jev comparison (proof of concept, by hand only)

`src/skills/jev/` puts TypeSafe's **Jev** decision model on top of the existing pipeline, for comparison only. Nothing upstream changes (pose, jumps, rotation, twist, features), and the temporal (DTW + prototype) classifier stays the default and the fallback.

For each jump the movement signature and the features (counts, rotation, facing cues, hip and knee angles, 9-point trajectories) are written into a text state and Jev answers four typed questions: somersaults, twists, direction, position. The element is found by table lookup and the top 5 come from the product of the four answers. **Only measurements are sent, never a video, a frame or a file name** (a test checks the request body). Jev is never called on its own. Two ways to ask it, both by hand. In the app, the advanced tools have a **Classification** tab in the coach rail: a button asks Jev about the selected jump (or all of them) and a comparison panel shows both classifiers side by side (element, confidence, the four parts, the five best, agreement). The tab calls the app's own Vercel function `api/jev/systemone.ts`, which holds the key: set the project's secret `TYPESAFE_API_KEY` and the build variable `VITE_JEV_API_URL=/api/jev` (empty: the tab says Jev is not in this build). The key never reaches the browser, and the call is same-origin, so the CSP and the local-only guard are unchanged. The function is a public URL, so it is no general proxy: POST only, fixed model, small body, and only the four questions. From Node:

```bash
TYPESAFE_API_KEY=... make jev-eval FILE=eval/export.ndjson DEBUG=1
```

It prints top-1/3/5 for both classifiers, which part (somersaults, twists, direction, position) each gets right, the jumps where they disagree, confidence calibration, latency and tokens; `DEBUG=1` adds, per jump, the signature, Jev's answers, both top 5s, the reason and the final element. Without a key, Jev is skipped and the local answer is the fallback.

Jev answers as confidently on a broken signal as on a clean one, so three guards sit around it. When the curves look wrong (the center of mass far below takeoff, a rotation that runs back, as a panning or cutting camera produces), the local answer is kept and the reason says why. A count just under a whole number is flagged to Jev as possibly cut off. When Jev's own answers together are no FIG element (a pike jump with a half twist, say), the closest element is reported with the low confidence of the product, not a share of what is left. `ALL=1` runs jumps nobody labelled and lists where the two classifiers differ instead of scoring them.

## Review service (optional)

`worker/` is a Cloudflare Worker with a D1 database. The browser stays the **only classifier**: right after an analysis, and without
delaying it, the app posts each jump (measurements, the prediction with its candidates, the pose sequence) to the Worker. A person then
confirms or corrects the answer. Nothing is classified on the server, and no video and no file name are ever sent.

| Route                                                                                        | Token            | Does                                                                                                              |
| -------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `POST /jumps`                                                                                | ingest           | Stores jumps (max 25 per call). A re-post replaces the automatic answer and keeps the review.                     |
| `GET /references`                                                                            | ingest           | Confirmed and corrected jumps, as records with a figure: the app loads them as reference examples.                |
| `GET /elements`                                                                              | none             | The figure table, for the reviewer page (served by the app at `/review.html`, see below).                         |
| `GET /jumps?queue=1`, `GET /jumps/:id`, `PUT /jumps/:id/review`, `GET /stats`, `GET /export` | ingest or review | The review workflow and an NDJSON export for tuning.                                                              |
| `DELETE /jumps/:id`, `DELETE /jumps?status=…`                                                | ingest or review | Removes one jump, or every jump of one status (the status is required, so nothing empties the table by accident). |

Verdicts: `confirm`, `correct` (a figure of the table), `unknown`, `bad-data`. The live view sends the coach's answers as `confirm` or `correct` (reviewer `live`) and posts the record again with their execution score. Only confirmed and corrected jumps become reference
examples; the same video's own jumps are never used as references for itself.

Set up: `cd worker && npx wrangler d1 create trampovision-review` (put the id in `wrangler.toml`), `npx wrangler secret put INGEST_TOKEN`,
`npx wrangler secret put REVIEW_TOKEN`, then `make worker-schema` (again only when `worker/schema.sql` changes) and `make worker-deploy`. After that, `.github/workflows/deploy-worker.yml` deploys it on every push to `main` that touches `worker/`, `src/skills/`, `src/i18n/` or the dependencies (checks, tests, `make worker-schema`, `make worker-deploy`); it needs the repository secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, D1: Edit) and `CLOUDFLARE_ACCOUNT_ID`, and can also be run by hand from the Actions tab. `schema.sql` must stay idempotent (`IF NOT EXISTS`) because the deploy applies it every time. Build the app with `VITE_REVIEW_API_URL` and `VITE_REVIEW_INGEST_TOKEN`
(see `.env.example`). Locally: put both tokens in `worker/.dev.vars` and run `make worker-dev`. The ingest token ships in the bundle, so it
is not a secret: it keeps strangers from writing by accident. Everyone who uses the app may review: the reviewer page (`/review.html`, part of the app build) uses the
same token, so it asks for nothing. `REVIEW_TOKEN` is optional. The Worker answers browsers on `ALLOWED_ORIGIN`, on localhost and on the Vercel preview deployments that `PREVIEW_ORIGIN_PATTERN` matches (both in `wrangler.toml`), so a preview build shows the real jumps too; remove that line to keep previews out. For real access control, put Cloudflare Access in front of the worker. A _Send analyzed jumps for review_ switch in the settings turns the upload off. The reviewer page can delete the jump on screen (_Delete_) and every jump of the open tab (_Delete all_); both ask first. Deleting is permanent, and with the shared token anyone who opens the page can do it: use Cloudflare Access if that is not acceptable.

**The reviewer page.** The home page links to it (_Review jumps_, with the number of jumps waiting; the link only shows when the build has a review service). For the jump on screen it shows the automatic answer, the skeleton replay (it plays by itself) and the measured curves. The skeleton is in 3D: drag to turn it, Shift-drag or two fingers to move it, wheel or pinch to zoom, double-click or _Reset view_ to come back to the camera's point of view; _Side_ and _Top_ jump to those views, and _Upright_ keeps the trunk upright so the twist is read from above the head (a ring shows the shoulder line at takeoff and how far it has turned, to compare with the twist dial). The chest arrow and the shaded torso show which way the athlete faces. Jumps saved before the 3D joints were kept (`pose3d` in the record) show a flat skeleton. A bar that stays at the bottom holds the verdict: **Confirm** (Enter), _Cannot tell_ (U), _Bad data_ (B), _Skip_ (→), _Back_ (←). To correct, everything is on the same screen: the classifier's alternatives (one click, or keys 1 to 5), and four rows of buttons (somersaults, direction, twists, position) that always land on a figure of the table, then _It was: …_. After each verdict the page moves to the next jump. The tabs (_To review_, _Confirmed_, _Corrected_, _Unknown_, _Bad data_) show the counts, and any jump can be re-classified again from its tab.

### Scoring the classifier on reviewed jumps

`make eval FILE=eval/export.ndjson` runs the current classifier again on the stored jumps (a record holds the features, the sequence
and the twist curve, so no video is needed) and scores it against what the reviewers said. `make eval-fetch` downloads the file from the
review service (`REVIEW_API_URL`, `REVIEW_TOKEN` in the environment); a dataset JSON saved by the app works too. `eval/` is git-ignored: it
holds athletes' data.

It prints, twice: with the expected movements of the table only, and with the reviewed jumps of the **other videos** as examples (leave one
video out, so a jump never sees its own clip). Each run gives top-1, top-3 and top-5 accuracy, the unclassified rate, balanced accuracy over
the elements, confident-wrong counts, the per-element results, the commonest confusions, which part of the movement went wrong (rotation,
twist, direction, position), why jumps stayed unclassified, and whether the confidence is honest (how often each band is right).
`SAVE=eval/baseline.json` keeps the numbers; `BASELINE=eval/baseline.json` fails when top-1 falls or confident-wrong rises, so a change is
scored on all real jumps at once. Jumps marked _cannot tell_ or _bad data_ and jumps nobody reviewed are counted, not scored.

### Labeling real jumps by hand (stage labels)

Real footage has no ground truth until someone watches it. `make label-sheet FILE=eval/clip.dataset.json VIDEO=video-sample/clip.mp4` reads a
dataset JSON (or the review export) and writes, per video: `eval/sheets/<videoId>.md` and `.csv` (one line per jump: takeoff, apex, landing,
flight time, the app's guess, measured rotation, facing and twist confidence), `eval/sheets/<videoId>-strips.sh` (one ffmpeg command per
jump that tiles its flight into `eval/sheets/<videoId>-strips/vNN-jNN.png`; `STRIPS=1` runs them) and `eval/labels/<videoId>.json`, a label
file with one blank entry per jump. Running it again only adds blank entries for new jumps; labels you wrote are never touched.

In the label file, fill what you can see and leave the rest `null`: `somersaults` (quarters allowed: 0, 0.75, 1, 2, ...), `direction`
(`front` / `back`, only for a somersault), `halfTwists` (0, 1, 2, ...), `position` (`straight` / `tuck` / `pike`). Set `cannotTell` or
`badSegmentation` (the flight is two jumps, or a cut) instead of guessing. A label finds its jump by `videoId` and `apexS` (within 0.2 s). Nothing
is invented for you: a blank file scores nothing.

**Review mode (labeling in the app).** Instead of editing the label file by hand, open an analysis and press **Review** in the top bar (or go to
`#review`). One jump at a time loops in the video (half speed to start with) next to what the classifier made of it, what its four stages
measured, the data problems that make a guess weak (a pose flip, a camera that is not side-on, a twist that is not measured) and the buttons: one to
say the classifier was right, and a row for each question (somersaults in quarters, direction, half twists, position), with the figure of the table
and its difficulty shown as the answers are given. Keys: `0`-`3`, `Q`, `B` `F`, `W` `+` `-`, `S` `T` `P`, `Enter` accepts, `U` cannot tell, `X` bad cut,
`Z` undo, `N` next. A filter shows only the jumps to do, the ones whose label differs from the guess, or the ones the classifier is not confident
about, and the review moves on by itself. Labels are kept in the local dataset (never sent anywhere), partly answered jumps included, and **Download
labels** writes them as the label file above: put it in `eval/labels/` and `make eval` scores each question. **Import labels** does the reverse (jumps
are matched by apex time, and the app asks first when the file names another video).

`make eval` reads `eval/labels/` by default (`LABELS=dir` to change it, several `FILE`s are fine). A complete label (somersaults, direction when
it somersaults, twists, position, and an element of the table) counts as the figure for the scores above and as an example for the leave-one-video-out
run. Next to them it prints **one score per question**: rotation (whole somersaults), direction, twists and position, each over the jumps where that
stage is labelled, with how often the classifier gave no answer, how many directions were assumed, and the measured rotation against the label in turns
(bias < 0 = read short). Quarter and half rotations are not in the table, so they only feed that measurement error. `eval/` is git-ignored, so are labels.

### Rotation quality without labels

`make consistency FILE=eval/dong-dong.dataset.json` (`src/eval/consistency.ts`) needs no labels. For the rotating flights (net rotation above half a turn, or a flight of at least 1 s whose orientation path adds up to more than 0.75 turns: a rotation lost to flips) it reports the share that pass each check: orientation turns one way (`monotonic`), no step above the limit between two samples (`noFlip`), the ankle-to-head line turns like the trunk (`crossCheck`), the net rotation is near a half-turn multiple (`onGrid`), the facing is known and the 3D twist is reliable. `clean` is the share that pass the first four. It lists the flights worst first with the checks each fails. `FILE` is a dataset JSON, the review service's export, or a saved pose series, which is analyzed again with the current code, so two versions of the pipeline can be compared on the same video. `SAVE=` / `BASELINE=` work as for the scoring above. It says nothing about whether the name is right: it is the number to push up while there is nothing to score a name against.

First numbers, on the 27 jumps of the Dong Dong clip (25 fps, broadcast camera): 9 rotating flights, clean rotation 22% (2/9), monotonic 44%, noFlip 89%, crossCheck 78%, onGrid 67%, facing known 33%, twist reliable 0%, mean rotation confidence 0.10.

## 3D pose and twist (experimental)

The stage view (_Split_ or _3D_ in the coach's interface) adds a 3D view and a twist estimate. It does **not** replace the 2D pipeline, and the classifier still uses the 2D pose only.

**Can this browser run a 3D pose model? (measured, not assumed).** The MediaPipe pose model already in the app returns 3D landmarks (BlazePose GHUM "world" landmarks, meters, hip-centered) with every frame; the app used to throw
them away and now keeps them, so **no second model is loaded**. MediaPipe Tasks Vision runs them on WebGL ("GPU") or WebAssembly ("CPU"); it does not use WebGPU. The 3D panel probes your browser (WebGPU adapter, WebGL 2, WASM SIMD, threads) and says what it found. In the headless Chromium used here: WebGPU adapter yes (software), WebGL 2 yes, WASM SIMD yes, WASM threads no
(the page is not cross-origin isolated). A separate dedicated 3D model (a 2D-to-3D lifting network through onnxruntime-web on WebGPU or WASM) could run in such a browser, but **I did not build or test one**: it needs a model file, and you asked for no large model yet.

**What I measured on real model output** (the photo video: a real photo of an athlete moved and turned rigidly in the image plane, so the true twist is exactly 0; CPU delegate):

- The world frame is **camera-aligned**: the trunk angle in the 3D x–y plane follows the image angle within 2° (largest 4.3°) through a full somersault, so the 3D orientation can be used for rotation.
- It is **right-handed**: the nose is in front of the chest direction `u × (R shoulder − L shoulder)` in 165 of 165 frames. So the sign convention **+ = counter-clockwise seen from above the head** holds on this photo (one photo only).
- The **3D shoulder width varies by 0.4–1%** over the three non-rotating jumps (a noise floor), but by **6.8%** during the somersault.
- **Phantom twist:** over the somersault the model gave about **−94° of twist that does not exist**, for the shoulder line and the hip line alike (so they agree with each other). The cause is geometric: the model tilted the trunk axis about 15° out of the image plane (a constant depth error), and a rotation about the camera axis of a body whose axis is tilted by α contains 360° × sin α of spin about that axis: 360° × sin 15° ≈ 93°. Small depth errors turn into large twist errors during a somersault.

**Twist estimate** (`src/pose3d/twist.ts`). Twist = rotation about the longitudinal axis (hips → shoulders), not the somersault. Frame by frame, the shoulder line of the previous frame is carried along with the axis by the smallest rotation (so a somersault adds nothing), the signed angle to the shoulder line
of this frame about the axis is the step, steps are summed. Hip line and shoulder line are estimated separately and averaged. A **second estimate keeps the axis in the image plane**: it cannot be fooled by the depth error above, but it is blind to a real tilt of the trunk out of the plane. The two disagree exactly when the answer depends on a depth value the model estimates poorly. Steps above 90° between two frames (a left/right label swap or aliasing) are folded back and counted. Twist is reported in half twists; a full twist = 360°.

**Consistency, not probability.** The confidence is the product of seven checks, each shown in the panel: closeness to a whole number of half twists, shoulders and hips found in 3D, no jumps between frames, turns one way only, shoulders and hips agree, the image-plane axis agrees, constant 3D shoulder width. Below the
threshold (50%, `pose3d/config.ts`) the panel says **"Twist: not reliable"** and shows the raw value only as raw. It has **not** been compared with real twists: the optional _Half twists you counted_ selector saves your count with the jump so it can be scored.

**Synthetic check** (`src/pose3d/evaluation.test.ts`; a rigid 3D athlete with known somersault and 0–3 twists, 80 random jumps per row). _Right_ = the half-twist count is exactly right; _reliable_ = the estimator did not decline.

| condition                                               | right              | called reliable  | right when reliable | reliable but wrong |
| ------------------------------------------------------- | ------------------ | ---------------- | ------------------- | ------------------ |
| perfect 3D landmarks                                    | 100%               | 100%             | 100%                | 0                  |
| depth noise 1 / 2 / 3 cm                                | 100% / 99% / 95%   | 100% / 95% / 91% | 100%                | 0                  |
| depth noise 5 cm / 10 cm                                | 81% / 48%          | 21% / 0%         | 100% / –            | 0                  |
| x/y noise 1 cm + depth 3 cm                             | 86%                | 59%              | 100%                | 0                  |
| 10% / 30% of frames missing                             | 98% / 80%          | 98% / 80%        | 100%                | 0                  |
| left/right swap for 8 frames                            | 100% (folded back) | 0%               | –                   | 0                  |
| trunk depth bias 15° (somersaults, the photo's failure) | 51%                | 0%               | –                   | 0                  |
| trunk depth bias 5° (somersaults)                       | 100%               | 99%              | 100%                | 0                  |
| 15 fps / 10 fps                                         | 70% / 56%          | 70% / 55%        | 100%                | 0                  |

**How to read this.** If the model's depth were as good as the simulated one, the twist can be read and the estimator says when it cannot; the failure modes are my simulations of what a single-camera model may do, and the 15° bias is the only one I observed.
It is **not** evidence about real twisting athletes.

**What the UI shows.** 3D skeleton (blue left, orange right, faded where the model is unsure), the torso plane with the chest direction, the **longitudinal axis**, and a **twist dial**: a ring perpendicular to the axis through the shoulders, grey = where the shoulder line pointed at
takeoff, amber arc = the twist since. Drag to rotate; presets for the camera view, the side and from above. Curves over the whole clip: accumulated twist (3D axis and image-plane axis), twist angular velocity, trunk-axis tilt out of the image plane, 3D shoulder and hip width. The panel gives the net twist, half twists,
direction, peak and mean twist speed, the current twist and speed at the playhead, the same twist by three other routes, the checks, and what one camera can never tell. A twist that cannot be measured says why (no 3D data, jump cut off, torso not found) and shows no number.

### Twist from 2D cues (second opinion)

`src/skills/twist2d.ts` counts half twists from the raw 2D skeleton, so that a twist is not simply "not measured" when the 3D estimate above is unreliable (it was on the only real test). Seen from the side, the shoulder line of an athlete who has twisted by an angle φ about the long axis, projected on the axis perpendicular to the trunk, is `W · sin(φ₀ + φ)`; the same holds for the hip line. A circle projected on a line keeps its amplitude whatever the camera yaw, so the yaw only moves the start phase φ₀. Three cues:

- **width**: |shoulder line| and |hip line| have one minimum per half twist. They do not care about left/right labels.
- **chirality**: the signed line changes sign at each half twist. It is only used when the **face** agrees with it: the visibility of nose and eyes is in phase with the signed line, and a left/right swap of the pose model flips the line but not the face. The nose offset from the ears (in quadrature) is a second check of the phase.
- The count is a **model fit**, not an unwrapped angle: for 0 to 8 half twists and a family of twist profiles (start and end inside the flight) the curve is fitted to the measured ones, and the smallest residual wins. It reads the raw landmarks, because the smoothing of the cleaned ones would flatten a fast twist.

The confidence is the product of seven checks (fit quality, margin to the next count, width vs chirality agreement, frames per half twist, coverage, plausible amplitude, face agreement): internal consistency, **not** a probability. How it is used: a reliable 3D twist is kept, with the 2D count as a **second opinion** (a disagreement lowers the weight of the 3D one, and the stage's notes say so). Without a reliable 3D twist, a reliable 2D count is used instead, marked `source: pose2d` in the evidence and in the limitations, with no trajectory (the fitted profile is not a measurement of when the twist happened, so the twist-end deduction never uses it) and no direction (one side view cannot tell it). It is a tolerance of ±80° rather than the 3D one. An unreliable 2D count is ignored.

**Synthetic check** (`src/skills/twist2d.test.ts`; the rigid 3D athlete of `testTwistMannequin.ts` projected to 2D with an orthographic camera, 0 to 3 twists, 0 to 2 somersaults, both facings, lean, 80 random jumps per row; the simulated model's face visibility is high when the face looks toward the camera). _Right_ = the half-twist count is exactly right; _reliable_ = the estimator did not decline.

| condition                                                  | right       | reliable   | right when reliable | reliable but wrong |
| ---------------------------------------------------------- | ----------- | ---------- | ------------------- | ------------------ |
| clean                                                      | 100%        | 100%       | 100%                | 0                  |
| landmark noise 1.5 px / 3 px (1.7% / 3.3% of the trunk)    | 100% / 100% | 99% / 98%  | 100%                | 0                  |
| landmark noise 6 px / 10 px (6.7% / 11%)                   | 100% / 98%  | 91% / 59%  | 100%                | 0                  |
| noise 1.5 px + 10% / 30% of the frames missing             | 100% / 100% | 100% / 88% | 100%                | 0                  |
| left/right swapped for 8 frames                            | 99%         | 99%        | 100%                | 0                  |
| no face information in the visibility                      | 100%        | 99%        | 100%                | 0                  |
| shoulders and hips 25% wider / 20% narrower than the prior | 100% / 100% | 94% / 100% | 100%                | 0                  |
| twist over the whole flight / late (35% to 95%)            | 100% / 96%  | 99% / 73%  | 100%                | 0                  |
| 20 fps / 15 fps                                            | 100% / 100% | 96% / 74%  | 100%                | 0                  |
| oblique camera, yaw 25° to 50°                             | 73%         | 56%        | 100%                | 0                  |

**How to read this.** If a pose model returned the shoulder and hip lines of a rigid body with the noise simulated here, the half twists can be counted, and the estimator declines when the signal is weak (few frames per half twist, much noise or missing data, a late twist). The oblique camera row shows a limit that is geometry, not noise: a somersault seen from an angle makes the shoulder line swing with the somersault, which looks like a twist; the amplitude is then implausible, and the estimator declines instead of counting it. The table is optimistic: the simulation has no systematic pose-model errors (a model that collapses the shoulder line when it is edge-on, a face that is mislabeled, arms swinging in front of the shoulders), the twist profile of the simulated athlete is inside the family the fit chooses from, and the shoulder width of the model is only checked within ±25% of a prior of 0.76 trunk lengths (hips 0.40). **There is no real twisting ground truth yet**: the Dong Dong clip is not labeled. What `make eval` would have to show on labeled real jumps is the table above with real numbers; until then a 2D count is a second opinion, and the classifier's limitations list says so each time it relies on one. The 2D count is not saved in the dataset records yet, so `make eval` does not replay it.

## Accuracy: what has and has not been checked

Synthetic routines with analytic ground truth (`npm test`), 30 and 60 fps, up to 2 cm of landmark noise, glitches and dropouts:

- takeoff / landing times within ~35 ms, flight time within ~5%, apex within a frame, rotation within ~3% (quarter turns exact);
- calibration and normalization as described above;
- glitches, low-confidence joints and dropouts are removed or bridged without flattening the apex;
- the JSON store round-trips and the analysis can be re-run from it.

Browser end to end (headless Chromium, real MediaPipe on a synthetic video: a photo moved along an exact 4-jump trajectory in front of a
drawn bed, seen by a level pinhole camera; one jump has a full turn and one drifts 0.7 m): all 4 jumps found, flight times 1–4.5% short,
0.97 turns counted for a 1.0-turn jump, drift 0.66 m for 0.70 m, free-fall check 9.5 m/s², no network requests, save/open round trip works.

Stage 3, browser end to end (headless Chromium, real MediaPipe on CPU, the same photo video, 4 jumps found as before, no regression): jumps labeled through the buttons and the `1`
key (one deliberately wrong), the report showed accuracy 67% with its 21–94% interval on the 3 jumps with a known label, per-class precision / recall, a confusion matrix, an Unknown row, one confident wrong answer, and two failure cards with the label-against-measurement checks; the four
exports downloaded with the expected content (a 162 KB dataset for 4 jumps); after a page reload the dataset and the report were still there (IndexedDB); _Delete all_ and _Import dataset_ restored them; no network requests. In 3D mode the three
non-rotating jumps read ≈ 0 twists (consistency 100%) and the somersault read −91° with consistency 0%, **"Twist: not reliable"**, while the image-plane axis said +1°. These labels are test labels on a still photo cut-out, not a validation of the classifier.

**Not yet tested:** real trampoline footage (the most important gap; public footage could not be downloaded here), MP4/MOV files, Safari, a real GPU, several people in the frame, and
cameras that are not level. Real COM estimates also move with arm and leg motion, so takeoff/landing will be noisier than on the synthetic data.

## Limitations (please read)

- **The execution score is a proposal.** Only the deductions one side-on camera can see are checked, with estimated angles (see _Live view_); the FIG Code also judges feet, knees and toes, the landing and the stability after the last skill, and the horizontal displacement and time of flight are scored separately. Treat it as a way to see what to fix, not as a judge's score.
- **The classifier's guesses are only as good as the pose.** There is no set of real athletes' jumps to score them on yet: the 17 reviewed jumps available to `make eval` when this was written come from the synthetic athlete, so the accuracy on real footage is not known. Quarter-turn skills (a Cody, a ¾ somersault, drops) are not in the element table: they are named after the closest whole element, flagged as a guess.

- **Skill thresholds and confidence are untuned.** The hip/knee limits, the rotation tolerance and the confidence formulas are my estimates. They need labeled real jumps to tune and to calibrate the confidence.
- **Front vs back** depends on the facing estimate; in a side view with pointed toes and a turned head the cues can be weak, in which case the app reports it and asks for a manual setting.
- **The skill analysis is 2D.** Angles and rotation are image-plane projections. They are correct only for a fixed camera looking roughly
  perpendicular to the plane of the skill, and a somersault seen from an angle is under-counted. Twists come only from the experimental 3D estimate, which depends on a single-camera model's depth (see _3D pose and twist_).
- **The 2D twist count is unvalidated on real twisting athletes.** It is exact on a simulated athlete with noise and gaps (see _Twist from 2D cues_), it assumes a typical shoulder width, cannot tell the direction or when the twist happened, and is misled by an oblique camera on a somersault (it declines then). It is saved neither in the dataset records nor in `make eval`.
- **3D pose is experimental and unvalidated on real twisting athletes.** The twist estimator is exact on a simulated 3D athlete and was checked for phantom twist on one still photo; the world frame's alignment and handedness were checked on that photo only.
  A dedicated 3D model (lifting network) was not built or tested. The confidence is internal consistency, not a probability.
- **The evaluation is only as good as the labels.** One labeler, no agreement check, and a small dataset gives wide intervals. Labeled jumps are the only way to tune the thresholds honestly: keep some you never tune on.
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
  The exceptions are the review service, when the build is configured with `VITE_REVIEW_API_URL` (see _Review service_), and the asset host, when it has `VITE_ASSET_BASE_URL` (see _Asset host_; read only: models, wasm and the sample are downloaded, nothing is sent). Jev needs no exception: the Classification tab calls the app's own `/api/jev` function (see _Jev comparison_), only when a person presses its button. Only those origins are let through. Without those variables the app is local-only as described here.
  What is stored in the browser: the calibration corners per file name and size (`localStorage`), and the jump dataset you save (IndexedDB `trampovision`: measurements, predictions and labels, never the video). _Delete all_ in the Review tab (_Dataset on this computer_) removes the dataset.
- Multi-person scenes: the athlete is followed by continuity; a coach walking next to the athlete can still steal the track.

## Inspiration, rules and related work

- **Inspiration:** the French trampoline club [Paris Trampo 12](https://paristrampo12.com/).
- **The rules:** difficulty and execution follow the FIG Code of Points; the official rules and manuals are at [gymnastics.sport/site/rules](https://www.gymnastics.sport/site/rules/). TrampoVision is not an official FIG tool and its scores are not official.
- **Similar projects and research** (further reading; TrampoVision has not been compared with them):
  - [Article on J-STAGE (2025)](https://www.jstage.jst.go.jp/article/sit/2025/0/2025_A-1-6/_article/-char/en)
  - [Record on CiNii Research](https://cir.nii.ac.jp/crid/1390870696565894656)
  - [Article on PubMed Central (PMC12473961)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12473961/)
  - [BounceBoard, a project on Devpost](https://devpost.com/software/bounceboard)

The same list is on the About page. The links are in `src/ui/About.tsx`; the texts around them are in `src/i18n/messages/*/about.ts`.

## Asset host

Every deployment stores a copy of the build output, and the big files were most of it (about 144 MB of 146). With `VITE_ASSET_BASE_URL` set, the build leaves them out (2 MB) and the app reads them from a public folder at runtime: the pose models (`models/`), the MediaPipe and ffmpeg wasm (`mediapipe/<version>/`, `ffmpeg/<version>/`) and the sample videos (`samples/`). The small loader scripts stay in the build, so the host only ever serves data. Without the variable, everything is served from this origin as before (`npm run fetch-assets`; no sample button), which is what `npm run dev` uses.

1. Create a public Vercel Blob store. The browser needs CORS headers on the wasm and model downloads; Blob should send `Access-Control-Allow-Origin: *` (**not checked on a real Blob store yet**).
2. `BLOB_READ_WRITE_TOKEN=... make upload-assets SAMPLES=<folder>`, with the folder holding `IMG_8368.mp4`, `IMG_8368.MOV` and `dong-dong-2011-landscape.mp4` (add `DRY_RUN=1` to only list the files; `npm run upload-assets` does the same). It prints the value for `VITE_ASSET_BASE_URL`.
3. Set `VITE_ASSET_BASE_URL` in the Vercel project (Production and Preview) and redeploy.
4. After upgrading `@mediapipe/tasks-vision` or `@ffmpeg/core`, run the upload again: each version gets its own folder, and a missing folder fails to load instead of mixing versions.

The trade-off: the app now needs the network for its first analysis (the browser caches the files after that). The cross-origin loading was tested with a local second-origin host in Chromium (wasm, model, sample and ffmpeg wasm all loaded); the upload script is untested against a real store.
