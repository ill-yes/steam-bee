# UI/UX-Prüfung des SteamBee-Hubs

Geprüft wurden Gratisangebote, Inventar und Markt, Sammelkarten-Farming,
Darstellungseinstellungen sowie ihre Einbindung in die Kontoverwaltung.
Die festgelegte Grenze bleibt erhalten: Benutzer können keinen Hintergrund
hochladen oder selbst konfigurieren.

## Kartenvarianten und automatische Preisschätzungen

Die aktuelle Überarbeitung priorisiert verständliche Bestands- und
Verkaufsinformationen. Drei einzeln gelieferte Exemplare derselben Steam-Variante
ergeben eine Karte mit Bestand drei und zwei zusätzlichen Exemplaren. Die
Identität kommt aus Steam-Klasse und Instanz, nicht aus dem Anzeigenamen.
Normale und Glanzkarten bleiben getrennt. Filterung und Seiteneinteilung erfolgen
erst danach; der Gesamtbestand einer Variante und eines Spiels wird nicht
heimlich durch einen Duplikatfilter verkleinert.

Die Karte gliedert Identität/Verfügbarkeit, Bestand, Preise und Verkaufsaktion
in vier gemeinsame Zeilenbereiche. Vollständige Beschriftungen ersetzen
„Dupl.“, das Auge und das uneindeutige Mengenlabel „Verkauf“. Sichtbar bleiben
Marktverkauf gegenüber Steam-Tausch, zulässige Menge, erwarteter Restbestand,
Preisquelle, Angebotspreis und Erlös nach Gebühren. Größere Karten sind dafür
beabsichtigt; die frühere Höhe von 155 px ist keine Vorgabe. Ein Subgrid richtet
die Bereiche pro Reihe aus, ohne feste Kartenhöhen oder eine zusätzliche große
Leerfläche vor geschützten Fußzeilen einzuführen.

Automatische Anzeigeabfragen entstehen nur für tatsächlich sichtbare Karten.
Ein `IntersectionObserver` berücksichtigt die Kopfzeile und Sammelleiste.
Offscreen-Karten und Hintergrundtabs pausieren. Die Übersicht erzeugt keine
Verkaufstokens; verbindliche Vorschauen und Bestätigungen prüfen weiterhin
frische Steam-Daten. Anzeigealter, fehlende Preise, Drosselung und ungültige
Preisregeln werden in Worten erklärt. Alte Regeln oder Währungen dürfen keine
überholten Erlösschätzungen stehenlassen.

Die ausgewählte Variantenmenge wird auf konkrete zulässige Assets verteilt.
Auswahl und Vorschau zählen Varianten, Exemplare und Marktaktionen getrennt.
Das Limit von 50 gilt für tatsächliche Marktaktionen; eine Überschreitung wird
erklärt, nicht still gekürzt. Eine nicht fertige oder nach Inventaraktualisierung
unzulässige Mengenangabe bleibt als Entwurf sichtbar und sperrt die passende
Vorschau. Sammelvorschauen und Fortschritt gruppieren Varianten, erhalten aber
Einzelergebnisse und Teilfehler in zugänglichen Details.

Der unabhängige dritte Review fand drei zusätzliche Probleme, die behoben und
gezielt nachgeprüft wurden: zunächst zu breite Preisabfragen für eine ganze
Seite, gemischte alte/neue Preisregeln beim ersten Inventarbesuch und verdeckte
Aktionen bei nur 320 px Viewporthöhe. Bei höchstens 450 px Höhe scrollen
Sammelleiste und Spielkopf deshalb normal mit. Im übrigen Layout bleiben die
Navigation und der Spielkontext beim Scrollen erreichbar.

