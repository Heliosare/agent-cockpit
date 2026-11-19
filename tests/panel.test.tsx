import { expect, mock, test } from 'claude-code/testing'

const GH = 'https://github.com/exemple/projet/pull/'

// The test runner has timers; the mod's own environment declares none.
declare const setTimeout: (fn: () => void, ms: number) => unknown

function pr(numero: number, maj: number, date: string, plus: Record<string, unknown> = {}) {
  return {
    numero,
    titre: `Titre de la PR ${numero}`,
    url: `${GH}${numero}`,
    garde: 'ok',
    ci: 'vert',
    brouillon: false,
    ownerOk: false,
    base: 'dev',
    prod: false,
    branche: `agents/pr-${numero}`,
    maj,
    date,
    conflit: false,
    ancien: false,
    ...plus,
  }
}

function session(id: string, titre: string, etat: string, activite: number, date: string, plus: Record<string, unknown> = {}) {
  // `cli` : l'identifiant Claude de la session, « local_a » -> « cli-a ».
  return { id, cli: id.replace('local_', 'cli-'), titre, etat, detail: '', minutes: etat === 'fini' ? 3000 : 3, favori: false, activite, date, ...plus }
}

const SNAP = {
  sessions: [
    session('local_a', 'Bug prod', 'attend toi', 100, '12/11 21:19', { detail: 'réponds à la question' }),
    session('local_b', 'Release', 'travaille', 300, '17/11 15:37'),
    session('local_c', 'Vieux', 'fini', 50, '16/11 09:00'),
    session('local_d', 'Autres agents', 'à relire', 200, '17/11 15:33', { detail: 'résumé' }),
  ],
  moi: { favori: true },
  piles: [
    { nom: 'Web', lanceur: 'web-dev', port: 3000, url: 'http://localhost:3000', actif: false, epinglee: true },
    { nom: 'Docs', lanceur: null, port: 4000, url: 'http://localhost:4000', actif: true, epinglee: true },
  ],
  autresPiles: 4,
  systeme: { disque: '38 Go libres (92 %)', worktrees: 9 },
  configErreur: null,
  heure: '15:37:12',
  sombre: true,
  essai: false,
  qct: '/chemin/qct',
  sansRepo: false,
  labelOk: 'ok-equipe',
  avecGarde: true,
  avecProd: true,
  prs: [
    pr(614, 300, '17/11 15:34'),
    pr(605, 200, '17/11 15:12', { ci: 'rouge', base: 'prod', prod: true, ownerOk: true }),
    pr(429, 400, '17/11 15:50', { conflit: true }),
    pr(407, 100, '11/11 00:14', { ci: 'rouge', garde: 'failure', base: 'prod', prod: true, conflit: true }),
    pr(501, 250, '17/11 15:20', { ci: 'en cours' }),
    pr(500, 150, '15/11 10:00', { brouillon: true }),
  ],
  sante: { ok: true, code: 200 },
}

const CONFIG = JSON.stringify({
  ouvrirAuto: 'favorites',
  taches: [
    { court: 'Next', libelle: "What's next", texte: 'whats next' },
    { libelle: 'Nettoyer agents + worktrees', texte: 'clean agent et worktree' },
  ],
})

function pane(plus: Record<string, unknown> = {}, surface: 'desktop' | 'terminal' = 'desktop') {
  return {
    plugin: 'agent-cockpit',
    component: 'Pane',
    requestId: 'cockpit',
    surface,
    props: {
      title: 'Tableau de bord',
      isFocused: false,
      bodyColumns: 68,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
      ...plus,
    },
  } as const
}

const RESUME = [
  '📌 Bug prod : une question attend ta réponse.',
  '⚠️ Ne la ferme pas encore : Claude attend ton choix.',
  '❓ Laquelle des deux options ?',
  '🕐 Dernier message de Claude : 17/11 à 15:30 (il y a moins d\'1 h)',
  '🗂 Aucun dépôt git dans cette session',
].join('\n')

// What GitHub answers when the panel checks PRs just before a merge.
let etatsGitHub: Record<string, string> = {}

