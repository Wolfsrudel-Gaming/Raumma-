package de.aufmass.kern

import java.math.BigDecimal
import java.math.RoundingMode
import java.util.UUID
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/*
 * Normprüfung – das Alleinstellungsmerkmal aus dem RAUMWERK-Konzept (§8).
 *
 * Ein Klötzchen ([Platzhalter]) wird nicht nur physisch, sondern regelkonform
 * geprüft: Hält es den vom [Regelwerk] geforderten Freiraum ein? Bei
 * Unterschreitung meldet die Prüfung eine Warnung – „Diese Zählerposition
 * unterschreitet den nötigen Freiraum davor."
 *
 * **Konservative Messung als festes Prinzip (Leitplanke des Konzepts):** Der
 * verfügbare Freiraum wird immer als *untere Schranke* ausgegeben – gemessene
 * Tiefe minus Toleranz, auf ganze Zentimeter **abgerundet**. Lieber „mind.
 * 118 cm" als „ca. 121 cm": zu wenig Spielraum ist gefährlicher als zu viel.
 *
 * Die Rechnung ist rein (kein Zustand, keine Seiteneffekte) und spiegelt sich
 * in `web/pruefung.js`, damit der Browser live prüft, während ein Klötzchen
 * gezogen wird, und der Server bei der Report-Ausgabe dieselben Zahlen liefert.
 */
object Pruefung {

    /** Messtoleranz, die zu Lasten des Nutzers vom Freiraum abgezogen wird. */
    val toleranzM: BigDecimal = BigDecimal("0.02")

    /** Wie ernst ein Befund ist. */
    enum class Schwere { OK, HINWEIS, WARNUNG }

    /**
     * Ein platziertes Klötzchen im Raumkoordinatensystem.
     *
     * [xM]/[yM] ist der **Mittelpunkt** der Grundfläche in Metern (nicht die
     * Anteile aus [Einbau]: ein Klötzchen wird metrisch geprüft, während es
     * gezogen wird). [drehungGrad] dreht die Grundfläche im Uhrzeigersinn; bei
     * 0° zeigt die Bedien-/Vorderseite nach unten (+y, in den Raum hinein).
     */
    data class Platzhalter(
        val id: UUID = UUID.randomUUID(),
        val raumId: UUID,
        /** Katalogschlüssel aus [Komponenten]. */
        val komponente: String,
        val xM: BigDecimal,
        val yM: BigDecimal,
        val drehungGrad: BigDecimal = BigDecimal.ZERO,
        val bezeichnung: String = ""
    )

    /**
     * Ein Prüfergebnis zu einem Klötzchen und einer Regel.
     *
     * [verfuegbarM] ist die konservative untere Schranke des vorhandenen
     * Freiraums; [erforderlichM] der geforderte Wert. [regelVersion] hält die
     * Fassung der Regelbasis fest, damit ein archivierter Befund später seiner
     * Grundlage zugeordnet werden kann.
     */
    data class Befund(
        val platzhalterId: UUID,
        val komponenteName: String,
        val regelId: String,
        val regelTitel: String,
        val quelle: String,
        val richtung: Richtung?,
        val erforderlichM: BigDecimal,
        val verfuegbarM: BigDecimal?,
        val schwere: Schwere,
        val text: String,
        val regelVersion: String = Regelwerk.version
    )

    // -------------------------------------------------------- Grundfläche

    /**
     * Die vier Eckpunkte der Grundfläche eines Klötzchens im Raum, im
     * Uhrzeigersinn. Breite läuft entlang der lokalen u-Achse, Tiefe entlang
     * der n-Achse (Bedienrichtung).
     */
    fun grundriss(ph: Platzhalter, komp: Komponente): List<Punkt> {
        val (cx, cy) = ph.xM.toDouble() to ph.yM.toDouble()
        val th = Math.toRadians(ph.drehungGrad.toDouble())
        val ux = cos(th); val uy = sin(th)      // Breitenachse
        val nx = -sin(th); val ny = cos(th)      // Tiefenachse (Vorderseite = +n)
        val hw = komp.breiteM.toDouble() / 2
        val ht = komp.tiefeM.toDouble() / 2
        fun eck(a: Double, b: Double) = Punkt(cx + ux * a + nx * b, cy + uy * a + ny * b)
        return listOf(eck(-hw, -ht), eck(hw, -ht), eck(hw, ht), eck(-hw, ht))
    }

    // -------------------------------------------------- Freiraum vorne

