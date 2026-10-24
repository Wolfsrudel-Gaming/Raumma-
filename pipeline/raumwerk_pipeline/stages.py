"""
Die Stufen der Verarbeitung (Konzept §6.2).

    Erfassung → [ Raum → Eingabe → SfM → Dichte Wolke → Maß-Solver → Komponenten → Semantik ] → Ergebnis

Jede Stufe ist eine Funktion mit gleicher Form. Sind COLMAP und OpenMVS
installiert, laufen sie (Kommandos in `tools.py`); sonst läuft die Pipeline im
**Simulationsmodus** durch, damit Entwicklung und CI end-to-end prüfbar bleiben.

Ehrlichkeitsregeln (die wichtigste Eigenschaft dieser Datei):

- **Simulation ist überall gekennzeichnet.** Jede Ausgabe, die aus der
  Simulation stammt, trägt `"simuliert": true` und den Hinweis
  „Simulation – keine echte Messung"; die Demo-Wolke trägt es im PLY-Kopf.
  Ein Kontrollmaß wird in der Simulation **nicht** als Genauigkeitszahl
  gemeldet (`kontrollmass_abweichung_mm: null`) – es wurde nichts gemessen.
- **Im echten Lauf wird kein Modellabstand erfunden.** Die Modellabstände der
  bekannten Längen kommen aus der Rekonstruktion dieses Laufs (`modell.py`:
  Bildpunkte, Kamerahöhe über Boden-Bildpunkten). Punkt-IDs und
  Modellkoordinaten werden abgelehnt – jeder Lauf rekonstruiert neu, sie
  zeigten auf andere Punkte. Fehlen Modellpunkte, scheitert der Auftrag mit
  Klartext – statt eine Genauigkeit vorzutäuschen.
- **Ein bekanntes Maß reicht** für den Maßstab – kein Referenzwürfel nötig.
  Ab zwei Maßen gibt es zusätzlich ein Kontrollmaß.
- **Geometrie wird nie erfunden.** Ein `raum`-Vorschlag entsteht nur aus
  eingegebenen Wandlängen und Drehungen (Polygonzug wie im Browser).

Eingabe eines Auftrags (alles optional außer mindestens einer bekannten Länge):

    laser:            [{von, bis, distanzM, modell_a?, modell_b?, kontrolle?}]
    bekannte_laengen: [{art, laenge, drehung?, modell_a?, modell_b?,
                        boden?, bild?, kontrolle?, bezeichnung?}]
                      art: "wand" (Teil des Polygonzugs, mit drehung),
                           "strecke" (beliebige gemessene Strecke),
                           "kamerahoehe" (Kamera über Boden),
                           "raumhoehe" (Boden bis Decke)
    tags:             [{art, notiz?}]
"""

from __future__ import annotations

import math
import random
from pathlib import Path

from . import geometrie, modell, ply, tools
from .config import Config
from .jobs import Job, json_text
from .masssolver import Anker, HINWEIS_EIN_MASS, massstab_bestimmen

# Verborgener „wahrer" Maßstab der Simulation: die Rekonstruktion käme in
# willkürlichen Einheiten heraus. Wird NUR im Simulationsmodus benutzt.
_SIM_SKALA = 0.37

SIM_HINWEIS = "Simulation – keine echte Messung"

KEIN_MASS = ("Kein bekanntes Maß – für den Maßstab genügt eine einzige bekannte Länge "
             "(Lasermaß, Bandmaß einer Wand oder Kamerahöhe über dem Boden). "
             "Ein Referenzwürfel ist nicht nötig.")

MODELL_FEHLT = ("Modellabstände fehlen – Laser-Constraints brauchen Modellpunkte "
                "(modell_a/modell_b als Bildpunkt {bild, px}; Kamerahöhe mit Bodenpunkten "
                "als Bildpunkten).")

_ARTEN = ("wand", "strecke", "kamerahoehe", "raumhoehe")


def simuliert(cfg: Config) -> bool:
    if cfg.simulieren is not None:
        return cfg.simulieren
    return not tools.alle_vorhanden()


def _sim(ctx: dict, cfg: Config) -> bool:
    if "simuliert" not in ctx:
        ctx["simuliert"] = simuliert(cfg)
    return ctx["simuliert"]