// Nothing sits beneath the plugin: each hook here stands for the engine.
async function lancer(
  $: any,
  on: any,
  snap: unknown = SNAP,
  qct: { exitCode: number; stdout: string; stderr: string } = { exitCode: 0, stdout: RESUME, stderr: '' },
  // What the settings file holds; `null` : there is no such file yet.
  config: string | null = CONFIG,
) {
  etatsGitHub = {}
  const ran: string[][] = []
  const sent: string[] = []
  const toasts: string[] = []
  const ecrits: { path: string; text: string }[] = []
  const titres: string[] = []
  const envois: { to: unknown; text: string }[] = []
  let opened = 0
  // The person's home: the settings live under it, wherever it is.
  mock.env(on, { HOME: '/Users/moi' })
  // A clock that moves only when the test moves it: the 30-second refresh
  // never fires by itself.
  const clock = mock.clock(on, { now: 1_000_000 })
  on('command.register', () => ({ value: { command: 'cockpit' } }))
  on('ui.open', (_: unknown, e: { title: string }) => {
    opened += 1
    titres.push(e.title)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  // The settings file, as a disk keeps it: what is written is what is read next.
  let fichier = config
  on('fs.read', (_: unknown, e: { path: string }) => {
    // Only the settings file exists at first; the others are what the pane wrote.
    if (!e.path.endsWith('/config.json')) {
      const ecrit = [...ecrits].reverse().find(x => x.path === e.path)
      if (!ecrit) throw new Error('ENOENT')
      return { value: ecrit.text }
    }
    if (fichier === null) throw new Error('ENOENT')
    return { value: fichier }
  })
  on('fs.exists', () => ({ value: fichier !== null }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    ecrits.push({ path: e.path, text: e.text })
    if (e.path.endsWith('/config.json')) fichier = e.text
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'cli-1' }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    ran.push([...e.argv])
    const isCollect = e.argv[1]?.endsWith('collect.py')
    if (isCollect && e.argv.includes('--garde-detail')) {
      const detail = { etat: 'pret', fichiers: [{ fichier: 'decision-du-30-10', changements: 8 }] }
      return { value: { exitCode: 0, stdout: JSON.stringify(detail), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (isCollect && e.argv.includes('--etat')) {
      return { value: { exitCode: 0, stdout: JSON.stringify(etatsGitHub), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    // The person's `qct` script, run through a login shell.
    if (e.argv[0] === '/bin/zsh') return { value: { ...qct, isStdoutTruncated: false, isStderrTruncated: false } }
    return {
      value: {
        exitCode: 0,
        stdout: isCollect ? JSON.stringify(snap) : '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('session.send', (_: unknown, e: { to: unknown; text: string }) => {
    envois.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
  on('prompt.submit', (_: unknown, e: { text: string }) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/Users/moi', surface: 'desktop', isInteractive: true })
  // A favourite session: the pane opens by itself after a first, local collect,
  // then a second one asks GitHub.
  const complet = () => ran.some(argv => argv.includes('--prs'))
  for (let i = 0; i < 60 && !(opened > 0 && complet()); i++) await new Promise<void>(r => setTimeout(() => r(), 5))
  // One more beat: the answer of that collect has to reach the state.
  await new Promise<void>(r => setTimeout(() => r(), 20))
  await clock.settle()
  return { ran, sent, toasts, ecrits, titres, envois, clock, opened: () => opened }
}

// The rows of the board, in the order drawn: a session by its title, a PR by its number.
// (A title's spaces are unbreakable ones: they are put back before comparing.)
const rangs = async (ui: any) =>
  (await ui.findAll({ type: 'Text', text: /^(#\d+|Bug\sprod|Release|Autres\sagents|Vieux|Sans\ssuite)$/ })).map(
    (x: { text: string }) => x.text.replace(/\s/g, ' '),
  )

// The pill of a state: the Text that holds exactly that word (its spaces are
// unbreakable ones, which `\\s` matches).
const pastille = async (ui: any, nom: string) =>
  ui.find({ type: 'Text', text: new RegExp(`^\\s*${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s')}\\s*$`) })

// The rounded tinted box a state's word sits in.
const pilule = async (ui: any, fond: string) =>
  (await ui.findAll({ type: 'Box' })).some(
    (b: { props: { backgroundColor?: string; borderStyle?: string } }) =>
      b.props.backgroundColor === fond && b.props.borderStyle === 'round',
  )

test('triage par priorité : trois groupes, sessions et PR mélangées, tri par en-tête', async ($, on) => {
  const { ran, opened, titres } = await lancer($, on)
  expect(opened()).toBe(1)
  // Sans « titre » dans les réglages, le panneau porte un nom neutre.
  expect(titres).toEqual(['Tableau de bord'])
  // Au démarrage : d'abord une collecte locale (sans GitHub), puis la complète.
  expect(ran[0]).not.toContain('--prs')
  expect(ran.some(argv => argv.includes('--prs') && argv.includes('--sante'))).toBe(true)

  const ui = await $.ui.mount(pane())

  // Les trois groupes, en capitales, avec leur compte ; le quatrième reste caché.
  expect(await ui.find({ type: 'Text', text: 'À TOI' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '3 · ta réponse, ta relecture, ta vérification ou ton merge' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'EN COURS' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: "3 · rien à faire pour l'instant" })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'BLOQUÉ' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '3 · CI rouge, conflit ou garde absente' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'TERMINÉ OU ANCIEN' })).toBeUndefined()

  // Une PR vers la branche de production le dit sur sa ligne.
  expect(await ui.find({ type: 'Text', text: /^vers\sprod$/ })).toBeTruthy()
  // La colonne date et heure, pour les sessions comme pour les PR.
  for (const date of ['12/11 21:19', '17/11 15:37', '17/11 15:34', '11/11 00:14']) {
    expect(await ui.find({ type: 'Text', text: date })).toBeTruthy()
  }
  // L'état dans une pastille, un mot par ligne.
  for (const nom of ["T'attend", 'À relire', 'Travaille', 'Prête', 'CI rouge', 'Conflit', 'En cours', 'Brouillon']) {
    expect(await pastille(ui, nom)).toBeTruthy()
  }
  // La première ligne dit ce qui t'attend : elle reste lisible quand le panneau n'a qu'une ligne.
  expect(await ui.find({ type: 'Text', text: /Prod en ligne · 1 session t'attend · 1 à relire · 1 PR prête/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Disque : 38 Go libres \(92 %\) · 9 worktrees/ })).toBeTruthy()
  // Le label d'approbation de l'équipe, tel que les réglages le nomment.
  expect(await ui.find({ type: 'Text', text: 'ok-equipe' })).toBeTruthy()
  // Ce que la session demande, sous son titre, à taille normale.
  const demande = await ui.find({ type: 'Text', text: /réponds\sà\sla\squestion/ })
  expect(demande?.props.size).toBeUndefined()

  // Un titre prend toute la place de sa colonne : l'app le coupe au bord avec « … »,
  // il ne passe jamais à la ligne. Celui d'une PR reste un lien.
  const titre = await ui.find({ type: 'Text', text: /^Autres\sagents$/ })
  expect(titre?.props.wrap).toBe('truncate-end')
  const titrePr = await ui.find({ type: 'Text', text: 'Titre de la PR 614' })
  expect(titrePr?.props.wrap).toBe('truncate-end')
  expect((await ui.find({ type: 'Link', text: 'Titre de la PR 614' }))?.props.href).toBe(`${GH}614`)
  // Le tableau est encadré d'un filet arrondi, comme sur la maquette.
  const cadres = (await ui.findAll({ type: 'Box' })).filter(
    (b: { props: { borderStyle?: string; borderColor?: string } }) =>
      b.props.borderStyle === 'round' && b.props.borderColor === 'rgba(255, 255, 255, 0.2)',
  )
  expect(cadres.length).toBeGreaterThan(1)
  // ▶ et ↗ sont de vrais boutons arrondis ; la case à cocher reste un simple caractère.
  expect((await ui.find({ key: 'local-614' }))?.props.plain).toBeUndefined()
  expect((await ui.find({ key: 'gh-614' }))?.props.plain).toBeUndefined()
  expect((await ui.find({ key: 's-local_a' }))?.props.plain).toBeUndefined()
  expect((await ui.find({ key: 'coche-614' }))?.props.plain).toBe(true)

  // Par défaut, dans chaque groupe : par état, le plus récent d'abord à état égal.
  expect(await rangs(ui)).toEqual(['Bug prod', 'Autres agents', '#614', 'Release', '#501', '#500', '#605', '#429', '#407'])

  // Un clic sur « Date » : le plus récent d'abord dans chaque groupe ; un second l'inverse.
  await ui.press({ key: 'tri-date' })
  expect(await rangs(ui)).toEqual(['#614', 'Autres agents', 'Bug prod', 'Release', '#501', '#500', '#429', '#605', '#407'])
  await ui.press({ key: 'tri-date' })
  expect(await rangs(ui)).toEqual(['Bug prod', 'Autres agents', '#614', '#500', '#501', 'Release', '#407', '#605', '#429'])
  // Par titre.
  await ui.press({ key: 'tri-titre' })
  expect(await rangs(ui)).toEqual(['Autres agents', 'Bug prod', '#614', 'Release', '#500', '#501', '#407', '#429', '#605'])
  // Retour au tri par état, puis à l'envers.
  await ui.press({ key: 'tri-etat' })
  expect(await rangs(ui)).toEqual(['Bug prod', 'Autres agents', '#614', 'Release', '#501', '#500', '#605', '#429', '#407'])
  await ui.press({ key: 'tri-etat' })
  expect(await rangs(ui)).toEqual(['#614', 'Autres agents', 'Bug prod', '#500', '#501', 'Release', '#429', '#407', '#605'])
  await ui.press({ key: 'tri-etat' })

  // Les sessions finies : un quatrième groupe, à la demande, par un bouton placé
  // sous le tableau et non dans la ligne d'en-tête.
  const cles = (await ui.findAll({ type: 'Button' })).map((b: { key?: string }) => b.key ?? '')
  const place = cles.indexOf('toutes')
  for (const [i, cle] of cles.entries()) {
    if (/^(tri-|coche-|local-|gh-|s-)/.test(cle)) expect(i).toBeLessThan(place)
  }
  expect((await ui.find({ key: 'toutes' }))?.text).toBe('Voir 1 terminée ou ancienne')
  await ui.press({ key: 'toutes' })
  expect(await ui.find({ type: 'Text', text: 'TERMINÉ OU ANCIEN' })).toBeTruthy()
  expect((await rangs(ui)).at(-1)).toBe('Vieux')
  expect(await pastille(ui, 'Finie')).toBeTruthy()
  expect((await ui.find({ key: 'toutes' }))?.text).toBe('Masquer les terminées et anciennes')
  // On replie aussi depuis la bande du groupe, sans descendre sous la liste.
  await ui.press({ key: 'replier-fini' })
  expect(await ui.find({ type: 'Text', text: 'TERMINÉ OU ANCIEN' })).toBeUndefined()
  expect((await ui.find({ key: 'toutes' }))?.text).toBe('Voir 1 terminée ou ancienne')
  await ui.unmount()
})

test('pastilles lisibles : les couleurs de la maquette, en sombre comme en clair, sans police à chasse fixe', async ($, on) => {
  await lancer($, on)
  const sombre = await $.ui.mount(pane())
  // Le mot, dans la couleur claire de la maquette…
  const prete = await pastille(sombre, 'Prête')
  expect(prete?.props).toMatchObject({ color: '#7FD8A0', weight: 'semibold' })
  expect(prete?.props.mono).toBeUndefined()
  expect((await pastille(sombre, "T'attend"))?.props).toMatchObject({ color: '#FFB27A' })
  expect((await pastille(sombre, 'CI rouge'))?.props).toMatchObject({ color: '#FF9B8F' })
  expect((await pastille(sombre, 'Travaille'))?.props).toMatchObject({ color: '#8FBCFF' })
  // … sur sa teinte foncée, dans un filet arrondi de la même teinte.
  for (const fond of ['#1E3A2A', '#4A2E18', '#4A211D', '#1D3050']) expect(await pilule(sombre, fond)).toBe(true)
  await sombre.unmount()
})

test('pastilles en thème clair', async ($, on) => {
  await lancer($, on, { ...SNAP, sombre: false })
  const clair = await $.ui.mount(pane())
  expect((await pastille(clair, 'Prête'))?.props).toMatchObject({ color: '#1B6B3C' })
  expect((await pastille(clair, 'Conflit'))?.props).toMatchObject({ color: '#7A5200' })
  for (const fond of ['#DDF3E4', '#FBEBC8']) expect(await pilule(clair, fond)).toBe(true)
  await clair.unmount()
})

test('une vieille PR bloquée est rangée à part ; ce qui t\'attend ne vieillit jamais', async ($, on) => {
  const snap = {
    ...SNAP,
    // Une demande vieille de plusieurs jours t'attend toujours.
    sessions: [...SNAP.sessions, session('local_e', 'Sans suite', 'attend toi', 10, '09/11 08:00', { detail: 'vieille question' })],
    prs: [
      ...SNAP.prs,
      pr(300, 20, '08/11 10:00', { ancien: true }), // verte et prête, même vieille : à toi
      pr(301, 30, '08/11 11:00', { ancien: true, conflit: true }), // vieille et en conflit : rangée
      pr(302, 40, '08/11 12:00', { ancien: true, ci: 'rouge' }), // vieille et rouge : rangée
      pr(303, 45, '08/11 13:00', { ancien: true, brouillon: true }), // vieux brouillon : toujours en cours
    ],
  }
  await lancer($, on, snap)
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ type: 'Text', text: /2 sessions t'attendent · 1 à relire · 2 PR prêtes/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '5 · ta réponse, ta relecture, ta vérification ou ton merge' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: "4 · rien à faire pour l'instant" })).toBeTruthy()
  // « Bloqué » ne garde que les blocages récents.
  expect(await ui.find({ type: 'Text', text: '3 · CI rouge, conflit ou garde absente' })).toBeTruthy()
  const avant = await rangs(ui)
  expect(avant).toContain('Sans suite')
  expect(avant).toContain('#300')
  expect(avant).toContain('#303')
  expect(avant).not.toContain('#301')
  expect(avant).not.toContain('#302')
  expect(await ui.find({ type: 'Text', text: /vieille\squestion/ })).toBeTruthy()
  // La case de l'en-tête coche les deux PR prêtes, la vieille comprise.
  await ui.press({ key: 'coche-pretes' })
  expect((await ui.find({ key: 'merger' }))?.props.label).toBe('Merger la sélection (2)')
  // Les vieilles PR bloquées sont rangées avec les sessions finies, visibles à la demande.
  expect((await ui.find({ key: 'toutes' }))?.text).toBe('Voir les 3 terminées ou anciennes')
  await ui.press({ key: 'toutes' })
  expect((await rangs(ui)).slice(-3).sort()).toEqual(['#301', '#302', 'Vieux'])
  expect(await pastille(ui, 'Ancienne')).toBeTruthy()
  await ui.unmount()
})

test("les icônes sont des caractères, leurs noms tiennent sur une ligne au survol", async ($, on) => {
  await lancer($, on)
  const ui = await $.ui.mount(pane())
  // L'app de bureau dessine le `label` d'un bouton : il doit être l'icône elle-même.
  const label = async (key: string) => (await ui.find({ key }))?.props.label
  expect(await label('local-614')).toBe('▶︎')
  expect(await label('gh-614')).toBe('↗︎')
  expect(await label('s-local_a')).toBe('↗︎')
  expect(await label('coche-614')).toBe('☐')
  expect(await label('coche-pretes')).toBe('☐')
  expect(await label('maj')).toBe('↻')
  expect(await label('tri-etat')).toBe('ÉTAT ▲')
  expect(await label('tri-date')).toBe('DATE')
  expect(await label('tri-titre')).toBe('SESSION OU PR')
  await ui.press({ key: 'coche-614' })
  expect(await label('coche-614')).toBe('☑︎')
  expect(await label('coche-pretes')).toBe('☑︎')
  await ui.press({ key: 'tri-date' })
  expect(await label('tri-date')).toBe('DATE ▼')
  expect(await label('tri-etat')).toBe('ÉTAT')
  // Aucun bouton n'affiche une phrase : les noms complets vivent dans les cartes de survol.
  for (const b of await ui.findAll({ type: 'Button' })) {
    expect(String(b.props.label)).not.toMatch(/^(Cocher|Décocher|Trier|Ouvrir|Tester|Actualiser|Modifier)/)
  }
  // Une carte de survol ne peut pas se couper : elle n'a que la largeur de l'icône
  // pour se poser, et chaque mot passerait à la ligne.
  const cartes = (await ui.findAll({ type: 'Text' })).filter((t: { props: { color?: string } }) => t.props.color === 'inverseText')
  expect(cartes.length).toBeGreaterThan(10)
  for (const carte of cartes) expect(carte.text).not.toMatch(/ /)
  expect(cartes.map((c: { text: string }) => c.text.replace(/ /g, ' ').trim())).toEqual(
    expect.arrayContaining(['Tester en local', 'Ouvrir sur GitHub', 'Ouvrir la session', 'Cocher la PR #605 pour le merge', 'Actualiser']),
  )
  await ui.unmount()
})

test('chaque icône envoie la bonne consigne, et rien ne part tout seul', async ($, on) => {
  const { ran, sent } = await lancer($, on)
  const ui = await $.ui.mount(pane())

  // Tester en local : une demande à Claude, pour cette PR.
  await ui.press({ key: 'local-605' })
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatch(
    /PR #605[\s\S]*agents\/pr-605[\s\S]*navigateur intégré[\s\S]*données fictives[\s\S]*Ne pousse rien, ne merge rien/,
  )
  // Ouvrir : la PR dans le navigateur, la session dans l'app.
  await ui.press({ key: 'gh-605' })
  expect(ran).toContainEqual(['/usr/bin/open', `${GH}605`])
  await ui.press({ key: 's-local_a' })
  expect(ran).toContainEqual(['/usr/bin/open', 'claude://code/continue?session=local_a&source=desktop_action'])
  expect(sent).toHaveLength(1)

  // Tâches : le texte court sur le bouton, la consigne entière envoyée.
  expect((await ui.find({ key: 'tache-0' }))?.text).toBe('Next')
  expect((await ui.find({ key: 'tache-1' }))?.text).toBe('Nettoyer agents + worktrees')
  // Des boutons compacts, pas les grosses pastilles de l'app.
  expect((await ui.find({ key: 'tache-0' }))?.props.plain).toBe(true)
  expect((await ui.find({ key: 'ouvrir-4000' }))?.props.plain).toBe(true)
  await ui.press({ key: 'tache-0' })
  await ui.press({ key: 'tache-1' })
  expect(sent.slice(1)).toEqual(['whats next', 'clean agent et worktree'])

  // Localhost : ouvrir une pile qui tourne, demander à Claude de lancer l'autre.
  expect((await ui.find({ key: 'ouvrir-4000' }))?.props.label).toBe('Docs 4000 ↗︎')
  // Les piles arrêtées sont repliées : on les déplie pour lancer celle-ci.
  expect(await ui.find({ key: 'lancer-3000' })).toBeUndefined()
  await ui.press({ key: 'arretees' })
  expect((await ui.find({ key: 'lancer-3000' }))?.props.label).toBe('Web 3000 ▶︎')
  await ui.press({ key: 'ouvrir-4000' })
  expect(ran).toContainEqual(['/usr/bin/open', 'http://localhost:4000'])
  await ui.press({ key: 'lancer-3000' })
  expect(sent.at(-1)).toMatch(/pile locale « Web » \(port 3000\).*preview_start.*« web-dev ».*Ne pousse rien/)

  // Actualiser relance la collecte complète ; le crayon ouvre le fichier de réglages.
  const avant = ran.length
  await ui.press({ key: 'maj' })
  expect(ran.length).toBeGreaterThan(avant)
  expect(ran.filter(a => a[0] === '/usr/bin/python3').at(-1)).toContain('--prs')
  await ui.press({ key: 'config' })
  expect(ran).toContainEqual(['/usr/bin/open', '-t', '/Users/moi/.claude/agent-cockpit/config.json'])

  // Le panneau ne lance que la collecte et « open » : ni git, ni gh, ni serveur.
  for (const argv of ran) expect(['/usr/bin/python3', '/usr/bin/open', '/bin/zsh']).toContain(argv[0])
  await ui.unmount()
})

test('résumé express : préparé d\'avance pour « À toi », le clic ne fait qu\'afficher', async ($, on) => {
  const { ran, sent } = await lancer($, on)
  // Dès la collecte, qct a tourné pour les sessions qui t'attendent (a : t'attend, d : à relire), pas pour les autres.
  const qct = () => ran.filter(argv => argv[0] === '/bin/zsh')
  // Et pour les sessions finies (c) : d'abord celles qui t'attendent, les plus récentes en tête.
  expect(qct().map(a => a.at(-1))).toEqual(['cli-d', 'cli-a', 'cli-c'])
  expect(qct()[0]?.slice(0, 4)).toEqual(['/bin/zsh', '-lc', 'exec "$0" "$1"', '/chemin/qct'])
  const ui = await $.ui.mount(pane())
  expect((await ui.find({ key: 'qct-local_a' }))?.props.label).toBe('≡')
  expect(await ui.find({ key: 'qct-pr-614' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Ne la ferme pas encore/ })).toBeUndefined()
  // Le clic affiche, sans relancer qct.
  await ui.press({ key: 'qct-local_a' })
  expect(await ui.find({ type: 'Text', text: '📌 Bug prod : une question attend ta réponse.' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '🗂 Aucun dépôt git dans cette session' })).toBeTruthy()
  expect(qct()).toHaveLength(3)
  expect(sent).toEqual([])
  // Trier le garde, un second appui le replie.
  await ui.press({ key: 'tri-date' })
  expect(await ui.find({ type: 'Text', text: /Ne la ferme pas encore/ })).toBeTruthy()
  await ui.press({ key: 'qct-local_a' })
  expect(await ui.find({ type: 'Text', text: /Ne la ferme pas encore/ })).toBeUndefined()
  // Une session qui travaille : le clic le demande, à ce moment-là.
  await ui.press({ key: 'qct-local_b' })
  expect(qct().at(-1)?.at(-1)).toBe('cli-b')
  expect(qct()).toHaveLength(4)
  await ui.unmount()
})

test('résumé express : un échec se dit', async ($, on) => {
  await lancer($, on, SNAP, { exitCode: 1, stdout: '', stderr: 'session introuvable' })
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'qct-local_d' })
  expect(await ui.find({ type: 'Text', text: 'Résumé impossible : session introuvable' })).toBeTruthy()
  await ui.unmount()
})

test("résumé express : sans qct installé, pas de bouton", async ($, on) => {
  await lancer($, on, { ...SNAP, qct: null })
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ key: 'qct-local_a' })).toBeUndefined()
  expect(await ui.find({ key: 's-local_a' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /résumé express/ })).toBeUndefined()
  await ui.unmount()
})

test('merge en deux temps : cocher ne fait rien, le bouton envoie la demande', async ($, on) => {
  const { ran, sent } = await lancer($, on)
  const ui = await $.ui.mount(pane())
  const libelle = async () => (await ui.find({ key: 'merger' }))?.props.label

  expect(await ui.find({ key: 'merger' })).toBeUndefined()
  await ui.press({ key: 'coche-614' })
  expect(await libelle()).toBe('Merger la sélection (1)')
  expect(sent).toEqual([])

  // Trier et actualiser gardent la sélection.
  await ui.press({ key: 'tri-date' })
  await ui.press({ key: 'maj' })
  expect(await libelle()).toBe('Merger la sélection (1)')

  await ui.press({ key: 'coche-429' })
  expect(await libelle()).toBe('Merger la sélection (2)')
  await ui.press({ key: 'coche-429' })
  await ui.press({ key: 'coche-605' })
  expect(sent).toEqual([])
  await ui.press({ key: 'merger' })
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatch(/dans cet ordre : #605 \(vers prod\), #614\./)
  expect(sent[0]).toMatch(/ces 2 PR seulement[\s\S]*contrôles sont verts[\s\S]*une ligne par PR/)
  // Aucun trou du modèle ne reste vide.
  expect(sent[0]).not.toMatch(/\{\w+\}/)
  expect(await ui.find({ key: 'merger' })).toBeUndefined()

  // La seule PR prête vient d'être envoyée au merge : la case de l'en-tête n'a plus rien à cocher.
  await ui.press({ key: 'coche-pretes' })
  expect(await ui.find({ key: 'merger' })).toBeUndefined()
  await ui.press({ key: 'coche-407' })
  await ui.press({ key: 'decocher' })
  expect(await ui.find({ key: 'merger' })).toBeUndefined()
  expect(sent).toHaveLength(1)
  for (const argv of ran) expect(['/usr/bin/python3', '/usr/bin/open', '/bin/zsh']).toContain(argv[0])
  await ui.unmount()
})

test("la case de l'en-tête ne coche jamais une PR vers prod", async ($, on) => {
  // Une release prête : verte, garde ok, mais vers prod.
  const snap = { ...SNAP, prs: [...SNAP.prs, pr(700, 50, '10/11 09:00', { base: 'prod', prod: true })] }
  const { sent } = await lancer($, on, snap)
  const ui = await $.ui.mount(pane())
  const label = async (key: string) => (await ui.find({ key }))?.props.label

  expect(await ui.find({ type: 'Text', text: '4 · ta réponse, ta relecture, ta vérification ou ton merge' })).toBeTruthy()
  // La carte de survol de cette case le dit, puisqu'il y a une branche de production.
  const cartes = (await ui.findAll({ type: 'Text' })).filter((t: { props: { color?: string } }) => t.props.color === 'inverseText')
  expect(cartes.map((c: { text: string }) => c.text.replace(/\s/g, ' ').trim())).toContain('Cocher les PR prêtes (hors prod)')
  await ui.press({ key: 'coche-pretes' })
  expect(await label('coche-614')).toBe('☑︎')
  expect(await label('coche-700')).toBe('☐')
  expect(await label('merger')).toBe('Merger la sélection (1)')

  // À la main, une par une, elle se coche ; la consigne la signale « vers prod ».
  await ui.press({ key: 'coche-700' })
  expect(await label('merger')).toBe('Merger la sélection (2)')
  expect(sent).toEqual([])
  await ui.press({ key: 'merger' })
  expect(sent[0]).toMatch(/dans cet ordre : #614, #700 \(vers prod\)\./)
  await ui.unmount()
})

test('panneau étroit et terminal : mêmes groupes, mêmes commandes', async ($, on) => {
  const { sent } = await lancer($, on)

  const etroit = await $.ui.mount(pane({ bodyColumns: 44 }))
  expect(await etroit.find({ type: 'Text', text: '17/11 15:34' })).toBeTruthy()
  expect(await etroit.find({ type: 'Text', text: 'À TOI' })).toBeTruthy()
  expect(await rangs(etroit)).toEqual(['Bug prod', 'Autres agents', '#614', 'Release', '#501', '#500', '#605', '#429', '#407'])
  for (const key of ['tri-etat', 'tri-titre', 'tri-date', 'coche-pretes', 'coche-614', 'gh-614', 's-local_a']) {
    expect(await etroit.find({ key })).toBeTruthy()
  }
  await etroit.press({ key: 'local-614' })
  expect(sent.at(-1)).toMatch(/PR #614/)
  await etroit.unmount()

  const terminal = await $.ui.mount(pane({ bodyColumns: 110 }, 'terminal'))
  expect(await terminal.find({ type: 'Text', text: /Conflit/ })).toBeTruthy()
  expect(await terminal.find({ type: 'Text', text: 'BLOQUÉ' })).toBeTruthy()
  expect(await terminal.find({ key: 'local-429' })).toBeTruthy()
  // Au terminal, l'état suit le thème du terminal, en vidéo inverse ; ni cadre
  // (il prendrait deux lignes de plus) ni bouton encadré.
  expect((await terminal.find({ type: 'Text', text: /^\s*Prête\s*$/ }))?.props).toMatchObject({ color: 'success', inverse: true })
  const encadres = (await terminal.findAll({ type: 'Box' })).filter((b: { props: { borderStyle?: string } }) => b.props.borderStyle)
  expect(encadres).toHaveLength(0)
  expect((await terminal.find({ key: 'local-429' }))?.props.plain).toBe(true)
  await terminal.unmount()
})

test('se rafraîchit tout seul : cet ordinateur toutes les 30 s, GitHub toutes les 90 s', async ($, on) => {
  const { ran: tout, clock } = await lancer($, on)
  const ran = { get length() { return tout.filter(a => a[0] === '/usr/bin/python3').length }, at: (i: number) => tout.filter(a => a[0] === '/usr/bin/python3').at(i) }
  const depart = ran.length
  await clock.advance(30_000)
  expect(ran.length).toBe(depart + 1)
  expect(ran.at(-1)).not.toContain('--prs')
  await clock.advance(30_000)
  expect(ran.length).toBe(depart + 2)
  expect(ran.at(-1)).not.toContain('--prs')
  await clock.advance(30_000)
  expect(ran.length).toBe(depart + 3)
  expect(ran.at(-1)).toContain('--prs')
  expect(ran.at(-1)).toContain('--sante')
  for (const argv of tout) expect(['/usr/bin/python3', '/bin/zsh']).toContain(argv[0])
})

test('réduit en vignette : un résumé, aucun bouton', async ($, on) => {
  await lancer($, on)
  const ui = await $.ui.mount(pane({ placement: 'widget', anchoredEdges: ['bottom', 'right'] }))
  expect(await ui.find({ type: 'Text', text: "1 session t'attend · 1 à relire · 1 PR prête" })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /1 en cours · 6 PR ouvertes/ })).toBeTruthy()
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})

test('rien à trier : « À toi » le dit, les autres groupes disparaissent', async ($, on) => {
  const { toasts } = await lancer($, on, { ...SNAP, sessions: [], prs: [], piles: [], autresPiles: 0, sante: { ok: false, code: 503 } })
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ type: 'Text', text: 'À TOI' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: "rien ne t'attend" })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'EN COURS' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'BLOQUÉ' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Aucune session active, aucune PR ouverte.' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Prod en panne \(503\) · rien ne t'attend/ })).toBeTruthy()
  expect(await ui.find({ key: 'merger' })).toBeUndefined()
  expect(await ui.find({ key: 'toutes' })).toBeUndefined()
  // La case de l'en-tête le dit quand il n'y a rien à cocher.
  await ui.press({ key: 'coche-pretes' })
  // Une branche de production est réglée : la case le rappelle, même sans PR vers elle.
  expect(toasts).toContain('Aucune PR prête à cocher (hors prod).')
  await ui.unmount()
})

test('GitHub ne répond pas : les sessions restent triées', async ($, on) => {
  await lancer($, on, { ...SNAP, prs: null })
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ type: 'Text', text: 'GitHub ne répond pas : les PR manquent.' })).toBeTruthy()
  expect(await ui.find({ key: 'coche-614' })).toBeUndefined()
  expect(await rangs(ui)).toEqual(['Bug prod', 'Autres agents', 'Release'])
  expect(await ui.find({ type: 'Text', text: 'BLOQUÉ' })).toBeUndefined()
  await ui.unmount()
})

test("banc d'essai : seulement quand le réglage le demande, et il se dessine partout", async ($, on) => {
  await lancer($, on, { ...SNAP, essai: true })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount(pane({}, surface))
    expect(await ui.find({ type: 'Text', text: /Essai d'affichage/ })).toBeTruthy()
    expect(await ui.find({ key: 'essai-natif' })).toBeTruthy()
    // Le tableau est toujours là, au-dessus.
    expect(await ui.find({ type: 'Text', text: 'À TOI' })).toBeTruthy()
    await ui.unmount()
  }
})

test("sans le réglage, pas de banc d'essai", async ($, on) => {
  await lancer($, on)
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ type: 'Text', text: /Essai d'affichage/ })).toBeUndefined()
  await ui.unmount()
})

test("ce qu'une version précédente a gardé est écarté", async ($, on) => {
  // What the code before this edit wrote stays through the reload.
  on('state.get', () => ({
    value: { value: { sessions: [{ id: 'x', titre: 'Ancien', etat: 'fini' }], triSessions: { cle: 'date', sens: 1 } }, version: 1 },
  }))
  on('fs.write', () => ({ value: undefined }))
  mock.env(on, { HOME: '/Users/moi' })
  const ui = await $.ui.mount(pane())
  expect((await ui.find({ type: 'Text' }))?.text).toBe('Chargement…')
  await ui.unmount()
})

test('/cockpit ouvre le panneau', async ($, on) => {
  let opened = 0
  on('ui.open', () => {
    opened += 1
    return { value: { isPlaced: true } }
  })
  on('fs.read', () => ({ value: '{}' }))
  on('session.id', () => ({ value: 'cli-1' }))
  mock.env(on, { HOME: '/Users/moi' })
  mock.clock(on)
  on('process.run', () => ({
    value: { exitCode: 0, stdout: JSON.stringify(SNAP), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  const r = await $.command.run({
    command: 'cockpit',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  expect(opened).toBe(1)
  expect(r).toMatchObject({ text: 'Panneau ouvert.' })
})

// ---- Ce que chacun règle chez soi : rien n'est écrit en dur dans le mod.

const CONFIG_JSON = '/Users/moi/.claude/agent-cockpit/config.json'

test('premier lancement : le fichier de réglages est posé une fois, sans rien de personnel', async ($, on) => {
  const snap = { ...SNAP, sansRepo: true, prs: [], sante: null, labelOk: '' }
  const { ecrits, ran } = await lancer($, on, snap, undefined, null)
  const poses = ecrits.filter(e => e.path === CONFIG_JSON)
  expect(poses).toHaveLength(1)
  const texte = poses[0]?.text ?? ''
  const reglages = JSON.parse(texte)
  // Ni dépôt, ni adresse, ni dossier : c'est à la personne de les donner.
  expect(reglages).toMatchObject({ repo: '', depot: '', santeProd: '', garde: '', labelOk: '', brancheProd: '', fuseau: '', piles: [] })
  expect(reglages.taches.length).toBeGreaterThan(0)
  expect(texte).not.toMatch(/github\.com|https?:\/\/|\/Users\//)
  // La collecte lit ce même fichier, sous le dossier personnel de la personne.
  expect(ran.find(argv => argv[1]?.endsWith('collect.py'))?.[2]).toBe(CONFIG_JSON)

  const ui = await $.ui.mount(pane())
  expect((await ui.find({ key: 'tache-0' }))?.text).toBe("What's next")
  expect((await ui.find({ key: 'tache-1' }))?.text).toBe('Nettoyer')
  await ui.unmount()
})

test("un fichier de réglages illisible n'est jamais écrasé", async ($, on) => {
  const { ecrits } = await lancer($, on, SNAP, undefined, '{ "taches": [')
  expect(ecrits.filter(e => e.path === CONFIG_JSON)).toEqual([])
  // Le panneau marche quand même, avec les tâches de départ.
  const ui = await $.ui.mount(pane())
  expect((await ui.find({ key: 'tache-0' }))?.text).toBe("What's next")
  await ui.unmount()
})

test('sans dépôt ni adresse réglés : le panneau le dit et ne montre pas de ligne vide', async ($, on) => {
  const snap = {
    ...SNAP,
    sansRepo: true,
    prs: [],
    sante: null,
    labelOk: '',
    systeme: { disque: '38 Go libres (92 %)', worktrees: null },
  }
  await lancer($, on, snap)
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ type: 'Text', text: /indique ton dépôt GitHub dans les réglages \(« repo »\)/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /garde absente/ })).toBeUndefined()
  // Pas d'adresse à surveiller : la première ligne ne parle pas de « Prod ».
  expect(await ui.find({ type: 'Text', text: /Prod/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: "1 session t'attend · 1 à relire" })).toBeTruthy()
  // Pas de dépôt local : le disque seul.
  expect(await ui.find({ type: 'Text', text: 'Disque : 38 Go libres (92 %)' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /worktree/ })).toBeUndefined()
  expect(await rangs(ui)).toEqual(['Bug prod', 'Autres agents', 'Release'])
  await ui.unmount()

  // Réduit en vignette : pas de ligne « Prod » non plus.
  const vignette = await $.ui.mount(pane({ placement: 'widget', anchoredEdges: ['bottom', 'right'] }))
  expect(await vignette.find({ type: 'Text', text: /Prod/ })).toBeUndefined()
  expect(await vignette.find({ type: 'Text', text: "1 session t'attend · 1 à relire" })).toBeTruthy()
  await vignette.unmount()
})

test('sans contrôle exigé (« garde » non réglé), les autres contrôles décident seuls', async ($, on) => {
  const snap = {
    ...SNAP,
    prs: [
      pr(10, 300, '17/11 15:34', { garde: 'non demandée' }), // verte : prête
      pr(11, 200, '17/11 15:12', { garde: 'non demandée', ci: 'aucune' }), // aucun contrôle : rien ne la retient
      pr(12, 100, '17/11 15:00', { garde: 'non demandée', ci: 'rouge' }), // rouge : bloquée
      pr(13, 90, '17/11 14:00', { garde: 'non demandée', ci: 'en cours' }), // encore en cours
      pr(14, 80, '17/11 13:00', { garde: 'absente' }), // garde exigée, pas encore passée
      pr(15, 70, '17/11 12:00', { garde: 'absente', ci: 'aucune' }), // garde exigée, aucun contrôle
    ],
  }
  await lancer($, on, snap)
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ type: 'Text', text: /2 PR prêtes/ })).toBeTruthy()
  for (const nom of ['Prête', 'CI rouge', 'En cours', 'Garde ?', 'Sans CI']) expect(await pastille(ui, nom)).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '3 · CI rouge, conflit ou garde absente' })).toBeTruthy()
  await ui.press({ key: 'coche-pretes' })
  const label = async (key: string) => (await ui.find({ key }))?.props.label
  expect(await label('merger')).toBe('Merger la sélection (2)')
  expect(await label('coche-10')).toBe('☑︎')
  expect(await label('coche-11')).toBe('☑︎')
  expect(await label('coche-12')).toBe('☐')
  expect(await label('coche-14')).toBe('☐')
  await ui.unmount()
})

test('sans garde réglée, « Bloqué » ne parle pas de garde', async ($, on) => {
  const snap = {
    ...SNAP,
    avecGarde: false,
    prs: [pr(12, 100, '17/11 15:00', { garde: 'non demandée', ci: 'rouge' }), pr(16, 90, '17/11 14:00', { garde: 'non demandée', conflit: true })],
  }
  await lancer($, on, snap)
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ type: 'Text', text: '2 · CI rouge ou conflit' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /garde/ })).toBeUndefined()
  // La case de l'en-tête parle toujours de prod : la branche de production reste réglée.
  const cartes = async () =>
    (await ui.findAll({ type: 'Text' }))
      .filter((t: { props: { color?: string } }) => t.props.color === 'inverseText')
      .map((c: { text: string }) => c.text.replace(/\s/g, ' ').trim())
  expect(await cartes()).toContain('Cocher les PR prêtes (hors prod)')
  await ui.unmount()
})

test('sans branche de production réglée, rien ne parle de prod', async ($, on) => {
  // Les mêmes PR, mais aucune n'est marquée : toutes se cochent d'un coup.
  const prs = SNAP.prs.map(p => ({ ...p, prod: false }))
  const { toasts } = await lancer($, on, { ...SNAP, avecProd: false, prs: [...prs, pr(700, 50, '10/11 09:00', { base: 'main' })] })
  const ui = await $.ui.mount(pane())
  const cartes = (await ui.findAll({ type: 'Text' }))
    .filter((t: { props: { color?: string } }) => t.props.color === 'inverseText')
    .map((c: { text: string }) => c.text.replace(/\s/g, ' ').trim())
  expect(cartes).toContain('Cocher les PR prêtes')
  expect(cartes).not.toContain('Cocher les PR prêtes (hors prod)')
  expect(await ui.find({ type: 'Text', text: /^vers\sprod$/ })).toBeUndefined()
  await ui.press({ key: 'coche-pretes' })
  expect((await ui.find({ key: 'merger' }))?.props.label).toBe('Merger la sélection (2)')
  expect(toasts).toEqual([])
  await ui.unmount()
})

test('les réglages réécrivent le titre et les consignes ; celles qui manquent gardent leur texte', async ($, on) => {
  const config = JSON.stringify({
    titre: 'Mon projet',
    taches: [{ libelle: 'Une tâche', texte: 'fais la tâche' }],
    consignes: {
      tester: 'Teste la PR {numero} ({titre}) sur {branche}, à ma façon.',
      merger: 'Merge {liste} : {nombre} PR, avec la garde maison.',
    },
  })
  const { sent, titres, ran } = await lancer($, on, SNAP, undefined, config)
  expect(titres).toEqual(['Mon projet'])
  const ui = await $.ui.mount(pane())

  await ui.press({ key: 'local-614' })
  expect(sent.at(-1)).toBe('Teste la PR 614 (Titre de la PR 614) sur agents/pr-614, à ma façon.')
  await ui.press({ key: 'coche-614' })
  await ui.press({ key: 'coche-605' })
  expect(sent).toHaveLength(1)
  await ui.press({ key: 'merger' })
  expect(sent.at(-1)).toBe('Merge #605 (vers prod), #614 : 2 PR, avec la garde maison.')
  // « lancer » n'est pas réécrite : son texte de départ, avec et sans lanceur.
  await ui.press({ key: 'arretees' })
  await ui.press({ key: 'lancer-3000' })
  expect(sent.at(-1)).toBe(
    'Lance la pile locale « Web » (port 3000) avec preview_start, entrée « web-dev » de ~/.claude/launch.json. Ne pousse rien.',
  )
  // Réécrites ou non, les consignes ne font que partir vers Claude.
  for (const argv of ran) expect(['/usr/bin/python3', '/usr/bin/open', '/bin/zsh']).toContain(argv[0])
  await ui.unmount()
})

test('une pile sans lanceur : la consigne dit où et comment la démarrer', async ($, on) => {
  const snap = {
    ...SNAP,
    piles: [
      { nom: 'Site', lanceur: null, port: 5000, url: 'http://localhost:5000', actif: false, epinglee: true, dossier: '/chemin/site', commande: 'npm run dev' },
      { nom: 'Nue', lanceur: null, port: 5001, url: 'http://localhost:5001', actif: false, epinglee: true },
    ],
  }
  const { sent } = await lancer($, on, snap)
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'arretees' })
  await ui.press({ key: 'lancer-5000' })
  expect(sent.at(-1)).toBe(
    'Lance la pile locale « Site » (port 5000) : ajoute une entrée à ~/.claude/launch.json (dossier /chemin/site, commande « npm run dev ») puis preview_start. Ne pousse rien.',
  )
  await ui.press({ key: 'lancer-5001' })
  expect(sent.at(-1)).toBe('Lance la pile locale « Nue » (port 5001) : ajoute une entrée à ~/.claude/launch.json puis preview_start. Ne pousse rien.')
  await ui.unmount()
})

