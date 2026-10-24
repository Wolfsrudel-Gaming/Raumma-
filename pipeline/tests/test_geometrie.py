"""Polygonzug – Spiegel von web/geometrie.js; Parität wird mit node geprüft."""

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from raumwerk_pipeline import geometrie as G

GEOMETRIE_JS = Path(__file__).resolve().parents[2] / "web" / "geometrie.js"

RECHTECK = [{"laenge": 4.2, "drehung": 90}, {"laenge": 3.0, "drehung": 90},
            {"laenge": 4.2, "drehung": 90}, {"laenge": 3.0, "drehung": 90}]
L_FORM = [{"laenge": 5.0, "drehung": 90}, {"laenge": 2.0, "drehung": 90},
          {"laenge": 2.5, "drehung": -90}, {"laenge": 1.5, "drehung": 90},
          {"laenge": 2.5, "drehung": 90}, {"laenge": 3.5, "drehung": 90}]
OFFEN = [{"laenge": 4.2, "drehung": 90}, {"laenge": 3.0, "drehung": 90},
         {"laenge": 4.0, "drehung": 90}]
ERKER = [{"laenge": 3.0, "drehung": 45}, {"laenge": 1.41, "drehung": 45},
         {"laenge": 2.0, "drehung": 90}, {"laenge": 4.0, "drehung": 90},
         {"laenge": 4.0, "drehung": 90}]


class ZugTest(unittest.TestCase):
    def test_rechteck_schliesst(self):
        z = G.zug(RECHTECK)
        self.assertTrue(z["geschlossen"])
        self.assertFalse(z["schlusswandErgaenzt"])
        self.assertLess(z["restluecke"], 1e-9)
        self.assertEqual(z["punkte"], [[0, 0], [4.2, 0], [4.2, 3], [0, 3]])
        self.assertAlmostEqual(G.flaeche_punkte(z["punkte"]), 12.6, places=9)
        self.assertEqual(G.pruefen(z["punkte"]), [])

    def test_l_form(self):
        z = G.zug(L_FORM)
        self.assertTrue(z["geschlossen"])
        self.assertEqual(len(z["punkte"]), 6)
        self.assertAlmostEqual(G.flaeche_punkte(z["punkte"]), 5 * 2 + 2.5 * 1.5, places=6)

    def test_offener_zug_behaelt_letzten_punkt(self):
        z = G.zug(OFFEN)
        self.assertFalse(z["geschlossen"])
        self.assertTrue(z["schlusswandErgaenzt"])
        self.assertEqual(len(z["punkte"]), 4)             # Start + drei Wände
        # Ende bei (0,2 | 3,0): die Schlusswand zurück zum Start ist gerechnet.
        self.assertAlmostEqual(z["restluecke"], (0.2 ** 2 + 3.0 ** 2) ** 0.5, places=9)

    def test_umriss_wie_json_stringify(self):
        # 3 statt 3.0, keine Leerzeichen, nie -0 – exakt wie im Browser.
        self.assertEqual(G.umriss_schreiben([[0.0, -0.0], [4.2, 0], [4.2, 3.0], [0, 3.004]]),
                         "[[0,0],[4.2,0],[4.2,3],[0,3]]")
        # Werte wie node sie liefert: Math.round(1.005*100) = 100 (Gleitkomma),
        # Math.round(2.675*100) = 268, Math.round(4.205*100) = 421.
        self.assertEqual(G.umriss_schreiben([[1.005, 2.675], [4.205, 0]]), "[[1,2.68],[4.21,0]]")

    def test_runden_wie_math_round(self):
        # JS rundet x,5 nach oben; Pythons round() rundet zur geraden Ziffer.
        self.assertEqual(G.normieren([[0.125, 0.0], [0.0, 0.0]])[0][0], 0.13)

    def test_verdrehter_zug_meldet_sich(self):
        kreuz = [[0, 0], [2, 2], [2, 0], [0, 2]]
        self.assertTrue(G.schneidet_sich_selbst(kreuz))
        self.assertTrue(any("kreuzen" in h for h in G.pruefen(kreuz)))


@unittest.skipUnless(shutil.which("node") and GEOMETRIE_JS.exists(),
                     "node oder web/geometrie.js fehlt – Paritätstest übersprungen")
class ParitaetMitJavaScriptTest(unittest.TestCase):
    """Dieselben Züge durch web/geometrie.js und durch den Python-Spiegel."""

    def test_zug_identisch(self):
        faelle = {"rechteck": RECHTECK, "l": L_FORM, "offen": OFFEN, "erker": ERKER}
        skript = (
            f"import * as G from {json.dumps(GEOMETRIE_JS.as_uri())};\n"
            f"const faelle = {json.dumps(faelle)};\n"
            "const aus = {};\n"
            "for (const [k, w] of Object.entries(faelle)) {\n"
            "  const z = G.zug(w);\n"
            "  aus[k] = { ...z, umriss: G.umrissSchreiben(z.punkte),\n"
            "             flaeche: G.flaechePunkte(z.punkte), hinweise: G.pruefen(z.punkte) };\n"
            "}\n"
            "console.log(JSON.stringify(aus));\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            datei = Path(tmp) / "paritaet.mjs"
            datei.write_text(skript, encoding="utf-8")
            lauf = subprocess.run(["node", str(datei)], capture_output=True, text=True, timeout=60)
        self.assertEqual(lauf.returncode, 0, lauf.stderr)
        js = json.loads(lauf.stdout)
        for k, w in faelle.items():
            py = G.zug(w)
            with self.subTest(fall=k):
                self.assertEqual(py["punkte"], js[k]["punkte"])
                self.assertEqual(G.umriss_schreiben(py["punkte"]), js[k]["umriss"])
                self.assertEqual(py["geschlossen"], js[k]["geschlossen"])
                self.assertEqual(py["schlusswandErgaenzt"], js[k]["schlusswandErgaenzt"])
                self.assertAlmostEqual(py["restluecke"], js[k]["restluecke"], places=9)
                self.assertAlmostEqual(G.flaeche_punkte(py["punkte"]), js[k]["flaeche"], places=9)
                self.assertEqual(G.pruefen(py["punkte"]), js[k]["hinweise"])


if __name__ == "__main__":
    unittest.main()