Die abschließende Browserprüfung umfasst 23 Zustände: geladene Karten bei
320, 390, 768 und 1440 px, helle und dunkle Darstellung, Filter, Mengenwahl,
Einzel- und Sammelvorschau sowie fehlende, veraltete und durch Regeln gesperrte
Preise. Ein abgelaufener Inventarkontext wird einmal neu geladen. Ein zusätzlicher
390 × 320-px-Fall prüft, dass die vollständige Verkaufsaktion ohne Überlagerung
erreichbar ist. Die Testdaten liefern gleichartige Karten als getrennte Assets;
die Browserprüfung kontrolliert außerdem tatsächliche Sichtbarkeit vor
Preisabfragen. Alle Fälle bleiben ohne horizontale Seitenüberläufe, axe-Befunde,
JavaScript-Fehler oder unerwartete API-Anfragen. Desktop, Mobil, Dunkelmodus,
Auswahl und Verkaufsdialoge wurden zusätzlich unabhängig visuell geprüft.

## Vorausgehende Prüfung offener Punkte

Die erneute Quellcode- und Bedienungsprüfung hat fünf konkrete Probleme
bestätigt und behoben:

| Bereich                | Befund und Korrektur                                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Marktseiten            | Vor/Zurück behielt eine weit unten liegende Seitenposition. Ein ausdrücklicher Seitenwechsel bringt jetzt den benannten Listenanfang unter den Sticky-Header und setzt dort den Tastaturfokus. Suche und Aktualisierung springen nicht zusätzlich.                 |
| Marktauswahl           | Die mobile Checkbox war nur 16 px groß. Ihr anklickbarer Labelbereich ist jetzt 44 × 44 px groß; Auswahl und Abwahl funktionieren auch neben dem sichtbaren Kästchen.                                                                                              |
| Farming-Datenalter     | Eine Statusaktualisierung ließ nicht erkennen, wann Steam tatsächlich zuletzt auf Drops geprüft wurde. Die Übersicht nennt jetzt diesen Zeitpunkt beziehungsweise den noch fehlenden Scan und erklärt den Unterschied zwischen Statusladen und Kartensuche.        |
| Einzelne Marktaktionen | Vorbereitete Einzelverkäufe und Stornos konnten einen Kontostopp überleben. Pause, Stop und Shutdown verwerfen jetzt auch diese Vorschauen und blockieren wartende Übermittlungen vor dem POST. Bereits abgesendete Anfragen behalten ihren tatsächlichen Ausgang. |
| Leere Bibliothek       | Ein erfolgreicher Import ohne Spiele galt weiter als fehlender Import. Ein atomar gespeicherter Importmarker unterscheidet diese Zustände nun auch für Gratisangebote, Health und Autoimport. Migration und Backup/Restore sind abgesichert.                       |

Die vorausgehende Browserprüfung umfasste 56 geladene Ansichten: Spiele/Spielzeit,
Inventar, Marktangebote, Preisregeln, Farming-Übersicht, Farming-Einstellungen,
Gratisangebote und Kontosicherheit bei 320, 390, 768, 1024 und 1440 px in Hell
sowie 390 und 1440 px in Dunkel. Ausgewählte Desktop-, Tablet- und
Mobilaufnahmen wurden zusätzlich visuell geprüft.
Es bleiben in diesen Fällen keine axe-Befunde, horizontalen Seitenüberläufe,
abgeschnittenen Kartenfußzeilen oder JavaScript-Laufzeitfehler offen. Die
Navigation erzeugt keine Markt- oder Kontoänderungen. Die akzeptierten
Inventar-Spielzeilen bleiben erhalten.

Gezielte echte Browserabläufe mit 60 Marktangeboten prüfen die Seitenwechsel,
den Fokus, die erste per Tab erreichbare Checkbox und die größere mobile
Auswahlfläche bei 390 und 1440 px. Weitere Farming-Abläufe prüfen gespeicherte
und fehlende Scans, den Weg zu Einstellungen und Feldfehlern sowie den Einstieg
in Angebotsbenachrichtigungen. Die zugehörigen Regressionstests umfassen nun
76 Inventar-/Markttests und 30 Farming-Tests.

## Vorausgehende Verdichtung der Spielzeilen