test("quand toutes les PR prêtes vont vers prod, la case de l'en-tête dit pourquoi elle ne coche rien", async ($, on) => {
  const { toasts } = await lancer($, on, { ...SNAP, prs: [pr(700, 50, '10/11 09:00', { base: 'prod', prod: true })] })
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'coche-pretes' })
  expect(toasts).toContain('Aucune PR prête à cocher (hors prod).')
  expect(await ui.find({ key: 'merger' })).toBeUndefined()
  await ui.unmount()
})

test("sans dossier personnel lisible, le panneau n'écrit nulle part et garde ses réglages de départ", async ($, on) => {
  const ecrits: string[] = []
  const lus: string[] = []
  mock.env(on, {})
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('fs.read', (_: unknown, e: { path: string }) => {
    lus.push(e.path)
    throw new Error('ENOENT')
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', (_: unknown, e: { path: string }) => {
    ecrits.push(e.path)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'cli-1' }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: JSON.stringify(SNAP), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  await $.command.run({
    command: 'cockpit',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  await new Promise<void>(r => setTimeout(() => r(), 20))
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ type: 'Text', text: 'À TOI' })).toBeTruthy()
  expect((await ui.find({ key: 'tache-0' }))?.text).toBe("What's next")
  expect(ecrits).toEqual([])
  expect(lus).toEqual([])
  await ui.unmount()
})

