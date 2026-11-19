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


def dernier_echange(chemin, octets=262144):
    """La dernière entrée « user » ou « assistant » d'une transcription (.jsonl), lue depuis la fin du fichier."""
    try:
        with open(chemin, "rb") as f:
            f.seek(0, 2)
            taille = f.tell()
            f.seek(max(0, taille - octets))
            lignes = f.read().decode("utf-8", "replace").splitlines()
    except Exception:
        return None
    for ligne in reversed(lignes):
        if '"user"' not in ligne and '"assistant"' not in ligne:
            continue
        try:
            x = json.loads(ligne)
        except Exception:
            continue
        if x.get("type") in ("user", "assistant"):
            return x
    return None


def taches_de_fond(chemin, now):
    """Le nombre de tâches de fond (sous-agent ou commande lancés « en arrière-plan ») encore en cours :
    lancées, acceptées, sans la notification de fin. Au-delà de 12 h, on n'y croit plus."""
    lancees, finies, refusees = {}, set(), set()
    try:
        with open(chemin, "rb") as f:
            for brut in f:
                if b"run_in_background" not in brut and b"task-notification" not in brut and b"is_error" not in brut:
                    continue
                # La notification de fin peut arriver sous plusieurs formes (message, file d'attente, pièce
                # jointe) : son identifiant suffit, où qu'il soit.
                if b"task-notification" in brut:
                    finies.update(m.decode() for m in re.findall(rb"<tool-use-id>([^<\\]+)</tool-use-id>", brut))
                try:
                    x = json.loads(brut)
                except Exception:
                    continue
                c = (x.get("message") or {}).get("content")
                if x.get("type") == "assistant" and isinstance(c, list):
                    for b in c:
                        entree = b.get("input") or {} if isinstance(b, dict) else {}
                        if isinstance(b, dict) and b.get("type") == "tool_use" and str(entree.get("run_in_background")).lower() == "true":
                            lancees[b.get("id")] = iso_ms(x.get("timestamp") or "")
                elif x.get("type") == "user":
                    blocs = c if isinstance(c, list) else [{"type": "text", "text": c or ""}]
                    for b in blocs:
                        if not isinstance(b, dict):
                            continue
                        if b.get("type") == "tool_result" and b.get("is_error"):
                            refusees.add(b.get("tool_use_id"))
    except Exception:
        return 0
    return sum(1 for i, quand in lancees.items()
               if i not in finies and i not in refusees and quand and now - quand < 12 * 3600 * 1000)


def tour_en_cours(d, now, transcriptions=None):
    """Pourquoi la session est au milieu d'un tour, ou "" si elle ne l'est pas : sa transcription finit sur
    un appel d'outil sans réponse, ou sur un message auquel Claude n'a pas encore répondu, et a bougé il y a
    moins de 30 min ; ou des tâches de fond tournent encore.
    (Un long outil ne bouge pas le reste du fichier de la session : seul ce signe le voit.)"""
    cli = d.get("cliSessionId")
    if not cli:
        return ""
    chemins = transcriptions(cli) if transcriptions else glob.glob(os.path.join(HOME, ".claude", "projects", "*", f"{cli}.jsonl"))
    for chemin in chemins:
        try:
            if now - os.path.getmtime(chemin) * 1000 > 12 * 3600 * 1000:
                continue
            recent = now - os.path.getmtime(chemin) * 1000 < 30 * 60 * 1000
        except Exception:
            continue
        # Des sous-agents ou des commandes de fond tournent encore : la session travaille,
        # même si son tour à elle est fini.
        # Un sous-agent écrit encore sa propre transcription (relancé après avoir rendu, par exemple).
        actifs = 0
        for f in glob.glob(os.path.join(chemin[:-len(".jsonl")], "subagents", "agent-*.jsonl")):
            try:
                if now - os.path.getmtime(f) * 1000 < 3 * 60 * 1000:
                    actifs += 1
            except Exception:
                pass
        if actifs:
            return f"{actifs} sous-agent{'s' if actifs > 1 else ''} au travail en ce moment"
        n = taches_de_fond(chemin, now)
        if n > 0:
            return f"{n} tâche{'s' if n > 1 else ''} de fond en cours (sous-agent ou commande)"
        x = dernier_echange(chemin)
        if not x:
            continue
        if not recent:
            continue
        m = x.get("message") or {}
        if x.get("type") == "assistant":
            if m.get("stop_reason") in ("tool_use", None):
                return "un outil tourne, sa réponse n'est pas encore arrivée"
        else:
            c = m.get("content")
            texte = c if isinstance(c, str) else " ".join(str(b.get("text", "")) for b in (c or []) if isinstance(b, dict))
            if "Request interrupted" not in texte:
                return "Claude n'a pas encore répondu au dernier message"
    return ""