Die Inventaransicht verwendet jetzt pro Spiel einen gemeinsamen Rahmen. Bei
ausreichend tatsächlicher Inhaltsbreite stehen Spielbild, Name, Summen und
Gruppenauswahl in einer schmalen linken Spalte; rechts folgen kompakte Karten in
einem Raster, dessen Spaltenzahl sich nach dem verfügbaren Platz richtet.
Unterhalb dieser Breite steht der Spielkopf über den Karten.
Container Queries berücksichtigen dabei auch den Platz einer offenen
Kontenübersicht, statt nur die gesamte Bildschirmbreite auszuwerten.

Die Verdichtung erhält Bild und Name als Kopf und fasst Anzahl, Duplikate,
Verkaufsmenge und Vorschau in einer gemeinsamen Leiste zusammen. Breite
Bestandsfelder und eine zusätzliche Verkaufszeile entfallen. Die gemeinsame
Leiste hat für verkaufbare und geschützte Karten dieselbe kompakte Höhe und
dieselben Zahlenspalten. Karten innerhalb einer Reihe enden auf gleicher Höhe.
Das Mengenfeld hat 48 px Platz für bis zu drei Ziffern und native Spinner; die
Vorschau bleibt ein 44-px-Ziel mit vollständigem zugänglichem Namen und Tooltip.
Schmale Karten kürzen „Duplikate“ sichtbar ab, behalten aber die volle
Beschriftung für assistive Technik und per Tooltip. Letzte Exemplare und
unvermarktbare Gegenstände erklären im selben kompakten Band, warum sie keine
Verkaufsaktion anbieten. Ausgewählte Karten erhalten eine sichtbare Hervorhebung.

Die Spielspalte ist von 190 auf 160 px verkleinert. Jedes Spiel belegt eine
eigene durchgehende Zeile. Ein gemeinsames `auto-fill`-Raster hält die
Kartenbreiten und Startkanten über alle Spiele gleich; die zwischenzeitliche
Anordnung mehrerer Spielgruppen nebeneinander ist entfernt. Normale Karten sind
im Vergleichsszenario etwa 30 Prozent niedriger (155 statt 223 px auf Desktop,
155 statt 230 px mobil). Bestand, Menge und Vorschau bleiben dabei erreichbar.

Eine über die 25er-Seitengrenze geteilte Spielgruppe erklärt sowohl ihre
Seitenmenge als auch den Umfang der Gruppenwahl. Die Auswahl umfasst weiterhin
alle gefilterten geeigneten Gegenstände dieses Spiels über weitere Seiten;
Filter, Sortierung, Asset-Zuordnung, Vorschauen und 50er-Limit bleiben erhalten.
Die Gruppenwahl ist auch über Spielbild und einen mindestens 44 px hohen
Labelbereich erreichbar.

Die Browserprüfung deckt zusätzlich viele Spiele und mehr als zwei Seiten,
fehlende Zuordnungen und Bilder, sehr lange Namen, Auswahl, Filter, alle fünf
festen Themes und RTL ab. Geprüft werden auch echte Elementabmessungen: Der
begrenzt hohe Inventarbereich muss scrollen, ohne seine Spielgruppen
zusammenzudrücken oder Verkaufsfußzeilen abzuschneiden. Dafür haben seine
Grid-Zeilen eine intrinsische Höhe. Zwei ergänzte Bedienungstests sichern
geschützte Gegenstände und die seitenübergreifende Gruppenwahl ab.

Die abschließende Verdichtungsprüfung umfasst 25 Browserfälle mit allen festen
Themes, RTL, kleinen Spielsammlungen, 90 Assets mit langen Namen und fehlenden
Bildern sowie der Verkaufsmenge 100. Sie prüft Seitenüberlauf, abgeschnittene
Inhalte, die Ausrichtung der Bestandszahlen, die Eingabebreite und 44-px-Aktionen.
Die Desktopkorrektur prüft zusätzlich, dass Spielbereiche untereinander stehen,
alle dieselbe Breite haben und Karten sowie Fußzeilen je Reihe ausgerichtet sind.
Diese vorausgehende Prüfung bestand mit 253 Webtests einschließlich
74 Inventartests.

## Fokus auf Farming, Inventar und Gratisangebote

