"""
Maß-Solver – der metrische Maßstab aus bekannten Längen (Konzept §6.2, §7).

Die Foto-Rekonstruktion liefert die Struktur, aber in willkürlichen Einheiten.
Die belastbaren Zahlen kommen aus **bekannten Längen**: Lasermaße, ein mit dem
Bandmaß genommenes Wandstück oder die Kamerahöhe über dem Boden. Jede davon
ist ein Anker (Modellabstand, echte Länge); zusammen legen sie in einer
Ausgleichsrechnung den Maßstab fest.

**Ein einziges bekanntes Maß reicht für den Maßstab** – ein Referenzwürfel ist
nicht nötig. Ab zwei Maßen wird eines als **Kontrollmaß** zurückgehalten und
liefert die echte Genauigkeitszahl des Auftrags (§7). Mit nur einem Maß gibt es
diese Zahl nicht; sie wird dann als `None` mit Begründung gemeldet, nie
geschätzt.

Bewusst reine Standardbibliothek, keine numpy-Abhängigkeit: Der Skalenfaktor
folgt in geschlossener Form aus einer Ausgleichsrechnung durch den Ursprung,
das braucht keine Matrixzerlegung.

Leitplanke des Konzepts (§1): Freiräume werden **konservativ** ausgegeben –
gemessener Wert minus Toleranz, auf ganze Zentimeter abgerundet. Diese Datei
ist die serverseitige Entsprechung zu `Pruefung.konservativ` im Kern.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field


@dataclass
class SkalenErgebnis:
    """Ergebnis der Maßstabsbestimmung."""

    skala: float                    # Meter je Modelleinheit
    rms_mm: float                   # Streuung der Anker (Qualitätsaussage)
    n_verwendet: int
    n_verworfen: int
    verworfen: list = field(default_factory=list)  # Indizes ausgeschiedener Anker

    def metrisch_m(self, modell_laenge: float) -> float:
        """Eine Modelllänge in Meter umrechnen."""
        return self.skala * modell_laenge


def skala_aus_distanzen(
    anker: list[tuple[float, float]],
    robust: bool = True,
    ausreisser_faktor: float = 3.0,
) -> SkalenErgebnis:
    """
    Bestimmt den Maßstab aus Paaren ``(modell_distanz, laser_distanz_m)``.

    Der Maßstab ``s`` minimiert ``Σ (s·d_modell − d_laser)²`` und ergibt sich in
    geschlossener Form zu ``s = Σ(d_modell·d_laser) / Σ(d_modell²)`` – eine
    Ausgleichsgerade durch den Ursprung.

    Mit ``robust`` läuft eine zweite Runde, die Anker mit einem Residuum über
    ``ausreisser_faktor × RMS`` verwirft (ein grob falsch gemessener oder falsch
    zugeordneter Punkt soll den Maßstab nicht verziehen).
    """
    gueltig = [(dm, dl) for dm, dl in anker if dm > 1e-9 and dl > 1e-9]
    if not gueltig:
        raise ValueError("Keine brauchbaren Anker (Distanzen müssen positiv sein).")

    def loesen(paare):
        zaehler = sum(dm * dl for dm, dl in paare)
        nenner = sum(dm * dm for dm, _ in paare)
        return zaehler / nenner if nenner > 1e-12 else 0.0

    verworfen: list[int] = []
    verwendet = gueltig

    # Ausreißer über den **Median der implizierten Maßstäbe** (dl/dm) statt über
    # das RMS erkennen: Ein einzelner grob falscher Anker bläht das RMS so auf,
    # dass er selbst durch die Schwelle rutscht. Der Median ist dagegen robust.
    if robust and len(gueltig) >= 3:
        skalen = [dl / dm for dm, dl in gueltig]
        s_med = _median(skalen)
        abweichung = [abs(s - s_med) for s in skalen]
        mad = _median(sorted(abweichung))
        tor = max(mad * 1.4826 * ausreisser_faktor, s_med * 0.03)  # 3 % als Boden
        behalten = [p for p, a in zip(gueltig, abweichung) if a <= tor]
        verworfen = [i for i, a in enumerate(abweichung) if a > tor]
        if behalten and len(behalten) < len(gueltig):
            verwendet = behalten
        else:
            verworfen = []

    s = loesen(verwendet)
    return SkalenErgebnis(
        skala=s,
        rms_mm=_rms_mm(s, verwendet),
        n_verwendet=len(verwendet),
        n_verworfen=len(verworfen),
        verworfen=verworfen,
    )


def _median(werte: list[float]) -> float:
    if not werte:
        return 0.0
    s = sorted(werte)
    n = len(s)
    mitte = n // 2
    return s[mitte] if n % 2 else (s[mitte - 1] + s[mitte]) / 2


def _rms_mm(skala: float, paare: list[tuple[float, float]]) -> float:
    if not paare:
        return 0.0
    quadr = sum((skala * dm - dl) ** 2 for dm, dl in paare)
    return math.sqrt(quadr / len(paare)) * 1000.0


@dataclass
class Anker:
    """Eine bekannte Länge mit ihrem Abstand im Modell."""

    modell: float                   # Abstand in Modelleinheiten (aus der Rekonstruktion)
    laenge_m: float                 # echte Länge in Metern (Laser, Bandmaß, Kamerahöhe)
    quelle: str = "laser"           # laser | band | kamerahoehe | raumhoehe | …
    bezeichnung: str = ""
    kontrolle: bool = False         # ausdrücklich als Kontrollmaß vorgesehen


@dataclass
class Massstab:
    """Maßstab samt Kontrollmaß – oder der ehrliche Hinweis, dass es keines gibt."""

    skala: float
    rms_mm: float | None            # None: mit nur einem verwendeten Anker nicht aussagekräftig
    verwendet: list                 # Anker, die den Maßstab bestimmen
    verworfen: list                 # Anker, die der robuste Schritt aussortiert hat
    kontrolle: Anker | None
    kontrollmass_abweichung_mm: float | None
    hinweise: list = field(default_factory=list)


HINWEIS_EIN_MASS = ("Nur ein bekanntes Maß – Maßstab ohne Kontrollmaß. Ein zweites Maß "
                    "(Laser, Bandmaß oder Kamerahöhe) liefert die Genauigkeitszahl.")


def massstab_bestimmen(anker: list[Anker], robust: bool = True) -> Massstab:
    """
    Maßstab aus beliebig vielen bekannten Längen – ab **einer**.

    - 1 Anker: Maßstab = Länge / Modellabstand; kein Kontrollmaß (None + Hinweis).
    - ≥ 2 Anker: der als ``kontrolle`` markierte (sonst der letzte) wird
      zurückgehalten, die übrigen bestimmen den Maßstab; die Abweichung des
      zurückgehaltenen ist die Genauigkeitszahl.
    """
    # Gleiche Schwelle wie in skala_aus_distanzen, damit dessen Indizes passen.
    gueltig = [a for a in anker if a.modell > 1e-9 and a.laenge_m > 1e-9]
    if not gueltig:
        raise ValueError("Kein bekanntes Maß – mindestens eine bekannte Länge (Laser, "
                         "Bandmaß oder Kamerahöhe) mit Modellabstand ist nötig.")
    hinweise: list[str] = []
    kontrolle = None
    rechnen = gueltig
    if len(gueltig) >= 2:
        markiert = [a for a in gueltig if a.kontrolle]
        kontrolle = markiert[0] if markiert else gueltig[-1]
        rechnen = [a for a in gueltig if a is not kontrolle]
    else:
        hinweise.append(HINWEIS_EIN_MASS)

    erg = skala_aus_distanzen([(a.modell, a.laenge_m) for a in rechnen], robust=robust)
    verworfen = [rechnen[i] for i in erg.verworfen]
    verwendet = [a for a in rechnen if not any(a is v for v in verworfen)]
    if verworfen:
        hinweise.append(f"{len(verworfen)} Maß(e) als Ausreißer verworfen: "
                        + ", ".join(a.bezeichnung or a.quelle for a in verworfen) + ".")

    abw = None
    if kontrolle is not None:
        abw = kontrollmass_abweichung_mm(erg.skala, kontrolle.modell, kontrolle.laenge_m)
    return Massstab(
        skala=erg.skala,
        rms_mm=erg.rms_mm if len(verwendet) >= 2 else None,
        verwendet=verwendet,
        verworfen=verworfen,
        kontrolle=kontrolle,
        kontrollmass_abweichung_mm=abw,
        hinweise=hinweise,
    )


def kontrollmass_abweichung_mm(skala: float, modell_distanz: float, laser_distanz_m: float) -> float:
    """
    Abweichung eines **Kontrollmaßes** in Millimetern (Konzept §7): eine Strecke,
    die *nicht* in die Rechnung eingeflossen ist, mit dem Modell verglichen –
    das ergibt die reale Genauigkeitszahl je Auftrag und schafft Vertrauen.
    """
    return abs(skala * modell_distanz - laser_distanz_m) * 1000.0


def konservativ_m(wert_m: float, toleranz_m: float = 0.02) -> float:
    """
    Konservative untere Schranke: (Wert − Toleranz), auf ganze Zentimeter
    **abgerundet**, nie negativ. Spiegelt `Pruefung.konservativ` aus dem Kern,
    damit Server und Browser dieselbe Zahl liefern.
    """
    cm = math.floor((wert_m - toleranz_m) * 100.0 + 1e-9) / 100.0
    return max(0.0, round(cm, 2))
