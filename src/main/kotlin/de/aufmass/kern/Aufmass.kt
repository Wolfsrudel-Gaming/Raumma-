package de.aufmass.kern

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/**
 * Aus Messwerten wird eine Raumform.
 *
 * Hier steckt der Unterschied zwischen einem Zeichenprogramm und einem
 * Aufmaßsystem: Niemand kennt vor Ort die Koordinaten einer Ecke. Man kennt
 * Wandlängen und Abbiegungen – und die Frage, ob am Ende alles zusammenpasst.
 */
object Aufmass {

    /**
     * Eine Wand im Aufmaß: ihre Länge und die Drehung an der Ecke **danach**.
     *
     * Positive Drehung = nach rechts (im Uhrzeigersinn, wie man im Grundriss
     * schaut). Übliche Werte sind ±90°, an einer Nische auch mal beides
     * hintereinander. Alles andere ist erlaubt – schiefe Wände gibt es.
     */
    data class Wand(val laengeM: Double, val drehungGrad: Double)

    /**
     * Ergebnis eines Polygonzugs.
     *
     * [restlueckeM] ist die Entfernung zwischen letztem und erstem Punkt. Sie
     * ist die eigentliche Qualitätsaussage des Aufmaßes: Ein Zug, der sich
     * nicht schließt, enthält einen Messfehler. Wir schließen ihn trotzdem –
     * aber nicht stillschweigend, sondern mit der Zahl daneben.
     */
    data class Zug(
        val punkte: List<Punkt>,
        val restlueckeM: Double,
        /** true, wenn die letzte Wand ergänzt wurde, statt gemessen zu sein. */
        val schlusswandErgaenzt: Boolean
    ) {
        val geschlossen: Boolean get() = restlueckeM < 0.02
    }

    /**
     * Rechnet einen Polygonzug in Eckpunkte um.
     *
     * Start ist (0,0) mit Blickrichtung nach rechts. Nach jeder Wand wird um
     * ihren Winkel gedreht. Fällt der Endpunkt auf den Anfang, ist der Zug
     * geschlossen und der doppelte Punkt entfällt; sonst wird die Lücke als
     * Schlusswand aufgefasst.
     *
     * Die Punkte werden anschließend so verschoben, dass sie bei (0,0)
     * beginnen und auf Zentimeter gerundet sind – das ist genauer, als jedes
     * Bandmaß ablesbar ist, und hält die Zahlen lesbar.
     */
    fun zug(waende: List<Wand>): Zug {
        require(waende.size >= 3) { "Ein Raum braucht mindestens drei Wände" }
        var x = 0.0
        var y = 0.0
        var richtung = 0.0
        val roh = mutableListOf(Punkt(0.0, 0.0))
        for (w in waende) {
            val bogen = Math.toRadians(richtung)
            x += w.laengeM * cos(bogen)
            y += w.laengeM * sin(bogen)
            roh += Punkt(x, y)
            richtung += w.drehungGrad
        }
        val luecke = hypot(roh.last().x - roh.first().x, roh.last().y - roh.first().y)
        val geschlossen = luecke < 0.02
        val punkte = if (geschlossen) roh.dropLast(1) else roh.toList()
        return Zug(normieren(punkte), luecke, !geschlossen)
    }

    /**
     * Setzt Drehungen, die nahe an einem Vielfachen von 90° liegen, auf genau
     * diesen Wert.
     *
     * Gezielte oder geschätzte Winkel streuen um ein, zwei Grad; die meisten
     * Räume sind trotzdem rechtwinklig. Wer das annimmt, gewinnt viel: Die
     * Form ist dann allein durch die Längen bestimmt, und die lassen sich mit
     * dem Bandmaß genau nehmen. Was deutlich schief ist (Erker, 135°-Ecke),
     * bleibt unangetastet.
     */
    fun rechtwinklig(waende: List<Wand>, toleranzGrad: Double = 8.0): List<Wand> =
        waende.map { w ->
            val ziel = Math.round(w.drehungGrad / 90.0) * 90.0
            if (abs(w.drehungGrad - ziel) <= toleranzGrad) w.copy(drehungGrad = ziel) else w
        }

    /**
     * Ergebnis eines Ausgleichs: die neuen Wände, die Änderung je Wand und die
     * Restlücke vorher/nachher. [korrekturM] gehört in die Oberfläche – wer
     * sieht, dass eine Wand um 12 cm verschoben wurde, misst sie nach.
     */
    data class Ausgleich(
        val waende: List<Wand>,
        val korrekturM: List<Double>,
        val restlueckeVorherM: Double,
        val restlueckeNachherM: Double
    )

