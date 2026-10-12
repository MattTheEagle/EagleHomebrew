# Eagle Homebrew

Foundry-VTT-Modul **Eagle Homebrew**: der Editor zum Erstellen und Bearbeiten von Homebrew-Inhalten
in den Eagle Modulen (Actors, Items, Roll Tables über 18 Objektarten). Es ist das dritte Modul der
Eagle Modules und der zweite Verbraucher von Eagle Library, nach Eagle Flight Control.

**Stand:** Version 0.0.1, interner Meilenstein M21. Alle 18 vorgesehenen Objektarten besitzen einen
Editor. Neue Dokumente entstehen gleichzeitig in der Welt und im passenden Eagle-Library-Pack;
Namenskollisionen erhalten automatisch den Zusatz "(Duplicate)". Die Forge-Live-Checks M17 bis M20
sind unter Regelversion 2024 ohne offene Funde bestätigt.

M19 ergänzt **Edit with Eagle Homebrew** im Blattkopf und in den Kontextmenüs der Actor-, Item- und
Roll-Table-Verzeichnisse. Der Einstieg gilt genau für die 18 unterstützten Welt-Dokumentarten. Fehlt
das Library-Gegenstück, kopiert Eagle Flight Control das vollständige Welt-Dokument mit gleicher ID
in das passende Pack und Homebrew repariert die Pair-Flags. Der Editor liest anschließend die
Library als Quelle und speichert bekannte Änderungen Library-zuerst auf beide Seiten. Aktuelle
unbekannte Felder, fremde Flags und nicht modellierte eingebettete Einträge werden beim Merge
beibehalten; bestehende modellierte Bausteine behalten ihre IDs. Vor dem Schreiben prüft Homebrew
alle Update-Pakete, begrenzt sie auf 50 Pfade und blockiert Kollisionen oder zu große Payloads.

M18 ergänzt **Vehicle** mit dem gemeinsamen dnd5e-Schema für Land-, Wasser-, Luft- und
Weltraumfahrzeuge. Der Editor deckt Fähigkeiten, Kampfwerte, Movement/Travel, Maße,
Cargo-Kapazität, Schutzmerkmale, Währung, Beschreibung und Quelle ab. Crew, Passengers und Draft
Animals werden über Actor-Picker mit Mengen und kanonischen Eagle-Library-UUIDs gepflegt. Ein
zweiter Baustein legt Vehicle Features, Equipment Stations und Weapon Stations mit optionaler
Activity und geführter Stationsbesatzung als eingebettete Items an. Allgemeine Cargo-Inventar-Items
und Actor-/verschachtelte Active Effects bleiben bewusst dem nativen Vehicle-Sheet vorbehalten.

M20 macht bedingte Zusatzschäden ohne eigene Automatisierung verständlich: Eine zweite **Damage**-
Activity speichert etwa „2d6 fire, only against undead“ vollständig im nativen dnd5e-Format. Das
Feld **Condition (manual check)** ist direkt sichtbar; die Activity wird vom nativen Item-Blatt
manuell ausgelöst und Eagle Homebrew prüft die Bedingung bewusst nicht automatisch. Damit
funktioniert die gespeicherte Zusatzaktion auch ohne aktivierte Eagle-Module.

M17 ergänzt **Encounter** und **Group** mit allen spezialisierten Systemfeldern und einem geführten
Mitglieder-Baustein. Encounter akzeptieren NPCs aus Welt oder Eagle Library und speichern deren
kanonische UUID samt Menge und optionaler Mengenformel. Groups speichern entsprechend dnd5es Schema
ausschließlich IDs vorhandener Welt-Actors; Characters, NPCs und Vehicles sind zulässig, und ein
enthaltenes Vehicle kann als Primary Vehicle gewählt werden. Fehlende Library-Gegenstücke bleiben
sichtbar und lösen beim Hinzufügen sowie beim Erstellen eine Warnung aus. Die automatische
Verifikation sowie die Forge-Prüfung unter Regelversion 2024 sind ohne offene Funde abgeschlossen.