Der erneute Gestaltungspass priorisiert den Inhalt der drei Werkzeuge. Alle
verwenden dieselbe Überschriftenstruktur und Aktualisieren-Aktion; auf schmalen
Geräten bleibt der Button mit vollständiger zugänglicher Beschriftung kompakt.

- **Inventar:** Karten und Suche stehen am Einstieg. Marktangebote und Preisregeln
  haben eigene Unteransichten. Weitere Filter lassen sich aufklappen; aktive
  Filter und ihr Reset bleiben sichtbar. Entwürfe und Auswahlen überleben den
  Ansichtswechsel. Stapelfortschritt, Stop und Wiederherstellung sind dauerhaft
  oberhalb der Unteransichten erreichbar. Ohne Auswahl zeigt die Sammelleiste
  nur die Auswahlaktion und den kurzen Hinweis auf das verbleibende Exemplar;
  Vorschau, Leeren und die vollständige Gebühren-/50er-Erklärung erscheinen nach
  einer Auswahl. Der Filterkopf hat auch mobil ein 44-px-Tapziel.
- **Farming:** Übersicht und Auswahl/Einstellungen sind getrennt. Die Übersicht
  zeigt Kennzahlen und Spielkarten mit Drops und Sperrgründen, aktive Spiele
  zuerst. Die große Spielauswahl lädt beim Öffnen der Einstellungen. Ein
  Entwurfshinweis führt zu Speichern oder Verwerfen; Start, Suche und Stop
  bleiben in beiden Ansichten zugänglich.
- **Gratisangebote:** Cover, Titel und Steam-Link sind der Hauptinhalt. Region,
  Prüfzeit und ausgeblendete eigene Angebote stehen kompakt darüber. Weitere
  Erklärungen sind aufklappbar; Benachrichtigungen stehen unter den Ergebnissen.
  Leere Ergebnisse bieten eine erneute Prüfung und den Weg zu den Hinweisen.
  Veraltete Daten und ein fehlgeschlagener Refresh ergeben einen gemeinsamen
  Warnhinweis. Rabatt-Badges haben eine deckende Fläche, damit ihr Kontrast auch
  über hellen Covern im dunklen Theme erhalten bleibt.

Die Tastaturprüfung der gemeinsamen Unteransichten umfasst Pfeiltasten,
Home/End, RTL-Richtung, genau einen Tabstopp, benannte Inhaltsbereiche sowie den
Erhalt ungespeicherter Eingaben. Die Aktualisieren-Aktion verhindert doppelte
Aufrufe, während sie lädt.

Die abschließende Browserprüfung umfasst 42 geladene Ansichten: die drei
Werkzeuge, Inventarfilter, Marktangebote, Preisregeln und Farming-Einstellungen
bei 320, 390, 768 und 1440 px, zusätzlich 390 und 1440 px in Dunkel. Dazu kommen
neun Angebotszustände mit leeren Ergebnissen, fehlendem Bibliotheksimport und
veralteten Daten nach einem Refreshfehler. Es bleiben keine geprüften
axe-Befunde, horizontalen Seitenüberläufe oder JavaScript-Laufzeitfehler offen.
Die separate Galerie enthält 60 Aufnahmen der Hauptansichten und neun
Zustandsbilder; Screenshots mit langem Inhalt werden ohne verdeckenden
Sticky-Header aufgenommen.

## Erneute kritische Prüfung

Die Nachprüfung umfasst die Nutzerabläufe sowie neue Screenshots mit mehreren
Spielen, Konten und tatsächlichen Kartenbildern. Neben automatischen Regeln
wurden die Bilder visuell geprüft: Eine Seite kann ohne Seitenüberlauf bleiben
und trotzdem Texte in viel zu schmale Spalten drücken.