def _hinweis(ctx: dict, text: str) -> None:
    ctx.setdefault("hinweise", []).append(text)


def _json(pfad: Path, obj) -> None:
    pfad.write_text(json_text(obj), encoding="utf-8")   # nie NaN/Infinity


# ------------------------------------------------------ Eingabe lesen

def _zahl(v) -> float | None:
    if isinstance(v, bool):
        return None
    try:
        z = float(v)
    except (TypeError, ValueError, OverflowError):    # OverflowError: Ganzzahl > 1e308
        return None
    return z if math.isfinite(z) else None


def _art(eintrag: dict) -> str:
    art = str(eintrag.get("art") or "").lower()
    if art in _ARTEN:
        return art
    return "wand" if "drehung" in eintrag else "strecke"


def _laenge(eintrag: dict) -> float | None:
    for k in ("laenge", "laengeM", "hoeheM", "distanzM"):
        if k in eintrag:
            return _zahl(eintrag[k])
    return None


def kandidaten(eingabe: dict) -> tuple[list[dict], list[str]]:
    """
    Alle bekannten Längen, die einen Maßstab tragen können: Lasermaße und
    `bekannte_laengen`. Ungültige Einträge werden mit Hinweis übersprungen.
    """
    liste: list[dict] = []
    hinweise: list[str] = []
    for i, m in enumerate(eingabe.get("laser") or []):
        if not isinstance(m, dict):
            hinweise.append(f"Lasermaß {i + 1} ist kein Objekt – übersprungen.")
            continue
        d = _zahl(m.get("distanzM"))
        if d is None or d <= 0:
            hinweise.append(f"Lasermaß {i + 1} ohne gültige Länge – übersprungen.")
            continue
        von, bis = m.get("von"), m.get("bis")
        name = f"{von}–{bis}" if (von or bis) else f"Laser {i + 1}"
        liste.append({"quelle": "laser", "bezeichnung": name, "laenge_m": d,
                      "eintrag": m, "kontrolle": bool(m.get("kontrolle"))})
    zaehler: dict[str, int] = {}
    for j, b in enumerate(eingabe.get("bekannte_laengen") or []):
        if not isinstance(b, dict):
            hinweise.append(f"Bekannte Länge {j + 1} ist kein Objekt – übersprungen.")
            continue
        art = _art(b)
        zaehler[art] = zaehler.get(art, 0) + 1
        name = str(b.get("bezeichnung") or {
            "wand": f"Wand {zaehler[art]}", "strecke": f"Strecke {zaehler[art]}",
            "kamerahoehe": "Kamerahöhe", "raumhoehe": "Raumhöhe"}[art])
        d = _laenge(b)
        if d is None or d <= 0:
            hinweise.append(f"{name} ohne gültige Länge – übersprungen.")
            continue
        liste.append({"quelle": art, "bezeichnung": name, "laenge_m": d,
                      "eintrag": {**b, "art": art}, "kontrolle": bool(b.get("kontrolle"))})
    return liste, hinweise


def _bilder(jobdir: Path) -> int:
    d = jobdir / "bilder"
    return sum(1 for p in d.iterdir() if p.is_file()) if d.exists() else 0


# ------------------------------------------- Stufe 0: Raum (Polygonzug)

