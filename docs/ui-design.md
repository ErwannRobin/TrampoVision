# TrampoVision UI design

The interface is a video analysis tool for trampoline coaches and athletes. The analysis pipeline (`src/analysis`,
`src/pose`, `src/skills`, `src/pose3d`, `src/dataset`) is not part of this document and must not change with the UI.

## Intent

A real product an elite coach would open every day: Apple-level simplicity, the vocabulary of professional video
analysis, and biomechanics that can be trusted because the interface is honest about what it does not know.

- **The video is the product.** Everything else is arranged around it and earns its place.
- **Simple first, technical on demand.** The athlete sees a few plain answers. The coach sees every measurement. Same
  analysis, different depth, one switch in the top bar.
- **Honest.** No metric is invented. Comparisons stay inside the clip that was analyzed. Uncertainty is shown, not hidden.

## Design rules

1. **Color belongs to the data.** The interface itself is neutral: ink on chalk (light) or chalk on night (dark), one
   focus blue. Color appears only where it means something:
   - `--lift` (cool blue): rising. Ascent, the left side of the body.
   - `--drop` (warm orange): falling. Descent, the right side of the body.
   - `--gold` / `--gold-fill`: the center of mass, the apex. Also the dot in the logo.
   - `--danger`, `--warn`, `--ok`: errors, things to check, agreement. Rare.
2. **Solid means sure, dashed means not sure.** One grammar everywhere: the skeleton on the video (dashed when the pose is
   unclear), the timeline (hatched where the pose is unclear, dashed chips for unsure skills), the confidence meter
   (dashed unless high), warnings (dashed border), the calibration outline while editing.
3. **Width is the voice.** One typeface (Archivo Variable), three widths:
   - expanded (`--wd-brand`, `.t-brand`): the wordmark, the landing headline, the skill name. Nothing else.
   - normal (`--wd-text`): everything you read.
   - condensed (`--wd-figure`, `.num`): every measurement, time and axis label. Tabular, lining figures.
4. **Structure by space and hairlines, not boxes.** There are three large surfaces (the stage, the rail, the dock) and
   the technical data below. Inside them, sections are separated by whitespace and a hairline (`--line`). No card
   grids. No shadow on content; only floating layers (menus, banners, toasts) have one.
5. **Motion answers the user.** Menus open, selections slide, bars grow when they appear, the timeline draws in once
   when an analysis arrives. No decorative entrances, no hover animations on content. Everything respects
   `prefers-reduced-motion` (base.css already zeroes durations; canvas animation must check it too).
6. **The video never moves.** Banners float over the workspace; the stage and dock stay put while the rail scrolls.

### Things to avoid (this is a brief, not a taste)

- Eyebrow labels in tracked-out capitals, all-caps labels of any kind. Sentence case everywhere.
- Strings joined with middle dots ("A · B · C"), labels like "WORD — fragment", arrows appended to buttons.
- A monospace face for data labels (use `.num`). Identical bordered cards. Gradient washes. Emoji.
- Numbering that is not a real sequence. Decoration that carries no information.
- Reds/greens as the only signal: the words always say it too.

## Tokens

`src/styles/tokens.css` is the source. Names that canvas code reads through `cssVar()` and that therefore must stay
stable: `--text --text-2 --text-3 --surface --panel --panel-2 --line --line-2 --grid --series-1 --series-2 --band
--flight-band --lift --drop --gold --gold-fill`. Draw with them (never hard-code a theme color) and re-draw when
`useThemeVersion()` changes. Video overlays are the exception: they sit on arbitrary footage, so they use fixed colors.

Scale: font sizes `--fs-xs 11.5 / sm 12.5 / base 13.5 / md 15 / lg 17 / xl 22 / 2xl 30 / hero`; space is a 4px grid
(`--sp-1..8`); radii differ by role: `--r-input 10`, `--r-pill`, `--r-pop 14`, `--r-sheet 18`.

## Kit (`src/ui/kit`, `src/styles/kit.css`)

Do not edit it. If a part needs something the kit lacks, build it locally in the part's own files.

