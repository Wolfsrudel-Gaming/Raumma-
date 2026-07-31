-- Aufmaß-Kern: Schema für PostgreSQL
--
-- Zusammengefasste Fassung – im Ursprungsprojekt ist dasselbe über mehrere
-- Migrationsschritte gewachsen. Wer den Kern neu aufsetzt, nimmt diese Datei;
-- wer ihn in ein bestehendes Schema einbaut, übernimmt die Tabellen einzeln.
--
-- Einheiten: alle Längen in Metern, alle Winkel in Grad.
-- Koordinaten: Ursprung links oben, x nach rechts, y nach hinten.
--
-- Bewusst *keine* Fremdschlüssel-Constraints auf die Räume: Im Ursprungs-
-- system laufen die Daten über eine Synchronisation, bei der Datensätze in
-- beliebiger Reihenfolge eintreffen können. Wer das nicht braucht, ergänzt
-- REFERENCES ... ON DELETE CASCADE – dann entfällt das Aufräumen im Code.

CREATE TABLE raeume (
    id              UUID PRIMARY KEY,
    name            TEXT NOT NULL,
    -- Raumnummer am Türschild, z. B. „1.03". Leer = keine vergeben.
    nummer          TEXT NOT NULL DEFAULT '',
    -- 0 = Erdgeschoss, negativ = Untergeschoss.
    geschoss        INT  NOT NULL DEFAULT 0,

    -- Kurzbeschreibung: Rechteck oder Trapez.
    breite_m        NUMERIC(8,2) NOT NULL DEFAULT 4,   -- hintere Wand
    breite_vorne_m  NUMERIC(8,2),                      -- NULL = wie hinten
    tiefe_m         NUMERIC(8,2) NOT NULL DEFAULT 4,
    -- KEINE, LINKS, RECHTS, BEIDSEITIG – auf welcher Seite die Wand schräg ist.
    schraege        TEXT NOT NULL DEFAULT 'KEINE',

    -- Freier Umriss als JSON: [[x,y],[x,y],…] im Uhrzeigersinn.
    -- Gesetzt schlägt er die Kurzbeschreibung; leer = nicht erfasst.
    umriss          TEXT NOT NULL DEFAULT '',

    -- Lichte Raumhöhe: Wandhöhe im Modell und Grundlage der Geschosslage.
    hoehe_m         NUMERIC(6,2) NOT NULL DEFAULT 2.50,

    -- Lage der linken oberen Ecke im Gebäudeplan.
    x_m             NUMERIC(8,2) NOT NULL DEFAULT 0,
    y_m             NUMERIC(8,2) NOT NULL DEFAULT 0,
    drehung_grad    NUMERIC(6,2) NOT NULL DEFAULT 0,

    farbe           TEXT NOT NULL DEFAULT '#cfe8e9',
    notiz           TEXT NOT NULL DEFAULT '',

    geaendert_am    TIMESTAMPTZ NOT NULL DEFAULT now(),
    geloescht       BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX raeume_geschoss ON raeume (geschoss) WHERE NOT geloescht;

-- Öffnungen gehören zur *Wand*, nicht zum Raum als Ganzes: Nur so entsteht
-- beim Zeichnen ein echtes Loch. Die Wand wird über ihren Index angesprochen –
-- Ecken im Uhrzeigersinn, Wand i von Ecke i zur nächsten. Beim Viereck also
-- 0 = vorne, 1 = rechts, 2 = hinten, 3 = links.
CREATE TABLE oeffnungen (
    id              UUID PRIMARY KEY,
    raum_id         UUID NOT NULL,
    -- TUER, DURCHGANG, FENSTER, TOR
    art             TEXT NOT NULL DEFAULT 'TUER',
    bezeichnung     TEXT NOT NULL DEFAULT '',
    wand_index      INT  NOT NULL DEFAULT 0,
    -- Abstand der linken Kante von der Wandecke.
    abstand_m       NUMERIC(8,2) NOT NULL DEFAULT 0,
    breite_m        NUMERIC(6,2) NOT NULL DEFAULT 0.885,
    hoehe_m         NUMERIC(6,2) NOT NULL DEFAULT 2.01,
    -- Brüstungshöhe: 0 bei Türen, sonst Unterkante über dem Fußboden.
    bruestung_m     NUMERIC(6,2) NOT NULL DEFAULT 0,
    notiz           TEXT NOT NULL DEFAULT '',
    geaendert_am    TIMESTAMPTZ NOT NULL DEFAULT now(),
    geloescht       BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX oeffnungen_raum ON oeffnungen (raum_id) WHERE NOT geloescht;

-- Einbauten: Steckdose, Schalter, Leuchte, Heizkörper …
-- `art` ist bewusst Text und keine Aufzählung: Welche Arten es gibt, ist eine
-- fachliche Festlegung, die sich ohne Schemaänderung erweitern lassen muss.
CREATE TABLE einbauten (
    id              UUID PRIMARY KEY,
    raum_id         UUID NOT NULL,
    art             TEXT NOT NULL,
    bezeichnung     TEXT NOT NULL DEFAULT '',
    -- FREI, WAND, DECKE, BODEN
    befestigung     TEXT NOT NULL DEFAULT 'FREI',
    wand_index      INT,                               -- nur bei WAND
    abstand_m       NUMERIC(8,2),                      -- nur bei WAND
    hoehe_m         NUMERIC(6,2),                      -- Mitte über Fußboden
    -- Lage im umschließenden Rechteck als Anteil 0…1 (DECKE, BODEN, FREI).
    -- Anteile statt Meter, damit die Lage erhalten bleibt, wenn der Raum
    -- nachträglich anders vermessen wird.
    rel_x           NUMERIC(6,4) NOT NULL DEFAULT 0.5,
    rel_y           NUMERIC(6,4) NOT NULL DEFAULT 0.5,
    notiz           TEXT NOT NULL DEFAULT '',
    geaendert_am    TIMESTAMPTZ NOT NULL DEFAULT now(),
    geloescht       BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX einbauten_raum ON einbauten (raum_id) WHERE NOT geloescht;
CREATE INDEX einbauten_art  ON einbauten (art)     WHERE NOT geloescht;
