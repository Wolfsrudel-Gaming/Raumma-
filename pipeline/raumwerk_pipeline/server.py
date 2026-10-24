"""
HTTP-API der Pipeline.

Schmal gehalten und ohne Framework (nur Standardbibliothek), passend zu „läuft
auf vorhandener Infrastruktur, stört andere Dienste nicht". Aufnahme-App und
Betrachter sprechen hierüber mit dem Server:

    POST /jobs               Auftrag anlegen (JSON: name, laser[], bekannte_laengen[],
                             tags[], auto?) – auto:false → Zustand „angelegt"
    POST /jobs/<id>/bild     ein Bild hochladen (roh, ?name=…)
    POST /jobs/<id>/start    (neu) rechnen: setzt auf „wartet" und reiht ein
    GET  /jobs               alle Aufträge
    GET  /jobs/<id>          ein Auftrag mit Status/Ergebnis
    GET  /jobs/<id>/result   das Ergebnis-Manifest (result.json)
    GET  /jobs/<id>/bilder   Liste der hochgeladenen Bilder
    GET  /jobs/<id>/wolke.ply  die Punktwolke als ASCII-PLY (für den Betrachter)
    GET  /healthz            Bereitschaft + erkannte Werkzeuge
    GET  /                   kleine Statusseite

Alle Antworten tragen CORS-Header, damit der Browser-Viewer (andere Herkunft)
das Ergebnis laden kann. Fehler kommen immer als JSON mit `fehler` – nie als
abgerissene Verbindung.
"""

from __future__ import annotations

import html
import json
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import tools
from .config import Config
from .jobs import ANGELEGT, LAEUFT, WARTET, JobStore
from .stages import simuliert
from .worker import Worker

# Dateinamen, die nie als Bild gespeichert werden (Pfad-Ausbruch, Sonderfälle).
_VERBOTENE_NAMEN = {"", ".", ".."}


def erstellen(cfg: Config, port: int = 8781, host: str = "0.0.0.0"):
    """Server und Worker bauen, ohne zu blockieren (für `serve` und Tests)."""
    store = JobStore(cfg)
    worker = Worker(store, cfg).start()
    server = ThreadingHTTPServer((host, port), _Handler)
    server.daemon_threads = True
    server.kontext = {"store": store, "cfg": cfg, "worker": worker}  # type: ignore[attr-defined]
    return server, worker


