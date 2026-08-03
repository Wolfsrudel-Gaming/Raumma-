"""
Einstieg: `python -m raumwerk_pipeline <befehl>`.

    serve [port]   HTTP-API + Worker starten
    demo           einen Beispiel-Auftrag anlegen und (synchron) durchrechnen
    tools          zeigt, welche Werkzeuge erkannt wurden
"""

from __future__ import annotations

import json
import sys

from .config import Config
from .jobs import JobStore
from .pipeline import run_job
from . import tools


def _demo(cfg: Config) -> int:
    store = JobStore(cfg)
    # Vier Laser-Anker (echte Meter) + ein fünftes als Kontrollmaß, plus zwei Tags.
    eingabe = {
        "laser": [
            {"von": "A", "bis": "B", "distanzM": 4.20},
            {"von": "B", "bis": "C", "distanzM": 3.00},
            {"von": "C", "bis": "D", "distanzM": 2.50},
            {"von": "A", "bis": "D", "distanzM": 5.15},
            {"von": "A", "bis": "C", "distanzM": 5.16},  # Kontrollmaß
        ],
        "tags": [{"art": "ZAEHLERSCHRANK"}, {"art": "KABEL_NYM5"}],
    }
    job = store.neu("Demo-Technikraum", eingabe)
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
        return _demo(cfg)
    if befehl == "tools":
        print(json.dumps({"vorhanden": tools.vorhanden(), "simuliert": cfg.simulieren}, indent=2))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
