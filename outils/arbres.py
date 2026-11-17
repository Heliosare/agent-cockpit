#!/usr/bin/env python3
"""Sort l'arbre que le mod dessine pour un instantané donné (via `claude plugin test`).
Usage : arbres.py <dossier du mod> <instantané.json> <sortie.json> <colonnes> [touche à presser ...]"""
import glob, json, os, re, shutil, subprocess, sys, tempfile
mod, snap_path, out, cols = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
touches = sys.argv[5:]


def moteur():
    """Le moteur Claude Code à faire tourner : $CLAUDE_BIN, sinon celui de l'app de bureau (le plus récent), sinon `claude`."""
    if os.environ.get("CLAUDE_BIN"):
        return os.environ["CLAUDE_BIN"]
    apps = glob.glob(os.path.expanduser("~/Library/Application Support/Claude/claude-code/*/*/claude.app/Contents/MacOS/claude"))
    if apps:
        return max(apps, key=os.path.getmtime)
    return shutil.which("claude") or sys.exit("moteur introuvable : indique-le avec CLAUDE_BIN=<chemin de claude>")


APP = moteur()
snap = json.load(open(snap_path))
cfg = json.dumps({"ouvrirAuto": "favorites", "taches": snap.get("taches") or [], "consignes": snap.get("consignes") or {}}, ensure_ascii=False)
tmp = tempfile.mkdtemp(prefix="fb-rendu-")
dst = os.path.join(tmp, "flybuddy-panel")
shutil.copytree(mod, dst, ignore=shutil.ignore_patterns("tests", ".git", "__pycache__", ".DS_Store"))
os.makedirs(os.path.join(dst, "tests"))
test = '''import { mock, test } from 'claude-code/testing'
declare const setTimeout: (fn: () => void, ms: number) => unknown
declare const console: { log: (...a: unknown[]) => void }
const SNAP = %s
const CONFIG = %s
test('dump', async ($: any, on: any) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let opened = 0
  on('command.register', () => ({ value: { command: 'flybuddy' } }))
  on('ui.open', () => { opened += 1; return { value: { isPlaced: true } } })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  mock.env(on, { HOME: '/Users/moi' })
  on('fs.read', () => ({ value: CONFIG }))
  on('fs.exists', () => ({ value: true }))
  on('fs.write', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'cli-1' }))
  const ran: string[][] = []
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => { ran.push([...e.argv]); return { value: { exitCode: 0, stdout: JSON.stringify(SNAP), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/Users/moi', surface: 'desktop', isInteractive: true })
  for (let i = 0; i < 60 && !(opened > 0 && ran.some(a => a.includes('--prs'))); i++) await new Promise<void>(r => setTimeout(() => r(), 5))
  await new Promise<void>(r => setTimeout(() => r(), 20))
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'flybuddy-panel', component: 'Pane', requestId: 'flybuddy', surface: 'desktop', props: { title: 'Tableau de bord', isFocused: false, bodyColumns: %d, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
  for (const key of %s) await ui.press({ key })
  console.log('ARBRE:' + JSON.stringify(await ui.find({ type: 'Box' })))
  await ui.unmount()
})
''' % (json.dumps(snap, ensure_ascii=False), json.dumps(cfg, ensure_ascii=False), cols, json.dumps(touches))
open(os.path.join(dst, "tests", "dump.test.tsx"), "w").write(test)
r = subprocess.run([APP, "plugin", "test", dst], capture_output=True, text=True, timeout=150)
m = re.search(r"ARBRE:(\{.*\})\s*$", r.stdout + r.stderr, re.M)
shutil.rmtree(tmp, ignore_errors=True)
if not m:
    sys.exit("pas d'arbre :\n" + (r.stdout + r.stderr)[-1500:])
open(out, "w").write(m.group(1))
print("arbre écrit :", out)
