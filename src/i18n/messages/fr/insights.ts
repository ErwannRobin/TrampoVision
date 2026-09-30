import type { Translation } from '..';
import type { insights as en } from '../en/insights';

export const insights: Translation<typeof en> = {
  'tier.high': 'Confiance élevée',
  'tier.medium': 'Confiance moyenne',
  'tier.low': 'Confiance faible',
  'tier.none': 'Non classé',

  'ins.jumpOf': 'Saut {n} sur {total}',
  'ins.playJump': 'Lire le saut',
  'ins.playJumpTitle': 'Lire le saut avec un peu d’élan et la réception',
  'ins.scoreNote': 'Score heuristique, pas une probabilité',
  'ins.confidence': 'Confiance dans la figure',
  'ins.openSettings': 'Ouvrir les réglages',
  'ins.showTechnical': 'Afficher les détails techniques',
  'ins.coachText':
    'La vue entraîneur ajoute les preuves derrière chaque figure, toutes les mesures, l’analyse des vrilles et tous les graphiques.',

  'ins.empty.title': 'Aucun saut trouvé',
  'ins.empty.text':
    'Le centre de masse ne s’est jamais élevé de 0,3 m au-dessus de son environnement : rien dans ce clip ne compte comme un saut.',
  'ins.empty.check': 'Vérifiez que',
  'ins.empty.frame': 'Tout l’athlète est dans le cadre du début à la fin.',
  'ins.empty.camera': 'La caméra est fixe et horizontale, et ne suit pas l’athlète.',
  'ins.empty.settings':
    'La taille de l’athlète et les dimensions du trampoline sont correctes dans les réglages, car les mètres en découlent.',

  'ins.worth': 'À savoir',
  'ins.whatHelps': 'Ce qui aiderait',
  'ins.dataChecks': 'Contrôles des données',
  'ins.noProblem': 'Aucun problème de données trouvé pour ce saut.',
  'ins.more': { one: '{n} autre point à connaître', other: '{n} autres points à connaître' },

  'ins.jumpsInClip': 'Sauts de ce clip',
  'ins.height': 'Hauteur',
  'ins.airTime': 'Temps de vol',
  'ins.jump': 'Saut',
  'ins.cutOffSr': 'coupé par le clip',
  'ins.barsNote': 'Les barres comparent les sauts au sein de ce clip.',
  'ins.barsNoteDashed':
    'Les barres comparent les sauts au sein de ce clip. Une barre en pointillés est un saut coupé par le clip.',
  'unit.meters': 'mètres',
  'unit.seconds': 'secondes',
  'unit.turns': 'tours',

  'fig.height': 'Hauteur maximale',
  'fig.air': 'Temps en l’air',
  'fig.rotation': 'Rotation',
  'fig.shape': 'Forme du corps',
  'fig.cutOff': 'coupé par le clip',
  'fig.unknown': 'n’a pas pu être mesuré',
  'fig.aboveBed': 'au-dessus de la toile',
  'fig.aboveLowest': 'au-dessus du point le plus bas',
  'fig.takeoffToLanding': 'de l’impulsion à la réception',
  'fig.clockwise': 'sens horaire à l’écran',
  'fig.counterclockwise': 'sens antihoraire à l’écran',
  'fig.noRotation': 'pas de rotation',
  'fig.between': 'Entre deux formes',
  'fig.noShape': 'ne correspond bien à aucune forme',
  'fig.mostClosed': 'à son moment le plus fermé',

  'bed.title': 'Réception sur la toile',
  'bed.left': 'Bord gauche',
  'bed.center': 'Centre',
  'bed.right': 'Bord droit',
  'bed.event.takeoff': 'impulsion',
  'bed.event.apex': 'sommet',
  'bed.event.landing': 'réception',
  'bed.and': ' et ',
  'bed.clause': '{events} {where}',
  'bed.clauseAll': '{events} tous {where}',
  'bed.end': '.',
  'bed.inCenter': 'au centre',
  'bed.pastLeft': 'au-delà du bord gauche',
  'bed.pastRight': 'au-delà du bord droit',
  'bed.towardLeft': 'à {share} du chemin vers le bord gauche',
  'bed.towardRight': 'à {share} du chemin vers le bord droit',
  'bed.unusable':
    'Le trampoline marqué n’a pas pu être utilisé : les positions de réception ne sont donc pas disponibles.',
  'bed.markIt': 'Marquez le trampoline pour voir où chaque saut se termine.',
  'bed.noPosition': 'La position sur la toile n’a pas pu être mesurée pour ce saut.',
  'bed.cutOff': 'Ce saut est coupé par le clip : sa position sur la toile est donc inconnue.',

  'quality.calibrationIgnored': 'Calibrage ignoré : {error}',
  'quality.scales':
    'La toile et l’athlète donnent des échelles qui diffèrent de {gap}. Vérifiez les coins, les dimensions de la toile, la taille de l’athlète, et que l’athlète reste au-dessus de la toile.',
  'quality.viewAlong':
    'La caméra regarde le long du grand côté de la toile : le déplacement horizontal n’est mesuré qu’en travers de la toile.',
  'quality.freeFall':
    'Contrôle de chute libre : {g} m/s² au lieu de 9,81, donc les mètres et les m/s peuvent être décalés d’environ {gap}.',
  'quality.rotationStep':
    'L’orientation du corps change de plus de 120° entre deux échantillons : les rotations sont peut-être sous-comptées. Analysez chaque image.',
  'quality.missingCom': 'Le centre de masse est absent sur {share} des images.',
  'quality.cutOff': 'Un saut est coupé au début ou à la fin du clip : son impulsion ou sa réception est inconnue.',

  'calibration.error.sizes': 'Les dimensions de la toile doivent être positives.',
  'calibration.error.corner': 'Position de coin invalide.',
  'calibration.error.order': 'Les quatre coins doivent se suivre autour de la toile (sans lignes qui se croisent).',
  'calibration.error.small': 'Le contour de la toile est trop petit : cliquez sur des coins plus éloignés.',
  'calibration.error.compute': 'Impossible de calculer le calibrage à partir de ces coins.',
};