def serve(cfg: Config, port: int = 8781) -> None:
    server, worker = erstellen(cfg, port)
    modus = "Simulation (keine echte Messung)" if simuliert(cfg) else "echt"
    print(f"RAUMWERK-Pipeline auf :{port}  ·  Modus: {modus}  ·  Worker: {cfg.worker}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        worker.stop()


def bildname_pruefen(name: str) -> str | None:
    """Fehlertext, wenn der Name kein harmloser Dateiname ist – sonst None."""
    if name in _VERBOTENE_NAMEN:
        return "ungültiger Dateiname"
    if any(z in name for z in ("/", "\\", "\x00")):
        return "Dateiname darf keine Pfadtrenner oder NUL enthalten"
    if len(name.encode("utf-8")) > 200:
        return "Dateiname zu lang"
    return None


class _Handler(BaseHTTPRequestHandler):
    server_version = "RaumwerkPipeline/0.2"

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

    def _koerper(self) -> bytes:
        """Den Rumpf genau einmal lesen (auch vor einer Ablehnung – sonst reißt
        die Verbindung ab, während der Client noch sendet)."""
        if not hasattr(self, "_roh"):
            try:
                laenge = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                laenge = -1
            if laenge < 0:
                raise _Abgelehnt(400, "ungültige Content-Length")
            self._roh = self.rfile.read(laenge) if laenge else b""
        return self._roh

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    @property
    def kontext(self):
        return self.server.kontext  # type: ignore[attr-defined]

    def log_message(self, *args):   # ruhiger Log
        pass

    def _sicher(self, funktion) -> None:
        try:
            funktion()
        except _Abgelehnt as e:
            self._json(e.code, {"fehler": e.text})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # noqa: BLE001 – Klartext statt abgerissener Verbindung
            traceback.print_exc(file=sys.stderr)
            try:
                self._json(500, {"fehler": f"interner Fehler: {e}"})
            except OSError:
                pass

    def do_GET(self):
        self._sicher(self._get)

    def do_POST(self):
        self._sicher(self._post)

    # ------------------------------------------------------------ GET

    def _get(self):
        store: JobStore = self.kontext["store"]
        cfg: Config = self.kontext["cfg"]
        weg = urlparse(self.path).path.rstrip("/")

        if weg in ("", "/"):
            return self._text(200, _statusseite(store, simuliert(cfg)))
        if weg == "/healthz":
            return self._json(200, {
                "ok": True, "simuliert": simuliert(cfg),
                "werkzeuge": tools.vorhanden(), "benoetigt": list(tools.BENOETIGT),
            })
        if weg == "/jobs":
            return self._json(200, [j.dict() for j in store.alle()])
        teile = weg.split("/")
        if len(teile) in (3, 4) and teile[1] == "jobs":
            job = store.laden(teile[2])
            if not job:
                return self._json(404, {"fehler": "Auftrag nicht gefunden"})
            unter = teile[3] if len(teile) == 4 else None
            if unter is None:
                return self._json(200, job.dict())
            if unter == "result":
                return self._json(200, job.ergebnis)
            if unter == "bilder":
                return self._json(200, store.bilder(job.id))
            if unter == "wolke.ply":
                pfad = store.dir(job.id) / "wolke.ply"
                if not pfad.exists():
                    return self._json(404, {"fehler": "keine Wolke"})
                return self._bytes(200, pfad.read_bytes(), "text/plain; charset=utf-8")
        return self._json(404, {"fehler": "unbekannter Pfad"})

    # ----------------------------------------------------------- POST

    def _post(self):
        store: JobStore = self.kontext["store"]
        worker: Worker = self.kontext["worker"]
        url = urlparse(self.path)
        teile = url.path.rstrip("/").split("/")

        # Bild-Upload: rohe Bytes, Dateiname als ?name=…
        if len(teile) == 4 and teile[1] == "jobs" and teile[3] == "bild":
            roh = self._koerper()
            job = store.laden(teile[2])
            if not job:
                return self._json(404, {"fehler": "Auftrag nicht gefunden"})
            name = parse_qs(url.query, keep_blank_values=True).get("name", ["bild.jpg"])[0]
            grund = bildname_pruefen(name)
            if grund:
                return self._json(400, {"fehler": grund, "name": name})
            if job.status == LAEUFT:
                return self._json(409, {"fehler": "Auftrag läuft gerade – Bilder erst danach hochladen"})
            (store.bilder_dir(job.id) / name).write_bytes(roh)
            return self._json(201, {"gespeichert": name, "anzahl": len(store.bilder(job.id))})

        # (Neu-)Start: zurück auf „wartet", altes Ergebnis weg, einreihen.
        if len(teile) == 4 and teile[1] == "jobs" and teile[3] == "start":
            self._koerper()
            with store.sperre:
                job = store.laden(teile[2])
                if not job:
                    return self._json(404, {"fehler": "Auftrag nicht gefunden"})
                if job.status == LAEUFT:
                    return self._json(409, {"fehler": "Auftrag läuft bereits", "id": job.id})
                store.zuruecksetzen(job)
            worker.einreihen(job.id)
            return self._json(202, {"gestartet": job.id, "status": WARTET})

        # Auftrag anlegen.
        if url.path.rstrip("/") == "/jobs":
            try:
                daten = json.loads(self._koerper() or b"{}")
            except ValueError:
                return self._json(400, {"fehler": "ungültiges JSON"})
            if not isinstance(daten, dict):
                return self._json(400, {"fehler": "JSON-Objekt erwartet"})
            eingabe = {}
            for feld in ("laser", "bekannte_laengen", "tags"):
                wert = daten.get(feld) or []
                if not isinstance(wert, list):
                    return self._json(400, {"fehler": f"„{feld}“ muss eine Liste sein"})
                eingabe[feld] = wert
            auto = daten.get("auto", True) not in (False, 0, "false", "0", "nein")
            job = store.neu(str(daten.get("name") or "Auftrag"), eingabe,
                            status=WARTET if auto else ANGELEGT)
            # auto=false: nicht rechnen, erst Bilder hochladen, dann /start.
            if auto:
                worker.einreihen(job.id)
            return self._json(201, job.dict())

        return self._json(404, {"fehler": "unbekannter Pfad"})


class _Abgelehnt(Exception):
    def __init__(self, code: int, text: str):
        super().__init__(text)
        self.code, self.text = code, text


def _statusseite(store: JobStore, sim: bool) -> str:
    e = html.escape
    zeilen = "".join(
        f"<tr><td>{e(j.name)}</td><td>{e(j.status)}</td><td>{e(j.stufe)}</td>"
        f"<td>{int(j.fortschritt * 100)}%</td><td><code>{e(j.id)}</code></td></tr>"
        for j in store.alle()[:50]
    ) or "<tr><td colspan='5'>noch keine Aufträge</td></tr>"
    modus = ("<p class='sim'><b>Simulationsmodus</b> – COLMAP/OpenMVS fehlen. Wolke und "
             "Maßstab sind Demo-Werte, keine echte Messung.</p>") if sim else ""
    return (
        "<!doctype html><meta charset='utf-8'><title>RAUMWERK-Pipeline</title>"
        "<style>body{font:14px system-ui;margin:2rem;color:#1d2a2a}"
        "h1{color:#2b7a78}table{border-collapse:collapse}td,th{border-bottom:1px solid #ddd;"
        "padding:6px 12px;text-align:left}code{font-size:12px;color:#667}"
        ".sim{background:#fff4d6;padding:8px 12px;border-left:4px solid #c98a00}</style>"
        "<h1>RAUMWERK · Verarbeitungs-Pipeline</h1>"
        "<p>Schicht ② – Server (CPU). <code>POST /jobs</code> legt einen Auftrag an.</p>"
        f"{modus}"
        "<table><tr><th>Auftrag</th><th>Status</th><th>Stufe</th><th>Fortschritt</th><th>ID</th></tr>"
        f"{zeilen}</table>"
    )