| Piece                                                        | Use                                                                                          |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `Button` (primary, secondary, ghost, danger; sm, md, lg)     | One primary per region. Icons through `icon`.                                                |
| `IconButton` (ghost, solid, primary; `pressed` for toggles)  | `label` is required: it is the accessible name and the tooltip.                              |
| `Segmented`, `Tabs` (+ `tabId`, `panelId`), `Switch`         | Choices. Arrow keys work.                                                                    |
| `Field`, `NumberField`, `SelectField`, `.input`, `.select`   | Forms. `NumberField` ignores non-finite input and restores on blur.                          |
| `Disclosure`                                                 | Progressive disclosure: native `<details>` with a hairline.                                  |
| `Menu`                                                       | Actions list from a button, keyboard ready.                                                  |
| `ConfidenceMeter`, `ProgressRing`, `Stat`, `Badge`, `Banner` | Confidence (solid/dashed), progress, a measurement, a word, a message.                       |
| `ActivityToast`, `Logo`, `LogoMark`, `Icon`                  | Background work, brand, icons (see `icons.tsx` for the names).                               |
| Utilities                                                    | `.num .num-lg .num-xl .unit .muted .faint .small .spacer .sr-only .t-brand .sheet .skeleton` |

Shared code: `ui/types.ts` (Audience, StageView, RailView, CoachTab, Appearance, Status), `ui/format.ts` (`fmt`,
`signed`, `pct`, `timecode`, `plural`: a missing value is an en dash), `ui/insights.ts` (`confidenceTier`,
`jumpHeadline`, `compareJumps`, `describeBedPosition`, `TIER_TEXT`), `ui/quality.ts` (`analysisWarnings`),
`ui/hooks.ts` (`useElementSize`, `useMediaQuery`, `useReducedMotion`, `useDismiss`, `useLocalStorage`),
`ui/theme.ts` (`cssVar`, `useThemeVersion`, `pose3dColors`).

## Architecture

`App.tsx` owns all state and is the only file that knows every part. Each part is a component with a typed contract
(the exported `...Props` interface in its file). Parts do not import each other, except through the kit and the shared
code above, and except where this document says so.

### Player bus (`ui/playhead.ts`)

`Playhead` is an external store: current time, playing, duration. The stage installs the handlers
(`seekHandler`, `playRangeHandler`, `toggleHandler`, `pauseHandler`, `stepHandler`) and publishes `setTime`,
`setPlaying`, `setDuration`. Everyone else calls `seek(t)`, `playRange(from, to, loop)`, `toggle()`, `pause()`,
`step(frames)` and reads with `usePlayheadTime`, `usePlaying`, `useDuration`. This is how the transport bar and the
timeline drive a video they do not own, and how charts follow playback at frame rate without re-rendering the tree.

### Layout (`styles/shell.css`)

```
wide (>= 1100px)                      narrow
+-------------------+----------+      +-------------------+
| stage (video)     | rail     |      | stage             |
|                   | (scrolls)|      +-------------------+
+-------------------+----------+      | dock              |
| dock: transport + timeline   |      +-------------------+
+------------------------------+      | rail              |
| technical data (coach)       |      | technical data    |
```

- `.workspace__stage` is transparent and gives the stage a definite size. The stage draws its own black rounded viewport.
- `.workspace__dock` and `.workspace__rail` are `.sheet`s (the shell adds the surface and the padding).
- The workspace is exactly one viewport tall on wide screens (the video, the timeline and the transport are always
  visible; the rail scrolls). Below 1100px the page scrolls; the stage is 58dvh tall, full-bleed on phones.
- The sample clip is a 1080x1920 portrait video, so a portrait video in a wide stage is the normal case: it is fitted
  by height and centered, and the black stage is the letterbox.

### The audience switch

`Audience` is `'athlete' | 'coach'`, kept in localStorage, default athlete.

| Region     | Athlete                                                                        | Coach                                                                                                        |
| ---------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Video      | skeleton, center of mass, path, labels with phase and skill (`detail: simple`) | the same, labels add body position, rotation, percentages (`detail: full`); view switcher video / split / 3D |
| Rail       | `AthleteInsights`: the answer, four figures, landing on the bed, the jump list | `CoachRail`: skill, metrics, twist, review, data                                                             |
| Below fold | nothing                                                                        | `TechnicalData`: every chart                                                                                 |

### Rail and settings

The rail shows the insights of the selected jump or the settings (`RailView`). Before an analysis exists it always shows
the settings (that is where a new video is set up and analyzed). The settings icon in the top bar toggles them.
Height and calibration change the result live; the model, frame rate, stride and people need a new analysis.

