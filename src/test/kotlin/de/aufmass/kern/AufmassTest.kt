package de.aufmass.kern

import java.math.BigDecimal
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AufmassTest {

    private fun nah(erwartet: Double, ist: Double, toleranz: Double = 0.005) =
        assertTrue(abs(erwartet - ist) < toleranz, "erwartet $erwartet, war $ist")

    @Test
    fun `vier Waende mit rechten Winkeln ergeben ein Rechteck`() {
        val zug = Aufmass.zug(
            listOf(
                Aufmass.Wand(6.0, 90.0), Aufmass.Wand(4.0, 90.0),
                Aufmass.Wand(6.0, 90.0), Aufmass.Wand(4.0, 90.0)
            )
        )
        assertTrue(zug.geschlossen)
        assertFalse(zug.schlusswandErgaenzt)
        assertEquals(4, zug.punkte.size)
        assertEquals(Punkt(0.0, 0.0), zug.punkte[0])
        assertEquals(Punkt(6.0, 0.0), zug.punkte[1])
        assertEquals(Punkt(6.0, 4.0), zug.punkte[2])
        nah(24.0, Aufmass.flaeche(zug.punkte))
    }

    @Test
    fun `eine Nische entsteht durch eine Drehung nach links`() {
        // 6,00 rechts / 2,00 rechts / 0,80 LINKS / 2,00 rechts / 5,20 rechts / 4,00 rechts
        val zug = Aufmass.zug(
            listOf(
                Aufmass.Wand(6.0, 90.0), Aufmass.Wand(2.0, 90.0), Aufmass.Wand(0.8, -90.0),
                Aufmass.Wand(2.0, 90.0), Aufmass.Wand(5.2, 90.0), Aufmass.Wand(4.0, 90.0)
            )
        )
        assertTrue(zug.geschlossen)
        assertEquals(6, zug.punkte.size)
        nah(22.4, Aufmass.flaeche(zug.punkte))
        assertTrue(Aufmass.pruefen(zug.punkte).isEmpty())
    }

    @Test
    fun `die letzte Wand darf fehlen und wird ergaenzt`() {
        // Nur drei Wände eines Rechtecks eingegeben – die vierte ergibt sich.
        val zug = Aufmass.zug(
            listOf(Aufmass.Wand(6.0, 90.0), Aufmass.Wand(4.0, 90.0), Aufmass.Wand(6.0, 90.0))
        )
        assertTrue(zug.schlusswandErgaenzt)
        nah(4.0, zug.restlueckeM)
        assertEquals(4, zug.punkte.size)
        nah(24.0, Aufmass.flaeche(zug.punkte))
    }

    @Test
    fun `ein Messfehler zeigt sich als Restluecke`() {
        // Eine Wand um 30 cm zu kurz gemessen.
        val zug = Aufmass.zug(
            listOf(
                Aufmass.Wand(6.0, 90.0), Aufmass.Wand(4.0, 90.0),
                Aufmass.Wand(5.7, 90.0), Aufmass.Wand(4.0, 90.0)
            )
        )
        assertFalse(zug.geschlossen)
        nah(0.3, zug.restlueckeM)
    }

    @Test
    fun `Umriss und Wandliste lassen sich ineinander umrechnen`() {
        val punkte = listOf(
            Punkt(0.0, 0.0), Punkt(6.0, 0.0), Punkt(6.0, 2.0),
            Punkt(5.2, 2.0), Punkt(5.2, 4.0), Punkt(0.0, 4.0)
        )
        val waende = Aufmass.waende(punkte)
        assertEquals(6, waende.size)
        nah(6.0, waende[0].laengeM)
        nah(90.0, waende[0].drehungGrad)
        nah(0.8, waende[2].laengeM)
        nah(-90.0, waende[2].drehungGrad)     // die Nische dreht nach links
        // Zurückgerechnet muss derselbe Umriss herauskommen.
        assertEquals(punkte, Aufmass.zug(waende).punkte)
    }

    @Test
    fun `schiefe Waende sind erlaubt`() {
        val zug = Aufmass.zug(
            listOf(
                Aufmass.Wand(4.0, 90.0), Aufmass.Wand(3.0, 45.0),
                Aufmass.Wand(2.83, 45.0), Aufmass.Wand(2.0, 90.0)
            )
        )
        assertEquals(5, zug.punkte.size)
        assertTrue(Aufmass.flaeche(zug.punkte) > 10.0)
    }

    @Test
    fun `Pruefen meldet Tippfehler statt zu werfen`() {
        val winzig = listOf(Punkt(0.0, 0.0), Punkt(6.0, 0.0), Punkt(6.0, 0.01), Punkt(0.0, 4.0))
        val hinweise = Aufmass.pruefen(winzig)
        assertTrue(hinweise.any { it.contains("Tippfehler") }, hinweise.toString())
    }

    @Test
    fun `sich kreuzende Waende werden erkannt`() {
        // Eine Acht statt eines Raumes – entsteht, wenn eine Drehung falsch herum ist.
        val acht = listOf(Punkt(0.0, 0.0), Punkt(4.0, 4.0), Punkt(4.0, 0.0), Punkt(0.0, 4.0))
        assertTrue(Aufmass.schneidetSichSelbst(acht))
        assertTrue(Aufmass.pruefen(acht).any { it.contains("kreuzen") })
    }

    // ------------------------------------------------------ Aufmaßliste

    @Test
    fun `Aufmassliste liest Nummer, Name und Masse`() {
        val zeilen = Aufmass.listeLesen(
            """
            # Erdgeschoss
            0.01; Flur; 2 x 8
            0.02; Schulungsraum; 4/6 x 5 rechts
            Küche; 3,5 × 4
            """.trimIndent()
        )
        assertEquals(3, zeilen.size)
        assertEquals("0.01", zeilen[0].nummer)
        assertEquals("Flur", zeilen[0].name)
        nah(2.0, zeilen[0].breiteM)
        nah(8.0, zeilen[0].tiefeM)
        assertNull(zeilen[0].breiteVorneM)

        nah(4.0, zeilen[1].breiteVorneM!!)
        nah(6.0, zeilen[1].breiteM)
        assertEquals(Schraege.RECHTS, zeilen[1].schraege)

        assertEquals("", zeilen[2].nummer)              // Nummer darf fehlen
        nah(3.5, zeilen[2].breiteM)                     // Komma als Dezimaltrennzeichen
    }

    @Test
    fun `unbrauchbare Zeilen werden uebersprungen, nicht geraten`() {
        assertNull(Aufmass.zeileLesen("hier stehen keine Maße"))
        assertNull(Aufmass.zeileLesen(""))
        assertNull(Aufmass.zeileLesen("# nur ein Kommentar"))
    }

    @Test
    fun `fast rechte Winkel werden rechtwinklig, schiefe bleiben`() {
        val roh = listOf(
            Aufmass.Wand(5.02, 88.7), Aufmass.Wand(3.98, 91.5), Aufmass.Wand(2.0, 135.0),
            Aufmass.Wand(4.97, -89.6), Aufmass.Wand(4.01, 3.0)
        )
        val glatt = Aufmass.rechtwinklig(roh)
        assertEquals(listOf(90.0, 90.0, 135.0, -90.0, 0.0), glatt.map { it.drehungGrad })
        assertEquals(roh.map { it.laengeM }, glatt.map { it.laengeM })     // Längen bleiben
        // Mit enger Toleranz bleibt die 91,5°-Ecke stehen.
        assertEquals(91.5, Aufmass.rechtwinklig(roh, 1.0)[1].drehungGrad)
    }

    @Test
    fun `Ausgleich schliesst den Zug und laesst gemessene Waende stehen`() {
        // Wände 1 und 2 mit dem Bandmaß (6,00 / 4,00), 3 und 4 gezielt.
        val skizze = listOf(
            Aufmass.Wand(6.00, 90.0), Aufmass.Wand(4.00, 90.0),
            Aufmass.Wand(5.88, 90.0), Aufmass.Wand(4.09, 90.0)
        )
        val a = Aufmass.ausgleichen(skizze, setOf(0, 1))
        nah(0.15, a.restlueckeVorherM)
        nah(0.0, a.restlueckeNachherM, 1e-9)
        assertEquals(6.00, a.waende[0].laengeM)
        assertEquals(4.00, a.waende[1].laengeM)
        nah(6.00, a.waende[2].laengeM, 1e-9)
        nah(4.00, a.waende[3].laengeM, 1e-9)
        nah(0.12, a.korrekturM[2], 1e-9)
        nah(-0.09, a.korrekturM[3], 1e-9)
        assertTrue(Aufmass.zug(a.waende).geschlossen)
    }

    @Test
    fun `parallele freie Waende schliessen nur ihren Anteil der Luecke`() {
        // Die festen Seitenwände widersprechen sich (4,00 / 4,05): diese 5 cm
        // kann keine Längs-Wand schließen – sie bleiben als Restlücke sichtbar.
        val a = Aufmass.ausgleichen(
            listOf(
                Aufmass.Wand(6.0, 90.0), Aufmass.Wand(4.0, 90.0),
                Aufmass.Wand(5.9, 90.0), Aufmass.Wand(4.05, 90.0)
            ),
            setOf(1, 3)
        )
        nah(5.95, a.waende[0].laengeM, 1e-9)
        nah(5.95, a.waende[2].laengeM, 1e-9)
        nah(0.05, a.restlueckeNachherM, 1e-9)
    }

    @Test
    fun `fast parallele freie Waende lassen den Queranteil als Restluecke stehen`() {
        // Trapez mit 1,9° Schräge, Bandmaß vorne 4,02 / hinten 4,10. Die volle
        // Inverse drückte die 2 cm mit 1/sin α in die Seitenwände (3,00 → 2,40).
        val a = Aufmass.ausgleichen(
            listOf(
                Aufmass.Wand(4.02, 90.0), Aufmass.Wand(3.0, 90.0),
                Aufmass.Wand(4.10, 91.91), Aufmass.Wand(3.0017, 88.09)
            ),
            setOf(0, 2)
        )
        nah(3.0, a.waende[1].laengeM, 0.002)
        nah(3.0017, a.waende[3].laengeM, 0.002)
        nah(0.02, a.restlueckeNachherM, 0.001)
    }

    @Test
    fun `deutlich schiefe freie Waende schliessen weiterhin voll`() {
        val a = Aufmass.ausgleichen(
            listOf(
                Aufmass.Wand(4.02, 90.0), Aufmass.Wand(3.0, 90.0),
                Aufmass.Wand(5.0919, 110.0), Aufmass.Wand(3.1925, 70.0)
            ),
            setOf(0, 2)
        )
        nah(0.0, a.restlueckeNachherM, 1e-9)
        nah(-0.055, a.korrekturM[1], 0.001)
        nah(-0.0585, a.korrekturM[3], 0.001)
    }

    @Test
    fun `Pseudo-Inverse nimmt bei fast singulaerer Matrix nur den Haupt-Eigenvektor`() {
        val r1 = Aufmass.pseudoInverse(1.0, 0.0, 1e-4)
        nah(1.0, r1.first, 1e-12)
        nah(0.0, r1.second, 1e-12)
        nah(0.0, r1.third, 1e-12)      // nicht 1/λ_klein = 10⁴
        val c = kotlin.math.cos(Math.PI / 6)
        val s = kotlin.math.sin(Math.PI / 6)
        val p = Aufmass.pseudoInverse(c * c, c * s, s * s)
        nah(c * c, p.first, 1e-12)
        nah(c * s, p.second, 1e-12)
        nah(s * s, p.third, 1e-12)
    }

    @Test
    fun `ohne feste Waende wird ein L-Raum mit kleinsten Aenderungen geschlossen`() {
        val skizze = listOf(
            Aufmass.Wand(5.03, 90.0), Aufmass.Wand(4.02, 90.0), Aufmass.Wand(2.96, 90.0),
            Aufmass.Wand(2.48, -90.0), Aufmass.Wand(2.01, 90.0), Aufmass.Wand(1.53, 90.0)
        )
        val a = Aufmass.ausgleichen(skizze)
        nah(0.0, a.restlueckeNachherM, 1e-9)
        assertTrue(a.korrekturM.all { abs(it) < 0.03 }, "Korrekturen klein: ${a.korrekturM}")
        nah(15.0, Aufmass.flaeche(Aufmass.zug(a.waende).punkte), 0.25)   // 5×4 − 2×2,5
    }
}