    /**
     * Schließt einen Zug, ohne die gemessenen Wände anzufassen.
     *
     * Die Richtungen bleiben, wie sie sind. Die Längen der Wände, die **nicht**
     * in [fest] stehen, werden so wenig wie möglich geändert (kleinste
     * Quadrate), dass die Restlücke verschwindet:
     *
     *     Σ δᵢ·uᵢ = −Lücke,   Σ δᵢ² → min,   δᵢ = 0 für feste Wände
     *
     * mit uᵢ der Richtung von Wand i. Lösung: δ = Uᵀ(UUᵀ)⁻¹(−Lücke). Laufen alle
     * freien Wände parallel, lässt sich nur der Anteil der Lücke in ihrer
     * Richtung schließen – der Rest bleibt als ehrliche Restlücke stehen.
     *
     * Damit wird aus einer gezielten Skizze plus ein paar Bandmaßen ein
     * geschlossener Raum, in dem jedes gemessene Maß exakt stimmt.
     */
    fun ausgleichen(waende: List<Wand>, fest: Set<Int> = emptySet()): Ausgleich {
        val richtungen = mutableListOf<Double>()
        var r = 0.0
        for (w in waende) { richtungen += Math.toRadians(r); r += w.drehungGrad }
        fun luecke(l: List<Double>): Pair<Double, Double> {
            var gx = 0.0
            var gy = 0.0
            l.forEachIndexed { i, len -> gx += len * cos(richtungen[i]); gy += len * sin(richtungen[i]) }
            return gx to gy
        }
        val laengen = waende.map { it.laengeM }
        val (gx, gy) = luecke(laengen)
        val frei = waende.indices.filter { it !in fest }
        var m00 = 0.0
        var m01 = 0.0
        var m11 = 0.0
        for (i in frei) {
            val c = cos(richtungen[i])
            val s = sin(richtungen[i])
            m00 += c * c; m01 += c * s; m11 += s * s
        }
        // Pseudo-Inverse der 2×2-Matrix M = UUᵀ.
        val det = m00 * m11 - m01 * m01
        val spur = m00 + m11
        val (p00, p01, p11) = when {
            det > 1e-9 -> Triple(m11 / det, -m01 / det, m00 / det)
            spur > 1e-9 -> {
                // Rang 1: alle freien Wände parallel. M = spur·e·eᵀ.
                val (ex, ey) = if (m00 >= m11) m00 to m01 else m01 to m11
                val n = hypot(ex, ey)
                val (x, y) = (ex / n) to (ey / n)
                Triple(x * x / spur, x * y / spur, y * y / spur)
            }
            else -> Triple(0.0, 0.0, 0.0)
        }
        val lx = -(p00 * gx + p01 * gy)
        val ly = -(p01 * gx + p11 * gy)
        val korrektur = waende.indices.map { i ->
            if (i in fest) 0.0 else cos(richtungen[i]) * lx + sin(richtungen[i]) * ly
        }
        val neu = laengen.mapIndexed { i, l -> maxOf(0.0, l + korrektur[i]) }
        val (nx, ny) = luecke(neu)
        return Ausgleich(
            waende.mapIndexed { i, w -> w.copy(laengeM = neu[i]) },
            korrektur,
            hypot(gx, gy),
            hypot(nx, ny)
        )
    }

    /** Verschiebt einen Umriss auf den Nullpunkt und rundet auf Zentimeter. */
    fun normieren(punkte: List<Punkt>): List<Punkt> {
        if (punkte.isEmpty()) return punkte
        val minX = punkte.minOf { it.x }
        val minY = punkte.minOf { it.y }
        return punkte.map {
            Punkt(
                Math.round((it.x - minX) * 100.0) / 100.0,
                Math.round((it.y - minY) * 100.0) / 100.0
            )
        }
    }