## Parts

Each part below is a folder or a handful of files with one job. Its contract is the exported `...Props` interface in
its main file; `App.tsx` is the only place that wires the parts together, so a part never imports another part.

### Stage (`ui/stage/*`, `video/overlay.ts`, `styles/stage.css`)

Files: `Stage.tsx`, `Transport.tsx`, `ProcessingOverlay.tsx`, `CalibrationBar.tsx`, `../video/overlay.ts`. Contracts: `StageProps`, `TransportProps` (+ `SPEEDS`), `ProcessingOverlayProps`,
`CalibrationBarProps`; `OverlayOptions`, `drawOverlay`, `drawCalibration`, `CalibrationDraw` keep their signatures
(`video/exportVideo.ts` calls them at a 960px reference width and scales the canvas).

**Stage**

- A black rounded viewport (`--stage`, `--r-sheet`; radius 0 at <= 640px). The `<video>` and the overlay `<canvas>`
  share one fitted frame: measure the viewport with `useElementSize`, fit the video's aspect ratio inside it, center.
  Never distort; never crop.
- Port all of `VideoPlayer`: muted `playsInline` video, DPR-correct overlay canvas redrawn only when the frame or an
  input changed (dirty flag), the rAF loop publishing `playhead.setTime`, range playback with optional loop
  (`playRangeHandler`), frame seeking through `frameAtTime` / `frameSeekTime`, `speed` -> `playbackRate`, the error
  message "This browser cannot play the video. Try an MP4 (H.264) file.", calibration corner picking and dragging
  (pick radius 16px, pointer capture). Space toggles, arrows step one frame (Shift: ten), except when focus is in an
  input, select, textarea or button. Install and clean up every `playhead` handler; call `setPlaying` and `setDuration`.
- `view`: `video` (default), `split` (video and `pane` side by side when the viewport is wide, stacked when tall),
  `3d` (the `pane` fills it; keep the `<video>` mounted but hidden so playback and seeking continue). When `onView` is
  given, show a small translucent segmented switcher (video, split, cube icons) at the top right of the viewport.
- No `url`: a calm placeholder inviting the user to add the clip that goes with the saved data (a file button plus
  "or drop it on the page"), still rendering `children`.
- `children` are layers above the video (processing overlay, calibration bar). Render them in an absolutely
  positioned layer inside the viewport.

**Overlay drawing (`drawOverlay`)** must read as designed graphics, not debugging visuals. Scale marks with the picture
(`u = width / 720`, never below 0.7 so they stay legible on phones) so the export looks like the screen.

- Skeleton: thin rounded bones (about 2.4u), small joints (about 3.2u) with a hairline dark ring, a soft dark glow
  behind (shadowBlur) instead of a hard black outline. Left `#62b0ff`, right `#ff9a55`, center near-white. When the pose
  is unclear (`confidence < 0.5`): dashed and translucent.
- Center of mass: a gold (`#ffc933`) dot with a white ring and a soft halo. It is the one bright thing on the frame.
- Trajectory: a comet. The travelled part of the last ~1.5 s is solid and tapers with age; older travelled path is a
  faint thin line; the path still to come is a faint dotted line. Mark the takeoff (small up triangle), apex (gold dot)
  and landing (small down triangle) of the jump the playhead is in, with the apex height as a label in `full` detail.
- Labels (`hud`): pill-shaped chips at the top left (rounded rects, `rgba(12,13,15,.55)` fill, hairline light stroke):
  phase ("Jump 3, ascent", "On the bed"), the predicted skill (name, then the tier word or the percentage in `full`
  detail; a solid dot when high confidence, a dashed ring when not), and in `full` detail the body position and the
  rotation so far. "Low pose confidence" or "No athlete found" goes top right in a dashed chip. Feature-detect
  `ctx.roundRect` and fall back to a manual path.
- `detail` is `simple` (athlete) or `full` (coach); undefined means `full`.
- Calibration (`drawCalibration`): thin dashed teal outline (`#19d3c5`), faint fill, a plumb line through the bed center,
  larger numbered handles only while editing.