# Les boutons d'app d'un « wrap_up » n'ont pas de libellé : ce qu'ils font, en clair.
BOUTONS_APP = {"commit": "commiter", "create_pr": "ouvrir la PR", "merge": "merger", "verify": "vérifier",
               "fix_ci": "corriger la CI", "address_comments": "traiter les commentaires",
               "resolve_conflicts": "résoudre les conflits", "archive": "archiver", "new_session": "nouvelle session"}


def premier_bouton(entree):
    """Le premier bouton proposé avec une question : la réponse que la session recommande, ou ""."""
    actions = entree.get("actions")
    if not isinstance(actions, list) or not actions or not isinstance(actions[0], dict):
        return ""
    a = actions[0]
    return str(BOUTONS_APP.get(a.get("action") or "") or a.get("label") or "").strip()


def derniere_demande(d, transcriptions=None, octets=1048576):
    """La question que la session a laissée à la personne à la fin de son dernier tour (son dernier
    « wrap_up » avec une question ou marqué bloquant), ou "" : s'il n'y en a pas, ou si un message est
    arrivé depuis. Lu dans la fin de la transcription, pour quand le résumé de l'app n'est plus à jour.
    Rend (question, recommandation) : la recommandation est le premier bouton proposé avec la question,
    celui que la session met en avant, ou ""."""
    cli = d.get("cliSessionId")
    if not cli:
        return "", ""
    chemins = transcriptions(cli) if transcriptions else glob.glob(os.path.join(HOME, ".claude", "projects", "*", f"{cli}.jsonl"))
    for chemin in chemins:
        try:
            with open(chemin, "rb") as f:
                f.seek(0, 2)
                taille = f.tell()
                f.seek(max(0, taille - octets))
                lignes = f.read().decode("utf-8", "replace").splitlines()
        except Exception:
            continue
        for ligne in reversed(lignes):
            if '"user"' not in ligne and "wrap_up" not in ligne:
                continue
            try:
                x = json.loads(ligne)
            except Exception:
                continue
            c = (x.get("message") or {}).get("content")
            if x.get("type") == "user":
                blocs = c if isinstance(c, list) else [{"type": "text", "text": c or ""}]
                # Un vrai message (pas un retour d'outil) après la question : elle n'attend plus.
                if any(isinstance(b, dict) and b.get("type") == "text" and str(b.get("text") or "").strip() for b in blocs):
                    return "", ""
            elif x.get("type") == "assistant" and isinstance(c, list):
                for b in c:
                    if isinstance(b, dict) and b.get("type") == "tool_use" and str(b.get("name") or "").endswith("wrap_up"):
                        e = b.get("input") or {}
                        if e.get("ask") or e.get("blocked"):
                            return str(e.get("ask") or e.get("recap") or "elle attend ta réponse"), premier_bouton(e)
                        return "", ""
    return "", ""


