"""
HTTP-API der Pipeline.

Schmal gehalten und ohne Framework (nur Standardbibliothek), passend zu „läuft
auf vorhandener Infrastruktur, stört andere Dienste nicht". Aufnahme-App und
Betrachter sprechen hierüber mit dem Server:

    POST /jobs               Auftrag anlegen (JSON: name, laser[], tags[], auto?)
    POST /jobs/<id>/bild     ein Bild hochladen (roh, ?name=…)
    POST /jobs/<id>/start    Verarbeitung anstoßen (nach dem Bild-Upload)
    GET  /jobs               alle Aufträge
    GET  /jobs/<id>          ein Auftrag mit Status/Ergebnis
    GET  /jobs/<id>/result   das Ergebnis-Manifest (result.json)
    GET  /jobs/<id>/bilder   Liste der hochgeladenen Bilder
    GET  /jobs/<id>/wolke.ply  die Punktwolke (für den Betrachter)
    GET  /healthz            Bereitschaft + erkannte Werkzeuge
    GET  /                   kleine Statusseite

Alle Antworten tragen CORS-Header, damit der Browser-Viewer (andere Herkunft)
das Ergebnis laden kann.
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

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _bytes(self, code: int, roh: bytes, typ: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(roh)))
        self._cors()
        self.end_headers()
        self.wfile.write(roh)

    def _json(self, code: int, obj) -> None:
        self._bytes(code, json.dumps(obj, indent=2, ensure_ascii=False).encode("utf-8"),
                    "application/json; charset=utf-8")

    def _text(self, code: int, text: str, typ: str = "text/html; charset=utf-8") -> None:
        self._bytes(code, text.encode("utf-8"), typ)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

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
            unter = teile[3] if len(teile) >= 4 else None
            if unter == "result":
                return self._json(200, job.ergebnis)
            if unter == "bilder":
                return self._json(200, store.bilder(job.id))
            if unter == "wolke.ply":
                pfad = store.dir(job.id) / "wolke.ply"
                if not pfad.exists():
                    return self._json(404, {"fehler": "keine Wolke"})
                return self._bytes(200, pfad.read_bytes(), "text/plain; charset=utf-8")
            return self._json(200, job.dict())
        return self._json(404, {"fehler": "unbekannter Pfad"})

    # ----------------------------------------------------------- POST

    def do_POST(self):
        store: JobStore = self.kontext["store"]
        worker: Worker = self.kontext["worker"]
        pfad = self.path.split("?")[0].rstrip("/")
        laenge = int(self.headers.get("Content-Length", 0))

        # Bild-Upload: rohe Bytes, Dateiname als ?name=…
        if pfad.startswith("/jobs/") and pfad.endswith("/bild"):
            job_id = pfad.split("/")[2]
            if not store.laden(job_id):
                return self._json(404, {"fehler": "Auftrag nicht gefunden"})
            from urllib.parse import parse_qs, urlparse
            name = (parse_qs(urlparse(self.path).query).get("name", ["bild.jpg"])[0])
            name = name.replace("/", "_").replace("\\", "_")   # kein Pfad-Ausbruch
            (store.bilder_dir(job_id) / name).write_bytes(self.rfile.read(laenge))
            return self._json(201, {"gespeichert": name, "anzahl": len(store.bilder(job_id))})

        # Verarbeitung anstoßen (nach dem Upload).
        if pfad.startswith("/jobs/") and pfad.endswith("/start"):
            job_id = pfad.split("/")[2]
            job = store.laden(job_id)
            if not job:
                return self._json(404, {"fehler": "Auftrag nicht gefunden"})
            worker.einreihen(job_id)
            return self._json(202, {"gestartet": job_id})

        # Auftrag anlegen.
        if pfad == "/jobs":
            try:
                daten = json.loads(self.rfile.read(laenge) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"fehler": "ungültiges JSON"})
            eingabe = {"laser": daten.get("laser", []), "tags": daten.get("tags", [])}
            job = store.neu(daten.get("name", "Auftrag"), eingabe)
            # auto=false: nicht sofort rechnen, erst Bilder hochladen, dann /start.
            if daten.get("auto", True):
                worker.einreihen(job.id)
            return self._json(201, job.dict())

        return self._json(404, {"fehler": "unbekannter Pfad"})


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
