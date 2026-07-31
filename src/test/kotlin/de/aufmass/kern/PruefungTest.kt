package de.aufmass.kern

import java.math.BigDecimal
import java.util.UUID
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Die Normprüfung ist das Alleinstellungsmerkmal (Konzept §8). Diese Tests
 * beschreiben die Fälle, die sie melden muss – und die Leitplanke, dass
 * Freiräume immer als untere Schranke herauskommen.
 */
class PruefungTest {

    private fun nah(erwartet: Double, ist: Double, toleranz: Double = 0.005) =
        assertTrue(abs(erwartet - ist) < toleranz, "erwartet $erwartet, war $ist")

    private fun schrankHinten(raum: Raum, art: String, xM: String, tiefeM: Double): Pruefung.Platzhalter {
        // Mit dem Rücken an die hintere Wand (y = Raumtiefe), Vorderseite in den
        // Raum (Drehung 180° → n zeigt nach -y).
        val ht = tiefeM / 2
        return Pruefung.Platzhalter(
            raumId = raum.id, komponente = art,
            xM = BigDecimal(xM), yM = BigDecimal(raum.tiefeM.toDouble() - ht),
            drehungGrad = BigDecimal("180")
        )
    }

    @Test
    fun `Grundflaeche eines Kloetzchens hat die Katalogmasse`() {
        val raum = Raum(name = "Technik", breiteM = BigDecimal("4"), tiefeM = BigDecimal("3"))
        val komp = Komponenten.finde("ZAEHLERSCHRANK")!!    // 0,60 × 0,20
        val ph = schrankHinten(raum, "ZAEHLERSCHRANK", "2.0", 0.20)
        val e = Pruefung.grundriss(ph, komp)
        assertEquals(4, e.size)
        nah(0.60, abs(e[1].x - e[0].x))    // Breite entlang der Wand
        nah(0.20, abs(e[2].y - e[1].y))    // Tiefe in den Raum
        nah(3.0, e.maxOf { it.y })          // Rücken an der hinteren Wand
    }

    @Test
    fun `genug Platz vor dem Zaehlerschrank ist in Ordnung`() {
        val raum = Raum(name = "Technik", breiteM = BigDecimal("4"), tiefeM = BigDecimal("3"))
        val ph = schrankHinten(raum, "ZAEHLERSCHRANK", "2.0", 0.20)
        val befunde = Pruefung.pruefe(raum, listOf(ph))
        val bedien = befunde.single { it.regelId == "BEDIENBEREICH_VERTEILUNG" }
        assertEquals(Pruefung.Schwere.OK, bedien.schwere)
        // ~2,80 m frei, konservativ 2,78 – jedenfalls über den geforderten 1,20 m.
        assertTrue(bedien.verfuegbarM!! >= BigDecimal("1.20"))
    }

    @Test
    fun `zu wenig Freiraum vor der Verteilung wird gewarnt`() {
        // Flacher Raum: nur 1,20 m tief – der Bedienbereich passt nicht davor.
        val raum = Raum(name = "Nische", breiteM = BigDecimal("4"), tiefeM = BigDecimal("1.20"))
        val ph = schrankHinten(raum, "ZAEHLERSCHRANK", "2.0", 0.20)
        val bedien = Pruefung.pruefe(raum, listOf(ph)).single { it.regelId == "BEDIENBEREICH_VERTEILUNG" }
        assertEquals(Pruefung.Schwere.WARNUNG, bedien.schwere)
        // 1,00 m roh − 2 cm Toleranz, abgerundet = 0,98 m.
        assertEquals(BigDecimal("0.98"), bedien.verfuegbarM)
        assertTrue(bedien.verfuegbarM!! < bedien.erforderlichM)
    }

    @Test
    fun `Freiraum ist immer die untere Schranke`() {
        // Konservativ: gemessen minus Toleranz, auf ganze cm abgerundet.
        assertEquals(BigDecimal("2.78"), Pruefung.konservativ(2.80))
        assertEquals(BigDecimal("1.18"), Pruefung.konservativ(1.209))
        assertEquals(BigDecimal("0.00"), Pruefung.konservativ(0.01))
    }

    @Test
    fun `Waermequelle zu nah an einem Schrank wird gewarnt`() {
        val raum = Raum(name = "Heizraum", breiteM = BigDecimal("4"), tiefeM = BigDecimal("3"))
        val therme = Pruefung.Platzhalter(
            raumId = raum.id, komponente = "THERME",
            xM = BigDecimal("1.0"), yM = BigDecimal("1.0")
        )
        val schrank = Pruefung.Platzhalter(
            raumId = raum.id, komponente = "SCHALTSCHRANK",
            xM = BigDecimal("1.7"), yM = BigDecimal("1.0")
        )
        val befund = Pruefung.pruefe(raum, listOf(therme, schrank))
            .single { it.regelId == "ABSTAND_WAERMEQUELLE" }
        assertEquals(Pruefung.Schwere.WARNUNG, befund.schwere)
        assertTrue(befund.verfuegbarM!! < BigDecimal("0.30"))
        assertTrue(befund.text.contains("Schaltschrank"))
    }

    @Test
    fun `Kabel bekommt einen Biegeradius-Hinweis`() {
        val raum = Raum(name = "Technik", breiteM = BigDecimal("4"), tiefeM = BigDecimal("3"))
        val kabel = Pruefung.Platzhalter(
            raumId = raum.id, komponente = "KABEL_NYM5",       // Ø 13 mm, 15×
            xM = BigDecimal("2.0"), yM = BigDecimal("1.5")
        )
        val hinweis = Pruefung.pruefe(raum, listOf(kabel)).single { it.regelId == "BIEGERADIUS" }
        assertEquals(Pruefung.Schwere.HINWEIS, hinweis.schwere)
        assertTrue(hinweis.text.contains("195 mm"))
    }

    @Test
    fun `jeder Befund traegt die Fassung der Regelbasis`() {
        val raum = Raum(name = "Technik", breiteM = BigDecimal("4"), tiefeM = BigDecimal("3"))
        val ph = schrankHinten(raum, "ZAEHLERSCHRANK", "2.0", 0.20)
        Pruefung.pruefe(raum, listOf(ph)).forEach {
            assertEquals(Regelwerk.version, it.regelVersion)
        }
    }

    @Test
    fun `unbekannte Komponente wird uebersprungen, nicht geworfen`() {
        val raum = Raum(name = "Technik", breiteM = BigDecimal("4"), tiefeM = BigDecimal("3"))
        val ph = Pruefung.Platzhalter(
            raumId = raum.id, komponente = "GIBTESNICHT",
            xM = BigDecimal("2.0"), yM = BigDecimal("1.5")
        )
        assertEquals(emptyList(), Pruefung.pruefe(raum, listOf(ph)))
    }
}
