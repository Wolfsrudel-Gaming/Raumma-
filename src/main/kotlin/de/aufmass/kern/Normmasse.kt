package de.aufmass.kern

import java.math.BigDecimal

/**
 * Übliche Einbauhöhen und Öffnungsmaße.
 *
 * **Richtwerte, keine Vorschrift.** Sie ersparen das Nachmessen dort, wo
 * ohnehin nach Norm gebaut wurde, und sind überall überschreibbar. Im Bestand
 * sitzt vieles anders – das ist kein Mangel, sondern der Normalfall in einem
 * Gebäude, das älter ist als die aktuelle Fassung der Norm.
 *
 * Quellen der Vorgabewerte:
 *  - **DIN 18015-3** – Anordnung von Leitungen und Betriebsmitteln in
 *    Wohngebäuden: Steckdosen 0,30 m, Bedienelemente 1,05 m über Fußboden
 *  - **DIN 18040-1/-2** – barrierefreies Bauen: Bedienelemente 0,85 m; wer
 *    barrierefrei plant, ändert die Vorgabe entsprechend
 *  - **DIN 18101** – Türen für Wohnungen: Baurichtmaß Türblatt 0,885 m,
 *    lichte Durchgangshöhe 2,01 m
 *  - **ASR A1.3 / DIN EN 1838** – Rettungszeichen sichtbar oberhalb der Tür
 *
 * Wer das Paket in einem anderen Land oder für einen anderen Gebäudetyp
 * einsetzt, tauscht diese Tabelle aus. Sie ist bewusst die einzige Stelle mit
 * fachlichen Zahlen, damit man genau eine Datei anfassen muss.
 */
object Normmasse {

    /**
     * Katalog der Einbauarten mit Klartextnamen, in sinnvoller Reihenfolge für
     * eine Auswahlliste: erst Elektro, dann Daten, dann der Rest.
     *
     * Der Schlüssel wird gespeichert, der Wert nur angezeigt. Neue Arten
     * einfach ergänzen – das Datenmodell kennt keine feste Aufzählung.
     */
    val arten: Map<String, String> = linkedMapOf(
        "STECKDOSE" to "Steckdose",
        "STECKDOSE_2FACH" to "Steckdose 2-fach",
        "STECKDOSE_3FACH" to "Steckdose 3-fach",
        "STECKDOSE_CEE" to "CEE-Steckdose",
        "SCHALTER" to "Schalter",
        "WECHSELSCHALTER" to "Wechselschalter",
        "KREUZSCHALTER" to "Kreuzschalter",
        "TASTER" to "Taster",
        "DIMMER" to "Dimmer",
        "BEWEGUNGSMELDER" to "Bewegungsmelder",
        "LAMPE" to "Leuchte",
        "WANDLEUCHTE" to "Wandleuchte",
        "NOTLEUCHTE" to "Notleuchte / Rettungszeichen",
        "NETZWERKDOSE" to "Netzwerkdose",
        "ANTENNENDOSE" to "Antennendose",
        "TELEFONDOSE" to "Telefondose",
        "RAUCHMELDER" to "Rauchmelder",
        "SICHERUNGSKASTEN" to "Verteiler / Sicherungskasten",
        "KLIMA" to "Klimagerät (Innenteil)",
        "HEIZKOERPER" to "Heizkörper",
        "THERMOSTAT" to "Thermostat",
        "SANITAER" to "Sanitärobjekt",
        "KUECHE" to "Küchengerät",
        "SCHRANK" to "Schrank",
        "REGAL" to "Regal",
        "SONSTIGES" to "Sonstiges"
    )

