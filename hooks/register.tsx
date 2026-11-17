import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CleTri, Consignes, EtatSession, Pile, Pr, Resume, Session, Snapshot, Tache, Tri, Vue } from '../types'

const PANE = 'flybuddy'
// The pane's title, unless the settings give another (« titre »).
const TITRE = 'Tableau de bord'

const VUE_DEFAUT: Vue = {
  toutesSessions: false,
  dernierEnvoi: '',
  selection: [],
  tri: { cle: 'etat', sens: 1 },
  resumes: {},
  enMerge: {},
  pilesArretees: false,
}

// Change a tag when the value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const snapshot = atom({ plugin: 'flybuddy-panel', key: 'snapshot' } as const, null as Snapshot | null, {
  shape: 'snapshot-5',
})
const vue = atom({ plugin: 'flybuddy-panel', key: 'vue' } as const, VUE_DEFAUT, {
  shape: 'vue-7',
})

// What the pane offers before the person writes their own tasks in the
// settings file.
const TACHES_DEFAUT: Tache[] = [
  {
    court: "What's next",
    libelle: "What's next",
    texte: "What's next ? Dis-moi en quelques lignes ce qui reste à faire et par quoi continuer.",
  },
  {
    court: 'Nettoyer',
    libelle: 'Nettoyer sessions et worktrees',
    texte: 'Nettoie ma machine. Note d\'abord l\'espace disque libre.\n1. Archive les sessions Claude terminées.\n2. Liste les worktrees git. Pour chacun dont la PR est mergée ou fermée : arrête ses serveurs locaux (web, API, Redis…), supprime le worktree, puis supprime les bases Postgres de test qu\'il utilisait.\nGarde les piles listées dans ~/.claude/flybuddy-panel/config.json et tout ce qui sert une PR encore ouverte. Ne supprime jamais une base *_dev, ni celles des piles gardées.\n3. Retire de ~/.claude/launch.json les entrées dont le dossier n\'existe plus.\n4. Donne l\'espace disque libre avant et après, et la liste de ce que tu as supprimé.\nNe pousse rien.',
  },
]

// What a button asks of Claude, as a text with holes ({numero}, {titre},
// {branche} ; {liste}, {nombre} ; {nom}, {port}, {detail}). The settings may
// rewrite each one (« consignes ») to fit a team's own way of working.
const CONSIGNES_DEFAUT: Required<Consignes> = {
  tester: `Ouvre la PR #{numero} (« {titre} », branche {branche}) dans ton navigateur intégré (preview_start), pour que je la teste.
1. Réutilise le worktree de la PR s'il existe, sinon crée-en un ; prends un port libre ; démarre l'application.
2. Lis ce que la PR change, puis mets en place en local des données fictives qui le montrent.
3. Va directement sur la page concernée et fais une capture.
4. Dis-moi en 3 lignes quoi regarder et ce qui est fictif.
Ne pousse rien, ne merge rien.`,
  merger: `Merge ces PR, une par une, dans cet ordre : {liste}.
C'est mon OK explicite pour ces {nombre} PR seulement, pas pour une autre.
Avant chaque merge : lis la PR et ses commentaires, vérifie que ses contrôles sont verts et qu'elle est mergeable. Sinon, saute-la et dis-moi pourquoi.
À la fin : une ligne par PR, mergée ou non.`,
  lancer: 'Lance la pile locale « {nom} » (port {port}){detail}. Ne pousse rien.',
}

type Config = {
  titre?: string
  rafraichirSecondes?: number
  prsSecondes?: number
  ouvrirAuto?: 'favorites' | 'toujours' | 'jamais'
  taches?: Tache[]
  consignes?: Consignes
}

// The settings file laid on a first run, for the person to fill in. Nothing
// in it names a repository, a site or a folder: those are theirs to give.
const REGLAGES_DEPART = {
  _aide:
    'Réglages du panneau, relus à chaque rafraîchissement. « repo » : le dépôt GitHub dont on liste les PR (compte/dépôt). « depot » : son dossier local, pour compter les worktrees. « santeProd » : une adresse à surveiller. « garde » : un morceau du nom du contrôle qui doit être vert avant un merge. « labelOk » : le label d’une PR approuvée. « brancheProd » : la branche de production (ses PR ne se cochent qu’à la main). « fuseau » : par exemple Europe/Paris. « joursAncien » : après combien de jours une PR bloquée est rangée à part. « taches » : les boutons, avec « court » (le texte du bouton), « libelle » et « texte » (la consigne envoyée à Claude). « piles » : les serveurs locaux à toujours montrer (nom, port, lanceur = son nom dans ~/.claude/launch.json). « consignes » : pour réécrire les demandes « tester », « merger » et « lancer ».',
  titre: TITRE,
  rafraichirSecondes: 30,
  prsSecondes: 90,
  ouvrirAuto: 'favorites',
  repo: '',
  depot: '',
  santeProd: '',
  garde: '',
  labelOk: '',
  brancheProd: '',
  fuseau: '',
  joursAncien: 3,
  taches: TACHES_DEFAUT,
  piles: [],
}

// U+FE0E asks for the text form of a glyph that also exists as a colour emoji.
const TEXTE = '︎'
const G = {
  tester: `▶${TEXTE}`, // ▶
  ouvrir: `↗${TEXTE}`, // ↗
  coche: `☑${TEXTE}`, // ☑
  vide: '☐', // ☐
  session: '❯', // ❯
  monte: '▲', // ▲
  descend: '▼', // ▼
  actualiser: '↻', // ↻
  modifier: '✎', // ✎
  actif: '●', // ●
  arrete: '○', // ○
  suite: '↳', // ↳
  resume: '≡', // ≡
  stop: '■', // ■
} as const
// A space the surface keeps and never breaks a line at.
const ESPACE = ' '
const insecable = (texte: string) => texte.replace(/ /g, ESPACE)

type NomTeinte = 'vert' | 'rouge' | 'ambre' | 'bleu' | 'violet' | 'orange' | 'gris'