test("localhost : une pile qui tourne pour une PR mergée porte la marque « orpheline »", async ($, on) => {
  await lancer($, on, { ...SNAP, orphelines: [4000] })
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ type: 'Text', text: /^orpheline/ })).toBeTruthy()
  expect((await ui.find({ key: 'ouvrir-4000' }))?.props.label).toBe('Docs 4000 ↗\ufe0e')
  await ui.unmount()
})

test('localhost : sans pile orpheline, pas de marque', async ($, on) => {
  await lancer($, on, { ...SNAP, orphelines: [] })
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ type: 'Text', text: /^orpheline/ })).toBeUndefined()
  await ui.unmount()
})

test('« Nettoyer » par défaut : serveurs, worktrees, bases de test, launch.json, disque avant et après', async ($, on) => {
  const { sent } = await lancer($, on, SNAP, undefined, '{}')
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'tache-1' })
  expect(sent.at(-1)).toMatch(/arrête ses serveurs locaux[\s\S]*supprime le worktree[\s\S]*bases Postgres de test[\s\S]*\*_dev[\s\S]*launch\.json[\s\S]*avant et après[\s\S]*Ne pousse rien/)
  await ui.unmount()
})

test('après « Merger la sélection » : les PR passent en « Merge… », décochées, et GitHub est relu au cycle suivant', async ($, on) => {
  const { sent, ran, clock } = await lancer($, on)
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'coche-614' })
  await ui.press({ key: 'merger' })
  expect(sent).toHaveLength(1)
  // L'état est relu sur GitHub juste avant, pour ces PR-là.
  expect(ran.find(a => a.includes('--etat'))?.slice(-1)).toEqual(['614'])
  expect(await pastille(ui, 'Merge…')).toBeTruthy()
  // Plus de case : elle ne peut pas être cochée une seconde fois.
  expect(await ui.find({ key: 'coche-614' })).toBeUndefined()
  expect(await ui.find({ key: 'merger' })).toBeUndefined()
  // La case de l'en-tête ne la recoche pas non plus.
  await ui.press({ key: 'coche-pretes' })
  expect(await ui.find({ key: 'merger' })).toBeUndefined()
  // Le cycle suivant, 30 s plus tard, relit GitHub sans attendre 90 s.
  const avant = ran.length
  await clock.advance(30_000)
  expect(ran.slice(avant).some(a => a.includes('--prs'))).toBe(true)
  await ui.unmount()
})