**Transport** (top row of the dock). Play/pause (large, primary, round), previous and next frame, back and forward ten
frames (hidden below 640px), a timecode (`timecode(time)`, condensed) with "frame 102 of 1260" muted beside it, speed
(`SPEEDS`; a segmented control wide, a select below 720px), and the layer toggles as icon buttons with tooltips
(skeleton, center of mass, trajectory, labels; disabled without a result). Buttons have accessible names and tooltips
that show their key (Space, arrows). `usePlayheadTime`, `usePlaying`, `useDuration`; no video reference needed.

**ProcessingOverlay.** Fills the viewport above the video. Loading (reading, measuring): ring and one line.
Converting: determinate ring, "Converting the video for this browser" and "Runs on your device and can take a while."
Analyzing: a large ring with the percentage in the middle, "Analyzing frame 412 of 1260", "Running on {backend}" when
known, a time estimate ("About 40 s left", derived from elapsed time and progress, shown only after 8% and 4 s, because the first frames are slow,
rounded to 5 s), and Cancel. Ready (a video, no result): a compact panel at the bottom center with the file name and a
primary "Analyze video" button. A soft scrim keeps the video visible. It fades in; it renders nothing when idle with a result.

**CalibrationBar.** A pill at the bottom center of the stage: the instruction for the next corner
("Click corner 2 of 4, going around the bed. Scrub the video first if the bed is hidden." / "Drag a corner to adjust it,
then press Done."), four progress dots, Undo, Clear, Done.

### Timeline (`ui/Timeline.tsx`, `styles/timeline.css`)

The memorable element. The flights of the clip as one strip of arches under the video. Contract: `TimelineProps`.
Geometry (time to pixels, the zoom window, the ruler, hit testing) is pure and lives in `ui/timeline/geometry.ts`.

- **Header row**: "Jump 3 of 12" with previous and next chevrons (`onStepJump`), "Play jump" (`onPlayJump`) with a loop
  toggle (`loop`, `onLoop`), a small "Clip / Jump" zoom switch, and a legend (up triangle takeoff, gold dot apex, down
  triangle landing; hidden below 700px). No jumps: "No jumps found" and disabled controls.
- **The strip** (canvas, DPR-aware, 120 to 136px tall, 96px on phones): the center-of-mass height across the clip as one
  smooth line. Between flights it is thin and quiet (`--text-3`). Each flight is drawn in color: the ascent in `--lift`,
  the descent in `--drop`, with a soft vertical gradient fill under the arch. The selected jump is fully saturated on a
  faint capsule (`--panel-2`); the others are at reduced strength. The baseline is the bed (0 when the bed is marked).
- **Events**: takeoff = small up triangle on the baseline, landing = small down triangle, apex = gold dot on the curve
  with a white/dark ring. The selected jump also gets text labels ("Takeoff", height at the apex, "Landing") when they
  fit. Other jumps get glyphs only.
- **Jump chips** above each arch: the jump number and, when it fits, the skill name. A dashed chip outline for anything
  under high confidence (`confidenceTier`), "?" for not classified. A jump cut off by the clip (`!complete`) has a
  dashed open edge and no glyph for the missing event.
- **Uncertainty**: stretches where `result.confidence < 0.5` are hatched along the baseline.
- **Ruler** under the strip: nice time ticks in condensed figures (`--text-3`).
- **Playhead**: a 1.5px line the full height with a round knob at the top. Dragging anywhere on the strip scrubs
  (pointer capture, `touch-action: pan-y` so vertical scrolling still works on touch). A press inside a flight also
  selects that jump (`onSelect`). Hover shows a ghost line and a DOM tooltip (timecode, height in m, phase, jump number and
  skill; on an event: "Takeoff 3.42 s").
- **Zoom**: "Jump" windows the strip to the selected jump with 25% margin each side, animated (about 250ms); it follows
  the selection during playback. Never animate when `useReducedMotion()`.
- **Draw-in**: when a result first arrives the arches draw left to right once (about 700ms).
- **Accessibility**: the interactive layer is `role="slider"` named "Video position" with `aria-valuemin/max/now` and an
  `aria-valuetext` such as "0:03.412, jump 3"; it announces nothing per frame.
- Put pure geometry (time to x, window, hit testing, ruler ticks) in `ui/timeline/geometry.ts` with unit tests
  (`geometry.test.ts`).

### Athlete insights (`ui/rail/AthleteInsights.tsx`, `styles/insights.css`)

The plain answers for the selected jump. Contract: `AthleteInsightsProps`. Use `jumpHeadline` and `compareJumps`
(never recompute measurements) and the kit. Top to bottom:

1. **The answer.** "Jump 3 of 12" (muted) with a "Play jump" button at the right. The skill name as the headline
   (expanded, about 30px; smaller if a long label wraps). Under it a `ConfidenceMeter` and the tier in words
   (`TIER_TEXT`); the percentage is not shown, its `title` says "Heuristic score, not a probability". Then the
   classifier's one-sentence `summary`.
2. **Four figures**, 2x2, separated by hairlines, no boxes: Peak height (m, hint: "above the bed" or "above the lowest
   point" from `heightReference`), Time in the air (s), Rotation (turns, hint: clockwise or counterclockwise on screen,
   or "none"), Body shape (straight, tuck, pike, or "between shapes" for unknown). Missing values are en dashes; a jump
   cut off by the clip says so in the hint.
3. **Landing on the bed** (only when `headline.bed`): a horizontal bed with the center marked and the takeoff, apex and
   landing positions as glyphs (`+-1` = the edge, plus = right in the image), one sentence with `describeBedPosition`.
   When the bed is not marked, one quiet line "Mark the trampoline to see where each jump lands." with a small button
   (`onOpenSetup`).
4. **Worth knowing**: the classifier's limitations for this jump (signal, problem, needed), the first two visible, the
   rest behind a disclosure; dashed left border. And a "Data checks" disclosure listing `notes` when there are any.
5. **Jumps in this clip**: one row per jump (number, skill, a bar for the height as a share of the best jump in this
   clip, the height, the air time); the selected row is highlighted; a dashed marker where confidence is not high; click
   selects (`onSelect`). Caption: "Bars compare jumps within this clip." The bars grow in when they appear.
6. A text button "Show technical details" (`onShowCoach`) with one line saying what the coach's view adds.

No jump found: an empty state that explains why (the center of mass never rose 0.3 m) and what to check (whole athlete in
frame, fixed camera), with a button to the settings. Jump changes crossfade the content (about 180ms), nothing more.

### Coach rail (`ui/rail/CoachRail.tsx`, `ui/rail/coach/*`, `ui/Pose3DView.tsx`, `styles/panels.css`)

The technical depth. Contract: `CoachRailProps`. The data-quality warnings come from `analysisWarnings` in
`ui/quality.ts`; the tabs are one component each in `ui/rail/coach/`.

Header: "Jump 3 of 12" with previous/next chevrons (`onSelect`) and "Play jump". Then `Tabs` (Skill, Metrics, Twist,
Review, Data) and a `role="tabpanel"` for the active one (`panelId` / `tabId`).

- **Skill**: skill name, `ConfidenceMeter` with the percentage as a figure and "Heuristic score, not a probability.
  Classifier: {id} v{version}."; the summary; Evidence (label, value, note); "Confidence is the product of" as a
  disclosure with the parts; "What the data could not settle" (limitations) or the "no data problem" line; Thresholds
  (a disclosure with the numeric fields, the facing select, Reset thresholds and the caveat that the starting values
  are estimates); "What one side view can never tell" (`KNOWN_LIMITS`) as a disclosure. No jumps: the original message.
- **Metrics**: "At this frame" (jump phase, body position, hip angle, knee angle, rotation so far, rotation of the whole
  jump, plus the per-frame values of the old analysis panel: center of mass in px, height, vertical velocity, horizontal
  displacement with the percent of the half bed when calibrated, body angle, continuous orientation, rotation count,
  angular velocity, pose confidence, joints measured/interpolated/corrected/missing); "This jump" (every key
  measurement of the old skill panel, grouped: timing, trajectory, rotation, shape, quality); "All jumps" (the old table:
  flight, to apex, max height, takeoff vy, horizontal displacement, turns, completed; click a row to go to its takeoff;
  the selected row highlighted; a marker for cut-off jumps and its footnote).
- **Twist**: the twist panel (measurement or the reason for none, raw values, other routes, checks, limitations,
  the annotation select saved with the jump, what one camera cannot tell, browser 3D readiness). Same content.
- **Review**: render the `review` node.
- **Data**: warnings (`notes`), data quality (scale, bed vs athlete scale, free-fall check, frames with a center of mass,
  glitches removed, samples filled in, samples missing, net rotation) and the joint angles table at the playhead.
- Data is dense: label left, figure right (condensed), hairlines between rows, groups with quiet headings. No boxes.

`Pose3DView` becomes the stage pane. Keep every capability (drag to rotate, the three view presets, the 3D video and
side-by-side exports with progress and cancel, the "twist not reliable" flag, the legend text). With `fill` it fills its
parent (measure width and height with a `ResizeObserver`); presets and export buttons become a compact toolbar over the
canvas; the legend goes behind an info button. `Pose3DSection` is gone: its charts move to `TechnicalData`.

### Technical data (`ui/TechnicalData.tsx`, `ui/Chart.tsx`, `ui/TrajectoryPlot.tsx`, `ui/JumpView.tsx`, `styles/charts.css`)

Contract: `TechnicalDataProps`. Every chart stays; they are grouped and restyled.

- Title "Technical data" and one line: "Every curve follows the video. Click or drag on a chart to seek." Groups with a quiet
  heading, each collapsible (the first two open): **Selected jump** (the four normalized charts and the body position
  strip of `JumpView`, without its jump chips, play button or loop: those moved to the timeline and rail; props reduce
  to `result, skills, playhead, selected`), **Motion** (center-of-mass height, vertical velocity, horizontal position,
  center-of-mass path), **Rotation** (continuous orientation, body angle, angular velocity), **Joints** (knee, hip,
  shoulder, elbow), **Pose confidence**, **Twist, experimental** (the four charts from `Pose3DSection`; only when
  `twist.frames` exists), and `validation` when given.
- The decorations (event markers, flight bands, bed guides, turn guides) are computed here, in
  `ui/charts/decorations.ts`; the chart definitions are data in `ui/charts/specs.ts`.
- `Chart` keeps its props. Restyle: hairline grid in `--grid`, labels in condensed figures (`--text-3`), 1.75px round
  lines, a soft gradient under single-series charts, flights shaded (bands) in `--flight-band`, unclear pose hatched,
  event markers drawn as the timeline's glyphs (label `T` = up triangle, `A` = gold dot, `L` = down triangle; the API
  keeps the letters). The title and unit sit on the left, live values (condensed) on the right. No border, no card: charts
  are separated by whitespace and hairlines in a responsive grid.