    /**
     * Freie Tiefe vor der Vorderseite eines Klötzchens, in Metern (roh, ohne
     * Toleranz). Gemessen entlang der Bedienrichtung, nur innerhalb der Breite
     * des Klötzchens. Hindernisse sind die Raumwände und die Grundflächen der
     * übrigen Klötzchen.
     *
     * `Double.MAX_VALUE`, wenn nichts im Weg steht (z. B. offener Raum ohne
     * Gegenwand) – der Aufrufer behandelt das als „reichlich".
     */
    fun freieTiefeVorne(ph: Platzhalter, komp: Komponente, hindernisse: List<Segment>): Double {
        val th = Math.toRadians(ph.drehungGrad.toDouble())
        val ux = cos(th); val uy = sin(th)
        val nx = -sin(th); val ny = cos(th)
        val cx = ph.xM.toDouble(); val cy = ph.yM.toDouble()
        val hw = komp.breiteM.toDouble() / 2
        val ht = komp.tiefeM.toDouble() / 2

        var beste = Double.MAX_VALUE
        for (s in hindernisse) {
            // In das lokale Frontsystem: la = Lage quer, ld = Tiefe vor der Front.
            val la0 = (s.a.x - cx) * ux + (s.a.y - cy) * uy
            val la1 = (s.b.x - cx) * ux + (s.b.y - cy) * uy
            val ld0 = (s.a.x - cx) * nx + (s.a.y - cy) * ny - ht
            val ld1 = (s.b.x - cx) * nx + (s.b.y - cy) * ny - ht
            minTiefeImBand(la0, ld0, la1, ld1, hw)?.let { beste = min(beste, it) }
        }
        return beste
    }

    /**
     * Kleinste nichtnegative Tiefe `ld` über dem Teil einer Strecke, dessen
     * Quermaß `la` im Band [-[hw], [hw]] liegt. `null`, wenn die Strecke das
     * Band nicht berührt. Kreuzt `ld` im Band die Null (die Strecke läuft durch
     * die Frontebene), ist das Ergebnis 0 – dann steht das Hindernis in der
     * Front.
     */
    private fun minTiefeImBand(la0: Double, ld0: Double, la1: Double, ld1: Double, hw: Double): Double? {
        var s0 = 0.0; var s1 = 1.0
        if (abs(la1 - la0) < 1e-12) {
            if (abs(la0) > hw) return null
        } else {
            val sPlus = (hw - la0) / (la1 - la0)
            val sMinus = (-hw - la0) / (la1 - la0)
            s0 = max(0.0, min(sPlus, sMinus))
            s1 = min(1.0, max(sPlus, sMinus))
            if (s0 > s1) return null
        }
        val e0 = ld0 + (ld1 - ld0) * s0
        val e1 = ld0 + (ld1 - ld0) * s1
        val kandidaten = mutableListOf<Double>()
        if (e0 >= 0) kandidaten += e0
        if (e1 >= 0) kandidaten += e1
        if ((e0 < 0) != (e1 < 0)) kandidaten += 0.0
        return kandidaten.minOrNull()
    }

    // ------------------------------------------------ Abstand rundum

    /** Kleinster Abstand zweier Grundflächen (konvexe Vierecke), in Metern. */
    fun abstand(a: List<Punkt>, b: List<Punkt>): Double {
        if (a.any { imPolygon(it, b) } || b.any { imPolygon(it, a) }) return 0.0
        var beste = Double.MAX_VALUE
        for (i in a.indices) {
            val a1 = a[i]; val a2 = a[(i + 1) % a.size]
            for (j in b.indices) {
                val b1 = b[j]; val b2 = b[(j + 1) % b.size]
                beste = min(beste, streckeAbstand(a1, a2, b1, b2))
            }
        }
        return beste
    }

    // --------------------------------------------------------- Prüfen

