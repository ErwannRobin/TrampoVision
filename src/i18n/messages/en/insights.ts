/** The athlete's view: the answer for a jump, four figures, where it landed on the bed, what is worth knowing, and the checks of the clip. */
export const insights = {
  'tier.high': 'High confidence',
  'tier.medium': 'Medium confidence',
  'tier.low': 'Low confidence',
  'tier.none': 'Not classified',

  'ins.jumpOf': 'Jump {n} of {total}',
  'ins.playJump': 'Play jump',
  'ins.playJumpTitle': 'Play the jump with a little run-up and landing',
  'ins.scoreNote': 'Heuristic score, not a probability',
  'ins.confidence': 'Skill confidence',
  'ins.openSettings': 'Open settings',
  'ins.showTechnical': 'Show technical details',
  'ins.coachText':
    "The coach's view adds the evidence behind each skill, every measurement, the twist analysis and all the charts.",

  'ins.empty.title': 'No jump found',
  'ins.empty.text':
    'The center of mass never rose 0.3 m above its surroundings, so nothing in this clip counts as a jump.',
  'ins.empty.check': 'Check that',
  'ins.empty.frame': 'The whole athlete is in the frame from start to end.',
  'ins.empty.camera': 'The camera is fixed and level, and does not follow the athlete.',
  'ins.empty.settings':
    'The athlete height and the trampoline size are right in the settings, because meters come from them.',

  'ins.worth': 'Worth knowing',
  'ins.whatHelps': 'What would help',
  'ins.dataChecks': 'Data checks',
  'ins.noProblem': 'No data problem found for this jump.',
  'ins.more': { one: '{n} more thing to know', other: '{n} more things to know' },

  'ins.jumpsInClip': 'Jumps in this clip',
  'ins.height': 'Height',
  'ins.airTime': 'Air time',
  'ins.jump': 'Jump',
  'ins.cutOffSr': 'cut off by the clip',
  'ins.barsNote': 'Bars compare jumps within this clip.',
  'ins.barsNoteDashed': 'Bars compare jumps within this clip. A dashed bar is a jump cut off by the clip.',
  'unit.meters': 'meters',
  'unit.seconds': 'seconds',
  'unit.turns': 'turns',

  // The four figures
  'fig.height': 'Peak height',
  'fig.air': 'Time in the air',
  'fig.rotation': 'Rotation',
  'fig.shape': 'Body shape',
  'fig.cutOff': 'cut off by the clip',
  'fig.unknown': 'could not be measured',
  'fig.aboveBed': 'above the bed',
  'fig.aboveLowest': 'above the lowest point',
  'fig.takeoffToLanding': 'takeoff to landing',
  'fig.clockwise': 'clockwise on screen',
  'fig.counterclockwise': 'counterclockwise on screen',
  'fig.noRotation': 'no rotation',
  'fig.between': 'Between shapes',
  'fig.noShape': 'fits no shape well',
  'fig.mostClosed': 'at its most closed moment',

  // Where the jump landed on the bed
  'bed.title': 'Landing on the bed',
  'bed.left': 'Left edge',
  'bed.center': 'Center',
  'bed.right': 'Right edge',
  'bed.event.takeoff': 'takeoff',
  'bed.event.apex': 'apex',
  'bed.event.landing': 'landing',
  'bed.and': ' and ',
  'bed.clause': '{events} {where}',
  'bed.clauseAll': '{events} all {where}',
  'bed.end': '.',
  'bed.inCenter': 'in the center',
  'bed.pastLeft': 'past the left edge',
  'bed.pastRight': 'past the right edge',
  'bed.towardLeft': '{share} of the way to the left edge',
  'bed.towardRight': '{share} of the way to the right edge',
  'bed.unusable': 'The marked trampoline could not be used, so landing positions are not available.',
  'bed.markIt': 'Mark the trampoline to see where each jump lands.',
  'bed.noPosition': 'The position on the bed could not be measured for this jump.',
  'bed.cutOff': 'This jump is cut off by the clip, so its position on the bed is unknown.',

  // Things to double-check in the whole clip
  'quality.calibrationIgnored': 'Calibration ignored: {error}',
  'quality.scales':
    'The bed and the athlete give scales {gap} apart. Check the corners, the bed size, the athlete height, and that the athlete stays over the bed.',
  'quality.viewAlong':
    'The camera looks along the long side of the bed: horizontal displacement is measured across the bed only.',
  'quality.freeFall': 'Free-fall check: {g} m/s² instead of 9.81, so meters and m/s may be about {gap} off.',
  'quality.rotationStep':
    'Body orientation changes by more than 120° between two samples: rotations may be undercounted. Analyze every frame.',
  'quality.missingCom': 'The center of mass is missing in {share} of the frames.',
  'quality.cutOff': 'A jump is cut off at the start or end of the clip: its takeoff or landing is unknown.',

  // Why the marked trampoline was refused
  'calibration.error.sizes': 'Bed sizes must be positive.',
  'calibration.error.corner': 'Invalid corner position.',
  'calibration.error.order': 'The four corners must be in order around the bed (no crossing lines).',
  'calibration.error.small': 'The bed outline is too small: click the corners farther apart.',
  'calibration.error.compute': 'Could not compute the calibration from these corners.',
} as const;
