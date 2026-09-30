import type { Translation } from '..';
import type { insights as en } from '../en/insights';

export const insights: Translation<typeof en> = {
  'tier.high': 'Hohes Vertrauen',
  'tier.medium': 'Mittleres Vertrauen',
  'tier.low': 'Geringes Vertrauen',
  'tier.none': 'Nicht klassifiziert',

  'ins.jumpOf': 'Sprung {n} von {total}',
  'ins.playJump': 'Sprung abspielen',
  'ins.playJumpTitle': 'Den Sprung mit etwas Anlauf und Landung abspielen',
  'ins.scoreNote': 'Heuristischer Wert, keine Wahrscheinlichkeit',
  'ins.confidence': 'Vertrauen in das Element',
  'ins.openSettings': 'Einstellungen öffnen',
  'ins.showTechnical': 'Technische Details anzeigen',
  'ins.coachText':
    'Die Trainer-Ansicht zeigt zusätzlich die Belege hinter jedem Element, alle Messwerte, die Schraubenanalyse und alle Diagramme.',

  'ins.empty.title': 'Kein Sprung gefunden',
  'ins.empty.text':
    'Der Körperschwerpunkt hat sich nie 0,3 m über seine Umgebung erhoben, daher zählt nichts in diesem Clip als Sprung.',
  'ins.empty.check': 'Prüfen Sie, dass',
  'ins.empty.frame': 'der ganze Athlet von Anfang bis Ende im Bild ist.',
  'ins.empty.camera': 'die Kamera fest und waagerecht steht und dem Athleten nicht folgt.',
  'ins.empty.settings':
    'Körpergröße des Athleten und Trampolingröße in den Einstellungen stimmen, denn die Meterwerte beruhen darauf.',

  'ins.worth': 'Gut zu wissen',
  'ins.whatHelps': 'Was helfen würde',
  'ins.dataChecks': 'Datenprüfungen',
  'ins.noProblem': 'Kein Datenproblem für diesen Sprung gefunden.',
  'ins.more': { one: '{n} weiterer Hinweis', other: '{n} weitere Hinweise' },

  'ins.jumpsInClip': 'Sprünge in diesem Clip',
  'ins.height': 'Höhe',
  'ins.airTime': 'Flugzeit',
  'ins.jump': 'Sprung',
  'ins.cutOffSr': 'vom Clip abgeschnitten',
  'ins.barsNote': 'Die Balken vergleichen die Sprünge innerhalb dieses Clips.',
  'ins.barsNoteDashed':
    'Die Balken vergleichen die Sprünge innerhalb dieses Clips. Ein gestrichelter Balken ist ein vom Clip abgeschnittener Sprung.',
  'unit.meters': 'Meter',
  'unit.seconds': 'Sekunden',
  'unit.turns': 'Drehungen',

  'fig.height': 'Maximale Höhe',
  'fig.air': 'Zeit in der Luft',
  'fig.rotation': 'Rotation',
  'fig.shape': 'Körperform',
  'fig.cutOff': 'vom Clip abgeschnitten',
  'fig.unknown': 'konnte nicht gemessen werden',
  'fig.aboveBed': 'über dem Sprungtuch',
  'fig.aboveLowest': 'über dem tiefsten Punkt',
  'fig.takeoffToLanding': 'Absprung bis Landung',
  'fig.clockwise': 'im Uhrzeigersinn auf dem Bildschirm',
  'fig.counterclockwise': 'gegen den Uhrzeigersinn auf dem Bildschirm',
  'fig.noRotation': 'keine Rotation',
  'fig.between': 'Zwischen den Formen',
  'fig.noShape': 'passt zu keiner Form gut',
  'fig.mostClosed': 'im am stärksten geschlossenen Moment',

  'bed.title': 'Landung auf dem Sprungtuch',
  'bed.left': 'Linker Rand',
  'bed.center': 'Mitte',
  'bed.right': 'Rechter Rand',
  'bed.event.takeoff': 'Absprung',
  'bed.event.apex': 'Höhepunkt',
  'bed.event.landing': 'Landung',
  'bed.and': ' und ',
  'bed.clause': '{events} {where}',
  'bed.clauseAll': '{events} alle {where}',
  'bed.end': '.',
  'bed.inCenter': 'in der Mitte',
  'bed.pastLeft': 'jenseits des linken Randes',
  'bed.pastRight': 'jenseits des rechten Randes',
  'bed.towardLeft': '{share} des Weges zum linken Rand',
  'bed.towardRight': '{share} des Weges zum rechten Rand',
  'bed.unusable': 'Das markierte Trampolin konnte nicht verwendet werden, daher sind Landepositionen nicht verfügbar.',
  'bed.markIt': 'Markieren Sie das Trampolin, um zu sehen, wo jeder Sprung landet.',
  'bed.noPosition': 'Die Position auf dem Sprungtuch konnte für diesen Sprung nicht gemessen werden.',
  'bed.cutOff': 'Dieser Sprung wird vom Clip abgeschnitten, daher ist seine Position auf dem Sprungtuch unbekannt.',

  'quality.calibrationIgnored': 'Kalibrierung ignoriert: {error}',
  'quality.scales':
    'Sprungtuch und Athlet ergeben Maßstäbe, die {gap} auseinanderliegen. Prüfen Sie die Ecken, die Größe des Sprungtuchs, die Körpergröße des Athleten und dass der Athlet über dem Sprungtuch bleibt.',
  'quality.viewAlong':
    'Die Kamera blickt entlang der langen Seite des Sprungtuchs: Die horizontale Verschiebung wird nur quer zum Sprungtuch gemessen.',
  'quality.freeFall': 'Freifall-Prüfung: {g} m/s² statt 9,81, daher können Meter und m/s um etwa {gap} abweichen.',
  'quality.rotationStep':
    'Die Körperausrichtung ändert sich zwischen zwei Stichproben um mehr als 120°: Rotationen werden möglicherweise zu niedrig gezählt. Analysieren Sie jedes Bild.',
  'quality.missingCom': 'Der Körperschwerpunkt fehlt in {share} der Bilder.',
  'quality.cutOff': 'Ein Sprung ist am Anfang oder Ende des Clips abgeschnitten: Absprung oder Landung sind unbekannt.',

  'calibration.error.sizes': 'Die Größen des Sprungtuchs müssen positiv sein.',
  'calibration.error.corner': 'Ungültige Eckposition.',
  'calibration.error.order':
    'Die vier Ecken müssen der Reihe nach um das Sprungtuch liegen (keine sich kreuzenden Linien).',
  'calibration.error.small': 'Der Umriss des Sprungtuchs ist zu klein: Klicken Sie die Ecken weiter auseinander.',
  'calibration.error.compute': 'Die Kalibrierung ließ sich aus diesen Ecken nicht berechnen.',
};