- `TrajectoryPlot`: the bed as a rounded bar with a center tick; the path colored by direction (rising `--lift`, falling
  `--drop`); glyphs for takeoff, apex, landing; the current position as a gold dot with a ring.

### Review (`ui/EvaluationView.tsx`, `styles/review.css`)

Keeps every export and prop: `DatasetBar`, `EvaluatePanel`, `EvaluationReport`. Restyle so it belongs to the rest.

- `EvaluatePanel` sits inside the coach's Review tab, which already has the jump header: drop its own heading and
  previous/next. Keep "Play jump", "Next unlabeled", the count of labeled jumps, the classifier card (compact), the label
  buttons (a wrapping group of six, the key shown as a small keycap, the chosen one filled, "matches the prediction" /
  "differs from the prediction" badge), the note field, the stale-predictions warning with "Update predictions", keys 1
  to 6 and N. `DatasetBar` goes behind a disclosure ("Dataset on this computer", the counts as its meta); Save all,
  Dataset JSON/CSV, Import, Delete all (keeps its `window.confirm`) inside.
- `EvaluationReport`: scope switch, exports, the figures row as big condensed numbers separated by hairlines (no
  bordered tiles), caveats, per-class table, confusion matrix heatmap (green agree, red disagree, strength by count),
  failure cases as disclosure rows with the check table, what the classifier saw, sparks and all features. Use `--lift`
  for lines, tokens for everything else.

