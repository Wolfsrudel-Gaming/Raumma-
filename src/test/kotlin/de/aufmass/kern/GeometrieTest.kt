package de.aufmass.kern

import java.math.BigDecimal
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Die Tests beschreiben die Fälle, die beim Aufmaß tatsächlich auftreten.
 * Sie sind zugleich die kürzeste Erklärung, was der Kern tut – wer das Paket
 * übernimmt, liest sie am besten direkt nach der README.
 */
class GeometrieTest {

    private fun nah(erwartet: Double, ist: Double, toleranz: Double = 0.005) =
        assertTrue(abs(erwartet - ist) < toleranz, "erwartet $erwartet, war $ist")

    @Test
    fun `Rechteck aus Breite und Tiefe`() {
        val r = Raum(name = "Büro", breiteM = BigDecimal("3"), tiefeM = BigDecimal("4"))
        assertEquals(4, Geometrie.ecken(r).size)
        nah(12.0, Geometrie.flaecheM2(r))
        assertEquals(listOf(3.0, 4.0, 3.0, 4.0), Geometrie.wandLaengen(r).map { Math.round(it * 100.0) / 100.0 })
        assertEquals("vorne", Geometrie.wandName(r, 0))
        assertEquals("links", Geometrie.wandName(r, 3))
    }

    @Test
    fun `Trapez rechnet mit der Mittellinie, nicht mit der breitesten Stelle`() {
        // Vorne 4 m, hinten 6 m, 5 m tief: (4+6)/2 * 5 = 25 m², nicht 30 m².
        val r = Raum(
            name = "Werkstatt",
            breiteM = BigDecimal("6"), breiteVorneM = BigDecimal("4"),
            tiefeM = BigDecimal("5"), schraege = Schraege.RECHTS
        )
        nah(25.0, Geometrie.flaecheM2(r))
        val e = Geometrie.ecken(r)
        assertEquals(Punkt(0.0, 0.0), e[0])
        assertEquals(Punkt(4.0, 0.0), e[1])   // vordere Wand links bündig
        assertEquals(Punkt(6.0, 5.0), e[2])
    }

    @Test
    fun `bei schraeger linker Wand enden beide Waende rechts buendig`() {
        val r = Raum(
            name = "Dachraum",
            breiteM = BigDecimal("6"), breiteVorneM = BigDecimal("4"),
            tiefeM = BigDecimal("5"), schraege = Schraege.LINKS
        )
        val e = Geometrie.ecken(r)
        assertEquals(Punkt(2.0, 0.0), e[0])
        assertEquals(Punkt(6.0, 0.0), e[1])
    }

    @Test
    fun `Verkofferung neben der Tuer verkleinert die Flaeche`() {
        // 6 x 4 m, davon 0,80 x 2,00 m Verkofferung → 24 - 1,6 = 22,4 m².
        val r = Raum(
            name = "Gruppenraum",
            breiteM = BigDecimal("6"), tiefeM = BigDecimal("4"),
            umriss = "[[0,0],[6,0],[6,2],[5.2,2],[5.2,4],[0,4]]"
        )
        assertEquals(6, Geometrie.ecken(r).size)
        nah(22.4, Geometrie.flaecheM2(r))
        // Die kurze Wand der Nische ist Wand 2 (0-basiert) mit 0,80 m.
        nah(0.8, Geometrie.wandLaengen(r)[2])
        assertEquals("Wand 3", Geometrie.wandName(r, 2))
    }

    @Test
    fun `ein kaputter Umriss faellt auf das Rechteck zurueck statt zu werfen`() {
        val r = Raum(name = "Notfall", breiteM = BigDecimal("3"), tiefeM = BigDecimal("2"),
            umriss = "{kein json")
        assertNull(Geometrie.umrissLesen(r.umriss))
        assertEquals(4, Geometrie.ecken(r).size)
        nah(6.0, Geometrie.flaecheM2(r))
    }

    @Test
    fun `Umriss schreiben und wieder lesen ergibt dieselben Ecken`() {
        val p = listOf(Punkt(0.0, 0.0), Punkt(6.0, 0.0), Punkt(6.0, 2.5), Punkt(0.0, 2.5))
        val gelesen = Geometrie.umrissLesen(Geometrie.umrissSchreiben(p))!!
        assertEquals(p, gelesen)
    }

    @Test
    fun `naechste Wand findet die Wand unter dem Finger`() {
        val r = Raum(name = "Halle", breiteM = BigDecimal("8"), tiefeM = BigDecimal("6"))
        // Punkt dicht an der vorderen Wand, 3 m vom linken Rand.
        val t = Geometrie.naechsteWand(r, 3.0, 0.2)
        assertEquals(0, t.index)
        nah(3.0, t.abstandAufWandM)
        nah(0.2, t.entfernungM)
        // Punkt in der Mitte gehört immer noch zur nächsten Wand, nur weiter weg.
        assertTrue(Geometrie.naechsteWand(r, 4.0, 3.0).entfernungM > 2.0)
    }

