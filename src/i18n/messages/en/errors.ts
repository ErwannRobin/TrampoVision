/** What goes wrong and is told to the person: the video, a saved file, the local database and the review service. */
export const errors = {
  'err.unsupportedVideo':
    'This browser cannot decode the video (iPhone/HEVC .mov and ProRes are common causes). Try an MP4 (H.264) file.',
  'err.loadTimeout':
    'Loading the video timed out (readyState {ready}, networkState {network}). Try an MP4 (H.264) file.',
  'err.seekTimeout':
    'Seek to {time}s timed out after {attempts} attempts (readyState {ready}, networkState {network}, seeking {seeking}, currentTime {current}s). The decoder stalled: iPhone HEVC/HDR .mov files often do this in desktop Chrome. Convert to H.264 (make video-convert VIDEO=file.MOV) and open the .mp4.',
  'err.sampleHttp': 'Could not load the sample video (HTTP {status}).',
  'err.ffmpegExit': 'ffmpeg failed to convert the video (exit code {code}).',
  'err.ffmpegNoData': 'ffmpeg returned no video data.',
  'err.exportUnsupported': 'This browser cannot export video (WebCodecs is not available).',
  'err.exportSurface': 'Could not create a drawing surface for the export.',
  'err.exportH264': 'This browser cannot encode H.264 video.',
  'err.dimensions': 'Could not read the video dimensions/duration.',
  'err.modelFile': 'The model file {file} was not found. Run "npm run fetch-assets" (or upload it to the asset host).',
  'err.notJson': 'This file is not valid JSON.',
  'err.notSeries': 'This is not a TrampoVision pose-series file.',
  'err.seriesVersion': 'Unsupported file version ({found}); this app reads version {expected}.',
  'err.noFrames': 'The file has no frame data.',
  'err.frameLandmarks': 'A frame does not have {n} landmarks.',
  'err.frame3d': 'A 3D frame does not have {n} landmarks.',
  'err.notDataset': 'This is not a TrampoVision dataset file.',
  'err.datasetVersion': 'Unsupported dataset version ({found}); this app reads version {expected}.',
  'err.noRecords': 'The dataset has no records.',
  'err.badRecord': 'Record {n} is not a valid jump record.',
  'err.idbRequest': 'IndexedDB request failed',
  'err.idbTransaction': 'IndexedDB transaction failed',
  'err.idbAborted': 'IndexedDB transaction aborted',
  'err.idbOpen': 'Could not open the local database',
  'err.idbBlocked': 'The local database is blocked by another tab',
  'err.idbMissing': 'IndexedDB is not available in this browser',
  'err.storeWarning':
    "The browser's local storage is not available ({message}). Labels are kept only until you close this page: export the dataset to keep them.",
  'err.dbWrite': 'Could not write to the local database: {message}',

  // What the person is told about the upload to the review service
  'sync.unavailable': 'Nothing is uploaded.',
  'sync.off': 'Off. Nothing is uploaded.',
  'sync.idle': 'Waiting for an analysis.',
  'sync.sending': 'Sending…',
  'sync.sent': { one: '{n} jump sent.', other: '{n} jumps sent.' },
  'sync.failed': 'Could not reach the review service. Trying again in a moment.',
} as const;