def raum_aus_eingabe(eingabe: dict) -> tuple[dict | None, str | None]:
    """
    Raumvorschlag aus einem Bandmaß-Zug: die `bekannte_laengen` der Art „wand"
    mit `laenge` und `drehung`, in Reihenfolge. Gibt (raum, None) oder
    (None, Grund) zurück – erfunden wird nichts.
    """
    eintraege = [b for b in (eingabe.get("bekannte_laengen") or []) if isinstance(b, dict)]
    waende = [b for b in eintraege if _art(b) == "wand"]
    if not any("drehung" in w for w in waende):
        return None, ("Kein Raumvorschlag: dafür die Wände als bekannte_laengen mit "
                      "laenge und drehung (Polygonzug) angeben.")
    zug_waende = []
    for i, w in enumerate(waende):
        laenge, drehung = _laenge(w), _zahl(w.get("drehung"))
        if laenge is None or laenge <= 0 or drehung is None:
            return None, (f"Kein Raumvorschlag: Wand {i + 1} braucht eine Länge > 0 und eine "
                          "Drehung in Grad – der Polygonzug wird nicht geraten.")
        zug_waende.append({"laenge": laenge, "drehung": drehung, "eintrag": w})
    if len(zug_waende) < 3:
        return None, "Kein Raumvorschlag: mindestens drei Wände mit Länge und Drehung nötig."

    z = geometrie.zug(zug_waende)
    punkte = z["punkte"]
    herkunft = []
    for w in zug_waende:
        q = w["eintrag"].get("quelle")
        q = q if q in ("band", "gezielt", "getippt") else "band"
        sigma = _zahl(w["eintrag"].get("sigmaM"))
        herkunft.append({"laenge": round(w["laenge"], 3), "quelle": q,
                         "sigmaM": sigma if sigma is not None else (0.005 if q == "band" else None)})
    hinweise = geometrie.pruefen(punkte)
    if z["schlusswandErgaenzt"]:
        # Die letzte Ecke bleibt stehen, die Wand zurück zum Start ist gerechnet.
        herkunft.append({"laenge": round(z["restluecke"], 3), "quelle": "getippt", "sigmaM": None})
        hinweise.insert(0, f"Zug schließt nicht (Restlücke {round(z['restluecke'] * 100)} cm) – "
                           "Schlusswand rechnerisch ergänzt, nicht gemessen. Nachmessen!")
    hoehen = [_laenge(b) for b in eintraege if _art(b) == "raumhoehe"]
    hoehe = next((h for h in hoehen if h is not None and h > 0), None)

    raum = {
        "quelle": "bekannte_laengen",
        "simuliert": False,
        "hinweis": ("Aus den eingegebenen Wandlängen und Drehungen gerechnet (Polygonzug wie im "
                    "Aufmaß-Assistenten) – unabhängig von der Rekonstruktion."),
        "methode": "band",
        "umriss": geometrie.umriss_schreiben(punkte),
        "breiteM": max(p[0] for p in punkte),
        "tiefeM": max(p[1] for p in punkte),
        "hoeheM": round(hoehe, 3) if hoehe else None,
        "flaecheM2": round(geometrie.flaeche_punkte(punkte), 2),
        "waende": herkunft,
        "restlueckeM": round(z["restluecke"], 4),
        "geschlossen": z["geschlossen"],
        "schlusswandErgaenzt": z["schlusswandErgaenzt"],
        "oeffnungen": [],
        "einbauten": [],
        "aufnahme": None,
        "hinweise": hinweise,
    }
    return raum, None


def stage_raum(job: Job, ctx: dict, cfg: Config, jobdir: Path) -> dict:
    """Raumvorschlag aus eingegebenen Wandlängen – nur wenn es sie gibt."""
    raum, grund = raum_aus_eingabe(job.eingabe)
    if raum is None:
        _hinweis(ctx, grund)
        return {}
    _json(jobdir / "raum.json", raum)
    return {"raum": raum}


# ---------------------------------------------- Stufe 1: Eingabe prüfen

def stage_eingabe(job: Job, ctx: dict, cfg: Config, jobdir: Path) -> dict:
    """
    Vor der schweren Rechnung prüfen, ob ein Maßstab überhaupt möglich ist –
    damit COLMAP nicht eine Stunde rechnet, um dann am Maßstab zu scheitern.
    """
    kand, hinweise = kandidaten(job.eingabe)
    for h in hinweise:
        _hinweis(ctx, h)
    if not kand:
        raise RuntimeError(KEIN_MASS)
    n_bilder = _bilder(jobdir)
    mit_bezug, gruende = [], []
    for k in kand:
        if not modell.hat_modellbezug(k["eintrag"]):
            continue
        try:
            modell.bezug_pruefen(k["eintrag"])   # Punkt-IDs/Koordinaten: schon hier ablehnen
        except modell.ModellFehler as e:
            gruende.append(f"{k['bezeichnung']}: {e}")
            _hinweis(ctx, f"{k['bezeichnung']}: {e}")
            continue
        mit_bezug.append(k)
    if not _sim(ctx, cfg):
        if not mit_bezug:
            raise RuntimeError(MODELL_FEHLT + (" " + "; ".join(gruende) if gruende else ""))
        if n_bilder < 3:
            raise RuntimeError(f"Zu wenige Bilder für die Rekonstruktion: {n_bilder} "
                               "(mindestens 3, besser 20+ mit viel Überlappung).")
    ctx["kandidaten"] = kand
    return {"eingabe": {"bekannte_laengen": len(kand), "mit_modellpunkten": len(mit_bezug),
                        "bilder": n_bilder}}


