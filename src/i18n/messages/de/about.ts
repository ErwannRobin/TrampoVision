import type { Translation } from '..';
import type { about as en } from '../en/about';

export const about: Translation<typeof en> = {
  'about.title': 'Über TrampoVision',
  'about.back': 'Zurück',
  'about.lead':
    'TrampoVision ist ein Prototyp, der ein Trampolinvideo ansieht und Ihnen sagt, was jedes Element war, was es wert ist und was Sie verbessern sollten. Es läuft in Ihrem Browser, ohne Server und ohne Chatbot: Jede Zahl stammt aus einfacher Mathematik, die Sie im Code nachlesen können.',

  'about.howTitle': 'So funktioniert es',
  'about.howText': 'Sieben Schritte, alle auf Ihrem Gerät, vom Video bis zur Note.',
  'about.step1.title': 'Das Video lesen',
  'about.step1.text':
    'Das Video wird Bild für Bild gelesen, etwa 30 Bilder pro Sekunde, sodass das Ergebnis nicht von der Geschwindigkeit Ihres Geräts abhängt. Ein Video, das der Browser nicht dekodieren kann (zum Beispiel eine HEVC-Datei vom iPhone), wird zuerst mit ffmpeg.wasm in H.264 umgewandelt.',
  'about.step2.title': 'Das Skelett finden',
  'about.step2.text':
    'Der Pose Landmarker von MediaPipe (ein BlazePose-Modell) findet in jedem Bild 33 Körperpunkte, wenn möglich auf der GPU, sonst auf der CPU mit WebAssembly. Er liefert auch grobe 3D-Koordinaten, die nur die experimentelle Schätzung der Schrauben verwendet.',
  'about.step3.title': 'Das Signal bereinigen',
  'about.step3.text':
    'Punkte, an denen das Modell zweifelt, werden verworfen, plötzliche Sprünge abgelehnt, Lücken bis 0,3 s mit einer Parabel überbrückt und jeder Verlauf mit einer lokalen quadratischen Anpassung über 0,15 s geglättet. Ein aufgefüllter Punkt wird als solcher markiert und wirkt nie so sicher wie ein gemessener.',
  'about.step4.title': 'Den Körperschwerpunkt verfolgen',
  'about.step4.text':
    'Der Körperschwerpunkt ist der gewichtete Mittelwert von 14 Körpersegmenten. Seine Höhe über die Zeit ergibt jeden Sprung: den Scheitelpunkt sowie Absprung und Landung, die dort gefunden werden, wo der freie Fall (9,81 m/s²) beginnt und endet.',
  'about.step5.title': 'Rotation und Körperform messen',
  'about.step5.text':
    'Der Winkel des Rumpfes (von den Hüften zu den Schultern) wird abgewickelt, sodass er ganze Drehungen weiterzählt. Die Hüft- und Kniewinkel im geschlossensten Moment des Flugs unterscheiden gestreckt, gehockt und gehechtet. Die Blickrichtung der Athletin oder des Athleten unterscheidet Vorwärts von Rückwärts.',
  'about.step6.title': 'Das Element benennen',
  'about.step6.text':
    'Ein regelbasierter Klassifikator vergleicht diese Messwerte mit einer Tabelle von FIG-Elementen und gibt immer eine beste Vermutung ab. Eine Vermutung, bei der er sich nicht sicher ist, wird mit einer gestrichelten Linie und einem Fragezeichen markiert und bleibt aus den Summen heraus, bis Sie sie mit einem Tipp bestätigen. Ihre Korrekturen werden zu Referenzbeispielen.',
  'about.step7.title': 'Bewerten',
  'about.step7.text':
    'Die Schwierigkeit ist die FIG-Regel (Wertungsvorschriften 2025-2028, Trampolin, §17.1), angewendet auf die erkannte Bewegung; die Tests geben alle 139 Werte der Beispieltabelle der Wertungsvorschriften selbst wieder. Die Ausführung ist nur ein Vorschlag: Sie zählt die Abzüge (§20.2), die eine seitliche Kamera sehen kann, mit Winkelgrenzen, die Schätzungen sind und nicht an von FIG-Kampfrichtern bewerteten Aufnahmen abgestimmt wurden.',

  'about.deviceTitle': 'Was auf Ihrem Gerät bleibt',
  'about.deviceText1':
    'Das Video verlässt Ihren Browser nie. Die Seite lehnt jede Anfrage an eine andere Website ab, und die Produktionsversion fügt eine Content-Security-Policy hinzu, die der Browser selbst durchsetzt.',
  'about.deviceText2':
    'Gespeichert werden nur Zahlen, in Ihrem Browser (IndexedDB): Messwerte, Vorhersagen und Ihre Labels, nie das Video. Ist die App mit einem Prüfdienst eingerichtet, können die analysierten Sprünge dorthin gesendet werden, damit eine Person sie prüft: nur Messwerte, weder Video noch Dateiname. Ein Schalter in den Einstellungen schaltet das ab.',

  'about.limitsTitle': 'Was es noch nicht kann',
  'about.limit1':
    'Wie genau es bei echten Athleten ist, ist noch nicht bekannt. Die Tests verwenden einen simulierten Athleten, und die Schwellenwerte und die Sicherheit sind Schätzungen.',
  'about.limit2':
    'Am besten funktioniert eine feste, waagerechte Kamera an der Seite. Schrauben, Grätschen und alles, was von vorn zu sehen ist, brauchen mehr. Die 3D-Schätzung der Schrauben ist experimentell und meldet „nicht zuverlässig“, wenn man ihr nicht trauen kann.',
  'about.limit3':
    'Elemente mit Viertelumdrehung (zum Beispiel ein Cody) stehen nicht in der Elementtabelle: Sie werden nach dem nächsten ganzen Element benannt und als Vermutung markiert.',
  'about.limit4':
    'Die Ausführungsnote ist ein Vorschlag, keine Kampfrichternote. Füße, geschlossene Knie und gestreckte Fußspitzen werden als nicht geprüft aufgeführt. TrampoVision ist kein offizielles Werkzeug der FIG.',
  'about.limit5':
    'Meter und Geschwindigkeiten sind Schätzungen: Sie stammen aus der Größe des Sprungtuchs oder der Körpergröße der Athletin oder des Athleten.',

  'about.inspirationTitle': 'Inspiration',
  'about.inspirationText': 'TrampoVision wurde vom französischen Trampolinclub Paris Trampo 12 inspiriert.',
  'about.inspirationLink': 'Paris Trampo 12 (Website)',

  'about.rulesTitle': 'Das Regelwerk',
  'about.rulesText':
    'Die Schwierigkeit stammt aus den Wertungsvorschriften der FIG (Internationaler Turnerbund). Die offiziellen Regeln und Handbücher stehen auf deren Website.',
  'about.rulesLink': 'Regeln und Handbücher der FIG',

  'about.relatedTitle': 'Ähnliche Projekte und Forschung',
  'about.relatedText':
    'Weitere Arbeiten zum selben Problem, zum Weiterlesen. TrampoVision wurde nicht mit ihnen verglichen.',
  'about.related.jstage': 'Artikel auf J-STAGE (2025)',
  'about.related.nii': 'Eintrag bei CiNii Research',
  'about.related.pmc': 'Artikel auf PubMed Central (PMC12473961)',
  'about.related.devpost': 'BounceBoard, ein Projekt auf Devpost',
  'about.external': 'Öffnet eine andere Website',

  'about.codeTitle': 'Quellcode',
  'about.codeText': 'TrampoVision ist auf GitHub offen, mit den Tests und den Notizen dazu, wie jede Zahl entsteht.',
  'about.codeLink': 'TrampoVision auf GitHub',
};
