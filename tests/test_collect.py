"""Règles de classement du collecteur. Lancer : python3 tests/test_collect.py"""
import importlib.util
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


if __name__ == "__main__":
    unittest.main()