// The mockup's colours, light text on a dark tint and the reverse: each pair
// reads at 5:1 or better. `bande`, `puce`, `survol` and `bord` are veils over
// the app's own ground, so they follow whatever it is.
type Palette = {
  pastilles: Record<NomTeinte, { fond: string; texte: string }>
  bande: string
  puce: string
  survol: string
  bord: string
}
const SOMBRE: Palette = {
  pastilles: {
    orange: { fond: '#4A2E18', texte: '#FFB27A' },
    bleu: { fond: '#1D3050', texte: '#8FBCFF' },
    violet: { fond: '#35284F', texte: '#C9A8FF' },
    vert: { fond: '#1E3A2A', texte: '#7FD8A0' },
    rouge: { fond: '#4A211D', texte: '#FF9B8F' },
    ambre: { fond: '#45361A', texte: '#F2C26B' },
    gris: { fond: '#33312E', texte: '#B5B2A9' },
  },
  bande: 'rgba(255, 255, 255, 0.08)',
  puce: 'rgba(255, 255, 255, 0.06)',
  survol: 'rgba(255, 255, 255, 0.05)',
  bord: 'rgba(255, 255, 255, 0.2)',
}
const CLAIR: Palette = {
  pastilles: {
    orange: { fond: '#FCE6D2', texte: '#9A4A0B' },
    bleu: { fond: '#DFEAFB', texte: '#1F4FA3' },
    violet: { fond: '#EBE2FB', texte: '#5B34A8' },
    vert: { fond: '#DDF3E4', texte: '#1B6B3C' },
    rouge: { fond: '#FBE1DD', texte: '#A3271B' },
    ambre: { fond: '#FBEBC8', texte: '#7A5200' },
    gris: { fond: '#ECEAE4', texte: '#55524B' },
  },
  bande: 'rgba(0, 0, 0, 0.06)',
  puce: 'rgba(0, 0, 0, 0.04)',
  survol: 'rgba(0, 0, 0, 0.04)',
  bord: 'rgba(0, 0, 0, 0.2)',
}
// A terminal has its own theme: there a state is its theme colour, inverted.
const CLE_THEME: Record<NomTeinte, string> = {
  vert: 'success',
  rouge: 'error',
  ambre: 'warning',
  bleu: 'suggestion',
  violet: 'merged',
  orange: 'claude',
  gris: 'inactive',
}

// The board is sorted by priority: what waits for the person, what runs by
// itself, what is stuck. What is finished or stale comes last, on request.
type Groupe = 'toi' | 'cours' | 'bloque' | 'fini'
type DefGroupe = { cle: Groupe; nom: string; aide: string }
const GROUPES: DefGroupe[] = [
  { cle: 'toi', nom: 'À toi', aide: 'ta réponse, ta relecture ou ton merge' },
  { cle: 'cours', nom: 'En cours', aide: "rien à faire pour l'instant" },
  { cle: 'bloque', nom: 'Bloqué', aide: 'CI rouge ou conflit' },
  { cle: 'fini', nom: 'Terminé ou ancien', aide: 'sessions finies, PR bloquées sans suite depuis des jours' },
]

// `rang` orders the states inside a group, sessions and PRs alike.
type Etat = { nom: string; teinte: NomTeinte; rang: number; groupe: Groupe }

const ANCIENNE: Etat = { nom: 'Ancienne', teinte: 'gris', rang: 11, groupe: 'fini' }
const ETATS_SESSION: Record<EtatSession, Etat> = {
  'attend toi': { nom: "T'attend", teinte: 'orange', rang: 0, groupe: 'toi' },
  'à relire': { nom: 'À relire', teinte: 'violet', rang: 1, groupe: 'toi' },
  travaille: { nom: 'Travaille', teinte: 'bleu', rang: 3, groupe: 'cours' },
  fini: { nom: 'Finie', teinte: 'vert', rang: 9, groupe: 'fini' },
  inactif: { nom: 'Inactive', teinte: 'gris', rang: 10, groupe: 'fini' },
}

function etatSession(s: Session): Etat {
  return ETATS_SESSION[s.etat] ?? ETATS_SESSION.inactif
}

const GARDE_KO = ['failure', 'cancelled', 'timed_out', 'error', 'action_required', 'startup_failure']

// A blocked PR nobody has touched for days is an old PR, not today's blocker.
// What waits for the person (a ready PR) or still moves never ages out.
function etatPr(p: Pr): Etat {
  const etat = etatCourantPr(p)
  return p.ancien && etat.groupe === 'bloque' ? ANCIENNE : etat
}

function etatCourantPr(p: Pr): Etat {
  if (p.enMerge) return { nom: 'Merge…', teinte: 'violet', rang: 3, groupe: 'cours' }
  if (p.brouillon) return { nom: 'Brouillon', teinte: 'gris', rang: 5, groupe: 'cours' }
  if (p.conflit) return { nom: 'Conflit', teinte: 'ambre', rang: 7, groupe: 'bloque' }
  if (GARDE_KO.includes(p.garde)) return { nom: 'Garde KO', teinte: 'rouge', rang: 6, groupe: 'bloque' }
  if (p.ci === 'rouge') return { nom: 'CI rouge', teinte: 'rouge', rang: 6, groupe: 'bloque' }
  if (p.ci === 'en cours' || p.garde === 'en cours') return { nom: 'En cours', teinte: 'bleu', rang: 4, groupe: 'cours' }
  // The guard is the one check a team asks for before a merge; where the
  // settings name none, the other checks alone decide.
  const sansGarde = p.garde === 'non demandée'
  if (p.ci === 'vert' && (p.garde === 'ok' || sansGarde)) return { nom: 'Prête', teinte: 'vert', rang: 2, groupe: 'toi' }
  if (p.ci === 'vert') return { nom: 'Garde ?', teinte: 'gris', rang: 8, groupe: 'bloque' }
  // No check at all: where none is asked, nothing holds the PR back.
  if (sansGarde) return { nom: 'Prête', teinte: 'vert', rang: 2, groupe: 'toi' }
  return { nom: 'Sans CI', teinte: 'gris', rang: 8, groupe: 'bloque' }
}

// One row of the board: a session or a PR, with what the columns sort by.
type Ligne =
  | { sorte: 'session'; cle: string; etat: Etat; titre: string; quand: number; s: Session }
  | { sorte: 'pr'; cle: string; etat: Etat; titre: string; quand: number; p: Pr }

function lignes(sessions: readonly Session[], prs: readonly Pr[]): Ligne[] {
  return [
    ...sessions.map(
      (s): Ligne => ({ sorte: 'session', cle: `s-${s.id}`, etat: etatSession(s), titre: s.titre, quand: s.activite ?? 0, s }),
    ),
    ...prs.map((p): Ligne => ({ sorte: 'pr', cle: `pr-${p.numero}`, etat: etatPr(p), titre: p.titre, quand: p.maj, p })),
  ]
}

function alpha(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x < y ? -1 : x > y ? 1 : 0
}

// The order inside each group. By state, the most recent comes first among equals.
function trier(liste: readonly Ligne[], tri: Tri): Ligne[] {
  return [...liste].sort((a, b) => {
    if (tri.cle === 'date') return (a.quand - b.quand) * tri.sens
    if (tri.cle === 'titre') return alpha(a.titre, b.titre) * tri.sens
    return (a.etat.rang - b.etat.rang) * tri.sens || b.quand - a.quand
  })
}

// The header pressed again turns the order round; another one starts at `defaut`.
function basculer(tri: Tri, cle: CleTri, defaut: 1 | -1): Tri {
  return tri.cle === cle ? { cle, sens: tri.sens === 1 ? -1 : 1 } : { cle, sens: defaut }
}