    /**
     * Höhe der Mitte über dem fertigen Fußboden in Metern.
     * `null` = gehört an die Decke, dann zählt die Raumhöhe.
     */
    fun hoehe(art: String): BigDecimal? = when (art.uppercase()) {
        "STECKDOSE", "STECKDOSE_2FACH", "STECKDOSE_3FACH" -> BigDecimal("0.30")
        "STECKDOSE_CEE" -> BigDecimal("1.20")
        "SCHALTER", "WECHSELSCHALTER", "KREUZSCHALTER", "TASTER", "DIMMER" -> BigDecimal("1.05")
        "THERMOSTAT" -> BigDecimal("1.05")
        "BEWEGUNGSMELDER" -> BigDecimal("2.20")
        "NETZWERKDOSE", "ANTENNENDOSE", "TELEFONDOSE" -> BigDecimal("0.30")
        "WANDLEUCHTE" -> BigDecimal("2.00")
        "NOTLEUCHTE" -> BigDecimal("2.20")
        "SICHERUNGSKASTEN" -> BigDecimal("1.60")
        "KLIMA" -> BigDecimal("2.20")
        "SANITAER" -> BigDecimal("1.00")
        "HEIZKOERPER" -> BigDecimal("0.45")
        "RAUCHMELDER", "LAMPE" -> null
        else -> BigDecimal("1.20")
    }

    /** Wohin ein Objekt dieser Art normalerweise gehört. */
    fun befestigung(art: String): Befestigung = when (art.uppercase()) {
        "LAMPE", "RAUCHMELDER" -> Befestigung.DECKE
        "SCHRANK", "REGAL", "KUECHE" -> Befestigung.BODEN
        else -> Befestigung.WAND
    }

    /** Breite, Höhe und Brüstung einer Öffnung. */
    data class OeffnungsMass(
        val breiteM: BigDecimal,
        val hoeheM: BigDecimal,
        val bruestungM: BigDecimal
    )

    fun oeffnung(art: OeffnungsArt): OeffnungsMass = when (art) {
        OeffnungsArt.TUER -> OeffnungsMass(BigDecimal("0.885"), BigDecimal("2.01"), BigDecimal.ZERO)
        OeffnungsArt.DURCHGANG -> OeffnungsMass(BigDecimal("1.20"), BigDecimal("2.10"), BigDecimal.ZERO)
        OeffnungsArt.FENSTER -> OeffnungsMass(BigDecimal("1.20"), BigDecimal("1.40"), BigDecimal("0.90"))
        OeffnungsArt.TOR -> OeffnungsMass(BigDecimal("3.00"), BigDecimal("2.50"), BigDecimal.ZERO)
    }

    /**
     * Ergänzt fehlende Angaben einer Öffnung durch die üblichen Maße und
     * begrenzt sie auf den Raum.
     *
     * Die Begrenzung ist kein Schönheitsfehler, sondern nötig: Ein 2,50 m
     * hohes Tor in einer 2,00 m hohen Wand ließe von der Wand nichts stehen –
     * die Zerlegung in [Geometrie.wandStuecke] käme auf negative Höhen.
     */
    fun vervollstaendigen(o: Oeffnung, raum: Raum): Oeffnung {
        val m = oeffnung(o.art)
        val bruestung = if (o.bruestungM > BigDecimal.ZERO) o.bruestungM else m.bruestungM
        val hoehe = if (o.hoeheM > BigDecimal.ZERO) o.hoeheM else m.hoeheM
        val maxHoehe = (raum.hoeheM - bruestung).max(BigDecimal("0.20"))
        return o.copy(
            breiteM = if (o.breiteM > BigDecimal.ZERO) o.breiteM else m.breiteM,
            hoeheM = hoehe.min(maxHoehe),
            bruestungM = bruestung,
            abstandM = o.abstandM.max(BigDecimal.ZERO)
        )
    }

    /** Ergänzt Befestigung und Höhe eines Einbaus, wenn nichts angegeben ist. */
    fun vervollstaendigen(e: Einbau, raum: Raum): Einbau {
        val befestigung =
            if (e.befestigung == Befestigung.FREI && e.wandIndex != null) befestigung(e.art)
            else e.befestigung
        val hoehe = e.hoeheM ?: when (befestigung) {
            Befestigung.DECKE -> raum.hoeheM
            Befestigung.BODEN -> BigDecimal.ZERO
            else -> hoehe(e.art)
        }
        return e.copy(befestigung = befestigung, hoeheM = hoehe)
    }
}
