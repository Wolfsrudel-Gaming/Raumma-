"""Tests des Maß-Solvers – der metrische Maßstab und die konservative Rundung."""

import unittest

from raumwerk_pipeline.masssolver import (
    konservativ_m,
    kontrollmass_abweichung_mm,
    skala_aus_distanzen,
)


class MassSolverTest(unittest.TestCase):
    def test_maßstab_wird_exakt_zurueckgewonnen(self):
        # Modell in willkürlichen Einheiten, wahrer Maßstab 0,37 m/Einheit.
        s_wahr = 0.37
        modell = [10.0, 8.1, 6.75, 13.9]
        anker = [(m, m * s_wahr) for m in modell]
        erg = skala_aus_distanzen(anker)
        self.assertAlmostEqual(erg.skala, s_wahr, places=6)
        self.assertLess(erg.rms_mm, 0.1)

    def test_robust_verwirft_einen_ausreisser(self):
        s = 0.37
        anker = [(m, m * s) for m in (10.0, 8.0, 6.0, 12.0)]
        anker.append((5.0, 5.0 * s * 1.5))   # grob falsch zugeordnet
        erg = skala_aus_distanzen(anker, robust=True)
        self.assertEqual(erg.n_verworfen, 1)
        self.assertAlmostEqual(erg.skala, s, places=4)

    def test_kontrollmass_abweichung(self):
        s = 0.5
        # Modelldistanz 10 -> 5,00 m; Laser sagt 5,03 m -> 30 mm Abweichung.
        self.assertAlmostEqual(kontrollmass_abweichung_mm(s, 10.0, 5.03), 30.0, places=6)

    def test_konservativ_ist_untere_schranke(self):
        self.assertEqual(konservativ_m(2.80), 2.78)
        self.assertEqual(konservativ_m(1.209), 1.18)
        self.assertEqual(konservativ_m(0.01), 0.0)

    def test_leere_anker_werfen(self):
        with self.assertRaises(ValueError):
            skala_aus_distanzen([])


if __name__ == "__main__":
    unittest.main()
