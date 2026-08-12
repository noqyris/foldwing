/*
 * App Store screenshots — the gallery and the share card.
 *
 * WHY THIS EXISTS IN THE REPO. The generator that made the 1.2/1.3 screenshots
 * lived in a scratch directory and faked its saved runs: each "solution" was a
 * sine wave interpolated from start to goal, so the ink cut straight through
 * walls and the picture showed something no player could do. It reached App
 * Store Connect and was caught by eye, not by anything automatic. A throwaway
 * script cannot be reviewed, so it lives here now, and it verifies itself.
 *
 * Every run is the VALIDATOR'S PROVED ROUTE, and each candidate must clear two
 * separate checks before it can be drawn — see `playable` and `looksRight`
 * below. A run that fails is dropped and named in the output, never quietly
 * softened until it passes.
 *
 * PREREQUISITES (neither is a project dependency, both are needed):
 *
 *   1. the dev server:   npx vite --port 5199 --strictPort
 *   2. playwright:       npm i -D playwright && npx playwright install chrome
 *
 * Then, from this directory:
 *
 *   node capture.mjs        # raw captures -> store/screenshots/raw/
 *   python3 compose.py      # framed 1290x2796 -> store/screenshots/
 *
 * Headed Chrome is not a preference. Headless falls back to SwiftShader and the
 * game canvas comes out blank, which looks like a broken build rather than a
 * broken capture.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

// Raw captures land beside the composed frames so a bad run is inspectable.
const OUT = new URL('../../store/screenshots/raw/', import.meta.url).pathname;
const URL = 'http://localhost:5199/';
const KEY = 'CapacitorStorage.foldwing.save.v1';
mkdirSync(OUT, { recursive: true });

// Headed Chrome: headless falls back to SwiftShader and the canvas comes out
// blank. 430x932 @3 = 1290x2796, the 6.7" slot this app already has.
const b = await chromium.launch({ headless: false, channel: 'chrome' });
const c = await b.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3 });

const seeder = await c.newPage();
seeder.on('pageerror', (e) => console.log('THROW', e.message));
await seeder.goto(URL, { waitUntil: 'load' });
await seeder.waitForTimeout(1800);

const built = await seeder.evaluate(async () => {
  const { LEVELS } = await import('/src/data/levels.ts');
  const { validateLevel } = await import('/src/core/LevelValidator.ts');
  const { Playfield } = await import('/src/core/Playfield.ts');
  const { CollisionSystem } = await import('/src/core/CollisionSystem.ts');
  const { renderStroke } = await import('/src/core/StrokeRecorder.ts');
  const { BASE_HEIGHT, BASE_WIDTH, METRICS } = await import('/src/render/Theme.ts');

  const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);

  /*
   * Prove the route with the game's own hit radius, then hand-ify it. The
   * wobble is deliberately small and is applied BEFORE verification, never
   * after, so what gets checked is what gets drawn.
   */
  const make = (level, ms, wobble, plan) => {
    /*
     * Plan with MORE clearance than the game demands.
     *
     * The proved route is a shortest path, so it hugs walls, and the card then
     * smooths it — which shaves corners straight into the wall it was hugging.
     * Planning at a fatter radius buys the smoother room to work. The result is
     * still checked against the real rules below; the fat radius only decides
     * where the line goes, never whether it is allowed.
     *
     * A finer grid also matters: a coarse BFS route reads as a staircase no
     * hand ever drew.
     */
    const res = validateLevel(level, pf, {
      cell: 4,
      hitRadius: plan,
      goalRadius: METRICS.goalRadius,
    });
    if (!res.solvable || res.path.length < 3) return null;

    const raw = res.path.map((q, i) => ({
      x: q.x + Math.sin(i / 6) * wobble,
      y: q.y + Math.cos(i / 9) * wobble * 0.4,
    }));
    const times = raw.map((_, i) => Math.round((i / (raw.length - 1)) * ms));
    const walls = level.walls.map((w) => pf.toScreenRect(w));
    const collision = new CollisionSystem(walls, METRICS.hitRadius, pf.axisX);

    /*
     * Two different questions, two different radii.
     *
     * PLAYABLE asks the game's own question of the saved samples: with the full
     * hit radius, could a finger have travelled this? That is the rule the game
     * enforces while drawing, on the raw samples, and it is what makes the run
     * honest rather than staged.
     *
     * LOOKS RIGHT asks a smaller question of the LINE the card finally draws:
     * does the ink centreline actually enter a wall? The card re-smooths the
     * samples, and smoothing shaves corners, so a legal run can end up drawn a
     * hair inside a corner — real gameplay does this too, and it is invisible.
     * A hair is fine. Crossing a wall is not, and that is what shipped.
     */
    const inked = new CollisionSystem(walls, 1, pf.axisX);
    const clean = (pts, sys) => {
      for (let i = 1; i < pts.length; i++) {
        if (sys.blocks(pts[i - 1], pts[i])) return false;
      }
      return true;
    };
    const playable = (pts) => clean(pts, collision);
    const looksRight = (drawn) => clean(drawn.points, inked);

    /*
     * What gets saved is SAMPLES, not the rendered line — a real run stores
     * what the finger reported every few pixels, and the card re-runs
     * renderStroke over that at METRICS.smoothIterations. So the thing to tune
     * is sample spacing, and the thing to verify is the card's own output.
     *
     * Wider spacing means a rounder, more hand-drawn line, and rounding a
     * corner is exactly how a legal route becomes an illegal one. Walk DOWN
     * from the widest and keep the first that still passes: the softest line
     * this maze actually allows, never a prettier one than it allows.
     */
    const decimate = (gap) => {
      const pts = [raw[0]];
      const ts = [times[0]];
      for (let i = 1; i < raw.length - 1; i++) {
        const last = pts[pts.length - 1];
        if (Math.hypot(raw[i].x - last.x, raw[i].y - last.y) >= gap) {
          pts.push(raw[i]);
          ts.push(times[i]);
        }
      }
      pts.push(raw[raw.length - 1]);
      ts.push(times[times.length - 1]);
      return { pts, ts };
    };

    for (const gap of [14, 11, 9, 7, 5]) {
      const { pts, ts } = decimate(gap);
      if (pts.length < 4) continue;
      // Exactly what layoutFigureCard will do with these samples.
      if (!playable(pts)) continue;
      const asCard = renderStroke(pts, ts, METRICS.renderMaxSpacing, METRICS.smoothIterations);
      if (!looksRight(asCard)) continue;
      return {
        ok: true,
        smoothing: gap,
        samples: pts.length,
        figure: {
          levelId: level.id,
          levelName: level.name,
          points: pts.map((q) => pf.toNormalized(q)),
          times: ts,
          ms,
          at: 1700000000000 + ms,
          walls: level.walls,
          start: level.start,
          goal: level.goal,
        },
      };
    }
    return { levelId: level.id, hits: 1 };
  };

  // A spread of mazes so the cards do not all read the same, with plausible
  // times. Wobble shrinks on the tighter late levels.
  const picks = [
    [24, 8200, 2.2], [46, 7600, 2.0], [71, 6300, 1.8], [93, 5700, 1.6],
    [118, 9400, 1.4], [140, 8800, 1.4], [163, 7100, 1.2], [186, 6600, 1.2],
    [37, 10300, 2.0],
  ];

  const figures = [];
  const rejected = [];
  const smoothing = [];
  for (const [idx, ms, wob] of picks) {
    const level = LEVELS[idx];
    if (!level) continue;
    /*
     * Widest clearance first, because that is the line that survives smoothing
     * and looks most like a hand. Drop to tighter planning only when the maze
     * has no room for the generous route, and drop the wobble last.
     */
    let got = null;
    outer: for (const plan of [METRICS.hitRadius + 7, METRICS.hitRadius + 5,
                               METRICS.hitRadius + 3, METRICS.hitRadius]) {
      for (const wobble of [wob, 0]) {
        const attempt = make(level, ms, wobble, plan);
        if (attempt && attempt.ok) { got = attempt; break outer; }
      }
    }
    if (got) { figures.push(got.figure); smoothing.push(`${got.figure.levelId}:${got.smoothing}`); }
    else rejected.push(level.id);
  }

  const bestMs = {};
  const cleared = [];
  for (let i = 0; i < 62; i++) {
    cleared.push(LEVELS[i].id);
    bestMs[LEVELS[i].id] = 3800 + i * 70;
  }

  const save = {
    version: 2, unlockedIndex: 62, bestMs, cleared, reveals: 4,
    lastTopUp: '2026-08-11', adsRemoved: true, totalWins: 71,
    winsSinceAd: 0, attemptsSinceAd: 0, ratePrompted: true,
    figures, daily: {},
    medals: [LEVELS[8].id, LEVELS[19].id, LEVELS[33].id],
    foldSense: 74, sound: true, haptics: true, reducedMotion: false, capability: '',
  };
  /*
   * Write the save HERE rather than returning it. A cell:4 route carries
   * thousands of points per figure, and handing that back across the CDP
   * bridge as JSON killed the page — the seeding is the only thing that
   * needed to happen in the browser anyway.
   */
  const json = JSON.stringify(save);
  localStorage.setItem('CapacitorStorage.foldwing.save.v1', json);
  return { verified: figures.length, rejected, smoothing, bytes: json.length };
});