test('une PR déjà mergée sur GitHub est retirée de la demande', async ($, on) => {
  const { sent, toasts } = await lancer($, on)
  etatsGitHub = { '614': 'MERGED' }
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'coche-614' })
  await ui.press({ key: 'coche-429' })
  await ui.press({ key: 'merger' })
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatch(/dans cet ordre : #429\./)
  expect(sent[0]).not.toMatch(/#614/)
  // Seule celle-là ne l'est pas : elle est la seule envoyée.
  expect(toasts.at(-1)).toMatch(/merger #429 \(déjà mergée ou fermée : #614\)/)
  await ui.unmount()
})

test('toutes déjà mergées : rien n\'est envoyé à Claude', async ($, on) => {
  const { sent, toasts } = await lancer($, on)
  etatsGitHub = { '614': 'MERGED', '429': 'CLOSED' }
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'coche-614' })
  await ui.press({ key: 'coche-429' })
  await ui.press({ key: 'merger' })
  expect(sent).toEqual([])
  expect(toasts.at(-1)).toBe('Rien à merger, déjà mergées ou fermées : #429, #614.')
  expect(await ui.find({ key: 'merger' })).toBeUndefined()
  await ui.unmount()
})

test('localhost : une pastille par pile qui tourne, les ports secondaires en détail, « arrêter » sauf pour les piles gardées', async ($, on) => {
  const piles = [
    { nom: 'Web dev', lanceur: 'web-dev', port: 3000, url: 'http://localhost:3000', actif: true, epinglee: true, groupe: 'Dev', role: 'web' },
    { nom: 'API dev', lanceur: 'api-dev', port: 3001, url: 'http://localhost:3001', actif: true, epinglee: true, groupe: 'Dev', role: 'api' },
    { nom: 'essai-api', lanceur: 'essai-api', port: 4002, url: 'http://localhost:4002', actif: true, epinglee: false, groupe: 'essai', role: 'api' },
    { nom: 'essai-web', lanceur: 'essai-web', port: 4001, url: 'http://localhost:4001', actif: true, epinglee: false, groupe: 'essai', role: 'web' },
    { nom: 'essai-redis', lanceur: 'essai-redis', port: 6400, url: 'http://localhost:6400', actif: true, epinglee: false, groupe: 'essai', role: 'redis' },
    { nom: 'vieux-web', lanceur: 'vieux-web', port: 5000, url: 'http://localhost:5000', actif: false, epinglee: false, groupe: 'vieux', role: 'web' },
    { nom: 'vieux-api', lanceur: 'vieux-api', port: 5001, url: 'http://localhost:5001', actif: false, epinglee: false, groupe: 'vieux', role: 'api' },
    { nom: 'autre', lanceur: 'autre', port: 5100, url: 'http://localhost:5100', actif: false, epinglee: false, groupe: 'autre', role: '' },
  ]
  const { sent, ran } = await lancer($, on, { ...SNAP, piles, autresPiles: 3 })
  const ui = await $.ui.mount(pane())
  // Deux piles tournent : deux pastilles, sur le port web.
  expect((await ui.find({ key: 'ouvrir-3000' }))?.props.label).toBe('Dev 3000 ↗\ufe0e')
  expect((await ui.find({ key: 'ouvrir-4001' }))?.props.label).toBe('essai 4001 ↗\ufe0e')
  expect(await ui.find({ key: 'ouvrir-3001' })).toBeUndefined()
  expect(await ui.find({ key: 'ouvrir-4002' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^api\s3001\s$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^api\s4002 · redis\s6400\s$/ })).toBeTruthy()
  // Les arrêtées : un seul mot, repliées.
  expect((await ui.find({ key: 'arretees' }))?.props.label).toBe('+ 2 arrêtées')
  expect(await ui.find({ key: 'lancer-5000' })).toBeUndefined()
  await ui.press({ key: 'arretees' })
  expect((await ui.find({ key: 'lancer-5000' }))?.props.label).toBe('vieux 5000 ▶\ufe0e')
  expect(await ui.find({ key: 'lancer-5100' })).toBeTruthy()
  // « arrêter » sur chaque pile qui tourne, gardée ou non ; il ne fait qu'envoyer la demande.
  expect(await ui.find({ key: 'arreter-3000' })).toBeTruthy()
  await ui.press({ key: 'arreter-4001' })
  expect(sent.at(-1)).toMatch(/Arrête la pile locale « essai » \(ports 4002, 4001, 6400\)[\s\S]*preview_stop[\s\S]*Ne supprime rien, ne pousse rien/)
  for (const argv of ran) expect(['/usr/bin/python3', '/usr/bin/open', '/bin/zsh']).toContain(argv[0])
  await ui.unmount()
})

