/** The twist about the long axis (experimental), what one camera cannot tell about it, the checks behind it, and the 3D view. */
export const twist = {
  'twist.title': 'Twist',
  'twist.experimental': 'Experimental',
  'twist.noWorld': 'This analysis has no 3D pose data, so there is no twist to measure.',
  'twist.noJump': 'No jump found, so there is no twist to measure.',
  'twist.cameraLimits': 'What one camera can never tell about a twist',
  'twist.notMeasured': 'Twist: not measured',
  'twist.notReliable': 'Twist: not reliable',
  'twist.unit': { one: 'twist', other: 'twists' },
  'twist.halfUnit': { one: 'half twist', other: 'half twists' },
  'twist.consistency': 'Consistency',
  'twist.belowMin': 'below {min}',
  'twist.consistencyLabel': 'Twist consistency',
  'twist.rawCaution': 'The raw value below is shown for inspection only. Do not read it as a measurement.',
  'twist.consistencyNote':
    'Consistency = how well the 3D data agrees with itself (the checks below multiplied). It is not a probability of being right: it has not been compared with real twists yet. Use the annotation at the bottom to do that.',
  'twist.measured': 'Measured',
  'twist.raw': 'Raw values (not reliable)',
  'twist.sameRoutes': 'Same twist by other routes',
  'twist.checksBehind': 'Checks behind the consistency',
  'twist.weakCount': '{n} weak',
  'twist.weak': 'Weak',
  'twist.noProblem': 'No data problem found for this jump. That is not proof that the twist is right (see below).',
  'twist.couldNotSettle': 'What the 3D data could not settle',
  'twist.checkAgainst': 'Check against your own count',
  'twist.countLabel': 'Half twists you counted in this jump',
  'twist.cannotSave': 'This jump cannot be saved to the dataset right now, so it cannot be counted.',
  'twist.notCounted': 'Not counted',
  'twist.youCounted': 'You counted',
  'twist.estimate': 'Estimate',
  'twist.same': 'Same',
  'twist.different': 'Different',
  'twist.flagged': 'The estimate was flagged as not reliable.',
  'twist.annotationNote':
    'Saved with the jump in the dataset, so the twist estimate can be scored on real jumps. Half twists are counted from the video, not from this tool.',
  'twist.sinceTakeoff': 'Twist since takeoff, now',
  'twist.speedNow': 'Twist speed, now',
  'twist.option': { one: '{v} (= {twists} twist)', other: '{v} (= {twists} twists)' },
  'twist.readiness': '3D readiness of this browser',
  'twist.checking': 'Checking…',
  'twist.modelInUse': 'Model in use.',
  'twist.separateModel': 'A separate 3D model.',
  'twist.mediapipeNote': 'MediaPipe Tasks Vision runs on WebGL (“GPU”) or WebAssembly (“CPU”). It does not use WebGPU.',

  // The checks behind the consistency
  'twist.check.rounding': 'Close to a whole number of half twists',
  'twist.check.coverage': 'Shoulders and hips found in 3D',
  'twist.check.steps': 'No jumps between frames (left/right swaps)',
  'twist.check.monotonic': 'Turns one way only',
  'twist.check.shoulderHip': 'Shoulders and hips agree',
  'twist.check.axisDepth': 'Same answer with the axis kept in the image plane',
  'twist.check.depth': 'Constant 3D shoulder width',

  // The rows
  'twist.dir.none': 'None',
  'twist.dir.positive': 'Counter-clockwise',
  'twist.dir.negative': 'Clockwise',
  'twist.row.net': 'Net twist, takeoff to landing',
  'twist.row.halves': 'Estimated half twists',
  'twist.row.direction': 'Direction',
  'twist.row.directionHint': 'Seen from above the head: + is counter-clockwise, − is clockwise.',
  'twist.row.peak': 'Peak twist speed',
  'twist.row.mean': 'Mean twist speed',
  'twist.row.tilt': 'Trunk axis out of the image plane',
  'twist.row.onAverage': 'on average',
  'twist.row.shoulders': 'Shoulder line only',
  'twist.row.hips': 'Hip line only',
  'twist.row.plane': 'Axis kept in the image plane',
  'twist.cap.webgpuNoAdapter': 'API present, no GPU adapter',
  'twist.cap.threadsNo': 'No (not cross-origin isolated)',
  'twist.cap.cpu': 'CPU cores / memory',
  'twist.cap.wasm': 'WebAssembly / SIMD',
  'twist.cap.threads': 'WASM threads',

  // What one camera can never tell about a twist
  'twist.limit.depth.signal': 'Depth is guessed',
  'twist.limit.depth.problem':
    'The 3D pose comes from a single image. The twist is the spin of the shoulder line about the body axis, and in a side view that line points at the camera, so it is read only from which shoulder the model puts nearer.',
  'twist.limit.depth.needed': 'A second camera, or a depth sensor.',
  'twist.limit.error.signal': 'A small depth error becomes a large twist',
  'twist.limit.error.problem':
    'Measured on real model output (a still photo turned in the image plane): the model tilted the trunk 15° out of the plane, which produced a phantom −94° of twist over one somersault. Only the “axis in the image plane” check caught it.',
  'twist.limit.error.needed': 'Measured depth.',
  'twist.limit.swap.signal': 'Left and right can swap',
  'twist.limit.swap.problem':
    'If the model swaps the two shoulders, the twist jumps by 180° between two frames. Steps above {max}° are folded back and counted; the half-twist count can then be off by one.',
  'twist.limit.swap.needed': 'A pose model that keeps sides stable, or a higher frame rate.',
  'twist.limit.rate.signal': 'Frame rate limits the speed',
  'twist.limit.rate.problem':
    'At {fps} fps a twist faster than {rate} °/s ({perSecond} twists per second) cannot be told from a swap.',
  'twist.limit.validated.signal': 'Not validated on real twisting athletes',
  'twist.limit.validated.problem':
    'The estimator is exact on a simulated 3D athlete and was checked for phantom twist on one still photo. No twisting trampolinist has been tested. The sign (+ = counter-clockwise seen from above the head) matches the model’s axes on that photo only.',

  // Limits of one estimate
  'tw.signal.twist': 'Twist',
  'tw.signal.pose3d': '3D pose',
  'tw.no3d.problem':
    'This analysis has no 3D landmarks (data saved before 3D support, or a pose backend that gives 2D only).',
  'tw.no3d.needed': 'Analyze the video again with the MediaPipe backend, which returns 3D landmarks with every frame.',
  'tw.cutOff.problem':
    'This jump is cut off by the start or the end of the clip, so the twist between takeoff and landing cannot be summed.',
  'tw.cutOff.needed': 'A clip that shows the whole flight.',
  'tw.notFound.problem': 'The shoulders and hips were not found in 3D during this flight.',
  'tw.notFound.needed': 'A clip where the athlete is visible and large enough for the pose model.',
  'tw.torsoUnknown.problem': 'The torso is not known at takeoff or at landing, so no net twist can be computed.',
  'tw.torsoUnknown.needed': 'Visible shoulders and hips at both events.',
  'tw.coverage.signal': '3D torso coverage',
  'tw.coverage.problem':
    'The shoulders and hips were measured in only {share} of the flight; the rest was bridged or missing.',
  'tw.coverage.needed': 'A clearer view of the torso through the whole flight.',
  'tw.axis.signal': 'Axis depth',
  'tw.axis.problem':
    'The twist depends on how far the trunk axis leans out of the image plane: {total} with the 3D axis, {plane} with the axis kept in the image plane. A small constant depth error turns a somersault into a phantom twist.',
  'tw.axis.needed':
    'Depth that is measured (a second camera or a depth sensor) instead of guessed by a single-camera model.',
  'tw.shoulderHip.signal': 'Shoulders vs hips',
  'tw.shoulderHip.problem':
    'The shoulder line says {shoulders} and the hip line {hips}: they should turn together over a whole flight.',
  'tw.shoulderHip.needed': 'More reliable shoulder and hip landmarks (both are estimated, not measured).',
  'tw.depth.signal': 'Depth consistency',
  'tw.depth.problem':
    'The 3D shoulder width varies by {cv} during the flight. A rigid body keeps it constant, so the depth values are noisy.',
  'tw.depth.needed': 'Better depth: a second camera, or a model trained for athletes in the air.',
  'tw.swaps.signal': 'Left/right swaps',
  'tw.swaps.problem': {
    one: '{n} step larger than {max}° between two frames (largest {largest}) was treated as a left/right swap and folded back. The number of half twists can be off by one.',
    other:
      '{n} steps larger than {max}° between two frames (largest {largest}) were treated as left/right swaps and folded back. The number of half twists can be off by one.',
  },
  'tw.swaps.needed': 'A higher frame rate, or a pose model that keeps left and right stable when the athlete turns.',
  'tw.rate.signal': 'Frame rate',
  'tw.rate.problem':
    'The largest twist step between two frames is {largest}; above {max}° a twist cannot be told from a swap.',
  'tw.rate.needed': 'A higher frame rate.',
  'tw.direction.signal': 'Twist direction',
  'tw.direction.problem':
    'The accumulated twist went one way and came back by {reversal}: a real twist keeps turning one way, so the pose model probably flipped the body.',
  'tw.direction.needed': 'A more stable pose estimate.',
  'tw.rounding.signal': 'Rounding',
  'tw.rounding.problem': '{total} is {off} away from a whole number of half twists.',
  'tw.rounding.needed': 'A cleaner estimate; the true twist is a multiple of 180° at landing.',
  'tw.side.signal': 'Side view',
  'tw.side.problem':
    'In {share} of the flight the shoulder line points along the viewing direction. Then the twist shows only as which shoulder is nearer to the camera, the weakest signal of a single-camera model.',
  'tw.side.needed': 'A second camera, or a view from the front or the back.',

  // What this browser can run
  'cap.runtime.webgl': 'WebGL (GPU delegate)',
  'cap.runtime.wasm': 'WebAssembly (CPU delegate)',
  'cap.runtime.none': 'no supported runtime',
  'cap.current.ok':
    'Available. The MediaPipe pose model already returns 3D landmarks (BlazePose GHUM, in meters) with every frame, so no second model is loaded. It runs on {runtime}.',
  'cap.current.okSimd':
    'Available. The MediaPipe pose model already returns 3D landmarks (BlazePose GHUM, in meters) with every frame, so no second model is loaded. It runs on {runtime}, WASM SIMD on.',
  'cap.current.none': 'This analysis has no 3D landmarks (data saved before 3D support). Analyze the video again.',
  'cap.dedicated.webgpu':
    'A dedicated 3D model could run on WebGPU (through onnxruntime-web) in this browser. Not built: it needs a model file, and I have not tested any.',
  'cap.dedicated.noAdapterThreads':
    'WebGPU is present but has no GPU adapter, so a dedicated 3D model would fall back to WebAssembly with threads. Not built, not tested.',
  'cap.dedicated.noAdapterSingle':
    'WebGPU is present but has no GPU adapter, so a dedicated 3D model would fall back to WebAssembly without threads (the page is not cross-origin isolated), which is slow. Not built, not tested.',
  'cap.dedicated.noWebgpuThreads':
    'WebGPU is not available, so a dedicated 3D model would fall back to WebAssembly with threads. Not built, not tested.',
  'cap.dedicated.noWebgpuSingle':
    'WebGPU is not available, so a dedicated 3D model would fall back to WebAssembly without threads (the page is not cross-origin isolated), which is slow. Not built, not tested.',
  'cap.dedicated.none': 'Neither WebGPU nor WebAssembly is available: no 3D model can run here.',

  // The 3D view
  'p3d.camera': 'Camera',
  'p3d.cameraTitle': 'As the camera sees it: x to the right, y down',
  'p3d.side': 'Side',
  'p3d.sideTitle': 'Looking along the camera’s x axis: shows the depth the model estimated',
  'p3d.above': 'Above',
  'p3d.aboveTitle': 'Looking down from above the athlete',
  'p3d.canvas': '3D skeleton. Drag to rotate.',
  'p3d.notReliable': 'Twist not reliable here',
  'p3d.howToRead': 'How to read this view',
  'p3d.legend':
    'Blue = left, orange = right. Dashed amber = the longitudinal axis (hips to shoulders). Dark dot = chest direction. The ring is the plane perpendicular to the axis: grey = where the shoulder line pointed at takeoff, amber arc = the twist since then. Drag to rotate.',
  'p3d.legendNow':
    'Blue = left, orange = right. Dashed amber = the longitudinal axis (hips to shoulders). Dark dot = chest direction. The ring is the plane perpendicular to the axis: grey = where the shoulder line pointed at takeoff, amber arc = the twist since then (now {now}°). Drag to rotate.',
  'p3d.pointOfView': 'Point of view',
  'p3d.cancelSide': 'Cancel side by side {percent}',
  'p3d.cancel3d': 'Cancel 3D video {percent}',
  'p3d.download3d': 'Download the 3D skeleton as a video (no footage)',
  'p3d.downloadSide': 'Download the annotated video and this 3D view side by side',
  'p3d.noFrame': 'No 3D pose in this frame',
  'p3d.noLandmarks': 'This analysis has no 3D landmarks',
  'p3d.longAxis': 'long axis',
  'p3d.chest': 'chest',
} as const;
