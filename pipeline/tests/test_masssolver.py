"""Tests des Maß-Solvers – der metrische Maßstab und die konservative Rundung."""

import unittest

from raumwerk_pipeline.masssolver import (
    HINWEIS_EIN_MASS,
    Anker,
    konservativ_m,
    kontrollmass_abweichung_mm,
    massstab_bestimmen,
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


class MassstabBestimmenTest(unittest.TestCase):
    """Ab einer bekannten Länge – kein Würfel, kein Mindestsatz an Lasermaßen."""

    def test_ein_mass_reicht_fuer_den_massstab(self):
        # Nur die Kamerahöhe: 1,45 m entsprechen 5,8 Modelleinheiten.
        m = massstab_bestimmen([Anker(modell=5.8, laenge_m=1.45, quelle="kamerahoehe")])
        self.assertAlmostEqual(m.skala, 0.25, places=9)
        self.assertIsNone(m.kontrolle)
        self.assertIsNone(m.kontrollmass_abweichung_mm)
        self.assertIsNone(m.rms_mm)               # aus einem Anker nicht aussagekräftig
        self.assertIn(HINWEIS_EIN_MASS, m.hinweise)

    def test_zwei_masse_ergeben_massstab_und_kontrollmass(self):
        s = 0.25
        a = Anker(modell=16.8, laenge_m=16.8 * s, bezeichnung="Wand")
        k = Anker(modell=20.0, laenge_m=20.0 * s + 0.004, bezeichnung="Diagonale")
        m = massstab_bestimmen([a, k])
        self.assertAlmostEqual(m.skala, s, places=9)       # nur aus dem ersten
        self.assertIs(m.kontrolle, k)                      # der letzte ist Kontrolle
        self.assertAlmostEqual(m.kontrollmass_abweichung_mm, 4.0, places=6)
        self.assertEqual(m.hinweise, [])

    def test_markiertes_kontrollmass_wird_zurueckgehalten(self):
        s = 0.3
        anker = [
            Anker(modell=10.0, laenge_m=10.0 * s, bezeichnung="A"),
            Anker(modell=12.0, laenge_m=12.0 * s + 0.010, bezeichnung="K", kontrolle=True),
            Anker(modell=8.0, laenge_m=8.0 * s, bezeichnung="B"),
        ]
        m = massstab_bestimmen(anker)
        self.assertEqual(m.kontrolle.bezeichnung, "K")
        self.assertEqual([a.bezeichnung for a in m.verwendet], ["A", "B"])
        self.assertAlmostEqual(m.kontrollmass_abweichung_mm, 10.0, places=6)
        self.assertIsNotNone(m.rms_mm)

    def test_ausreisser_wird_benannt(self):
        s = 0.37
        anker = [Anker(modell=x, laenge_m=x * s, bezeichnung=f"L{x}") for x in (10.0, 8.0, 6.0, 12.0)]
        anker.insert(2, Anker(modell=5.0, laenge_m=5.0 * s * 1.5, bezeichnung="falsch"))
        anker.append(Anker(modell=9.0, laenge_m=9.0 * s, bezeichnung="Kontrolle"))
        m = massstab_bestimmen(anker)
        self.assertEqual([a.bezeichnung for a in m.verworfen], ["falsch"])
        self.assertAlmostEqual(m.skala, s, places=6)
        self.assertTrue(any("falsch" in h for h in m.hinweise))

    def test_ohne_gueltige_laenge_klartext(self):
        with self.assertRaises(ValueError) as e:
            massstab_bestimmen([Anker(modell=0.0, laenge_m=1.0)])
        self.assertIn("Kein bekanntes Maß", str(e.exception))


if __name__ == "__main__":
    unittest.main()
