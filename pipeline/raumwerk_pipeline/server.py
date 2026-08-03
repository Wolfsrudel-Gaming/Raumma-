"""
HTTP-API der Pipeline.

Schmal gehalten und ohne Framework (nur Standardbibliothek), passend zu „läuft
auf vorhandener Infrastruktur, stört andere Dienste nicht". Aufnahme-App und
Betrachter sprechen hierüber mit dem Server:

    POST /jobs            Auftrag anlegen (JSON: name, laser[], tags[])
    GET  /jobs            alle Aufträge
    GET  /jobs/<id>       ein Auftrag mit Status/Ergebnis
    GET  /jobs/<id>/result   das Ergebnis-Manifest (result.json)
    GET  /healthz         Bereitschaft + erkannte Werkzeuge
    GET  /                kleine Statusseite
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import tools
from .config import Config
from .jobs import JobStore
from .stages import simuliert
from .worker import Worker


def serve(cfg: Config, port: int = 8781) -> None:
    store = JobStore(cfg)
    worker = Worker(store, cfg).start()
    server = ThreadingHTTPServer(("0.0.0.0", port), _Handler)
    server.kontext = {"store": store, "cfg": cfg, "worker": worker}  # type: ignore[attr-defined]
    modus = "Simulation" if simuliert(cfg) else "echt"
    print(f"RAUMWERK-Pipeline auf :{port}  ·  Modus: {modus}  ·  Worker: {cfg.worker}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        worker.stop()


class _Handler(BaseHTTPRequestHandler):
    server_version = "RaumwerkPipeline/0.1"

    # ------------------------------------------------------- Antworten

    def _json(self, code: int, obj) -> None:
        roh = json.dumps(obj, indent=2, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(roh)))
        self.end_headers()
        self.wfile.write(roh)

    def _text(self, code: int, text: str, typ: str = "text/html; charset=utf-8") -> None:
        roh = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(roh)))
        self.end_headers()
        self.wfile.write(roh)

    @property
    def kontext(self):
        return self.server.kontext  # type: ignore[attr-defined]

    def log_message(self, *args):   # ruhiger Log
        pass

    # ------------------------------------------------------------ GET

    def do_GET(self):
        store: JobStore = self.kontext["store"]
        cfg: Config = self.kontext["cfg"]
        weg = self.path.split("?")[0].rstrip("/")

        if weg in ("", "/"):
            return self._text(200, _statusseite(store))
        if weg == "/healthz":
            return self._json(200, {
                "ok": True, "simuliert": simuliert(cfg),
                "werkzeuge": tools.vorhanden(),
            })
        if weg == "/jobs":
            return self._json(200, [j.dict() for j in store.alle()])
        if weg.startswith("/jobs/"):
            teile = weg.split("/")
            job = store.laden(teile[2])
            if not job:
                return self._json(404, {"fehler": "Auftrag nicht gefunden"})
            if len(teile) >= 4 and teile[3] == "result":
                return self._json(200, job.ergebnis)
            return self._json(200, job.dict())
        return self._json(404, {"fehler": "unbekannter Pfad"})

    # ----------------------------------------------------------- POST

    def do_POST(self):
        store: JobStore = self.kontext["store"]
        worker: Worker = self.kontext["worker"]
        if self.path.rstrip("/") != "/jobs":
            return self._json(404, {"fehler": "unbekannter Pfad"})
        try:
            laenge = int(self.headers.get("Content-Length", 0))
            daten = json.loads(self.rfile.read(laenge) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"fehler": "ungültiges JSON"})

        eingabe = {
            "laser": daten.get("laser", []),
            "tags": daten.get("tags", []),
        }
        job = store.neu(daten.get("name", "Auftrag"), eingabe)
        worker.einreihen(job.id)
        return self._json(201, job.dict())


def _statusseite(store: JobStore) -> str:
    zeilen = "".join(
        f"<tr><td>{j.name}</td><td>{j.status}</td><td>{j.stufe}</td>"
        f"<td>{int(j.fortschritt * 100)}%</td><td><code>{j.id}</code></td></tr>"
        for j in store.alle()[:50]
    ) or "<tr><td colspan='5'>noch keine Aufträge</td></tr>"
    return (
        "<!doctype html><meta charset='utf-8'><title>RAUMWERK-Pipeline</title>"
        "<style>body{font:14px system-ui;margin:2rem;color:#1d2a2a}"
        "h1{color:#2b7a78}table{border-collapse:collapse}td,th{border-bottom:1px solid #ddd;"
        "padding:6px 12px;text-align:left}code{font-size:12px;color:#667}</style>"
        "<h1>RAUMWERK · Verarbeitungs-Pipeline</h1>"
        "<p>Schicht ② – Server (CPU). <code>POST /jobs</code> legt einen Auftrag an.</p>"
        "<table><tr><th>Auftrag</th><th>Status</th><th>Stufe</th><th>Fortschritt</th><th>ID</th></tr>"
        f"{zeilen}</table>"
    )
