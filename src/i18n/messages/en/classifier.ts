/**
 * What the classifier says about a jump: the limits of the input, the evidence it measured, the four questions it asks (somersaults,
 * direction, twists, position), why it did or did not name a jump, and the text of its summaries. Numbers arrive already formatted.
 */
export const classifier = {
  // What a 2D skeleton from one camera cannot tell
  'limit.camera.signal': 'Camera view',
  'limit.camera.problem':
    'A somersault turns toward or away from a camera that is in front of or behind the athlete, so the 2D body angle barely changes.',
  'limit.camera.needed': 'A side-on, roughly level camera.',
  'limit.twists.signal': 'Twists',
  'limit.twists.problem':
    'Rotation about the long axis is not measured: the shoulder and hip lines are almost points in a side view.',
  'limit.twists.needed': '3D pose (or two cameras).',
  'limit.straddle.signal': 'Leg separation (straddle, scissor)',
  'limit.straddle.problem':
    'The legs hide each other in a side view, so the ankle distance says little about a straddle.',
  'limit.straddle.needed': 'A front-view camera or 3D pose.',
  'limit.quarter.signal': 'Quarter turns (drops, 1¼, 1¾ rotations)',
  'limit.quarter.problem':
    'Rotation is rounded to half turns; landings on back, front or seat are not separated from a measurement error.',
  'limit.quarter.needed': 'A rule or a model for the landing position (torso angle at landing).',
  'limit.poseModel.signal': 'Pose model failures',
  'limit.poseModel.problem':
    'Pose models are trained mostly on upright people. When the athlete is inverted, blurred or overlapped, the skeleton can flip or jump, and the confidence here can only notice it if the orientation jumps.',
  'limit.poseModel.needed':
    'Real trampoline footage to measure how often this happens; a model fine-tuned on trampoline poses if it is frequent.',

  // What this jump's own data limits
  'limit.bounds.signal': 'Jump boundaries',
  'limit.bounds.problem':
    'The takeoff or the landing is not in the clip, so the rotation and the shape over the whole flight are unknown.',
  'limit.bounds.needed': 'A clip that starts before the takeoff and ends after the landing.',
  'limit.position.signal': 'Body position',
  'limit.position.problem':
    'Hip {hip} and knee {knee} fit no definition well (transitional shape, or the pose is noisy).',
  'limit.position.needed':
    'Adjust the thresholds if this athlete is more or less flexible than the defaults, or a cleaner pose.',
  'limit.facing.signal': 'Facing direction',
  'limit.facing.problem':
    'The face, knee and toe cues are too weak or disagree ({conf} confidence): a clockwise turn is a front somersault for an athlete facing right and a back somersault for one facing left.',
  'limit.facing.needed':
    'A clearer side view (larger athlete, face and feet visible), or set the facing side manually.',
  'limit.pose.signal': 'Pose quality',
  'limit.pose.problem':
    'Only {share} of the core joint samples in the flight were measured directly (the rest interpolated, corrected or missing).',
  'limit.pose.needed':
    'Higher resolution or a closer athlete, better light, a faster shutter (less blur), fewer occlusions.',
  'limit.view.problem':
    'The 2D trunk length changes by {change} during the flight; from a side-on camera it should stay nearly constant.',
  'limit.view.needed': 'A side-on camera (or 3D pose); otherwise angles and rotation are distorted.',
  'limit.tracking.signal': 'Orientation tracking',
  'limit.tracking.step.problem':
    'The body orientation changes by up to {deg} between two samples: the rotation may be miscounted, or the pose model flipped the body.',
  'limit.tracking.step.needed':
    'A higher frame rate (analyze every frame) and a check of the skeleton at the inverted moments.',
  'limit.tracking.reversal.problem':
    'The body orientation turned one way and then back by {deg}. A real rotation keeps going one way, so the pose model probably flipped or lost the athlete when inverted, and the net rotation is not trustworthy.',
  'limit.tracking.reversal.needed':
    'Check the skeleton on the inverted frames; a pose model that handles inverted athletes, or a manual correction.',
  'limit.cross.signal': 'Rotation cross-check',
  'limit.cross.problem': 'The body line (ankles to head) rotated {deg} differently from the trunk (hips to shoulders).',
  'limit.cross.needed': 'A cleaner pose at the takeoff and landing frames.',
  'limit.granularity.signal': 'Rotation granularity',
  'limit.granularity.problem':
    'The rotation ({total}) is {off} from the nearest half turn. It may be a quarter-turn skill (such as a drop) or a measurement error.',
  'limit.granularity.needed': 'A landing-position rule (torso angle at landing) to recognize quarter turns.',
  'limit.twist.signal': 'Twist',
  'limit.twist.problem':
    'The facing before the takeoff differs from the facing at the landing: the athlete may have twisted, or the pose flipped.',
  'limit.twist.needed': '3D pose or a second camera to measure the twist.',
  'limit.unmeasured.problem': 'Not measured.',
  'limit.unmeasured.needed': '3D pose.',

  // Words for what was measured
  'level.low': 'low',
  'level.medium': 'medium',
  'level.high': 'high',
  'level.unknown': 'unknown',
  'turn.clockwise': 'clockwise',
  'turn.counterclockwise': 'counterclockwise',
  'turn.none': 'none',
  'side.right': 'right',
  'side.left': 'left',
  'facing.forward': 'forward',
  'facing.backward': 'backward',
  'facing.undetermined': 'undetermined',
  'label.noSomersault': 'no somersault',
  'label.noTwist': 'no twist',
  'label.somersaults': { one: '{n} somersault', other: '{n} somersaults' },
  'label.twists': { one: '{n} twist', other: '{n} twists' },
  'label.betweenDefinitions': 'between the definitions',
  'label.notMeasured': 'not measured',
  'label.directionOrBoth': 'front or back',

  // The measurements shown next to a prediction
  'ev.hip.label': 'Hip angle',
  'ev.hip.note': 'shoulder–hip–knee at the most closed moment; 180° = open',
  'ev.knee.label': 'Knee angle',
  'ev.knee.note': 'hip–knee–ankle at the same moment; 180° = straight legs',
  'ev.orientation.label': 'Body orientation',
  'ev.orientation.note': 'trunk angle from vertical at the apex',
  'ev.legSep.label': 'Leg separation',
  'ev.legSep.note': 'ankle distance / leg length; barely visible from the side',
  'ev.legSep.text': '{level} ({value})',
  'ev.rotation.label': 'Rotation',
  'ev.rotation.text': '{turns} turns (≈{deg}°, confidence {conf})',
  'ev.rotation.note': '{direction}',
  'ev.rotation.noteResidual': '{direction}, {residual}° from the nearest half turn',
  'ev.kneeTorso.label': 'Knees to torso',
  'ev.kneeTorso.text': '{value} trunk lengths',
  'ev.kneeTorso.note': 'small = knees drawn in',
  'ev.compactness.label': 'Body compactness',
  'ev.compactness.note': '0 = stretched, higher = folded',
  'ev.position.label': 'Body position',
  'ev.position.text': '{position} ({conf})',
  'ev.position.note': 'over the flight: {shares}',
  'ev.share': '{position} {share}',
  'ev.facing.label': 'Facing',
  'ev.facing.undetermined': 'undetermined ({conf})',
  'ev.facing.side': '{side} of the image ({conf})',
  'ev.facing.sideManual': '{side} of the image ({conf}), set manually',
  'ev.facing.note': 'face {face}, knee {knee}, foot {foot} (each -1 = left … +1 = right)',
  'ev.poseQuality.label': 'Pose quality in flight',
  'ev.poseQuality.note': 'measured joints count 1, interpolated 0.6, corrected 0.4, missing 0',
  'ev.temporal.label': 'Trajectory match',
  'ev.temporal.noteExample': 'closest reference: a labelled example of {name}',
  'ev.temporal.noteModel': 'closest reference: the expected movement of {name}',
  'ev.offGrid.label': 'Rotation from the nearest whole somersault',
  'ev.offGrid.note': 'an under- or over-rotated somersault, or a quarter-turn skill that is not in the table',
  'ev.tolerances': '{d} tolerances off',

  // The trajectories compared with a reference
  'channel.somersault': 'Somersault rotation (turns)',
  'channel.twist': 'Twist rotation (turns)',
  'channel.hip': 'Hip angle (÷180°)',
  'channel.knee': 'Knee angle (÷180°)',
  'channel.shoulderHip': 'Shoulder / hip alignment (÷90°)',
  'channel.comHeight': 'Center-of-mass height (relative)',
  'channel.angVel': 'Angular velocity (turns per flight)',
  'channel.orientSin': 'Body orientation, sin',
  'channel.orientCos': 'Body orientation, cos',

  // What the confidence is made of
  'part.rotationNone': 'rotation (none)',
  'part.rotationFull': 'rotation (360°)',
  'part.rotationQuality': 'rotation quality',
  'part.positionRule': 'body position rule',
  'part.shapeHeld': 'shape held',
  'part.poseQuality': 'pose quality',
  'part.sideOn': 'side-on view',
  'part.facing': 'facing',
  'part.dataQuality': 'data quality',
  'part.structure': 'structure',
  'part.trajectory': 'trajectory match',

  // How firmly a name is given
  'certainty.confident': 'confident',
  'certainty.probable': 'probable',
  'certainty.tentative': 'tentative guess',

  // The four questions
  'stage.rotation.title': 'Somersaults',
  'stage.direction.title': 'Direction',
  'stage.twists.title': 'Twists',
  'stage.position.title': 'Body position',
  'stage.rotation.cutOff': 'The takeoff or the landing is missing, so the rotation cannot be summed.',
  'stage.rotation.path': 'path {path} turns (sum of the orientation steps), net {net} turns',
  'stage.rotation.tolerance': 'tolerance ±{deg}° (measurement quality {quality})',
  'stage.rotation.observed': '{turns} somersaults ({deg}°)',
  'stage.direction.noTurn': 'the body does not turn: front and back cannot be told apart',
  'stage.direction.noFacing':
    'the facing side is unknown ({conf}): a {turn} turn is a front somersault for an athlete facing right and a back somersault for one facing left',
  'stage.direction.towardFace': '{turn} turn, athlete facing {side} ({conf}): toward the face',
  'stage.direction.awayFromFace': '{turn} turn, athlete facing {side} ({conf}): away from the face',
  'stage.twists.noMeasureSuspected':
    'no 3D twist measurement; the 2D facing before takeoff and at landing disagree, so an odd number of half twists is more likely',
  'stage.twists.noMeasure': 'no 3D twist measurement: no twist is assumed, with a low prior for each half twist',
  'stage.twists.stillTwisting': 'still twisting at landing ({deg}° in the last tenth of the flight)',
  'stage.twists.tolerance': 'tolerance ±{deg}°, twist confidence {conf}',
  'stage.twists.toleranceDiscounted':
    'tolerance ±{deg}°, twist confidence {conf} (below its reliability limit: partly discounted)',
  'stage.twists.done': '90% of the twist done by {at} of the flight',
  'stage.twists.observed': '{turns} twists ({deg}°)',
  'stage.position.mostClosed': 'most closed moment: {position} (rule score {score}, held {held})',
  'stage.position.share': 'share of the flight: {shares}',
  'stage.position.peakAt': 'most closed at {at} of the flight',
  'stage.position.folded': 'hips folded from {from} to {to} of the flight',

  // How one element fits the measurements
  'check.somersaults': 'somersaults',
  'check.direction': 'direction',
  'check.twists': 'twists',
  'check.position': 'position',
  'check.distance': '{criterion}: expected {expected}, measured {observed}',

  // Why a jump was not named
  'diag.lowQuality':
    'The measurements are too unreliable to name the movement (data quality {quality}: pose {pose}, orientation checks {orientation}, camera view {view}{viewNote}).',
  'diag.viewNote': ': the trunk length changes by {change}',
  'diag.offGrid':
    'The rotation ({turns} somersaults, {deg}°) is {off}° from the nearest whole somersault, more than the measurement tolerance allows: a quarter-turn skill (1¼, a drop) that is not in the table, or a measurement error.',
  'diag.notInTable': 'Most of the probability ({share}) lies on movements the element table does not contain.',
  'diag.rotationAmbiguous':
    'The rotation cannot be settled between whole numbers of somersaults ({measured} measured; the closest element needs {needs}).',
  'diag.directionUnknown': 'Front and back cannot be told apart: {reason}.',
  'diag.twistAmbiguous': 'The twist ({observed}) falls between counts; the closest element needs {needs}.',
  'diag.twistUnmeasuredNone': 'Twist is not measured (no 3D) and the movement could have no twist or a twist.',
  'diag.twistUnmeasuredOther': 'Twist is not measured (no 3D) and the movement could have a different twist count.',
  'diag.positionAmbiguous': 'The body position fits no definition well ({reason}).',
  'diag.cutOff': 'The takeoff or the landing is not in the clip.',

  // The one sentence that says what was found
  'sum.cutOff': 'This jump is cut off at the start or the end of the clip.',
  'sum.noRotationUnknownPosition':
    'No rotation ({rot}), but the body position is between the definitions (hip {hip}, knee {knee}).',
  'sum.straight': 'No rotation and the hips ({hip}) and knees ({knee}) stay open.',
  'sum.pike': 'No rotation; the hips fold to {hip} while the legs stay straight (knees {knee}).',
  'sum.tuck': 'No rotation; the hips fold to {hip} and the knees bend to {knee}.',
  'sum.directionUnknownFull':
    'A full rotation ({rot}, {turn}), but which way the athlete faces is unknown, so front and back cannot be told apart.',
  'sum.front':
    'A full rotation ({rot}, {turn}) with the athlete facing {side}: the body turned toward the face, which is a front somersault.',
  'sum.back':
    'A full rotation ({rot}, {turn}) with the athlete facing {side}: the body turned away from the face, which is a back somersault.',
  'sum.outOfSet':
    'Rotation ≈ {deg}° ({turns} turns) is outside the initial skill set (no rotation or one full somersault).',
  'sum.bestGuess': 'Best guess {name} at {conf}, below the minimum of {min}. {reason}',
  'sum.bestGuessTemporal': 'Best guess {name} ({sim} trajectory match, {structure} structural). {reason}',
  'sum.noPlausible':
    'No plausible candidate: the closest is {name} ({sim} trajectory match, {structure} structural). {reason}',
  'sum.named': '{name} ({certainty}, {conf}): measured {measured}; {sim} match to the expected trajectory.',
  'sum.assumedDirection': '{summary} The direction (front or back) was assumed: {reason}.',
  'sum.directionUnknown':
    '{n} somersault(s), {twist}, {position}; the direction (front or back) cannot be told: {reason}.',
  'sum.directionUnknownTemporal':
    '{n} somersault(s), {twist}, {position}: the direction (front or back) cannot be told ({reason}).',
  'sum.elementObserved': '{name}: {parts}.',
  'sum.positionDetail': '{position} (hips {hip}, knees {knee})',
  'sum.measuredTwistNone': 'twist not measured',
  'sum.measuredPositionUnclear': 'position unclear',
  'sum.measuredPosition': '{position} (hips {hip}, knees {knee})',

  // The explanation of a classification (coach view and the text that can be copied)
  'debug.predicted': 'Predicted:',
  'debug.confidence': 'Confidence:',
  'debug.tentative': ' (tentative guess)',
  'debug.movement': 'Movement:',
  'debug.closest': 'Closest element:',
  'debug.evidence': 'Evidence:',
  'debug.trajectory': 'Trajectory match: {sim}',
  'debug.why': 'Why not named:',
  'debug.alternatives': 'Alternatives:',
  'debug.alternative': '{name} — {conf}',
  'debug.alternativeSim': '{name} — {conf} (trajectory {sim})',
  'debug.measurements': 'Measurements:',
  'debug.measurement': '- {label}: {text}',
  'debug.measurementNote': '- {label}: {text} ({note})',
  'debug.notMeasured': '{criterion}: not measured (expected {expected})',
  'debug.observedMatch': '{criterion}: {observed}, expected {expected}',
  'debug.observedNeeds': '{criterion}: {observed}, needs {expected}',
  'debug.fit': '{text} (fit {fit})',
} as const;