def classer_session(d, now, transcriptions=None):
    """Une session de l'app -> ce que le panneau en montre (champs choisis, jamais le fichier brut)."""
    act = d.get("lastActivityAt") or 0
    edge = d.get("lastTurnEdgeAt") or 0
    s = d.get("postTurnSummary") or {}
    # Un résumé qui ne porte pas sur le dernier message ne dit plus rien de l'état.
    fresh = d.get("postTurnSummaryFor") == d.get("lastAssistantUuid")
    cat = s.get("status_category") if fresh else None
    depuis = f" depuis {date_courte(edge or act)[-5:]}" if (edge or act) else ""
    en_cours = tour_en_cours(d, now, transcriptions)
    if act > edge + 1500 and now - act < 15 * 60 * 1000:
        etat, raison = "travaille", "son tour est en cours"
    elif en_cours:
        etat, raison = "travaille", en_cours
    elif cat == "blocked" or d.get("interruptedAwaitingPerson"):
        etat, raison = "attend toi", f"elle t'a posé une question{depuis}"
    elif cat == "review_ready" or (fresh and s.get("needs_action")):
        etat, raison = "à relire", f"son tour est fini{depuis}, elle a quelque chose à te montrer"
    elif cat == "completed":
        etat, raison = "fini", f"elle a dit avoir terminé{depuis}"
    else:
        etat, raison = "inactif", f"rien de neuf{depuis}, et son dernier tour ne demande rien"
    # Ses propres PR sont toutes mergées ou fermées : le travail est livré, même si
    # son dernier message posait encore une question. C'est aussi ce que l'app appelle « done ».
    propres = [p for p in (d.get("prs") or []) if p.get("own")]
    livree = bool(propres) and all((p.get("state") or "").upper() in LIVREES for p in propres)
    # Son dernier tour s'est fini sur une question à la personne, il y a moins de trois jours : elle
    # attend, même si le résumé de l'app n'est plus à jour et même si ses PR sont mergées.
    demande, reco = "", ""
    if etat != "travaille" and act and now - act < 3 * JOUR:
        demande, reco = derniere_demande(d, transcriptions)
    if demande:
        etat, raison = "attend toi", f"son dernier tour s'est fini sur une question pour toi{depuis}"
    elif livree and etat in ("attend toi", "à relire", "inactif"):
        etat, raison = "fini", "ses PR sont toutes mergées ou fermées"
    return {
        "id": d.get("sessionId"),
        # L'identifiant Claude de la session : ce que « qct » attend pour la résumer.
        "cli": d.get("cliSessionId") or "",
        "titre": (d.get("title") or "Sans titre")[:80],
        "etat": etat,
        # Pourquoi cet état : ce que le panneau dit au survol de la pastille.
        "raison": raison,
        "detail": masque(demande[:140]) if demande else (masque((s.get("needs_action") or s.get("status_detail") or "")[:140]) if fresh else ""),
        # Ce que la session recommande de répondre à sa question (le premier bouton qu'elle proposait).
        "reco": masque(reco[:80]),
        "minutes": int((now - act) / 60000) if act else None,
        "activite": act or None,
        "date": date_courte(act),
        "favori": bool(d.get("isStarred")),
        # La personne a-t-elle ouvert la session depuis la fin de son dernier tour ?
        "vu": bool(d.get("isArchived")) or (d.get("lastFocusedAt") or 0) >= (edge or act),
    }


def a_faire(dossier):
    """La liste « À faire » de la personne (« a-faire.json », à côté des réglages) : ce qu'elle a mis
    de côté pour plus tard. Chaque entrée : id, texte, et au besoin detail, pour (AAAA-MM-JJ), session."""
    try:
        liste = json.load(open(os.path.join(dossier, "a-faire.json")))
    except Exception:
        return []
    sortie = []
    for i, x in enumerate(liste if isinstance(liste, list) else []):
        if not isinstance(x, dict) or not str(x.get("texte") or "").strip():
            continue
        sortie.append({"id": str(x.get("id") or i), "texte": str(x["texte"]).strip()[:200],
                       "detail": str(x.get("detail") or "")[:2000], "pour": str(x.get("pour") or "")[:10],
                       "session": str(x.get("session") or "")})
    return sortie


def est_suivie(titre, prefixes):
    """Vrai si le titre commence par l'un des débuts à suivre (réglage « suivre »), sans tenir compte de la casse."""
    t = str(titre or "").strip().lower()
    return any(t.startswith(str(p).strip().lower()) for p in prefixes if str(p).strip())


def auteurs_des_pr():
    """Pour chaque PR, la session qui l'a ouverte (la plus récente), archivée ou non : de quoi résumer
    le travail derrière une PR. {numéro: {"id", "cli", "activite"}}"""
    out = {}
    for f in glob.glob(os.path.join(SESSIONS, "*", "*", "local_*.json")):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        if not d.get("cliSessionId"):
            continue
        for p in d.get("prs") or []:
            n = p.get("prNumber")
            if not p.get("own") or not n:
                continue
            act = d.get("lastActivityAt") or 0
            if str(n) not in out or act > out[str(n)]["activite"]:
                out[str(n)] = {"id": d.get("sessionId"), "cli": d.get("cliSessionId"), "activite": act}
    return out


def etat_fini_non_vu(s):
    return s.get("etat") == "fini" and s.get("vu") is False


def surnom_epingle(titre, epingles):
    """Le surnom d'une session épinglée en haut du tableau (réglage « epingles » : [{"titre": début, "nom": surnom}]), ou ""."""
    for e in epingles or []:
        if isinstance(e, dict) and est_suivie(titre, [e.get("titre")]):
            return str(e.get("nom") or titre)
    return ""