test('bouton du label d\'approbation : seulement sous une PR dont la garde est rouge, confirmation, puis demande à Claude', async ($, on) => {
  const { sent, ran } = await lancer($, on)
  const ui = await $.ui.mount(pane())
  // #407 : garde KO ; les autres PR n'ont pas le bouton.
  expect(await ui.find({ key: 'ok-407' })).toBeTruthy()
  expect(await ui.find({ key: 'ok-614' })).toBeUndefined()
  expect(await ui.find({ key: 'ok-605' })).toBeUndefined()
  expect((await ui.find({ key: 'ok-407' }))?.props.label).toBe('ok-equipe…')
  // Un appui ne fait que lire le contrôle et demander confirmation.
  await ui.press({ key: 'ok-407' })
  expect(ran.find(a => a.includes('--garde-detail'))?.slice(-1)).toEqual(['407'])
  expect(sent).toEqual([])
  expect(await ui.find({ type: 'Text', text: 'Tests signalés : decision-du-30-10 (8)' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Ces tests verrouillent tes décisions. Les modifier ?' })).toBeTruthy()
  // Annuler : rien ne part.
  await ui.press({ key: 'ok-annuler-407' })
  expect(sent).toEqual([])
  expect(await ui.find({ key: 'ok-407' })).toBeTruthy()
  // Confirmer : la demande part, pour cette PR seulement, sans merge.
  await ui.press({ key: 'ok-407' })
  await ui.press({ key: 'ok-confirmer-407' })
  expect(sent).toEqual([
    'ok-equipe #407 : je valide la modification des tests verrouillés listés (decision-du-30-10 (8)). Ajoute seulement le label ok-equipe sur #407, pas de merge.',
  ])
  // Ensuite la ligne dit que c'est demandé, et le bouton disparaît.
  expect(await ui.find({ type: 'Text', text: 'ok-equipe demandé' })).toBeTruthy()
  expect(await ui.find({ key: 'ok-407' })).toBeUndefined()
  for (const argv of ran) expect(['/usr/bin/python3', '/usr/bin/open', '/bin/zsh']).toContain(argv[0])
  await ui.unmount()
})

test('sans label d\'approbation réglé, pas de bouton', async ($, on) => {
  await lancer($, on, { ...SNAP, labelOk: '' })
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ key: 'ok-407' })).toBeUndefined()
  await ui.unmount()
})

