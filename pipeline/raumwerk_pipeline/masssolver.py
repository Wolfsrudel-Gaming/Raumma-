"""
Maß-Solver – der metrische Maßstab aus den Laser-Ankern (Konzept §6.2, §7).

Die Foto-Rekonstruktion liefert die Struktur, aber in willkürlichen Einheiten.
Die belastbaren Zahlen kommen aus den **Lasermaßen**: echte mm-Punkt-zu-Punkt-
Werte, die als *harte Constraints* in eine Ausgleichsrechnung gehen und den
Maßstab festlegen.

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
