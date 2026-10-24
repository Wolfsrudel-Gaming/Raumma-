"""Werkzeug-Erkennung: nur COLMAP + OpenMVS entscheiden über echt/Simulation."""

import unittest
from unittest import mock

from raumwerk_pipeline import stages, tools
from raumwerk_pipeline.config import Config


def _which(vorhanden):
    return lambda name: f"/usr/bin/{name}" if name in vorhanden else None


class ToolsTest(unittest.TestCase):
    def test_cloudcompare_ist_nicht_noetig(self):
        with mock.patch.object(tools.shutil, "which",
                               _which({"colmap", "InterfaceCOLMAP", "DensifyPointCloud"})):
            self.assertTrue(tools.alle_vorhanden())
            self.assertFalse(tools.vorhanden()["cloudcompare"])
            self.assertFalse(stages.simuliert(Config(simulieren=None)))

    def test_ohne_interface_colmap_simulation(self):
        with mock.patch.object(tools.shutil, "which", _which({"colmap", "DensifyPointCloud"})):
            self.assertFalse(tools.alle_vorhanden())
            self.assertTrue(stages.simuliert(Config(simulieren=None)))

    def test_erzwungener_modus_gewinnt(self):
        with mock.patch.object(tools.shutil, "which", _which(set())):
            self.assertFalse(stages.simuliert(Config(simulieren=False)))

    def test_kommandos_enthalten_text_export_und_entzerrung(self):
        colmap = tools.colmap_kommandos("/j/bilder", "/j")
        self.assertEqual(colmap[-1][:2], ["colmap", "model_converter"])
        self.assertIn("TXT", colmap[-1])
        dichte = tools.dichte_kommandos("/j/bilder", "/j")
        self.assertEqual(dichte[0][:2], ["colmap", "image_undistorter"])
        self.assertEqual([k[0] for k in dichte[1:]], ["InterfaceCOLMAP", "DensifyPointCloud"])
        self.assertIn("/j/szene.mvs", dichte[2])

    def test_fehlendes_binary_wird_rueckgabe_statt_absturz(self):
        lauf = tools.ausfuehren(["gibt-es-nicht-raumwerk"], Config())
        self.assertNotEqual(lauf.rueckgabe, 0)


if __name__ == "__main__":
    unittest.main()