class PlatzierungTest {

    @Test
    fun `Raum rechts an den Nachbarn anlegen`() {
        val flur = Raum(name = "Flur", breiteM = BigDecimal("2"), tiefeM = BigDecimal("8"),
            xM = BigDecimal("1"), yM = BigDecimal("1"))
        val raum = Raum(name = "Schulung", breiteM = BigDecimal("6"), tiefeM = BigDecimal("5"))
        val gesetzt = Platzierung.anlegen(raum, flur, Platzierung.Seite.RECHTS)
        assertEquals(BigDecimal("3.00"), gesetzt.xM)   // 1 + 2 m Flurbreite
        assertEquals(BigDecimal("1.00"), gesetzt.yM)
    }

    @Test
    fun `mittig anlegen zentriert an der gemeinsamen Wand`() {
        val halle = Raum(name = "Halle", breiteM = BigDecimal("8"), tiefeM = BigDecimal("10"),
            xM = BigDecimal.ZERO, yM = BigDecimal.ZERO)
        val nische = Raum(name = "Abstell", breiteM = BigDecimal("2"), tiefeM = BigDecimal("2"))
        val gesetzt = Platzierung.anlegen(nische, halle, Platzierung.Seite.DAHINTER,
            Platzierung.Buendig.MITTE)
        assertEquals(BigDecimal("3.00"), gesetzt.xM)   // (8 - 2) / 2
        assertEquals(BigDecimal("10.00"), gesetzt.yM)
    }