| Befund                                                                                                                  | Korrektur                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Der mobile Einstieg wiederholte Kontoname und Verbindungsstatus und verbrauchte viel Höhe.                              | Kompakter Aktivitätskopf mit weiterhin 44 px hohen Aktionen; Kontowähler und vollständige zugängliche Beschriftungen bleiben erhalten.                                         |
| Die Bibliothek verlangte auf schmalen Geräten horizontales Scrollen für Namen und Aktionen.                             | Unter 760 px verfügbarer Containerbreite erscheinen Spielkarten mit vollständigem Namen, Zeit, AppID, Auswahl, Favorit und Ausblenden. Breite Ansichten behalten ihre Tabelle. |
| Eine ausgeklappte Kontenübersicht drückte die mittlere Kontokarte bei 1280 px auf wenige Buchstaben pro Zeile zusammen. | Kontokarten und Werkzeugnavigation richten ihre Spalten nach dem verfügbaren Containerplatz statt allein nach der Bildschirmbreite.                                            |
| Farming konnte nach dem globalen Fortsetzen eines Kontos fälschlich gesperrt bleiben.                                   | Die geöffnete Ansicht lädt die Verfügbarkeit nach Konto- und Modusänderungen erneut; Einstellungen und Stop-Schutz bleiben erhalten.                                           |
| Die Farming-Hauptaktionen standen hinter der ganzen Spielauswahl.                                                       | Suche, Start und Stop stehen vor dem Formular. Der mobile Modushinweis ist kürzer; ungespeicherte Einstellungen werden direkt bei den gesperrten Aktionen erklärt.             |
| Nach Steam-Verbindungsfehlern erschienen manuelle Spiele weiterhin aktiv.                                               | Der Worker markiert die Verbindung sofort als getrennt und sperrt Community-Zugriffe bis zur erneuten Anmeldung.                                                               |
| Sammelstornos setzten sich nach HTTP-Serverfehlern trotz unklarem Ergebnis fort.                                        | Ein unbestätigter Ausgang stoppt weitere Einträge und wird nicht automatisch wiederholt.                                                                                       |
| Sammelauswahl am 50er-Limit, Gruppensortierung und ausgefilterte Auswahlen waren missverständlich.                      | Auswahl lässt sich zuverlässig leeren, die Sortierung bleibt erhalten und ausgefilterte Auswahlen werden vor einer Vorschau genannt.                                           |
| Ein Seitenwechsel behielt die alte Scrollposition der Karten; verschwundene Marktangebote behielten ihre Auswahl.       | Kartenbereiche starten nach Seiten-/Filterwechsel oben; entfernte Angebote werden aus der Auswahl entfernt.                                                                    |
| Eine spät wiederhergestellte Sammelaktion ließ eine überholte Einzelvorschau scheinbar bestätigbar.                     | Die Vorschau schließt mit Erklärung; der tatsächliche Aktions-Lock steuert die Bestätigung. Ausstehende Steam-Bestätigungen nennen den nächsten Schritt.                       |
| Steam Guard zeigte auf Mobilgeräten eine reine Zifferntastatur.                                                         | Das Feld unterstützt alphanumerische und numerische Codes unverändert.                                                                                                         |
| Admin-Kontoaktionen und der Betriebsdialog schnitten bei 320 px Controls ab.                                            | Aktionen stehen auf schmalen Geräten untereinander; Spalten und Beschriftungen können passend umbrechen.                                                                       |
| Begriffe und kleine Werkzeugbuttons waren uneinheitlich oder abgeschnitten.                                             | Deutsche Ansichten verwenden durchgängig „Konto“, „Vorlagen“ und „Sicherheit“; schmale Werkzeugleisten zeigen vollständige Beschriftungen in zwei Spalten.                     |

Die neuen Aufnahmen umfassen 30 geladene Hub-Ansichten bei 320, 390, 768 und
1440 px in Hell und Dunkel, fünf Ansichten mit ausgeklappter Kontenübersicht bei
1280 px und zwölf Admin-Ansichten bei 320 und 390 px. Die separate Galerie
enthält diese 47 Screenshots sowie Links auf vollständige Seiten. Bei der
Aufnahme wird auf geladene Fachinhalte gewartet, damit ein Ladebild nicht
versehentlich als geprüfter Werkzeugzustand zählt.

## Erweiterung zum Konto-Hub

