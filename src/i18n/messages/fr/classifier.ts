import type { Translation } from '..';
import type { classifier as en } from '../en/classifier';

export const classifier: Translation<typeof en> = {
  'limit.camera.signal': 'Point de vue de la caméra',
  'limit.camera.problem':
    'Un salto tourne vers la caméra ou à l’opposé quand elle est devant ou derrière l’athlète : l’angle du corps en 2D ne change alors presque pas.',
  'limit.camera.needed': 'Une caméra de côté, à peu près à l’horizontale.',
  'limit.twists.signal': 'Vrilles',
  'limit.twists.problem':
    'La rotation autour de l’axe longitudinal n’est pas mesurée : les lignes des épaules et des hanches sont presque des points vues de côté.',
  'limit.twists.needed': 'Une pose 3D (ou deux caméras).',
  'limit.straddle.signal': 'Écartement des jambes (écart, ciseaux)',
  'limit.straddle.problem':
    'Les jambes se cachent l’une l’autre vues de côté : la distance entre les chevilles renseigne peu sur un écart.',
  'limit.straddle.needed': 'Une caméra de face ou une pose 3D.',
  'limit.quarter.signal': 'Quarts de tour (chutes, rotations de 1¼ ou 1¾)',
  'limit.quarter.problem':
    'La rotation est arrondie au demi-tour ; les réceptions sur le dos, le ventre ou en position assise ne se distinguent pas d’une erreur de mesure.',
  'limit.quarter.needed': 'Une règle ou un modèle pour la position de réception (angle du tronc à la réception).',
  'limit.poseModel.signal': 'Défaillances du modèle de pose',
  'limit.poseModel.problem':
    'Les modèles de pose sont surtout entraînés sur des personnes debout. Quand l’athlète est à l’envers, flou ou masqué, le squelette peut se retourner ou sauter, et la confiance ne peut le remarquer que si l’orientation saute.',
  'limit.poseModel.needed':
    'De vraies images de trampoline pour mesurer la fréquence du problème ; un modèle affiné sur des poses de trampoline s’il est fréquent.',

  'limit.bounds.signal': 'Limites du saut',
  'limit.bounds.problem':
    'L’impulsion ou la réception ne figure pas dans le clip : la rotation et la forme sur tout le vol sont donc inconnues.',
  'limit.bounds.needed': 'Un clip qui commence avant l’impulsion et se termine après la réception.',
  'limit.position.signal': 'Position du corps',
  'limit.position.problem':
    'Hanche {hip} et genou {knee} ne correspondent bien à aucune définition (forme de transition, ou pose bruitée).',
  'limit.position.needed':
    'Ajustez les seuils si cet athlète est plus ou moins souple que les valeurs par défaut, ou obtenez une pose plus propre.',
  'limit.facing.signal': 'Côté regardé',
  'limit.facing.problem':
    'Les indices du visage, du genou et du pied sont trop faibles ou se contredisent ({conf} de confiance) : une rotation dans le sens horaire est un salto avant pour un athlète tourné vers la droite et un salto arrière pour un athlète tourné vers la gauche.',
  'limit.facing.needed':
    'Une vue de côté plus nette (athlète plus grand, visage et pieds visibles), ou indiquez le côté manuellement.',
  'limit.pose.signal': 'Qualité de la pose',
  'limit.pose.problem':
    'Seulement {share} des échantillons des articulations principales pendant le vol ont été mesurés directement (les autres sont interpolés, corrigés ou manquants).',
  'limit.pose.needed':
    'Une résolution plus élevée ou un athlète plus proche, une meilleure lumière, une vitesse d’obturation plus rapide (moins de flou), moins d’occultations.',
  'limit.view.problem':
    'La longueur 2D du tronc varie de {change} pendant le vol ; avec une caméra de côté, elle devrait rester presque constante.',
  'limit.view.needed': 'Une caméra de côté (ou une pose 3D) ; sinon les angles et la rotation sont faussés.',
  'limit.tracking.signal': 'Suivi de l’orientation',
  'limit.tracking.step.problem':
    'L’orientation du corps change jusqu’à {deg} entre deux échantillons : la rotation est peut-être mal comptée, ou le modèle de pose a retourné le corps.',
  'limit.tracking.step.needed':
    'Une cadence plus élevée (analyser chaque image) et un contrôle du squelette aux moments où l’athlète est à l’envers.',
  'limit.tracking.reversal.problem':
    'L’orientation du corps a tourné dans un sens puis est revenue de {deg}. Une vraie rotation continue dans le même sens : le modèle de pose a probablement retourné ou perdu l’athlète quand il était à l’envers, et la rotation nette n’est pas fiable.',
  'limit.tracking.reversal.needed':
    'Contrôlez le squelette sur les images où l’athlète est à l’envers ; un modèle de pose qui gère les athlètes à l’envers, ou une correction manuelle.',
  'limit.cross.signal': 'Contrôle croisé de la rotation',
  'limit.cross.problem':
    'La ligne du corps (chevilles-tête) a tourné de {deg} différemment du tronc (hanches-épaules).',
  'limit.cross.needed': 'Une pose plus propre aux images de l’impulsion et de la réception.',
  'limit.granularity.signal': 'Granularité de la rotation',
  'limit.granularity.problem':
    'La rotation ({total}) est à {off} du demi-tour le plus proche. Il peut s’agir d’une figure à quart de tour (comme une chute) ou d’une erreur de mesure.',
  'limit.granularity.needed':
    'Une règle sur la position de réception (angle du tronc à la réception) pour reconnaître les quarts de tour.',
  'limit.twist.signal': 'Vrille',
  'limit.twist.problem':
    'L’orientation avant l’impulsion diffère de celle à la réception : l’athlète a peut-être vrillé, ou la pose s’est retournée.',
  'limit.twist.needed': 'Une pose 3D ou une seconde caméra pour mesurer la vrille.',
  'limit.unmeasured.problem': 'Non mesurée.',
  'limit.unmeasured.needed': 'Pose 3D.',

  'level.low': 'faible',
  'level.medium': 'moyen',
  'level.high': 'élevé',
  'level.unknown': 'inconnu',
  'turn.clockwise': 'dans le sens horaire',
  'turn.counterclockwise': 'dans le sens antihoraire',
  'turn.none': 'aucune',
  'side.right': 'droite',
  'side.left': 'gauche',
  'facing.forward': 'vers l’avant',
  'facing.backward': 'vers l’arrière',
  'facing.undetermined': 'indéterminé',
  'label.noSomersault': 'pas de salto',
  'label.noTwist': 'pas de vrille',
  'label.somersaults': { one: '{n} salto', other: '{n} saltos' },
  'label.twists': { one: '{n} vrille', other: '{n} vrilles' },
  'label.betweenDefinitions': 'entre les définitions',
  'label.notMeasured': 'non mesuré',
  'label.directionOrBoth': 'avant ou arrière',

  'ev.hip.label': 'Angle de hanche',
  'ev.hip.note': 'épaule–hanche–genou au moment le plus fermé ; 180° = ouvert',
  'ev.knee.label': 'Angle de genou',
  'ev.knee.note': 'hanche–genou–cheville au même moment ; 180° = jambes tendues',
  'ev.orientation.label': 'Orientation du corps',
  'ev.orientation.note': 'angle du tronc par rapport à la verticale au sommet',
  'ev.legSep.label': 'Écartement des jambes',
  'ev.legSep.note': 'distance entre les chevilles / longueur de jambe ; à peine visible de côté',
  'ev.legSep.text': '{level} ({value})',
  'ev.rotation.label': 'Rotation',
  'ev.rotation.text': '{turns} tours (≈{deg}°, confiance {conf})',
  'ev.rotation.note': '{direction}',
  'ev.rotation.noteResidual': '{direction}, à {residual}° du demi-tour le plus proche',
  'ev.kneeTorso.label': 'Genoux–tronc',
  'ev.kneeTorso.text': '{value} longueurs de tronc',
  'ev.kneeTorso.note': 'petit = genoux ramenés',
  'ev.compactness.label': 'Compacité du corps',
  'ev.compactness.note': '0 = allongé, plus élevé = replié',
  'ev.position.label': 'Position du corps',
  'ev.position.text': '{position} ({conf})',
  'ev.position.note': 'sur le vol : {shares}',
  'ev.share': '{position} {share}',
  'ev.facing.label': 'Côté regardé',
  'ev.facing.undetermined': 'indéterminé ({conf})',
  'ev.facing.side': 'vers la {side} de l’image ({conf})',
  'ev.facing.sideManual': 'vers la {side} de l’image ({conf}), réglé manuellement',
  'ev.facing.note': 'visage {face}, genou {knee}, pied {foot} (de -1 = gauche à +1 = droite)',
  'ev.poseQuality.label': 'Qualité de la pose en vol',
  'ev.poseQuality.note': 'articulations mesurées : 1, interpolées : 0,6, corrigées : 0,4, manquantes : 0',
  'ev.temporal.label': 'Correspondance de trajectoire',
  'ev.temporal.noteExample': 'référence la plus proche : un exemple étiqueté de {name}',
  'ev.temporal.noteModel': 'référence la plus proche : le mouvement attendu de {name}',
  'ev.offGrid.label': 'Rotation par rapport au salto entier le plus proche',
  'ev.offGrid.note': 'un salto sous- ou sur-tourné, ou une figure à quart de tour absente du tableau',
  'ev.tolerances': '{d} tolérances d’écart',

  'channel.somersault': 'Rotation de salto (tours)',
  'channel.twist': 'Rotation de vrille (tours)',
  'channel.hip': 'Angle de hanche (÷180°)',
  'channel.knee': 'Angle de genou (÷180°)',
  'channel.shoulderHip': 'Alignement épaules / hanches (÷90°)',
  'channel.comHeight': 'Hauteur du centre de masse (relative)',
  'channel.angVel': 'Vitesse angulaire (tours par vol)',
  'channel.orientSin': 'Orientation du corps, sin',
  'channel.orientCos': 'Orientation du corps, cos',

  'part.rotationNone': 'rotation (aucune)',
  'part.rotationFull': 'rotation (360°)',
  'part.rotationQuality': 'qualité de la rotation',
  'part.positionRule': 'règle de position du corps',
  'part.shapeHeld': 'forme tenue',
  'part.poseQuality': 'qualité de la pose',
  'part.sideOn': 'vue de côté',
  'part.facing': 'côté regardé',
  'part.dataQuality': 'qualité des données',
  'part.structure': 'structure',
  'part.trajectory': 'correspondance de trajectoire',

  'certainty.confident': 'sûr',
  'certainty.probable': 'probable',
  'certainty.tentative': 'hypothèse provisoire',

  'stage.rotation.title': 'Saltos',
  'stage.direction.title': 'Direction',
  'stage.twists.title': 'Vrilles',
  'stage.position.title': 'Position du corps',
  'stage.rotation.cutOff': 'L’impulsion ou la réception manque : la rotation ne peut pas être additionnée.',
  'stage.rotation.path': 'trajet {path} tours (somme des variations d’orientation), net {net} tours',
  'stage.rotation.tolerance': 'tolérance ±{deg}° (qualité de mesure {quality})',
  'stage.rotation.observed': '{turns} saltos ({deg}°)',
  'stage.direction.noTurn': 'le corps ne tourne pas : l’avant et l’arrière ne se distinguent pas',
  'stage.direction.noFacing':
    'le côté regardé est inconnu ({conf}) : une rotation {turn} est un salto avant pour un athlète tourné vers la droite et un salto arrière pour un athlète tourné vers la gauche',
  'stage.direction.towardFace': 'rotation {turn}, athlète tourné vers la {side} ({conf}) : vers le visage',
  'stage.direction.awayFromFace': 'rotation {turn}, athlète tourné vers la {side} ({conf}) : à l’opposé du visage',
  'stage.twists.noMeasureSuspected':
    'pas de mesure 3D de la vrille ; l’orientation 2D avant l’impulsion et à la réception diffère, donc un nombre impair de demi-vrilles est plus probable',
  'stage.twists.noMeasure':
    'pas de mesure 3D de la vrille : aucune vrille n’est supposée, avec un a priori faible pour chaque demi-vrille',
  'stage.twists.stillTwisting': 'vrille encore en cours à la réception ({deg}° sur le dernier dixième du vol)',
  'stage.twists.tolerance': 'tolérance ±{deg}°, confiance de la vrille {conf}',
  'stage.twists.toleranceDiscounted':
    'tolérance ±{deg}°, confiance de la vrille {conf} (sous sa limite de fiabilité : partiellement écartée)',
  'stage.twists.done': '90 % de la vrille réalisée à {at} du vol',
  'stage.twists.observed': '{turns} vrilles ({deg}°)',
  'stage.position.mostClosed': 'moment le plus fermé : {position} (score de règle {score}, tenu {held})',
  'stage.position.share': 'part du vol : {shares}',
  'stage.position.peakAt': 'le plus fermé à {at} du vol',
  'stage.position.folded': 'hanches fléchies de {from} à {to} du vol',

  'check.somersaults': 'saltos',
  'check.direction': 'direction',
  'check.twists': 'vrilles',
  'check.position': 'position',
  'check.distance': '{criterion} : attendu {expected}, mesuré {observed}',

  'diag.lowQuality':
    'Les mesures sont trop peu fiables pour nommer le mouvement (qualité des données {quality} : pose {pose}, contrôles d’orientation {orientation}, vue de la caméra {view}{viewNote}).',
  'diag.viewNote': ' : la longueur du tronc varie de {change}',
  'diag.offGrid':
    'La rotation ({turns} saltos, {deg}°) est à {off}° du salto entier le plus proche, au-delà de la tolérance de mesure : une figure à quart de tour (1¼, une chute) absente du tableau, ou une erreur de mesure.',
  'diag.notInTable':
    'L’essentiel de la probabilité ({share}) porte sur des mouvements que le tableau des éléments ne contient pas.',
  'diag.rotationAmbiguous':
    'La rotation ne peut pas être tranchée entre des nombres entiers de saltos ({measured} mesurés ; l’élément le plus proche en demande {needs}).',
  'diag.directionUnknown': 'L’avant et l’arrière ne se distinguent pas : {reason}.',
  'diag.twistAmbiguous':
    'La vrille ({observed}) tombe entre deux valeurs ; l’élément le plus proche en demande {needs}.',
  'diag.twistUnmeasuredNone':
    'La vrille n’est pas mesurée (pas de 3D) et le mouvement pourrait avoir une vrille ou non.',
  'diag.twistUnmeasuredOther':
    'La vrille n’est pas mesurée (pas de 3D) et le mouvement pourrait avoir un autre nombre de vrilles.',
  'diag.positionAmbiguous': 'La position du corps ne correspond bien à aucune définition ({reason}).',
  'diag.cutOff': 'L’impulsion ou la réception ne figure pas dans le clip.',

  'sum.cutOff': 'Ce saut est coupé au début ou à la fin du clip.',
  'sum.noRotationUnknownPosition':
    'Pas de rotation ({rot}), mais la position du corps est entre les définitions (hanche {hip}, genou {knee}).',
  'sum.straight': 'Pas de rotation et les hanches ({hip}) et les genoux ({knee}) restent ouverts.',
  'sum.pike': 'Pas de rotation ; les hanches se plient à {hip} alors que les jambes restent tendues (genoux {knee}).',
  'sum.tuck': 'Pas de rotation ; les hanches se plient à {hip} et les genoux fléchissent à {knee}.',
  'sum.directionUnknownFull':
    'Une rotation complète ({rot}, {turn}), mais le côté regardé par l’athlète est inconnu : l’avant et l’arrière ne se distinguent donc pas.',
  'sum.front':
    'Une rotation complète ({rot}, {turn}) avec l’athlète tourné vers la {side} : le corps a tourné vers le visage, ce qui est un salto avant.',
  'sum.back':
    'Une rotation complète ({rot}, {turn}) avec l’athlète tourné vers la {side} : le corps a tourné à l’opposé du visage, ce qui est un salto arrière.',
  'sum.outOfSet':
    'La rotation ≈ {deg}° ({turns} tours) sort de l’ensemble initial de figures (pas de rotation ou un salto complet).',
  'sum.bestGuess': 'Meilleure hypothèse : {name} à {conf}, sous le minimum de {min}. {reason}',
  'sum.bestGuessTemporal':
    'Meilleure hypothèse : {name} ({sim} de correspondance de trajectoire, {structure} de structure). {reason}',
  'sum.noPlausible':
    'Aucun candidat plausible : le plus proche est {name} ({sim} de correspondance de trajectoire, {structure} de structure). {reason}',
  'sum.named':
    '{name} ({certainty}, {conf}) : mesuré {measured} ; {sim} de correspondance avec la trajectoire attendue.',
  'sum.assumedDirection': '{summary} La direction (avant ou arrière) a été supposée : {reason}.',
  'sum.directionUnknown':
    '{n} salto(s), {twist}, {position} ; la direction (avant ou arrière) ne peut pas être établie : {reason}.',
  'sum.directionUnknownTemporal':
    '{n} salto(s), {twist}, {position} : la direction (avant ou arrière) ne peut pas être établie ({reason}).',
  'sum.elementObserved': '{name} : {parts}.',
  'sum.positionDetail': '{position} (hanches {hip}, genoux {knee})',
  'sum.measuredTwistNone': 'vrille non mesurée',
  'sum.measuredPositionUnclear': 'position peu claire',
  'sum.measuredPosition': '{position} (hanches {hip}, genoux {knee})',

  'debug.predicted': 'Prédit :',
  'debug.confidence': 'Confiance :',
  'debug.tentative': ' (hypothèse provisoire)',
  'debug.movement': 'Mouvement :',
  'debug.closest': 'Élément le plus proche :',
  'debug.evidence': 'Indices :',
  'debug.trajectory': 'Correspondance de trajectoire : {sim}',
  'debug.why': 'Pourquoi non nommé :',
  'debug.alternatives': 'Alternatives :',
  'debug.alternative': '{name} — {conf}',
  'debug.alternativeSim': '{name} — {conf} (trajectoire {sim})',
  'debug.measurements': 'Mesures :',
  'debug.measurement': '- {label} : {text}',
  'debug.measurementNote': '- {label} : {text} ({note})',
  'debug.notMeasured': '{criterion} : non mesuré (attendu {expected})',
  'debug.observedMatch': '{criterion} : {observed}, attendu {expected}',
  'debug.observedNeeds': '{criterion} : {observed} ; valeur attendue : {expected}',
  'debug.fit': '{text} (adéquation {fit})',
};
