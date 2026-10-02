import type { Translation } from '..';
import type { errors as en } from '../en/errors';

export const errors: Translation<typeof en> = {
  'err.unsupportedVideo':
    'Dieser Browser kann das Video nicht dekodieren (häufige Ursachen sind iPhone-/HEVC-.mov-Dateien und ProRes). Versuchen Sie eine MP4-Datei (H.264).',
  'err.loadTimeout':
    'Das Laden des Videos ist abgelaufen (readyState {ready}, networkState {network}). Versuchen Sie eine MP4-Datei (H.264).',
  'err.seekTimeout':
    'Das Springen zu {time} s ist nach {attempts} Versuchen abgelaufen (readyState {ready}, networkState {network}, seeking {seeking}, currentTime {current} s). Der Decoder hat sich festgefahren: iPhone-HEVC/HDR-.mov-Dateien tun das im Desktop-Chrome oft. Konvertieren Sie zu H.264 (make video-convert VIDEO=datei.MOV) und öffnen Sie die .mp4.',
  'err.sampleHttp': 'Das Beispielvideo konnte nicht geladen werden (HTTP {status}).',
  'err.ffmpegExit': 'ffmpeg konnte das Video nicht konvertieren (Exit-Code {code}).',
  'err.ffmpegNoData': 'ffmpeg hat keine Videodaten zurückgegeben.',
  'err.exportUnsupported': 'Dieser Browser kann kein Video exportieren (WebCodecs ist nicht verfügbar).',
  'err.exportSurface': 'Für den Export konnte keine Zeichenfläche erstellt werden.',
  'err.exportH264': 'Dieser Browser kann kein H.264-Video kodieren.',
  'err.dimensions': 'Abmessungen oder Dauer des Videos konnten nicht gelesen werden.',
  'err.modelFile':
    'Die Modelldatei {file} wurde nicht gefunden. Führen Sie „npm run fetch-assets“ aus (oder laden Sie sie auf den Asset-Host hoch).',
  'err.notJson': 'Diese Datei ist kein gültiges JSON.',
  'err.notSeries': 'Dies ist keine TrampoVision-Posenreihe.',
  'err.seriesVersion': 'Nicht unterstützte Dateiversion ({found}); diese App liest Version {expected}.',
  'err.noFrames': 'Die Datei enthält keine Bilddaten.',
  'err.frameLandmarks': 'Ein Bild hat nicht {n} Landmarken.',
  'err.frame3d': 'Ein 3D-Bild hat nicht {n} Landmarken.',
  'err.notDataset': 'Dies ist keine TrampoVision-Datensatzdatei.',
  'err.datasetVersion': 'Nicht unterstützte Datensatzversion ({found}); diese App liest Version {expected}.',
  'err.noRecords': 'Der Datensatz enthält keine Einträge.',
  'err.badRecord': 'Eintrag {n} ist kein gültiger Sprungeintrag.',
  'err.idbRequest': 'IndexedDB-Anfrage fehlgeschlagen',
  'err.idbTransaction': 'IndexedDB-Transaktion fehlgeschlagen',
  'err.idbAborted': 'IndexedDB-Transaktion abgebrochen',
  'err.idbOpen': 'Die lokale Datenbank konnte nicht geöffnet werden',
  'err.idbBlocked': 'Die lokale Datenbank ist durch einen anderen Tab blockiert',
  'err.idbMissing': 'IndexedDB ist in diesem Browser nicht verfügbar',
  'err.storeWarning':
    'Der lokale Speicher des Browsers ist nicht verfügbar ({message}). Beschriftungen bleiben nur erhalten, bis Sie diese Seite schließen: Exportieren Sie den Datensatz, um sie zu behalten.',
  'err.dbWrite': 'In die lokale Datenbank konnte nicht geschrieben werden: {message}',

  'sync.unavailable': 'Es wird nichts hochgeladen.',
  'sync.off': 'Aus. Es wird nichts hochgeladen.',
  'sync.idle': 'Wartet auf eine Analyse.',
  'sync.sending': 'Wird gesendet …',
  'sync.sent': { one: '{n} Sprung gesendet.', other: '{n} Sprünge gesendet.' },
  'sync.failed': 'Der Prüfdienst ist nicht erreichbar. Neuer Versuch in Kürze.',
};