Die Kontoseite führt jetzt über fünf Tabs zu Spielen und Spielzeit, Inventar
und Markt, Karten-Farming, Gratisangeboten sowie Konto und Sicherheit. Die
kompakte Kontoleiste zeigt die Verbindung und die tatsächlich gemeldeten Spiele.
Auf kleinen Displays sind alle fünf Bereiche ohne horizontale Suche sichtbar.
Ein Tabwechsel ändert die laufende Aktivität nicht.

| Bereich                        | Umsetzung und geprüfte Entscheidung                                                                                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kartenbilder                   | Echte Steam-Gegenstandsbilder mit 64 px Höhe, nach Spiel gruppiert; Fallback für fehlende Bilder, Mengen und Duplikate direkt am Gegenstand.                                                                      |
| Inventarsuche                  | Spiel-, Typ-, Glanzkarten-, Handelbarkeits- und Duplikatfilter, Suche, Sortierung und begrenzte Seiten.                                                                                                           |
| Preisregeln                    | Preisquelle, genaue Währungsbeträge, Grenzen und Wartezeiten; ausdrückliches Speichern und sichtbare ungespeicherte Entwürfe. Verkaufsvorschauen warten auf Speichern oder Verwerfen.                             |
| Sammelaktionen                 | Auswahl je Gegenstand, Spiel oder Filter; Vorschau mit Gebühren, danach ausdrückliche Bestätigung, Einzelfortschritt und Abbruch weiterer Aktionen.                                                               |
| Marktangebote auf Mobilgeräten | Lange Namen und Aktionsbutton stehen untereinander, damit Titel auch bei 320 px lesbar bleiben.                                                                                                                   |
| Farming-Auswahl                | Spielbilder und durchsuchbare Auswahl aus Bibliothek, Badge-Ergebnis und gespeicherten IDs; Ausschlüsse haben Vorrang. AppID-Felder bleiben als erweiterte Eingabe erhalten.                                      |
| Aktivitätsmodi                 | Farming sammelt ebenfalls Spielzeit. Der Wechsel zur gespeicherten manuellen Auswahl erfordert eine ausdrückliche Bestätigung; tatsächlich laufende Farming-Spiele ersetzen keine gespeicherten Spiele.           |
| Statistik und Zeitlimits       | Farming-Zielwechsel aktualisieren die lokale Spielzuordnung. Sie setzen zusammenhängende Sitzungslimits nicht zurück.                                                                                             |
| Nebenläufige Antworten         | Alte Konto-, Batch- oder Statusantworten dürfen neuere Ansichten, Jobs und bestätigte Stopzustände nicht ersetzen. Verlorene Bestätigungsantworten führen zu einer Statusabfrage, ohne erneute Marktübermittlung. |

Die folgenden Befunde dokumentieren außerdem die vorausgehende Prüfung der
einzelnen Steam-Werkzeuge.

## Gefundene und behobene Probleme