    /**
     * Der umgekehrte Weg: aus einem vorhandenen Umriss die Wandliste.
     *
     * Damit lässt sich ein Raum, der als Rechteck angelegt wurde, nachträglich
     * Wand für Wand bearbeiten – ohne ihn neu aufnehmen zu müssen.
     */
    fun waende(punkte: List<Punkt>): List<Wand> {
        val n = punkte.size
        require(n >= 3) { "Ein Umriss braucht mindestens drei Ecken" }
        return (0 until n).map { i ->
            val a = punkte[i]
            val b = punkte[(i + 1) % n]
            val c = punkte[(i + 2) % n]
            val laenge = hypot(b.x - a.x, b.y - a.y)
            var drehung = Math.toDegrees(
                Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x)
            )
            while (drehung > 180) drehung -= 360
            while (drehung <= -180) drehung += 360
            Wand(
                Math.round(laenge * 100.0) / 100.0,
                Math.round(drehung * 10.0) / 10.0
            )
        }
    }

    /**
     * Prüft einen Umriss auf die Fehler, die beim Tippen entstehen.
     *
     * Bewusst **keine** Ausnahme, sondern eine Liste von Hinweisen: Ein
     * Aufmaßsystem soll melden, was auffällt, und den Menschen entscheiden
     * lassen. Ein Raum mit einer 2-cm-Wand ist meistens ein Tippfehler –
     * aber eben nur meistens.
     */
    fun pruefen(punkte: List<Punkt>): List<String> {
        val hinweise = mutableListOf<String>()
        if (punkte.size < 3) return listOf("Weniger als drei Ecken – daraus wird kein Raum.")
        val laengen = punkte.indices.map { i ->
            val q = punkte[(i + 1) % punkte.size]
            hypot(q.x - punkte[i].x, q.y - punkte[i].y)
        }
        laengen.forEachIndexed { i, l ->
            if (l < 0.05) hinweise += "Wand ${i + 1} ist nur ${zentimeter(l)} lang – Tippfehler?"
        }
        if (laengen.sum() > 500) hinweise += "Umfang über 500 m – stimmt die Einheit (Meter)?"
        val flaeche = flaeche(punkte)
        if (flaeche < 0.5) hinweise += "Fläche unter 0,5 m² – der Zug ist vermutlich in sich verdreht."
        if (schneidetSichSelbst(punkte)) hinweise +=
            "Die Wände kreuzen sich. Das ergibt keinen begehbaren Raum – meist ist eine " +
                "Drehung falsch herum eingetragen."
        return hinweise
    }

    private fun zentimeter(m: Double) = "${Math.round(m * 100)} cm"

    /** Gaußsche Trapezformel – auch hier, damit [pruefen] ohne Raum auskommt. */
    fun flaeche(punkte: List<Punkt>): Double {
        var summe = 0.0
        for (i in punkte.indices) {
            val q = punkte[(i + 1) % punkte.size]
            summe += punkte[i].x * q.y - q.x * punkte[i].y
        }
        return abs(summe) / 2
    }

    /**
     * Kreuzen sich zwei nicht benachbarte Wände? Dann ist das Vieleck nicht
     * einfach, und Fläche wie Darstellung wären Unsinn.
     */
    fun schneidetSichSelbst(punkte: List<Punkt>): Boolean {
        val n = punkte.size
        for (i in 0 until n) {
            for (j in i + 1 until n) {
                if (j == i || (j + 1) % n == i || (i + 1) % n == j) continue
                if (schneiden(
                        punkte[i], punkte[(i + 1) % n],
                        punkte[j], punkte[(j + 1) % n]
                    )
                ) return true
            }
        }
        return false
    }

    private fun schneiden(a: Punkt, b: Punkt, c: Punkt, d: Punkt): Boolean {
        fun rich(p: Punkt, q: Punkt, r: Punkt): Int {
            val v = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y)
            return if (abs(v) < 1e-9) 0 else if (v > 0) 1 else 2
        }
        return rich(a, b, c) != rich(a, b, d) && rich(c, d, a) != rich(c, d, b)
    }

    // ------------------------------------------------- Aufmaßliste (Text)

    /** Ein aus einer Textzeile gelesener Raum. */
    data class ZeilenRaum(
        val nummer: String,
        val name: String,
        val breiteVorneM: Double?,
        val breiteM: Double,
        val tiefeM: Double,
        val schraege: Schraege
    )

    /**
     * Liest Raumzeilen so, wie sie beim Aufmaß auf dem Block entstehen.
     *
     * Erlaubt ist alles, was man ohnehin schreibt:
     * ```
     * 0.01; Flur; 2 x 8
     * 0.02; Schulungsraum; 4/6 x 5 rechts
     * Küche; 3,5 × 4
     * # Kommentarzeile
     * ```
     * `4/6 x 5` heißt: vorne 4 m, hinten 6 m, 5 m tief. Das Wort dahinter sagt,
     * auf welcher Seite die schräge Wand sitzt (Vorgabe: rechts).
     *
     * Für alles Kompliziertere ist der Polygonzug da – diese Kurzform soll den
     * Normalfall in einem Rutsch erfassen, nicht jeden Sonderfall abdecken.
     */
    fun zeileLesen(zeile: String): ZeilenRaum? {
        val roh = zeile.trim()
        if (roh.isEmpty() || roh.startsWith("#")) return null
        val teile = roh.split(';').map { it.trim() }
        val masse = teile.last()
        val name = if (teile.size >= 2) teile[teile.size - 2] else ""
        val nummer = if (teile.size >= 3) teile[teile.size - 3] else ""
        if (name.isBlank()) return null

        val norm = masse.replace('×', 'x').replace('*', 'x').lowercase()
        val schraege = when {
            "links" in norm -> Schraege.LINKS
            "beidseitig" in norm || "mittig" in norm -> Schraege.BEIDSEITIG
            else -> Schraege.RECHTS
        }
        val treffer = Regex(
            """([0-9]+(?:[.,][0-9]+)?(?:\s*/\s*[0-9]+(?:[.,][0-9]+)?)?)\s*x\s*([0-9]+(?:[.,][0-9]+)?)"""
        ).find(norm) ?: return null
        val tiefe = zahl(treffer.groupValues[2]) ?: return null
        val breiten = treffer.groupValues[1].split('/').mapNotNull { zahl(it) }
        return when (breiten.size) {
            1 -> ZeilenRaum(nummer, name, null, breiten[0], tiefe, Schraege.KEINE)
            2 -> ZeilenRaum(nummer, name, breiten[0], breiten[1], tiefe, schraege)
            else -> null
        }
    }

    fun listeLesen(text: String): List<ZeilenRaum> = text.lines().mapNotNull { zeileLesen(it) }

    private fun zahl(s: String): Double? = s.trim().replace(',', '.').toDoubleOrNull()
}
