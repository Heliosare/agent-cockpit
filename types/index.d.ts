export type EtatSession = 'attend toi' | 'travaille' | 'à relire' | 'fini' | 'inactif'

export type Session = {
  id: string
  /** L'identifiant Claude de la session, celui que « qct » attend. */
  cli?: string
  titre: string
  etat: EtatSession
  /** Son titre commence par un début à suivre (réglage « suivre ») : finie, elle reste visible dans « Suivi ». */
  suivi?: boolean
  /** La personne a ouvert la session depuis la fin de son dernier tour. Finie et pas vue : elle reste dans « À toi ». */
  vu?: boolean
  /** Épinglée tout en haut du tableau, sous un surnom (réglage « epingles »). */
  epingle?: boolean
  /** Pourquoi cet état, en une phrase (au survol de la pastille). */
  raison?: string
  detail: string
  /** Ce que la session recommande de répondre à sa question, quand elle l'a dit. */
  reco?: string
  /** Ses propres PR sont toutes mergées ou fermées : finie, elle n'est plus « à vérifier ». */
  livree?: boolean
  /** Les numéros de ses propres PR encore ouvertes. */
  prsOuvertes?: number[]
  minutes: number | null
  favori: boolean
  /** Dernière activité, en millisecondes (pour trier). */
  activite: number | null
  /** Dernière activité, « jj/mm HH:MM », dans le fuseau réglé (« fuseau ») ou celui de la machine. */
  date: string
}

export type Pr = {
  numero: number
  titre: string
  url: string
  garde: string
  ci: 'rouge' | 'en cours' | 'vert' | 'aucune'
  brouillon: boolean
  /** La PR porte le label d'approbation de l'équipe (réglage « labelOk »). */
  ownerOk: boolean
  base: string
  /** La PR vise la branche de production (réglage « brancheProd ») : elle ne se coche qu'à la main. */
  prod?: boolean
  branche?: string
  /** Dernière mise à jour, en millisecondes (pour trier). */
  maj: number
  /** Dernière mise à jour, « jj/mm HH:MM », dans le fuseau réglé (« fuseau ») ou celui de la machine. */
  date: string
  conflit: boolean
  /** GitHub n'a pas encore dit si elle est mergeable : ni prête ni en conflit pour l'instant. */
  calcul?: boolean
  /** Son merge vient d'être demandé à Claude : elle ne se coche plus. */
  enMerge?: boolean
  /** Pas mise à jour depuis des jours. Le panneau ne range à part que celles qui seraient « bloquées ». */
  ancien?: boolean
}

export type Pile = {
  nom: string
  lanceur: string | null
  port: number
  url: string
  actif: boolean
  epinglee: boolean
  dossier?: string | null
  commande?: string | null
  /** La pile à laquelle ce port appartient (web, API, Redis… d'un même worktree) : une pastille par groupe. */
  groupe?: string
  /** web, api, redis… ; vide si inconnu. */
  role?: string
}

/** `court` : le texte du bouton, quand `libelle` est trop long pour une ligne. */
export type Tache = { libelle: string; texte: string; court?: string }

/** Une chose mise de côté pour plus tard (« a-faire.json »). `pour` : AAAA-MM-JJ. `session` : celle à rouvrir. */
export type AFaire = { id: string; texte: string; detail?: string; pour?: string; session?: string }