# ------------------------------------------------------------ Stufe 2: SfM

def stage_sfm(job: Job, ctx: dict, cfg: Config, jobdir: Path) -> dict:
    """Kameraposen und spärliche Wolke. Real: COLMAP im CPU-Modus."""
    jd = jobdir.resolve()           # Werkzeuge laufen mit cwd=jobdir – Pfade absolut
    sparse = jd / "sparse"
    sparse.mkdir(exist_ok=True)
    n_bilder = _bilder(jd)
    if _sim(ctx, cfg):
        _json(sparse / "cameras.json", {"simuliert": True, "hinweis": "Simulation – keine echte SfM"})
        return {"sfm": {"bilder": n_bilder, "kameras": None, "punkte": None,
                        "simuliert": True, "hinweis": "Simulation – keine echte SfM"}}

    for kmd in tools.colmap_kommandos(str(jd / "bilder"), str(jd)):
        _laufen(kmd, cfg, jd, "COLMAP")
    mdir = modell.finden(sparse)
    if mdir is None:
        raise RuntimeError("COLMAP hat keine Rekonstruktion erzeugt (sparse/0 fehlt) – "
                           "zu wenige, zu ähnliche oder unscharfe Bilder?")
    m = modell.laden(mdir)
    ctx["modell"] = m
    return {"sfm": {"bilder": n_bilder, "kameras": len(m.bilder), "punkte": len(m.punkte),
                    "modell": str(mdir.relative_to(jd)), "simuliert": False}}


# -------------------------------------------------- Stufe 3: Dichte Wolke

def stage_dichte(job: Job, ctx: dict, cfg: Config, jobdir: Path) -> dict:
    """Farbige dichte Punktwolke. Real: COLMAP-Entzerrung + OpenMVS (CPU)."""
    jd = jobdir.resolve()
    ziel = jd / "wolke.ply"
    if _sim(ctx, cfg):
        n = _demo_wolke_schreiben(ziel)
        return {"wolke": {"datei": ziel.name, "punkte": n, "einheit": "modell",
                          "simuliert": True,
                          "hinweis": "Simulation – Demo-Wolke (Quadrat), keine echte Rekonstruktion"}}

    for kmd in tools.dichte_kommandos(str(jd / "bilder"), str(jd)):
        _laufen(kmd, cfg, jd, "OpenMVS" if kmd[0] != "colmap" else "COLMAP-Entzerrung")
    quelle = jd / tools.DICHTE_PLY
    if not quelle.exists():
        raise RuntimeError(f"OpenMVS hat keine dichte Wolke geschrieben ({tools.DICHTE_PLY} fehlt).")
    info = ply.zu_ascii(quelle, ziel, max_punkte=cfg.max_wolke_punkte, kommentare=[
        "RAUMWERK dichte Wolke (OpenMVS), Modelleinheiten; Massstab in result.json"])
    return {"wolke": {"datei": ziel.name, "punkte": info["punkte"],
                      "punkte_original": info["punkte_original"],
                      "ausgeduennt": info["ausgeduennt"], "einheit": "modell",
                      "simuliert": False}}


# --------------------------------------------------- Stufe 4: Maß-Solver

