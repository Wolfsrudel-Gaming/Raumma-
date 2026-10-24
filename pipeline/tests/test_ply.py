"""PLY binär → ASCII für den Betrachter (OpenMVS schreibt binär)."""

import struct
import tempfile
import unittest
from pathlib import Path

from raumwerk_pipeline import ply
from tests import hilfen


class PlyTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.d = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_binaer_mit_normalen_und_flaechen_wird_ascii(self):
        punkte = [(0.5, 1.25, -2.0), (3.0, 4.0, 5.0), (6.5, 7.0, 8.0)]
        quelle = self.d / "szene_dense.ply"
        hilfen.schreibe_binaer_ply(quelle, punkte)
        info = ply.zu_ascii(quelle, self.d / "wolke.ply", kommentare=["Test äöü"])
        self.assertEqual(info, {"punkte": 3, "punkte_original": 3, "ausgeduennt": False})
        text = (self.d / "wolke.ply").read_text(encoding="ascii")
        self.assertTrue(text.startswith("ply\nformat ascii 1.0\ncomment Test ???\n"))
        self.assertIn("element vertex 3\n", text)
        self.assertIn("property uchar red", text)
        self.assertIn("0.5 1.25 -2 0 100 200", text)
        # Zurücklesen ergibt dieselben Punkte.
        pos, farben = ply.lesen(self.d / "wolke.ply")
        self.assertEqual(pos, punkte)
        self.assertEqual(farben[1], (1, 100, 200))

    def test_grosse_wolke_wird_gleichmaessig_ausgeduennt(self):
        punkte = [(float(i), 0.0, 0.0) for i in range(1000)]
        quelle = self.d / "gross.ply"
        hilfen.schreibe_binaer_ply(quelle, punkte, mit_normalen=False)
        info = ply.zu_ascii(quelle, self.d / "wolke.ply", max_punkte=300)
        self.assertEqual(info["punkte_original"], 1000)
        self.assertTrue(info["ausgeduennt"])
        self.assertLessEqual(info["punkte"], 300)
        pos, _ = ply.lesen(self.d / "wolke.ply")
        self.assertEqual(len(pos), info["punkte"])
        self.assertEqual(pos[0][0], 0.0)
        self.assertEqual(pos[1][0], 4.0)                 # jeder 4. Punkt

    def test_big_endian_ohne_farbe(self):
        quelle = self.d / "be.ply"
        kopf = ("ply\nformat binary_big_endian 1.0\nelement vertex 2\n"
                "property double x\nproperty double y\nproperty double z\nend_header\n")
        quelle.write_bytes(kopf.encode() + struct.pack(">dddddd", 1, 2, 3, 4, 5, 6))
        ply.zu_ascii(quelle, self.d / "w.ply")
        pos, farben = ply.lesen(self.d / "w.ply")
        self.assertEqual(pos, [(1.0, 2.0, 3.0), (4.0, 5.0, 6.0)])
        self.assertIsNone(farben)

    def test_abgeschnittene_datei_meldet_fehler(self):
        quelle = self.d / "kaputt.ply"
        hilfen.schreibe_binaer_ply(quelle, [(1.0, 2.0, 3.0)] * 10)
        quelle.write_bytes(quelle.read_bytes()[:-40])
        with self.assertRaises(ply.PlyFehler):
            ply.zu_ascii(quelle, self.d / "w.ply")
        self.assertEqual(list(self.d.glob("w.ply*")), [])   # auch kein .tmp-Rest

    def test_keine_ply(self):
        quelle = self.d / "x.ply"
        quelle.write_text("hallo\n")
        with self.assertRaises(ply.PlyFehler):
            ply.anzahl(quelle)


if __name__ == "__main__":
    unittest.main()