### Chrome (`ui/Landing.tsx`, `ui/TopBar.tsx`, `ui/StatusBanners.tsx`, `ui/rail/SetupPanel.tsx`, `styles/chrome.css`)

**TopBar** (56px, `<header class="topbar">`). Left: the logo (a button when `onHome`), then the clip name (truncated,
`title` shows it whole) and its detail line in muted text (spacing, not dots). Right: the athlete/coach `Segmented` when
`showAudience`, the export `Menu` when `exportGroups`, a settings `IconButton` (pressed when `setupOpen`), an "Open
video" icon button wrapping a hidden file input (accept mp4/mov; hidden when `onFile` is null), and a keyboard-shortcuts
popover (icon button; also opened by `?`) listing: Space play or pause; left and right arrows previous and next frame;
Shift with arrows ten frames; [ and ] previous and next jump; 1 to 6 label the jump (Review tab); N next unlabeled jump.
Below 720px the clip name and the wordmark shrink away, Export becomes icon-only.

**StatusBanners.** The floating `.banners` container with `Banner`s: an error `Status` (a warning `severity` is tone
"warning", otherwise "error") with the message unchanged and a dismiss; `notice` as info; `exportError` as an error titled
"Export failed". Loading and analyzing are shown by the stage, not here.

**Landing** (first screen, `busy` while a file is read). Left-aligned, not a centered marketing hero: the logo, a headline
in `.t-brand` ("Measure every jump."), one sentence ("Drop a trampoline video. TrampoVision finds each jump and
reports height, time in the air, rotation and skill, on your device."), a primary "Choose video" button (label wrapping
a hidden file input, mp4 and mov), "Use the sample video" when `onSample`, and a text-button "Open saved analysis" (json).
A quiet line: "Best results from a fixed, level camera at the side, with the whole trampoline in frame." and a
privacy line with the shield icon: "Runs in your browser. The video never leaves your device." The one moment of
visual interest: a large set of flight arcs (SVG, `--lift` rising and `--drop` falling, gold apex dots) that draws in
once, the product's own signature. When `dataset.records.length > 0`, a "Saved dataset" section below with `DatasetBar`
and `EvaluationReport` (`scope="all"`, `videoId={null}`, no-op `onScope`/`onGoTo`), as the old first screen had.

