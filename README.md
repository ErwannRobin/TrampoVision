# TrampoVision (prototype)

Film a trampoline set and TrampoVision tells you **what each skill was, what it is worth (FIG difficulty), a proposed execution score and what to fix**. It is a browser-only prototype: **no backend, no database, no LLM. The video never leaves the browser and every number comes from simple, explainable math.**

Under the hood it turns the video into a **clean, normalized time series** (skeleton, center of mass, trajectory, body orientation and rotation, and the jump cycle: takeoff, apex, landing) and reads the skills from that.

The same explanation, written for users, is in the app: the **About** page (the info button in the top bar, or the address `#about`). It is available in English, French, German and Japanese.

Two guides are also online, in the same four languages: a [friendly introduction](https://erwannrobin.github.io/TrampoVision/) and an interactive [architecture map](https://erwannrobin.github.io/TrampoVision/architecture.html) (the source of both is in [`docs/`](docs/)).

## Contents

- [How it works in short](#how-it-works-in-short)
- [Run](#run) and [Live view](#live-view-the-default) (the default screen) and [Use (advanced)](#use-advanced)
- [Languages](#languages) and [Pipeline and code map](#pipeline-and-code-map)
- [What is computed](#what-is-computed), [Skill recognition](#skill-recognition-prototype), [3D pose and twist](#3d-pose-and-twist-experimental), [Second look](#second-look-checking-the-pose-and-two-models-merged) and [Motion detector](#motion-detector-experimental)
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

Videos the browser cannot decode (iPhone HEVC `.mov` in desktop Chrome) are converted to H.264 (max 720p) in the browser with ffmpeg.wasm; expect it to take about as long as the video or longer. `make video-convert VIDEO=file.MOV` does the same with a local ffmpeg.

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

For a short, friendly introduction, open [`docs/index.html`](docs/index.html). For a visual overview, open [`docs/architecture.html`](docs/architecture.html) in a browser: an interactive map of the whole pipeline (ingestion, pose extraction, classification, scoring) with a simplified view (main flow) and a full view (options and experimental features). It needs no build; click a block for details and the files behind it.

```
video ─► extractPoseTrack ─► PoseTrack ─► stabilizePose ─► computeAnalysis ─► AnalysisResult ─► analyzeSkills ─► per-jump sequence,
 (seek+detect)   raw landmarks     (clean joints)    (COM, calibration,       arrays per        (src/skills)     features, prediction
                                                      orientation, jumps)      sample                                 │
                                                                                  └─► UI / exports (PoseSeries JSON, CSV, skills JSON/CSV)
```

| Module                                                             | Role                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pose/types.ts`                                                | `PoseEstimator` interface. Any backend that returns the 33-point BlazePose topology can be plugged in.                                                                                                                                |
| `src/pose/MediaPipePoseEstimator.ts`                               | MediaPipe Pose Landmarker, GPU delegate first, CPU (WASM) fallback.                                                                                                                                                                   |
| `src/pose/engines.ts`, `src/pose/onnx/`                            | Experimental pose engines (RTMPose, ViTPose) on ONNX Runtime Web, behind the same interface. See "Experimental pose engines".                                                                                                         |
| `src/analysis/poseCheck.ts`, `refinePose.ts`, `src/pose/fusion.ts` | The second look: how well the pose model read the athlete (no labels), RTMPose-x reading the doubtful frames again in the athlete's box, and the two readings merged. See "Second look".                                              |
| `src/analysis/stabilize.ts`                                        | Low-confidence gating, glitch rejection, gap filling, confidence-weighted smoothing, per-joint state.                                                                                                                                 |
| `src/analysis/signal.ts`                                           | Median, spike mask, gap filling (linear / quadratic), weighted Savitzky–Golay-style fits, peak finder, angle unwrapping.                                                                                                              |
| `src/analysis/com.ts`                                              | Segment-based COM (14 segments, de Leva-style mass fractions).                                                                                                                                                                        |
| `src/analysis/calibration.ts`                                      | Four bed corners → scale, bed center, position normalized to the trampoline.                                                                                                                                                          |
| `src/analysis/jumpCycles.ts`                                       | Apex / takeoff / landing detection, per-frame phase, jump metrics, rotation counting.                                                                                                                                                 |
| `src/analysis/computeAnalysis.ts`                                  | Orchestrates the above and derives height, velocity, joint angles, body orientation.                                                                                                                                                  |
| `src/analysis/orientation.ts`                                      | Continuous body orientation that puts back head/feet flips of the pose model (two readings per frame, smoothest path wins).                                                                                                           |
| `src/analysis/timeSeries.ts`                                       | The frame-by-frame store (`PoseSeries` JSON, import/export) and a numeric feature matrix.                                                                                                                                             |
| `src/video/overlay.ts`                                             | Canvas overlay drawn on the video and in the exported video: skeleton, center of mass, trajectory comet, label chips, bed outline.                                                                                                    |
| `src/ui/*`, `src/styles/*`                                         | The interface (see `docs/ui-design.md`): design tokens and kit, stage and transport, timeline, athlete and coach rails, charts, settings.                                                                                             |
| `src/i18n/*`                                                       | `t`, `tp`, `tx`, the number formats, the language in use and its loading, and the messages (English is the source, the others are checked).                                                                                           |
| `src/localOnlyGuard.ts` + CSP in `vite.config.ts`                  | Blocks any cross-origin network request (see below).                                                                                                                                                                                  |
| `src/analysis/testTracks.ts`                                       | Test-only synthetic routines with analytic ground truth.                                                                                                                                                                              |
| `src/skills/frameShape.ts`                                         | Per-sample pose measurements: hip/knee angles, knee-to-torso distance, compactness, leg separation, body-frame joint coordinates, facing cues.                                                                                        |
| `src/skills/jumpFeatures.ts`                                       | One normalized sequence and one feature object (`JumpFeatures`) per detected jump.                                                                                                                                                    |
| `src/skills/bodyPosition.ts`, `rotation.ts`, `facing.ts`           | Rule-based body position, rotation in half turns with confidence, facing direction.                                                                                                                                                   |
| `src/skills/classifier.ts`                                         | `SkillClassifier` interface + the rule-based classifier (evidence, limitations). A learned model can replace it.                                                                                                                      |
| `src/skills/config.ts`                                             | Every threshold in one object (editable in the UI, saved in the export).                                                                                                                                                              |
| `src/skills/export.ts`                                             | Skills JSON, per-jump CSV, per-sample sequences CSV.                                                                                                                                                                                  |
| `src/skills/testMannequin.ts`, `evaluation.ts`                     | Test-only articulated athlete (known joint angles) and the synthetic evaluation harness.                                                                                                                                              |
| `src/ui/Timeline.tsx`, `JumpView.tsx`, `rail/*`                    | Event timeline, per-jump normalized charts, the athlete's insights and the coach's tabs (prediction with evidence).                                                                                                                   |
| `src/skills/fig/difficulty.ts`, `elements.ts`                      | The FIG difficulty rule (§17.1), the table of examples it is checked against, and the element table it fills.                                                                                                                         |
| `src/coaching/guess.ts`, `session.ts`, `display.ts`                | The call for every jump (the coach's label, else the classifier's guess), the set with its totals, and the names shown on the video.                                                                                                  |
| `src/coaching/execution.ts`, `config.ts`, `tips.ts`                | The proposed execution (FIG §20.2 deductions from the pose), its thresholds, and the tips and the focus of a set.                                                                                                                     |
| `src/ui/About.tsx`, `src/ui/chrome/aboutRoute.ts`                  | The About page (how it works, privacy, limits, inspiration and links) and its `#about` address; the top bar and the first screen link to it.                                                                                          |
| `src/ui/live/*`, `styles/live.css`                                 | The live rail: the set, one row per skill, the opened skill, the correction picker.                                                                                                                                                   |
| `src/dataset/record.ts`, `types.ts`, `videoId.ts`                  | The saved jump record (`JumpRecord`), how records are built, matched and refreshed, and the stable video id.                                                                                                                          |
| `src/dataset/store.ts`, `useDataset.ts`                            | Local storage in the browser (IndexedDB, memory fallback), merge on import.                                                                                                                                                           |
| `src/dataset/metrics.ts`, `failures.ts`, `export.ts`               | Accuracy / precision / recall / confusion matrix, label-vs-measurement checks for failures, dataset and evaluation JSON/CSV.                                                                                                          |
| `src/ui/EvaluationView.tsx`, `src/ui/review/*`                     | The _Review_ tab (label the jumps), the metrics report and the failure cards.                                                                                                                                                         |
| `src/ui/review/mode/*`, `src/dataset/stageLabel.ts`                | The review mode (one jump at a time, stage by stage) and how its answers are stored, exported and imported as a label file.                                                                                                           |
| `src/pose3d/torso.ts`, `twist.ts`, `config.ts`, `vec3.ts`          | Experimental 3D: torso frame from the 3D landmarks, twist about the longitudinal axis with reliability checks.                                                                                                                        |
| `src/pose3d/capabilities.ts`                                       | Measures what this browser can run (WebGPU, WebGL 2, WASM SIMD / threads).                                                                                                                                                            |
| `src/skills/twist2d.ts`, `twistContext.ts`                         | Twist counted from the 2D skeleton (shoulder and hip width, left/right order, face), and which twist (3D, 2D, both) the classifier is told about.                                                                                     |
| `src/pose3d/testTwistMannequin.ts`, `evaluation.ts`                | Test-only 3D athlete with known somersault and twist, and its degradations.                                                                                                                                                           |
| `src/ui/Pose3DView.tsx`, `rail/coach/TwistTab.tsx`                 | 3D skeleton view (torso, axis, twist dial), twist curves, twist numbers and limits.                                                                                                                                                   |
| `src/motion/detector.ts`, `verticalFlow.ts`, `rhythm.ts`           | Motion detector: finds the one person who jumps, from vertical motion that repeats like jumps, and makes a mask: a box around what moves in their place. In front of the pose model by default (a checkbox in the settings skips it). |
| `src/motion/camera.ts`, `cameraType.ts`                            | How the whole picture moved (a translation fitted on the background), and which kind of shot it is: fixed wide-angle, close-up that follows, low-angle.                                                                               |
| `src/motion/layer.ts`, `maskedEstimator.ts`, `pixels.ts`           | Video frame to a small gray picture, the masked picture on a canvas, and `withMotionMask(...)`, which puts the detector in front of MediaPipe.                                                                                        |
| `src/motion/focus.ts`, `scout.ts`                                  | The pose model's people narrowed to the one in the athlete's box; a first look at the start of a clip, to know where the athlete jumps before the detector is sure.                                                                   |
| `src/motion/athleteView.ts`, `upright.ts`, `view.ts`               | A zoomed square around the athlete (used where `ZoomGate` says it helps) and, off by default, the picture turned upright for a somersault, before the pose model; the angle of the body followed frame by frame.                      |
| `motion.html`, `src/motion/debug/*`                                | The debug page: the stages side by side, the pose models compared on the same picture, the app's samples, and _Load in TrampoVision_ (the clip, the page's settings and the masked video, sent to the app).                           |
| `src/motion/resultVideo.ts`, `handoff.ts`, `fitTrack.ts`           | The masked video of a whole clip, and how it reaches the app with the clip and the page's settings: a small database of its own, `?from=motion`, read once by `App.tsx`.                                                              |
| `src/motion/testScenes.ts`                                         | Test-only synthetic gyms (an athlete, people who walk, wave or stand, a bed that moves with the jumps, noise, a camera that shakes, pans or follows the athlete) with known truth.                                                    |
| `src/motion/report.ts`, `scripts/motion-eval.ts`                   | The real-footage check: `make motion-eval FILE=clip.mp4` runs the detector over a clip with ffmpeg and prints one line a second, a summary and a contact sheet with the boxes.                                                        |

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
- **Longest flight (2.5 s):** elite skills stay about 2 s in the air; 2.5 s would be a rise of 7.7 m. A longer "flight" means an
  apex was missed (the athlete lost high in the air, often on a broadcast camera) and the search ran over a bed contact into the
  next jump. The event furthest from the apex is then looked for again within 1.25 s of it (then the other one, if needed); with no
  bed contact there, the flight is dropped. On the broadcast sample this turned four impossible flights (2.9, 3.7, 4.8 and 6.1 s)
  into real ones of 1.5–1.8 s, checked on the video, and changed no other jump. The limit is not applied to a clip whose flights
  are mostly longer: that is slow motion played at normal speed.
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
TYPESAFE_API_KEY=... make eval-jev FILE=eval/export.ndjson DEBUG=1
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

**Shared clips.** _Share link_ (the live view, next to _Copy summary_, and _Export → Share link…_ in the advanced tools) uploads the clip with its analysis inside to the same Worker, which keeps it in an R2 bucket and answers with a link, `https://<app>/?share=<id>`. Opening that link downloads the clip and opens it already analyzed: no pose model runs. The file is the video as it plays in the app (the H.264 copy when the original had to be converted) with the saved analysis gzipped in a `uuid` box after the last box of the MP4 (`src/video/bundle.ts`): it still plays as a plain video anywhere, and cutting the box off gives back the original bytes, so the clip keeps its id. _Export → Video with analysis (MP4)_ saves the same file without uploading it; dropping it on the app or choosing it opens it analyzed too. The dialog says where the clip goes and for how long before anything is uploaded. The Worker (`worker/src/shares.ts`) takes the app's ingest token to upload, and only MP4 or QuickTime files of at most 100 MB; at most 5 uploads a minute from one address, 5 GB a day and 50 GB stored in all. A clip is read with its link only (a 128-bit random id) and is deleted after 90 days by the bucket's lifecycle rule; the person who shared it gets a key, kept in their browser, that deletes it at once (_Stop sharing_). The bucket is in the EU jurisdiction. **Examples.** Right after the upload, the dialog suggests listing the clip among the examples of the start screen: the person gives it a title (60 characters at most), after reading that anyone can watch it and that the athlete (or their parents) must agree. A listed clip is the one thing that is **kept for good**: the Worker (`PUT /shares/<id>/example`, with the uploader's key) copies it to `examples/<id>`, which the bucket's 90-day rule does not cover, and its row in D1 (`examples`) never expires. It then appears, newest first, in the _Try a sample_ menu for everyone (`GET /examples`, public), under _Shared by users_. At most 40 clips are listed at once. _Stop sharing_ removes a listed clip like any other, and so does the owner's `REVIEW_TOKEN` (`DELETE /shares/<id>`), for a clip that should not be there. **Moderation.** The owner manages the uploaded clips at `/moderation.html` (`noindex`; linked from the first screen with the advanced tools on, when the build has a review service). It asks for the Worker's `REVIEW_TOKEN`, which it keeps for the tab only and never bakes into the build (the app's own token is public, and is refused there). It lists every clip that has not expired (`GET /admin/shares`, newest first, with the totals and how many are listed), shows how much of each clip the app read well (_Analyzed 75%_: the share of the clip where the athlete is found inside a run of at least two jumps with their take-off and landing, no more than 1.5 s apart on the bed; `src/moderation/completion.ts`), worked out on the page from the analysis inside the clip, which it reads alone with a few range requests, never the video, and keeps in the browser, lets the owner play one (the page fetches it and plays it from a `blob:` address, so the CSP is unchanged), list a clip with a title or rename a listed one (`PUT /shares/<id>/example`), take a clip out of the examples (`DELETE /shares/<id>/example`: it goes back to a plain link, deleted 90 days later) and delete one for good (`DELETE /shares/<id>`). The page is in English only. There is no approval step: a clip is listed as soon as its uploader asks. Set up once, before the first deploy with the `SHARES` binding: `make worker-r2` (creates `trampovision-shares` with its 90-day rule on `shares/`; a bucket made before the examples needs `make worker-r2-prefix` once, because its rule covered the whole bucket and would delete the listed clips too); the deploy token (`CLOUDFLARE_API_TOKEN`) may also need _Workers R2 Storage: Edit_ for the binding.

**The reviewer page.** The home page links to it (_Review jumps_, with the number of jumps waiting; the link only shows when the build has a review service). For the jump on screen it shows the automatic answer, the skeleton replay (it plays by itself) and the measured curves. The skeleton is in 3D: drag to turn it, Shift-drag or two fingers to move it, wheel or pinch to zoom, double-click or _Reset view_ to come back to the camera's point of view; _Side_ and _Top_ jump to those views, and _Upright_ keeps the trunk upright so the twist is read from above the head (a ring shows the shoulder line at takeoff and how far it has turned, to compare with the twist dial). The chest arrow and the shaded torso show which way the athlete faces. Jumps saved before the 3D joints were kept (`pose3d` in the record) show a flat skeleton. A bar that stays at the bottom holds the verdict: **Confirm** (Enter), _Cannot tell_ (U), _Bad data_ (B), _Skip_ (→), _Back_ (←). To correct, everything is on the same screen: the classifier's alternatives (one click, or keys 1 to 5), and four rows of buttons (somersaults, direction, twists, position) that always land on a figure of the table, then _It was: …_. After each verdict the page moves to the next jump. The tabs (_To review_, _Confirmed_, _Corrected_, _Unknown_, _Bad data_) show the counts, and any jump can be re-classified again from its tab.

### Scoring the classifier on reviewed jumps

`make eval-run FILE=eval/export.ndjson` runs the current classifier again on the stored jumps (a record holds the features, the sequence
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

Real footage has no ground truth until someone watches it. `make eval-label-sheet FILE=eval/clip.dataset.json VIDEO=video-sample/clip.mp4` reads a
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
labels** writes them as the label file above: put it in `eval/labels/` and `make eval-run` scores each question. **Import labels** does the reverse (jumps
are matched by apex time, and the app asks first when the file names another video).

`make eval-run` reads `eval/labels/` by default (`LABELS=dir` to change it, several `FILE`s are fine). A complete label (somersaults, direction when
it somersaults, twists, position, and an element of the table) counts as the figure for the scores above and as an example for the leave-one-video-out
run. Next to them it prints **one score per question**: rotation (whole somersaults), direction, twists and position, each over the jumps where that
stage is labelled, with how often the classifier gave no answer, how many directions were assumed, and the measured rotation against the label in turns
(bias < 0 = read short). Quarter and half rotations are not in the table, so they only feed that measurement error. `eval/` is git-ignored, so are labels.

### Rotation quality without labels

`make eval-consistency FILE=eval/dong-dong.dataset.json` (`src/eval/consistency.ts`) needs no labels. For the rotating flights (net rotation above half a turn, or a flight of at least 1 s whose orientation path adds up to more than 0.75 turns: a rotation lost to flips) it reports the share that pass each check: orientation turns one way (`monotonic`), no step above the limit between two samples (`noFlip`), the ankle-to-head line turns like the trunk (`crossCheck`), the net rotation is near a half-turn multiple (`onGrid`), the facing is known and the 3D twist is reliable. `clean` is the share that pass the first four. It lists the flights worst first with the checks each fails. `FILE` is a dataset JSON, the review service's export, or a saved pose series, which is analyzed again with the current code, so two versions of the pipeline can be compared on the same video. `SAVE=` / `BASELINE=` work as for the scoring above. It says nothing about whether the name is right: it is the number to push up while there is nothing to score a name against.

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

**How to read this.** If a pose model returned the shoulder and hip lines of a rigid body with the noise simulated here, the half twists can be counted, and the estimator declines when the signal is weak (few frames per half twist, much noise or missing data, a late twist). The oblique camera row shows a limit that is geometry, not noise: a somersault seen from an angle makes the shoulder line swing with the somersault, which looks like a twist; the amplitude is then implausible, and the estimator declines instead of counting it. The table is optimistic: the simulation has no systematic pose-model errors (a model that collapses the shoulder line when it is edge-on, a face that is mislabeled, arms swinging in front of the shoulders), the twist profile of the simulated athlete is inside the family the fit chooses from, and the shoulder width of the model is only checked within ±25% of a prior of 0.76 trunk lengths (hips 0.40). **There is no real twisting ground truth yet**: the Dong Dong clip is not labeled. What `make eval-run` would have to show on labeled real jumps is the table above with real numbers; until then a 2D count is a second opinion, and the classifier's limitations list says so each time it relies on one. The 2D count is not saved in the dataset records yet, so `make eval-run` does not replay it.

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
- **The classifier's guesses are only as good as the pose.** There is no set of real athletes' jumps to score them on yet: the 17 reviewed jumps available to `make eval-run` when this was written come from the synthetic athlete, so the accuracy on real footage is not known. Quarter-turn skills (a Cody, a ¾ somersault, drops) are not in the element table: they are named after the closest whole element, flagged as a guess.

- **Skill thresholds and confidence are untuned.** The hip/knee limits, the rotation tolerance and the confidence formulas are my estimates. They need labeled real jumps to tune and to calibrate the confidence.
- **Front vs back** depends on the facing estimate; in a side view with pointed toes and a turned head the cues can be weak, in which case the app reports it and asks for a manual setting.
- **The skill analysis is 2D.** Angles and rotation are image-plane projections. They are correct only for a fixed camera looking roughly
  perpendicular to the plane of the skill, and a somersault seen from an angle is under-counted. Twists come only from the experimental 3D estimate, which depends on a single-camera model's depth (see _3D pose and twist_).
- **The 2D twist count is unvalidated on real twisting athletes.** It is exact on a simulated athlete with noise and gaps (see _Twist from 2D cues_), it assumes a typical shoulder width, cannot tell the direction or when the twist happened, and is misled by an oblique camera on a somersault (it declines then). It is saved neither in the dataset records nor in `make eval-run`.
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
  requests at runtime (`localOnlyGuard.ts`) and the production build enforces `connect-src 'self' blob: data:` via CSP. Video frames are never uploaded, except when a person asks for a share link (see _Shared clips_).
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

## Experimental pose engines

Advanced tools on, Settings → Analysis → **Experimental → Pose model** picks the engine that finds the body points. **MediaPipe** (default) is the one the whole app was built and checked with. **RTMPose-m** and **ViTPose-B** are there to test whether another model follows the athlete where MediaPipe loses them (upside down, tucked, blurred). Off by default; with the advanced tools off, MediaPipe is always used.

How it works (`src/pose/onnx/`): a person detector (YOLOX-s) finds the people, a top-down pose model reads a 192 × 256 crop of each, and the points are converted to the 33-point BlazePose layout the rest of the app reads. They run with ONNX Runtime Web (WebGPU when "Use the GPU" is on and the browser has it, else WebAssembly), and are loaded only when picked. The engine used is saved in the analysis (`backend`).

| Engine  | Points                    | Feet and hands                                                                            |
| ------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| RTMPose | Halpe 26 (COCO 17 + feet) | Heels and toe tips yes; fingers no                                                        |
| ViTPose | COCO 17                   | No heels, toes or fingers (the center of mass leaves those segments out and renormalizes) |

Files: `npm run fetch-assets` downloads `yolox_s.onnx`, `rtmpose_m_halpe26.onnx`, `rtmpose_x_halpe26_384x288.onnx` (the second look) and `vitpose_base_simple.onnx` into `public/models/` (a failed download only prints a warning; the app then says which file is missing). With an asset host, `npm run assets-upload` uploads them and the ONNX Runtime wasm too.

**What has and has not been checked.**

- Checked in headless Chromium (WebAssembly): ONNX Runtime loads from the build, the real YOLOX-s finds a person in a photo (same box as the reference Python code), and the whole pipeline (detector, crop, decode, conversion to 33 landmarks) gives the exact coordinates expected from small synthetic pose models with known outputs. The decoders, the crop geometry and the point conversions have unit tests (`src/pose/onnx/onnx.test.ts`).
- **Result: inconclusive.** The real RTMPose and ViTPose files were tried and did not give a clear gain over MediaPipe, so MediaPipe stays the default. They are kept as an experiment for future research, not as a recommended option. Treat the assumptions below as unverified: RGB input with the usual mean and standard deviation, a 1.25 padded box, SimCC output with a ratio of 2 (RTMPose); heatmap output `[1, 17, 64, 48]` (ViTPose). The WebGPU path was not run.
- The scores are not on MediaPipe's scale. The analysis ignores points under 0.4, which may be too strict or too lax for these models.
- 2D only: no 3D landmarks, so no twist estimate (see "3D pose and twist"). The person detector runs on every analyzed frame, so these engines are slower than MediaPipe, and ViTPose-B is a large file (hundreds of MB unless a quantized export is used).

## Second look: checking the pose, and two models merged

Settings → **Second look** → _Read the hard moments again with RTMPose-x_ (off by default; remembered on the device as `trampovision.second`). After MediaPipe has read the clip, the app checks how well it read each athlete, reads the frames where it is unsure again with a stronger, slower model, and merges the two readings. Nothing changes where MediaPipe was sure.

**The check** (`src/analysis/poseCheck.ts`, no labels). A flight is doubtful when its trunk joints were not measured in at least 90% of its frames, when the orientation tracker had to turn a reading over (head where the feet are), when the rotation fails the classifier's own checks (it went one way and came back, it jumped by more than 120° between two frames, the ankle-to-head line did not turn with the trunk by 60°), when the core joints scored below 0.6 on average, or when the athlete rotates by more than 90°: MediaPipe is weakest upside down. Frames without the athlete within one second of frames with them are read again too. A doubtful flight is read again with 0.2 s on each side.

**The second model**: RTMPose-x, Halpe 26 points, 288 × 384 crop, read plain and mirrored and averaged (the flip test): rtmlib's "performance" pose model (`rtmpose_x_halpe26_384x288.onnx`, 200 MB). It does not look for the athlete itself: it reads the box around where MediaPipe saw them, cut from the full-resolution frame, so a small athlete is read large; where MediaPipe lost them, the box comes from its own reading a moment before or from MediaPipe's readings on both sides of the gap, and YOLOX-s puts it on the nearest person (`src/analysis/refinePose.ts`). Also in the engine list (Experimental → Pose model) to run on every frame.

**The merge** (`src/pose/fusion.ts`). The two models' scores are put on one scale first (MediaPipe's visibility is near 0 or 1; RTMPose's sits between 0.45 and 0.9, so its 0.6 counts as sure). Where both found the athlete and their joints are within 0.2 torso lengths (median), the score-weighted mean is kept, with MediaPipe's 3D landmarks (the twist needs them) and its hands and face. Elsewhere a path search over the frames picks, frame by frame, MediaPipe's reading, RTMPose's, or neither (the frame is then bridged by the analysis): confident joints and the athlete's own proportions are cheap, a change of shape between two frames is expensive (a head/feet flip changes it by two torso lengths, a double somersault by a third of one). Where RTMPose's reading is taken, MediaPipe's 3D landmarks of that frame are dropped: they were as wrong as its 2D ones.

**Measured** (headless Chrome, WebGPU, Apple silicon; the label-free rotation checks of `make eval-consistency` on the saved analyses; MediaPipe alone → with the second look):

Each row compares the first pass and the merged track **of the same run** (the app's analysis varies from run to run on these clips, so two separate runs would not compare). _Clean_: rotating flights that pass the four rotation checks.

| Clip (frames)                                        | Frames with the athlete | Flight frames with the athlete | Head/feet flips | Clean rotation | Twist reliable | Time          |
| ---------------------------------------------------- | ----------------------- | ------------------------------ | --------------- | -------------- | -------------- | ------------- |
| Phone close-up, portrait (420)                       | 359 → 391               | 280/288 → 284/290              | 13 → 0          | 2/5 → 5/5      | 40% → 40%      | ~95 → 128 s   |
| Wide tripod, landscape (1075)                        | 703 → 902               | 489/552 → 697/698              | 0 → 0           | 0/4 → 2/5      | 25% → 60%      | 268 s         |
| Synchro, the athlete followed through the clip (942) | 636 → 826               | 397/485 → 599/625              | 80 → 0          | 0/3 → 1/2      | 0% → 0%        | 550 s, loaded |
| Broadcast, Dong Dong (1243, 25 fps, follow camera)   | 713 → 820               | 524/608 → 680/795              | 8 → 14          | 1/3 → 1/5      | 0% → 0%        | 560 s, loaded |

Checked on the video: in the synchro clip both athletes turn a full back somersault at 10.2–11.7 s; the merged track reads −0.98 turns, MediaPipe alone 0.03 to 0.13. On the broadcast clip MediaPipe alone made one 2.9 s "flight" of −2.76 turns out of 38.8–41.7 s; the video shows two jumps there (landings near 40.0 and 41.8 s), which the merged track finds (−1.90 and −1.74 turns). The broadcast is the weak case: the merged track also builds a 3.7 s "flight" out of sparse frames at 34–38 s (the jump detection has no limit on the length of a flight) and its rotation checks fall (crossCheck 100% → 60%). No merged frame put an athlete on another athlete's person (checked on every clip; a first version did, on the broadcast, where the first pass splits the athlete into several tracks: a reading found in a gap is now refused when another athlete holds that person in that frame).

`make eval-fusion FIRST=mediapipe.json SECOND=rtmpose.json` replays the check and the merge offline from two saved analyses of the same clip (`ALL=1` merges every frame). On the earlier RTMPose-m exports of the same clips the merge was insensitive to its weights (the decisions come from the agreement and from which model found the athlete), and merging every frame instead of the doubtful ones changed nothing measurable.

**Limits.** The second model needs WebGPU to be quick: on WebAssembly (no cross-origin isolation, so one thread) one RTMPose-x read took about 2 s in Node, and the flip test reads twice. Not measured on a phone. It reads only where MediaPipe or its own previous reading saw the athlete: an athlete MediaPipe never found (the competition clip filmed from behind the end deck) stays unfound. The check flags most of a routine of somersaults (they are doubtful by themselves), so on such clips the second look reads 79 to 96% of the frames. RTMPose gives no 3D: frames taken from it have no twist reading. The asset host must have `rtmpose_x_halpe26_384x288.onnx` (`npm run assets-upload`); without it the second look says it could not run and the analysis stays MediaPipe's.

## Motion detector

A layer that goes in front of the pose model and finds the athlete **from the way they move**, so that the rest of the picture can be painted over before MediaPipe looks at it. It uses no model and no training, and the mask is **not** made from the pose. It is **wired into the analysis by default**: every analysis runs the clip live through the detector — the background hidden, the zoom view where it helps (`ZoomGate`), the person who jumps chosen among the people found (`JumperSelector`) — and a switch on the first screen and in the settings (_Follow the person who jumps_, the same choice, remembered on the device) skips it, for a faster analysis that reads the clip as it is. On a camera that follows the athlete it steps aside by itself (see _follow clip_ below). The pose, rotation, twist and classification code are unchanged; the advanced tools also link to the detector's own page (a card on the first screen).

**See it.** With the advanced tools on (Settings), open _Motion detector_ on the first screen; or `npm run dev`, then <http://localhost:5173/motion.html> (it is in the production build too, at `/motion.html`). Choose a video (it stays on your device), or one of the app's samples from _Try a sample_ (the list is there when the build has an asset host, like the app's own sample menu); once a video is open the two give way to its name and _Reset video_, which goes back to choosing one. Play it: the **original frame**, the **motion map** (blue moves up, orange moves down, the gold strip is how well each column repeats like a jump, the gold box is what moves of the athlete, the dashed white box the skeleton the mask keeps too), the **athlete mask**, the **masked frame**, what the pose models were **given** (the masked frame, or the athlete zoomed and turned upright when those two boxes are ticked; the frame as it is once the camera is seen to follow the athlete, as in the app), and then **one panel for each pose model** that is ticked under _Pose models to compare_ — MediaPipe lite, full (the app's, ticked by default) and heavy, RTMPose-m, ViTPose-B — each with the skeletons it found in the same picture (the person who jumps in colour, anybody else faint), its time and how many of the 13 body points it saw. _Pose models side by side_ adds them up since the video was opened: in how many of the frames where the detector knows where the athlete is each model found them, how much of them it saw, and its time a frame (each model rates its points its own way, so the points are a rough comparison). The measurements and the sliders for the thresholds are below. _People kept_ is one by default, the one who jumps the most, and two for synchro. _Hide the background before the pose models_ turns the mask off, to compare the same frame both ways. _Keep the skeleton of the first model in the mask_ and _Look for the athlete above the place they jump in too_ (see step 4) are off when the page opens, as they are in the app: they are there to try, and what is ticked goes to the app with _Load in TrampoVision_. On a computer the playback is a bar above the panels (play, next frame, back to the start, the position; Space plays and pauses). On a touch screen every video is its own control: a tap plays or pauses, a finger slid sideways on it moves the position (the whole clip across its width), and up and down still scrolls the page. The page is in English only: it is a tool for working on the detector.

**Use the result in the app.** The button at the bottom of the page, _Load in TrampoVision_, first looks at the start of the clip with a detector of its own, until it has found the athlete and seen a jump more (`scout.ts`; at most 20 s), then runs the whole clip through the detector from its first frame, with the settings as they are on the page, and makes a video of what the pose model would have been given: every analyzed frame, with the background painted over around the athlete (`resultVideo.ts`; the pose model is not used). The look at the start is what masks the first seconds too: without it the detector needs two and a half jumps to be sure, and those frames, with the people who stand around the bed in them, would be given to the pose model as they are, and the app, which follows the biggest person of the first frame, could follow one of them. It is an MP4, H.264 or, where the browser cannot encode H.264, VP9, made by the encoder of the video exports. The page leaves it in a small database of its own in the browser (`handoff.ts`), goes to `/?from=motion`, and the app takes it out once (`App.tsx`) and opens it as if it had been chosen there. The page leaves the clip as it was, which the app shows (and exports), its settings, and the masked video (named after the clip with `-masked.mp4`). The app analyzes the clip live through the detector with the page's settings (`PageSettings` in `handoff.ts`), so that it sees what the page showed: the detector's thresholds, the kind of shot, the people kept, the look above the region, the color of the hidden part, the boxes (hide the background, keep the skeleton in the mask, zoom, turn), and the first pose model ticked, on the GPU or not as the box says. The app's own choice of model is not used for that clip, and a notice says so. What comes after the pose model stays the app's: who the jumper is over the whole clip (`'travel'`, see _Choosing the athlete_), the tracks and the jumps; the page shows each frame's skeletons, the app a track. The masked video is what the pose model reads when the motion detector is switched off in the app's settings; the landmarks are then put back in the pixels of the clip (`fitTrack.ts`), so the skeleton lands on the athlete in the picture that is shown. The page's zoom goes through the same `ZoomGate` as the app's (only a small athlete on a steady shot is zoomed), and is ticked when the page opens, as it is on in the app. If the detector hid nothing in the clip, the page asks first, because what it would load is the clip as it was. The video never leaves the device.

**How it works** (`src/motion/`, every threshold in `config.ts`). Every frame is made small (128 px wide, gray), then:

0. **Camera** (`camera.ts`, `cameraType.ts`). First the whole picture is measured: one translation between this frame and the last, fitted on the background (a coarse-to-fine Lucas-Kanade fit with Tukey's biweight, so the athlete is an outlier, and a gentle prior that the background is at the edges and not where the detector found the athlete). Its speed and the width of the athlete tell which of three kinds of shot it is, and each is prepared its own way:
   - **Fixed wide-angle** (still camera, small athlete): the move of the picture, which is the shake, is taken out of the motion.
   - **Low-angle** (still camera at the bed, looking up, athlete's box wider than 36% of the picture's shorter side): the same, with the athlete kept out of the fit and a bigger piece of motion needed to count as an athlete (`CAMERA_PROFILES`). It is the shorter side that counts: measured against the width, a video held upright read every athlete as a big one (the width is its shorter side) and one held sideways almost none.
   - **Close-up that follows the athlete** (or any camera that pans): the move is taken out, and motion has to be faster than the camera's own error to count (`cameraSlack`). What is left to see is the athlete against a background that stands still, as in a fixed shot.

   In every kind of shot, what the detector remembers (what went up and down through a pixel, the column rhythms, the mask) moves with the picture by the move that was measured, so it stays on the same place of the scene; with a camera that stands still that move adds up to nothing. So a change of the kind of shot drops nothing: it only changes thresholds. (It used to drop everything on entering the following kind, and a phone in a hand, whose speed sits around the threshold, lost the athlete for seconds at every change: 3 s in the synchro sample, 3 s in the portrait one.)

   The kind is read all the time, with a high and a low threshold and a hold of 2 s so it does not flicker, and can be forced on the debug page (_Kind of shot_). A frame whose move could not be told is left out of the reading, and is not counted as a camera that stands still. When the move cannot be told (a plain wall) nothing is said about the frame in a following shot, and the old vertical-shake fit is used in the others. The picture is never hidden for it: the mask opens by itself as what was remembered fades.

1. **Motion** (`verticalFlow.ts`). Lucas-Kanade over windows of 9 × 9 pixels, solved for both axes, gives each pixel's vertical motion: up, down or none, and how sure. A body part moving much farther than its edge is wide still gives the right sign, which is all that is kept. Sideways motion (a person who walks, a camera that pans) is not counted as vertical, because the same solution says how much of the motion is vertical. A camera that shakes or moves is taken out first (step 0); where the move could not be told, the columns that agree on a vertical shake (an athlete is a few columns, so they are outvoted) are used.
2. **Tracking.** Each pixel remembers for 2.5 s that something moved up through it, and that something moved down. A move that only goes one way (someone lifting a box) is not an oscillation.
3. **Rhythm** (`rhythm.ts`). Each column keeps the direction of its motion for 8 s, and its autocorrelation must have: a dip below zero (it went to the other side), then a peak at a jump's pace (0.65 to 2.6 s), the first one that is nearly as high as the highest (a hand that waves at 2 Hz repeats every 1 s too, and is not a jump), and the same again at twice the period (two events the same time apart correlate, but there is no third). That takes two and a half jumps, so the mask closes in on the athlete about 2.5 s after they start bouncing.
4. **The athlete and the mask.** The oscillations in the columns with a rhythm make regions (a pixel enters one high and leaves low, pieces that are too small are dropped). The video is of one person who jumps, so **only the strongest region is kept** (`maxAthletes`, 1 by default; 2 for synchro): the one with the most up and down motion, and a region that is where the one followed was counts 1.6 times stronger than it is, so that two that are about as strong do not take turns. A person who stands in the place the athlete jumps through, or who bounces less, is not the athlete. The region is **where the athlete jumps**, which is wider than the athlete: the athlete is the **box of what moves in it right now**, the pixels that changed by 5 noise levels or more since the last frame once the shake of the camera is taken out (the same change the flow is made from, kept as it is and not reduced to a sign), in the columns with a rhythm, kept for 0.15 s so that the frame at the top of a jump, where the athlete stops, is not a hole, the pieces closer than 3% of the picture joined and the specks dropped. A real bed moves with the jumps too (it goes down at every landing, shakes after, and carries the athlete's shadow), and so does a line of the wall when the camera's move is taken out: they are **bars**, rows of moving pixels far wider than the body's rows, and are taken out before the pieces are joined (`dropBars`); of the pieces, a flat one counts for less than a body-shaped one, and a part joins the body only within a body length and no wider than it (`boxIn`). Without that, on real footage, the box was the whole trampoline. The box can be looked for in the region's columns from its bottom up to the top of the picture (`searchAbove`): the region is where things went up and down, so the top of a jump higher than the ones it was learnt from is not in it yet (on the wide tripod sample the detector found the athlete during low bounces, and the box of the next, higher jump stayed on the bed while the mask hid the athlete). The debug page can (a box in its settings, off when it opens); the app does not by itself: through the whole app the tripod sample gained nothing from it (706 and 715 frames with the athlete without it, 705 with it), and the synchro sample swings too much from run to run to tell (542 to 623 frames in five runs without it, 76 in a sixth; 384 and 76 with it). The mask can also keep the skeleton the pose model found in the frame before (`seeBodies`), when its middle is in those columns, because a body does not always move enough to be seen moving: legs held still in a pike or as pale as the bed, a body at the top of a jump while only the bed moves. Frames in which the mask hid part of the athlete's body, before → after these two (the skeleton of the frame before standing in for the pose model's): wide tripod 15.2 → 1.6% and the whole athlete 2.7 → 0.5% (checked against RTMPose run on the clip without a mask), phone close-up 22.1 → 3.6%, synchro 11.4 → 0.5%, the still start of the broadcast 57.9 → 0%, for a picture kept 0.2 to 3.5 points bigger. The debug page can tell the detector the skeleton (a box, off when it opens); the app does not by itself (`keepBodies` of `withMotionMask`, off; these runs had `searchAbove` on too): through the whole app it gave the wide tripod sample 706 → 749 frames with the athlete (in flight 537 → 693), but on the synchro sample the athlete's track broke in 4 runs of 4 (frames with the athlete 542 to 598 without it, 11 to 337 with it), though frame by frame the pose model found the jumper as often — the app's tracking downstream changed, and why is not understood yet. The mask keeps that box with a margin of 5% of the picture's shorter side and a soft edge of 4%, and hides the rest, flat gray; when nothing moves in the region (the athlete stands on the bed) the region itself is the box. The background fades in over 0.6 s once the athlete is found and out over 0.6 s when they are lost. The mask follows the athlete, so unlike the first version, a band that the athlete sweeps through, it leaves out the people who stand behind or next to the athlete's path.

**The mask never hides the picture when it is not sure.** Until it has seen a rhythm (about two and a half jumps), when nothing jumps, when a frame cannot be read, or when the layer fails once, the pose model gets the video as it is. The one exception is _Load in TrampoVision_, which looks at the start of the clip first (see above) and masks around where the athlete will be from the first frame.

**Using it before MediaPipe.** It plugs into the seam that already exists (`ExtractOptions.createEstimator`), so nothing in `src/pose` or `src/analysis` was edited:

```ts
import { withMotionMask } from './motion/maskedEstimator';

const tracks = await extractPoseTracks(url, {
  ...options,
  createEstimator: withMotionMask(estimatorFactory('mediapipe')),
});
```

Every engine reads it: `PoseEstimator.detect` takes a video or a canvas (`PoseSource`), MediaPipe accepts both as it is (the model probe in `MediaPipePoseEstimator.ts` already calls it with a canvas), and the ONNX engines measure what they are given (`sourceSize` in `src/pose/onnx/geometry.ts`) instead of reading `videoWidth` — so the zoomed view, which is what lets any model see a small athlete, feeds RTMPose and ViTPose too.

It gives the pose model's people back narrowed to the person who jumps (`focus`, on by default). Who that is is decided two ways: once somebody's hips have travelled up and down like a jumper's, the choice is by that travel (`jumperSelect.ts`: the people of each frame are joined frame to frame into tracks by their nearest hips, and the athlete is the track that travels, turns and moves at a jumper's pace — a spotter who stands right under the jumper's path, bigger and nearer the camera, barely moves theirs; see _Choosing the athlete_ below); until then, and whenever nobody travels (the first jump, or a camera that follows the athlete and keeps them still in the picture), it is the person in the athlete's box of the detector, as before. A frame where neither is found is left empty, which the tracker of the app treats as a lost frame. The app's own analysis asks for the stricter `focus: 'travel'`: nobody is given back before the travel knows (the app's tracker locks on the first person it is fed, and the motion box would feed it the spotter) — except on a **follow clip**: once the camera has moved at a follow camera's speed (`FOLLOW_SPEED`, 0.18 shorter sides a second: the other sample clips never cross it — peaks 0.001 for the wide tripod, 0.112 for synchro, 0.153 for the phone close-up — a broadcast that follows 0.2 to 0.8) for one unbroken second (`FOLLOW_KNOWN_S`), the detector steps aside for the rest of the clip: the pose model reads the frame as it is (no mask, no zoom) and everybody it finds goes through, so the app's tracker chooses as it does without the detector. Both halves were needed. The motion box of a following shot sits off the athlete much of the time (the camera's own move is taken out imperfectly: boxes on the stands, on a logo), and the mask, keeping 3 to 12% of the picture, hid them; and the panning camera sweeps the people behind the bed through the picture, so their hips "travel" and the travel chose them. Through the whole app on the broadcast clip (25 fps, CPU delegate), frames of the routine (20 to 45.5 s) with the athlete: 122 of 638 with the mask and the choice, and not one somersault measured among its jumps; 151 with the mask off; 246 stepping aside, with the three somersaults the plain analysis reads (1.72, 1.97 and 2.76 turns) — the plain analysis on the same delegate: 247. The still first 6.4 s are still read the strict way (the follow is not known yet): 367 of the first 500 frames against 462 for the plain analysis. Two options prepare the picture after the mask: `view: { zoom: true }` gives the pose model a square around the athlete, made big — used only while a `ZoomGate` says it helps: the camera slow and the athlete small, see _Zoom and turn_ — and `view: { rotate: true }` turns the picture so that an athlete in a somersault stands upright, zoomed or not, learning the turn from the person who jumps (off: on real somersaults it made things worse, see _Zoom and turn_); what the model finds is taken back to the frame (`view.ts`), so nothing downstream knows.

**What has been checked** (the unit tests are in `src/motion/*.test.ts`; the scenes are synthetic, drawn with soft edges, with the athlete, walkers, a waving hand, bystanders, noise and a shaking camera in them, and the truth of where the athlete is):

- **Synthetic scenes** (`detector.test.ts`). With one athlete (22 pixels tall in a picture 72 high), the athlete is found about 3.8 s into the clip (they start jumping at 1 s), the mask keeps all of the athlete's pixels in every frame once it has settled and about 9% of the picture, the period is read (1.1 s read as 1.0 to 1.2 s), and the mask follows the athlete without flicker (a few pixels a frame, in the frame where the athlete turns round at the top or the bottom of a jump, cross the half line and come back). The same holds, with the limits written in the tests, for a person who walks at the side, a waving hand and two bystanders in a noisy video with a camera that shakes (the mask keeps about 14% of the picture, and none of the bystanders); somersaults, whose arms and legs sweep around; a slow high jump (2.2 s a jump); a portrait video; an athlete who fills the picture; and a camera that shakes by 0.8 px (in noisy, shaky videos the edge of the box moves by a pixel now and then: about 20 pixels a frame, 0.2% of the picture, cross the half line and come back). **A person who stands still** 26 pixels from the athlete (more than a body height) is hidden (under 5% of their body is seen), and one only 15 pixels from them (about 0.7 of a body height) shows a little of the edge (7%). **Two people who jump:** by default only the one who jumps the most is kept, and it is the same one all the way, even when the two jump about as much; a person who only bounces a little next to a high jumper is hidden; with `maxAthletes: 2` both are kept (synchro). A person who stands, paces or runs, with no athlete in the scene, never makes a region: the mask stays fully open in every frame. After the athlete stops, it opens again by itself.
- **A synthetic gym as a video** (VP9, 640 × 360, 30 fps, 3 Mbit/s, a camera that shakes by up to 1.5 px, noise, a person who paces, a hand that waves at 2 Hz, two bystanders), decoded with ffmpeg and reduced the way the page does. The columns of the athlete have a rhythm strength of 0.78 on average and 0.55 or more in every frame from 5 s on; the columns of the walker, the bystander and the bare wall average 0.19 to 0.21 and reach 0.3 in at most a quarter of the frames (never 0.55), and the waving hand's never reach 0.3. The period reads 1.07 to 1.10 s (the truth is 1.10 s). The codec and the shake make the motion map noisy (the beam and the edge of the bed flash in some frames: the camera shake is only taken out to within 0.1 px or so), which is what the column rhythm, smoothed over 0.6 s, is for.
- **A photo of a person as a video** (the yoga photo of MediaPipe's test assets, cut to the person and moved up and down like a jump, 1.1 s a jump and 150 px of 540, from 1 s, over a different background; a second copy of the person walks across the picture; 960 × 540, VP9). (Measured with the first version of the mask, a band the athlete sweeps through, which kept 51% of the picture here; the mask is now a box around the athlete, see the next bullets.) In headless Chromium with the CPU delegate, through the page's own pipeline, the athlete is found from 3.8 s on and the period reads 1.10 s. From 5 s on, MediaPipe finds the jumper in 100% of the frames with the mask and without it. The second person is found in 70% of the frames without the mask (1.70 people a frame on average) and in none with it (1.00). So on this clip the mask hides a person the pose model would have followed, and costs nothing on the athlete. It is **one clip, and a photo that moves as a rigid piece** (its arms and legs do not move), so it says that the whole chain works, including a canvas as the input of MediaPipe; it is no evidence about real athletes. Time: the detector and the painting of the mask took 6 to 15 ms a frame at 960 × 540 here (3.4 ms for the detector alone in Node, at 128 × 72), the pose model about 80 ms on the CPU.
- **Scenes with a real wall** (`testScenes.ts` takes a photo as the wall: the made-up wall is smoother than a real one, so the real texture, the flat areas and the strong edges of photos of rooms from MediaPipe's test assets, 128 × 72 pixels, made soft like a video, with the same made-up athlete, 12 to 30 pixels tall, 1.1 s a jump, from 1 s, noise, and a camera that shakes). **Compared with the first version of the mask, same scenes:** the athlete's pixels are kept as before (100% on average, and in the worst frame, with a camera that shakes by 0.5 px); the share of the picture that is kept drops from 11 to 35% to 5 to 18%; a person who stands still 14 pixels from the athlete (a body is about 9 pixels wide, so their body starts 10 pixels from the athlete's middle) was seen 80 to 100% before and is seen 19 to 41% now, and one 22 pixels away 4 to 33% before and 0 to 2% now. In a noisy video (noise 0.014, shake 1.2 px, a light that flickers) the athlete is kept 98.7% to 100% on average and, for the small athletes, 75 to 81% in the worst frame: the edge of the box is a frame late now and then. A smaller margin (3% of the picture) hid more of the people who stand near but lost the athlete in the worst frames (and all of a 12-pixel athlete in one frame of the noisy video), so it is 5%. **These are made-up athletes on real walls.**
- **The look at the start, and the masked video** (a synthetic clip: a photo of a person, 200 pixels tall in 960 × 720, jumping and somersaulting over a photo of a room, VP9, 14 s, through `renderMaskedVideo` in headless Chromium). The look at the start found the athlete at 3.8 s and gathered the boxes for 2.2 s more (179 frames in all); the clip took 63 s with software GL (no GPU), and the detector hid the background in all 420 frames, from the first (in 308 of 420 without the look at the start). `ffprobe` reads 420 frames, 30 fps, 960 × 720. The first frame, the one at 2.5 s and one in the middle of a somersault are gray around the athlete.

**Real footage** (`make motion-eval FILE=clip.mp4 SHEET=boxes.png`: the clip decoded with ffmpeg the way the page reads it, the detector run over every frame, one line a second, and the box drawn on a frame every 3 s). The four sample clips of the app, with the detector as it was (tuned on synthetic scenes only) and as it is:

| clip                                             | an athlete found in | box width, 90th percentile (px of 128) | picture kept |
| ------------------------------------------------ | ------------------- | -------------------------------------- | ------------ |
| wide shot on a tripod, bystanders, a coach       | 81% → 81%           | 57 → 24                                | 17% → 10%    |
| synchro, two jumpers, phone in a hand            | 71% → 86%           | 31 → 29                                | 19% → 15%    |
| close-up, phone that follows, a person next door | 39% → 69%           | 127 → 113                              | 62% → 47%    |
| broadcast, camera that tilts, cuts               | 50% → 51%           | 26 → 25                                | 17% → 17%    |

The wide shot is the one that mattered: the box was the whole trampoline (the bed, its pads and frame rock at every landing and the athlete's shadow moves on them, all in time with the jumps), and it read as low-angle for it; now the box hugs the athlete. The jumper in the synchro and close-up clips really is that wide. The two phone clips were losing the athlete for seconds at every change of the kind of shot. The broadcast clip is unchanged (see the limits).

**What has been checked for a camera that moves** (`camera.test.ts`, `cameraType.test.ts`, the _a camera that moves_ and _the kinds of shot_ groups of `detector.test.ts`; synthetic scenes where the picture is a window moving over a bigger scene, made soft like a video). The estimate of the move is off by 0.03 to 0.04 px on average for a pan of 0.3 and 0.2 px a frame, with and without a big athlete in the middle, and finds a tilt of 3 px a frame (a camera that follows a high jump) in nearly every frame after the first ones. For a close-up that tilts to follow the athlete (it keeps 50, 90 or 100% of the athlete's height, three seeds) and a wide shot where the person who films sways from side to side, the kind is read as moving within 4 s, the mask keeps all of the athlete's pixels (the tests ask 97%) and leaves open 0 to 4% of the picture far from them (3% for the sway). With the kind of shot forced to a still camera the same close-up works as well now (the memory moves with the measured move in every kind of shot; it used to leave about 24% of the far picture open). A still camera that starts to drift at 6 px a second, read as a camera that moves at about 7 s, keeps the athlete found through the change. The move of a camera alone, or with a person who walks to and fro, never makes a region. Forcing _close-up_ on a still camera works as well as _fixed_.

**The kind of shot always came out the same: what was wrong.** On the synthetic scenes and on the scenes with a real wall (still camera with a shake, a pan, a camera that follows the jumps fully or in part, a person who sways) the kind did follow the camera, so what happens on the real clips where it did not is **not known**. Two things were wrong, and are fixed (`cameraType.test.ts`, `detector.test.ts`):

- **The low-angle test measured the athlete against the width of the picture.** In a video held upright the width is its shorter side, so every athlete, even one a sixth of the picture's height, read as low-angle (a made-up athlete 22 pixels tall in a portrait picture 128 high: low-angle); in a video held sideways the athlete had to be more than half the height of the picture (40 pixels of 72), which hardly happens. The kind depended on how the phone was held, not on the shot. It is now measured against the shorter side (36% to enter, 30% to leave), which leaves landscape as it was.
- **A frame whose camera move could not be told counted as a camera that stood still**, which pulled the speed to zero and so toward _fixed_. It is now left out of the reading.

The debug page also shows what the kind is read from (_What the shot is read from_: the camera's speed against the level where it counts as a move, and the athlete's width against the level of low-angle), so that when it reads the same on a clip the numbers say why.

**The kind of shot, measured** (on the sample clips, offline, at the rate of the analysis; the reference is an independent one: phase correlation on the four corners of the frame, 512 px wide, the median of the four). The camera's move as the detector measures it is right: on the synchro clip it is off by 0.03 to 0.06 px of 128 a frame, and its vertical part follows the reference with a correlation of 0.95 to 1.00. Where a clip reads as _Close-up that follows_ the camera does move. The synchro clip is filmed with a phone in a hand that tilts up at every jump (about 5% of the picture: the ceiling comes into view at the top of a jump and the bed goes down), and reads so in 62% of its frames; the competition clip pans slowly from 8 to 14 s (50%); the phone close-up follows the athlete (50%); the broadcast follows (96%); the wide tripod shot never moves (0%). The kind changes within a clip, so it is read all the time: in the first 6 to 8 s (what the look at the start of the clip sees) all but the broadcast are still and the zoom gate is closed, while over the whole clip the synchro, competition and close-up cameras move and the gate is open in 77 to 80% of the frames of the wide shots. A kind forced for the whole clip (_Kind of shot_ on the debug page) changed the share of frames with an athlete found by 4 points at most (the competition clip: 74% read all the time, 70% forced to _Fixed_, 63% to _Low-angle_).

**Zoom and turn: what was measured** (off by default; `view` of `withMotionMask`, the two boxes of the debug page; a lab that is not in the repository: MediaPipe's pose landmarker _full_ in headless Chromium 141 with the CPU delegate, and one photo of a person standing, from MediaPipe's test assets). The question was whether turning the picture so that a somersaulting athlete is upright helps the pose model. **It did not, in these tests.** The pose model found the person at every angle:

- The person pasted on a gray picture of 960 × 720, 340 pixels tall (47% of its height; 30° steps, two photos, one of them a yoga pose) and 400 (56%; 90° steps), turned all the way round: found at every angle, 0.01 to 0.03 torso lengths from where the upright model put the points (moved by the same turn), no head and feet, no left and right swapped. A sequence of 72 frames in which they turn 8, 15 and 25° a frame: found in every frame, median error 0.01 to 0.02.
- What did decide whether the person was found is **their size in the frame**: at 260 pixels (36%) and below they were **not found in the whole frame at any angle**, and at 320 (44%) only when turned by 90° or 180°, not upright (a threshold effect: at 340 they were found at every angle). In a square cut around them (1.6 times their height) and made 512 pixels, they were found at every size from 100 pixels (14% of the frame) to 400, upright or turned, with or without turning the crop.
- Through the whole pipeline (`withMotionMask`, the detector and a real VP9 video of the photo of the person jumping and somersaulting every third jump, 14 s, over the photo of a room; frames from 5 s on, so 270, of which 91 in a somersault):

| the person is     | whole frame, no mask    | masked, no zoom         | masked + zoom                                                  | masked + zoom + turn                                                            |
| ----------------- | ----------------------- | ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 200 px tall (28%) | found in 0 of 270       | found in 0 of 270       | **found in 270 of 270**, 91 of 91 in a somersault, error 0.029 | 270 of 270, error 0.032 (0.045 in a somersault)                                 |
| 330 px tall (46%) | 270 of 270, error 0.023 | 270 of 270, error 0.023 | 270 of 270, error 0.023                                        | 270 of 270, error 0.024 (0.032 in a somersault; turning without zoom: the same) |

So **zoom** (a square around the athlete, which the motion detector's box makes possible) is what found a small athlete, and **turning** found nothing more and measured a hair worse (0.01 torso lengths in a somersault, the picture being resampled). The landmarks come back to the frame exactly through the zoom and the turn (the errors above are against the truth of the clip; the unit tests check the geometry, `view.test.ts`). **On real somersaults** (checked later, through the whole app, the clip chosen on the first screen and the export read back): the turn now works zoomed or not, learns the angle from the person who jumps (not from whoever is in the motion box), turns the whole frame about the athlete's own hips, and leaves the picture alone while two people jump. It was really used (a quarter to a third of the frames of the wide tripod clip were turned) and it **made things worse with MediaPipe**, frames with the athlete and somersaults measured, without → with the turn: wide tripod clip 728 → 635, 525 and 585 in three runs (somersaults 4 → 4, 1 and 5), phone close-up 360 → 333 (5 → 3), synchro 402 → 76; with RTMPose it changed nothing (652 → 659 and 363 → 364, the same somersaults, the same clean rotations). So it stays off. Likely why: MediaPipe already turns its own crop to the body it follows. What did read the somersaults better is the engine: with RTMPose, the label-free rotation check (`make eval-consistency`) passes 5 of 5 rotating flights of the close-up (MediaPipe 2 of 5) and 3 of 5 of the wide tripod clip (MediaPipe 0 of 4). Not checked: the GPU delegate; more than these four clips.

The same held on real footage (see _Choosing the athlete_ below), so the zoom is now used wherever it helps and left off where it hurts. It helps while the camera is slow and the athlete small, and hurts when either is not so (`ZoomGate` in `maskedEstimator.ts`, measured at 30 frames a second on five clips: the gate is on in 78 to 80% of the frames of a wide tripod shot, a synchro clip and the competition clip below, and 0% of a phone close-up and the broadcast clip — the kind of shot is not used, because the synchro and competition clips read as "tracking" in much of their length while the zoom helps them: their cameras are held in a hand and move, see _The kind of shot, measured_). And it is wired into the app for every clip: the default analysis runs the clip live through the detector (`withMotionMask` with `view: { zoom: true }`), and the gate decides frame by frame whether the zoom view is used — nothing changes on a clip whose athlete is big or whose camera moves. The motion page's handoff sends its settings, the zoom box among them, and the app analyzes the clip live with them (see _Use the result in the app_). A record left by an earlier page, without settings, still carries the gate's verdict instead: when _Load in TrampoVision_ saw the gate open in most frames (`ZOOM_WINS_SHARE`, `resultVideo.ts`), the app analyzes the clip itself, zoomed, and otherwise reads the rendered video.

**Choosing the athlete among the people the pose model finds** (`jumperSelect.ts`, checked with `make pose-eval FILE=clip.mp4 [ZOOM=1] [MASKED=1] [SHEET=chosen.png]`: the real pose model run over a clip in headless Chrome at 15 or 30 frames a second, what it found kept in a cache so a threshold can be replayed without the model, and a contact sheet with the chosen person boxed in yellow and everybody else in red). The pose model gives people without identity; the selector joins them frame to frame into tracks by their nearest hips (gated by the body's size and speed, surviving the model losing someone for 0.8 s), and the athlete is the track whose hips travel like a jumper's: far (10% of the picture or more — a spotter's measure a few percent, until they bend), turning like jumps do, or turning once at a jumper's speed (0.35 picture heights a second or more; a spotter's bend measured 0.2 — but it reaches 0.4 on the competition clip, so one turn alone is trusted only inside the athlete's known flight band). Against the hard cases of the competition clip it also keeps: the **stations of the standers** (a spot somebody stayed at without leaving for 2 s; hips found on a stander's station are never given back as the athlete — the jumper who lands right behind the spotter hands her track to the spotter for a few frames otherwise; the jumper's own apex is not a station, she dwells there a third of a second a jump), the **flight band** and the **athlete's size** (a bigger walker who crosses the picture with the camera shake on him is not her), and a hold on the title (a challenger needs 1.3 times the holder's travel). While no track has ever travelled, the choice falls back on the motion box; once one has, a frame without the athlete is left empty instead (better no frame than the spotter).

**The athlete's clothes** (`bodySignature` in `src/pose/appearance.ts`, the same signature the multi-athlete tracker uses: the mean color of the shirt and of the thighs, read from the clip itself) are a second memory. They settle the frame-to-frame association between two people equally near, and they take the athlete back after a gap no track survives (the model loses the jumper for whole jumps): somebody who wears her clothes, at her size, inside her flight band and away from the standers' stations, is her. The threshold is tight because the colors are read from few, small, motion-blurred pixels: measured at 30 frames a second on three clips, the athlete's own detections lie 0.01 to 0.08 (`signatureDistance`, 10th to 90th part) from her running look and everybody else 0.03 to 0.37, overlapping; swept on a 2× crop of the competition clip (the original is where the spotter is hardest), 0.05 (`LOOK_SAME`) takes her back in 19 more frames with the spotter chosen not once more than without looks, while 0.08 starts handing frames to the spotter. On the five clips, the looks lift the share of frames with the athlete by 3 to 4 points (portrait 62% → 65%, broadcast 38% → 42%, the crop 192 → 211 of the jumper's sightings) and change nothing on the clips where the travel alone was enough.

Measured on the competition clip (576 × 1024, the jumper about 60 px tall), 30 frames a second, over the routine (0–24.5 s):

- **Without the zoom view the pose model never finds the jumper**: 0 frames of 406 on the clip as it is, 0 on the masked video (today's handoff), about 6% on a 2× crop. It finds the spotter in nearly every frame. This is the real failure of the clip: not the mask, not the choice — the model cannot see a person this small, and whoever is chosen is chosen among spotters.
- **With the zoomed view of the motion box** the jumper is found in 133 frames of 736 (18%; the box is on her only part of the time, and she is blurred and upside down in much of her flight), and the selector chooses **her in 83 of her 133 sightings, and the spotter in 0 frames** (the lost 50 are mostly before anybody has qualified, in the first seconds). The rest are left empty. Today the app follows the spotter in nearly every frame of this clip. On the **GPU delegate** of a headless Chrome the model found her in half as many frames, with ghost detections, and the selector in only 6 — so the live zoomed analysis runs on the CPU delegate, the one all of these numbers were measured on.
- The four sample clips, share of frames in which the chosen athlete is seen (today's handoff path, the rendered masked video → the new one where the gate elects it): wide tripod shot 34% → 61% (the model often misses the small athlete on the masked video too; the zoom finds her), synchro 51% → 41% as two athletes (the choice holds the two jumpers but answers in fewer frames; with everything the model finds kept, 90% of frames have somebody), phone close-up 86% → unchanged (the gate stays off: the athlete is big, and zoom hurt her, 58%, when forced), broadcast 55% → unchanged (gate off; forced zoom measured 36%: the box is often wrong under the cuts and tilts). Replayed live-mask without zoom on the close-up measured 59–66%, below its rendered-video 86% for reasons not yet understood — another reason the gate, not the live path, decides.
- **Through the whole app** (the motion page's _Load in TrampoVision_, then the analysis, driven headlessly): the handoff carries the gate's verdict, the app analyzes the clip live with the zoomed view, the choice runs in `'travel'` mode (nobody is given back before it knows: the app's tracker locks on the first person it is fed, and the motion box would feed it the spotter), and `keepAthletes` keeps a sparse traveller over an ever-present stander. The exported track of the competition clip holds 83 frames, **0 of them on the spotter** (before: the spotter in nearly every found frame), 67 in the air, and 2 jumps are counted. 83 frames of 888 is the pose model's ceiling on this clip, not the choice's: see the second bullet. With the motion detector the default (no motion page involved: a clip chosen on the landing page, the analysis starting by itself), the same drive on the wide tripod sample exports a track with the athlete in 696 of 1075 frames (65%; the plain analysis found her in 34%) and 16 jumps counted, her hips never leaving the trampoline's columns.

**What has not been checked, and the limits.**

- **Real footage: four clips.** The detector was built and tuned on synthetic scenes only, and the first run on the app's sample clips (see _Real footage_ above) showed what they lacked: a bed that moves with the jumps, and a camera in a hand. Both are in the synthetic scenes and in the tests now, and the numbers above are from the samples. Four clips is not many: other gyms, other lights (a shadow that moves differently), a crowd behind the bed and a rolling shutter are not covered. The **broadcast clip** (a camera that tilts by 5 px a frame and cuts between shots) is found half the time with boxes on the crowd, before and after: that needs a cut detector, and a memory that survives a tilt of a whole picture height, and is not done. The analysis no longer leans on those boxes there: once the camera is known to follow, the detector steps aside (_follow clip_ above).
- **A spotter in the athlete's columns is not told from the athlete — by the pixels.** A fifth clip, a competition filmed from behind the end deck: the spotter stands at the end of the bed, right under the athlete's path, nearer the camera and several times bigger in the picture; people walk past in the foreground; a scoreboard changes its digits every second; the posts of the frame shake at every landing; and the athlete travels sideways across the bed. All of them move in the athlete's columns, and the spotter raises their hands at every landing, in time with the jumps, so the rhythm of the columns does not separate them. The box of what moves goes to the spotter, or to the two joined (the athlete lands behind the spotter, and a fast body's trail of moved pixels reaches down to them), in most frames. What was tried and did not hold: following the groups of moving pixels from frame to frame and keeping the one that travels up and down (the groups merge at every landing and come apart in pieces, and no rule of place or shape tells the athlete's piece from the spotter's reliably); taking the body in the upper half of the athlete's path (the two are one connected group too often, and the athlete leaves the columns). What does hold is choosing the athlete among the **people** the pose model finds, by the up-and-down travel of their hips — see _Choosing the athlete_ below, where this clip is measured.
- **Moving cameras: translation only.** See _What has been checked for a camera that moves_ above, and _The kind of shot, measured_ for real footage. The move of the camera is a translation: a zoom, a roll or a perspective change leaves the background moving a little, which the speed thresholds (`minSpeed`, `cameraSlack`) are there to absorb, not to remove. A pan slower than about 0.065 of the picture's shorter side a second (about 5 px a second at 72 px high) is read as a still camera. In a following shot the mask is the area the athlete jumped through in the last seconds, in the place of the scene, so with a tight close-up it can cover most of the picture.
- **It needs two and a half jumps** before it closes in, so the first seconds of a live view are not masked (_Load in TrampoVision_ looks at the start of the clip first, and masks them); low warm-up bounces make a small region. After the athlete stops, the mask holds for about 5 s and then opens by itself.
- **The mask is a box around what moves, with a margin, not a silhouette.** The bed inside it stays visible, and so does a person who stands within about half a body height of the athlete's edge (partly) or who stands behind the athlete's path while the athlete passes in front of them. The box is built from the change between frames, so it is only as good as that change: on a noisy video its edge is a frame late now and then, and the worst frames lose a little of a small athlete. The margin is a share of the picture (5% of its shorter side), because the size of the athlete is not known without a pose. **The person who jumps the most is the athlete**: a coach who bounces higher than the athlete would be chosen, and with two trampolines only one is kept unless _People kept_ (or `maxAthletes`) is 2.
- **Not checked**: the GPU delegate on a real GPU (the browser run used the CPU delegate; on the software GL of the headless browser the GPU delegate took about 5 s a frame), other codecs than VP9, other browsers than Chromium (Safari, Firefox), phones.

**The link, the samples and _Load in TrampoVision_** (`render.test.ts`, `resultVideo.test.ts`, `handoff.test.ts` for what has no browser in it). By hand, in headless Chromium 141 on the dev server and on the production build (strict CSP), with a mock asset host that held two synthetic clips: the jumper above (12 s) and an empty gym (5 s).

- The card shows only with the advanced tools on. The sample list holds the clips of the host's index; choosing one opens it, and of two quick choices the last one wins, in both orders.
- _Load_ made the 360 frames of the jumper in about 14 s (software GL, no GPU) as VP9 in an MP4 (this Chromium has no H.264 encoder): `ffprobe` reads 360 frames, 30 fps, 12.0 s, 960 × 540, and the detector hid something in 248 of them (from about 3.7 s on; the side strips are flat gray from about 6 s). The app opened it as `demo_jumper-masked.mp4`, and with the frame rate set to 30 and every frame analyzed (CPU) it found the same 10 jumps in it as in the original clip ("straight jump", 92%). That is one synthetic clip: it says the video goes through and is analyzed like any other, not that masking helps the analysis.
- On the empty gym nothing is hidden and the page asks before loading it; Cancel in the middle of the work stops it and gives the page back; `/?from=motion` with nothing stored opens the first screen with no error and no mark left in the address. No sideways scroll on the first screen or the debug page, at phone and tablet width, in light and dark.
- **Not checked**: H.264 for the result (this Chromium cannot encode or decode it; that is the encoder of the exports, as it was, and what a browser with H.264 uses first), Safari and Firefox (a video in IndexedDB, VP9 or H.264 in an MP4), the real sample clips (the host's own were not reachable: the clips above are synthetic), long clips and big files (the 12 s clip is 3 MB).

## Asset host

Every deployment stores a copy of the build output, and the big files were most of it (about 144 MB of 146). With `VITE_ASSET_BASE_URL` set, the build leaves them out (2 MB) and the app reads them from a public folder at runtime: the pose models (`models/`), the MediaPipe, ONNX Runtime and ffmpeg wasm (`mediapipe/<version>/`, `ort/<version>/`, `ffmpeg/<version>/`) and the sample videos (`samples/`). The small loader scripts stay in the build, so the host only ever serves data. Without the variable, everything is served from this origin as before (`npm run fetch-assets`; no sample button), which is what `npm run dev` uses.

The host is the R2 bucket `trampovision-assets`, served read-only by the review Worker at `/assets/` (`worker/src/assets.ts`): R2 charges nothing for the bytes served, and the Worker's origin is already allowed by the CSP and the local-only guard. It sends the CORS headers for the same origins as the rest of the Worker (the app, its previews, localhost), ranges and `304`s, and the cache time each file was uploaded with (a year for models and wasm, an hour for a `.pose.json`, a minute for `samples/index.json`). The files were on a Vercel Blob store before: its free tier has 1 GB of storage and 10 GB of downloads a month, and the dev server and headless runs that read it, with an empty cache each time, probably used most of that.

1. `make assets-bucket` (once; it must exist before the Worker deploy that binds it). Then an R2 API token for the upload: Cloudflare dashboard → R2 → Manage API tokens, _Object Read & Write_ on that bucket only; put `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` in `.env.local` (see `.env.example`). The upload uses R2's S3 API in parts: wrangler takes at most 315 MB per file, and ViTPose is 344 MB.
2. `make assets-upload SAMPLES=<folder>` (default `video-sample/`; files already in the bucket are skipped, a sample only when its size matches; add `FORCE=1` to re-upload everything, `DRY_RUN=1` to only list what would happen; `npm run assets-upload` does the same). Uploads never delete: `make asset-remove ASSET=synchro.mp4` (or a bucket path, or a sample name without extension for its .mp4 and .MOV; `DRY_RUN=1` to preview) removes files and refreshes the samples index; `make assets-remove` deletes a whole kind after a confirmation (`WHAT=videos` for the sample videos, `samples` for videos and their saved analysis, `models`, `wasm`, `all`; no `WHAT` asks). To open a sample without running the pose model, analyze the clips once with `make assets-precompute` (installs `playwright-core` without saving it, needs Google Chrome; `SAMPLES=<folder>`, `FORCE=1`; or `npm run precompute-samples`) (writes `video-sample/<name>.pose.json`, about a minute per clip; `--force` redoes them), then `make assets-upload`: a clip with a `.pose.json` in the bucket opens with that analysis (only the pose landmarks are stored, so scoring changes need no new run; redo it when the pose model changes). It prints the value for `VITE_ASSET_BASE_URL`: `<review Worker URL>/assets`.
3. Set `VITE_ASSET_BASE_URL` in the Vercel project (Production and Preview) and redeploy. Leave it empty in `.env` for `npm run dev`: the dev server then serves `public/`, and nothing is downloaded (`make assets-precompute` and `pose-eval` clear it themselves).
4. After upgrading `@mediapipe/tasks-vision` or `@ffmpeg/core`, run the upload again: each version gets its own folder, and a missing folder fails to load instead of mixing versions.

The trade-off: the app now needs the network for its first analysis (the browser caches the files after that). Tested: the production build (strict CSP) in headless Chrome against `wrangler dev --local` with the files in its local bucket analyzed a clip, reading the MediaPipe wasm, the model and `samples/index.json` from `/assets/`; ranges, `304`, `HEAD`, a refused path and an origin that gets no CORS headers by hand with curl.

## License

MIT, see [LICENSE](LICENSE). Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Models, libraries, the FIG rules and the optional Jev API keep their own terms: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
