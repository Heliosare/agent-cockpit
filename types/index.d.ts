export type EtatSession = 'attend toi' | 'travaille' | 'à relire' | 'fini' | 'inactif'

export type Session = {
  id: string
  /** L'identifiant Claude de la session, celui que « qct » attend. */
  cli?: string
  titre: string
  etat: EtatSession
  detail: string
  minutes: number | null
  favori: boolean
  /** Dernière activité, en millisecondes (pour trier). */
  activite: number | null
  /** Dernière activité, « jj/mm HH:MM », heure de Paris. */
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
  /** Dernière mise à jour, « jj/mm HH:MM », heure de Paris. */
  date: string
  conflit: boolean
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
}

/** `court` : le texte du bouton, quand `libelle` est trop long pour une ligne. */
export type Tache = { libelle: string; texte: string; court?: string }

export type Snapshot = {
  sessions: Session[]
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
}

/** Ce qu'un bouton demande à Claude : un texte à trous, voir CONSIGNES_DEFAUT. */
export type Consignes = { tester?: string; merger?: string; lancer?: string }

/** Le résumé express d'une session, demandé depuis sa ligne. */
export type Resume = { etat: 'en cours' | 'pret' | 'echec'; texte: string }

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
}

declare module 'claude-code' {
  interface PluginState {
    'flybuddy-panel': {
      snapshot: Shaped<Snapshot | null>
      vue: Shaped<Vue>
    }
  }
}