**SetupPanel** (the rail's settings page). A header "Settings" with a close button when `onClose`. Sections separated by
hairlines, each with a quiet heading:

- **Athlete**: height in m (`NumberField`, 1 to 2.3, step 0.01; hint that it scales meters when the bed is not marked).
- **Trampoline**: `calibration.status` as text (error styling when `error`); buttons "Mark the trampoline" / "Edit
  corners", while editing "Undo last corner" and "Done", "Clear" when there are corners; bed size long and short in m;
  "Side 1 to 2 is the" long/short; "Meters from" (auto (bed if set), the bed, athlete height).
- **Analysis**: model (Lite (fast), Full, Heavy (most accurate)), frame rate (hint: changing it clears the analysis),
  "Analyze every" (frame, 2nd, 3rd, 4th), people to look for (1 to 3), "Use the GPU if possible"; the runtime line
  ("Runtime: {backend or not started}") and the WebGPU line (the two original sentences). The primary action is a sticky
  footer: "Analyze video" (block, large) when there is a video and no result, "Analyze again" (secondary) with a result;
  while busy, "Cancel" replaces it during analysis and all fields are disabled. Loading disables Analyze.
- **Appearance**: `Segmented` System, Light, Dark.
- **Saved data**: "Open saved analysis (JSON)" (file input) and "Use the sample video" when `onSample`.

## Copy

American English ("analyze", "center", "meters"). Sentence case. Plain verbs, active voice, one name per action through
the whole flow ("Save analysis" and "Open saved analysis"). Errors say what happened and what to do, never apologize.
Empty states point at the next step. Keep the existing technical wording where it is precise; shorten filler.

## Accessibility and performance

- Every control has an accessible name; icon buttons use `IconButton`. Visible focus is global (`:focus-visible`).
- Color is never the only signal. Text contrast follows the tokens (`--text-2` is AA on every surface).
- Touch targets are 44px on coarse pointers (the kit handles its own; custom controls must too). No hover-only actions.
- Live regions: errors announce (`role="alert"`), progress is a `progressbar` and is not announced per frame.
- Canvas: size with `devicePixelRatio`, redraw only when an input changed, coalesce with `requestAnimationFrame`, read
  colors with `cssVar` and redraw on `useThemeVersion()`. Playback-driven drawing reads `Playhead` directly, not React state
  higher up the tree.
- Layout must hold from 320px to 2560px wide, portrait and landscape video, and long file names and skill labels.

## Checks

`make check` runs the whole gate: types, lint, formatting and the unit tests. Pure logic (formatting, insights,
timeline geometry, chart geometry, fitting, the player) has tests; drawing and layout are checked by eye at phone,
tablet and desktop widths, in both themes, with a portrait and a landscape video, and with an accessibility scan.
Nothing here may change the analysis pipeline, and no number may be shown that the pipeline did not measure.