test('répondre depuis le panneau : sous une session qui attend, un bouton par réponse, envoyé à cette session', async ($, on) => {
  const avecReco = { ...SNAP, sessions: SNAP.sessions.map(s => (s.id === 'local_a' ? { ...s, reco: 'Oui, applique' } : s)) }
  const { envois, sent, toasts } = await lancer($, on, avecReco)
  const ui = await $.ui.mount(pane())
  // Seulement sous la session qui a posé une question (a), pas sous celle à relire (d).
  expect((await ui.find({ key: 'rep-local_a-0' }))?.props.label).toBe('Oui')
  // Sa recommandation est écrite en clair au-dessus du bouton qui la suit.
  expect(await ui.find({ type: 'Text', text: 'Sa reco : Oui, applique' })).toBeTruthy()
  expect((await ui.find({ key: 'rep-local_a-2' }))?.props.label).toBe('Suis ta recommandation')
  expect(await ui.find({ key: 'rep-local_d-0' })).toBeUndefined()
  await ui.press({ key: 'rep-local_a-1' })
  expect(envois).toHaveLength(1)
  // Adressée par l'identifiant Claude de la session, celui sous lequel elle écoute.
  expect(JSON.stringify(envois[0]?.to)).toContain('cli-a')
  expect(envois[0]?.text).toBe("Réponse de l'utilisateur à ta question « réponds à la question », donnée par un bouton de son panneau de bord : Non.")
  expect(toasts.at(-1)).toBe('Réponse envoyée : Non')
  // Rien ne part vers la session en cours ; les boutons laissent place à ce qui a été envoyé.
  expect(sent).toEqual([])
  expect(await ui.find({ type: 'Text', text: 'Réponse envoyée : Non' })).toBeTruthy()
  expect(await ui.find({ key: 'rep-local_a-0' })).toBeUndefined()
  await ui.unmount()
})

test('suivre la recommandation : la réponse envoyée la cite ; sans recommandation connue, pas de bouton pour la suivre', async ($, on) => {
  const avecReco = { ...SNAP, sessions: SNAP.sessions.map(s => (s.id === 'local_a' ? { ...s, reco: 'Oui, applique' } : s)) }
  const { envois } = await lancer($, on, avecReco)
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'rep-local_a-2' })
  expect(envois[0]?.text).toContain('Suis ta recommandation (celle-ci : « Oui, applique »).')
  await ui.unmount()
})

test('sans recommandation connue : le panneau le dit et ne propose pas de la suivre', async ($, on) => {
  await lancer($, on)
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ type: 'Text', text: 'Sa reco : aucune donnée' })).toBeTruthy()
  expect((await ui.find({ key: 'rep-local_a-0' }))?.props.label).toBe('Oui')
  expect(await ui.find({ key: 'rep-local_a-2' })).toBeUndefined()
  await ui.unmount()
})

test('« À faire (N) » dans le groupe épinglé : détail, session à rouvrir, « fait » qui retire', async ($, on) => {
  const notes = [
    { id: 't1', texte: 'Finir le test à deux comptes', detail: 'Étape 1 puis étape 2', pour: '2030-01-02', session: 'local_a' },
    { id: 't2', texte: 'Relire la doc' },
  ]
  const { ecrits, ran, sent } = await lancer($, on, { ...SNAP, aFaire: notes })
  // Le fichier de la liste, tel que le disque le garde.
  ecrits.push({ path: '/Users/moi/.claude/agent-cockpit/a-faire.json', text: JSON.stringify(notes) })
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ type: 'Text', text: 'ÉPINGLÉ' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'À FAIRE (2)' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'pour le 02/01' })).toBeTruthy()
  // Le détail ne s'affiche qu'à la demande.
  expect(await ui.find({ type: 'Text', text: 'Étape 1 puis étape 2' })).toBeUndefined()
  await ui.press({ key: 'detail-afaire-t1' })
  expect(await ui.find({ type: 'Text', text: 'Étape 1 puis étape 2' })).toBeTruthy()
  await ui.press({ key: 'session-afaire-t1' })
  expect(ran).toContainEqual(['/usr/bin/open', 'claude://code/continue?session=local_a&source=desktop_action'])
  // Déjà notée : la session ne propose plus de la noter.
  expect(await ui.find({ key: 'plus-tard-local_a' })).toBeUndefined()
  await ui.press({ key: 'fait-afaire-t1' })
  const ecrit = [...ecrits].reverse().find(e => e.path.endsWith('/a-faire.json'))
  expect(JSON.parse(ecrit?.text ?? '[]')).toEqual([{ id: 't2', texte: 'Relire la doc' }])
  expect(sent).toEqual([])
  await ui.unmount()
})

test('« + À faire » sous une session qui attend la note pour plus tard, avec sa question', async ($, on) => {
  const { ecrits, toasts } = await lancer($, on)
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'plus-tard-local_a' })
  const ecrit = [...ecrits].reverse().find(e => e.path.endsWith('/a-faire.json'))
  expect(JSON.parse(ecrit?.text ?? '[]')).toMatchObject([{ texte: 'Bug prod', detail: 'réponds à la question', session: 'local_a' }])
  expect(toasts.at(-1)).toContain('Noté dans « À faire »')
  await ui.unmount()
})

test('au survol d\'une pastille : pourquoi cet état', async ($, on) => {
  const snap = { ...SNAP, sessions: SNAP.sessions.map(s => (s.id === 'local_b' ? { ...s, raison: '2 tâches de fond en cours' } : s)) }
  await lancer($, on, snap)
  const ui = await $.ui.mount(pane())
  const cartes = (await ui.findAll({ type: 'Text' }))
    .filter((t: { props: { color?: string } }) => t.props.color === 'inverseText')
    .map((c: { text: string }) => c.text.replace(/\s/g, ' ').trim())
  expect(cartes).toContain('2 tâches de fond en cours')
  expect(cartes).toContain('Elle est en conflit avec dev')
  expect(cartes).toContain('Ses contrôles sont verts et elle est mergeable')
  // Une ligne par carte : aucune ne peut se couper.
  await ui.unmount()
})