function pluriel(n: number, mot: string): string {
  return `${n} ${mot}${n > 1 ? 's' : ''}`
}

// What waits for the person, in one line: the first row of the pane, the one
// that still shows when another pane leaves it a single row.
function resume(sessions: readonly Session[], prs: readonly Pr[] | null | undefined): string {
  const compte = (nom: string) => sessions.filter(s => etatSession(s).nom === nom).length
  const attend = compte("T'attend")
  const relire = compte('À relire')
  const pretes = (prs ?? []).filter(p => etatPr(p).nom === 'Prête').length
  const parts = [
    attend > 0 ? `${pluriel(attend, 'session')} t'attend${attend > 1 ? 'ent' : ''}` : '',
    relire > 0 ? `${relire} à relire` : '',
    pretes > 0 ? `${pretes} PR prête${pretes > 1 ? 's' : ''}` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : "rien ne t'attend"
}

function couper(texte: string, max: number): string {
  return texte.length <= max ? texte : `${texte.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

function lienSession(id: string): string {
  return `claude://code/continue?session=${encodeURIComponent(id)}&source=desktop_action`
}

function remplir(modele: string, valeurs: Record<string, string | number>): string {
  return modele.replace(/\{(\w+)\}/g, (tout, cle: string) => (cle in valeurs ? String(valeurs[cle]) : tout))
}

function lancerTexte(p: Pile, modele: string): string {
  const ou = p.dossier ? ` (dossier ${p.dossier}${p.commande ? `, commande « ${p.commande} »` : ''})` : ''
  const detail = p.lanceur
    ? ` avec preview_start, entrée « ${p.lanceur} » de ~/.claude/launch.json`
    : ` : ajoute une entrée à ~/.claude/launch.json${ou} puis preview_start`
  return remplir(modele, { nom: p.nom, port: p.port, detail })
}

// What « arrêter » asks of Claude for one stack: stop its processes, nothing more.
function arreterTexte(nom: string, piles: readonly Pile[]): string {
  const ports = piles.filter(p => p.actif).map(p => p.port)
  const noms = piles.filter(p => p.lanceur).map(p => `« ${p.lanceur} »`)
  return `Arrête la pile locale « ${nom} » (port${ports.length > 1 ? 's' : ''} ${ports.join(', ')}) : preview_stop si elle a été lancée par preview_start${noms.length ? ` (entrées ${noms.join(', ')} de ~/.claude/launch.json)` : ''}, sinon arrête le processus qui écoute sur chacun de ces ports. Vérifie ensuite que plus rien n'écoute dessus. Ne supprime rien, ne pousse rien.`
}

function testerTexte(p: Pr, modele: string): string {
  return remplir(modele, { numero: p.numero, titre: p.titre, branche: p.branche ?? '' })
}

function mergerTexte(prs: Pr[], modele: string): string {
  const liste = prs.map(p => `#${p.numero}${p.prod ? ' (vers prod)' : ''}`).join(', ')
  return remplir(modele, { liste, nombre: prs.length })
}

let polling = false
let dernierAffichage = ''
let derniereTrace = 0
let dernierPrs = 0

// Where the person's settings live: under their own home, in the mod's name.
let dossierReglages = ''

async function reglages($: EngineInterface): Promise<{ config: string; affichage: string }> {
  if (!dossierReglages) {
    const home = await $.env.get('HOME').catch(() => undefined)
    // No home folder to name: nothing is read or written, the defaults stand.
    if (!home) return { config: '', affichage: '' }
    dossierReglages = `${home}/.claude/flybuddy-panel`
  }
  return { config: `${dossierReglages}/config.json`, affichage: `${dossierReglages}/affichage.json` }
}

async function lireConfig($: EngineInterface): Promise<Config> {
  const { config } = await reglages($)
  if (!config) return {}
  try {
    return JSON.parse(await $.fs.read(config)) as Config
  } catch {
    // No settings yet: on a first run, lay the starter file. A file that is
    // there but does not parse is the person's, mid-edit: it is left alone.
    const existe = await $.fs.exists(config).catch(() => true)
    if (existe) return {}
    await $.fs.write(config, `${JSON.stringify(REGLAGES_DEPART, null, 2)}\n`).catch(() => undefined)
    return REGLAGES_DEPART as Config
  }
}

// `leger` reads this computer only (sessions, ports, disk): what a session
// that will not show the pane needs. `complet` also asks GitHub and the prod
// health check; `auto` does so once the last answer is old enough.
type Collecte = 'leger' | 'auto' | 'complet'

async function rafraichir($: EngineInterface, mode: Collecte = 'auto'): Promise<{ favori: boolean }> {
  try {
    return await collecter($, mode)
  } catch {
    return { favori: false }
  }
}

async function collecter($: EngineInterface, mode: Collecte): Promise<{ favori: boolean }> {
  const cfg = await lireConfig($)
  const now = await $.clock.now()
  const avecPrs = mode === 'complet' || (mode === 'auto' && now - dernierPrs >= (cfg.prsSecondes ?? 90) * 1000)
  const { config } = await reglages($)
  const argv = ['/usr/bin/python3', `${$.plugin.root}/scripts/collect.py`, config, await $.session.id()]
  if (avecPrs) argv.push('--prs', '--sante')
  const taches = Array.isArray(cfg.taches) && cfg.taches.length ? cfg.taches : TACHES_DEFAUT
  try {
    const run = await $.process.run(argv, { timeoutMs: 90_000 })
    if (run.exitCode !== 0) throw new Error(run.stderr.slice(-200) || `code ${run.exitCode}`)
    const data = JSON.parse(run.stdout) as Snapshot & { moi?: { favori: boolean } }
    if (avecPrs) dernierPrs = now
    await update($, snapshot, (old: Snapshot | null) => ({
      ...data,
      taches,
      consignes: cfg.consignes,
      prs: avecPrs ? data.prs : old?.prs,
      sante: avecPrs ? data.sante : old?.sante,
      orphelines: avecPrs ? data.orphelines : old?.orphelines,
    }))
    return { favori: !!data.moi?.favori }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await update($, snapshot, (old: Snapshot | null) => (old ? { ...old, taches, erreur: msg } : null))
    $.ui.log(`flybuddy-panel: collecte impossible : ${msg}`, { to: 'debug' })
    return { favori: false }
  }
}

async function demarrer($: EngineInterface): Promise<void> {
  if (polling) return
  polling = true
  const cfg = await lireConfig($)
  const s = Math.max(10, cfg.rafraichirSecondes ?? 30)
  $.clock.every(s * 1000, () => {
    void rafraichir($)
  })
}

async function ouvrir($: EngineInterface): Promise<void> {
  const r = await $.ui.open({ id: PANE, title: (await lireConfig($)).titre || TITRE })
  if (!r.isPlaced) $.ui.log(`flybuddy-panel: panneau non placé : ${r.reason}`, { to: 'debug' })
}

// The express summary of a session: the person's own `qct` script, run in a
// login shell so that it finds `claude`, `git` and `gh` as a terminal would.
// It only reads, and what it prints is shown under the session's row.
async function resumer($: EngineInterface, qct: string, s: Session): Promise<void> {
  const poser = (r: Resume) =>
    update($, vue, (v: Vue) => ({ ...VUE_DEFAUT, ...v, resumes: { ...(v.resumes ?? {}), [s.id]: r } }))
  await poser({ etat: 'en cours', texte: '' })
  try {
    const run = await $.process.run(['/bin/zsh', '-lc', 'exec "$0" "$1"', qct, s.cli ?? ''], { timeoutMs: 150_000 })
    const texte = run.stdout.trim()
    if (run.exitCode !== 0 || !texte) throw new Error(run.stderr.trim().slice(-160) || 'aucune réponse')
    await poser({ etat: 'pret', texte: texte.slice(0, 1500) })
  } catch (err) {
    await poser({ etat: 'echec', texte: err instanceof Error ? err.message : String(err) })
  }
}

async function oublierResume($: EngineInterface, id: string): Promise<void> {
  await update($, vue, (v: Vue) => {
    const resumes = { ...(v.resumes ?? {}) }
    delete resumes[id]
    return { ...VUE_DEFAUT, ...v, resumes }
  })
}

// How long a PR stays « Merge… » at most, if GitHub still lists it open.
const DUREE_MERGE = 10 * 60_000

// The state of these PRs on GitHub right now (OPEN, MERGED, CLOSED), read by
// the collector; a PR it could not read is left out of the answer.
async function etatsPr($: EngineInterface, numeros: number[]): Promise<Record<string, string>> {
  try {
    const { config } = await reglages($)
    const run = await $.process.run(
      ['/usr/bin/python3', `${$.plugin.root}/scripts/collect.py`, config, await $.session.id(), '--etat', ...numeros.map(String)],
      { timeoutMs: 30_000 },
    )
    return run.exitCode === 0 ? (JSON.parse(run.stdout) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

// « Merger la sélection »: each ticked PR is checked again on GitHub first,
// those already merged or closed are left out, the rest are asked of Claude,
// shown as « Merge… » and unticked; the PR list is read again on the next
// 30-second cycle rather than after 90 s.
async function merger($: EngineInterface, choix: Pr[], modele: string): Promise<void> {
  const etats = await etatsPr($, choix.map(p => p.numero))
  const faites = choix.filter(p => ['MERGED', 'CLOSED'].includes(etats[String(p.numero)] ?? ''))
  const reste = choix.filter(p => !faites.includes(p))
  const maintenant = await $.clock.now()
  await update($, vue, (x: Vue) => {
    const enMerge = { ...(x.enMerge ?? {}) }
    for (const p of reste) enMerge[p.numero] = maintenant
    return { ...VUE_DEFAUT, ...x, selection: [], enMerge }
  })
  dernierPrs = 0
  const deja = faites.length > 0 ? `déjà mergée${faites.length > 1 ? 's' : ''} ou fermée${faites.length > 1 ? 's' : ''} : ${faites.map(p => `#${p.numero}`).join(', ')}` : ''
  if (reste.length === 0) {
    $.ui.toast(`Rien à merger, ${deja}.`)
    void rafraichir($, 'complet')
    return
  }
  await envoyer($, mergerTexte(reste, modele), `merger ${reste.map(p => `#${p.numero}`).join(', ')}${deja ? ` (${deja})` : ''}`)
}

// The one way a button reaches Claude: it sends the instruction as a prompt.
// Nothing here merges, pushes or starts a server by itself.
async function envoyer($: EngineInterface, texte: string, libelle: string): Promise<void> {
  await update($, vue, (v: Vue) => ({ ...VUE_DEFAUT, ...v, dernierEnvoi: `Envoyé : ${libelle}` }))
  $.ui.toast(`Envoyé à Claude : ${libelle}`)
  void $.prompt.submit({ text: texte })
}

// Column widths, in cells, measured on the desktop app: a cell is 8.85 pt
// wide and 20 pt high, a plain one-glyph Button is three cells wide with its
// padding and the app's own button four.
const C_MARQUE = 3 // the tick box of a PR, or the mark of a session
const C_ETAT = 9 // the longest pill, « Travaille », in small semibold type
const L_ETAT = 9 // on a terminal, a state is padded to this many letters
const C_DATE = 10 // « jj/mm HH:MM »
const C_ACTIONS = 9 // two rounded buttons and the gap between
// What every row spends beside its title: those columns, the gaps between
// them, the row's own margins and the frame.
const C_FIXE = C_MARQUE + C_ETAT + C_DATE + C_ACTIONS + 7
// Letters a cell holds in running text (a cell is 8.85 pt, a letter about
// 6.5 pt). A title is cut to what its column holds, then the surface cuts it
// again at the edge with « … »: were that second cut ever missing, a row
// would overflow by a few points at most, never push its icons out of view.
const LETTRES_PAR_CASE = 1.38
// Under this many cells a row is laid on two lines, the title on its own.
const LARGEUR_TABLEAU = 60

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'flybuddy', description: 'Ouvrir le panneau (sessions, PR, localhost)' })
    void (async () => {
      const cfg = await lireConfig($)
      const { favori } = await rafraichir($, 'leger')
      const mode = cfg.ouvrirAuto ?? 'favorites'
      if (mode === 'toujours' || (mode === 'favorites' && favori)) {
        await ouvrir($)
        await demarrer($)
        void rafraichir($, 'complet')
      }
    })()
    return started
  })

  on('command.run', { command: 'flybuddy' }, async $ => {
    await ouvrir($)
    await demarrer($)
    void rafraichir($, 'complet')
    return { text: 'Panneau ouvert.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)

    // A trace of the real display (width, seat), to tune the layout by. It is
    // written again every twenty seconds or so while the pane is drawn, so its
    // date says whether the pane is on screen.
    const affichage = JSON.stringify({
      surface: e.surface,
      placement: e.props.placement,
      bodyColumns: e.props.bodyColumns,
      bodyRows: e.props.scroll.bodyRows,
      viewport: e.viewport ?? null,
    })
    const chemins = await reglages($)
    const maintenant = await $.clock.now().catch(() => 0)
    if (affichage !== dernierAffichage || maintenant - derniereTrace > 20_000) {
      dernierAffichage = affichage
      derniereTrace = maintenant
      if (chemins.affichage) void $.fs.write(chemins.affichage, affichage).catch(() => undefined)
    }

    const data = await read($, snapshot)
    const v: Vue = { ...VUE_DEFAUT, ...(await read($, vue)) }

    if (!data) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Chargement…</Text>
        </Box>
      )
    }

    const terminal = e.surface === 'terminal'
    const pal = data.sombre === false ? CLAIR : SOMBRE
    const W = Math.max(24, e.props.bodyColumns)
    const large = W >= LARGEUR_TABLEAU
    const survol = terminal ? undefined : { backgroundColor: pal.survol }
    const lettres = (cases: number) => Math.max(8, Math.floor(cases * (terminal ? 1 : LETTRES_PAR_CASE)))
    // A veil behind a word that is a control.
    const fondPuce = terminal ? undefined : pal.puce
    // The mockup's thin rounded line, round a pill, a chip or the table. A
    // terminal draws a border as two more rows, so it gets none.
    const cadre = terminal ? {} : ({ borderStyle: 'round', borderColor: pal.bord } as const)

    // The watched address, where the settings give one (« santeProd »).
    const prod =
      data.sante === null
        ? null
        : data.sante === undefined
          ? { couleur: 'inactive', texte: 'Prod : vérification…' }
          : data.sante.ok
            ? { couleur: 'success', texte: 'Prod en ligne' }
            : { couleur: 'error', texte: `Prod en panne (${data.sante.code || 'sans réponse'})` }
    // A PR whose merge was just asked shows « Merge… » until GitHub lists it
    // no longer, or ten minutes at most.
    const enMerge = v.enMerge ?? {}
    const maintenantVue = await $.clock.now().catch(() => 0)
    const prsVues =
      data.prs == null
        ? data.prs
        : data.prs.map(p => {
            const quand = enMerge[p.numero]
            return quand !== undefined && maintenantVue - quand < DUREE_MERGE ? { ...p, enMerge: true } : p
          })
    const aFaire = resume(data.sessions, prsVues)
    const consignes = { ...CONSIGNES_DEFAUT, ...(data.consignes ?? {}) }
    // The word on an approved PR: the team's own label.
    const motOk = data.labelOk || 'approuvée'
    // What holds a PR in « Bloqué »: where a guard is asked (« garde »), a
    // green PR without it waits there too.
    const aideGroupe = (g: DefGroupe) => (g.cle === 'bloque' && data.avecGarde ? 'CI rouge, conflit ou garde absente' : g.aide)
    // The header's tick box leaves out the PRs bound for production, and says
    // so where the settings name such a branch (« brancheProd »).
    const horsProd = data.avecProd ? ' (hors prod)' : ''

    // The small form of a minimized pane: what reads at a glance, no control.
    // Read as a plain string: an older engine's types know no `widget` seat.
    const siege: string = e.props.placement
    if (siege === 'widget') {
      const enCours = data.sessions.filter(s => s.etat === 'travaille').length
      return (
        <Box flexDirection="column">
          {prod ? (
            <Text>
              <Text color={prod.couleur}>{G.actif}</Text>
              {` ${prod.texte}`}
            </Text>
          ) : null}
          <Text>{aFaire}</Text>
          <Text dimColor>
            {`${enCours} en cours · ${data.prs ? `${data.prs.length} PR ouvertes` : 'PR : en attente de GitHub'}`}
          </Text>
        </Box>
      )
    }

    const resumes = v.resumes ?? {}
    const toutes = trier(lignes(data.sessions, prsVues ?? []), v.tri)
    const duGroupe = (g: Groupe) => toutes.filter(l => l.etat.groupe === g)
    const nbFinies = duGroupe('fini').length
    const ouvertes = new Set((prsVues ?? []).filter(p => !p.enMerge).map(p => p.numero))
    const choisies = v.selection.filter(n => ouvertes.has(n))
    // « À toi » always shows, even empty; what is finished or stale only on request.
    const groupes = GROUPES.filter(g =>
      g.cle === 'toi' ? true : g.cle === 'fini' ? v.toutesSessions && nbFinies > 0 : duGroupe(g.cle).length > 0,
    )

    // A state: the mockup's pill, a word in small semibold type on its tint,
    // in a rounded line of the same tint.
    const pastille = (etat: Etat) => {
      if (terminal) {
        return (
          <Text color={CLE_THEME[etat.teinte]} inverse>
            {`${ESPACE}${etat.nom.padEnd(L_ETAT, ESPACE)}${ESPACE}`}
          </Text>
        )
      }
      const teinte = pal.pastilles[etat.teinte]
      return (
        <Box
          borderStyle="round"
          borderColor={teinte.fond}
          backgroundColor={teinte.fond}
          paddingX="xs"
          paddingY={0}
          flexShrink={0}
        >
          <Text size="caption" weight="semibold" color={teinte.texte}>
            {insecable(etat.nom)}
          </Text>
        </Box>
      )
    }

    // An icon: a glyph for a label (the desktop app draws a Button's `label`
    // even when it has children, so the label is the glyph itself). `bouton`
    // makes it the app's own rounded button, as the mockup's icons; else it is
    // the bare glyph. Its name shows on a card by the pointer where the
    // surface shows hovers. The card is one unbreakable line: its room is the
    // icon's, and a line that could break there would stack its words. It lies
    // over what was drawn before it: the row above, or (`ligne`, for the
    // pane's first row) the same row to the icon's left.
    const icone = (
      cle: string,
      glyphe: string,
      nom: string,
      onPress: () => unknown,
      carte: 'droite' | 'gauche' | 'ligne' = 'droite',
      bouton = false,
    ) => {
      const plein = bouton && !terminal
      return (
        <Box key={`zone-${cle}`} flexShrink={0}>
          <Button key={cle} plain={plein ? undefined : true} label={glyphe} onPress={() => void onPress()} />
          <Box
            position="absolute"
            top={carte === 'ligne' ? 0 : -1}
            left={carte === 'gauche' ? 0 : undefined}
            right={carte === 'gauche' ? undefined : carte === 'ligne' ? (plein ? 5 : 3) : 0}
            display="none"
            hover={{ display: 'flex' }}
          >
            <Text color="inverseText" backgroundColor="text">
              {`${ESPACE}${insecable(nom)}${ESPACE}`}
            </Text>
          </Box>
        </Box>
      )
    }

    // A word that is a control: a plain Button in a thin rounded line, as the
    // mockup's chips and far smaller than the app's own button.
    const puce = (cle: string, libelle: string, onPress: () => unknown, avant?: JSX.Element, apres?: JSX.Element) => (
      <Box
        key={`puce-${cle}`}
        flexDirection="row"
        alignItems="center"
        flexShrink={0}
        paddingX={0}
        paddingY={0}
        backgroundColor={fondPuce}
        {...cadre}
      >
        {avant}
        <Button key={cle} plain label={libelle} onPress={() => void onPress()} />
        {apres}
      </Box>
    )

    // A title takes the room its column has: the surface cuts it at the edge
    // with « … » (a Text told to truncate, in a box that clips). It never
    // wraps onto a second line nor pushes the date away.
    const titreCoupe = (contenu: JSX.Element | string) => (
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <Text wrap="truncate-end">{contenu}</Text>
      </Box>
    )

    // A column header: a press sorts the rows of every group by that column.
    const enTete = (cle: CleTri, nom: string, defaut: 1 | -1) => {
      const actif = v.tri.cle === cle
      return (
        <Button
          key={`tri-${cle}`}
          plain
          dimColor={!actif}
          label={actif ? `${nom}${ESPACE}${v.tri.sens === 1 ? G.monte : G.descend}` : nom}
          onPress={() =>
            void update($, vue, (x: Vue) => ({ ...VUE_DEFAUT, ...x, tri: basculer(x.tri ?? VUE_DEFAUT.tri, cle, defaut) }))
          }
        />
      )
    }

    // The header box ticks the ready PRs in one press, except those bound for
    // prod: a release is only ever ticked by hand, one PR at a time.
    const cocherPretes = () => {
      const pretes = (prsVues ?? []).filter(p => etatPr(p).nom === 'Prête' && !p.prod).map(p => p.numero)
      if (choisies.length === 0 && pretes.length === 0) {
        $.ui.toast(`Aucune PR prête à cocher${horsProd}.`)
        return undefined
      }
      return update($, vue, (x: Vue) => {
        const dejaCochees = (x.selection ?? []).some(n => ouvertes.has(n))
        return { ...VUE_DEFAUT, ...x, selection: dejaCochees ? [] : pretes }
      })
    }

    // What differs between a PR and a session: the mark, the title, the icons.
    const partsPr = (p: Pr) => {
      const estCochee = choisies.includes(p.numero)
      const numero = (
        <Text dimColor tabular>
          {`#${p.numero}`}
        </Text>
      )
      // Only when there is a mark: an empty Box still costs a gap on each side.
      const marques =
        p.prod || p.ownerOk ? (
          <Box flexDirection="row" gap={1} flexShrink={0}>
            {p.prod ? (
              <Text size="footnote" color="warning">
                prod
              </Text>
            ) : null}
            {p.ownerOk ? (
              <Text size="footnote" color="success">
                {motOk}
              </Text>
            ) : null}
          </Box>
        ) : null
      // Cells the number and the marks take before the title, gaps included.
      const place = 7 + (p.prod ? 5 : 0) + (p.ownerOk ? motOk.length : 0)
      const lien = <Link href={p.url}>{couper(p.titre, lettres(W - C_FIXE - place))}</Link>
      return {
        marque: p.enMerge ? (
          <Text dimColor>…</Text>
        ) : icone(
          `coche-${p.numero}`,
          estCochee ? G.coche : G.vide,
          estCochee ? `Décocher la PR #${p.numero}` : `Cocher la PR #${p.numero} pour le merge`,
          () =>
            update($, vue, (x: Vue) => {
              const sel = x.selection ?? []
              return {
                ...VUE_DEFAUT,
                ...x,
                selection: sel.includes(p.numero) ? sel.filter(n => n !== p.numero) : [...sel, p.numero],
              }
            }),
          'gauche',
        ),
        titre: (
          <Box flexGrow={1} flexShrink={1} flexDirection="row" alignItems="center" gap={1} overflow="hidden">
            {numero}
            {marques}
            {titreCoupe(lien)}
          </Box>
        ),
        titreSeul: titreCoupe(<Link href={p.url}>{couper(p.titre, lettres(W - C_MARQUE - 4))}</Link>),
        sousTitre: (
          <Box flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
            {numero}
            {marques}
          </Box>
        ),
        detail: '',
        date: p.date,
        resume: undefined as Resume | undefined,
        actions: [
          icone(
            `local-${p.numero}`,
            G.tester,
            'Tester en local',
            () => envoyer($, testerTexte(p, consignes.tester), `tester la PR #${p.numero} en local`),
            'droite',
            true,
          ),
          icone(`gh-${p.numero}`, G.ouvrir, 'Ouvrir sur GitHub', () => $.process.run(['/usr/bin/open', p.url]), 'droite', true),
        ],
      }
    }

    const partsSession = (s: Session) => ({
      marque: <Text dimColor>{G.session}</Text>,
      titre: titreCoupe(couper(s.titre, lettres(W - C_FIXE))),
      titreSeul: titreCoupe(couper(s.titre, lettres(W - C_MARQUE - 4))),
      sousTitre: null,
      detail: s.etat === 'attend toi' ? s.detail : '',
      date: s.date,
      resume: resumes[s.id],
      actions: [
        // Where a PR has « tester », a session has its express summary.
        ...(data.qct && s.cli
          ? [
              icone(
                `qct-${s.id}`,
                G.resume,
                'Résumé express (qct)',
                () => {
                  const r = resumes[s.id]
                  if (r?.etat === 'en cours') return undefined
                  return r ? oublierResume($, s.id) : resumer($, data.qct ?? '', s)
                },
                'droite',
                true,
              ),
            ]
          : []),
        icone(
          `s-${s.id}`,
          G.ouvrir,
          'Ouvrir la session',
          () => $.process.run(['/usr/bin/open', lienSession(s.id)]),
          'droite',
          true,
        ),
      ],
    })

    const ligne = (l: Ligne) => {
      const parts = l.sorte === 'pr' ? partsPr(l.p) : partsSession(l.s)
      const date = (
        <Text dimColor tabular>
          {parts.date || '—'}
        </Text>
      )
      // What the session asks, under its title: plain size, so it reads.
      const demande = (retrait: number) =>
        parts.detail ? (
          <Box paddingLeft={retrait} overflow="hidden">
            <Text dimColor wrap="truncate-end">
              {`${G.suite} ${couper(parts.detail, lettres(W - retrait - 5))}`}
            </Text>
          </Box>
        ) : null
      // The express summary, under the row: the script's own lines, whole.
      const resume = (retrait: number) => {
        const r = parts.resume
        if (!r) return null
        if (r.etat === 'en cours') {
          return (
            <Box paddingLeft={retrait}>
              <Text dimColor>Résumé en cours…</Text>
            </Box>
          )
        }
        if (r.etat === 'echec') {
          return (
            <Box paddingLeft={retrait} overflow="hidden">
              <Text color="warning" wrap="truncate-end">{`Résumé impossible : ${r.texte}`}</Text>
            </Box>
          )
        }
        return (
          <Box flexDirection="column" paddingLeft={retrait}>
            {r.texte
              .split('\n')
              .filter(Boolean)
              .map(l => (
                <Text>{l}</Text>
              ))}
          </Box>
        )
      }
      if (!large) {
        return (
          <Box key={`ligne-${l.cle}`} flexDirection="column" paddingX={1} hover={survol}>
            <Box flexDirection="row" alignItems="center" gap={1}>
              {parts.marque}
              {parts.titreSeul}
            </Box>
            <Box flexDirection="row" alignItems="center" gap={1} paddingLeft={C_MARQUE + 1}>
              {pastille(l.etat)}
              {parts.sousTitre}
              {date}
              <Box flexGrow={1} />
              {parts.actions}
            </Box>
            {demande(C_MARQUE + 1)}
            {resume(C_MARQUE + 1)}
          </Box>
        )
      }
      return (
        <Box key={`ligne-${l.cle}`} flexDirection="column" paddingX={1} hover={survol}>
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Box width={C_MARQUE} flexShrink={0} justifyContent="center">
              {parts.marque}
            </Box>
            <Box width={C_ETAT} flexShrink={0} alignItems="center">
              {pastille(l.etat)}
            </Box>
            {parts.titre}
            <Box width={C_DATE} flexShrink={0}>
              {date}
            </Box>
            <Box width={C_ACTIONS} flexShrink={0} flexDirection="row" justifyContent="flex-end" gap="xs">
              {parts.actions}
            </Box>
          </Box>
          {demande(C_MARQUE + C_ETAT + 2)}
          {resume(C_MARQUE + C_ETAT + 2)}
        </Box>
      )
    }

    // A group: its name in capitals on a band, then its rows with air between
    // and around them.
    const groupe = (g: DefGroupe) => {
      const rangs = duGroupe(g.cle)
      return (
        <Box key={`groupe-${g.cle}`} flexDirection="column">
          <Box
            flexDirection="row"
            alignItems="center"
            gap={1}
            paddingX={1}
            backgroundColor={terminal ? undefined : pal.bande}
          >
            <Text weight="bold">{g.nom.toUpperCase()}</Text>
            <Text dimColor>{rangs.length > 0 ? `${rangs.length} · ${aideGroupe(g)}` : "rien ne t'attend"}</Text>
          </Box>
          {rangs.length > 0 ? (
            <Box flexDirection="column" rowGap="xs" paddingY="xs">
              {rangs.map(ligne)}
            </Box>
          ) : null}
        </Box>
      )
    }

    // Localhost: one chip per stack (its web, API, Redis… ports together), the
    // running ones only; the stopped ones fold behind « + N arrêtées ».
    type GroupePiles = { nom: string; piles: Pile[]; actif: boolean; gardee: boolean }
    const groupesPiles: GroupePiles[] = []
    for (const p of data.piles) {
      const nom = p.groupe || p.nom
      let g = groupesPiles.find(x => x.nom === nom)
      if (!g) groupesPiles.push((g = { nom, piles: [], actif: false, gardee: false }))
      g.piles.push(p)
      g.actif ||= p.actif
      g.gardee ||= p.epinglee
    }
    const principale = (g: GroupePiles) => {
      const vivantes = g.piles.filter(p => p.actif === g.actif)
      return vivantes.find(p => p.role === 'web') ?? vivantes[0] ?? g.piles[0]!
    }
    const orphelines = data.orphelines ?? []
    const pileVivante = (g: GroupePiles) => {
      const p = principale(g)
      const autres = g.piles.filter(x => x.actif && x !== p)
      const orpheline = g.piles.some(x => orphelines.includes(x.port))
      return (
        <Box key={`groupe-pile-${g.nom}`} flexDirection="row" alignItems="center" flexShrink={0}>
          {puce(
            `ouvrir-${p.port}`,
            `${g.nom} ${p.port} ${G.ouvrir}`,
            () => $.process.run(['/usr/bin/open', p.url]),
            <Text color="success">{`${ESPACE}${G.actif}`}</Text>,
            autres.length > 0 || orpheline ? (
              <Text size="footnote" dimColor={!orpheline} color={orpheline ? 'warning' : undefined}>
                {`${autres.map(x => `${x.role || x.nom}${ESPACE}${x.port}`).join(' · ')}${orpheline ? `${autres.length ? ' · ' : ''}orpheline` : ''}${ESPACE}`}
              </Text>
            ) : undefined,
          )}
          {/* Every running stack can be stopped; a kept one (« piles ») stays
              listed under the stopped ones, ready to start again. */}
          <Button
            key={`arreter-${p.port}`}
            plain
            label={`${G.stop}${ESPACE}arrêter`}
            onPress={() => void envoyer($, arreterTexte(g.nom, g.piles), `arrêter ${g.nom}`)}
          />
        </Box>
      )
    }
    const pileArretee = (g: GroupePiles) => {
      const p = principale(g)
      return puce(
        `lancer-${p.port}`,
        `${g.nom} ${p.port} ${G.tester}`,
        () => envoyer($, lancerTexte(p, consignes.lancer), `lancer ${g.nom}`),
        <Text color="inactive">{`${ESPACE}${G.arrete}`}</Text>,
      )
    }
    const vivantes = groupesPiles.filter(g => g.actif)
    const arretees = groupesPiles.filter(g => !g.actif)


    // A bench to try what the surface draws (sizes, gaps, borders, cuts),
    // shown under the pane's first row while the settings file says
    // `"essai": true` and its `essaiJusqua` time has not passed.
    const rien = () => undefined
    const long = 'Un texte bien trop long pour sa case, qui doit être coupé proprement au bord'
    const essai = data.essai ? (
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>Essai d'affichage (temporaire, aucun effet)</Text>
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text size="caption">caption</Text>
          <Text size="footnote">footnote</Text>
          <Text size="body">body</Text>
          <Text size="heading">heading</Text>
          <Text size="title">title</Text>
          <Text weight="regular">regular</Text>
          <Text weight="medium">medium</Text>
          <Text weight="semibold">semibold</Text>
          <Text weight="bold">bold</Text>
        </Box>
        <Box flexDirection="row" alignItems="center" gap={2}>
          <Box flexDirection="row" gap="xs">
            <Text backgroundColor={pal.puce}>xs</Text>
            <Text backgroundColor={pal.puce}>xs</Text>
          </Box>
          <Box flexDirection="row" gap="sm">
            <Text backgroundColor={pal.puce}>sm</Text>
            <Text backgroundColor={pal.puce}>sm</Text>
          </Box>
          <Box flexDirection="row" gap="md">
            <Text backgroundColor={pal.puce}>md</Text>
            <Text backgroundColor={pal.puce}>md</Text>
          </Box>
          <Box flexDirection="row" gap={1}>
            <Text backgroundColor={pal.puce}>1c</Text>
            <Text backgroundColor={pal.puce}>1c</Text>
          </Box>
          <Box borderStyle="round" borderColor="inactive">
            <Text>round</Text>
          </Box>
          <Box borderStyle="round" borderColor="inactive" paddingX={0} paddingY={0}>
            <Text>round 0</Text>
          </Box>
          <Box borderStyle="single" borderColor="inactive" paddingX="xs" paddingY={0}>
            <Text>single xs</Text>
          </Box>
        </Box>
        <Box flexDirection="row" alignItems="center" gap={2}>
          <Box width={24}>
            <Text wrap="truncate-end">{long}</Text>
          </Box>
          <Box width={24} overflow="hidden">
            <Text wrap="truncate-end">
              <Link href="https://example.com">{long}</Link>
            </Text>
          </Box>
          <Button key="essai-natif" label={G.tester} onPress={rien} />
          <Button key="essai-plain" plain label={G.tester} onPress={rien} />
          <Text inverse>{`${ESPACE}inverse${ESPACE}`}</Text>
        </Box>
      </Box>
    ) : null

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Box flexGrow={1} flexShrink={1} overflow="hidden">
            <Text wrap="truncate-end">
              {prod ? <Text color={prod.couleur}>{G.actif}</Text> : null}
              {prod ? ` ${prod.texte} · ${aFaire}` : aFaire}
            </Text>
          </Box>
          <Text dimColor tabular>
            {`maj ${data.heure.slice(0, 5)}`}
          </Text>
          {icone('maj', G.actualiser, 'Actualiser', () => rafraichir($, 'complet'), 'ligne', true)}
        </Box>
        {data.erreur ? <Text color="warning">Dernière collecte en échec : valeurs précédentes affichées.</Text> : null}
        {data.configErreur ? <Text color="warning">{data.configErreur}</Text> : null}
        {essai}

        <Box flexDirection="column" marginTop={1} paddingX={0} paddingY={0} {...cadre}>
          <Box flexDirection="row" alignItems="center" gap={1} paddingX={1}>
            <Box width={large ? C_MARQUE : undefined} flexShrink={0} justifyContent="center">
              {icone(
                'coche-pretes',
                choisies.length > 0 ? G.coche : G.vide,
                choisies.length > 0 ? 'Tout décocher' : `Cocher les PR prêtes${horsProd}`,
                cocherPretes,
                'gauche',
              )}
            </Box>
            {large ? (
              <Box width={C_ETAT} flexShrink={0}>
                {enTete('etat', 'ÉTAT', 1)}
              </Box>
            ) : null}
            <Box flexGrow={1} flexShrink={1}>{enTete('titre', 'SESSION OU PR', 1)}</Box>
            {large ? null : enTete('etat', 'ÉTAT', 1)}
            <Box width={large ? C_DATE : undefined} flexShrink={0}>
              {enTete('date', 'DATE', -1)}
            </Box>
            {large ? <Box width={C_ACTIONS} flexShrink={0} /> : null}
          </Box>
          {data.prs === null ? (
            <Box paddingX={1}>
              <Text color="warning">GitHub ne répond pas : les PR manquent.</Text>
            </Box>
          ) : null}
          {data.sansRepo ? (
            <Box paddingX={1}>
              <Text dimColor>{`PR : indique ton dépôt GitHub dans les réglages (« repo »), avec ${G.modifier}.`}</Text>
            </Box>
          ) : null}
          {data.prs === undefined ? (
            <Box paddingX={1}>
              <Text dimColor>PR : chargement…</Text>
            </Box>
          ) : null}
          {groupes.map(groupe)}
          {toutes.length === 0 ? (
            <Box paddingX={1}>
              <Text dimColor>Aucune session active, aucune PR ouverte.</Text>
            </Box>
          ) : null}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          {choisies.length > 0 && data.prs ? (
            <Box flexDirection="row" alignItems="center" gap={1}>
              <Text dimColor>{choisies.length > 1 ? `${choisies.length} PR cochées` : '1 PR cochée'}</Text>
              <Button
                key="merger"
                variant="primary"
                label={`Merger la sélection (${choisies.length})`}
                onPress={async () => {
                  const choix = (data.prs ?? []).filter(p => choisies.includes(p.numero)).sort((a, b) => a.numero - b.numero)
                  await merger($, choix, consignes.merger)
                }}
              />
              <Button
                key="decocher"
                dimColor
                label="Tout décocher"
                onPress={() => void update($, vue, (x: Vue) => ({ ...VUE_DEFAUT, ...x, selection: [] }))}
              />
            </Box>
          ) : null}
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1}>
            <Text dimColor size="footnote">
              {`${G.tester} tester en local · ${G.ouvrir} ouvrir${data.qct ? ` · ${G.resume} résumé express` : ''} · ${G.vide} cocher pour merger · ${G.session} session`}
            </Text>
            {nbFinies > 0 ? (
              <Button
                key="toutes"
                plain
                dimColor
                label={
                  v.toutesSessions
                    ? 'Masquer les terminées et anciennes'
                    : nbFinies > 1
                      ? `Voir les ${nbFinies} terminées ou anciennes`
                      : 'Voir 1 terminée ou ancienne'
                }
                onPress={() => void update($, vue, (x: Vue) => ({ ...VUE_DEFAUT, ...x, toutesSessions: !x.toutesSessions }))}
              />
            ) : null}
          </Box>
        </Box>

        <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1} rowGap="xs" marginTop={1}>
          <Text weight="semibold" dimColor>
            TÂCHES
          </Text>
          {icone(
            'config',
            G.modifier,
            'Modifier la liste des tâches et des piles',
            () => (chemins.config ? $.process.run(['/usr/bin/open', '-t', chemins.config]) : $.ui.toast('Réglages introuvables.')),
            'gauche',
          )}
          {data.taches.map((t, i) => puce(`tache-${i}`, t.court || t.libelle, () => envoyer($, t.texte, t.libelle)))}
        </Box>
        {v.dernierEnvoi ? (
          <Text dimColor size="footnote">
            {v.dernierEnvoi}
          </Text>
        ) : null}

        <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1} rowGap="xs" marginTop={1}>
          <Text weight="semibold" dimColor>
            LOCALHOST
          </Text>
          {vivantes.map(pileVivante)}
          {vivantes.length === 0 ? <Text dimColor>rien ne tourne</Text> : null}
          {arretees.length > 0 ? (
            <Button
              key="arretees"
              plain
              dimColor
              label={v.pilesArretees ? 'masquer les arrêtées' : `+ ${pluriel(arretees.length, 'arrêtée')}`}
              onPress={() => void update($, vue, (x: Vue) => ({ ...VUE_DEFAUT, ...x, pilesArretees: !x.pilesArretees }))}
            />
          ) : null}
          {v.pilesArretees ? arretees.map(pileArretee) : null}
        </Box>

        <Box marginTop={1}>
          <Text dimColor size="footnote">
            {`Disque : ${data.systeme.disque || '?'}${data.systeme.worktrees == null ? '' : ` · ${pluriel(data.systeme.worktrees, 'worktree')}`}`}
          </Text>
        </Box>
      </Box>
    )
  })
}