    @Test
    fun `Einrasten springt auf die Kante des Nachbarn`() {
        val a = Raum(name = "A", breiteM = BigDecimal("4"), tiefeM = BigDecimal("3"),
            xM = BigDecimal.ZERO, yM = BigDecimal.ZERO)
        val b = Raum(name = "B", breiteM = BigDecimal("3"), tiefeM = BigDecimal("3"))
        // 12 cm neben der rechten Kante von A losgelassen → rastet auf 4,00 ein.
        val (x, y) = Platzierung.einrasten(b, 4.12, 0.06, listOf(a))
        assertEquals(4.0, x)
        assertEquals(0.0, y)
    }

    @Test
    fun `ohne Nachbarn gilt das Raster`() {
        val b = Raum(name = "B")
        val (x, _) = Platzierung.einrasten(b, 3.61, 0.0, emptyList())
        assertEquals(3.5, x)      // 25-cm-Raster
    }

    @Test
    fun `Geschosse stapeln sich ueber der hoechsten Decke darunter`() {
        val eg = Raum(name = "Halle", geschoss = 0, hoeheM = BigDecimal("4.00"))
        val og = Raum(name = "Büro", geschoss = 1, hoeheM = BigDecimal("2.50"))
        val ug = Raum(name = "Keller", geschoss = -1, hoeheM = BigDecimal("2.20"))
        val basis = Platzierung.geschossBasis(listOf(eg, og, ug))
        assertEquals(0.0, basis[0])
        assertEquals(4.30, basis[1])          // 4,00 Raumhöhe + 0,30 Decke
        assertEquals(-2.50, basis[-1])        // 2,20 + 0,30 nach unten
    }
}