| Bereich                  | Befund                                                                                                                                                             | Korrektur                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Auffindbarkeit           | Die neuen Werkzeuge standen unter der gesamten Bibliothek.                                                                                                         | Werkzeugnavigation oberhalb der Bibliothek; eindeutige aktive und benannte Bereiche.                                                      |
| Tablet und Mobilansicht  | Der Header wechselte zu früh auf breite Desktop-Steuerelemente; das Einstellungsmenü konnte bei 320 px den Bildschirm verlassen.                                   | Angepasster Breakpoint, passende Menübreite und scrollbar begrenzte Höhe.                                                                 |
| Tastatur und Dialoge     | Einstellungen schlossen nicht zuverlässig per Escape; das Schließen-Symbol wirkte während einer Marktübermittlung weiterhin bedienbar.                             | Escape, Außenklick und Fokusrückgabe; tatsächlich gesperrte Dialog-Steuerelemente während der Übermittlung.                               |
| Kontrast                 | Kleine graue Texte im hellen Theme unterschritten auf mehreren Flächen 4,5:1. Wieder aktivierte Buttons konnten während ihrer Opazitätsanimation zu blass bleiben. | Dunklerer Textfarbwert; Farb- statt Opazitätsübergänge bei Buttons. Paletten einschließlich Hoverzuständen geprüft.                       |
| Inventarladen            | Eine langsame Marktantwort blockierte bereits verfügbare Inventardaten.                                                                                            | Unabhängige Lade- und Fehlerzustände der beiden Abschnitte.                                                                               |
| Veraltete Daten          | Fehlgeschlagene Aktualisierungen waren bei weiter sichtbaren Daten nicht deutlich genug.                                                                           | Sichtbare Alters- und Fehlerhinweise; passende Marktaktionen bleiben bis zur erfolgreichen Aktualisierung gesperrt.                       |
| Marktentscheidung        | Verkaufsvorschau und Erfolgstext konnten einen abgeschlossenen Verkauf oder eine immer erforderliche Steam-Bestätigung suggerieren.                                | Angebotserstellung, möglicher Sofortkauf, Unwiderruflichkeit, Gesamtgebühren und bedingte Steam-Bestätigung klar getrennt.                |
| Marktfortschritt         | Gesperrte Schaltflächen erklärten den laufenden Vorgang nicht.                                                                                                     | Konkrete Vorschau- und Übermittlungsrückmeldung, Vorschau-Countdown und klare Fehlerbehandlung.                                           |
| Inventarnavigation       | Eine scrollbare Liste ohne bedienbare Gegenstände war per Tastatur schlecht erreichbar.                                                                            | Benannter, fokussierbarer Scrollbereich mit sichtbarem Fokusring.                                                                         |
| Farming-Eingaben         | Unfertige Einstellungen gingen beim Werkzeugwechsel verloren; eine Suche war mit ungespeicherten Filtern möglich.                                                  | Entwürfe pro Konto im Browser-Tab; ausdrückliches Speichern oder Verwerfen vor Suche und Start.                                           |
| Farming-Zustand          | Ein zusätzlicher fehlgeschlagener Status-GET konnte einen tatsächlich erfolgreichen Start oder Stop verschleiern; Statusabfragen konnten überlappen.               | Aktionsantworten direkt übernehmen; Aktualisierungsfehler separat anzeigen; serialisierte Abfragen und Schutz gegen verspätete Antworten. |
| Farming-Verständlichkeit | Kontolimit, Sperrgründe und fehlerhafte AppID-Eingaben waren nicht ausreichend erklärt.                                                                            | Effektives Limit, konkrete Sperrerklärungen, Feldfehler mit Fokus und zugängliche Statusmeldungen.                                        |
| Gratisangebote           | Region und Alter der Besitzdaten standen erst unter den Angeboten.                                                                                                 | Hinweise vor den Angeboten; eindeutige Storelinks und umbrochene lange Titel.                                                             |
| Benachrichtigungen       | Abgelehnte Browserberechtigung blockierte auch Dashboardhinweise; verspätete Freigaben und Änderungen aus anderen Tabs waren nicht ausreichend abgesichert.        | Dashboardhinweise unabhängig von Systemberechtigung; Konto- und Tabwechsel abgesichert, neue Angebote tabübergreifend dedupliziert.       |
| Darstellung              | Schrift- und Themepräferenzen synchronisierten nicht zwischen Tabs.                                                                                                | Gemeinsame Browserpräferenzen aktualisieren offene Tabs; lokale Schriftstapel bleiben erhalten.                                           |

## Prüfumfang

Die Browserprüfung verwendet echtes Chromium mit Playwright und axe-core 4.11.0.
Die Anwendung wird vollständig gerendert; Steam-Antworten sind synthetische,
kontrollierte Testdaten. Es werden keine realen Konten oder Marktaktionen benutzt.

- 42 Werkzeugansichten: alle drei Werkzeuge bei 320, 375, 640, 768, 1024 und
  1440 px im hellen Theme; zusätzliche Ansichten bei 375 und 1440 px in Dunkel,
  Mitternacht, Wald und Papier. Die Markt-Dialoge sind zusätzlich enthalten.
