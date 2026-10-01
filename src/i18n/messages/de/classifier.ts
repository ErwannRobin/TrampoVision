import type { Translation } from '..';
import type { classifier as en } from '../en/classifier';

export const classifier: Translation<typeof en> = {
  'limit.camera.signal': 'Kameraperspektive',
  'limit.camera.problem':
    'Ein Salto dreht sich auf eine Kamera zu oder von ihr weg, wenn sie vor oder hinter dem Athleten steht; der 2D-Körperwinkel ändert sich dann kaum.',
  'limit.camera.needed': 'Eine seitlich stehende, etwa waagerechte Kamera.',
  'limit.twists.signal': 'Schrauben',
  'limit.twists.problem':
    'Die Drehung um die Längsachse wird nicht gemessen: Schulter- und Hüftlinie sind in der Seitenansicht fast Punkte.',
  'limit.twists.needed': '3D-Pose (oder zwei Kameras).',
  'limit.straddle.signal': 'Beinabstand (Grätsche, Schere)',
  'limit.straddle.problem':
    'Die Beine verdecken sich in der Seitenansicht gegenseitig, daher sagt der Knöchelabstand wenig über eine Grätsche aus.',
  'limit.straddle.needed': 'Eine Kamera von vorn oder 3D-Pose.',
  'limit.quarter.signal': 'Vierteldrehungen (Landungen, 1¼- und 1¾-Drehungen)',
  'limit.quarter.problem':
    'Die Rotation wird auf halbe Drehungen gerundet; Landungen auf Rücken, Bauch oder Gesäß lassen sich nicht von einem Messfehler unterscheiden.',
  'limit.quarter.needed': 'Eine Regel oder ein Modell für die Landeposition (Rumpfwinkel bei der Landung).',
  'limit.poseModel.signal': 'Fehler des Posenmodells',
  'limit.poseModel.problem':
    'Posenmodelle werden überwiegend mit aufrechten Personen trainiert. Ist der Athlet kopfüber, verwackelt oder verdeckt, kann das Skelett umklappen oder springen; das Vertrauen bemerkt das nur, wenn die Ausrichtung springt.',
  'limit.poseModel.needed':
    'Echtes Trampolinmaterial, um zu messen, wie oft das passiert; ein auf Trampolinposen feinabgestimmtes Modell, falls es häufig ist.',

  'limit.bounds.signal': 'Sprunggrenzen',
  'limit.bounds.problem':
    'Absprung oder Landung fehlt im Clip, daher sind Rotation und Körperform über den ganzen Flug unbekannt.',
  'limit.bounds.needed': 'Ein Clip, der vor dem Absprung beginnt und nach der Landung endet.',
  'limit.position.signal': 'Körperhaltung',
  'limit.position.problem':
    'Hüfte {hip} und Knie {knee} passen zu keiner Definition gut (Übergangsform oder verrauschte Pose).',
  'limit.position.needed':
    'Passen Sie die Schwellenwerte an, wenn dieser Athlet beweglicher oder weniger beweglich als die Standardwerte ist, oder sorgen Sie für eine sauberere Pose.',
  'limit.facing.signal': 'Blickrichtung',
  'limit.facing.problem':
    'Die Hinweise von Gesicht, Knie und Fuß sind zu schwach oder widersprüchlich ({conf} Vertrauen): Eine Drehung im Uhrzeigersinn ist für einen nach rechts blickenden Athleten ein Salto vorwärts und für einen nach links blickenden ein Salto rückwärts.',
  'limit.facing.needed':
    'Eine deutlichere Seitenansicht (größerer Athlet, Gesicht und Füße sichtbar) oder die Blickrichtung manuell festlegen.',
  'limit.pose.signal': 'Posenqualität',
  'limit.pose.problem':
    'Nur {share} der Stichproben der Hauptgelenke im Flug wurden direkt gemessen (der Rest ist interpoliert, korrigiert oder fehlt).',
  'limit.pose.needed':
    'Höhere Auflösung oder ein näherer Athlet, besseres Licht, kürzere Verschlusszeit (weniger Unschärfe), weniger Verdeckungen.',
  'limit.view.problem':
    'Die 2D-Rumpflänge ändert sich im Flug um {change}; aus der Seitenansicht sollte sie nahezu konstant bleiben.',
  'limit.view.needed': 'Eine seitliche Kamera (oder 3D-Pose); andernfalls sind Winkel und Rotation verzerrt.',
  'limit.tracking.signal': 'Verfolgung der Ausrichtung',
  'limit.tracking.step.problem':
    'Die Körperausrichtung ändert sich zwischen zwei Stichproben um bis zu {deg}: Die Rotation wurde eventuell falsch gezählt, oder das Posenmodell hat den Körper umgeklappt.',
  'limit.tracking.step.needed':
    'Eine höhere Bildrate (jedes Bild analysieren) und eine Kontrolle des Skeletts in den Momenten, in denen der Athlet kopfüber ist.',
  'limit.tracking.reversal.problem':
    'Die Körperausrichtung drehte sich in eine Richtung und dann um {deg} zurück. Eine echte Rotation läuft immer in dieselbe Richtung weiter; das Posenmodell hat den Athleten kopfüber vermutlich umgeklappt oder verloren, und die Gesamtrotation ist nicht vertrauenswürdig.',
  'limit.tracking.reversal.needed':
    'Prüfen Sie das Skelett in den Bildern mit kopfüber stehendem Athleten; ein Posenmodell, das kopfüber stehende Athleten beherrscht, oder eine manuelle Korrektur.',
  'limit.cross.signal': 'Rotations-Gegenprobe',
  'limit.cross.problem':
    'Die Körperlinie (Knöchel bis Kopf) hat sich um {deg} anders gedreht als der Rumpf (Hüfte bis Schultern).',
  'limit.cross.needed': 'Eine sauberere Pose in den Bildern von Absprung und Landung.',
  'limit.granularity.signal': 'Rotationsauflösung',
  'limit.granularity.problem':
    'Die Rotation ({total}) liegt {off} von der nächsten halben Drehung entfernt. Es kann ein Element mit Vierteldrehung (etwa eine Landung) oder ein Messfehler sein.',
  'limit.granularity.needed':
    'Eine Regel für die Landeposition (Rumpfwinkel bei der Landung), um Vierteldrehungen zu erkennen.',
  'limit.twist.signal': 'Schraube',
  'limit.twist.problem':
    'Die Blickrichtung vor dem Absprung unterscheidet sich von der bei der Landung: Der Athlet hat sich möglicherweise geschraubt, oder die Pose ist umgeklappt.',
  'limit.twist.needed': '3D-Pose oder eine zweite Kamera, um die Schraube zu messen.',
  'limit.unmeasured.problem': 'Nicht gemessen.',
  'limit.unmeasured.needed': '3D-Pose.',
  'limit.twist2d.signal': 'Schraube aus 2D-Hinweisen',
  'limit.twist2d.problem':
    'Die Schraube wurde aus Schulter- und Hüftlinie und dem Gesicht in einer einzigen 2D-Ansicht gezählt, nicht in 3D. Sie sagt weder die Richtung noch den Zeitpunkt der Schraube, nimmt eine typische Schulterbreite an und wurde nur an einem simulierten Athleten geprüft.',
  'limit.twist2d.needed': 'Eine verlässliche 3D-Pose, eine zweite Kamera oder jemand, der die Schrauben zählt.',

  'level.low': 'niedrig',
  'level.medium': 'mittel',
  'level.high': 'hoch',
  'level.unknown': 'unbekannt',
  'turn.clockwise': 'im Uhrzeigersinn',
  'turn.counterclockwise': 'gegen den Uhrzeigersinn',
  'turn.none': 'keine',
  'side.right': 'rechts',
  'side.left': 'links',
  'facing.forward': 'vorwärts',
  'facing.backward': 'rückwärts',
  'facing.undetermined': 'unbestimmt',
  'label.noSomersault': 'kein Salto',
  'label.noTwist': 'keine Schraube',
  'label.somersaults': { one: '{n} Salto', other: '{n} Saltos' },
  'label.twists': { one: '{n} Schraube', other: '{n} Schrauben' },
  'label.betweenDefinitions': 'zwischen den Definitionen',
  'label.notMeasured': 'nicht gemessen',
  'label.directionOrBoth': 'vorwärts oder rückwärts',

  'ev.hip.label': 'Hüftwinkel',
  'ev.hip.note': 'Schulter–Hüfte–Knie im am stärksten geschlossenen Moment; 180° = offen',
  'ev.knee.label': 'Kniewinkel',
  'ev.knee.note': 'Hüfte–Knie–Knöchel im selben Moment; 180° = gestreckte Beine',
  'ev.orientation.label': 'Körperausrichtung',
  'ev.orientation.note': 'Rumpfwinkel zur Senkrechten am höchsten Punkt',
  'ev.legSep.label': 'Beinabstand',
  'ev.legSep.note': 'Knöchelabstand / Beinlänge; von der Seite kaum sichtbar',
  'ev.legSep.text': '{level} ({value})',
  'ev.rotation.label': 'Rotation',
  'ev.rotation.text': '{turns} Drehungen (≈{deg}°, Vertrauen {conf})',
  'ev.rotation.note': '{direction}',
  'ev.rotation.noteResidual': '{direction}, {residual}° von der nächsten halben Drehung',
  'ev.kneeTorso.label': 'Knie zum Rumpf',
  'ev.kneeTorso.text': '{value} Rumpflängen',
  'ev.kneeTorso.note': 'klein = Knie herangezogen',
  'ev.compactness.label': 'Körperkompaktheit',
  'ev.compactness.note': '0 = gestreckt, höher = gebeugt',
  'ev.position.label': 'Körperhaltung',
  'ev.position.text': '{position} ({conf})',
  'ev.position.note': 'über den Flug: {shares}',
  'ev.share': '{position} {share}',
  'ev.facing.label': 'Blickrichtung',
  'ev.facing.undetermined': 'unbestimmt ({conf})',
  'ev.facing.side': '{side} im Bild ({conf})',
  'ev.facing.sideManual': '{side} im Bild ({conf}), manuell festgelegt',
  'ev.facing.note': 'Gesicht {face}, Knie {knee}, Fuß {foot} (jeweils -1 = links … +1 = rechts)',
  'ev.poseQuality.label': 'Posenqualität im Flug',
  'ev.poseQuality.note': 'gemessene Gelenke zählen 1, interpolierte 0,6, korrigierte 0,4, fehlende 0',
  'ev.temporal.label': 'Bahnübereinstimmung',
  'ev.twistSource.label': 'Schraube aus',
  'ev.twistSource.pose3d': '3D-Pose',
  'ev.twistSource.pose2d': '2D-Hinweisen (Schulterbreite, Links/Rechts-Reihenfolge, Gesicht)',
  'ev.temporal.noteExample': 'nächstliegende Referenz: ein beschriftetes Beispiel von {name}',
  'ev.temporal.noteModel': 'nächstliegende Referenz: die erwartete Bewegung von {name}',
  'ev.offGrid.label': 'Rotation zum nächsten ganzen Salto',
  'ev.offGrid.note':
    'ein zu wenig oder zu weit gedrehter Salto oder ein Element mit Vierteldrehung, das nicht in der Tabelle steht',
  'ev.tolerances': '{d} Toleranzen daneben',

  'channel.somersault': 'Salto-Rotation (Drehungen)',
  'channel.twist': 'Schrauben-Rotation (Drehungen)',
  'channel.hip': 'Hüftwinkel (÷180°)',
  'channel.knee': 'Kniewinkel (÷180°)',
  'channel.shoulderHip': 'Schulter-/Hüftausrichtung (÷90°)',
  'channel.comHeight': 'Höhe des Schwerpunkts (relativ)',
  'channel.angVel': 'Winkelgeschwindigkeit (Drehungen pro Flug)',
  'channel.orientSin': 'Körperausrichtung, sin',
  'channel.orientCos': 'Körperausrichtung, cos',

  'part.rotationNone': 'Rotation (keine)',
  'part.rotationFull': 'Rotation (360°)',
  'part.rotationQuality': 'Rotationsqualität',
  'part.positionRule': 'Regel zur Körperhaltung',
  'part.shapeHeld': 'Haltung gehalten',
  'part.poseQuality': 'Posenqualität',
  'part.sideOn': 'Seitenansicht',
  'part.facing': 'Blickrichtung',
  'part.dataQuality': 'Datenqualität',
  'part.structure': 'Struktur',
  'part.trajectory': 'Bahnübereinstimmung',

  'certainty.confident': 'sicher',
  'certainty.probable': 'wahrscheinlich',
  'certainty.tentative': 'vorläufige Vermutung',

  'stage.rotation.title': 'Saltos',
  'stage.direction.title': 'Richtung',
  'stage.twists.title': 'Schrauben',
  'stage.position.title': 'Körperhaltung',
  'stage.rotation.cutOff': 'Absprung oder Landung fehlt, daher lässt sich die Rotation nicht aufsummieren.',
  'stage.rotation.path': 'Weg {path} Drehungen (Summe der Ausrichtungsschritte), netto {net} Drehungen',
  'stage.rotation.tolerance': 'Toleranz ±{deg}° (Messqualität {quality})',
  'stage.rotation.observed': '{turns} Saltos ({deg}°)',
  'stage.direction.noTurn': 'der Körper dreht sich nicht: vorwärts und rückwärts lassen sich nicht unterscheiden',
  'stage.direction.noFacing':
    'die Blickrichtung ist unbekannt ({conf}): Eine Drehung {turn} ist für einen nach rechts blickenden Athleten ein Salto vorwärts und für einen nach links blickenden ein Salto rückwärts',
  'stage.direction.towardFace': 'Drehung {turn}, Athlet blickt nach {side} ({conf}): zum Gesicht hin',
  'stage.direction.awayFromFace': 'Drehung {turn}, Athlet blickt nach {side} ({conf}): vom Gesicht weg',
  'stage.twists.noMeasureSuspected':
    'keine 3D-Schraubenmessung; die 2D-Blickrichtung vor dem Absprung und bei der Landung weichen voneinander ab, daher ist eine ungerade Zahl halber Schrauben wahrscheinlicher',
  'stage.twists.noMeasure':
    'keine 3D-Schraubenmessung: es wird keine Schraube angenommen, mit niedriger Vorannahme für jede halbe Schraube',
  'stage.twists.stillTwisting': 'schraubt bei der Landung noch ({deg}° im letzten Zehntel des Fluges)',
  'stage.twists.tolerance': 'Toleranz ±{deg}°, Vertrauen der Schraube {conf}',
  'stage.twists.toleranceDiscounted':
    'Toleranz ±{deg}°, Vertrauen der Schraube {conf} (unter ihrer Zuverlässigkeitsgrenze: teilweise abgewertet)',
  'stage.twists.done': '90 % der Schraube sind bei {at} des Fluges geschafft',
  'stage.twists.observed': '{turns} Schrauben ({deg}°)',
  'stage.twists.source2d':
    'Schraube am 2D-Skelett gezählt (Schulterbreite, Links/Rechts-Reihenfolge, Gesicht): {n} halbe Schrauben, Stimmigkeit {conf}, Toleranz ±{deg}°; keine verlässliche 3D-Schraube',
  'stage.twists.secondAgrees': 'das 2D-Skelett zählt gleich: {n} halbe Schrauben (Stimmigkeit {conf})',
  'stage.twists.secondDisagrees':
    'das 2D-Skelett zählt {n} halbe Schrauben (Stimmigkeit {conf}) und widerspricht: die 3D-Schraube zählt weniger',
  'stage.position.mostClosed': 'am stärksten geschlossener Moment: {position} (Regelwert {score}, gehalten {held})',
  'stage.position.share': 'Anteil am Flug: {shares}',
  'stage.position.peakAt': 'am stärksten geschlossen bei {at} des Fluges',
  'stage.position.folded': 'Hüfte gebeugt von {from} bis {to} des Fluges',

  'check.somersaults': 'Saltos',
  'check.direction': 'Richtung',
  'check.twists': 'Schrauben',
  'check.position': 'Haltung',
  'check.distance': '{criterion}: erwartet {expected}, gemessen {observed}',

  'diag.lowQuality':
    'Die Messungen sind zu unzuverlässig, um die Bewegung zu benennen (Datenqualität {quality}: Pose {pose}, Ausrichtungsprüfungen {orientation}, Kameraansicht {view}{viewNote}).',
  'diag.viewNote': ': die Rumpflänge ändert sich um {change}',
  'diag.offGrid':
    'Die Rotation ({turns} Saltos, {deg}°) liegt {off}° vom nächsten ganzen Salto entfernt, mehr als die Messtoleranz erlaubt: ein Element mit Vierteldrehung (1¼, eine Landung), das nicht in der Tabelle steht, oder ein Messfehler.',
  'diag.notInTable':
    'Der größte Teil der Wahrscheinlichkeit ({share}) liegt auf Bewegungen, die die Elementtabelle nicht enthält.',
  'diag.rotationAmbiguous':
    'Die Rotation lässt sich nicht zwischen ganzen Saltozahlen entscheiden ({measured} gemessen; das nächstliegende Element verlangt {needs}).',
  'diag.directionUnknown': 'Vorwärts und rückwärts lassen sich nicht unterscheiden: {reason}.',
  'diag.twistAmbiguous':
    'Die Schraube ({observed}) liegt zwischen zwei Zählwerten; das nächstliegende Element verlangt {needs}.',
  'diag.twistUnmeasuredNone':
    'Die Schraube wird nicht gemessen (kein 3D), und die Bewegung könnte mit oder ohne Schraube sein.',
  'diag.twistUnmeasuredOther':
    'Die Schraube wird nicht gemessen (kein 3D), und die Bewegung könnte eine andere Zahl von Schrauben haben.',
  'diag.positionAmbiguous': 'Die Körperhaltung passt zu keiner Definition gut ({reason}).',
  'diag.cutOff': 'Absprung oder Landung fehlt im Clip.',

  'sum.cutOff': 'Dieser Sprung ist am Anfang oder Ende des Clips abgeschnitten.',
  'sum.noRotationUnknownPosition':
    'Keine Rotation ({rot}), aber die Körperhaltung liegt zwischen den Definitionen (Hüfte {hip}, Knie {knee}).',
  'sum.straight': 'Keine Rotation, und Hüfte ({hip}) und Knie ({knee}) bleiben geöffnet.',
  'sum.pike': 'Keine Rotation; die Hüfte beugt sich auf {hip}, während die Beine gestreckt bleiben (Knie {knee}).',
  'sum.tuck': 'Keine Rotation; die Hüfte beugt sich auf {hip} und die Knie beugen sich auf {knee}.',
  'sum.directionUnknownFull':
    'Eine volle Rotation ({rot}, {turn}), aber die Blickrichtung des Athleten ist unbekannt, daher lassen sich vorwärts und rückwärts nicht unterscheiden.',
  'sum.front':
    'Eine volle Rotation ({rot}, {turn}) bei einem nach {side} blickenden Athleten: Der Körper drehte sich zum Gesicht hin, das ist ein Salto vorwärts.',
  'sum.back':
    'Eine volle Rotation ({rot}, {turn}) bei einem nach {side} blickenden Athleten: Der Körper drehte sich vom Gesicht weg, das ist ein Salto rückwärts.',
  'sum.outOfSet':
    'Rotation ≈ {deg}° ({turns} Drehungen) liegt außerhalb des anfänglichen Elementsatzes (keine Rotation oder ein ganzer Salto).',
  'sum.bestGuess': 'Beste Vermutung {name} mit {conf}, unter dem Minimum von {min}. {reason}',
  'sum.bestGuessTemporal': 'Beste Vermutung {name} ({sim} Bahnübereinstimmung, {structure} strukturell). {reason}',
  'sum.noPlausible':
    'Kein plausibler Kandidat: am nächsten liegt {name} ({sim} Bahnübereinstimmung, {structure} strukturell). {reason}',
  'sum.named': '{name} ({certainty}, {conf}): gemessen {measured}; {sim} Übereinstimmung mit der erwarteten Bahn.',
  'sum.assumedDirection': '{summary} Die Richtung (vorwärts oder rückwärts) wurde angenommen: {reason}.',
  'sum.directionUnknown':
    '{n} Salto(s), {twist}, {position}; die Richtung (vorwärts oder rückwärts) lässt sich nicht bestimmen: {reason}.',
  'sum.directionUnknownTemporal':
    '{n} Salto(s), {twist}, {position}: die Richtung (vorwärts oder rückwärts) lässt sich nicht bestimmen ({reason}).',
  'sum.elementObserved': '{name}: {parts}.',
  'sum.positionDetail': '{position} (Hüfte {hip}, Knie {knee})',
  'sum.measuredTwistNone': 'Schraube nicht gemessen',
  'sum.measuredPositionUnclear': 'Haltung unklar',
  'sum.measuredPosition': '{position} (Hüfte {hip}, Knie {knee})',

  'debug.predicted': 'Vorhersage:',
  'debug.confidence': 'Vertrauen:',
  'debug.tentative': ' (vorläufige Vermutung)',
  'debug.movement': 'Bewegung:',
  'debug.closest': 'Nächstliegendes Element:',
  'debug.evidence': 'Belege:',
  'debug.trajectory': 'Bahnübereinstimmung: {sim}',
  'debug.why': 'Warum nicht benannt:',
  'debug.alternatives': 'Alternativen:',
  'debug.alternative': '{name} — {conf}',
  'debug.alternativeSim': '{name} — {conf} (Bahn {sim})',
  'debug.measurements': 'Messwerte:',
  'debug.measurement': '- {label}: {text}',
  'debug.measurementNote': '- {label}: {text} ({note})',
  'debug.notMeasured': '{criterion}: nicht gemessen (erwartet {expected})',
  'debug.observedMatch': '{criterion}: {observed}, erwartet {expected}',
  'debug.observedNeeds': '{criterion}: {observed}, benötigt {expected}',
  'debug.fit': '{text} (Passung {fit})',
};
