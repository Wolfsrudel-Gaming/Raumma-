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

    def test_abstand_ueber_bildpunkte_ist_metrisch_nach_skalierung(self):
        for fmt, m in self._beide_formate():
            with self.subTest(format=fmt):
                d = modell.modell_abstand({"modell_a": hilfen.bildpunkt(1),
                                           "modell_b": hilfen.bildpunkt(2)}, m)
                self.assertAlmostEqual(d * hilfen.S_WAHR, 4.2, places=9)

    def test_abstand_ueber_bildpunkte(self):
        _, m = next(self._beide_formate())
        eintrag = {"modell_a": {"bild": "IMG_001.jpg", "px": [103, 198]},
                   "modell_b": {"bild": "bilder/IMG_001.jpg", "px": [518, 604]}}
        d = modell.modell_abstand(eintrag, m)
        self.assertAlmostEqual(d * hilfen.S_WAHR, _abstand_m(1, 3), places=9)

    def test_punkt_ids_und_koordinaten_werden_abgelehnt(self):
        _, m = next(self._beide_formate())
        a, b = list(m.punkte[1]), list(m.punkte[2])      # passen (noch) genau zu diesem Modell
        faelle = [
            ({"modell_a": 1, "modell_b": 2}, "Punkt-ID 1 abgelehnt"),
            ({"modell_a": {"punkt3d": 1}, "modell_b": hilfen.bildpunkt(2)}, "Punkt-ID 1 abgelehnt"),
            ({"modell_a": hilfen.bildpunkt(1), "modell_b": b}, "Modellkoordinaten"),
            ({"modell_a": a, "modell_b": b}, "Modellkoordinaten"),
            ({"art": "kamerahoehe", "boden": [1, 2, 3]}, "Punkt-ID 1 abgelehnt"),
        ]
        for eintrag, text in faelle:
            with self.subTest(text=text, eintrag=eintrag):
                for pruefung in (lambda: modell.modell_abstand(eintrag, m),
                                 lambda: modell.bezug_pruefen(eintrag)):   # früh, ohne Modell
                    with self.assertRaises(modell.ModellFehler) as e:
                        pruefung()
                    self.assertIn(text, str(e.exception))
                    self.assertIn("Bildpunkt {bild, px} angeben", str(e.exception))
        modell.bezug_pruefen({"modell_a": hilfen.bildpunkt(1), "modell_b": hilfen.bildpunkt(2)})

    def test_nur_bildpunkte_ueberstehen_eine_neue_rekonstruktion(self):
        """
        Regression: Jeder Lauf (auch /start) rekonstruiert neu – andere Lage,
        anderer Maßstab, andere Punkt-IDs. ID 1/2 oder die Koordinaten aus Lauf 1
        gibt es in Lauf 2 meist noch, nur als andere Punkte: Der Maßstab war still
        um Faktor 1,4 bzw. 0,81 falsch. Bildpunkte treffen in jedem Lauf dieselbe Ecke.
        """
        pixel = {ecke: (100.0 * ecke, 40.0 * ecke) for ecke in hilfen.ECKEN_M}

        def lauf(s, winkel, ids):
            c, si = math.cos(winkel), math.sin(winkel)
            m = modell.SparseModell()
            beob = []
            for ecke, pid in zip(hilfen.ECKEN_M, ids):
                x, y, z = (v / s for v in hilfen.ECKEN_M[ecke])
                m.punkte[pid] = (c * x - si * y + 5, si * x + c * y - 2, z + 1)
                beob.append((*pixel[ecke], pid))
            m.bilder["IMG_001.jpg"] = modell.Bild("IMG_001.jpg", (0.0, 0.0, 0.0), beob)
            return m

        lauf1 = lauf(0.25, 0.3, [1, 2, 3, 4, 5, 6, 7, 8])
        lauf2 = lauf(0.31, 1.1, [4, 1, 7, 2, 8, 3, 6, 5])
        bildpunkte = {"modell_a": {"bild": "IMG_001.jpg", "px": list(pixel[1])},
                      "modell_b": {"bild": "IMG_001.jpg", "px": list(pixel[2])}}
        for m, s in ((lauf1, 0.25), (lauf2, 0.31)):
            self.assertAlmostEqual(modell.modell_abstand(bildpunkte, m) * s, 4.2, places=9)
        # Was ein Bearbeiter aus Lauf 1 abgeschrieben hätte: in Lauf 2 abgelehnt,
        # obwohl ID 1 und 2 dort existieren.
        for alt in ({"modell_a": {"punkt3d": 1}, "modell_b": {"punkt3d": 2}},
                    {"modell_a": list(lauf1.punkte[1]), "modell_b": list(lauf1.punkte[2])}):
            self.assertTrue({1, 2} <= set(lauf2.punkte))
            with self.assertRaises(modell.ModellFehler):
                modell.modell_abstand(alt, lauf2)

    def test_kamerahoehe_ueber_bodenpunkten(self):
        _, m = next(self._beide_formate())
        eintrag = {"art": "kamerahoehe", "laenge": 1.45,
                   "boden": [hilfen.bildpunkt(1), hilfen.bildpunkt(2), hilfen.bildpunkt(3)]}
        self.assertAlmostEqual(modell.modell_abstand(eintrag, m) * hilfen.S_WAHR, 1.45, places=9)
        eintrag["bild"] = "IMG_003.jpg"
        self.assertAlmostEqual(modell.modell_abstand(eintrag, m) * hilfen.S_WAHR, 1.45, places=9)

    def test_fehler_im_klartext_statt_schaetzung(self):
        _, m = next(self._beide_formate())
        p1, p2 = hilfen.bildpunkt(1), hilfen.bildpunkt(2)
        faelle = [
            ({"modell_a": {"bild": "IMG_001.jpg", "px": [90, 610]}, "modell_b": p1}, "kein rekonstruierter"),
            ({"modell_a": {"bild": "FEHLT.jpg", "px": [1, 1]}, "modell_b": p1}, "nicht rekonstruiert"),
            ({"modell_a": {"bild": "IMG_001.jpg", "px": "mitte"}, "modell_b": p1}, "px muss"),
            ({"modell_a": "Ecke A", "modell_b": p1}, "nicht lesbar"),
            ({"modell_a": p1}, "Keine Modellpunkte"),
            ({"art": "kamerahoehe", "boden": [p1, p2, p1]}, "Linie"),
            ({"modell_a": p1, "modell_b": p1}, "derselbe Punkt"),
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
