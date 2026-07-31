package de.aufmass.kern

import java.math.BigDecimal

/*
 * Komponenten-Datenbank – die parametrischen „Klötzchen" aus dem RAUMWERK-
 * Konzept (§3, §6.2).
 *
 * Ein Klötzchen ist ein maßstabsgetreuer Geräte-Platzhalter mit echten
 * Baumaßen: „Zählerschrank 60×40×150". Es wird im Grundriss frei platziert und
 * verschoben; die Abstandsprüfung ([Pruefung]) rechnet gegen seine tatsächliche
 * Grundfläche, nicht gegen einen Punkt.
 *
 * Diese Datei ist – wie [Regelwerk] – bewusst die **eine** Stelle mit
 * fachlichen Bauteilmaßen. Der wachsende, gepflegte Katalog ist Teil des
 * proprietären Kerns; er ist der eigentliche Wert, nicht der (offene) Code.
 *
 * Alle Längen in Metern, Kabel-/Rohrmaße zusätzlich in Millimetern, weil das
 * die Angabe auf dem Typenschild ist.
 */

/**
 * Fachliche Klasse eines Bauteils. Sie entscheidet, **welche** Regeln des
 * [Regelwerk]s greifen – ein Zählerschrank braucht anderen Freiraum als ein
 * Leerrohr.
 */
enum class Kategorie {
    /** Zähler-, Verteiler-, Unterverteilungsschrank – braucht Bedien-/Arbeitsbereich davor. */
    VERTEILUNG,

    /** Schalt-, Server-, Batterieschrank – braucht Zugang/Gangbreite davor. */
    SCHRANK,

    /** Freistehendes Gerät (USV, Ladegerät …) – braucht Wartungsfreiraum davor. */
    GERAET,

    /** Wärmeabgebendes Bauteil (Therme, Speicher) – hält Abstand zu anderem frei. */
    WAERMEQUELLE,

    /** Kabel – trägt einen Mindestbiegeradius über den Außendurchmesser. */
    KABEL,

    /** Leerrohr / Installationsrohr – wie Kabel, eigener Biegeradius-Faktor. */
    ROHR,

    /** Alles ohne besondere Freiraum-Regel. */
    SONSTIGES
}

/**
 * Ein Eintrag der Komponenten-Datenbank.
 *
 * [breiteM]×[tiefeM]×[hoeheM] ist die Bauhülle. Im Grundriss zählt die
 * Grundfläche [breiteM]×[tiefeM]; [tiefeM] ist dabei das Maß **von der Wand in
 * den Raum**. [bedienseiteVorn] sagt, ob der Freiraum vor der Tiefen-Vorderseite
 * (dem Raum zugewandt) gebraucht wird – bei Schränken die Türseite.
 *
 * [aussenDurchmesserMm] ist nur für [Kategorie.KABEL]/[Kategorie.ROHR] gesetzt
 * und speist die Biegeradius-Rechnung.
 */
data class Komponente(
    /** Katalogschlüssel, wird gespeichert (z. B. `ZAEHLERSCHRANK`). */
    val schluessel: String,
    /** Klartextname für die Auswahlliste. */
    val name: String,
    val kategorie: Kategorie,
    /** Breite quer zur Bedienrichtung. */
    val breiteM: BigDecimal,
    /** Tiefe – von der Wand in den Raum. */
    val tiefeM: BigDecimal,
    /** Bauhöhe. */
    val hoeheM: BigDecimal,
    /** Freiraum wird an der dem Raum zugewandten Vorderseite gebraucht. */
    val bedienseiteVorn: Boolean = true,
    /** Nur Kabel/Rohr: Außendurchmesser in Millimetern. */
    val aussenDurchmesserMm: BigDecimal? = null
)

/**
 * Der mitgelieferte Katalog – ein belastbarer Startbestand für Elektro- und
 * Technikräume. Ergänzen heißt: eine Zeile hinzufügen. Kein Schema, keine
 * Aufzählung, die mitgepflegt werden müsste.
 */
object Komponenten {

    private fun m(v: String) = BigDecimal(v)

    val katalog: Map<String, Komponente> = listOf(
        Komponente("ZAEHLERSCHRANK", "Zählerschrank", Kategorie.VERTEILUNG, m("0.60"), m("0.20"), m("1.50")),
        Komponente("VERTEILERSCHRANK", "Verteilerschrank (UV)", Kategorie.VERTEILUNG, m("0.80"), m("0.25"), m("2.00")),
        Komponente("HAUPTVERTEILUNG", "Hauptverteilung (NSHV)", Kategorie.VERTEILUNG, m("1.20"), m("0.40"), m("2.00")),
        Komponente("AP_VERTEILER", "Aufputz-Kleinverteiler", Kategorie.VERTEILUNG, m("0.40"), m("0.12"), m("0.60")),
        Komponente("SCHALTSCHRANK", "Schaltschrank", Kategorie.SCHRANK, m("0.80"), m("0.40"), m("2.00")),
        Komponente("SERVERSCHRANK", "19\"-Serverschrank", Kategorie.SCHRANK, m("0.60"), m("0.80"), m("2.00")),
        Komponente("BATTERIESCHRANK", "Batterieschrank", Kategorie.SCHRANK, m("0.60"), m("0.60"), m("1.80")),
        Komponente("USV", "USV-Anlage", Kategorie.GERAET, m("0.50"), m("0.70"), m("1.20")),
        Komponente("LADEGERAET", "Wallbox / Ladegerät", Kategorie.GERAET, m("0.35"), m("0.15"), m("0.50")),
        Komponente("KLIMA_INNEN", "Klima-Innengerät", Kategorie.GERAET, m("0.90"), m("0.20"), m("0.30"), bedienseiteVorn = false),
        Komponente("THERME", "Heiztherme", Kategorie.WAERMEQUELLE, m("0.45"), m("0.35"), m("0.80")),
        Komponente("WARMWASSER", "Warmwasserspeicher", Kategorie.WAERMEQUELLE, m("0.60"), m("0.60"), m("1.60")),
        Komponente("KABEL_NYM5", "Kabel NYM-J 5×2,5", Kategorie.KABEL, m("0.02"), m("0.02"), m("0.02"), aussenDurchmesserMm = m("13")),
        Komponente("KABEL_NYM3", "Kabel NYM-J 3×1,5", Kategorie.KABEL, m("0.01"), m("0.01"), m("0.01"), aussenDurchmesserMm = m("9.5")),
        Komponente("LEERROHR_M25", "Leerrohr M25", Kategorie.ROHR, m("0.03"), m("0.03"), m("0.03"), aussenDurchmesserMm = m("25")),
        Komponente("LEERROHR_M20", "Leerrohr M20", Kategorie.ROHR, m("0.02"), m("0.02"), m("0.02"), aussenDurchmesserMm = m("20"))
    ).associateBy { it.schluessel }

    /** Nachschlagen; unbekannter Schlüssel → `null`, der Aufrufer entscheidet. */
    fun finde(schluessel: String): Komponente? = katalog[schluessel]
}
