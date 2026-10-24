"""
End-to-end-Tests der Pipeline.

- Simulationsmodus: läuft ohne COLMAP/OpenMVS durch und kennzeichnet **jede**
  daraus stammende Zahl als simuliert.
- Echter Modus: COLMAP/OpenMVS werden durch `hilfen.FalscheWerkzeuge` ersetzt,
  die eine Rekonstruktion mit bekanntem wahrem Maßstab (0,25 m/Einheit)
  schreiben. Der Solver muss genau diesen Maßstab aus den Modellpunkten lesen –
  nie den Simulationswert 0,37 – und ohne Modellpunkte im Klartext scheitern.
"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from raumwerk_pipeline import stages, tools
from raumwerk_pipeline.config import Config
from raumwerk_pipeline.jobs import ANGELEGT, FEHLER, FERTIG, LAEUFT, JobStore
from raumwerk_pipeline.pipeline import run_job
from raumwerk_pipeline.worker import Worker
from tests import hilfen


def _cfg(tmp, simulieren=True) -> Config:
    return Config(daten_dir=Path(tmp), simulieren=simulieren).vorbereiten()


DEMO_EINGABE = {
    "laser": [
        {"distanzM": 4.20}, {"distanzM": 3.00}, {"distanzM": 2.50},
        {"distanzM": 5.15}, {"distanzM": 5.16},
    ],
    "tags": [{"art": "ZAEHLERSCHRANK"}, {"art": "KABEL_NYM5"}],
}

# Ein Lasermaß A–B mit seinen Endpunkten als Bildpunkte (Ecke 1 und 2 in IMG_001).
LASER_AB = {"von": "A", "bis": "B", "distanzM": 4.2,
            "modell_a": hilfen.bildpunkt(1), "modell_b": hilfen.bildpunkt(2)}

RECHTECK_ZUG = [
    {"art": "wand", "laenge": 4.20, "drehung": 90},
    {"art": "wand", "laenge": 3.00, "drehung": 90},
    {"art": "wand", "laenge": 4.20, "drehung": 90},
    {"art": "wand", "laenge": 3.00, "drehung": 90},
    {"art": "raumhoehe", "laenge": 2.50},
]


class _Basis(unittest.TestCase):
    simulieren = True

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.cfg = _cfg(self._tmp.name, self.simulieren)
        self.store = JobStore(self.cfg)

    def tearDown(self):
        self._tmp.cleanup()

    def rechnen(self, eingabe, bilder=0, name="Test"):
        job = self.store.neu(name, eingabe)
        for i in range(bilder):
            (self.store.bilder_dir(job.id) / f"IMG_{i + 1:03d}.jpg").write_bytes(b"x")
        run_job(job, self.store, self.cfg)
        return self.store.laden(job.id)


class SimulationTest(_Basis):
    def test_lauf_liefert_massstab_und_artefakte(self):
        fertig = self.rechnen(DEMO_EINGABE)
        self.assertEqual(fertig.status, FERTIG)
        self.assertEqual(fertig.fortschritt, 1.0)
        e = fertig.ergebnis
        # Maßstab ~ 0,37 m/Einheit zurückgewonnen – ein DEMO-Wert, so gekennzeichnet.
        self.assertAlmostEqual(e["massstab"]["skala_m_je_einheit"], 0.37, delta=0.03)
        self.assertIn("kontrollmass_abweichung_mm", e["massstab"])

        jobdir = self.store.dir(fertig.id)
        for datei in ("wolke.ply", "massstab.json", "result.json"):
            self.assertTrue((jobdir / datei).exists(), datei)

        self.assertEqual(e["komponenten"]["zugeordnet"], 2)
        self.assertEqual(e["semantik"]["befunde"], 1)
        self.assertEqual(e["modus"], "simulation")

    def test_simulation_ist_ueberall_gekennzeichnet(self):
        fertig = self.rechnen(DEMO_EINGABE)
        e = fertig.ergebnis
        hinweis = "Simulation – keine echte Messung"
        self.assertTrue(e["simuliert"])
        self.assertEqual(e["hinweis"], hinweis)
        for block in ("sfm", "wolke", "massstab", "viewer"):
            self.assertIs(e[block]["simuliert"], True, block)
        self.assertEqual(e["massstab"]["hinweis"], hinweis)
        # Kein simuliertes Kontrollmaß als Genauigkeitszahl – nur separat als Demo-Wert.
        self.assertIsNone(e["massstab"]["kontrollmass_abweichung_mm"])
        self.assertIsInstance(e["massstab"]["kontrollmass_abweichung_mm_simuliert"], float)
        self.assertIn("Simulation", e["massstab"]["kontrollmass_hinweis"])
        # Datei auf der Platte trägt dieselbe Kennzeichnung.
        jobdir = self.store.dir(fertig.id)
        massstab = json.loads((jobdir / "massstab.json").read_text(encoding="utf-8"))
        self.assertTrue(massstab["simuliert"])
        result = json.loads((jobdir / "result.json").read_text(encoding="utf-8"))
        self.assertTrue(result["simuliert"])
        self.assertEqual(result["hinweis"], hinweis)
        kopf = (jobdir / "wolke.ply").read_text(encoding="ascii").split("end_header")[0]
        self.assertIn("comment RAUMWERK Simulation", kopf)
        self.assertIn("comment simuliert: true", kopf)
        # Platzhalter statt erfundener Kamerazahl.
        self.assertIsNone(e["sfm"]["kameras"])

    def test_hochgeladene_bilder_werden_gezaehlt(self):
        fertig = self.rechnen(DEMO_EINGABE, bilder=2)
        self.assertEqual(fertig.ergebnis["sfm"]["bilder"], 2)

    def test_ein_einziges_lasermass_reicht(self):
        fertig = self.rechnen({"laser": [{"von": "A", "bis": "B", "distanzM": 4.2}]})
        self.assertEqual(fertig.status, FERTIG, fertig.fehler)
        m = fertig.ergebnis["massstab"]
        self.assertGreater(m["skala_m_je_einheit"], 0)
        self.assertIsNone(m["kontrollmass_abweichung_mm"])
        self.assertIsNone(m["kontrollmass"])
        self.assertIn("Nur ein bekanntes Maß", m["kontrollmass_hinweis"])
        self.assertIsNone(m["rms_mm"])
        self.assertNotIn("kontrollmass_abweichung_mm_simuliert", m)

    def test_nur_kamerahoehe_ohne_laser_und_ohne_wuerfel(self):
        fertig = self.rechnen({"bekannte_laengen": [{"art": "kamerahoehe", "laenge": 1.45}]}, bilder=3)
        self.assertEqual(fertig.status, FERTIG, fertig.fehler)
        anker = fertig.ergebnis["massstab"]["anker"]
        self.assertEqual([(a["quelle"], a["rolle"]) for a in anker], [("kamerahoehe", "massstab")])

    def test_zwei_masse_ergeben_kontrollmass(self):
        fertig = self.rechnen({"laser": [{"distanzM": 4.2}],
                               "bekannte_laengen": [{"art": "strecke", "laenge": 3.0}]})
        m = fertig.ergebnis["massstab"]
        self.assertEqual(m["anker_verwendet"], 1)
        self.assertEqual(m["kontrollmass"]["bezeichnung"], "Strecke 1")

    def test_ohne_bekannte_laenge_klartext_fehler(self):
        fertig = self.rechnen({"laser": [], "tags": []})
        self.assertEqual(fertig.status, FEHLER)
        self.assertIn("Kein bekanntes Maß", fertig.fehler)
        self.assertIn("Referenzwürfel ist nicht nötig", fertig.fehler)
        result = json.loads((self.store.dir(fertig.id) / "result.json").read_text(encoding="utf-8"))
        self.assertEqual(result["fehler"], fertig.fehler)

    def test_ungueltige_eintraege_werden_mit_hinweis_uebersprungen(self):
        fertig = self.rechnen({"laser": [{"distanzM": "abc"}, "Unsinn", {"distanzM": 4.2}]})
        self.assertEqual(fertig.status, FERTIG)
        h = fertig.ergebnis["hinweise"]
        self.assertIn("Lasermaß 1 ohne gültige Länge – übersprungen.", h)
        self.assertIn("Lasermaß 2 ist kein Objekt – übersprungen.", h)
        self.assertEqual(fertig.ergebnis["massstab"]["anker_verwendet"], 1)

    def test_riesige_ganzzahl_ist_keine_laenge(self):
        # 10**400 ist gültiges JSON; float() wirft dafür OverflowError, nicht ValueError.
        fertig = self.rechnen({"laser": [{"distanzM": 10 ** 400}, {"distanzM": 4.2}]})
        self.assertEqual(fertig.status, FERTIG, fertig.fehler)
        self.assertIn("Lasermaß 1 ohne gültige Länge – übersprungen.", fertig.ergebnis["hinweise"])

    def test_raum_aus_bandmass_zug(self):
        fertig = self.rechnen({"bekannte_laengen": RECHTECK_ZUG})
        raum = fertig.ergebnis["raum"]
        self.assertEqual(raum["umriss"], "[[0,0],[4.2,0],[4.2,3],[0,3]]")
        self.assertEqual((raum["breiteM"], raum["tiefeM"], raum["hoeheM"]), (4.2, 3.0, 2.5))
        self.assertEqual(raum["methode"], "band")
        self.assertIs(raum["simuliert"], False)          # aus echten Eingaben
        self.assertTrue(raum["geschlossen"])
        self.assertEqual([w["quelle"] for w in raum["waende"]], ["band"] * 4)
        self.assertAlmostEqual(raum["flaecheM2"], 12.6)
        self.assertTrue((self.store.dir(fertig.id) / "raum.json").exists())

    def test_offener_zug_ergaenzt_schlusswand_mit_hinweis(self):
        zug = [{"art": "wand", "laenge": 4.2, "drehung": 90},
               {"art": "wand", "laenge": 3.0, "drehung": 90},
               {"art": "wand", "laenge": 4.0, "drehung": 90}]
        raum = self.rechnen({"bekannte_laengen": zug}).ergebnis["raum"]
        self.assertTrue(raum["schlusswandErgaenzt"])
        self.assertEqual(len(raum["waende"]), 4)
        self.assertEqual(raum["waende"][-1]["quelle"], "getippt")
        self.assertIsNone(raum["waende"][-1]["sigmaM"])
        self.assertIn("Restlücke", raum["hinweise"][0])

    def test_kein_raum_ohne_zug_und_nie_geraten(self):
        e = self.rechnen(DEMO_EINGABE).ergebnis
        self.assertNotIn("raum", e)
        self.assertTrue(any("Kein Raumvorschlag" in h for h in e["hinweise"]))
        # Wand ohne Drehung im Zug: kein Raum, statt eine Drehung anzunehmen.
        zug = RECHTECK_ZUG[:2] + [{"art": "wand", "laenge": 4.2}] + RECHTECK_ZUG[3:]
        e = self.rechnen({"bekannte_laengen": zug}).ergebnis
        self.assertNotIn("raum", e)
        self.assertTrue(any("Wand 3" in h for h in e["hinweise"]))

    def test_neustart_rechnet_von_vorn(self):
        job = self.store.neu("Neu", {"bekannte_laengen": RECHTECK_ZUG})
        run_job(job, self.store, self.cfg)
        jobdir = self.store.dir(job.id)
        (jobdir / "alt.txt").write_text("vom letzten Lauf")
        job = self.store.zuruecksetzen(self.store.laden(job.id))
        self.assertEqual(job.ergebnis, {})
        run_job(job, self.store, self.cfg)
        self.assertEqual(self.store.laden(job.id).status, FERTIG)
        self.assertFalse((jobdir / "alt.txt").exists())
        self.assertTrue((jobdir / "wolke.ply").exists())

    def test_einzelner_worker_arbeitet_beide_jobs_ab(self):
        a = self.store.neu("A", DEMO_EINGABE)
        b = self.store.neu("B", DEMO_EINGABE)
        worker = Worker(self.store, self.cfg).start()
        worker.einreihen(a.id)
        worker.einreihen(b.id)
        self.assertTrue(worker.leerlauf(timeout=15))
        worker.stop()
        self.assertEqual(self.store.laden(a.id).status, FERTIG)
        self.assertEqual(self.store.laden(b.id).status, FERTIG)

    def test_worker_neustart_laesst_angelegte_liegen_und_holt_unterbrochene_nach(self):
        angelegt = self.store.neu("Bilder kommen noch", DEMO_EINGABE, status=ANGELEGT)
        unterbrochen = self.store.neu("Absturz mittendrin", DEMO_EINGABE, status=LAEUFT)
        worker = Worker(self.store, self.cfg).start()
        self.assertTrue(worker.leerlauf(timeout=15))
        worker.stop()
        self.assertEqual(self.store.laden(angelegt.id).status, ANGELEGT)
        self.assertEqual(self.store.laden(unterbrochen.id).status, FERTIG)


class EchterModusTest(_Basis):
    """COLMAP/OpenMVS ersetzt durch nachgebaute Ausgaben mit bekanntem Maßstab."""

    simulieren = False

    def setUp(self):
        super().setUp()
        self.werkzeuge = hilfen.FalscheWerkzeuge()
        patcher = mock.patch.object(tools, "ausfuehren", self.werkzeuge)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_massstab_kommt_aus_dem_modell_nicht_aus_der_simulation(self):
        eingabe = {
            "laser": [
                LASER_AB,
                {"von": "B", "bis": "C", "distanzM": 3.0,
                 "modell_a": {"bild": "IMG_001.jpg", "px": [501, 211]},
                 "modell_b": {"bild": "IMG_001.jpg", "px": [519, 598]}},
                # Diagonale: wahr 5,1614 m, Laser sagt 5,16 → Kontrollmaß ≈ 1,4 mm.
                {"von": "A", "bis": "C", "distanzM": 5.16, "kontrolle": True,
                 "modell_a": hilfen.bildpunkt(1), "modell_b": hilfen.bildpunkt(3)},
            ],
            "bekannte_laengen": RECHTECK_ZUG,   # ohne Modellpunkte: nur Raum, kein Anker
        }
        fertig = self.rechnen(eingabe, bilder=3)
        self.assertEqual(fertig.status, FERTIG, fertig.fehler)
        e = fertig.ergebnis
        self.assertEqual(e["modus"], "echt")
        self.assertIs(e["simuliert"], False)
        m = e["massstab"]
        self.assertAlmostEqual(m["skala_m_je_einheit"], hilfen.S_WAHR, places=6)
        self.assertNotAlmostEqual(m["skala_m_je_einheit"], stages._SIM_SKALA, places=2)
        self.assertAlmostEqual(m["kontrollmass_abweichung_mm"], 1.4, delta=0.05)
        self.assertEqual(m["kontrollmass"]["bezeichnung"], "A–C")
        self.assertIs(m["simuliert"], False)
        self.assertEqual(m["anker_verwendet"], 2)
        self.assertTrue(any("Wand 1: keine Modellpunkte" in h for h in e["hinweise"]))
        # SfM-Zahlen aus dem Modell, Wolke als ASCII aus der binären OpenMVS-Ausgabe.
        self.assertEqual((e["sfm"]["kameras"], e["sfm"]["punkte"]), (3, 8))
        self.assertEqual(e["wolke"]["punkte"], 24)
        self.assertIs(e["wolke"]["simuliert"], False)
        text = (self.store.dir(fertig.id) / "wolke.ply").read_text(encoding="ascii")
        self.assertTrue(text.startswith("ply\nformat ascii 1.0\n"))
        self.assertNotIn("Simulation", text.split("end_header")[0])
        # Der Raum kommt trotzdem aus dem Bandmaß-Zug.
        self.assertEqual(e["raum"]["umriss"], "[[0,0],[4.2,0],[4.2,3],[0,3]]")

    def test_kommandos_entzerren_und_laufen_mit_absoluten_pfaden(self):
        self.rechnen({"laser": [LASER_AB]}, bilder=3)
        namen = [k[1] if k[0] == "colmap" else k[0] for k in self.werkzeuge.aufrufe]
        self.assertEqual(namen, [
            "feature_extractor", "exhaustive_matcher", "mapper", "model_converter",
            "image_undistorter", "InterfaceCOLMAP", "DensifyPointCloud",
        ])
        for k in self.werkzeuge.aufrufe:
            for teil in k:
                if "/" in teil:
                    self.assertTrue(Path(teil).is_absolute(), teil)

    def test_binaeres_modell_und_kamerahoehe_als_einziges_mass(self):
        self.werkzeuge.binaer = True
        eingabe = {"bekannte_laengen": [
            {"art": "kamerahoehe", "laenge": 1.45,
             "boden": [hilfen.bildpunkt(1), hilfen.bildpunkt(2), hilfen.bildpunkt(3)]}]}
        fertig = self.rechnen(eingabe, bilder=3)
        self.assertEqual(fertig.status, FERTIG, fertig.fehler)
        m = fertig.ergebnis["massstab"]
        self.assertAlmostEqual(m["skala_m_je_einheit"], hilfen.S_WAHR, places=6)
        self.assertIsNone(m["kontrollmass_abweichung_mm"])
        self.assertIn("Nur ein bekanntes Maß", m["kontrollmass_hinweis"])

    def test_ohne_modellpunkte_scheitert_vor_colmap(self):
        fertig = self.rechnen(DEMO_EINGABE, bilder=3)
        self.assertEqual(fertig.status, FEHLER)
        self.assertIn("Modellabstände fehlen – Laser-Constraints brauchen Modellpunkte", fertig.fehler)
        self.assertEqual(self.werkzeuge.aufrufe, [])       # keine Stunde COLMAP umsonst
        self.assertNotIn("massstab", fertig.ergebnis)

    def test_nicht_aufloesbare_modellpunkte_scheitern_mit_grund(self):
        # (90, 610) ist ein Merkmal ohne rekonstruierten 3D-Punkt.
        eingabe = {"laser": [{"distanzM": 4.2, "modell_a": hilfen.bildpunkt(1),
                              "modell_b": {"bild": "IMG_001.jpg", "px": [90, 610]}}]}
        fertig = self.rechnen(eingabe, bilder=3)
        self.assertEqual(fertig.status, FEHLER)
        self.assertIn("Modellabstände fehlen", fertig.fehler)
        self.assertIn("kein rekonstruierter 3D-Punkt", fertig.fehler)
        self.assertNotIn("massstab", fertig.ergebnis)

    def test_punkt_ids_aus_frueherem_lauf_scheitern_vor_colmap(self):
        """
        Regression: Punkt-IDs und Modellkoordinaten stammen aus einer früheren
        Rekonstruktion – dieser Lauf baut eine neue (andere IDs, anderer
        Maßstab). Statt eines still falschen Maßstabs: Klartext, bevor COLMAP läuft.
        """
        for eingabe in (
            {"laser": [{"distanzM": 4.2, "modell_a": {"punkt3d": 1}, "modell_b": {"punkt3d": 2}}]},
            {"laser": [{"distanzM": 4.2, "modell_a": [0.12, 1.5, -3.2], "modell_b": [4.8, 1.4, -2.9]}]},
            {"bekannte_laengen": [{"art": "kamerahoehe", "laenge": 1.45, "boden": [11, 12, 13]}]},
        ):
            with self.subTest(eingabe=eingabe):
                self.werkzeuge.aufrufe.clear()
                fertig = self.rechnen(eingabe, bilder=3)
                self.assertEqual(fertig.status, FEHLER)
                self.assertIn("Modellabstände fehlen", fertig.fehler)
                self.assertIn("abgelehnt", fertig.fehler)
                self.assertIn("Bildpunkt {bild, px} angeben", fertig.fehler)
                self.assertEqual(self.werkzeuge.aufrufe, [])
                self.assertNotIn("massstab", fertig.ergebnis)

    def test_punkt_ids_neben_bildpunkten_fliessen_nicht_ein(self):
        eingabe = {"laser": [LASER_AB, {"von": "A", "bis": "C", "distanzM": 5.16,
                                        "modell_a": 1, "modell_b": 3}]}
        fertig = self.rechnen(eingabe, bilder=3)
        self.assertEqual(fertig.status, FERTIG, fertig.fehler)
        m = fertig.ergebnis["massstab"]
        self.assertAlmostEqual(m["skala_m_je_einheit"], hilfen.S_WAHR, places=6)
        self.assertEqual([a["bezeichnung"] for a in m["anker"]], ["A–B"])
        self.assertTrue(any(h.startswith("A–C: Punkt-ID 1 abgelehnt") for h in fertig.ergebnis["hinweise"]))

    def test_zu_wenige_bilder(self):
        fertig = self.rechnen({"laser": [LASER_AB]}, bilder=1)
        self.assertEqual(fertig.status, FEHLER)
        self.assertIn("Zu wenige Bilder", fertig.fehler)

    def test_colmap_ohne_rekonstruktion(self):
        self.werkzeuge.mapper_ok = False
        fertig = self.rechnen({"laser": [LASER_AB]}, bilder=3)
        self.assertEqual(fertig.status, FEHLER)
        self.assertIn("keine Rekonstruktion", fertig.fehler)

    def test_werkzeugfehler_landet_im_klartext_und_log(self):
        def kaputt(kommando, cfg, cwd=None):
            return tools.Lauf(kommando=kommando, rueckgabe=1, ausgabe="Kaputt: keine Merkmale")
        with mock.patch.object(tools, "ausfuehren", kaputt):
            fertig = self.rechnen({"laser": [LASER_AB]}, bilder=3)
        self.assertEqual(fertig.status, FEHLER)
        self.assertIn("COLMAP scheiterte", fertig.fehler)
        self.assertIn("keine Merkmale", fertig.fehler)
        log = (self.store.dir(fertig.id) / "werkzeuge.log").read_text(encoding="utf-8")
        self.assertIn("feature_extractor", log)


if __name__ == "__main__":
    unittest.main()
