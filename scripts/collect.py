#!/usr/bin/env python3
"""Collecte les données du panneau et les imprime en JSON.

Sessions de l'app Claude (macOS), PR ouvertes d'un dépôt GitHub (via `gh`),
ports locaux à l'écoute, disque. Tout ce qui est propre à une personne (dépôt,
adresse de santé, fuseau, piles locales) vient du fichier de réglages.

N'imprime que des champs choisis (titres, états, numéros) : jamais le
contenu brut des fichiers de session, qui contiennent de la configuration.

Usage : collect.py <config.json> <cli_session_id> [--prs] [--sante]
"""
import glob
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
except Exception:  # pas de base de fuseaux : heure locale de la machine
    ZoneInfo = None

# Le fuseau des dates affichées : celui de la machine, ou le réglage « fuseau ».
FUSEAU = None


def regler_fuseau(nom):
    """Fixe le fuseau des dates (« Europe/Paris »…) ; vide ou inconnu : celui de la machine."""
    global FUSEAU
    FUSEAU = None
    if nom and ZoneInfo:
        try:
            FUSEAU = ZoneInfo(str(nom))
        except Exception:
            FUSEAU = None

HOME = os.path.expanduser("~")
SESSIONS = os.path.join(HOME, "Library/Application Support/Claude/claude-code-sessions")
LAUNCH = os.path.join(HOME, ".claude/launch.json")
ENV = dict(os.environ, PATH=f"{HOME}/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")


def run(argv, timeout=20, cwd=None):
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, env=ENV, cwd=cwd)
        return p.returncode, p.stdout
    except Exception:
        return 1, ""


def date_courte(ms):
    """Horodatage (ms) -> « jj/mm HH:MM », dans le fuseau réglé ou celui de la machine."""
    if not ms:
        return ""
    try:
        d = datetime.fromtimestamp(ms / 1000, FUSEAU) if FUSEAU else datetime.fromtimestamp(ms / 1000)
        return d.strftime("%d/%m %H:%M")
    except Exception:
        return ""


