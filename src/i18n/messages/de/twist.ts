import type { Translation } from '..';
import type { twist as en } from '../en/twist';

export const twist: Translation<typeof en> = {
  'twist.title': 'Schraube',
  'twist.experimental': 'Experimentell',
  'twist.noWorld': 'Diese Analyse enthält keine 3D-Posendaten, daher gibt es keine Schraube zu messen.',
  'twist.noJump': 'Kein Sprung gefunden, daher gibt es keine Schraube zu messen.',
  'twist.cameraLimits': 'Was eine Kamera über eine Schraube nie sagen kann',
  'twist.notMeasured': 'Schraube: nicht gemessen',
  'twist.notReliable': 'Schraube: nicht zuverlässig',
  'twist.unit': { one: 'Schraube', other: 'Schrauben' },
  'twist.halfUnit': { one: 'halbe Schraube', other: 'halbe Schrauben' },
  'twist.consistency': 'Konsistenz',
  'twist.belowMin': 'unter {min}',
  'twist.consistencyLabel': 'Konsistenz der Schraube',
  'twist.rawCaution': 'Der Rohwert unten dient nur der Ansicht. Lesen Sie ihn nicht als Messung.',
  'twist.consistencyNote':
    'Konsistenz = wie gut die 3D-Daten miteinander übereinstimmen (die Prüfungen unten multipliziert). Sie ist keine Wahrscheinlichkeit, richtig zu liegen: Sie wurde noch nicht mit echten Schrauben verglichen. Nutzen Sie dafür die Annotation unten.',
  'twist.measured': 'Gemessen',
  'twist.raw': 'Rohwerte (nicht zuverlässig)',
  'twist.sameRoutes': 'Dieselbe Schraube auf anderen Wegen',
  'twist.checksBehind': 'Prüfungen hinter der Konsistenz',
  'twist.weakCount': '{n} schwach',
  'twist.weak': 'Schwach',
  'twist.noProblem':
    'Kein Datenproblem für diesen Sprung gefunden. Das ist kein Beweis, dass die Schraube stimmt (siehe unten).',
  'twist.couldNotSettle': 'Was die 3D-Daten nicht klären konnten',
  'twist.checkAgainst': 'Mit Ihrer eigenen Zählung vergleichen',
  'twist.countLabel': 'In diesem Sprung gezählte halbe Schrauben',
  'twist.cannotSave':
    'Dieser Sprung lässt sich derzeit nicht im Datensatz speichern und kann daher nicht gezählt werden.',
  'twist.notCounted': 'Nicht gezählt',
  'twist.youCounted': 'Sie haben gezählt',
  'twist.estimate': 'Schätzung',
  'twist.same': 'Gleich',
  'twist.different': 'Verschieden',
  'twist.flagged': 'Die Schätzung wurde als nicht zuverlässig markiert.',
  'twist.annotationNote':
    'Mit dem Sprung im Datensatz gespeichert, damit die Schraubenschätzung an echten Sprüngen bewertet werden kann. Halbe Schrauben werden anhand des Videos gezählt, nicht mit diesem Werkzeug.',
  'twist.sinceTakeoff': 'Schraube seit dem Absprung, jetzt',
  'twist.speedNow': 'Schraubengeschwindigkeit, jetzt',
  'twist.option': { one: '{v} (= {twists} Schraube)', other: '{v} (= {twists} Schrauben)' },
  'twist.readiness': '3D-Bereitschaft dieses Browsers',
  'twist.checking': 'Wird geprüft …',
  'twist.modelInUse': 'Verwendetes Modell.',
  'twist.separateModel': 'Ein separates 3D-Modell.',
  'twist.mediapipeNote':
    'MediaPipe Tasks Vision läuft auf WebGL („GPU“) oder WebAssembly („CPU“). WebGPU wird nicht genutzt.',

  'twist.check.rounding': 'Nahe an einer ganzen Zahl halber Schrauben',
  'twist.check.coverage': 'Schultern und Hüften in 3D gefunden',
  'twist.check.steps': 'Keine Sprünge zwischen den Bildern (Links-/Rechts-Vertauschungen)',
  'twist.check.monotonic': 'Dreht nur in eine Richtung',
  'twist.check.shoulderHip': 'Schultern und Hüften stimmen überein',
  'twist.check.axisDepth': 'Gleiche Antwort, wenn die Achse in der Bildebene bleibt',
  'twist.check.depth': 'Konstante 3D-Schulterbreite',

  'twist.dir.none': 'Keine',
  'twist.dir.positive': 'Gegen den Uhrzeigersinn',
  'twist.dir.negative': 'Im Uhrzeigersinn',
  'twist.row.net': 'Nettoschraube, Absprung bis Landung',
  'twist.row.halves': 'Geschätzte halbe Schrauben',
  'twist.row.direction': 'Richtung',
  'twist.row.directionHint': 'Von oberhalb des Kopfes gesehen: + ist gegen den Uhrzeigersinn, − im Uhrzeigersinn.',
  'twist.row.peak': 'Maximale Schraubengeschwindigkeit',
  'twist.row.mean': 'Mittlere Schraubengeschwindigkeit',
  'twist.row.tilt': 'Rumpfachse außerhalb der Bildebene',
  'twist.row.onAverage': 'im Mittel',
  'twist.row.shoulders': 'Nur die Schulterlinie',
  'twist.row.hips': 'Nur die Hüftlinie',
  'twist.row.plane': 'Achse in der Bildebene gehalten',
  'twist.cap.webgpuNoAdapter': 'API vorhanden, kein GPU-Adapter',
  'twist.cap.threadsNo': 'Nein (nicht cross-origin-isoliert)',
  'twist.cap.cpu': 'CPU-Kerne / Speicher',
  'twist.cap.wasm': 'WebAssembly / SIMD',
  'twist.cap.threads': 'WASM-Threads',

  'twist.limit.depth.signal': 'Die Tiefe wird geschätzt',
  'twist.limit.depth.problem':
    'Die 3D-Pose stammt aus einem einzigen Bild. Die Schraube ist die Drehung der Schulterlinie um die Körperachse, und in der Seitenansicht zeigt diese Linie auf die Kamera; sie wird daher nur daran gelesen, welche Schulter das Modell näher setzt.',
  'twist.limit.depth.needed': 'Eine zweite Kamera oder ein Tiefensensor.',
  'twist.limit.error.signal': 'Ein kleiner Tiefenfehler wird zu einer großen Schraube',
  'twist.limit.error.problem':
    'Gemessen an echter Modellausgabe (ein in der Bildebene gedrehtes Standfoto): Das Modell kippte den Rumpf um 15° aus der Ebene, was über einen Salto eine Phantomschraube von −94° erzeugte. Nur die Prüfung „Achse in der Bildebene“ hat sie erkannt.',
  'twist.limit.error.needed': 'Gemessene Tiefe.',
  'twist.limit.swap.signal': 'Links und rechts können vertauscht werden',
  'twist.limit.swap.problem':
    'Vertauscht das Modell die beiden Schultern, springt die Schraube zwischen zwei Bildern um 180°. Sprünge über {max}° werden zurückgefaltet und mitgezählt; die Zahl der halben Schrauben kann dann um eins danebenliegen.',
  'twist.limit.swap.needed': 'Ein Posenmodell, das die Seiten stabil hält, oder eine höhere Bildrate.',
  'twist.limit.rate.signal': 'Die Bildrate begrenzt die Geschwindigkeit',
  'twist.limit.rate.problem':
    'Bei {fps} fps lässt sich eine Schraube schneller als {rate} °/s ({perSecond} Schrauben pro Sekunde) nicht von einer Vertauschung unterscheiden.',
  'twist.limit.validated.signal': 'Nicht an echten schraubenden Athleten validiert',
  'twist.limit.validated.problem':
    'Der Schätzer ist an einem simulierten 3D-Athleten exakt und wurde an einem Standfoto auf Phantomschrauben geprüft. Ein schraubender Trampolinturner wurde nicht getestet. Das Vorzeichen (+ = gegen den Uhrzeigersinn von oberhalb des Kopfes gesehen) stimmt nur auf diesem Foto mit den Achsen des Modells überein.',

  'tw.signal.twist': 'Schraube',
  'tw.signal.pose3d': '3D-Pose',
  'tw.no3d.problem':
    'Diese Analyse enthält keine 3D-Landmarken (vor der 3D-Unterstützung gespeicherte Daten oder ein Pose-Backend, das nur 2D liefert).',
  'tw.no3d.needed':
    'Analysieren Sie das Video erneut mit dem MediaPipe-Backend, das mit jedem Bild 3D-Landmarken liefert.',
  'tw.cutOff.problem':
    'Dieser Sprung wird vom Anfang oder Ende des Clips abgeschnitten, daher lässt sich die Schraube zwischen Absprung und Landung nicht summieren.',
  'tw.cutOff.needed': 'Ein Clip, der den ganzen Flug zeigt.',
  'tw.notFound.problem': 'Schultern und Hüften wurden in diesem Flug nicht in 3D gefunden.',
  'tw.notFound.needed': 'Ein Clip, in dem der Athlet sichtbar und für das Posenmodell groß genug ist.',
  'tw.torsoUnknown.problem':
    'Der Rumpf ist beim Absprung oder bei der Landung nicht bekannt, daher lässt sich keine Nettoschraube berechnen.',
  'tw.torsoUnknown.needed': 'Sichtbare Schultern und Hüften bei beiden Ereignissen.',
  'tw.coverage.signal': '3D-Rumpfabdeckung',
  'tw.coverage.problem':
    'Schultern und Hüften wurden nur in {share} des Fluges gemessen; der Rest wurde überbrückt oder fehlt.',
  'tw.coverage.needed': 'Eine klarere Sicht auf den Rumpf über den ganzen Flug.',
  'tw.axis.signal': 'Achsentiefe',
  'tw.axis.problem':
    'Die Schraube hängt davon ab, wie weit sich die Rumpfachse aus der Bildebene neigt: {total} mit der 3D-Achse, {plane} mit der in der Bildebene gehaltenen Achse. Ein kleiner konstanter Tiefenfehler macht aus einem Salto eine Phantomschraube.',
  'tw.axis.needed':
    'Gemessene Tiefe (zweite Kamera oder Tiefensensor) statt der Schätzung durch ein Ein-Kamera-Modell.',
  'tw.shoulderHip.signal': 'Schultern vs. Hüften',
  'tw.shoulderHip.problem':
    'Die Schulterlinie sagt {shoulders}, die Hüftlinie {hips}: Sie sollten sich über einen ganzen Flug gemeinsam drehen.',
  'tw.shoulderHip.needed': 'Zuverlässigere Schulter- und Hüftlandmarken (beide sind geschätzt, nicht gemessen).',
  'tw.depth.signal': 'Tiefenkonsistenz',
  'tw.depth.problem':
    'Die 3D-Schulterbreite schwankt im Flug um {cv}. Ein starrer Körper hält sie konstant, daher sind die Tiefenwerte verrauscht.',
  'tw.depth.needed': 'Bessere Tiefe: eine zweite Kamera oder ein für Athleten in der Luft trainiertes Modell.',
  'tw.swaps.signal': 'Links-/Rechts-Vertauschungen',
  'tw.swaps.problem': {
    one: '{n} Schritt größer als {max}° zwischen zwei Bildern (größter: {largest}) wurde als Links-/Rechts-Vertauschung behandelt und zurückgefaltet. Die Zahl der halben Schrauben kann um eins danebenliegen.',
    other:
      '{n} Schritte größer als {max}° zwischen zwei Bildern (größter: {largest}) wurden als Links-/Rechts-Vertauschungen behandelt und zurückgefaltet. Die Zahl der halben Schrauben kann um eins danebenliegen.',
  },
  'tw.swaps.needed':
    'Eine höhere Bildrate oder ein Posenmodell, das links und rechts beim Drehen des Athleten stabil hält.',
  'tw.rate.signal': 'Bildrate',
  'tw.rate.problem':
    'Der größte Schraubenschritt zwischen zwei Bildern beträgt {largest}; oberhalb von {max}° lässt sich eine Schraube nicht von einer Vertauschung unterscheiden.',
  'tw.rate.needed': 'Eine höhere Bildrate.',
  'tw.direction.signal': 'Schraubenrichtung',
  'tw.direction.problem':
    'Die aufsummierte Schraube lief in eine Richtung und kam um {reversal} zurück: Eine echte Schraube dreht immer weiter in dieselbe Richtung, das Posenmodell hat den Körper also vermutlich umgeklappt.',
  'tw.direction.needed': 'Eine stabilere Posenschätzung.',
  'tw.rounding.signal': 'Rundung',
  'tw.rounding.problem': '{total} liegt {off} von einer ganzen Zahl halber Schrauben entfernt.',
  'tw.rounding.needed': 'Eine sauberere Schätzung; die wahre Schraube ist bei der Landung ein Vielfaches von 180°.',
  'tw.side.signal': 'Seitenansicht',
  'tw.side.problem':
    'In {share} des Fluges zeigt die Schulterlinie entlang der Blickrichtung. Dann zeigt sich die Schraube nur daran, welche Schulter näher an der Kamera ist – dem schwächsten Signal eines Ein-Kamera-Modells.',
  'tw.side.needed': 'Eine zweite Kamera oder eine Ansicht von vorn oder von hinten.',

  'cap.runtime.webgl': 'WebGL (GPU-Delegate)',
  'cap.runtime.wasm': 'WebAssembly (CPU-Delegate)',
  'cap.runtime.none': 'keine unterstützte Laufzeit',
  'cap.current.ok':
    'Verfügbar. Das MediaPipe-Posenmodell liefert bereits mit jedem Bild 3D-Landmarken (BlazePose GHUM, in Metern), daher wird kein zweites Modell geladen. Es läuft auf {runtime}.',
  'cap.current.okSimd':
    'Verfügbar. Das MediaPipe-Posenmodell liefert bereits mit jedem Bild 3D-Landmarken (BlazePose GHUM, in Metern), daher wird kein zweites Modell geladen. Es läuft auf {runtime}, WASM SIMD an.',
  'cap.current.none':
    'Diese Analyse enthält keine 3D-Landmarken (vor der 3D-Unterstützung gespeicherte Daten). Analysieren Sie das Video erneut.',
  'cap.dedicated.webgpu':
    'Ein eigenes 3D-Modell könnte in diesem Browser auf WebGPU laufen (über onnxruntime-web). Nicht gebaut: Es braucht eine Modelldatei, und ich habe keine getestet.',
  'cap.dedicated.noAdapterThreads':
    'WebGPU ist vorhanden, hat aber keinen GPU-Adapter, daher würde ein eigenes 3D-Modell auf WebAssembly mit Threads ausweichen. Nicht gebaut, nicht getestet.',
  'cap.dedicated.noAdapterSingle':
    'WebGPU ist vorhanden, hat aber keinen GPU-Adapter, daher würde ein eigenes 3D-Modell auf WebAssembly ohne Threads ausweichen (die Seite ist nicht cross-origin-isoliert), was langsam ist. Nicht gebaut, nicht getestet.',
  'cap.dedicated.noWebgpuThreads':
    'WebGPU ist nicht verfügbar, daher würde ein eigenes 3D-Modell auf WebAssembly mit Threads ausweichen. Nicht gebaut, nicht getestet.',
  'cap.dedicated.noWebgpuSingle':
    'WebGPU ist nicht verfügbar, daher würde ein eigenes 3D-Modell auf WebAssembly ohne Threads ausweichen (die Seite ist nicht cross-origin-isoliert), was langsam ist. Nicht gebaut, nicht getestet.',
  'cap.dedicated.none': 'Weder WebGPU noch WebAssembly ist verfügbar: Hier kann kein 3D-Modell laufen.',

  'p3d.camera': 'Kamera',
  'p3d.cameraTitle': 'Wie die Kamera es sieht: x nach rechts, y nach unten',
  'p3d.side': 'Seite',
  'p3d.sideTitle': 'Blick entlang der x-Achse der Kamera: zeigt die vom Modell geschätzte Tiefe',
  'p3d.above': 'Von oben',
  'p3d.aboveTitle': 'Blick von oben auf den Athleten',
  'p3d.canvas': '3D-Skelett. Zum Drehen ziehen.',
  'p3d.notReliable': 'Schraube hier nicht zuverlässig',
  'p3d.howToRead': 'So lesen Sie diese Ansicht',
  'p3d.legend':
    'Blau = links, orange = rechts. Gestrichelt bernsteinfarben = die Längsachse (Hüfte zu Schultern). Dunkler Punkt = Brustrichtung. Der Ring ist die Ebene senkrecht zur Achse: grau = wohin die Schulterlinie beim Absprung zeigte, bernsteinfarbener Bogen = die Schraube seitdem. Zum Drehen ziehen.',
  'p3d.legendNow':
    'Blau = links, orange = rechts. Gestrichelt bernsteinfarben = die Längsachse (Hüfte zu Schultern). Dunkler Punkt = Brustrichtung. Der Ring ist die Ebene senkrecht zur Achse: grau = wohin die Schulterlinie beim Absprung zeigte, bernsteinfarbener Bogen = die Schraube seitdem (jetzt {now}°). Zum Drehen ziehen.',
  'p3d.pointOfView': 'Blickwinkel',
  'p3d.cancelSide': 'Nebeneinander-Export abbrechen {percent}',
  'p3d.cancel3d': '3D-Video abbrechen {percent}',
  'p3d.download3d': 'Das 3D-Skelett als Video herunterladen (ohne Aufnahmen)',
  'p3d.downloadSide': 'Das annotierte Video und diese 3D-Ansicht nebeneinander herunterladen',
  'p3d.noFrame': 'Keine 3D-Pose in diesem Bild',
  'p3d.noLandmarks': 'Diese Analyse enthält keine 3D-Landmarken',
  'p3d.longAxis': 'Längsachse',
  'p3d.chest': 'Brust',
};