M16b erweitert den geführten Advancement-Baustein auf **Class, Subclass, Feat, Background und
Species**. Die Auswahl zeigt je Item-Art nur die von dnd5e erlaubten Advancement-Typen. Species kann
genau einen Size-Eintrag mit Medium als Vorgabe erhalten. Item Choice trennt Item-Typ, Feature-
Kategorie/-Untertyp sowie Spell-Level/-Listen und zeigt nur die Felder, die zur aktuellen Auswahl
gehören. Item Choice und Scale Value verwalten Stufen in ihren eigenen Tabellen und haben deshalb
kein zusätzliches allgemeines Level-Feld. Der automatisierte Prüfpfad und der Forge-Live-Check unter
Regelversion 2024 sind ohne offene Funde bestanden.

Weitere geführte Bausteine decken Activities, Active Effects, Roll-Table-Einträge und die eingebetteten
Aktionen eines NPC ab. M16a (NPC-Aktionen) wurde auf Forge ohne offene Funde bestätigt. Formularfelder
mit dnd5e-Katalogen verwenden echte Auswahl- oder Mehrfachauswahlfelder; Felder ohne passenden Katalog
bleiben als einfache Eingabe erhalten. **Bekannte Grenze:** Das Fenster ist bei aufgeklapptem "More
fields" trotz zweier früherer Fix-Versuche weiterhin nicht scrollbar
(`v13/styles/eagle-homebrew.css`); der Projektleiter hat diese Grenze für M7 akzeptiert.

**Hintergrund der Korrektur:** Nach M4 hat der Projektleiter den Grundgedanken korrigiert
(`dadm/archive/implementation-phase-6-eagle-homebrew/01-project-brief.md`, Abschnitt "Korrektur 2026-09-22"): der Hauptnutzen ist ein eigenes,
verständlicheres Editor-Blatt mit voller Feldabdeckung je Objektart, nicht nur die Welt/Library-
Kopplung. Milestone Plan Version 2 (`dadm/archive/implementation-phase-6-eagle-homebrew/04-milestone-plan.md`) setzt das um: M5 legte das reine
`core/`-Datenmodell für Activities an (`core/activity-model.ts`: fünf Activity-Typen, vollständiges
Feldinventar aus dem dnd5e-Quellcode; `core/effect-model.ts`: ausgelöste ActiveEffects;
`core/path-data.ts`: die gemeinsame Pfad-Verschachtelung), M6 (in Eagle Flight Control) die
Fähigkeit, bestehende Dokumente gezielt zu ändern, M7 verband beides zur UI. M8-M18 erweiterten
dieses Muster auf alle Objektart-Editoren. Nur Foundry v13. Es gibt keine Lizenz (Hobbyprojekt).
Das Repo ist lokal, hat keinen Remote, und nichts ist veröffentlicht.

## Voraussetzungen

- Foundry VTT v13.
- Eagle Flight Control ab Version `0.8.0` (API `0.14.0`).
- Eagle Library ab Version `0.1.0`.

Das Manifest (`v13/module.json`) verlangt beide unter `relationships.requires`.

## Was das Modul heute tut

Eagle Homebrew registriert sich bei Eagle Flight Control (`core/flight-control.ts`, `v13/module.ts`).
Der Hub öffnet das eigene Fenster für Gamemaster und Assistants. Dort führt die Auswahl über Art und
Unterkategorie zum jeweiligen Editor (`core/catalog.ts`). Die Formulardaten werden beim Erstellen auf
ein Welt-Dokument und einen Eintrag im passenden Eagle-Library-Pack geschrieben
(`core/create-pair.ts`). Komplexe Mapping-Felder wie Activities und Advancements folgen anschließend
über die gezielte `document.update`-Fähigkeit von Flight Control; beide Seiten erhalten dafür eine
eigene Deep-Clone-Kopie.

Bestehende unterstützte Welt-Dokumente öffnen denselben Editor über die öffentlichen Foundry-v13-
Hooks (`v13/edit-hooks.ts`). `core/edit-routing.ts` enthält die gemeinsame Allowlist,
`core/pair-retrofit.ts` plant und repariert das Welt/Library-Paar, und
`core/edit-projection.ts` erzeugt die verlustfreien, gebündelten Save-Patches.