console.log(`verified figures: ${built.verified}`);
console.log(`smoothing chosen: ${built.smoothing.join(', ')}`);
if (built.rejected.length) console.log(`REJECTED (would have crossed a wall): ${built.rejected.join(', ')}`);
console.log(`save bytes: ${built.bytes}`);
if (built.verified < 4) { console.log('not enough clean runs — aborting'); await b.close(); process.exit(1); }

const p = await c.newPage();
p.on('pageerror', (e) => console.log('THROW', e.message));
await p.goto(URL, { waitUntil: 'load' });
await p.waitForTimeout(2600);

const go = async (s, d) => {
  await p.evaluate(([s, d]) => window.game.scene.getScenes(true)[0].scene.start(s, d ?? {}), [s, d]);
  await p.waitForTimeout(1400);
};

await go('Gallery');
await p.screenshot({ path: `${OUT}/gallery.png` });
console.log('gallery captured');

/*
 * The share card is the artefact a friend actually receives, so screenshot the
 * real renderer rather than staging a lookalike. 13.2s is the challenge time.
 */
const cardUrl = await p.evaluate(async () => {
  const { renderShareCard, shareCardOptions } = await import('/src/render/ShareCard.ts');
  const raw = localStorage.getItem('CapacitorStorage.foldwing.save.v1');
  const fig = { ...JSON.parse(raw).figures[1], ms: 13200 };
  return renderShareCard(fig, { ...shareCardOptions(fig) });
});
writeFileSync(`${OUT}/sharecard.png`, Buffer.from(cardUrl.split(',')[1], 'base64'));
console.log('share card captured');

await b.close();
console.log('done');
