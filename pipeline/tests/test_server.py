"""HTTP-Rundlauf: anlegen → hochladen → starten → Ergebnis, plus Lebenszyklus und Uploads."""

import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from raumwerk_pipeline.config import Config
from raumwerk_pipeline.jobs import LAEUFT
from raumwerk_pipeline.server import bildname_pruefen, erstellen


class ServerTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        cfg = Config(daten_dir=Path(self._tmp.name), simulieren=True).vorbereiten()
        self.server, self.worker = erstellen(cfg, port=0, host="127.0.0.1")
        self.store = self.server.kontext["store"]
        self.basis = f"http://127.0.0.1:{self.server.server_address[1]}"
        self._thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self._thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.stop()
        self._tmp.cleanup()

    def anfrage(self, methode, pfad, daten=None, roh=None):
        if daten is not None:
            roh = json.dumps(daten).encode()
        req = urllib.request.Request(self.basis + pfad, data=roh, method=methode)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, r.read(), r.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers

    def json(self, methode, pfad, daten=None, roh=None):
        code, inhalt, kopf = self.anfrage(methode, pfad, daten, roh)
        self.assertEqual(kopf["Access-Control-Allow-Origin"], "*")
        return code, json.loads(inhalt)

    def warten(self, job_id, status=("fertig", "fehler"), timeout=10):
        ende = time.time() + timeout
        while time.time() < ende:
            _, job = self.json("GET", f"/jobs/{job_id}")
            if job["status"] in status:
                return job
            time.sleep(0.05)
        self.fail(f"Auftrag {job_id} hängt in {job['status']}")

    def test_rundlauf_anlegen_hochladen_starten_ergebnis(self):
        code, job = self.json("POST", "/jobs", {
            "name": "HTTP-Test", "auto": False,
            "laser": [{"von": "A", "bis": "B", "distanzM": 4.2}],
            "bekannte_laengen": [{"art": "wand", "laenge": 4.2, "drehung": 90},
                                 {"art": "wand", "laenge": 3.0, "drehung": 90},
                                 {"art": "wand", "laenge": 4.2, "drehung": 90},
                                 {"art": "wand", "laenge": 3.0, "drehung": 90}],
        })
        self.assertEqual(code, 201)
        self.assertEqual(job["status"], "angelegt")
        jid = job["id"]
        time.sleep(0.3)                                   # auto:false → rechnet NICHT los
        self.assertEqual(self.json("GET", f"/jobs/{jid}")[1]["status"], "angelegt")

        code, antwort = self.json("POST", f"/jobs/{jid}/bild?name=IMG_001.jpg", roh=b"\xff\xd8bild")
        self.assertEqual((code, antwort["anzahl"]), (201, 1))
        self.assertEqual(self.json("GET", f"/jobs/{jid}/bilder")[1], ["IMG_001.jpg"])

        code, antwort = self.json("POST", f"/jobs/{jid}/start")
        self.assertEqual((code, antwort["status"]), (202, "wartet"))
        job = self.warten(jid)
        self.assertEqual(job["status"], "fertig", job["fehler"])

        code, res = self.json("GET", f"/jobs/{jid}/result")
        self.assertEqual(code, 200)
        self.assertIsInstance(res["massstab"]["skala_m_je_einheit"], float)
        self.assertIn("kontrollmass_abweichung_mm", res["massstab"])
        self.assertIsNone(res["massstab"]["kontrollmass_abweichung_mm"])   # ein Maß
        self.assertTrue(res["simuliert"])
        self.assertEqual(res["raum"]["umriss"], "[[0,0],[4.2,0],[4.2,3],[0,3]]")
        self.assertEqual(res["sfm"]["bilder"], 1)

        code, ply, kopf = self.anfrage("GET", f"/jobs/{jid}/wolke.ply")
        self.assertEqual(code, 200)
        self.assertTrue(ply.startswith(b"ply\nformat ascii 1.0\n"))

        # Liste für den Betrachter.
        code, liste = self.json("GET", "/jobs")
        self.assertEqual([j["id"] for j in liste], [jid])

    def test_neustart_ueber_start_rechnet_erneut(self):
        _, job = self.json("POST", "/jobs", {"laser": [{"distanzM": 4.2}]})
        erst = self.warten(job["id"])
        self.assertEqual(erst["status"], "fertig")
        code, _ = self.json("POST", f"/jobs/{job['id']}/start")
        self.assertEqual(code, 202)
        zweit = self.warten(job["id"])
        self.assertEqual(zweit["status"], "fertig")
        self.assertGreater(zweit["geaendert"], erst["geaendert"])
        self.assertIn("massstab", zweit["ergebnis"])           # nach Zurücksetzen neu gerechnet

    def test_fehlgeschlagener_auftrag_laesst_sich_neu_starten(self):
        _, job = self.json("POST", "/jobs", {"laser": []})
        self.assertEqual(self.warten(job["id"])["status"], "fehler")
        self.assertEqual(self.json("POST", f"/jobs/{job['id']}/start")[0], 202)
        self.assertEqual(self.warten(job["id"])["status"], "fehler")   # gleiche Eingabe, gleicher Grund

    def test_start_waehrend_lauf_wird_abgelehnt(self):
        _, job = self.json("POST", "/jobs", {"auto": False, "laser": [{"distanzM": 4.2}]})
        j = self.store.laden(job["id"])
        j.status = LAEUFT
        self.store.speichern(j)
        code, antwort = self.json("POST", f"/jobs/{job['id']}/start")
        self.assertEqual(code, 409)
        self.assertIn("läuft", antwort["fehler"])
        code, _ = self.json("POST", f"/jobs/{job['id']}/bild?name=a.jpg", roh=b"x")
        self.assertEqual(code, 409)

    def test_gefaehrliche_dateinamen_400_statt_abbruch(self):
        _, job = self.json("POST", "/jobs", {"auto": False, "laser": [{"distanzM": 4.2}]})
        for name in ("..", ".", "", "a%2Fb.jpg", "..%2F..%2Fjob.json", "a%5Cb.jpg",
                     "x%00.jpg", "%2Fetc%2Fpasswd"):
            with self.subTest(name=name):
                code, antwort = self.json("POST", f"/jobs/{job['id']}/bild?name={name}", roh=b"x" * 5000)
                self.assertEqual(code, 400)
                self.assertIn("fehler", antwort)
        self.assertEqual(self.store.bilder(job["id"]), [])
        # Harmlos bleibt erlaubt – auch Umlaute und Leerzeichen.
        code, _ = self.json("POST", f"/jobs/{job['id']}/bild?name=K%C3%BCche%201.jpg", roh=b"x")
        self.assertEqual(code, 201)
        self.assertEqual(self.store.bilder(job["id"]), ["Küche 1.jpg"])

    def test_ungueltige_anfragen(self):
        self.assertEqual(self.json("POST", "/jobs", roh=b"[1,2]")[0], 400)
        self.assertEqual(self.json("POST", "/jobs", roh=b"{kaputt")[0], 400)
        self.assertEqual(self.json("POST", "/jobs", {"laser": "4.2"})[0], 400)
        self.assertEqual(self.json("GET", "/jobs/..")[0], 404)
        self.assertEqual(self.json("GET", "/jobs/000000000000")[0], 404)
        self.assertEqual(self.json("POST", "/jobs/../start")[0], 404)
        self.assertEqual(self.json("GET", "/gibtsnicht")[0], 404)

    def test_statusseite_escaped_namen_und_zeigt_simulation(self):
        self.json("POST", "/jobs", {"name": "<script>alert(1)</script>", "auto": False})
        code, inhalt, _ = self.anfrage("GET", "/")
        text = inhalt.decode("utf-8")
        self.assertEqual(code, 200)
        self.assertNotIn("<script>alert", text)
        self.assertIn("&lt;script&gt;", text)
        self.assertIn("Simulationsmodus", text)

    def test_healthz(self):
        code, h = self.json("GET", "/healthz")
        self.assertEqual(code, 200)
        self.assertEqual(h["benoetigt"], ["colmap", "openmvs"])
        self.assertTrue(h["simuliert"])


class BildnameTest(unittest.TestCase):
    def test_regeln(self):
        for name in ("", ".", "..", "a/b", "a\\b", "a\x00b", "x" * 201):
            self.assertIsNotNone(bildname_pruefen(name), repr(name))
        for name in ("IMG_001.jpg", ".versteckt.jpg", "a..b.jpg", "Küche 1.jpg"):
            self.assertIsNone(bildname_pruefen(name), name)


if __name__ == "__main__":
    unittest.main()