Die Item-Editoren bilden ihre dnd5e-Felder über `core/item-field-model.ts` ab. Activities und ihre
ausgelösten Effekte liegen in `core/activity-model.ts`, `core/effect-model.ts` und
`core/activity-batch.ts`; eigenständige passive Effekte verwenden denselben Zielkatalog. Roll Tables
haben einen Eintrags-Baustein mit automatisch berechneten Gewichtsbereichen. NPCs besitzen einen
vollständigen Statblock-Editor sowie einen Actions-Baustein für eingebettete Features und Waffen. Der
Advancement-Baustein in `core/advancement-model.ts` filtert seine Typen nach der Item-Art und baut die
jeweiligen dnd5e-Konfigurationen einschließlich verschachtelter Tabellen. Encounter und Group
verwenden `core/actor-member-model.ts`: Die reine Logik kanonisiert Encounter-Mitglieder auf einen
vorhandenen Eagle-Library-NPC und erzwingt für Group-Mitglieder die von dnd5e verlangte Welt-ID;
`v13/module.ts` löst die dafür nötigen Actor-Gegenstücke ausschließlich lesend auf. Vehicle nutzt
dieselbe Auflösung für Crew, Passengers und Draft Animals; `core/vehicle-component-model.ts` baut
Features und Stations-Items als gemeinsames `changes.items`-Array mit stabilen IDs.

## Konvention für spätere Eagle-Verbraucher

Eagle Homebrew schreibt Activities als native dnd5e-Daten unter
`system.activities.<activityId>`. Der Editor unterstützt die Typen `attack`, `damage`, `save`,
`check` und `heal`. Die Mapping-ID einer bekannten Activity bleibt beim Bearbeiten erhalten;
unmodellierte Activity-Einträge werden nicht still gelöscht.

Ein bedingter Zusatzschaden der Stufe 1 ist eine **zweite**, native `damage`-Activity. Ihr
`activation.condition` ist optionaler dnd5e-Freitext, zum Beispiel `Only against undead`, und
`activation.type` beschreibt den nativen manuellen Auslöser. Der Schaden steht nativ in
`damage.parts`, zum Beispiel `{ number: 2, denomination: 6, types: ["fire"] }`. Homebrew legt
dafür keine Eagle-Flag und keine maschinenlesbare Bedingungssemantik an. Ein Verbraucher darf den
Freitext deshalb weder parsen noch ausführen oder als sicheren Regelvertrag behandeln.

Ausgelöste und eigenständige Active Effects liegen als eingebettete Dokumente im Wurzelpfad
`effects`. Eine verknüpfte Activity referenziert ihren Effect über
`activity.effects: [{ _id: <effectId> }]`; der Effect selbst enthält `_id`, `name` und `changes`
mit `{ key, value, mode }`. Activities und Effects verwenden keine Eagle-Zwischensprache.

Eine spätere automatische Prüfung gehört zu Eagle Roll Out. Sie benötigt dort ein eigenes,
versioniertes Bedingungsmodell mit Zielkontext, Ausführungsreihenfolge, Rechten und Fehlerverhalten;
M20s Freitext ist absichtlich keine Quelle dafür. Homebrew benötigt Eagle Flight Control ab `0.8.0`
mit API `0.14.0` und Eagle Library ab `0.1.0`. Das Bearbeiten bestehender Dokumente nutzt
`document.update` mit höchstens 50 Pfaden; unbekannte Felder, fremde Flags und nicht modellierte
eingebettete Einträge bleiben beim Merge erhalten.

## Bauen

```
npm install
npm run typecheck
npm test
npm run build
npm run package   # baut release/eagle-homebrew-v13.zip und release/module.json; veröffentlicht nichts
```

`npm run typecheck` braucht die gepinnten Foundry-Types aus
`foundry-vtt-reference-v13/types/src/index.d.mts` (siehe `v13/tsconfig.json`, relativer Pfad — das
Repo muss dafür im selben Elternordner liegen wie `foundry-vtt-reference-v13/`).

`v13/flight-control-api.d.ts` ist eine von Hand aus dem Vertrag von Eagle Flight Control
(`../EagleFlightControl/docs/api-contract.md`) abgeschriebene Typdeklaration, kein gemeinsamer
Code (E7). Sie ist bei Vertragsänderungen von Flight Control nachzuführen.

## `npm audit`

Wie bei Eagle Flight Control und Eagle Library melden die Entwicklungswerkzeuge (Vitest, Vite,
esbuild) einige Advisories, die nur einen lokal lauschenden Dev-/UI-Server betreffen; die Skripte
dieses Repos starten keinen. Eingestuft als `low` im Projektkontext (siehe Deploy-Output von M1
in `dadm/`); nicht blockierend.