export type Snapshot = {
  sessions: Session[]
  /** La liste « À faire », montrée dans le groupe épinglé. */
  aFaire?: AFaire[]
  piles: Pile[]
  autresPiles: number
  /** `worktrees` : `null` quand aucun dépôt local n'est réglé (« depot »). */
  systeme: { disque: string; worktrees: number | null }
  configErreur: string | null
  heure: string
  prs?: Pr[] | null
  /** Absent : pas encore demandé. `null` : aucune adresse réglée (« santeProd »). */
  sante?: { ok: boolean; code: number } | null
  taches: Tache[]
  erreur?: string
  /** Le thème de l'app : vrai en sombre. Absent : inconnu. */
  sombre?: boolean
  /** Réglage `essai` : montre le banc d'essai d'affichage sous le panneau. */
  essai?: boolean
  /** Chemin du script « qct » (résumé express d'une session), s'il est installé. */
  qct?: string | null
  /** Ports des piles qui tournent alors que la PR de leur worktree est mergée ou fermée, ou que leur dossier n'existe plus. */
  orphelines?: number[]
  /** Pour chaque PR, la session qui l'a ouverte : de quoi montrer son résumé express sur la ligne de la PR. */
  auteurs?: Record<string, { id: string; cli: string; activite: number }>
  /** Aucun dépôt GitHub n'est réglé (« repo ») : pas de PR à lister. */
  sansRepo?: boolean
  /** Le label d'une PR approuvée (réglage « labelOk »), pour l'écrire sur sa ligne. */
  labelOk?: string
  /** Un contrôle est exigé avant un merge (réglage « garde ») : sans lui, une PR verte reste bloquée. */
  avecGarde?: boolean
  /** Une branche de production est réglée (« brancheProd ») : ses PR ne se cochent qu'à la main. */
  avecProd?: boolean
  /** Les demandes « tester », « merger », « lancer » réécrites dans les réglages. */
  consignes?: Consignes
  /** Les réponses proposées sous une session qui attend (réglage « reponses »). */
  reponses?: string[]
}

/** Ce qu'un bouton demande à Claude : un texte à trous, voir CONSIGNES_DEFAUT. */
export type Consignes = { tester?: string; merger?: string; lancer?: string; ok?: string }

/** Ce que la garde reproche à une PR : les fichiers de tests touchés, et combien de changements dans chacun. */
export type DetailGarde = { etat: 'en cours' | 'pret' | 'echec'; fichiers: { fichier: string; changements: number }[] }

/** Le résumé express d'une session, demandé depuis sa ligne. */
export type Resume = { etat: 'en cours' | 'pret' | 'echec'; texte: string }

/** Un résumé express préparé d'avance, pour l'activité de la session qu'il résume. */
export type Fiche = Resume & { activite: number }

/** La colonne qui ordonne les lignes à l'intérieur de chaque groupe. */
export type CleTri = 'etat' | 'titre' | 'date'
/** `sens` : 1 croissant, -1 décroissant. */
export type Tri = { cle: CleTri; sens: 1 | -1 }

export type Vue = {
  /** Montre aussi le groupe « Terminé » (sessions finies ou inactives). */
  toutesSessions: boolean
  dernierEnvoi: string
  /** Numéros des PR cochées pour un merge groupé. */
  selection: number[]
  tri: Tri
  /** Les résumés express affichés, par identifiant de session. */
  resumes: Record<string, Resume>
  /** La PR dont on confirme l'approbation (bouton du label « labelOk »), avec ce que la garde lui reproche. */
  confirmeOk: { numero: number; detail: DetailGarde } | null
  /** Les PR dont l'approbation a été demandée à Claude, avec l'heure de la demande (ms). */
  okDemande: Record<number, number>
  /** Les piles arrêtées sont dépliées sous « Localhost ». */
  pilesArretees: boolean
  /** Les sessions auxquelles une réponse a été envoyée depuis le panneau : le mot envoyé, et l'activité de la session à ce moment. */
  repondu: Record<string, { mot: string; activite: number }>
  /** Les groupes repliés : seule leur bande reste. */
  replies: string[]
  /** Les sessions dont le résumé préparé d'avance est affiché sous la ligne. */
  ouverts: string[]
  /** Les PR dont le merge vient d'être demandé, avec l'heure de la demande (ms). */
  enMerge: Record<number, number>
}

declare module 'claude-code' {
  interface PluginState {
    'agent-cockpit': {
      snapshot: Shaped<Snapshot | null>
      vue: Shaped<Vue>
      fiches: Shaped<Record<string, Fiche>>
    }
  }
}