def iso_ms(txt):
    """Date ISO de GitHub -> horodatage en ms (0 si illisible)."""
    try:
        return int(datetime.fromisoformat(txt.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp() * 1000)
    except Exception:
        return 0


def masque(t):
    # Pas de code, jeton ou clé dans le panneau.
    t = re.sub(r"\b\d{6,}\b", "••••", t)
    return re.sub(r"[A-Za-z0-9_\-]{32,}", "••••", t)


JOUR = 86400000
LIVREES = ("MERGED", "CLOSED")


def est_ancien(ms, now, jours):
    """Vrai si rien n'a bougé depuis plus de `jours` jours."""
    return bool(ms) and now - ms > jours * JOUR


def classer_session(d, now):
    """Une session de l'app -> ce que le panneau en montre (champs choisis, jamais le fichier brut)."""
    act = d.get("lastActivityAt") or 0
    edge = d.get("lastTurnEdgeAt") or 0
    s = d.get("postTurnSummary") or {}
    # Un résumé qui ne porte pas sur le dernier message ne dit plus rien de l'état.
    fresh = d.get("postTurnSummaryFor") == d.get("lastAssistantUuid")
    cat = s.get("status_category") if fresh else None
    if act > edge + 1500 and now - act < 15 * 60 * 1000:
        etat = "travaille"
    elif cat == "blocked" or d.get("interruptedAwaitingPerson"):
        etat = "attend toi"
    elif cat == "review_ready" or (fresh and s.get("needs_action")):
        etat = "à relire"
    elif cat == "completed":
        etat = "fini"
    else:
        etat = "inactif"
    # Ses propres PR sont toutes mergées ou fermées : le travail est livré, même si
    # son dernier message posait encore une question. C'est aussi ce que l'app appelle « done ».
    propres = [p for p in (d.get("prs") or []) if p.get("own")]
    livree = bool(propres) and all((p.get("state") or "").upper() in LIVREES for p in propres)
    if livree and etat in ("attend toi", "à relire", "inactif"):
        etat = "fini"
    return {
        "id": d.get("sessionId"),
        # L'identifiant Claude de la session : ce que « qct » attend pour la résumer.
        "cli": d.get("cliSessionId") or "",
        "titre": (d.get("title") or "Sans titre")[:80],
        "etat": etat,
        "detail": masque((s.get("needs_action") or s.get("status_detail") or "")[:140]) if fresh else "",
        "minutes": int((now - act) / 60000) if act else None,
        "activite": act or None,
        "date": date_courte(act),
        "favori": bool(d.get("isStarred")),
    }


def sessions(cli_id):
    out, me = [], {"favori": False}
    now = time.time() * 1000
    for f in glob.glob(os.path.join(SESSIONS, "*", "*", "local_*.json")):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        if d.get("cliSessionId") == cli_id:
            # La session qui affiche le panneau : inutile de la lister chez elle.
            me = {"favori": bool(d.get("isStarred")), "id": d.get("sessionId")}
            continue
        if d.get("isArchived"):
            continue
        out.append(classer_session(d, now))
    rang = {"attend toi": 0, "travaille": 1, "à relire": 2, "fini": 3, "inactif": 4}
    out.sort(key=lambda x: (rang[x["etat"]], x["minutes"] if x["minutes"] is not None else 1e9))
    return out, me


def chemin_qct(cfg):
    """Le script « qct » (résumé express d'une session), s'il est installé.
    `"qct": false` dans les réglages le coupe ; un chemin le remplace."""
    voulu = cfg.get("qct", os.path.join(HOME, ".claude/skills/qct/qct"))
    if not voulu or not isinstance(voulu, str):
        return None
    chemin = os.path.expanduser(voulu)
    return chemin if os.path.isfile(chemin) and os.access(chemin, os.X_OK) else None


def essai_actif(cfg, now=None):
    """Le banc d'essai d'affichage : demandé, et pas au-delà de son heure limite (ms)."""
    try:
        limite = float(cfg.get("essaiJusqua") or 0)
    except Exception:
        limite = 0
    return bool(cfg.get("essai")) and (now or time.time() * 1000) < limite


def theme_sombre():
    """Le thème de l'app : son propre réglage, sinon celui du système."""
    mode = ""
    try:
        cfg = json.load(open(os.path.join(HOME, "Library/Application Support/Claude/config.json")))
        mode = str(cfg.get("userThemeMode") or "").lower()
    except Exception:
        pass
    if mode in ("dark", "light"):
        return mode == "dark"
    code, txt = run(["defaults", "read", "-g", "AppleInterfaceStyle"], timeout=5)
    return code == 0 and "dark" in txt.lower()


def ports_ecoute():
    _, txt = run(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN"], timeout=15)
    ports = set()
    for line in txt.splitlines()[1:]:
        m = re.search(r":(\d+) \(LISTEN\)", line)
        if m:
            ports.add(int(m.group(1)))
    return ports


def localhost(cfg, ecoute):
    try:
        entries = json.load(open(LAUNCH)).get("configurations", [])
    except Exception:
        entries = []
    by_name = {e.get("name"): e for e in entries}
    piles, vus = [], set()
    for p in cfg.get("piles", []):
        e = by_name.get(p.get("lanceur")) or {}
        port = p.get("port") or e.get("port")
        piles.append({
            "nom": p.get("nom") or e.get("name"),
            "lanceur": p.get("lanceur") if e else None,
            "port": port,
            "url": e.get("url") or f"http://localhost:{port}",
            "actif": port in ecoute,
            "epinglee": True,
            "dossier": p.get("dossier"),
            "commande": p.get("commande"),
        })
        vus.add(port)
    autres = 0
    for e in entries:
        port = e.get("port")
        if port in vus:
            continue
        if port in ecoute:
            piles.append({"nom": e.get("name"), "lanceur": e.get("name"), "port": port,
                          "url": e.get("url") or f"http://localhost:{port}", "actif": True, "epinglee": False})
            vus.add(port)
        else:
            autres += 1
    return piles, autres


def prs(cfg, jours_ancien=3):
    """Les PR ouvertes du dépôt réglé (« repo »). Sans dépôt réglé : aucune. `None` : GitHub n'a pas répondu."""
    repo = str(cfg.get("repo") or "").strip()
    if not repo:
        return []
    # Réglages propres à chaque équipe, tous facultatifs :
    #   « garde » : un morceau du nom du contrôle qui doit être vert avant un merge ;
    #   « labelOk » : le label qui marque une PR approuvée ;
    #   « brancheProd » : la branche de production (ses PR ne se cochent qu'à la main).
    garde_nom = str(cfg.get("garde") or "").strip().lower()
    label_ok = str(cfg.get("labelOk") or "").strip()
    branche_prod = str(cfg.get("brancheProd") or "").strip()
    code, txt = run(["gh", "pr", "list", "--repo", repo, "--state", "open",
                     "--limit", "30", "--json", "number,title,url,labels,isDraft,statusCheckRollup,baseRefName,headRefName,updatedAt,mergeable"], timeout=40)
    if code != 0:
        return None
    out = []
    now = time.time() * 1000
    for p in json.loads(txt or "[]"):
        checks = p.get("statusCheckRollup") or []
        garde = None
        echec = False
        cours = False
        for c in checks:
            nom = c.get("name") or c.get("context") or ""
            concl = (c.get("conclusion") or c.get("state") or "").upper()
            statut = (c.get("status") or "").upper()
            if statut and statut != "COMPLETED":
                cours = True
            if concl in ("FAILURE", "ERROR", "TIMED_OUT", "CANCELLED"):
                echec = True
            if garde_nom and garde_nom in nom.lower():
                garde = "en cours" if statut and statut != "COMPLETED" else ("ok" if concl == "SUCCESS" else concl.lower() or "?")
        ci = "rouge" if echec else ("en cours" if cours else ("vert" if checks else "aucune"))
        out.append({
            "numero": p["number"], "titre": p["title"][:90], "url": p["url"],
            "garde": (garde or "absente") if garde_nom else "non demandée",
            "ci": ci, "brouillon": p.get("isDraft", False),
            "ownerOk": bool(label_ok) and any(l.get("name") == label_ok for l in p.get("labels", [])),
            "base": p.get("baseRefName"),
            "prod": bool(branche_prod) and p.get("baseRefName") == branche_prod,
            "branche": p.get("headRefName"),
            "maj": iso_ms(p.get("updatedAt") or ""),
            "date": date_courte(iso_ms(p.get("updatedAt") or "")),
            # UNKNOWN (GitHub n'a pas encore calculé) n'est pas un conflit.
            "conflit": p.get("mergeable") == "CONFLICTING",
            # Pas touchée depuis des jours. Le panneau ne range à part que celles qui seraient « bloquées ».
            "ancien": est_ancien(iso_ms(p.get("updatedAt") or ""), now, jours_ancien),
        })
    return out


def dossier_entree(e):
    """Le dossier où une entrée de launch.json démarre son serveur : un argument qui est un chemin absolu
    (espaces compris), ou le dossier d'un « cd … && » dans une commande shell."""
    args = e.get("runtimeArgs") or []
    if not isinstance(args, list):
        args = [str(args)]
    for a in args:
        a = str(a)
        m = re.search(r"\bcd\s+(['\"]?)(/.+?)\1\s*(&&|;|$)", a)
        if m:
            return m.group(2)
        if a.startswith("/"):
            return a
    return None


def branches_fermees(cfg):
    """Les branches dont les PR sont toutes mergées ou fermées. `None` : pas de dépôt réglé, ou GitHub muet."""
    repo = str(cfg.get("repo") or "").strip()
    if not repo:
        return None
    code, txt = run(["gh", "pr", "list", "--repo", repo, "--state", "all", "--limit", "200",
                     "--json", "headRefName,baseRefName,state"], timeout=40)
    if code != 0:
        return None
    ouvertes, fermees, bases = set(), set(), {"main", "master", "HEAD"}
    for p in json.loads(txt or "[]"):
        (ouvertes if p.get("state") == "OPEN" else fermees).add(p.get("headRefName"))
        # Une branche qui sert de base (dev, main…) vit toujours, même après une release mergée.
        bases.add(p.get("baseRefName"))
    return fermees - ouvertes - bases


def orphelines(piles, fermees, entrees=None):
    """Les ports des piles qui tournent alors que leur worktree n'a plus de PR ouverte (mergée ou fermée),
    ou que leur dossier n'existe plus. Les piles épinglées dans les réglages sont gardées."""
    if entrees is None:
        try:
            entrees = json.load(open(LAUNCH)).get("configurations", [])
        except Exception:
            entrees = []
    par_nom = {e.get("name"): e for e in entrees}
    out = []
    for p in piles:
        if not p.get("actif") or p.get("epinglee"):
            continue
        e = par_nom.get(p.get("lanceur")) or {}
        dossier = dossier_entree(e)
        if not dossier:
            continue
        if not os.path.exists(dossier):
            out.append(p["port"])
            continue
        if fermees:
            code, br = run(["git", "-C", dossier, "rev-parse", "--abbrev-ref", "HEAD"], timeout=5)
            if code == 0 and br.strip() in fermees:
                out.append(p["port"])
    return out


def sante(cfg):
    """L'adresse de santé réglée (« santeProd ») répond-elle ? Sans adresse réglée : `None`."""
    url = str(cfg.get("santeProd") or "").strip()
    if not url:
        return None
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return {"ok": 200 <= r.status < 300, "code": r.status}
    except urllib.error.HTTPError as e:
        return {"ok": False, "code": e.code}
    except Exception:
        return {"ok": False, "code": 0}


def systeme(cfg):
    _, txt = run(["df", "-h", "/System/Volumes/Data"])
    libre = ""
    lines = txt.splitlines()
    if len(lines) > 1:
        cols = lines[1].split()
        if len(cols) >= 5:
            taille = cols[3].replace("Gi", " Go").replace("Mi", " Mo").replace("Ti", " To")
            libre = f"{taille} libres ({cols[4].replace('%', ' %')})"
    # Le nombre de worktrees du dépôt local réglé (« depot ») ; sans réglage, rien.
    depot = str(cfg.get("depot") or "").strip()
    n = None
    if depot:
        _, wt = run(["git", "-C", os.path.expanduser(depot), "worktree", "list", "--porcelain"])
        n = sum(1 for l in wt.splitlines() if l.startswith("worktree "))
    return {"disque": libre, "worktrees": n}


def main():
    cfg_path, cli_id = sys.argv[1], sys.argv[2]
    flags = set(sys.argv[3:])
    try:
        cfg = json.load(open(cfg_path))
        cfg_err = None
    except FileNotFoundError:
        cfg, cfg_err = {}, None
    except Exception as e:
        cfg, cfg_err = {}, f"config illisible : {e.__class__.__name__}"
    try:
        jours = float(cfg.get("joursAncien", 3))
    except Exception:
        jours = 3
    regler_fuseau(cfg.get("fuseau"))
    sess, me = sessions(cli_id)
    piles, autres = localhost(cfg, ports_ecoute())
    data = {"sessions": sess, "moi": me, "piles": piles, "autresPiles": autres,
            "systeme": systeme(cfg), "configErreur": cfg_err, "heure": time.strftime("%H:%M:%S"),
            "sombre": theme_sombre(), "essai": essai_actif(cfg), "qct": chemin_qct(cfg),
            "sansRepo": not str(cfg.get("repo") or "").strip(),
            "labelOk": str(cfg.get("labelOk") or "").strip(),
            "avecGarde": bool(str(cfg.get("garde") or "").strip()),
            "avecProd": bool(str(cfg.get("brancheProd") or "").strip())}
    if "--prs" in flags:
        data["prs"] = prs(cfg, jours)
        data["orphelines"] = orphelines(piles, branches_fermees(cfg))
    if "--sante" in flags:
        data["sante"] = sante(cfg)
    print(json.dumps(data, ensure_ascii=False))


if __name__ == "__main__":
    main()
