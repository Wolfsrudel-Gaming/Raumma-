"""Modellabstände aus der Rekonstruktion lesen – Text- und Binärformat von COLMAP."""

import math
import tempfile
import unittest
from pathlib import Path

from raumwerk_pipeline import modell
from tests import hilfen


def _abstand_m(a, b):
    return math.dist(hilfen.ECKEN_M[a], hilfen.ECKEN_M[b])


class ModellLesenTest(unittest.TestCase):
    def _beide_formate(self):
        for schreiben in (hilfen.schreibe_modell_txt, hilfen.schreibe_modell_bin):
            tmp = tempfile.TemporaryDirectory()
            self.addCleanup(tmp.cleanup)
            d = Path(tmp.name) / "sparse"
            schreiben(d / "0")
            yield schreiben.__name__, modell.laden(modell.finden(d))

    def test_punkte_und_kamerazentren(self):
        for fmt, m in self._beide_formate():
            with self.subTest(format=fmt):
                self.assertEqual(len(m.punkte), 8)
                self.assertEqual(sorted(m.bilder), sorted(hilfen.KAMERAS_M))
                for name, c_m in hilfen.KAMERAS_M.items():
                    erwartet = hilfen.ins_modell(c_m)
                    for k in range(3):
                        self.assertAlmostEqual(m.bilder[name].zentrum[k], erwartet[k], places=9)
                # Nicht rekonstruierte Merkmale (ID −1) werden nicht übernommen.
                self.assertEqual([b[2] for b in m.bilder["IMG_001.jpg"].beobachtungen], [1, 2, 3])
                self.assertEqual(m.bilder["IMG_002.jpg"].beobachtungen, [])

    def test_abstand_ueber_punkt_ids_ist_metrisch_nach_skalierung(self):
        for fmt, m in self._beide_formate():
            with self.subTest(format=fmt):
                d = modell.modell_abstand({"modell_a": {"punkt3d": 1}, "modell_b": 2}, m)
                self.assertAlmostEqual(d * hilfen.S_WAHR, 4.2, places=9)

    def test_abstand_ueber_bildpunkte(self):
        _, m = next(self._beide_formate())
        eintrag = {"modell_a": {"bild": "IMG_001.jpg", "px": [103, 198]},
                   "modell_b": {"bild": "bilder/IMG_001.jpg", "px": [518, 604]}}
        d = modell.modell_abstand(eintrag, m)
        self.assertAlmostEqual(d * hilfen.S_WAHR, _abstand_m(1, 3), places=9)

    def test_abstand_ueber_koordinaten_braucht_kein_modell(self):
        a, b = hilfen.ins_modell((0, 0, 0)), hilfen.ins_modell((0, 3.0, 0))
        d = modell.modell_abstand({"modell_a": list(a), "modell_b": list(b)}, None)
        self.assertAlmostEqual(d * hilfen.S_WAHR, 3.0, places=9)

    def test_kamerahoehe_ueber_bodenpunkten(self):
        _, m = next(self._beide_formate())
        eintrag = {"art": "kamerahoehe", "laenge": 1.45, "boden": [1, 2, 3, 4]}
        self.assertAlmostEqual(modell.modell_abstand(eintrag, m) * hilfen.S_WAHR, 1.45, places=9)
        eintrag["bild"] = "IMG_003.jpg"
        self.assertAlmostEqual(modell.modell_abstand(eintrag, m) * hilfen.S_WAHR, 1.45, places=9)

    def test_fehler_im_klartext_statt_schaetzung(self):
        _, m = next(self._beide_formate())
        faelle = [
            ({"modell_a": 1, "modell_b": 99}, "Punkt-ID 99"),
            ({"modell_a": {"bild": "IMG_001.jpg", "px": [90, 610]}, "modell_b": 1}, "kein rekonstruierter"),
            ({"modell_a": {"bild": "FEHLT.jpg", "px": [1, 1]}, "modell_b": 1}, "nicht rekonstruiert"),
            ({"modell_a": "Ecke A", "modell_b": 1}, "nicht lesbar"),
            ({"modell_a": 1}, "Keine Modellpunkte"),
            ({"art": "kamerahoehe", "boden": [1, 2, 1]}, "Linie"),
            ({"modell_a": 1, "modell_b": 1}, "derselbe Punkt"),
        ]
        for eintrag, text in faelle:
            with self.subTest(text=text):
                with self.assertRaises(modell.ModellFehler) as e:
                    modell.modell_abstand(eintrag, m)
                self.assertIn(text, str(e.exception))

    def test_hat_modellbezug(self):
        self.assertTrue(modell.hat_modellbezug({"modell_a": 1, "modell_b": 2}))
        self.assertTrue(modell.hat_modellbezug({"art": "kamerahoehe", "boden": [1, 2, 3]}))
        self.assertFalse(modell.hat_modellbezug({"distanzM": 4.2}))
        self.assertFalse(modell.hat_modellbezug({"art": "kamerahoehe", "laenge": 1.45}))

    def test_ebene_schraeg_im_raum(self):
        pts = [hilfen.ins_modell(p) for p in [(0, 0, 0), (4, 0, 0), (4, 3, 0), (0, 3, 0), (2, 1, 0)]]
        c, n = modell.ebene(pts)
        oben = hilfen.ins_modell((1, 1, 1))
        h = abs(sum((oben[k] - c[k]) * n[k] for k in range(3)))
        self.assertAlmostEqual(h * hilfen.S_WAHR, 1.0, places=9)

    def test_kein_modell_gefunden(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(modell.finden(Path(tmp)))


if __name__ == "__main__":
    unittest.main()
