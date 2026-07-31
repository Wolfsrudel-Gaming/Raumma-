package de.aufmass.kern

import java.math.BigDecimal
import java.math.RoundingMode

/*
 * Regelwerk – die versionierte Normbasis aus dem RAUMWERK-Konzept (§8).
 *
 * Aus einem reinen Messwerkzeug wird hier ein Planungs-Prüf-Tool: Das System
 * kennt die einzuhaltenden Freiräume und meldet aktiv, wenn ein Klötzchen sie
 * unterschreitet. Genau das ist der Alleinstellungs-Hebel – der Kunde kann es
 * selbst nicht leisten.
 *
 * **Bewusst als pflegbare, versionierte Datenbasis geführt.** Die konkreten
 * Zahlen sind Richtwerte; wo Haftung berührt ist, gehören sie fachlich/normativ
 * abgesichert. Deshalb steht jede Regel mit ihrer Quelle da und lässt sich
 * einzeln austauschen, ohne Code zu ändern. Die [version] wandert mit, damit
 * ein gespeicherter Befund später seiner Regelfassung zugeordnet werden kann.
 *
 * Wie [Normmasse] ist dies die **eine** Stelle mit fachlichen Zahlen. Alle
 * Werte sind konservative Richtwerte für Elektro-/Technikräume.
 */

/** In welche Richtung ein geforderter Freiraum gilt. */
enum class Richtung {
    /** Vor der Bedien-/Zugangsseite (dem Raum zugewandte Vorderseite). */
    VORNE,

    /** Ringsum – ein Mindestabstand nach allen Seiten. */
    RUNDUM
}

/**
 * Eine einzelne Vorgabe.
 *
 * [kategorie] entscheidet, für welche Bauteile die Regel greift; [abstandM] ist
 * der geforderte Freiraum; [quelle] nennt die Norm/Vorschrift, aus der der Wert
 * stammt.
 */
data class Regel(
    val id: String,
    val titel: String,
    val kategorie: Kategorie,
    val richtung: Richtung,
    val abstandM: BigDecimal,
    val quelle: String,
    val hinweis: String = ""
)

object Regelwerk {

    /** Fassung der Regelbasis. Wandert in jeden [Pruefung.Befund]. */
    const val version = "2026.07"

    private fun m(v: String) = BigDecimal(v)

    /**
     * Die Regeln. Die Werte sind konservativ gewählte Richtwerte; die
     * Quellenangabe ist der Ansatzpunkt für die spätere normative Prüfung.
     */
    val regeln: List<Regel> = listOf(
        Regel(
            "BEDIENBEREICH_VERTEILUNG", "Bedien- und Arbeitsbereich vor Verteilungen",
            Kategorie.VERTEILUNG, Richtung.VORNE, m("1.20"),
            "DIN VDE 0100-729 / DGUV Information 203-077",
            "Freier Bedienbereich vor Niederspannungs-Schaltgerätekombinationen."
        ),
        Regel(
            "GANGBREITE_SCHRANK", "Zugang / Gangbreite vor Schränken",
            Kategorie.SCHRANK, Richtung.VORNE, m("0.80"),
            "ASR A1.8 / DIN VDE 0100-729",
            "Mindestbreite eines Verkehrswegs zur Bedienung und Wartung."
        ),
        Regel(
            "WARTUNG_GERAET", "Wartungsfreiraum vor Geräten",
            Kategorie.GERAET, Richtung.VORNE, m("0.50"),
            "Herstellervorgabe (Richtwert)",
            "Zugang für Bedienung und Instandhaltung."
        ),
        Regel(
            "ABSTAND_WAERMEQUELLE", "Mindestabstand zu Wärmequellen",
            Kategorie.WAERMEQUELLE, Richtung.RUNDUM, m("0.30"),
            "Herstellervorgabe / Brandschutz (Richtwert)",
            "Abstand wärmeabgebender Geräte zu anderen Bauteilen."
        )
    )

    /** Die Regeln, die für eine Kategorie gelten (heute je Kategorie höchstens eine). */
    fun fuer(kategorie: Kategorie): List<Regel> = regeln.filter { it.kategorie == kategorie }

    /**
     * Faktor Biegeradius ÷ Außendurchmesser.
     *
     * Richtwert: fest verlegte Kabel etwa das 15-fache, Leerrohre etwa das
     * 6-fache des Außendurchmessers. Konservativ (eher großer Radius), damit
     * die Warnung im Zweifel zu früh statt zu spät kommt.
     */
    fun biegeradiusFaktor(kategorie: Kategorie): Int? = when (kategorie) {
        Kategorie.KABEL -> 15
        Kategorie.ROHR -> 6
        else -> null
    }

    /**
     * Mindestbiegeradius in Millimetern für ein Bauteil mit Außendurchmesser
     * [aussenDMm]. `null`, wenn die Kategorie keinen Biegeradius kennt.
     */
    fun biegeradiusMm(kategorie: Kategorie, aussenDMm: BigDecimal?): BigDecimal? {
        val faktor = biegeradiusFaktor(kategorie) ?: return null
        if (aussenDMm == null) return null
        return (aussenDMm * BigDecimal(faktor)).setScale(0, RoundingMode.HALF_UP)
    }
}
