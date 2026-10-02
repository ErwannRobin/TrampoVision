# TrampoVision UI design

The interface is a video analysis tool for trampoline coaches and athletes. The analysis pipeline (`src/analysis`,
`src/pose`, `src/skills`, `src/pose3d`, `src/dataset`) is not part of this document and must not change with the UI.

## Intent

A real product an elite coach would open every day: Apple-level simplicity, the vocabulary of professional video
analysis, and biomechanics that can be trusted because the interface is honest about what it does not know.

- **The video is the product.** Everything else is arranged around it and earns its place.
- **Live first, technical on demand.** The default screen is a tool for the trampoline: what each skill was, how hard it is,
  what execution the pose earns, what to fix. The **Advanced** switch in the settings brings back the athlete (a few plain
  answers) and the coach (every measurement) views, with their own switch in the top bar. Same analysis, different depth.
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
6. **The video never moves.** Banners float over the workspace; the stage and dock stay put while the rail scrolls. On a narrow
   screen, where the page scrolls, the stage and the transport are pinned above the results instead.

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

`Playhead` is an external store: current time, playing, reverse, duration. The stage installs the handlers
(`seekHandler`, `playRangeHandler`, `toggleHandler`, `pauseHandler`, `stepHandler`, `reverseHandler`) and publishes `setTime`,
`setPlaying`, `setReverse`, `setDuration`. Everyone else calls `seek(t)`, `playRange(from, to, loop)`, `toggle()`, `pause()`,
`step(frames)`, `reverse()` and reads with `usePlayheadTime`, `usePlaying`, `useReverse`, `useDuration`.
A `<video>` cannot play backwards, so `createPlayer` (`ui/stage/player.ts`) walks it back one frame at a time from `tick()`, at the
playback speed and by the clock (frames are dropped while the decoder is busy, the speed stays true); while it does, the video is
paused and `playing` and `reverse` are both true. Anything else that moves the video (play, pause, a step, a seek, a range) ends it. This is how the transport bar and the
timeline drive a video they do not own, and how charts follow playback at frame rate without re-rendering the tree.

### Layout (`styles/shell.css`)

```
wide (>= 1100px)                      narrow, live view with results
+-------------------+----------+      +-------------------+  pinned
| stage (video)     | rail     |      | stage             |  (sticky)
|                   | (scrolls)|      +-------------------+
+-------------------+----------+      | transport         |  (sticky)
| dock: transport + timeline   |      +-------------------+
+------------------------------+      | timeline          |  scrolls
| technical data (coach)       |      | rail              |
                                      | technical data    |
```

- From 1280px the dock puts the transport and the controls of the selected jump (`.tl__head`, the timeline's `.tl` gives up its
  box with `display: contents`) on one row, the strip under both at the full width; under 1600px the legend of the strip goes first.
  Below that they stack as before.
- `.workspace__stage` is transparent and gives the stage a definite size. The stage draws its own black rounded viewport.
- `.workspace__dock` and `.workspace__rail` are `.sheet`s (the shell adds the surface and the padding).
- The workspace is exactly one viewport tall on wide screens (the video, the timeline and the transport are always
  visible; the rail scrolls). Below 1100px the page scrolls; the stage is 58dvh tall, full-bleed on phones.
- Narrow, live view, once there is a result: the video stays in view while the results scroll past it. Upright (at least 521px
  tall) it is a mini-player: the stage (28dvh on a phone, 34dvh wider; `--pin-stage`) and the transport (one slim row: play, frame
  steps, time, speed; `--pin-bar`) are `position: sticky` at the top. On its side (landscape, at most 520px tall) the stage is the
  left column, as tall as the screen, and the transport, the timeline and the skills scroll in the right one. Nothing moves in the
  DOM (the `<video>` is never remounted): the dock gives up its box (`display: contents`) so that the timeline scrolls on its own,
  and the `.sheet` surface moves to the timeline. What is pinned is also the `scroll-padding-top` of the page, so a tapped skill
  row (`LiveRail`), a focused control and anchors land clear of it. Below 560px the timeline's Clip / Jump zoom is left out to
  keep the set and the first skill in the first screen, and on a phone the list of skills comes before "Work on next". Before there
  is a result nothing is pinned (analyzing needs the whole stage), and the advanced tools keep the plain stack. All of it is in
  `styles/live.css`, scoped with `:has(.tl)`.