def sessions(cli_id, suivre=(), vus=None, epingles=None):
    """`vus` : les sessions marquées « vue » depuis le panneau, {id: activité au moment du clic}."""
    out, me = [], {"favori": False}
    vus = vus or {}
    now = time.time() * 1000
    for f in glob.glob(os.path.join(SESSIONS, "*", "*", "local_*.json")):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        if d.get("cliSessionId") == cli_id:
            # La session qui affiche le panneau : inutile de la lister chez elle, sauf si elle est suivie.
            me = {"favori": bool(d.get("isStarred")), "id": d.get("sessionId")}
            if not est_suivie(d.get("title"), suivre) and not surnom_epingle(d.get("title"), epingles):
                continue
        # Une session suivie (réglage « suivre ») reste au tableau même finie, même archivée.
        surnom = surnom_epingle(d.get("title"), epingles)
        suivie = est_suivie(d.get("title"), suivre) or bool(surnom)
        if d.get("isArchived") and not suivie:
            continue
        # Archivée et sans activité depuis trois jours : elle a fait son temps, même suivie.
        if d.get("isArchived") and now - (d.get("lastActivityAt") or 0) > 3 * JOUR:
            continue
        s = classer_session(d, now)
        s["suivi"] = suivie
        if surnom:
            # Épinglée : tout en haut du tableau, sous son surnom.
            s["epingle"], s["titre"] = True, surnom
        # Archivée mais encore au travail ou en attente de toi : son vrai état prime.
        # Marquée « vue » depuis le panneau, et rien de neuf depuis : c'est vu.
        if vus.get(s["id"]) and vus.get(s["id"]) == s.get("activite"):
            s["vu"] = True
            if s["etat"] == "à relire":
                s["etat"], s["raison"] = "fini", "tu l'as marquée comme vue"
        # La session qui affiche le panneau est sous les yeux de la personne.
        if d.get("cliSessionId") == cli_id:
            s["vu"] = True
        if etat_fini_non_vu(s):
            s["raison"] = "elle a fini, et tu ne l'as pas ouverte depuis"
        if d.get("isArchived") and s["etat"] in ("fini", "inactif"):
            s["etat"], s["raison"] = "fini", "elle est archivée, et gardée ici parce que tu la suis"
        out.append(s)
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


ROLES = {"web", "api", "redis", "files", "faketg", "worker", "db", "front", "back", "server", "app"}


def role_et_groupe(nom, port=None):
    """« essai-recette-api » -> ("api", "essai-recette") ; « web-integration-12 » -> ("web", "integration-12").
    Le port écrit dans le nom (« dev-main-3210 ») ne compte pas : « dev-main »."""
    mots = [m for m in re.split(r"[-_ ]+", str(nom or "").lower()) if m and m != str(port)]
    roles = [m for m in mots if m in ROLES]
    reste = [m for m in mots if m not in ROLES]
    return (roles[0] if roles else ""), ("-".join(reste) or str(nom or ""))


def entier(v):
    try:
        return int(v)
    except Exception:
        return None


def localhost(cfg, ecoute):
    """Toutes les piles connues : celles des réglages (« piles », gardées) puis celles de launch.json,
    chacune avec son groupe (une pile = web + API + …) et son rôle. `autres` : celles qui sont arrêtées."""
    try:
        entries = json.load(open(LAUNCH)).get("configurations", [])
    except Exception:
        entries = []
    by_name = {e.get("name"): e for e in entries}
    piles, vus = [], set()
    for p in cfg.get("piles", []):
        e = by_name.get(p.get("lanceur")) or {}
        port = entier(p.get("port") or e.get("port"))
        role, groupe = role_et_groupe(p.get("lanceur") or p.get("nom"))
        piles.append({
            "nom": p.get("nom") or e.get("name"),
            "lanceur": p.get("lanceur") if e else None,
            "port": port,
            "url": e.get("url") or f"http://localhost:{port}",
            "actif": port in ecoute,
            "epinglee": True,
            "dossier": p.get("dossier"),
            "commande": p.get("commande"),
            # Un nom de groupe donné dans les réglages réunit plusieurs ports sous une seule pastille.
            "groupe": p.get("groupe") or p.get("nom") or groupe,
            "role": p.get("role") or role,
        })
        vus.add(port)
    autres = 0
    for e in entries:
        port = entier(e.get("port"))
        if port is None or port in vus:
            continue
        role, groupe = role_et_groupe(e.get("name"), port)
        actif = port in ecoute
        piles.append({"nom": e.get("name"), "lanceur": e.get("name"), "port": port,
                      "url": e.get("url") or f"http://localhost:{port}", "actif": actif, "epinglee": False,
                      "groupe": groupe, "role": role})
        vus.add(port)
        autres += 0 if actif else 1
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