test('une session suivie reste visible une fois finie, dans « Suivi »', async ($, on) => {
  const snap = { ...SNAP, sessions: SNAP.sessions.map(s => (s.id === 'local_c' ? { ...s, suivi: true } : s)) }
  await lancer($, on, snap)
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ type: 'Text', text: 'SUIVI' })).toBeTruthy()
  expect(await rangs(ui)).toContain('Vieux')
  // « Suivi » vient juste après « À toi », avant « En cours ».
  expect((await rangs(ui)).indexOf('Vieux')).toBeLessThan((await rangs(ui)).indexOf('Release'))
  // Elle n'est plus comptée avec les terminées repliées.
  expect(await ui.find({ key: 'toutes' })).toBeUndefined()
  await ui.unmount()
})

test('chaque groupe se replie depuis sa bande et se déplie de même', async ($, on) => {
  await lancer($, on)
  const ui = await $.ui.mount(pane())
  expect((await ui.find({ key: 'replier-toi' }))?.props.label).toBe('▲\u00a0replier')
  await ui.press({ key: 'replier-cours' })
  // La bande reste, avec son compte ; ses lignes disparaissent, les autres groupes ne bougent pas.
  expect(await ui.find({ type: 'Text', text: 'EN COURS' })).toBeTruthy()
  expect(await rangs(ui)).toEqual(['Bug prod', 'Autres agents', '#614', '#605', '#429', '#407'])
  expect((await ui.find({ key: 'replier-cours' }))?.props.label).toBe('▼\u00a0déplier')
  await ui.press({ key: 'replier-cours' })
  expect(await rangs(ui)).toContain('Release')
  await ui.unmount()
})

test('résumé express sur une PR : celui de la session qui l\'a ouverte, déjà prêt, le clic ne fait qu\'afficher', async ($, on) => {
  // #614 a été ouverte par la session d (à relire, donc résumée d'avance) ; #429 par une session archivée.
  const auteurs = { '614': { id: 'local_d', cli: 'cli-d', activite: 200 }, '429': { id: 'local_z', cli: 'cli-z', activite: 1 } }
  const { ran, sent } = await lancer($, on, { ...SNAP, auteurs })
  const qct = () => ran.filter(a => a[0] === '/bin/zsh')
  const ui = await $.ui.mount(pane())
  expect((await ui.find({ key: 'qct-pr-614' }))?.props.label).toBe('≡')
  expect(await ui.find({ key: 'qct-pr-605' })).toBeUndefined()
  const avant = qct().length
  await ui.press({ key: 'qct-pr-614' })
  expect(await ui.find({ type: 'Text', text: '📌 Bug prod : une question attend ta réponse.' })).toBeTruthy()
  expect(qct()).toHaveLength(avant)
  await ui.press({ key: 'qct-pr-614' })
  expect(await ui.find({ type: 'Text', text: /Ne la ferme pas encore/ })).toBeUndefined()
  // Session archivée, pas de résumé d'avance : le clic le demande pour elle.
  await ui.press({ key: 'qct-pr-429' })
  expect(qct().at(-1)?.at(-1)).toBe('cli-z')
  expect(await ui.find({ type: 'Text', text: /Ne la ferme pas encore/ })).toBeTruthy()
  expect(sent).toEqual([])
  await ui.unmount()
})

test('une session finie dans la journée reste visible, dans « Terminé depuis peu »', async ($, on) => {
  const snap = { ...SNAP, sessions: [...SNAP.sessions, session('local_r', 'Sans suite', 'fini', 60, '17/11 14:00', { minutes: 90 })] }
  await lancer($, on, snap)
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ type: 'Text', text: 'TERMINÉ DEPUIS PEU' })).toBeTruthy()
  expect(await rangs(ui)).toContain('Sans suite')
  // La vieille session finie reste repliée avec les anciennes.
  expect(await rangs(ui)).not.toContain('Vieux')
  expect((await ui.find({ key: 'toutes' }))?.text).toBe('Voir 1 terminée ou ancienne')
  await ui.unmount()
})

test('une session finie que tu n\'as pas ouverte depuis reste dans « À toi », « À vérifier » ; vue, elle en sort', async ($, on) => {
  const snap = {
    ...SNAP,
    sessions: [
      ...SNAP.sessions,
      session('local_n', 'Sans suite', 'fini', 60, '17/11 14:00', { vu: false, minutes: 90 }),
      session('local_v', 'Déjà vue', 'fini', 55, '17/11 13:00', { vu: true, minutes: 90 }),
    ],
  }
  await lancer($, on, snap)
  const ui = await $.ui.mount(pane())
  expect(await pastille(ui, 'À vérifier')).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '4 · ta réponse, ta relecture, ta vérification ou ton merge' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /1 à vérifier/ })).toBeTruthy()
  // Avant « En cours » : elle est bien dans le premier groupe.
  const ordre = await rangs(ui)
  expect(ordre.indexOf('Sans suite')).toBeLessThan(ordre.indexOf('Release'))
  // Celle qui a été vue est avec les terminées récentes, pas dans « À toi ».
  expect(await ui.find({ type: 'Text', text: 'TERMINÉ DEPUIS PEU' })).toBeTruthy()
  await ui.unmount()
})

test('« ✓ » marque une session comme vue depuis le tableau, sans l\'ouvrir', async ($, on) => {
  const snap = { ...SNAP, sessions: [...SNAP.sessions, session('local_n', 'Sans suite', 'fini', 60, '17/11 14:00', { vu: false, minutes: 90 })] }
  const { ecrits, ran, sent } = await lancer($, on, snap)
  const ui = await $.ui.mount(pane())
  // Sur « À vérifier » et « À relire », pas sur une session qui attend une réponse.
  expect((await ui.find({ key: 'vu-local_n' }))?.props.label).toBe('✓\ufe0e')
  expect(await ui.find({ key: 'vu-local_d' })).toBeTruthy()
  expect(await ui.find({ key: 'vu-local_a' })).toBeUndefined()
  const avant = ran.length
  await ui.press({ key: 'vu-local_n' })
  const ecrit = ecrits.find(e => e.path === '/Users/moi/.claude/agent-cockpit/vus.json')
  expect(JSON.parse(ecrit?.text ?? '{}')).toEqual({ local_n: 60 })
  // Le panneau relit aussitôt ; rien ne part vers Claude, rien ne s'ouvre.
  expect(ran.length).toBeGreaterThan(avant)
  expect(ran.some(a => a[0] === '/usr/bin/open')).toBe(false)
  expect(sent).toEqual([])
  await ui.unmount()
})

test('un résumé raté (ligne « (qct : … ) ») n\'est pas gardé comme résumé, et il est retenté plus tard', async ($, on) => {
  const rate = { exitCode: 0, stdout: '📌 Bug prod\n(qct : le modèle n\'a pas répondu : session expirée)\n🕐 hier', stderr: '' }
  const { ran, clock } = await lancer($, on, SNAP, rate)
  const qct = () => ran.filter(a => a[0] === '/bin/zsh').length
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'qct-local_a' })
  expect(await ui.find({ type: 'Text', text: /Résumé impossible : le modèle n'a pas répondu : session expirée/ })).toBeTruthy()
  // Pas de nouvel essai à chaque rafraîchissement…
  const avant = qct()
  await clock.advance(30_000)
  expect(qct()).toBe(avant)
  // … mais dix minutes plus tard, oui.
  await clock.advance(600_000)
  expect(qct()).toBeGreaterThan(avant)
  await ui.unmount()
})

test('« toujours » : le panneau s\'ouvre dans chaque session, et ne collecte qu\'une fois dessiné', async ($, on) => {
  const ran: string[][] = []
  let opened = 0
  mock.env(on, { HOME: '/Users/moi' })
  const clock = mock.clock(on, { now: 1_000_000 })
  on('command.register', () => ({ value: { command: 'cockpit' } }))
  on('ui.open', () => {
    opened += 1
    return { value: { isPlaced: false, reason: 'no-surface' } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('fs.read', () => ({ value: JSON.stringify({ ouvrirAuto: 'toujours' }) }))
  on('fs.exists', () => ({ value: true }))
  on('fs.write', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'cli-1' }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    ran.push([...e.argv])
    const snap = { ...SNAP, moi: { favori: false }, qct: null }
    return { value: { exitCode: 0, stdout: JSON.stringify(snap), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/Users/moi', surface: 'desktop', isInteractive: true })
  for (let i = 0; i < 60 && opened === 0; i++) await new Promise<void>(r => setTimeout(() => r(), 5))
  expect(opened).toBe(1)
  // Une session pas favorite, personne ne regarde : une seule collecte, puis plus rien.
  await clock.advance(120_000)
  expect(ran).toHaveLength(1)
  // Dès que le panneau est dessiné, il se met à jour comme partout.
  const ui = await $.ui.mount(pane())
  await new Promise<void>(r => setTimeout(() => r(), 30))
  await clock.settle()
  expect(ran.some(a => a.includes('--prs'))).toBe(true)
  const avant = ran.length
  await clock.advance(30_000)
  expect(ran.length).toBeGreaterThan(avant)
  await ui.unmount()
})

test('une session épinglée est tout en haut, quel que soit son état', async ($, on) => {
  const snap = { ...SNAP, sessions: SNAP.sessions.map(s => (s.id === 'local_c' ? { ...s, titre: 'Sans suite', epingle: true, suivi: true } : s)) }
  await lancer($, on, snap)
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ type: 'Text', text: 'ÉPINGLÉ' })).toBeTruthy()
  expect((await rangs(ui))[0]).toBe('Sans suite')
  await ui.unmount()
})