- The sample clip is a 1080x1920 portrait video, so a portrait clip is the normal case. The workspace says which it is:
  `data-orientation="portrait|landscape"` (App, from `Stage`'s `onClipSize` and `clipOrientation` in `ui/stage/fit.ts`; a clip
  whose size is not known yet, and a square one, are `landscape`). At >= 1100px a **portrait** workspace is
  `max-content | 1fr`: the stage is as wide as the video (the stage sets `--stage-w` on itself, `portraitStageWidth`: its own
  height times the clip's ratio, which no stylesheet can know), so there is no black letterbox, and the rail gets the width that
  frees. The rail is capped to its landscape width at the least (`max-width` on the stage). While the stage shows the 3D
  skeleton (split and 3D views, `.stage__pane`) the grid is the landscape one again: the pane needs the room, and the video
  keeps its place at the left. A landscape clip keeps `stage | var(--rail-w)`. The video is still fitted (`fitRatio`), never
  cropped.
- In the narrow portrait stage the view switcher keeps to its icons (the labels drawn on the video need the room), the banners
  keep to its left edge, and the coach and athlete rails read in a column of at most 880px. The live rail uses the width
  itself, by its own width: at 720px and more the set sits in a column of its own beside the list (two columns, the selected
  skill opens under its row as before); at 1180px and more the selected skill is a third column (`data-columns`). The columns
  scroll on their own, so the list stays in place while the detail is read.

### Live and advanced

The interface has two levels, kept in localStorage: `trampovision.advanced` (`on` or `off`, default off) and, with the advanced
tools on, `Audience`, `'athlete' | 'coach'` (default athlete). Off is the **live view**: the stage shows the video only (no
view switcher), the transport keeps back to the start, play (and backwards), the frame steps and the speed (`simple`), the top bar has no audience switch and no
export menu, the rail is the live rail (below), the settings show the athlete, the review upload, the switch and the appearance
(while the analysis runs, only the athlete and the review upload), and the first screen only asks for a video (a phone opens its
camera). A video that is loaded starts its analysis by itself, at
about 30 analyzed frames a second.

With the advanced tools on:

| Region     | Athlete                                                                        | Coach                                                                                                        |
| ---------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Video      | skeleton, center of mass, path, labels with phase and skill (`detail: simple`) | the same, labels add body position, rotation, percentages (`detail: full`); view switcher video / split / 3D |
| Rail       | `AthleteInsights`: the answer, four figures, landing on the bed, the jump list | `CoachRail`: skill, metrics, twist, review, data                                                             |
| Below fold | nothing                                                                        | `TechnicalData`: every chart                                                                                 |

### Live rail (`ui/live/*`, `styles/live.css`)

Contract: `LiveRailProps`. It reads a `Session` (`coaching/session.ts`): the same analysis, with each jump named by the coach's
label, else the classifier's guess. Top to bottom:

1. **The set**: "6 skills" with a "Copy summary" button (the share sheet on a phone, the clipboard elsewhere); three figures in
   a row (difficulty, execution as an estimate out of 10, time in the air); the warnings that make the numbers less sure (an
   oblique camera, a pose that was hard to see) with a dashed warn border; **Work on next**: at most two numbered items, each with
   how often and how many points, and the cue.
2. **Skills**: a header with the two columns, then one row per jump: number, name (two lines at most; a dashed dot and a "?" when
   it is a guess), a line under it in words (best guess, your label, direction assumed, repeat, filmed only in part), the
   difficulty and the execution deduction (0.0 in `--ok`, 0.3 or more in `--warn`). A guess the classifier would not have named
   says "Best guess, not counted yet" and shows en dashes: it is left out of the totals until the coach checks it (the header says
   how many wait). Straight jumps that follow each other are one
   folded line ("2 straight jumps, 1 to 2") that opens when one of them is selected.
3. **The selected skill**, in the same surface as its row: whether the guess is right (**Yes, that is it**, **Change**, **Play**;
   or the coach's label with **Undo**); _It could be_ (the three closest other elements with their difficulty, one tap each),
   _Another skill_ (somersaults, direction, twists and position chips: every choice names an element of the table) and _It is none
   of these_; **Difficulty** with its parts (each with its article of the Code as a tooltip), the note when the body was easier than
   the name, and the difference between front and back when the direction was assumed; **Execution** with each deduction and what
   was measured, the six chips of the deduction the coach gives (the app's proposal stays visible when they differ), and _Not
   checked_ as a disclosure; **What to fix**, one item per deduction, with the cue.
4. A text button "Show technical details" that turns the advanced tools on and opens the coach's view.

The list follows the playhead like the timeline does. Nothing in it is a measurement the pipeline did not make; the execution is
always called a proposal or an estimate.

### Rail and settings

The rail shows the insights of the selected jump (the live rail, or the athlete's or coach's view) or the settings (`RailView`).
Before an analysis exists it always shows the settings (in the live view that is only the athlete height, the switch and the
appearance, while the video is read and analyzed). The settings icon in the top bar toggles them. Height and calibration change
the result live; the model, frame rate, stride and people need a new analysis. Without the advanced switch the settings hide the
trampoline, the analysis engine and the saved data. While an analysis runs in the live view the settings shrink to what can still
reach it: the athlete height (it scales the finished track) first, then the review upload (it sends the jumps once they exist),
with one line saying that the rest comes back afterwards. What cannot apply is left out, not disabled. The settings never hold
the language: it is the menu in the top bar, at every width and in every state, the home screen included.

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
  (pick radius 16px, pointer capture). Space toggles (Shift + Space plays backwards), arrows step one frame (Shift: ten), except
  when focus is in an input, select, textarea or button. A click or a tap on the picture toggles playback at once, except while the
  bed is being outlined (a click places a corner). Install and clean up every `playhead` handler; call `setPlaying` and `setDuration`.
- **Full screen** (`FullscreenHud.tsx`, `scrub.ts`, `hud.ts`; `StageProps.fullscreen`): a button (the expand icon) at the bottom right of the picture, once there is a
  video and its analysis. The same `.stage` (the `<video>` is never remounted) is fixed over the page (`html[data-stage-fullscreen]`
  lifts its column above the top bar and stops the page scrolling) and asks the browser for its own full screen where there is one
  (a phone's Safari has none for anything but a video, so the fixed stage is the full screen there). Only the video is shown, with the
  skeleton and the center of mass as chosen but not the labels, and one layer of its own: top, the skill under the
  playhead (its place in the set, its name with a dashed underline when it is a guess, difficulty and execution deduction, the same
  numbers as the live rail); bottom, a slim seek bar and play, previous and next skill, and the speed (it cycles through `SPEEDS`); and the way out (the collapse icon), at the bottom right, exactly where
  the button to come in was.
  **A swipe right or left on the picture moves the video** (`useScrub`): the video pauses while the finger is down, a drag across
  the screen is a few seconds (`SCRUB_SPAN_S`, at most `SCRUB_REFERENCE_PX` wide so a wide screen is not touchier), each seek lands on
  a whole frame (the small time of the seek bar follows; nothing is shown large over the picture), and a video that was playing goes on
  from where the finger left it. **A tap puts the controls away or brings them back** (it never plays or pauses); **a long press
  (`LONG_PRESS_MS`) pauses the video until the finger lifts**, and a video that was playing goes on then. **A small drag down (`EXIT_DRAG_PX`) leaves the full screen**; a drag up is left alone, and the controls are excluded (`data-stage-control`). The page's busy and
  ready panels are hidden while it is open. Escape and the browser's own way out close it.
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
rounded to 5 s), and Cancel: the one Cancel of the app, the settings do not repeat it. Ready (a video, no result): a compact panel at the bottom center with the file name and a
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

### Review mode (`ui/review/mode/*`, `ui/chrome/reviewRoute.ts`, `dataset/stageLabel.ts`, `styles/review.css`)

A focused way to label jumps: one jump at a time, in the place of the rail. The top bar's **Review** button (or the address `#review`,
which survives a reload and closes with the back button) opens it for the open analysis; it works on a loaded video and on a saved
analysis. The app root gets `data-review="on"`: the timeline leaves the dock (the strip of jumps takes its job, and the room goes to the
buttons), and the video loops the selected jump from a little before takeoff to a little after landing, at half speed the first time.

- Rail, top to bottom: title and close; progress (jumps done or flagged) with its bar; the filter (`All`, `To do`, `Differ`, `Not sure`);
  the strip of every jump (a chip each: filled green = labelled, dashed amber = partly answered, struck through = cannot tell or bad cut,
  faint = left out by the filter, ringed = the one on screen); previous / next; the state, the flight time and the speed (`0.25×`, `0.5×`,
  `1×`, replay); the **answer panel**; the note; what the classifier says with its best candidates; what was measured by the four stages;
  the data problems; the curves; the switch for moving on by itself, the label download and import, and the keys.
- Answer panel: a primary button that says the classifier was right (the guess and its difficulty on it); one row of chips for each of the
  four questions (somersaults in quarters 0 to 3, direction, half twists 0 to 8, position), the name of the question beside its chips
  with the keys under it on a wide rail, above them on a narrow one; the figure the answers name with its difficulty, or why there is none
  yet (partly answered, a quarter rotation, not in the table); `Can’t tell`, `Bad cut`, `Clear`, `Undo`. A chip pressed twice takes the
  answer back; a jump marked `Can’t tell` or `Bad cut` shows no answer pressed.
- Candidates: the four best, each with a mark for each question (✓ agrees, ~ weak, ✗ differs, · not measured; the words are the title
  and the accessible name, the glyph never carries it alone) and a button that says it was that one.
- Data problems are plain sentences with a badge: cut off, pose flip (a step of the orientation above the limit), back and forth (a
  reversal), body line (the cross-check), poor pose, camera angle, facing, twist not measured. They explain why a guess is weak.
- Keys: `0`–`3` somersaults, `Q` a further quarter, `B` `F` direction, `W` no twist, `+` `−` half twists, `S` `T` `P` position, `Enter` or
  `A` accepts the classifier, `U` cannot tell, `X` bad cut, `C` clear, `Z` or Ctrl/⌘+Z undo, `N` next jump of the filter, `R` replay.
  Space and the arrows stay with the player and `[` `]` with the jumps. `Enter` on a button reached with the keyboard presses it; after a
  click it still accepts. The button that opened the review is blurred, so the keys land on the page.
- It moves on by itself (switch, on by default) 450 ms after a jump becomes done, flagged, or accepted, to the next jump of the filter
  that still needs a label; changing an answer of a done jump does not move. `Undo` takes back the last 50 changes, one by one.
- Labels are saved in the local dataset as they are given (never sent to the review service from here), as the five-way label and the figure
  the rest of the app already reads, plus the answers as given (`truth.stages`: blanks stay blank, quarters allowed) and the flag
  (`truth.flag`). Only whole answers make a figure, and so a reference example; partly answered jumps and quarter rotations are kept for
  the stage scores. **Download labels** writes the clip's labels as a `trampovision.jump-labels` file, the one `make eval` scores against;
  **Import labels** puts such a file on the jumps by apex time (it asks first when the file names another video).

### Chrome (`ui/Landing.tsx`, `ui/TopBar.tsx`, `ui/StatusBanners.tsx`, `ui/rail/SetupPanel.tsx`, `styles/chrome.css`)

**TopBar** (56px, `<header class="topbar">`). Left: the logo (a button when `onHome`), then the clip name (truncated,
`title` shows it whole) and its detail line in muted text (spacing, not dots). Right: the language `Menu` (`LanguageMenu`: an icon below 720px; its list lines up with the button's
left edge, not its right, when the athlete/coach switch is shown, and up to 420px it hangs from the bar's gutters, so that it
stays on screen wherever the button is), the athlete/coach `Segmented` when
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

**Recent sets** (`ui/chrome/RecentSets.tsx`, `src/history/`, `styles/recent.css`). Every finished analysis is stored on this device
without asking, so leaving a set never loses it and the old confirm is gone (it only comes back when the write failed). The
landing lists the five newest under the first actions, hidden when there are none: the clip's name (else "Set of {date}"),
the date, the skills and the difficulty, one tap to reopen, a delete control on each row and "Clear history" behind a second
tap. A set is the text of the "Save analysis" JSON (same format, `parsePoseSeries` reads it) plus one line of figures, kept
in the `trampovision` IndexedDB (stores `recent-sets` and `recent-set-data`, at most 20, the oldest evicted, memory when
IndexedDB is missing). The video is never stored, so a reopened set has no video until the clip is added. The coach's
corrections stay in the dataset (by video) and apply to the set when it reopens. `Autosaver` writes when an analysis
completes and again, after a short wait, when the set changes: a correction only updates the line of the list.

**SetupPanel** (the rail's settings page). A header "Settings" with a close button when `onClose`. Sections separated by
hairlines, each with a quiet heading:

- **Athlete**: height in m (`NumberField`, 1 to 2.3, step 0.01; hint that it scales meters when the bed is not marked).
- **Trampoline**: `calibration.status` as text (error styling when `error`); buttons "Mark the trampoline" / "Edit
  corners", while editing "Undo last corner" and "Done", "Clear" when there are corners; bed size long and short in m;
  "Side 1 to 2 is the" long/short; "Meters from" (auto (bed if set), the bed, athlete height).
- **Analysis**: model (Lite (fast), Full, Heavy (most accurate)), frame rate (hint: changing it clears the analysis),
  "Analyze every" (frame, 2nd, 3rd, 4th), athletes to follow (automatic, or 1 to 3; each one gets a track, and several athletes open on the side by side view), "Use the GPU if possible"; the runtime line
  ("Runtime: {backend or not started}") and the WebGPU line (the two original sentences). The primary action is a sticky
  footer: "Analyze video" (block, large) when there is a video and no result, "Analyze again" (secondary) with a result;
  while analyzing there is no action here (Cancel is on the stage's overlay) and the engine fields are disabled. Loading
  disables Analyze.
- **Appearance**: `Segmented` System, Light, Dark.
- **Saved data**: "Open saved analysis (JSON)" (file input) and "Use the sample video" when `onSample`.

## Copy

American English ("analyze", "center", "meters"). Sentence case. Plain verbs, active voice, one name per action through
the whole flow ("Save analysis" and "Open saved analysis"). Errors say what happened and what to do, never apologize.
Empty states point at the next step. Keep the existing technical wording where it is precise; shorten filler.

### Languages

English is the source, in American English, and French, German and Japanese follow it (see _Languages_ in the README). No
string is written in a component: it is a message (`t('key')`) in `src/i18n/messages/en/`, with its translations beside it,
and the compiler and `src/i18n/i18n.test.ts` refuse a key that a language lacks. A new string is written in the four
languages in the same change.

- Use the words of the sport in each language (FIG French _exécution_; German _Haltung_ for the execution score and _Schraube_
  for a twist; Japanese _演技点_ and _ひねり_), the formal address in French and German, the polite form in Japanese.
- Give a count with `tp` (two forms), a number with `formatNumber` / `formatDecimal` / `formatPercent`, never with
  `toFixed` or a hand-written plural.
- A label that shares a narrow column with others needs a short form where a language runs long (German "Schwierigkeit"
  does not fit the list header: `live.colDifficulty` is "Schwierigk."). Layout is checked in the longest language (German)
  and in Japanese, at phone width.
- `<html lang>` follows the language, and CSS may key on it (`:lang(ja)` uses phrase-aware line breaking). Text that is
  built when an analysis runs takes the language of that moment, and a memo that holds such text lists the language in its
  dependencies (`useLocale()`).

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