def stage_mass(job: Job, ctx: dict, cfg: Config, jobdir: Path) -> dict:
    """
    Metrischer Maßstab aus bekannten Längen. Ab einem Maß; ab zwei Maßen wird
    eines als Kontrollmaß zurückgehalten und liefert die Genauigkeitszahl (§7).
    """
    sim = _sim(ctx, cfg)
    kand = ctx.get("kandidaten")
    if kand is None:
        kand, _ = kandidaten(job.eingabe)
    anker = _sim_anker(kand, seed=job.id) if sim else _echte_anker(kand, ctx)

    try:
        m = massstab_bestimmen(anker)
    except ValueError as e:
        raise RuntimeError(str(e)) from e

    def zeile(a: Anker, rolle: str) -> dict:
        return {"bezeichnung": a.bezeichnung, "quelle": a.quelle, "laenge_m": a.laenge_m,
                "modell_abstand": round(a.modell, 6), "rolle": rolle}

    ausgabe = {
        "skala_m_je_einheit": round(m.skala, 6),
        "rms_mm": round(m.rms_mm, 1) if m.rms_mm is not None else None,
        "anker_verwendet": len(m.verwendet),
        "anker_verworfen": len(m.verworfen),
        "anker": ([zeile(a, "massstab") for a in m.verwendet]
                  + [zeile(a, "verworfen") for a in m.verworfen]
                  + ([zeile(m.kontrolle, "kontrolle")] if m.kontrolle else [])),
        "kontrollmass_abweichung_mm": None,
        "kontrollmass": None,
        "kontrollmass_hinweis": None,
        "simuliert": sim,
        "hinweis": SIM_HINWEIS if sim else (
            f"Maßstab aus {len(m.verwendet)} bekannten Länge(n); Modellabstände aus der "
            "Rekonstruktion gelesen."),
        "hinweise": list(m.hinweise),
    }
    if m.kontrolle is not None:
        ausgabe["kontrollmass"] = {
            "bezeichnung": m.kontrolle.bezeichnung, "quelle": m.kontrolle.quelle,
            "laenge_m": m.kontrolle.laenge_m,
            "modell_m": round(m.skala * m.kontrolle.modell, 4),
        }
        abw = round(m.kontrollmass_abweichung_mm, 1)
        if sim:
            # Kein gemessenes Kontrollmaß – der Demo-Wert steht separat, damit
            # niemand ihn für eine Genauigkeitsaussage hält.
            ausgabe["kontrollmass_abweichung_mm_simuliert"] = abw
            ausgabe["kontrollmass_hinweis"] = (
                "Simulation – kein gemessenes Kontrollmaß (Demo-Wert unter "
                "kontrollmass_abweichung_mm_simuliert).")
        else:
            ausgabe["kontrollmass_abweichung_mm"] = abw
    else:
        ausgabe["kontrollmass_hinweis"] = HINWEIS_EIN_MASS
    for h in m.hinweise:
        _hinweis(ctx, h)

    _json(jobdir / "massstab.json", ausgabe)
    ctx["skala"] = m.skala
    return {"massstab": ausgabe}


def _sim_anker(kand: list[dict], seed: str) -> list[Anker]:
    """
    NUR Simulation: Modellabstände aus den bekannten Längen geteilt durch den
    verborgenen Maßstab, plus etwas Rauschen – als ob sie aus einer
    Rekonstruktion kämen. Das Ergebnis ist entsprechend als simuliert markiert.
    """
    rng = random.Random(seed)
    return [Anker(modell=(k["laenge_m"] / _SIM_SKALA) * (1.0 + rng.uniform(-0.006, 0.006)),
                  laenge_m=k["laenge_m"], quelle=k["quelle"], bezeichnung=k["bezeichnung"],
                  kontrolle=k["kontrolle"])
            for k in kand]


def _echte_anker(kand: list[dict], ctx: dict) -> list[Anker]:
    """Modellabstände aus der Rekonstruktion lesen – nie schätzen."""
    m = ctx.get("modell")
    anker, gruende = [], []
    for k in kand:
        if not modell.hat_modellbezug(k["eintrag"]):
            _hinweis(ctx, f"{k['bezeichnung']}: keine Modellpunkte – fließt nicht in den Maßstab ein.")
            continue
        try:
            d = modell.modell_abstand(k["eintrag"], m)
        except modell.ModellFehler as e:
            gruende.append(f"{k['bezeichnung']}: {e}")
            _hinweis(ctx, f"{k['bezeichnung']}: {e}")
            continue
        anker.append(Anker(modell=d, laenge_m=k["laenge_m"], quelle=k["quelle"],
                           bezeichnung=k["bezeichnung"], kontrolle=k["kontrolle"]))
    if not anker:
        raise RuntimeError(MODELL_FEHLT + (" " + "; ".join(gruende) if gruende else ""))
    return anker


