/** The About page: how the app works, what stays on the device, what it cannot do, and where it comes from. */
export const about = {
  'about.title': 'About TrampoVision',
  'about.back': 'Back',
  'about.lead':
    'TrampoVision is a prototype that watches a trampoline video and tells you what each skill was, what it is worth and what to fix. It runs in your browser, with no server and no chatbot: every number comes from simple math that you can read in the code.',

  'about.howTitle': 'How it works',
  'about.howText': 'Seven steps, all on your device, from the video to the score.',
  'about.step1.title': 'Read the video',
  'about.step1.text':
    'The video is read frame by frame, about 30 frames a second, so the result does not depend on how fast your device is. A video that the browser cannot decode (an iPhone HEVC file, for example) is first converted to H.264 with ffmpeg.wasm.',
  'about.step2.title': 'Find the skeleton',
  'about.step2.text':
    'The MediaPipe Pose Landmarker (a BlazePose model) finds 33 body points in every frame, on the GPU when it can and on the CPU with WebAssembly otherwise. It also returns rough 3D coordinates, which only the experimental twist estimate uses.',
  'about.step3.title': 'Clean the signal',
  'about.step3.text':
    'Points that the model doubts are dropped, sudden jumps are rejected, gaps up to 0.3 s are bridged with a parabola and each path is smoothed with a local quadratic fit over 0.15 s. A filled-in point is marked as such and never looks as sure as a measured one.',
  'about.step4.title': 'Follow the center of mass',
  'about.step4.text':
    'The center of mass is the weighted average of 14 body segments. Its height over time gives every jump: the apex, and the takeoff and the landing, found where free fall (9.81 m/s²) starts and ends.',
  'about.step5.title': 'Measure rotation and shape',
  'about.step5.text':
    'The angle of the trunk (hips to shoulders) is unwrapped, so it keeps counting full turns. The hip and knee angles at the most closed moment of the flight tell straight, tuck and pike. The direction the athlete faces tells a front from a back.',
  'about.step6.title': 'Name the skill',
  'about.step6.text':
    'A rule-based classifier compares these measurements with a table of FIG elements and always gives a best guess. A guess it is not sure of is marked with a dashed line and a question mark, and stays out of the totals until you check it with one tap. Your corrections become reference examples.',
  'about.step7.title': 'Score it',
  'about.step7.text':
    'Difficulty is the FIG rule (Code of Points 2025-2028, Trampoline, §17.1) applied to the recognized movement; the tests reproduce all 139 values of the Code’s own table of examples. Execution is only a proposal: it counts the deductions (§20.2) that one side camera can see, with angle limits that are estimates and have not been tuned on footage judged by FIG judges.',

  'about.deviceTitle': 'What stays on your device',
  'about.deviceText1':
    'The video never leaves your browser. The page refuses every request to another site, and the production build adds a Content-Security-Policy that the browser enforces itself.',
  'about.deviceText2':
    'Only numbers are saved, in your browser (IndexedDB): measurements, predictions and your labels, never the video. If the app is set up with a review service, the analyzed jumps can be sent so that a person can check them: measurements only, no video and no file name. A switch in the settings turns it off.',

  'about.limitsTitle': 'What it cannot do yet',
  'about.limit1':
    'How accurate it is on real athletes is not known yet. The tests use a simulated athlete, and the thresholds and the confidence are estimates.',
  'about.limit2':
    'It works best with one fixed, level camera at the side. Twists, straddles and anything seen from the front need more than that. The 3D twist estimate is experimental and says “not reliable” when it cannot be trusted.',
  'about.limit3':
    'Quarter-turn skills (a Cody, for example) are not in the element table: they are named after the closest whole element and flagged as a guess.',
  'about.limit4':
    'The execution score is a proposal, not a judge’s score. Feet, knees together and pointed toes are listed as not checked. TrampoVision is not an official FIG tool.',
  'about.limit5': 'Meters and speeds are estimates: they come from the size of the bed or from the athlete’s height.',

  'about.inspirationTitle': 'Inspiration',
  'about.inspirationText': 'TrampoVision was inspired by the French trampoline club Paris Trampo 12.',
  'about.inspirationLink': 'Paris Trampo 12 (website)',

  'about.rulesTitle': 'The rules',
  'about.rulesText':
    'The difficulty comes from the Code of Points of the FIG (the International Gymnastics Federation). The official rules and manuals are on its website.',
  'about.rulesLink': 'FIG rules and manuals',

  'about.relatedTitle': 'Similar projects and research',
  'about.relatedText':
    'Other work on the same problem, for further reading. TrampoVision has not been compared with it.',
  'about.related.jstage': 'Article on J-STAGE (2025)',
  'about.related.nii': 'Record on CiNii Research',
  'about.related.pmc': 'Article on PubMed Central (PMC12473961)',
  'about.related.devpost': 'BounceBoard, a project on Devpost',
  'about.external': 'Opens another site',

  'about.guidesTitle': 'Guides',
  'about.guidesText':
    'A friendly introduction to the project, and an interactive map of how it works from video to verdict.',
  'about.guidesIntro': 'Introduction to TrampoVision',
  'about.guidesMap': 'Architecture map',

  'about.codeTitle': 'Source code',
  'about.codeText': 'TrampoVision is open on GitHub, with the tests and the notes on how each number is made.',
  'about.codeLink': 'TrampoVision on GitHub',
} as const;