    @Test
    fun `Tuer zerlegt die Wand in Stuecke daneben und darueber`() {
        val r = Raum(name = "Halle", breiteM = BigDecimal("6"), tiefeM = BigDecimal("4"),
            hoeheM = BigDecimal("2.50"))
        val tuer = Oeffnung(
            raumId = r.id, art = OeffnungsArt.TUER, wandIndex = 0,
            abstandM = BigDecimal("2"), breiteM = BigDecimal("1"),
            hoeheM = BigDecimal("2"), bruestungM = BigDecimal.ZERO
        )
        val st = Geometrie.wandStuecke(r, 0, listOf(tuer))
        // links davon, Sturz darüber, rechts davon – keine Brüstung.
        assertEquals(3, st.size)
        assertEquals(Geometrie.WandStueck(0.0, 2.0, 0.0, 2.5), st[0])
        assertEquals(Geometrie.WandStueck(2.0, 3.0, 2.0, 2.5), st[1])
        assertEquals(Geometrie.WandStueck(3.0, 6.0, 0.0, 2.5), st[2])
    }

    @Test
    fun `Fenster laesst Bruestung und Sturz stehen`() {
        val r = Raum(name = "Büro", breiteM = BigDecimal("4"), tiefeM = BigDecimal("3"),
            hoeheM = BigDecimal("2.50"))
        val fenster = Oeffnung(
            raumId = r.id, art = OeffnungsArt.FENSTER, wandIndex = 2,
            abstandM = BigDecimal("1"), breiteM = BigDecimal("1.2"),
            hoeheM = BigDecimal("1.4"), bruestungM = BigDecimal("0.9")
        )
        val st = Geometrie.wandStuecke(r, 2, listOf(fenster))
        assertTrue(st.any { it.vonM == 1.0 && it.untenM == 0.0 && it.obenM == 0.9 }, "Brüstung fehlt")
        assertTrue(st.any { it.vonM == 1.0 && it.untenM == 2.3 && it.obenM == 2.5 }, "Sturz fehlt")
    }

    @Test
    fun `eine zu hohe Oeffnung wird auf die Raumhoehe begrenzt`() {
        val r = Raum(name = "Kellerabgang", breiteM = BigDecimal("3"), tiefeM = BigDecimal("3"),
            hoeheM = BigDecimal("2.00"))
        val tor = Normmasse.vervollstaendigen(
            Oeffnung(raumId = r.id, art = OeffnungsArt.TOR, wandIndex = 0,
                breiteM = BigDecimal.ZERO, hoeheM = BigDecimal.ZERO), r
        )
        assertEquals(BigDecimal("3.00"), tor.breiteM)
        nah(2.0, tor.hoeheM.toDouble())
        // Aus einem randvollen Loch darf kein Wandstück mit negativer Höhe werden.
        assertTrue(Geometrie.wandStuecke(r, 0, listOf(tor)).all { it.obenM >= it.untenM })
    }

    @Test
    fun `Einbau an der Wand sitzt auf der Wandlinie und zeigt in den Raum`() {
        val r = Raum(name = "Büro", breiteM = BigDecimal("4"), tiefeM = BigDecimal("3"))
        val dose = Einbau(
            raumId = r.id, art = "STECKDOSE", befestigung = Befestigung.WAND,
            wandIndex = 0, abstandM = BigDecimal("1.5")
        )
        val lage = Geometrie.lageImRaum(r, dose, abrueckenM = 0.1)
        nah(1.5, lage.x)
        nah(0.1, lage.y)          // von der vorderen Wand in den Raum gerückt
        nah(0.0, lage.winkelGrad) // vordere Wand zeigt nach rechts
    }
}

class NormmasseTest {

    @Test
    fun `Steckdose und Schalter bekommen ihre uebliche Hoehe`() {
        assertEquals(BigDecimal("0.30"), Normmasse.hoehe("STECKDOSE"))
        assertEquals(BigDecimal("1.05"), Normmasse.hoehe("TASTER"))
        assertEquals(BigDecimal("1.05"), Normmasse.hoehe("DIMMER"))
        assertEquals(BigDecimal("0.30"), Normmasse.hoehe("NETZWERKDOSE"))
    }

    @Test
    fun `Leuchte und Rauchmelder gehoeren an die Decke`() {
        assertNull(Normmasse.hoehe("LAMPE"))
        assertEquals(Befestigung.DECKE, Normmasse.befestigung("LAMPE"))
        assertEquals(Befestigung.DECKE, Normmasse.befestigung("RAUCHMELDER"))
        assertEquals(Befestigung.WAND, Normmasse.befestigung("STECKDOSE"))
    }

    @Test
    fun `an der Decke zaehlt die Raumhoehe, nicht ein Richtwert`() {
        val r = Raum(name = "Halle", hoeheM = BigDecimal("3.20"))
        val lampe = Normmasse.vervollstaendigen(
            Einbau(raumId = r.id, art = "LAMPE", befestigung = Befestigung.DECKE), r
        )
        assertEquals(BigDecimal("3.20"), lampe.hoeheM)
    }

    @Test
    fun `eine angegebene Hoehe wird nicht ueberschrieben`() {
        // Im Bestand sitzt vieles anders – das ist kein Mangel.
        val r = Raum(name = "Küche")
        val dose = Normmasse.vervollstaendigen(
            Einbau(raumId = r.id, art = "STECKDOSE", befestigung = Befestigung.WAND,
                hoeheM = BigDecimal("1.10")), r
        )
        assertEquals(BigDecimal("1.10"), dose.hoeheM)
    }
}
