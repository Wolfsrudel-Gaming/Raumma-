"""End-to-end-Test der Pipeline im Simulationsmodus – ohne COLMAP/OpenMVS."""

import tempfile
import unittest
from pathlib import Path

from raumwerk_pipeline.config import Config
from raumwerk_pipeline.jobs import FERTIG, JobStore
from raumwerk_pipeline.pipeline import run_job
from raumwerk_pipeline.worker import Worker


def _cfg(tmp) -> Config:
    return Config(daten_dir=Path(tmp), simulieren=True).vorbereiten()


DEMO_EINGABE = {
    "laser": [
        {"distanzM": 4.20}, {"distanzM": 3.00}, {"distanzM": 2.50},
        {"distanzM": 5.15}, {"distanzM": 5.16},
    ],
    "tags": [{"art": "ZAEHLERSCHRANK"}, {"art": "KABEL_NYM5"}],
}


class PipelineTest(unittest.TestCase):
    def test_lauf_liefert_massstab_und_artefakte(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _cfg(tmp)
            store = JobStore(cfg)
            job = store.neu("Test", DEMO_EINGABE)
            run_job(job, store, cfg)

            fertig = store.laden(job.id)
            self.assertEqual(fertig.status, FERTIG)
            self.assertEqual(fertig.fortschritt, 1.0)

            # Maßstab ~ 0,37 m/Einheit zurückgewonnen (mit etwas Rauschen).
            skala = fertig.ergebnis["massstab"]["skala_m_je_einheit"]
            self.assertAlmostEqual(skala, 0.37, delta=0.03)
            self.assertIn("kontrollmass_abweichung_mm", fertig.ergebnis["massstab"])

            # Artefakte liegen auf der Platte.
            jobdir = store.dir(job.id)
            self.assertTrue((jobdir / "wolke.ply").exists())
            self.assertTrue((jobdir / "massstab.json").exists())
            self.assertTrue((jobdir / "result.json").exists())

            # Komponenten-Zuordnung und Semantik haben gegriffen.
            self.assertEqual(fertig.ergebnis["komponenten"]["zugeordnet"], 2)
            self.assertEqual(fertig.ergebnis["semantik"]["befunde"], 1)
            self.assertEqual(fertig.ergebnis["modus"], "simulation")

    def test_hochgeladene_bilder_werden_gezaehlt(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _cfg(tmp)
            store = JobStore(cfg)
            job = store.neu("Mit Bildern", DEMO_EINGABE)
            (store.bilder_dir(job.id) / "a.jpg").write_bytes(b"x")
            (store.bilder_dir(job.id) / "b.jpg").write_bytes(b"y")
            run_job(job, store, cfg)
            self.assertEqual(store.laden(job.id).ergebnis["sfm"]["bilder"], 2)

    def test_fehlende_laser_setzen_job_auf_fehler(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _cfg(tmp)
            store = JobStore(cfg)
            job = store.neu("Ohne Laser", {"laser": [], "tags": []})
            run_job(job, store, cfg)
            self.assertEqual(store.laden(job.id).status, "fehler")

    def test_einzelner_worker_arbeitet_beide_jobs_ab(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _cfg(tmp)
            store = JobStore(cfg)
            a = store.neu("A", DEMO_EINGABE)
            b = store.neu("B", DEMO_EINGABE)
            worker = Worker(store, cfg).start()
            worker.einreihen(a.id)
            worker.einreihen(b.id)
            self.assertTrue(worker.leerlauf(timeout=15))
            worker.stop()
            self.assertEqual(store.laden(a.id).status, FERTIG)
            self.assertEqual(store.laden(b.id).status, FERTIG)


if __name__ == "__main__":
    unittest.main()
