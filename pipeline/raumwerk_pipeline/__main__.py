"""
Einstieg: `python -m raumwerk_pipeline <befehl>`.

    serve [port]     HTTP-API + Worker starten
    demo [variante]  einen Beispiel-Auftrag anlegen und (synchron) durchrechnen;
                     variante „beispiel" (Vorgabe) oder „ein-mass" (nur Kamerahöhe)
    tools            zeigt, welche Werkzeuge erkannt wurden
"""

from __future__ import annotations

import json
import sys

from .config import Config
from .jobs import JobStore
from .pipeline import run_job
from .stages import simuliert
from . import tools


DEMO_EINGABEN = {
    # Fünf Lasermaße (das A–C-Maß ist ausdrücklich das Kontrollmaß), dazu der
    # Raum als Bandmaß-Zug (Wandlänge + Abbiegung) und die Raumhöhe.
    "beispiel": {
        "laser": [
            {"von": "A", "bis": "B", "distanzM": 4.20},
            {"von": "B", "bis": "C", "distanzM": 3.00},
            {"von": "C", "bis": "D", "distanzM": 2.50},
            {"von": "A", "bis": "D", "distanzM": 5.15},
            {"von": "A", "bis": "C", "distanzM": 5.16, "kontrolle": True},
        ],
        "bekannte_laengen": [
            {"art": "wand", "laenge": 4.20, "drehung": 90},
            {"art": "wand", "laenge": 3.00, "drehung": 90},
            {"art": "wand", "laenge": 4.20, "drehung": 90},
            {"art": "wand", "laenge": 3.00, "drehung": 90},
            {"art": "raumhoehe", "laenge": 2.50},
        ],
        "tags": [{"art": "ZAEHLERSCHRANK"}, {"art": "KABEL_NYM5"}],
    },
    # Ohne Laser, ohne Würfel: eine einzige bekannte Länge (Kamerahöhe).
    "ein-mass": {
        "bekannte_laengen": [{"art": "kamerahoehe", "laenge": 1.45}],
        "tags": [],
    },
}


def _demo(cfg: Config, variante: str = "beispiel") -> int:
    if variante not in DEMO_EINGABEN:
        print(f"Unbekannte Demo „{variante}“ – verfügbar: {', '.join(DEMO_EINGABEN)}")
        return 2
    store = JobStore(cfg)
    job = store.neu(f"Demo-Technikraum ({variante})", DEMO_EINGABEN[variante])
    run_job(job, store, cfg)
    fertig = store.laden(job.id)
    print(json.dumps(fertig.dict(), indent=2, ensure_ascii=False))
    return 0 if fertig.status == "fertig" else 1


def main(argv: list[str]) -> int:
    cfg = Config().vorbereiten()
    befehl = argv[1] if len(argv) > 1 else "serve"

    if befehl == "serve":
        from .server import serve
        port = int(argv[2]) if len(argv) > 2 else 8781
        serve(cfg, port)
        return 0
    if befehl == "demo":
        return _demo(cfg, argv[2] if len(argv) > 2 else "beispiel")
    if befehl == "tools":
        print(json.dumps({"vorhanden": tools.vorhanden(), "benoetigt": list(tools.BENOETIGT),
                          "simuliert": simuliert(cfg)}, indent=2))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
