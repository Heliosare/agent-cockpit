# Voir le panneau sans l'app

Deux scripts pour régler la mise en page sans attendre que la fenêtre de Claude soit à l'écran.

1. `arbres.py <dossier du mod> <instantané.json> <sortie.json> <colonnes> [touches…]` : fait dessiner le panneau par le moteur de l'app (via `claude plugin test`) pour un instantané donné, la sortie de `scripts/collect.py`, et écrit l'arbre obtenu. Les touches (par exemple `coche-12`) sont pressées avant. Le moteur est celui de l'app de bureau ; `CLAUDE_BIN=<chemin>` en désigne un autre.
2. `rendre.py <arbre.json> <colonnes>` : transforme cet arbre en HTML qui imite l'app de bureau. À ouvrir dans un navigateur, ou à capturer avec Chrome sans fenêtre (`--headless=new --screenshot=…`).

Le rendu est calé sur des captures réelles (thème sombre, 17/11) : une case = 8,85 px sur 20 px, texte 13,5 px, bouton « plain » = texte avec 8 px de marge, bouton normal = pastille de 28 px. Ce qui n'a pas été vu dans l'app (les pas « xs »/« sm », la taille « caption », les bordures) y est une supposition : une vraie capture fait foi (`screencapture -l <id de la fenêtre>` quand le panneau est affiché ; `~/.claude/flybuddy-panel/affichage.json` est réécrit toutes les 20 s tant qu'il l'est).

Banc d'essai dans l'app : `"essai": true` et `"essaiJusqua": <heure limite en ms>` dans `~/.claude/flybuddy-panel/config.json` ajoutent sous le panneau une rangée d'essais (tailles, pas, bordures, coupes) jusqu'à cette heure.
