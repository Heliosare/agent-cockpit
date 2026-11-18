"""Règles de classement du collecteur. Lancer : python3 tests/test_collect.py"""
import importlib.util
import json
import os
import unittest

ICI = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("collect", os.path.join(ICI, "..", "scripts", "collect.py"))
collect = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collect)

NOW = 1_800_000_000_000
HEURE = 3_600_000


def session(cat, age_ms, prs=(), frais=True, **plus):
    d = {
        "sessionId": "local_x",
        "title": "Une session",
        "lastActivityAt": NOW - age_ms,
        "lastTurnEdgeAt": NOW - age_ms,
        "postTurnSummary": {"status_category": cat, "needs_action": "entre le code 123456 dans Chrome", "status_detail": "x"},
        "postTurnSummaryFor": "u1",
        "lastAssistantUuid": "u1" if frais else "u2",
        "prs": list(prs),
    }
    d.update(plus)
    return d


def pr(state, own=True):
    p = {"prNumber": 1, "state": state, "url": "https://example.invalid/1"}
    if own:
        p["own"] = True
    return p


class Classement(unittest.TestCase):
    def etat(self, d):
        return collect.classer_session(d, NOW)

    def test_question_en_attente(self):
        s = self.etat(session("blocked", HEURE))
        self.assertEqual(s["etat"], "attend toi")

    def test_ses_pr_sont_mergees_la_session_est_finie(self):
        s = self.etat(session("blocked", 5 * collect.JOUR, [pr("MERGED"), pr("MERGED"), pr("CLOSED")]))
        self.assertEqual(s["etat"], "fini")

    def test_une_pr_encore_ouverte_la_garde_active(self):
        s = self.etat(session("blocked", HEURE, [pr("MERGED"), pr("OPEN")]))
        self.assertEqual(s["etat"], "attend toi")

    def test_les_pr_seulement_citees_ne_comptent_pas(self):
        s = self.etat(session("review_ready", HEURE, [pr("MERGED", own=False), pr("MERGED", own=False)]))
        self.assertEqual(s["etat"], "à relire")

    def test_une_session_qui_travaille_reste_en_cours(self):
        d = session("blocked", 1000, [pr("MERGED")])
        d["lastTurnEdgeAt"] = NOW - 60_000
        self.assertEqual(self.etat(d)["etat"], "travaille")

    def test_une_demande_meme_vieille_t_attend_toujours(self):
        s = self.etat(session("blocked", 9 * collect.JOUR))
        self.assertEqual(s["etat"], "attend toi")
        self.assertNotIn("ancien", s)

    def test_resume_perime_ne_dit_plus_rien(self):
        s = self.etat(session("blocked", HEURE, frais=False))
        self.assertEqual(s["etat"], "inactif")
        self.assertEqual(s["detail"], "")

    def test_pas_de_code_dans_le_detail(self):
        s = self.etat(session("blocked", HEURE))
        self.assertNotIn("123456", s["detail"])

    def test_date_dans_le_fuseau_regle(self):
        # 2026-11-17 14:34:56 UTC = 15:34 à Paris, 09:34 à New York
        collect.regler_fuseau("Europe/Paris")
        self.assertEqual(collect.date_courte(1794926096000), "17/11 15:34")
        collect.regler_fuseau("America/New_York")
        self.assertEqual(collect.date_courte(1794926096000), "17/11 09:34")
        self.assertEqual(collect.date_courte(0), "")
        # Un fuseau inconnu ou absent : celui de la machine, sans erreur.
        collect.regler_fuseau("Nulle/Part")
        self.assertRegex(collect.date_courte(1794926096000), r"^\d\d/\d\d \d\d:\d\d$")
        collect.regler_fuseau(None)

    def test_rien_de_personnel_par_defaut(self):
        # Sans réglage : pas de dépôt, pas d'adresse de santé, pas de worktrees comptés.
        self.assertEqual(collect.prs({}), [])
        self.assertIsNone(collect.sante({}))
        self.assertIsNone(collect.systeme({})["worktrees"])

    def test_banc_d_essai_borne_dans_le_temps(self):
        self.assertTrue(collect.essai_actif({"essai": True, "essaiJusqua": NOW + 1000}, NOW))
        self.assertFalse(collect.essai_actif({"essai": True, "essaiJusqua": NOW - 1}, NOW))
        self.assertFalse(collect.essai_actif({"essai": True}, NOW))
        self.assertFalse(collect.essai_actif({"essaiJusqua": NOW + 1000}, NOW))

    def test_identifiant_claude_pour_qct(self):
        s = self.etat(session("completed", HEURE, cliSessionId="abc-123"))
        self.assertEqual(s["cli"], "abc-123")
        self.assertEqual(self.etat(session("completed", HEURE))["cli"], "")

    def test_qct_seulement_s_il_est_installe(self):
        import stat, tempfile
        with tempfile.TemporaryDirectory() as d:
            chemin = os.path.join(d, "qct")
            open(chemin, "w").write("#!/bin/sh\n")
            self.assertIsNone(collect.chemin_qct({"qct": chemin}))  # pas exécutable
            os.chmod(chemin, os.stat(chemin).st_mode | stat.S_IXUSR)
            self.assertEqual(collect.chemin_qct({"qct": chemin}), chemin)
            self.assertIsNone(collect.chemin_qct({"qct": False}))
            self.assertIsNone(collect.chemin_qct({"qct": os.path.join(d, "absent")}))

    def test_anciennete(self):
        self.assertTrue(collect.est_ancien(NOW - 4 * collect.JOUR, NOW, 3))
        self.assertFalse(collect.est_ancien(NOW - 2 * collect.JOUR, NOW, 3))
        self.assertFalse(collect.est_ancien(0, NOW, 3))

    def test_piles_orphelines(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            entrees = [
                {"name": "garde", "runtimeArgs": ["--dir", d]},
                {"name": "disparue", "runtimeArgs": ["-c", "cd /nulle/part/apps/web && npm run dev"]},
                {"name": "epinglee", "runtimeArgs": ["--dir", "/nulle/part"]},
                {"name": "arretee", "runtimeArgs": ["--dir", "/nulle/part"]},
            ]
            piles = [
                {"nom": "garde", "lanceur": "garde", "port": 1, "actif": True, "epinglee": False},
                {"nom": "disparue", "lanceur": "disparue", "port": 2, "actif": True, "epinglee": False},
                {"nom": "epinglee", "lanceur": "epinglee", "port": 3, "actif": True, "epinglee": True},
                {"nom": "arretee", "lanceur": "arretee", "port": 4, "actif": False, "epinglee": False},
            ]
            # Un dossier qui n'est pas un dépôt git, sans PR fermée connue : gardé.
            self.assertEqual(collect.orphelines(piles, set(), entrees), [2])
            self.assertEqual(collect.dossier_entree(entrees[1]), "/nulle/part/apps/web")
            # Un chemin avec des espaces reste entier.
            self.assertEqual(collect.dossier_entree({"runtimeArgs": ["--dir", "/a b/c d"]}), "/a b/c d")

    def test_groupe_et_role_d_une_pile(self):
        self.assertEqual(collect.role_et_groupe("test-essai-api"), ("api", "test-essai"))
        self.assertEqual(collect.role_et_groupe("web-integration-12"), ("web", "integration-12"))
        self.assertEqual(collect.role_et_groupe("capture-static"), ("", "capture-static"))
        self.assertEqual(collect.role_et_groupe("api-dev-main-3211", 3211), ("api", "dev-main"))

    def test_fichiers_signales_par_la_garde(self):
        journal = "\n".join([
            "guard\tstep\t2026-11-17T20:33:42Z ✗ apps/web/src/__tests__/a/decision-x.test.tsx — test retiré : it(\"…\")",
            "guard\tstep\t2026-11-17T20:33:42Z ✗ apps/web/src/__tests__/a/decision-x.test.tsx — expect retiré ou modifié : …",
            "guard\tstep\t2026-11-17T20:33:42Z ✗ tests/autre.py — test retiré : …",
            "guard\tstep\t2026-11-17T20:33:42Z 2 changement(s) …",
        ])
        self.assertEqual(collect.fichiers_garde(journal), [{"fichier": "decision-x", "changements": 2}, {"fichier": "autre", "changements": 1}])
        self.assertEqual(collect.detail_garde({}, "12"), {"etat": "echec", "fichiers": []})

    def test_un_tour_en_cours_se_voit_dans_la_transcription(self):
        import tempfile, time as t
        maintenant = t.time() * 1000
        with tempfile.TemporaryDirectory() as dossier:
            chemin = os.path.join(dossier, "cli.jsonl")
            def ecrire(*entrees):
                open(chemin, "w").write("\n".join(json.dumps(e) for e in entrees) + "\n")
            d = session("review_ready", 60_000, cliSessionId="cli", frais=False)
            d["lastTurnEdgeAt"] = d["lastActivityAt"]
            trouve = lambda cli: [chemin]
            # Un outil lancé, sans réponse encore : la session travaille.
            ecrire({"type": "user", "message": {"content": "vas-y"}},
                   {"type": "assistant", "message": {"stop_reason": "tool_use", "content": [{"type": "tool_use"}]}},
                   {"type": "custom-title"})
            self.assertEqual(collect.classer_session(d, maintenant, trouve)["etat"], "travaille")
            # Le tour est fini : elle ne travaille plus.
            ecrire({"type": "assistant", "message": {"stop_reason": "end_turn", "content": [{"type": "text"}]}})
            self.assertNotEqual(collect.classer_session(d, maintenant, trouve)["etat"], "travaille")
            # Tour fini, mais un sous-agent lancé en fond n'a pas encore rendu : elle travaille.
            iso = t.strftime("%Y-%m-%dT%H:%M:%SZ", t.gmtime())
            lance = {"type": "assistant", "timestamp": iso, "message": {"stop_reason": "tool_use", "content": [
                {"type": "tool_use", "id": "t1", "name": "Agent", "input": {"run_in_background": "true"}}]}}
            fin = {"type": "assistant", "message": {"stop_reason": "end_turn", "content": [{"type": "text"}]}}
            ecrire(lance, fin)
            self.assertEqual(collect.classer_session(d, maintenant, trouve)["etat"], "travaille")
            # Sa notification de fin est arrivée : plus rien en cours.
            ecrire(lance, {"type": "user", "message": {"content": "<task-notification><tool-use-id>t1</tool-use-id><status>completed</status></task-notification>"}}, fin)
            self.assertNotEqual(collect.classer_session(d, maintenant, trouve)["etat"], "travaille")
            # Une commande de fond refusée n'a jamais tourné.
            ecrire({"type": "assistant", "timestamp": iso, "message": {"stop_reason": "tool_use", "content": [
                {"type": "tool_use", "id": "t2", "name": "Bash", "input": {"run_in_background": True}}]}},
                   {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t2", "is_error": True}]}}, fin)
            self.assertNotEqual(collect.classer_session(d, maintenant, trouve)["etat"], "travaille")
            # Tour fini, mais un sous-agent écrit encore sa transcription : elle travaille.
            ecrire(fin)
            os.makedirs(os.path.join(dossier, "cli", "subagents"))
            sous = os.path.join(dossier, "cli", "subagents", "agent-1.jsonl")
            open(sous, "w").write("{}\n")
            r = collect.classer_session(d, maintenant, trouve)
            self.assertEqual(r["etat"], "travaille")
            self.assertIn("sous-agent", r["raison"])
            # Il s'est tu depuis dix minutes : plus rien.
            os.utime(sous, (maintenant / 1000 - 600, maintenant / 1000 - 600))
            self.assertNotEqual(collect.classer_session(d, maintenant, trouve)["etat"], "travaille")
            # Un tour interrompu ne compte pas.
            ecrire({"type": "user", "message": {"content": [{"type": "text", "text": "[Request interrupted by user]"}]}})
            self.assertNotEqual(collect.classer_session(d, maintenant, trouve)["etat"], "travaille")

    def test_titres_suivis(self):
        self.assertTrue(collect.est_suivie("MVP : étape 4", ["mvp"]))
        self.assertFalse(collect.est_suivie("Le MVP", ["MVP"]))
        self.assertFalse(collect.est_suivie("MVP", []))


if __name__ == "__main__":
    unittest.main()
