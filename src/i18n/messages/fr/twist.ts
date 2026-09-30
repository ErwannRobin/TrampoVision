import type { Translation } from '..';
import type { twist as en } from '../en/twist';

export const twist: Translation<typeof en> = {
  'twist.title': 'Vrille',
  'twist.experimental': 'Expérimental',
  'twist.noWorld': 'Cette analyse n’a pas de données de pose 3D : il n’y a donc pas de vrille à mesurer.',
  'twist.noJump': 'Aucun saut trouvé : il n’y a donc pas de vrille à mesurer.',
  'twist.cameraLimits': 'Ce qu’une seule caméra ne peut jamais dire d’une vrille',
  'twist.notMeasured': 'Vrille : non mesurée',
  'twist.notReliable': 'Vrille : non fiable',
  'twist.unit': { one: 'vrille', other: 'vrilles' },
  'twist.halfUnit': { one: 'demi-vrille', other: 'demi-vrilles' },
  'twist.consistency': 'Cohérence',
  'twist.belowMin': 'sous {min}',
  'twist.consistencyLabel': 'Cohérence de la vrille',
  'twist.rawCaution':
    'La valeur brute ci-dessous n’est affichée que pour inspection. Ne la lisez pas comme une mesure.',
  'twist.consistencyNote':
    'Cohérence = à quel point les données 3D concordent entre elles (les contrôles ci-dessous multipliés). Ce n’est pas une probabilité d’avoir raison : elle n’a pas encore été comparée à de vraies vrilles. Utilisez l’annotation en bas pour le faire.',
  'twist.measured': 'Mesuré',
  'twist.raw': 'Valeurs brutes (non fiables)',
  'twist.sameRoutes': 'La même vrille par d’autres voies',
  'twist.checksBehind': 'Contrôles derrière la cohérence',
  'twist.weakCount': '{n} faible(s)',
  'twist.weak': 'Faible',
  'twist.noProblem':
    'Aucun problème de données trouvé pour ce saut. Ce n’est pas une preuve que la vrille est juste (voir ci-dessous).',
  'twist.couldNotSettle': 'Ce que les données 3D n’ont pas permis de trancher',
  'twist.checkAgainst': 'Comparer à votre propre comptage',
  'twist.countLabel': 'Demi-vrilles que vous avez comptées dans ce saut',
  'twist.cannotSave':
    'Ce saut ne peut pas être enregistré dans le jeu de données pour l’instant : il ne peut donc pas être compté.',
  'twist.notCounted': 'Non compté',
  'twist.youCounted': 'Vous avez compté',
  'twist.estimate': 'Estimation',
  'twist.same': 'Identique',
  'twist.different': 'Différent',
  'twist.flagged': 'L’estimation a été signalée comme non fiable.',
  'twist.annotationNote':
    'Enregistré avec le saut dans le jeu de données, pour que l’estimation de vrille puisse être évaluée sur de vrais sauts. Les demi-vrilles sont comptées d’après la vidéo, pas d’après cet outil.',
  'twist.sinceTakeoff': 'Vrille depuis l’impulsion, maintenant',
  'twist.speedNow': 'Vitesse de vrille, maintenant',
  'twist.option': { one: '{v} (= {twists} vrille)', other: '{v} (= {twists} vrilles)' },
  'twist.readiness': 'Compatibilité 3D de ce navigateur',
  'twist.checking': 'Vérification…',
  'twist.modelInUse': 'Modèle utilisé.',
  'twist.separateModel': 'Un modèle 3D séparé.',
  'twist.mediapipeNote':
    'MediaPipe Tasks Vision fonctionne sur WebGL (« GPU ») ou WebAssembly (« CPU »). Il n’utilise pas WebGPU.',

  'twist.check.rounding': 'Proche d’un nombre entier de demi-vrilles',
  'twist.check.coverage': 'Épaules et hanches trouvées en 3D',
  'twist.check.steps': 'Pas de sauts entre les images (inversions gauche/droite)',
  'twist.check.monotonic': 'Tourne dans un seul sens',
  'twist.check.shoulderHip': 'Épaules et hanches concordent',
  'twist.check.axisDepth': 'Même résultat avec l’axe maintenu dans le plan de l’image',
  'twist.check.depth': 'Largeur d’épaules 3D constante',

  'twist.dir.none': 'Aucune',
  'twist.dir.positive': 'Sens antihoraire',
  'twist.dir.negative': 'Sens horaire',
  'twist.row.net': 'Vrille nette, de l’impulsion à la réception',
  'twist.row.halves': 'Demi-vrilles estimées',
  'twist.row.direction': 'Direction',
  'twist.row.directionHint': 'Vu de dessus la tête : + est dans le sens antihoraire, − dans le sens horaire.',
  'twist.row.peak': 'Vitesse de vrille maximale',
  'twist.row.mean': 'Vitesse de vrille moyenne',
  'twist.row.tilt': 'Axe du tronc hors du plan de l’image',
  'twist.row.onAverage': 'en moyenne',
  'twist.row.shoulders': 'Ligne des épaules seule',
  'twist.row.hips': 'Ligne des hanches seule',
  'twist.row.plane': 'Axe maintenu dans le plan de l’image',
  'twist.cap.webgpuNoAdapter': 'API présente, pas d’adaptateur GPU',
  'twist.cap.threadsNo': 'Non (pas d’isolation cross-origin)',
  'twist.cap.cpu': 'Cœurs CPU / mémoire',
  'twist.cap.wasm': 'WebAssembly / SIMD',
  'twist.cap.threads': 'Threads WASM',

  'twist.limit.depth.signal': 'La profondeur est devinée',
  'twist.limit.depth.problem':
    'La pose 3D vient d’une seule image. La vrille est la rotation de la ligne des épaules autour de l’axe du corps ; en vue de côté, cette ligne pointe vers la caméra : elle n’est donc lue qu’à partir de l’épaule que le modèle place le plus près.',
  'twist.limit.depth.needed': 'Une deuxième caméra, ou un capteur de profondeur.',
  'twist.limit.error.signal': 'Une petite erreur de profondeur devient une grande vrille',
  'twist.limit.error.problem':
    'Mesuré sur une vraie sortie du modèle (une photo fixe tournée dans le plan de l’image) : le modèle a incliné le tronc de 15° hors du plan, ce qui a produit une vrille fantôme de −94° sur un salto. Seul le contrôle « axe dans le plan de l’image » l’a détectée.',
  'twist.limit.error.needed': 'Une profondeur mesurée.',
  'twist.limit.swap.signal': 'La gauche et la droite peuvent s’inverser',
  'twist.limit.swap.problem':
    'Si le modèle inverse les deux épaules, la vrille saute de 180° entre deux images. Les sauts supérieurs à {max}° sont repliés et comptés ; le nombre de demi-vrilles peut alors être faux d’une unité.',
  'twist.limit.swap.needed': 'Un modèle de pose qui garde les côtés stables, ou une cadence plus élevée.',
  'twist.limit.rate.signal': 'La cadence limite la vitesse',
  'twist.limit.rate.problem':
    'À {fps} im/s, une vrille plus rapide que {rate} °/s ({perSecond} vrilles par seconde) ne se distingue pas d’une inversion.',
  'twist.limit.validated.signal': 'Non validé sur de vrais athlètes qui vrillent',
  'twist.limit.validated.problem':
    'L’estimateur est exact sur un athlète 3D simulé et a été contrôlé pour la vrille fantôme sur une photo fixe. Aucun trampoliniste réalisant des vrilles n’a été testé. Le signe (+ = sens antihoraire vu de dessus la tête) ne correspond aux axes du modèle que sur cette photo.',

  'tw.signal.twist': 'Vrille',
  'tw.signal.pose3d': 'Pose 3D',
  'tw.no3d.problem':
    'Cette analyse n’a pas de repères 3D (données enregistrées avant la prise en charge de la 3D, ou moteur de pose qui ne donne que du 2D).',
  'tw.no3d.needed':
    'Relancez l’analyse de la vidéo avec le moteur MediaPipe, qui renvoie des repères 3D à chaque image.',
  'tw.cutOff.problem':
    'Ce saut est coupé par le début ou la fin du clip : la vrille entre l’impulsion et la réception ne peut pas être additionnée.',
  'tw.cutOff.needed': 'Un clip qui montre tout le vol.',
  'tw.notFound.problem': 'Les épaules et les hanches n’ont pas été trouvées en 3D pendant ce vol.',
  'tw.notFound.needed': 'Un clip où l’athlète est visible et assez grand pour le modèle de pose.',
  'tw.torsoUnknown.problem':
    'Le tronc n’est pas connu à l’impulsion ou à la réception : aucune vrille nette ne peut être calculée.',
  'tw.torsoUnknown.needed': 'Épaules et hanches visibles aux deux instants.',
  'tw.coverage.signal': 'Couverture 3D du tronc',
  'tw.coverage.problem':
    'Les épaules et les hanches n’ont été mesurées que sur {share} du vol ; le reste a été comblé ou manque.',
  'tw.coverage.needed': 'Une vue plus nette du tronc pendant tout le vol.',
  'tw.axis.signal': 'Profondeur de l’axe',
  'tw.axis.problem':
    'La vrille dépend de l’inclinaison de l’axe du tronc hors du plan de l’image : {total} avec l’axe 3D, {plane} avec l’axe maintenu dans le plan de l’image. Une petite erreur de profondeur constante transforme un salto en vrille fantôme.',
  'tw.axis.needed':
    'Une profondeur mesurée (deuxième caméra ou capteur de profondeur) plutôt que devinée par un modèle à une seule caméra.',
  'tw.shoulderHip.signal': 'Épaules et hanches',
  'tw.shoulderHip.problem':
    'La ligne des épaules indique {shoulders} et celle des hanches {hips} : elles devraient tourner ensemble sur tout un vol.',
  'tw.shoulderHip.needed': 'Des repères d’épaules et de hanches plus fiables (tous deux sont estimés, pas mesurés).',
  'tw.depth.signal': 'Cohérence de la profondeur',
  'tw.depth.problem':
    'La largeur d’épaules 3D varie de {cv} pendant le vol. Un corps rigide la garde constante : les valeurs de profondeur sont donc bruitées.',
  'tw.depth.needed':
    'Une meilleure profondeur : une deuxième caméra, ou un modèle entraîné pour des athlètes en l’air.',
  'tw.swaps.signal': 'Inversions gauche/droite',
  'tw.swaps.problem': {
    one: '{n} saut supérieur à {max}° entre deux images (le plus grand : {largest}) a été traité comme une inversion gauche/droite et replié. Le nombre de demi-vrilles peut être faux d’une unité.',
    other:
      '{n} sauts supérieurs à {max}° entre deux images (le plus grand : {largest}) ont été traités comme des inversions gauche/droite et repliés. Le nombre de demi-vrilles peut être faux d’une unité.',
  },
  'tw.swaps.needed':
    'Une cadence plus élevée, ou un modèle de pose qui garde la gauche et la droite stables quand l’athlète tourne.',
  'tw.rate.signal': 'Cadence',
  'tw.rate.problem':
    'Le plus grand pas de vrille entre deux images est {largest} ; au-delà de {max}°, une vrille ne se distingue pas d’une inversion.',
  'tw.rate.needed': 'Une cadence plus élevée.',
  'tw.direction.signal': 'Sens de la vrille',
  'tw.direction.problem':
    'La vrille accumulée est partie dans un sens puis est revenue de {reversal} : une vraie vrille continue de tourner dans le même sens ; le modèle de pose a donc probablement retourné le corps.',
  'tw.direction.needed': 'Une estimation de pose plus stable.',
  'tw.rounding.signal': 'Arrondi',
  'tw.rounding.problem': '{total} est à {off} d’un nombre entier de demi-vrilles.',
  'tw.rounding.needed': 'Une estimation plus propre ; la vraie vrille est un multiple de 180° à la réception.',
  'tw.side.signal': 'Vue de côté',
  'tw.side.problem':
    'Pendant {share} du vol, la ligne des épaules pointe le long de la direction de visée. La vrille n’apparaît alors que par l’épaule la plus proche de la caméra, le signal le plus faible d’un modèle à une seule caméra.',
  'tw.side.needed': 'Une deuxième caméra, ou une vue de face ou de dos.',

  'cap.runtime.webgl': 'WebGL (délégué GPU)',
  'cap.runtime.wasm': 'WebAssembly (délégué CPU)',
  'cap.runtime.none': 'aucun environnement d’exécution pris en charge',
  'cap.current.ok':
    'Disponible. Le modèle de pose MediaPipe renvoie déjà des repères 3D (BlazePose GHUM, en mètres) à chaque image : aucun second modèle n’est chargé. Il s’exécute sur {runtime}.',
  'cap.current.okSimd':
    'Disponible. Le modèle de pose MediaPipe renvoie déjà des repères 3D (BlazePose GHUM, en mètres) à chaque image : aucun second modèle n’est chargé. Il s’exécute sur {runtime}, WASM SIMD activé.',
  'cap.current.none':
    'Cette analyse n’a pas de repères 3D (données enregistrées avant la prise en charge de la 3D). Relancez l’analyse de la vidéo.',
  'cap.dedicated.webgpu':
    'Un modèle 3D dédié pourrait s’exécuter sur WebGPU (via onnxruntime-web) dans ce navigateur. Non construit : il faut un fichier de modèle, et je n’en ai testé aucun.',
  'cap.dedicated.noAdapterThreads':
    'WebGPU est présent mais n’a pas d’adaptateur GPU : un modèle 3D dédié se rabattrait sur WebAssembly avec threads. Non construit, non testé.',
  'cap.dedicated.noAdapterSingle':
    'WebGPU est présent mais n’a pas d’adaptateur GPU : un modèle 3D dédié se rabattrait sur WebAssembly sans threads (la page n’est pas isolée cross-origin), ce qui est lent. Non construit, non testé.',
  'cap.dedicated.noWebgpuThreads':
    'WebGPU n’est pas disponible : un modèle 3D dédié se rabattrait sur WebAssembly avec threads. Non construit, non testé.',
  'cap.dedicated.noWebgpuSingle':
    'WebGPU n’est pas disponible : un modèle 3D dédié se rabattrait sur WebAssembly sans threads (la page n’est pas isolée cross-origin), ce qui est lent. Non construit, non testé.',
  'cap.dedicated.none': 'Ni WebGPU ni WebAssembly n’est disponible : aucun modèle 3D ne peut s’exécuter ici.',

  'p3d.camera': 'Caméra',
  'p3d.cameraTitle': 'Tel que la caméra le voit : x vers la droite, y vers le bas',
  'p3d.side': 'Côté',
  'p3d.sideTitle': 'Vue le long de l’axe x de la caméra : montre la profondeur estimée par le modèle',
  'p3d.above': 'Dessus',
  'p3d.aboveTitle': 'Vue de dessus, au-dessus de l’athlète',
  'p3d.canvas': 'Squelette 3D. Faites glisser pour le faire pivoter.',
  'p3d.notReliable': 'Vrille non fiable ici',
  'p3d.howToRead': 'Comment lire cette vue',
  'p3d.legend':
    'Bleu = gauche, orange = droite. Ambre en pointillés = l’axe longitudinal (des hanches aux épaules). Point sombre = direction de la poitrine. L’anneau est le plan perpendiculaire à l’axe : gris = où pointait la ligne des épaules à l’impulsion, arc ambre = la vrille depuis. Faites glisser pour pivoter.',
  'p3d.legendNow':
    'Bleu = gauche, orange = droite. Ambre en pointillés = l’axe longitudinal (des hanches aux épaules). Point sombre = direction de la poitrine. L’anneau est le plan perpendiculaire à l’axe : gris = où pointait la ligne des épaules à l’impulsion, arc ambre = la vrille depuis (maintenant {now}°). Faites glisser pour pivoter.',
  'p3d.pointOfView': 'Point de vue',
  'p3d.cancelSide': 'Annuler l’export côte à côte {percent}',
  'p3d.cancel3d': 'Annuler la vidéo 3D {percent}',
  'p3d.download3d': 'Télécharger le squelette 3D en vidéo (sans images filmées)',
  'p3d.downloadSide': 'Télécharger la vidéo annotée et cette vue 3D côte à côte',
  'p3d.noFrame': 'Pas de pose 3D dans cette image',
  'p3d.noLandmarks': 'Cette analyse n’a pas de repères 3D',
  'p3d.longAxis': 'axe longitudinal',
  'p3d.chest': 'poitrine',
};