- 14 ergänzende Layoutfälle mit deutscher und arabischer Oberfläche,
  Rechts-nach-links-Darstellung, Monospace-Schrift, System-Dunkelmodus und
  kurzen Viewports bis 320 px Höhe. Geprüft werden Menügrenzen, Escape,
  Außenklick, Fokusrückgabe und der inaktive Hintergrund eines offenen Dialogs.
- Fünf gezielte Browserabläufe: langsamer Markt bei schnellem Inventar,
  veraltetes Inventar nach Refreshfehler, abgelaufene Verkaufsvorschau,
  laufende Marktübermittlung, Angebotsfehler mit Wiederholung und erhaltene
  Farming-Eingaben nach Werkzeugwechsel. Mehrere Zustände gehören dabei zu
  einem Ablauf.
- Automatische axe-Regeln für WCAG 2 A/AA und WCAG 2.1 AA, Kontrastprüfungen
  aller festen Paletten sowie regressionsgesicherte Formular-, Dialog-,
  Konto- und Benachrichtigungszustände.

Die erhaltenen Regressionstests liegen unter `apps/web/tests/`, insbesondere
`appearance.test.tsx`, `accessibility.test.tsx`, `steam-tools-panel.test.tsx`,
`inventory-panel.test.tsx`, `farming.test.tsx` und `discovery*.test.tsx`.

## Validierung und Grenzen

Der aktuelle Stand besteht die Typprüfung, den Produktionsbuild, die
Formatprüfung und den vollständigen Testlauf mit 865 Tests: 543 Server-,
303 Web-, drei Vertrags- und 16 Repository-Tests. Der gebaute Server startet
mit einer frischen Testdatenbank, meldet Health und Readiness erfolgreich,
liefert den gebauten Webclient aus und führt alle 14 Migrationen bis
`014_library_import_marker` aus. Historisch leere Bibliotheksimporte benötigen
einmal einen erneuten Import, weil frühere Versionen ihren Zeitpunkt nicht
gespeichert haben. Bestehende nichtleere Bibliotheken werden übernommen.

Die vorausgehende Hub-Browser-Matrix umfasste 112 Fälle: die fünf Hub-Bereiche sowie offene
Preisregeln und Sammelaktionsdialoge bei 320, 375, 640, 768, 1024 und 1440 px im
hellen Theme, zusätzlich bei 375 und 1440 px in Dunkel, Mitternacht, Wald und
Papier sowie zwei arabische RTL-Kontexte. Es bleiben keine geprüften axe-Befunde,
horizontalen Seitenüberläufe oder JavaScript-Laufzeitfehler offen. Der manuell
geprüfte Umbruch langer Marktangebotstitel ist zusätzlich abgesichert.

Die vorausgehende Prüfung bestand aus 588 automatischen Tests, Typprüfung,
Produktionsbuild sowie 42 Werkzeugansichten, 14 ergänzenden Layoutfällen und
fünf Browser-Zustandsabläufen. Dabei blieben keine axe-Befunde, horizontalen
Seitenüberläufe oder JavaScript-Laufzeitfehler offen.

Die Erweiterung prüft zusätzlich die fünf Hub-Bereiche, geöffnete Preisregeln
und Sammelaktionsdialoge über verschiedene Viewports und Themes. Ein
unabhängiger Browser-Stresstest verwendet 32 aktive Farming-Spiele bei 320 und
1440 px über alle fünf Tabs: Die aktive Liste bleibt scrollbar, die gespeicherte
manuelle Auswahl wird nicht als aktiv dargestellt, Navigation und Abbruch
senden keine Mutation. Der bestätigte Wechsel sendet genau eine Resume-Anfrage.
Das zusätzliche 320-px-Bestätigungsmodal bleibt innerhalb des Viewports und gibt
nach Escape den Fokus zurück.

Die Browserfälle ersetzen keine Prüfung mit echten assistiven Technologien,
Safari oder Firefox und keine Liveprüfung der Steam-Berechtigungen,
Marktausführung oder Kartendrops. Die bestehenden Live-Voraussetzungen bleiben
in [Steam Tools](STEAM-TOOLS.md) beschrieben.
