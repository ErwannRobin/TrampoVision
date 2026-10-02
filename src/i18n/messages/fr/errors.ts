import type { Translation } from '..';
import type { errors as en } from '../en/errors';

export const errors: Translation<typeof en> = {
  'err.unsupportedVideo':
    'Ce navigateur ne peut pas décoder la vidéo (les .mov d’iPhone/HEVC et ProRes en sont des causes fréquentes). Essayez un fichier MP4 (H.264).',
  'err.loadTimeout':
    'Le chargement de la vidéo a expiré (readyState {ready}, networkState {network}). Essayez un fichier MP4 (H.264).',
  'err.seekTimeout':
    'Le positionnement à {time} s a expiré après {attempts} tentatives (readyState {ready}, networkState {network}, seeking {seeking}, currentTime {current} s). Le décodeur s’est bloqué : les fichiers .mov HEVC/HDR d’iPhone le font souvent dans Chrome sur ordinateur. Convertissez en H.264 (make video-convert VIDEO=fichier.MOV) et ouvrez le .mp4.',
  'err.sampleHttp': 'Impossible de charger la vidéo d’exemple (HTTP {status}).',
  'err.ffmpegExit': 'ffmpeg n’a pas réussi à convertir la vidéo (code de sortie {code}).',
  'err.ffmpegNoData': 'ffmpeg n’a renvoyé aucune donnée vidéo.',
  'err.exportUnsupported': 'Ce navigateur ne peut pas exporter de vidéo (WebCodecs n’est pas disponible).',
  'err.exportSurface': 'Impossible de créer une surface de dessin pour l’export.',
  'err.exportH264': 'Ce navigateur ne peut pas encoder de vidéo H.264.',
  'err.dimensions': 'Impossible de lire les dimensions ou la durée de la vidéo.',
  'err.modelFile':
    'Le fichier de modèle {file} est introuvable. Lancez « npm run fetch-assets » (ou envoyez-le sur l’hôte des ressources).',
  'err.notJson': 'Ce fichier n’est pas un JSON valide.',
  'err.notSeries': 'Ce n’est pas un fichier de série de poses TrampoVision.',
  'err.seriesVersion': 'Version de fichier non prise en charge ({found}) ; cette appli lit la version {expected}.',
  'err.noFrames': 'Le fichier ne contient aucune donnée d’image.',
  'err.frameLandmarks': 'Une image n’a pas {n} repères.',
  'err.frame3d': 'Une image 3D n’a pas {n} repères.',
  'err.notDataset': 'Ce n’est pas un fichier de jeu de données TrampoVision.',
  'err.datasetVersion':
    'Version de jeu de données non prise en charge ({found}) ; cette appli lit la version {expected}.',
  'err.noRecords': 'Le jeu de données ne contient aucun enregistrement.',
  'err.badRecord': 'L’enregistrement {n} n’est pas un enregistrement de saut valide.',
  'err.idbRequest': 'La requête IndexedDB a échoué',
  'err.idbTransaction': 'La transaction IndexedDB a échoué',
  'err.idbAborted': 'La transaction IndexedDB a été interrompue',
  'err.idbOpen': 'Impossible d’ouvrir la base de données locale',
  'err.idbBlocked': 'La base de données locale est bloquée par un autre onglet',
  'err.idbMissing': 'IndexedDB n’est pas disponible dans ce navigateur',
  'err.storeWarning':
    'Le stockage local du navigateur n’est pas disponible ({message}). Les étiquettes ne sont conservées que jusqu’à la fermeture de cette page : exportez le jeu de données pour les garder.',
  'err.dbWrite': 'Impossible d’écrire dans la base de données locale : {message}',

  'sync.unavailable': 'Rien n’est envoyé.',
  'sync.off': 'Désactivé. Rien n’est envoyé.',
  'sync.idle': 'En attente d’une analyse.',
  'sync.sending': 'Envoi…',
  'sync.sent': { one: '{n} saut envoyé.', other: '{n} sauts envoyés.' },
  'sync.failed': 'Impossible de joindre le service de vérification. Nouvelle tentative dans un instant.',
};
