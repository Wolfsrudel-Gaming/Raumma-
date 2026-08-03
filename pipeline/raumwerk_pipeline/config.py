"""
Konfiguration der Pipeline.

Alles, was die Verarbeitung begrenzt oder verortet, steht an einer Stelle –
das ist die serverseitige Entsprechung zu „Realistische Ressourcen" aus dem
Konzept (§4). Werte lassen sich per Umgebungsvariable überschreiben, damit der
Container ohne Codeänderung eingestellt werden kann.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _int(name: str, vorgabe: int) -> int:
    try:
        return int(os.environ.get(name, vorgabe))
    except ValueError:
        return vorgabe


def _nacht_aus_env() -> "tuple[int, int] | None":
    roh = os.environ.get("RAUMWERK_NACHT")
    if not roh:
        return None
    try:
        start, ende = (int(x) for x in roh.split(","))
        return (start % 24, ende % 24)
    except (ValueError, TypeError):
        return None


@dataclass
class Config:
    # Wo Jobs und Ergebnisse liegen. 500 GB füllen sich schnell – die
    # Lebenszyklusregeln (Konzept §11) hängen an diesem Pfad.
    daten_dir: Path = Path(os.environ.get("RAUMWERK_DATEN", "./daten"))

    # Ressourcendeckel. Der Server wird geteilt (Konzept §11): die Pipeline
    # darf bestehende Dienste nie aushungern.
    max_cpus: int = _int("RAUMWERK_MAX_CPUS", 2)
    max_ram_mb: int = _int("RAUMWERK_MAX_RAM_MB", 4096)
    nice_level: int = _int("RAUMWERK_NICE", 15)        # niedrige Priorität
    ionice_klasse: int = _int("RAUMWERK_IONICE", 3)    # 3 = idle (nur wenn frei)

    # Nur ein Worker – schwere Jobs laufen nacheinander, nie parallel.
    worker: int = 1

    # Zeitfenster „bevorzugt nachts": (start_stunde, end_stunde) in lokaler Zeit,
    # aus RAUMWERK_NACHT="22,6". Außerhalb wartet der Worker. None = jederzeit.
    nacht_fenster: tuple[int, int] | None = _nacht_aus_env()

    # Simulationsmodus: ohne COLMAP/OpenMVS durchlaufen (für Entwicklung/CI).
    # None = automatisch (simulieren, wenn die Werkzeuge fehlen).
    simulieren: bool | None = (
        None if "RAUMWERK_SIMULIEREN" not in os.environ
        else os.environ["RAUMWERK_SIMULIEREN"] not in ("0", "false", "nein")
    )

    def jobs_dir(self) -> Path:
        return self.daten_dir / "jobs"

    def vorbereiten(self) -> "Config":
        self.jobs_dir().mkdir(parents=True, exist_ok=True)
        return self