# ------------------------------------------- Stufe 5: Komponenten-Zuordnung

# Kleiner Katalog echter Maße – die serverseitige Entsprechung der Komponenten-
# DB. Außendurchmesser in Millimetern.
_KATALOG = {
    "KABEL_NYM5": {"aussen_mm": 13.0, "name": "NYM-J 5×2,5"},
    "LEERROHR_M25": {"aussen_mm": 25.0, "name": "Leerrohr M25"},
    "ZAEHLERSCHRANK": {"breite_m": 0.60, "tiefe_m": 0.20, "name": "Zählerschrank"},
}


def stage_komponenten(job: Job, ctx: dict, cfg: Config, jobdir: Path) -> dict:
    """Getaggte Objekte auf echte Katalogmaße abbilden (DB-Lookup, §6.2)."""
    zuordnung = []
    for tag in job.eingabe.get("tags") or []:
        schluessel = tag.get("art") if isinstance(tag, dict) else tag
        katalog = _KATALOG.get(schluessel)
        zuordnung.append({
            "tag": schluessel,
            "gefunden": katalog is not None,
            "masse": katalog or {},
        })
    _json(jobdir / "komponenten.json", zuordnung)
    return {"komponenten": {"zugeordnet": sum(1 for z in zuordnung if z["gefunden"]),
                            "gesamt": len(zuordnung)}}


# ------------------------------------------------ Stufe 6: Elektro-Semantik

def stage_semantik(job: Job, ctx: dict, cfg: Config, jobdir: Path) -> dict:
    """
    Aufgedeckelte Verteilungen zuordnen/interpretieren – zunächst regelbasiert
    (Konzept §6.2, §9 Stufe 1), später ML-gestützt.
    """
    befunde = []
    for tag in job.eingabe.get("tags") or []:
        art = tag.get("art") if isinstance(tag, dict) else tag
        if art == "ZAEHLERSCHRANK":
            befunde.append("Verteilung erkannt – Bedienbereich davor prüfen (VDE 0100-729).")
    _json(jobdir / "semantik.json", {"befunde": befunde})
    return {"semantik": {"befunde": len(befunde)}}


STUFEN = [
    ("Raum aus bekannten Längen", stage_raum),
    ("Eingabe prüfen", stage_eingabe),
    ("SfM (Kameraposen)", stage_sfm),
    ("Dichte Wolke", stage_dichte),
    ("Maß-Solver", stage_mass),
    ("Komponenten-Zuordnung", stage_komponenten),
    ("Elektro-Semantik", stage_semantik),
]


# ------------------------------------------------------------ Hilfsmittel

def _laufen(kmd: list[str], cfg: Config, jd: Path, wer: str) -> None:
    """Ein Werkzeug gedrosselt starten; Ausgabe nach werkzeuge.log, Fehler im Klartext."""
    lauf = tools.ausfuehren(kmd, cfg, cwd=str(jd))
    with (jd / "werkzeuge.log").open("a", encoding="utf-8") as log:
        log.write(f"$ {' '.join(lauf.kommando)}\n{lauf.ausgabe}\n[Rückgabe {lauf.rueckgabe}]\n\n")
    if lauf.rueckgabe != 0:
        letzte = (lauf.ausgabe.strip().splitlines() or [""])[-1][:200]
        raise RuntimeError(f"{wer} scheiterte bei „{' '.join(kmd[:2])}“ (Rückgabe "
                           f"{lauf.rueckgabe}): {letzte} – Details in werkzeuge.log")


def _demo_wolke_schreiben(ziel: Path, kante: float = 4.0) -> int:
    """NUR Simulation: eine winzige Demo-Punktwolke (Quadrat) als ASCII-PLY."""
    punkte = []
    n = 8
    for i in range(n + 1):
        t = kante * i / n
        punkte += [(t, 0, 0), (t, kante, 0), (0, t, 0), (kante, t, 0)]
    return ply.ascii_schreiben(ziel, punkte, kommentare=[
        "RAUMWERK Simulation - Demo-Wolke, keine echte Rekonstruktion",
        "simuliert: true",
    ])