def etats_pr(cfg, numeros):
    """L'état sur GitHub (OPEN, MERGED, CLOSED) de chaque PR demandée ; une PR illisible est omise."""
    repo = str(cfg.get("repo") or "").strip()
    out = {}
    if not repo:
        return out
    for n in numeros[:20]:
        code, txt = run(["gh", "pr", "view", str(n), "--repo", repo, "--json", "state"], timeout=20)
        if code == 0:
            try:
                out[str(n)] = json.loads(txt).get("state", "")
            except Exception:
                pass
    return out


def detail_garde(cfg, numero):
    """Les fichiers que la garde (réglage « garde ») signale sur une PR, d'après le journal de son échec :
    les lignes « ✗ <fichier> — … », comptées par fichier."""
    repo = str(cfg.get("repo") or "").strip()
    garde_nom = str(cfg.get("garde") or "").strip().lower()
    if not repo or not garde_nom or not numero:
        return {"etat": "echec", "fichiers": []}
    code, txt = run(["gh", "pr", "checks", str(numero), "--repo", repo, "--json", "name,link,state"], timeout=30)
    if code not in (0, 1, 8):
        return {"etat": "echec", "fichiers": []}
    try:
        checks = json.loads(txt or "[]")
    except Exception:
        checks = []
    lien = next((c.get("link") or "" for c in checks if garde_nom in (c.get("name") or "").lower()), "")
    m = re.search(r"/actions/runs/(\d+)", lien)
    if not m:
        return {"etat": "echec", "fichiers": []}
    _, journal = run(["gh", "run", "view", m.group(1), "--repo", repo, "--log-failed"], timeout=60)
    return {"etat": "pret", "fichiers": fichiers_garde(journal)}


def fichiers_garde(journal):
    """« ✗ chemin/du/test.tsx — test retiré : … » -> [{"fichier": "test", "changements": n}], dans l'ordre."""
    compte = {}
    for ligne in journal.splitlines():
        m = re.search(r"✗\s+(\S+)\s+—", ligne)
        if m:
            nom = os.path.basename(m.group(1))
            nom = re.sub(r"\.test\.[jt]sx?$|\.[jt]sx?$|\.py$", "", nom)
            compte[nom] = compte.get(nom, 0) + 1
    return [{"fichier": f, "changements": n} for f, n in compte.items()]


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
    if "--garde-detail" in flags:
        # Ce que la garde reproche à une PR : {"etat": "pret", "fichiers": [{"fichier": …, "changements": 8}]}.
        try:
            cfg = json.load(open(cfg_path))
        except Exception:
            cfg = {}
        n = next((a for a in sys.argv[3:] if a.isdigit()), "")
        print(json.dumps(detail_garde(cfg, n), ensure_ascii=False))
        return
    if "--etat" in flags:
        # L'état actuel de quelques PR, relu juste avant un merge : {"1621": "MERGED", …}.
        try:
            cfg = json.load(open(cfg_path))
        except Exception:
            cfg = {}
        print(json.dumps(etats_pr(cfg, [a for a in sys.argv[3:] if a.isdigit()])))
        return
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
    suivre = cfg.get("suivre") or []
    try:
        vus = json.load(open(os.path.join(os.path.dirname(cfg_path), "vus.json")))
    except Exception:
        vus = {}
    sess, me = sessions(cli_id, suivre if isinstance(suivre, list) else [suivre], vus if isinstance(vus, dict) else {}, cfg.get("epingles") if isinstance(cfg.get("epingles"), list) else [])
    piles, autres = localhost(cfg, ports_ecoute())
    data = {"sessions": sess, "moi": me, "piles": piles, "autresPiles": autres,
            "systeme": systeme(cfg), "configErreur": cfg_err, "heure": time.strftime("%H:%M:%S"),
            "sombre": theme_sombre(), "essai": essai_actif(cfg), "qct": chemin_qct(cfg),
            "aFaire": a_faire(os.path.dirname(cfg_path)),
            "sansRepo": not str(cfg.get("repo") or "").strip(),
            "labelOk": str(cfg.get("labelOk") or "").strip(),
            "avecGarde": bool(str(cfg.get("garde") or "").strip()),
            "avecProd": bool(str(cfg.get("brancheProd") or "").strip())}
    if "--prs" in flags:
        data["prs"] = prs(cfg, jours)
        data["auteurs"] = auteurs_des_pr()
        data["orphelines"] = orphelines(piles, branches_fermees(cfg))
    if "--sante" in flags:
        data["sante"] = sante(cfg)
    print(json.dumps(data, ensure_ascii=False))


if __name__ == "__main__":
    main()
