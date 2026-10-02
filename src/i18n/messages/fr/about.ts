import type { Translation } from '..';
import type { about as en } from '../en/about';

export const about: Translation<typeof en> = {
  'about.title': 'À propos de TrampoVision',
  'about.back': 'Retour',
  'about.lead':
    'TrampoVision est un prototype qui regarde une vidéo de trampoline et vous dit ce qu’était chaque élément, ce qu’il vaut et ce qu’il faut corriger. Il tourne dans votre navigateur, sans serveur et sans chatbot : chaque nombre vient de calculs simples que vous pouvez lire dans le code.',

  'about.howTitle': 'Comment ça marche',
  'about.howText': 'Sept étapes, toutes sur votre appareil, de la vidéo à la note.',
  'about.step1.title': 'Lire la vidéo',
  'about.step1.text':
    'La vidéo est lue image par image, à environ 30 images par seconde, si bien que le résultat ne dépend pas de la vitesse de votre appareil. Une vidéo que le navigateur ne sait pas décoder (un fichier HEVC d’iPhone, par exemple) est d’abord convertie en H.264 avec ffmpeg.wasm.',
  'about.step2.title': 'Trouver le squelette',
  'about.step2.text':
    'Le Pose Landmarker de MediaPipe (un modèle BlazePose) trouve 33 points du corps dans chaque image, sur le GPU quand c’est possible, sinon sur le CPU avec WebAssembly. Il renvoie aussi des coordonnées 3D approximatives, que seule l’estimation expérimentale des vrilles utilise.',
  'about.step3.title': 'Nettoyer le signal',
  'about.step3.text':
    'Les points dont le modèle doute sont écartés, les sauts brusques sont rejetés, les trous jusqu’à 0,3 s sont comblés par une parabole et chaque trajectoire est lissée par un ajustement quadratique local sur 0,15 s. Un point rempli est signalé comme tel et ne paraît jamais aussi sûr qu’un point mesuré.',
  'about.step4.title': 'Suivre le centre de masse',
  'about.step4.text':
    'Le centre de masse est la moyenne pondérée de 14 segments du corps. Sa hauteur au fil du temps donne chaque saut : le sommet, puis l’impulsion et la réception, trouvées là où la chute libre (9,81 m/s²) commence et finit.',
  'about.step5.title': 'Mesurer la rotation et la forme',
  'about.step5.text':
    'L’angle du tronc (des hanches aux épaules) est déroulé, de sorte qu’il continue de compter les tours complets. Les angles de hanche et de genou au moment le plus fermé du vol distinguent groupé, carpé et tendu. La direction du regard de l’athlète distingue un avant d’un arrière.',
  'about.step6.title': 'Nommer l’élément',
  'about.step6.text':
    'Un classifieur à règles compare ces mesures à un tableau d’éléments FIG et donne toujours sa meilleure hypothèse. Une hypothèse dont il n’est pas sûr est marquée d’un trait pointillé et d’un point d’interrogation, et reste hors des totaux tant que vous ne l’avez pas vérifiée d’un geste. Vos corrections deviennent des exemples de référence.',
  'about.step7.title': 'Noter',
  'about.step7.text':
    'La difficulté est la règle de la FIG (Code de pointage 2025-2028, Trampoline, §17.1) appliquée au mouvement reconnu ; les tests reproduisent les 139 valeurs du tableau d’exemples du Code lui-même. L’exécution n’est qu’une proposition : elle compte les déductions (§20.2) qu’une seule caméra de côté peut voir, avec des limites d’angle qui sont des estimations et n’ont pas été ajustées sur des vidéos jugées par des juges FIG.',

  'about.deviceTitle': 'Ce qui reste sur votre appareil',
  'about.deviceText1':
    'La vidéo ne quitte jamais votre navigateur. La page refuse toute requête vers un autre site, et la version de production ajoute une Content-Security-Policy que le navigateur applique lui-même.',
  'about.deviceText2':
    'Seuls des nombres sont enregistrés, dans votre navigateur (IndexedDB) : mesures, prédictions et vos étiquettes, jamais la vidéo. Si l’application est reliée à un service de relecture, les sauts analysés peuvent lui être envoyés pour qu’une personne les vérifie : uniquement des mesures, ni vidéo ni nom de fichier. Un réglage dans les paramètres le désactive.',

  'about.limitsTitle': 'Ce qu’il ne sait pas encore faire',
  'about.limit1':
    'On ne sait pas encore quelle est sa précision sur de vrais athlètes. Les tests utilisent un athlète simulé, et les seuils et la confiance sont des estimations.',
  'about.limit2':
    'Il fonctionne mieux avec une seule caméra fixe, à l’horizontale, placée sur le côté. Les vrilles, les écarts et tout ce qui se voit de face demandent davantage. L’estimation 3D des vrilles est expérimentale et indique « non fiable » quand on ne peut pas s’y fier.',
  'about.limit3':
    'Les éléments à quart de tour (un Cody, par exemple) ne figurent pas dans le tableau : ils portent le nom de l’élément entier le plus proche et sont signalés comme une hypothèse.',
  'about.limit4':
    'La note d’exécution est une proposition, pas la note d’un juge. Les pieds, les genoux serrés et les pointes tendues sont indiqués comme non vérifiés. TrampoVision n’est pas un outil officiel de la FIG.',
  'about.limit5':
    'Les mètres et les vitesses sont des estimations : ils viennent de la taille du lit ou de la taille de l’athlète.',

  'about.inspirationTitle': 'Inspiration',
  'about.inspirationText': 'TrampoVision s’inspire du club français de trampoline Paris Trampo 12.',
  'about.inspirationLink': 'Paris Trampo 12 (site web)',

  'about.rulesTitle': 'Les règlements',
  'about.rulesText':
    'La difficulté vient du Code de pointage de la FIG (Fédération internationale de gymnastique). Les règlements et manuels officiels sont sur son site.',
  'about.rulesLink': 'Règlements et manuels de la FIG',

  'about.relatedTitle': 'Projets et recherches similaires',
  'about.relatedText':
    'D’autres travaux sur le même problème, pour aller plus loin. TrampoVision n’a pas été comparé à eux.',
  'about.related.jstage': 'Article sur J-STAGE (2025)',
  'about.related.nii': 'Notice sur CiNii Research',
  'about.related.pmc': 'Article sur PubMed Central (PMC12473961)',
  'about.related.devpost': 'BounceBoard, un projet sur Devpost',
  'about.external': 'Ouvre un autre site',

  'about.guidesTitle': 'Pour aller plus loin',
  'about.guidesText':
    'Une introduction simple au projet, et une carte interactive de son fonctionnement, de la vidéo au verdict.',
  'about.guidesIntro': 'Introduction à TrampoVision',
  'about.guidesMap': 'Carte d’architecture',

  'about.codeTitle': 'Code source',
  'about.codeText':
    'TrampoVision est ouvert sur GitHub, avec les tests et les notes sur la façon dont chaque nombre est obtenu.',
  'about.codeLink': 'TrampoVision sur GitHub',
};