    /**
     * Prüft alle Klötzchen eines Raumes gegen das Regelwerk und gibt je
     * geprüfter Regel einen [Befund] zurück – auch die erfüllten ([Schwere.OK]),
     * damit die Oberfläche jeden Freiraum mit seinem Status anzeigen kann.
     */
    fun pruefe(
        raum: Raum,
        platzhalter: List<Platzhalter>,
        katalog: Map<String, Komponente> = Komponenten.katalog,
        regeln: List<Regel> = Regelwerk.regeln
    ): List<Befund> {
        val befunde = mutableListOf<Befund>()
        val wandSegmente = wandSegmente(raum)
        val mitKomp = platzhalter.mapNotNull { ph -> katalog[ph.komponente]?.let { ph to it } }

        for ((ph, komp) in mitKomp) {
            // Biegeradius (informativ).
            Regelwerk.biegeradiusMm(komp.kategorie, komp.aussenDurchmesserMm)?.let { r ->
                val faktor = Regelwerk.biegeradiusFaktor(komp.kategorie)
                befunde += Befund(
                    ph.id, komp.name, "BIEGERADIUS", "Mindestbiegeradius",
                    "Herstellervorgabe (Richtwert)", null,
                    r.divide(BigDecimal(1000)).setScale(2, RoundingMode.HALF_UP), null,
                    Schwere.HINWEIS,
                    "Mindestbiegeradius ca. ${r.toPlainString()} mm " +
                        "(${faktor}×Ø ${komp.aussenDurchmesserMm!!.toPlainString()} mm)."
                )
            }

            for (regel in regeln.filter { it.kategorie == komp.kategorie }) when (regel.richtung) {
                Richtung.VORNE -> {
                    if (!komp.bedienseiteVorn) continue
                    val andere = mitKomp.filter { it.first.id != ph.id }
                        .flatMap { boxSegmente(grundriss(it.first, it.second)) }
                    val roh = freieTiefeVorne(ph, komp, wandSegmente + andere)
                    val verf = konservativ(roh)
                    val ok = verf >= regel.abstandM
                    befunde += Befund(
                        ph.id, komp.name, regel.id, regel.titel, regel.quelle, regel.richtung,
                        regel.abstandM, verf, if (ok) Schwere.OK else Schwere.WARNUNG,
                        if (ok) "Freiraum vor ${komp.name}: mind. ${zeigeCm(verf)} " +
                            "(gefordert ${zeigeCm(regel.abstandM)})."
                        else "${komp.name} unterschreitet den Freiraum davor: nur mind. " +
                            "${zeigeCm(verf)} statt ${zeigeCm(regel.abstandM)}."
                    )
                }

                Richtung.RUNDUM -> {
                    val eigen = grundriss(ph, komp)
                    val naechster = mitKomp.filter { it.first.id != ph.id }
                        .map { it to abstand(eigen, grundriss(it.first, it.second)) }
                        .minByOrNull { it.second }
                    val roh = naechster?.second ?: Double.MAX_VALUE
                    val verf = konservativ(roh)
                    val ok = verf >= regel.abstandM
                    val nachbar = naechster?.first?.second?.name
                    befunde += Befund(
                        ph.id, komp.name, regel.id, regel.titel, regel.quelle, regel.richtung,
                        regel.abstandM, verf, if (ok) Schwere.OK else Schwere.WARNUNG,
                        if (ok) "Abstand von ${komp.name} rundum: mind. ${zeigeCm(verf)} " +
                            "(gefordert ${zeigeCm(regel.abstandM)})."
                        else "${komp.name} zu nah an ${nachbar ?: "Nachbarbauteil"}: nur mind. " +
                            "${zeigeCm(verf)} statt ${zeigeCm(regel.abstandM)}."
                    )
                }
            }
        }
        return befunde
    }

    // ------------------------------------------------------- Hilfsmittel

    /** Eine gerichtete Strecke zwischen zwei Punkten – ein Hindernis-Kantenstück. */
    data class Segment(val a: Punkt, val b: Punkt)

    /** Die Wände eines Raumes als Strecken. */
    fun wandSegmente(raum: Raum): List<Segment> {
        val e = Geometrie.ecken(raum)
        return e.indices.map { Segment(e[it], e[(it + 1) % e.size]) }
    }

    /** Die vier Kanten einer Grundfläche als Strecken. */
    fun boxSegmente(ecken: List<Punkt>): List<Segment> =
        ecken.indices.map { Segment(ecken[it], ecken[(it + 1) % ecken.size]) }

    /** Rundet konservativ: (roh − Toleranz), auf ganze cm abgerundet, nie negativ. */
    fun konservativ(rohM: Double): BigDecimal {
        if (rohM >= Double.MAX_VALUE / 2) return BigDecimal("99.99")
        val abzueglich = rohM - toleranzM.toDouble()
        // Epsilon vor dem Abrunden: fängt reines Fließkomma-Rauschen ab
        // (0,98 darf nicht durch 97,999… auf 0,97 fallen), ohne die untere
        // Schranke fachlich zu verschieben.
        val cm = Math.floor(abzueglich * 100.0 + 1e-9) / 100.0
        return BigDecimal(max(0.0, cm)).setScale(2, RoundingMode.HALF_UP)
    }

    private fun zeigeCm(m: BigDecimal): String =
        "${m.multiply(BigDecimal(100)).setScale(0, RoundingMode.HALF_UP).toPlainString()} cm"

    private fun imPolygon(p: Punkt, poly: List<Punkt>): Boolean {
        var drin = false
        var j = poly.size - 1
        for (i in poly.indices) {
            if ((poly[i].y > p.y) != (poly[j].y > p.y) &&
                p.x < (poly[j].x - poly[i].x) * (p.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x
            ) drin = !drin
            j = i
        }
        return drin
    }

    private fun punktStrecke(p: Punkt, a: Punkt, b: Punkt): Double {
        val dx = b.x - a.x; val dy = b.y - a.y
        val l2 = dx * dx + dy * dy
        if (l2 < 1e-12) return hypot(p.x - a.x, p.y - a.y)
        val t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / l2).coerceIn(0.0, 1.0)
        return hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
    }

    private fun streckeAbstand(a: Punkt, b: Punkt, c: Punkt, d: Punkt): Double {
        if (streckenSchneiden(a, b, c, d)) return 0.0
        return minOf(
            punktStrecke(a, c, d), punktStrecke(b, c, d),
            punktStrecke(c, a, b), punktStrecke(d, a, b)
        )
    }

    private fun streckenSchneiden(a: Punkt, b: Punkt, c: Punkt, d: Punkt): Boolean {
        fun rich(p: Punkt, q: Punkt, r: Punkt): Int {
            val v = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y)
            return if (abs(v) < 1e-12) 0 else if (v > 0) 1 else 2
        }
        return rich(a, b, c) != rich(a, b, d) && rich(c, d, a) != rich(c, d, b)
    }
}
