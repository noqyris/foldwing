/*
 * App Store screenshots, 1.4 — the nine frames of the listing, captured from
 * the running game.
 *
 * WHY THIS EXISTS IN THE REPO. The generator that made the 1.2/1.3 screenshots
 * lived in a scratch directory and faked its saved runs: each "solution" was a
 * sine wave interpolated from start to goal, so the ink cut straight through
 * walls and the picture showed something no player could do. It reached App
 * Store Connect and was caught by eye, not by anything automatic. A throwaway
 * script cannot be reviewed, so it lives here now, and it verifies itself.
 *
 * Every winning line is the VALIDATOR'S PROVED ROUTE, planned FAT — at
 * hitRadius+7, +6, +5 and never tighter — and checked at two radii before it
 * is used. There are two kinds of run, and each is proved in its own form:
 *
 *   - A SAVED figure (the gallery, the share card) is samples. They must be
 *     `playable` at the game's real hitRadius, and the line the card draws
 *     from them must `looksRight` at radius 1 — see `make` below.
 *   - A DRIVEN stroke (level 48 and the Daily, played on screen) is pointer
 *     positions. They are run through GameScene's own cursorFor, collision,
 *     goal test and StrokeRecorder before a single event is sent, and the ink
 *     the game will draw from them is checked at radius 1 — see `planRoute`.
 *     They are then driven one event per processed move, so the browser can
 *     never merge two moves into a chord nobody proved, and only while the
 *     game loop draws a real frame rate, so the time and the ink the game
 *     records are what a hand would get — see `drive` and `steady`.
 *
 * A run that fails is dropped and named in the output, never quietly softened
 * until it passes.
 *
 * The one stroke that is not a win is frame 2's crash, and it is not painted
 * on either: a proved route's own prefix, then a turn that leaves the player's
 * line clear of every wall on its side and that the game must kill on the
 * REFLECTION alone. It is simulated against the game's logic first, then
 * driven until the game itself reports the death.
 *
 * THE PHONE. Night Fold's world is as tall as the phone's safe area
 * (Theme.adaptiveHeight), so the capture is a real phone shape, not a box cut
 * to the slot: an iPhone 18 Pro — 402x874 points at 3x, the phone the Night
 * Fold mocks were drawn on — with its status bar and home indicator as the
 * safe area (the dev server's `?safe=` override), which builds the same
 * 750x1451 world a player gets. compose.py lays that under the caption band.
 *
 * PREREQUISITES (neither is a project dependency, both are needed):
 *
 *   1. an ADS-OFF dev server — never `dev:mock`, whose fake ads must not reach
 *      store media, and never an ADS:on one. The script refuses anything else.
 *        VITE_ADS=off VITE_AD_MODE=test npx vite --port 5200 --strictPort
 *      Port 5200 by default; FW_PORT=<port> or `--port <port>` names another.
 *   2. playwright with Chrome. An install outside the repo works:
 *        FW_PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs
 *
 * Then, from this directory:
 *
 *   node capture.mjs [01 02 …]   # raw captures + proof.json -> store/screenshots/1.4/raw/
 *   python3 compose.py           # 1320x2868 frames + contact.png -> store/screenshots/1.4/
 *   node capture.mjs crashes     # the mirror deaths level 48 offers, to pick CRASH from
 *
 * A partial run (`node capture.mjs 02 07`) merges its proof into proof.json
 * rather than replacing the other frames'.
 *
 * Headed Chrome is not a preference. Headless falls back to SwiftShader and the
 * game canvas comes out blank, which looks like a broken build rather than a
 * broken capture. Keep its window unoccluded: macOS throttles a hidden one.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const { chromium } = await import(process.env.FW_PLAYWRIGHT ?? 'playwright');

// Raw captures land beside the composed frames so a bad run is inspectable.
const OUT = new URL('../../store/screenshots/1.4/raw/', import.meta.url).pathname;
const args = process.argv.slice(2);
const portAt = args.indexOf('--port');
/** The ads-off server: 5200 unless FW_PORT or `--port` says otherwise. Checked below — ADS:off or nothing. */
const PORT = portAt >= 0 ? args[portAt + 1] : process.env.FW_PORT ?? '5200';
if (!/^\d+$/.test(String(PORT))) throw new Error(`--port needs a number, got ${PORT}`);
/** The phone's safe-area insets in points, top,right,bottom,left: an iPhone 18 Pro's. */
const SAFE = process.env.FW_SAFE ?? '62,0,34,0';
const GAME = `http://localhost:${PORT}/?safe=${SAFE}`;
const KEY = 'CapacitorStorage.foldwing.save.v1';
/** The menu logo draws itself on the first visit of a day; seeded as already drawn. */
const LOGO_DAY_KEY = 'foldwing.logoDay';
mkdirSync(OUT, { recursive: true });

/*
 * One calendar day for every frame. Today's missions, the Daily's maze and the
 * streak are all functions of the date, and on 2026-09-23 the three missions
 * are the Daily, "Clear 3 folds" and "Earn two stars on any fold" — the set
 * frame 9 shows. Only the calendar is moved: timers and animation stay real.
 */
const TODAY = '2026-09-23';
const CLOCK = `${TODAY}T12:00:00+02:00`;
const ZONE = 'Europe/Belgrade';

/** How much wider than hitRadius a route is planned, widest first. Never below +5. */
const FAT = [7, 6, 5];

/** The share card's maze, by level index. */
const SHARE = Number(process.env.FW_SHARE_LEVEL ?? 140);

/** Frame 5's player: folds made, the frontier the one after. */
const JOURNEY = Number(process.env.FW_JOURNEY ?? 55);

const want = args.filter((a, i) => a !== '--port' && (portAt < 0 || i !== portAt + 1));
const wanted = (id) => want.length === 0 || want.includes(id);

// 402x874 @3 = 1206x2622: an iPhone 18 Pro, safe area and all (see THE PHONE).
const VIEW = { width: 402, height: 874 };
const DPR = 3;
const b = await chromium.launch({
  headless: false,
  channel: 'chrome',
  args: ['--window-position=10,-1400'],
});

/* ------------------------------------------------------------------ pages */

/**
 * A fresh context per frame, its save seeded BEFORE any app code runs. Never
 * set a save and reload: Progress flushes its in-memory save on pagehide, and
 * the old page would write it back over the new one.
 */
async function open(save, { settle = 1200, menu = true } = {}) {
  const ctx = await b.newContext({
    viewport: VIEW,
    deviceScaleFactor: DPR,
    hasTouch: true,
    isMobile: true,
    timezoneId: ZONE,
  });
  await ctx.addInitScript(appImport);
  await ctx.addInitScript(quietHmr);
  await ctx.addInitScript(shiftClock, new Date(CLOCK).getTime());
  await ctx.addInitScript(
    ([k, v, logoKey, day]) => {
      try {
        if (v) localStorage.setItem(k, v);
        localStorage.setItem(logoKey, day);
      } catch {}
    },
    [KEY, save ? JSON.stringify(save) : null, LOGO_DAY_KEY, TODAY]
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  THROW', e.message));
  await page.goto(GAME, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => !!window.game, null, { timeout: 180000 });
  // The save builder only needs the modules; a fresh save may open on level 1.
  if (menu) {
    await skipIntro(page);
    await page.waitForFunction(() => window.game.scene.isActive('Menu'), null, { timeout: 180000 });
  }
  await page.waitForTimeout(settle);
  return { ctx, page };
}

/**
 * `__fwImport(path)`: the APP'S instance of a module. After a hot update Vite
 * serves `Progress.ts?t=…`, and a plain import of `/src/…` would get a second,
 * empty copy — so the URL the page actually fetched is looked up.
 */
function appImport() {
  try {
    performance.setResourceTimingBufferSize(100000);
  } catch {}
  window.__fwImport = (path) => {
    const hits = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => {
        try {
          return new URL(n).pathname === path;
        } catch {
          return false;
        }
      });
    return import(/* @vite-ignore */ hits.length ? hits[hits.length - 1] : path);
  };
}

/** Other sessions edit this tree; a hot reload mid-level would tear the scene down. */
function quietHmr() {
  const Real = window.WebSocket;
  function Quiet(url, protocols) {
    const p = Array.isArray(protocols) ? protocols : [protocols];
    if (!p.includes('vite-hmr')) return new Real(url, protocols);
    return { url: String(url), readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} };
  }
  Quiet.prototype = Real.prototype;
  window.WebSocket = Quiet;
}

/** The calendar starts at `target` and keeps running; timers and rAF stay real. */
function shiftClock(target) {
  const Real = Date;
  const offset = target - Real.now();
  class Shifted extends Real {
    constructor(...a) {
      if (a.length === 0) super(Real.now() + offset);
      else super(...a);
    }
    static now() {
      return Real.now() + offset;
    }
  }
  globalThis.Date = Shifted;
}

/** The opening film: a tap on its layer is the player's own skip. */
async function skipIntro(page) {
  const until = Date.now() + 4000;
  while (Date.now() < until) {
    const box = await page.evaluate(() => {
      const el = document.querySelector('[data-intro]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (box) {
      await page.mouse.click(box.x, box.y);
      await page.waitForFunction(() => !document.querySelector('[data-intro]'), null, { timeout: 30000 });
      return;
    }
    if (await page.evaluate(() => window.game?.scene?.isActive('Menu'))) return;
    await page.waitForTimeout(100);
  }
}

async function go(page, key, data = {}, settle = 1400) {
  await page.evaluate(([k, d]) => window.game.scene.getScenes(true)[0].scene.start(k, d), [key, data]);
  await page.waitForFunction((k) => window.game.scene.isActive(k), key, { timeout: 45000 });
  await page.waitForTimeout(settle);
}

/** Base canvas coords (750x1334) -> CSS page coords, through Phaser's own bounds. */
const toPage = (page, pts) =>
  page.evaluate((list) => {
    const sm = window.game.scale;
    const r = sm.canvasBounds;
    return list.map((p) => ({ x: r.x + p.x / sm.displayScale.x, y: r.y + p.y / sm.displayScale.y }));
  }, pts);

/** A real tap on a game object, found by scene and a JS accessor. */
async function tap(page, sceneKey, accessor) {
  const at = await page.evaluate(
    ([k, src]) => {
      const s = window.game.scene.getScene(k);
      const o = new Function('s', `return (${src})(s)`)(s);
      if (!o) return null;
      const m = o.getWorldTransformMatrix ? o.getWorldTransformMatrix() : null;
      return m ? { x: m.tx, y: m.ty } : { x: o.x, y: o.y };
    },
    [sceneKey, accessor.toString()]
  );
  if (!at) throw new Error(`tap: ${accessor} is not on ${sceneKey}`);
  const [q] = await toPage(page, [at]);
  await page.mouse.click(q.x, q.y);
}

/** The game loop asleep for the capture, so a tween is caught in one frame. */
async function shot(page, name) {
  await page.evaluate(() => window.game.loop.sleep());
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.evaluate(() => window.game.loop.wake());
  console.log(`  ${name}.png`);
}

/**
 * Sleep the loop on the first rendered frame at least each of `marks` ms past
 * the moment `phase` began, so an effect is caught where it was aimed. Time is
 * counted in the game's own frame deltas, which stop while the loop sleeps —
 * the scene clock does not, so after a wake it would count the capture too.
 * `frozen(page, i)` resolves with how far past the start mark `i` froze.
 */
async function freezeAt(page, phase, marks) {
  await page.evaluate(
    ([phase, marks]) => {
      const g = window.game.scene.getScene('Game');
      const loop = window.game.loop;
      const st = { started: false, t: 0, marks: [...marks], hits: [] };
      window.__fwFreeze = st;
      const onFrame = () => {
        if (!st.started) {
          st.started = g.phase === phase;
          return;
        }
        st.t += loop.delta;
        if (st.marks.length > 0 && st.t >= st.marks[0]) {
          st.marks.shift();
          st.hits.push(st.t);
          loop.sleep();
          if (st.marks.length === 0) window.game.events.off('postrender', onFrame);
        }
      };
      window.game.events.on('postrender', onFrame);
    },
    [phase, marks]
  );
}
const frozen = (page, i) =>
  page
    .waitForFunction((i) => window.__fwFreeze.hits.length > i && window.__fwFreeze.hits[i], i, { polling: 50, timeout: 30000 })
    .then((h) => h.jsonValue());

/* ------------------------------------------------------------------ saves */

/**
 * Saves are built inside a page from the app's own modules — LEVELS ids, the
 * calendar, the chapter marks — so they are the game's idea of a save and not
 * this script's. Figures are the proved samples `make` returns.
 */
async function buildSaves(page) {
  return page.evaluate(
    async ({ TODAY, FAT, SHARE, JOURNEY }) => {
      const imp = window.__fwImport;
      const { LEVELS } = await imp('/src/data/levels.ts');
      const { shiftISO } = await imp('/src/core/CalendarDay.ts');
      const { dueMarks } = await imp('/src/core/Rewards.ts');
      const { missionsFor } = await imp('/src/core/Missions.ts');
      const { validateLevel } = await imp('/src/core/LevelValidator.ts');
      const { Playfield } = await imp('/src/core/Playfield.ts');
      const { CollisionSystem } = await imp('/src/core/CollisionSystem.ts');
      const { renderStroke } = await imp('/src/core/StrokeRecorder.ts');
      const { BASE_HEIGHT, BASE_WIDTH, METRICS } = await imp('/src/render/Theme.ts');
      const { ADS_MARKER } = await imp('/src/systems/adProvider.ts');

      const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
      const noon = new Date(`${TODAY}T12:00:00`).getTime();

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
        const res = validateLevel(level, pf, { cell: 4, hitRadius: plan, goalRadius: METRICS.goalRadius });
        if (!res.solvable || res.path.length < 3) return null;

        const raw = res.path.map((q, i) => ({
          x: q.x + Math.sin(i / 6) * wobble,
          y: q.y + Math.cos(i / 9) * wobble * 0.4,
        }));
        const times = raw.map((_, i) => Math.round((i / (raw.length - 1)) * ms));
        const walls = level.walls.map((w) => pf.toScreenRect(w));

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
        const collision = new CollisionSystem(walls, METRICS.hitRadius, pf.axisX);
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
            smoothing: gap,
            plan,
            figure: {
              levelId: level.id,
              levelName: level.name,
              points: pts.map((q) => pf.toNormalized(q)),
              times: ts,
              ms,
            },
          };
        }
        return null;
      };

      /*
       * Widest clearance first, because that is the line that survives smoothing
       * and looks most like a hand. Drop to tighter planning only when the maze
       * has no room for the generous route — never under hitRadius+5 — and drop
       * the wobble last.
       */
      const proved = (idx, ms, wob, at) => {
        const level = LEVELS[idx];
        for (const plan of FAT.map((d) => METRICS.hitRadius + d)) {
          for (const wobble of [wob, 0]) {
            const got = make(level, ms, wobble, plan);
            if (got) {
              return {
                note: `${level.id}: plan r=${plan.toFixed(1)} (hitRadius ${METRICS.hitRadius.toFixed(1)}), gap ${got.smoothing}, wobble ${wobble}`,
                figure: { ...got.figure, at, walls: level.walls, start: level.start, goal: level.goal },
              };
            }
          }
        }
        return { note: `${level.id}: REJECTED — no route proves at hitRadius+${FAT.join('/+')}`, figure: null };
      };

      /*
       * The best line ÷ par a player like this has left on each level — the
       * measurement the save keeps; the stars are derived from it (core/Stars:
       * ★★★ at or under 1.10, ★★ at or under 1.25). Mostly two and three
       * stars with a one-star level now and then: a player who cares about
       * the line, not one who has perfected every maze.
       */
      const RATIOS = [1.07, 1.19, 1.04, 1.09, 1.33, 1.08, 1.22, 1.05, 1.16, 1.09, 1.41, 1.06];
      /** A player `n` folds in, with the ledger and marks such a player has. */
      const player = (n, { streak = 0, doneToday = false } = {}) => {
        const cleared = LEVELS.slice(0, n).map((l) => l.id);
        const bestMs = {};
        cleared.forEach((id, k) => (bestMs[id] = 3800 + ((k * 937) % 7000)));
        const bestRatio = {};
        cleared.forEach((id, k) => (bestRatio[id] = RATIOS[(k * 7) % RATIOS.length]));
        const daily = {};
        for (let d = 0; d < streak; d++) {
          daily[shiftISO(TODAY, -((doneToday ? 0 : 1) + d))] = { ms: 31000 + d * 4100, deaths: d % 3, foldSense: 58 + (d % 17) };
        }
        return {
          version: 3,
          unlockedIndex: n,
          bestMs,
          cleared,
          // Never ∞ and never empty: a count any player might hold.
          reveals: 3,
          lastTopUp: TODAY,
          adsRemoved: false,
          totalWins: n + streak,
          winsSinceAd: 0,
          attemptsSinceAd: 0,
          ratePrompted: true,
          ratePromptedVersion: '1.4',
          figures: [],
          daily,
          medals: cleared.filter((id) => bestRatio[id] <= 1.25),
          bestRatio,
          // Taught the mirror long ago, and past the three labelled deaths.
          teachMirrorN: 3,
          foldSense: 71,
          sound: false,
          music: false,
          haptics: true,
          reducedMotion: false,
          capability: '',
          bookmarks: streak >= 3 ? 1 : 0,
          bookmarked: [],
          lastRepair: '',
          missions: null,
          chapterMarks: dueMarks(new Set(cleared), new Set()),
          starterBought: false,
          starterSeen: true,
          rewardedDay: '',
          rewardedToday: 0,
          grantedTx: [],
          taught: ['mirror', 'reveal'],
          reminders: false,
          nudgeAsks: 0,
          nudgeAskedOn: '',
          sessionMinutes: [1140, 1150, 1135, 1160, 1145, 1150, 1140],
          lastSeen: TODAY,
          playDays: 24,
        };
      };

      const notes = [];

      // Frames 1–3 and 7: level 48 is the frontier. Frame 2's save has never
      // seen a mirror death, so the game teaches it: the wall twice, and the
      // arc arrow over the fold labelled "your reflection".
      const at48 = player(47, { streak: 4 });
      const at48Fresh = { ...player(47, { streak: 4 }), taught: ['reveal'], teachMirrorN: 0 };

      // Frame 4: a six-day run ending yesterday; today's Daily makes it seven.
      const daily6 = player(62, { streak: 6 });

      // Share card and the missions sheet: about 62 cleared.
      const levels62 = player(62, { streak: 6, doneToday: true });

      /*
       * Frame 5: the chapter journey, three quarters through chapter III —
       * folds 41 to 55 made, 56 the frontier. Every made node shows the
       * player's own figure, so each of those is a proved figure too.
       */
      const journey = player(JOURNEY, { streak: 6, doneToday: true });
      const chapterStart = Math.floor((JOURNEY - 1) / 20) * 20;
      for (let idx = chapterStart; idx < JOURNEY; idx++) {
        const r = proved(idx, 6000 + ((idx * 613) % 5000), 1.4, noon - (JOURNEY - idx) * 86400000 / 2);
        notes.push(`journey ${r.note}`);
        if (r.figure) journey.figures.push(r.figure);
      }

      // Frame 8: the gallery — a spread of mazes, so the cards do not all read
      // the same, with plausible times. Wobble shrinks on the tighter levels.
      const picks = [
        [24, 8200, 2.2], [46, 7600, 2.0], [71, 6300, 1.8], [93, 5700, 1.6],
        [118, 9400, 1.4], [140, 8800, 1.4], [163, 7100, 1.2], [186, 6600, 1.2],
        [58, 7900, 1.8], [107, 8400, 1.4], [152, 6900, 1.2], [37, 10300, 2.0],
      ];
      const gallery = player(200, { streak: 6, doneToday: true });
      picks.forEach(([idx, ms, wob], k) => {
        const r = proved(idx, ms, wob, noon - (picks.length - k) * 86400000 / 3);
        notes.push(`gallery ${r.note}`);
        if (r.figure) gallery.figures.push(r.figure);
      });

      // Frame 6: the card a friend receives, 13.2 s — on a maze frames 1–3
      // and 7 do not already show.
      const share = proved(SHARE, 13200, 1.4, noon);
      notes.push(`share ${share.note}`);

      // Frame 9: the missions as they stand this afternoon — today's Daily
      // folded, two of three folds cleared, the two stars still to earn. The three
      // are the ones the game itself deals for this date and this player.
      const missionsSave = player(62, { streak: 7, doneToday: true });
      const dealt = missionsFor(TODAY, { clearedCount: 62, unclearedCount: LEVELS.length - 62 });
      missionsSave.missions = { ...dealt, progress: [1, 2, 0], paid: [true, false, false] };
      notes.push(`missions dealt for ${TODAY}: ${dealt.ids.join(', ')}`);

      return {
        marker: ADS_MARKER,
        hitRadius: METRICS.hitRadius,
        notes,
        saves: { at48, at48Fresh, daily6, levels62, journey, gallery, missionsSave },
        shareFigure: share.figure,
        galleryCount: gallery.figures.length,
        dealt: dealt.ids,
      };
    },
    { TODAY, FAT, SHARE, JOURNEY }
  );
}

/* ------------------------------------------------------------ the stroke */

/**
 * Plan a PROVED route through the level the Game scene is showing, and,
 * with `crash`, a real mirror death along it.
 *
 * 1. The validator's path, planned FAT (hitRadius+7, +6, +5, never tighter).
 * 2. Decimated, widest gap first, and the polyline must already be legal at
 *    the real hitRadius.
 * 3. Resampled into the exact pointer positions the driver will send: whole
 *    CSS pixels, mapped back through Phaser's own transform. Widest spacing
 *    first: every move costs the driver's handshake, and the game times the
 *    stroke, so a hundred and fifty moves on a busy machine put 40 s on the
 *    result card for a line a hand draws in ten.
 * 4. Proved by running GameScene's own move logic over those positions — its
 *    cursorFor, its CollisionSystem at the real hitRadius, its goal test, its
 *    StrokeRecorder: the stroke must reach the goal with no hit.
 * 5. The ink the game will draw from what it recorded (renderStroke) must not
 *    cross a wall at radius 1, on either half.
 */
async function planRoute(page, { crash = null } = {}) {
  const res = await page.evaluate(
    async ({ FAT, crash }) => {
      const imp = window.__fwImport;
      const { validateLevel } = await imp('/src/core/LevelValidator.ts');
      const { CollisionSystem } = await imp('/src/core/CollisionSystem.ts');
      const { StrokeRecorder, renderStroke } = await imp('/src/core/StrokeRecorder.ts');
      const { segCircleEntryT, segRect, dist } = await imp('/src/core/Geometry.ts');
      const { METRICS } = await imp('/src/render/Theme.ts');

      const g = window.game.scene.getScene('Game');
      if (!g || !g.sys.isActive()) throw new Error('planRoute: the Game scene is not running');
      if (g.phase !== 'idle') throw new Error(`planRoute: Game is ${g.phase}, not idle`);
      const { level, pf, collision, startPx, goalPx } = g;
      const walls = level.walls.map((w) => pf.toScreenRect(w));
      const ink = new CollisionSystem(walls, 1, pf.axisX);
      const sm = g.scale;
      const cb = sm.canvasBounds;
      const quant = (p) => {
        const css = {
          x: Math.round(cb.x + p.x / sm.displayScale.x),
          y: Math.round(cb.y + p.y / sm.displayScale.y),
        };
        return { css, base: { x: sm.transformX(css.x), y: sm.transformY(css.y) } };
      };

      // The game's own pointer -> ink mapping, on a copy of its state.
      const keep = { touchInput: g.touchInput, fingerTravel: g.fingerTravel, lastFinger: g.lastFinger };
      const cursorOf = (p) => g.cursorFor({ x: p.x, y: p.y, id: 1, wasTouch: false, event: { pointerType: 'mouse' } });

      const resample = (poly, step) => {
        const out = [poly[0]];
        let carry = 0;
        for (let i = 1; i < poly.length; i++) {
          const a = poly[i - 1];
          const c = poly[i];
          const len = dist(a, c);
          let t = step - carry;
          while (t < len) {
            out.push({ x: a.x + ((c.x - a.x) * t) / len, y: a.y + ((c.y - a.y) * t) / len });
            t += step;
          }
          carry = len - (t - step);
        }
        out.push(poly[poly.length - 1]);
        return out;
      };

      // Exactly GameScene.onPointerDown + onPointerMove, for one pointer path.
      const simulate = (base) => {
        if (dist(base[0], startPx) > METRICS.startRadius * METRICS.startGrabFactor) {
          return { ok: false, why: 'down misses the start dot' };
        }
        g.touchInput = false;
        g.fingerTravel = 0;
        g.lastFinger = { x: base[0].x, y: base[0].y };
        const rec = new StrokeRecorder(METRICS.sampleMinDist);
        rec.begin(startPx, 0);
        for (let k = 1; k < base.length; k++) {
          const prev = rec.last;
          const cur = cursorOf(base[k]);
          const goalT = segCircleEntryT(prev, cur, goalPx, METRICS.goalRadius);
          if (collision.blocks(prev, cur)) {
            const hit = collision.firstHit(prev, cur);
            if (goalT !== null && goalT < (hit?.t ?? 0)) return { ok: true, at: k, rec };
            return { ok: false, why: `hit at move ${k}${hit?.mirror ? ' (mirror)' : ''}`, at: k, hit, prev, cur, rec };
          }
          if (goalT !== null) return { ok: true, at: k, rec };
          rec.push(cur, k * 16);
        }
        return { ok: false, why: 'never reached the goal', rec };
      };
      const inkCrosses = (rec) => {
        const drawn = renderStroke(rec.points, rec.times, METRICS.renderMaxSpacing, METRICS.smoothIterations);
        return drawn.points.some((p, i) => i > 0 && ink.blocks(drawn.points[i - 1], p));
      };
      const uniq = (list) =>
        list.filter((f, i) => i === 0 || f.css.x !== list[i - 1].css.x || f.css.y !== list[i - 1].css.y);

      const hr = METRICS.hitRadius;
      const tried = [];
      let route = null;
      try {
        outer: for (const plan of FAT.map((d) => hr + d)) {
          const v = validateLevel(level, pf, { cell: 4, hitRadius: plan, goalRadius: METRICS.goalRadius });
          if (!v.solvable) {
            tried.push(`plan ${plan.toFixed(1)}: ${v.reason}`);
            continue;
          }
          for (const gap of [14, 11, 9, 7, 5]) {
            const pts = [startPx, v.path[0]];
            for (let i = 1; i < v.path.length - 1; i++) {
              if (dist(v.path[i], pts[pts.length - 1]) >= gap) pts.push(v.path[i]);
            }
            pts.push(v.path[v.path.length - 1]);
            if (pts.some((p, i) => i > 0 && collision.blocks(pts[i - 1], p))) {
              tried.push(`plan ${plan.toFixed(1)} gap ${gap}: polyline hits`);
              continue;
            }
            for (const step of [20, 14, 10, 7, 5]) {
              const moves = uniq(resample(pts, step).map(quant));
              const sim = simulate(moves.map((m) => m.base));
              if (!sim.ok) {
                tried.push(`plan ${plan.toFixed(1)} gap ${gap} step ${step}: ${sim.why}`);
                continue;
              }
              if (inkCrosses(sim.rec)) {
                tried.push(`plan ${plan.toFixed(1)} gap ${gap} step ${step}: ink crosses a wall at radius 1`);
                continue;
              }
              let len = 0;
              for (let i = 1; i < sim.rec.points.length; i++) len += dist(sim.rec.points[i - 1], sim.rec.points[i]);
              route = {
                plan,
                gap,
                step,
                moves: moves.slice(0, sim.at + 1),
                recorded: sim.rec.points.map((p) => ({ x: p.x, y: p.y })),
                lineLen: len,
                par: level.parPx ?? null,
              };
              break outer;
            }
          }
        }
        if (!route) return { ok: false, tried };
        const out = {
          ok: true,
          level: { id: level.id, name: level.name },
          hitRadius: hr,
          plan: route.plan,
          gap: route.gap,
          step: route.step,
          fingers: route.moves.map((m) => m.css),
          fingersBase: route.moves.map((m) => m.base),
          recorded: route.recorded,
          ratio: route.par ? route.lineLen / route.par : null,
        };
        if (!crash) return out;

        /*
         * A crash: the proved route's first `from` of its moves — ink the game
         * has already accepted — then one straight turn at `angle` (degrees,
         * 0 = right, -90 = up). Kept only if the game, run over it, dies on the
         * REFLECTION, that death is the stroke's first, and the player's own
         * line after the turn stays clear of every wall by a visible margin.
         */
        const tryCrash = (from, angle) => {
          const k = Math.max(1, Math.round(out.fingers.length * from));
          const head = route.moves.slice(0, k);
          const last = head[head.length - 1].base;
          const a = (angle * Math.PI) / 180;
          const tail = [];
          for (let d = 7; d < 520; d += 7) {
            const p = { x: last.x + Math.cos(a) * d, y: last.y + Math.sin(a) * d };
            if (p.x < pf.x + 4 || p.x > pf.axisX - 4 || p.y < pf.y + 4 || p.y > pf.bottom - 4) break;
            tail.push(quant(p));
          }
          const moves = uniq([...head, ...tail]);
          const sim = simulate(moves.map((m) => m.base));
          if (sim.ok || !sim.hit) return { ok: false, why: sim.ok ? 'reached the goal' : sim.why };
          if (!sim.hit.mirror) return { ok: false, why: 'the player\u2019s own line hit first' };
          if (sim.at < k) return { ok: false, why: 'died before the turn' };
          const contact = {
            x: sim.prev.x + (sim.cur.x - sim.prev.x) * sim.hit.t,
            y: sim.prev.y + (sim.cur.y - sim.prev.y) * sim.hit.t,
          };
          const after = [...sim.rec.points.slice(Math.max(0, k - 2)), contact];
          const margin = hr + 4;
          if (after.some((p, i) => i > 0 && walls.some((w) => segRect(after[i - 1], p, w, margin)))) {
            return { ok: false, why: `own line within ${margin.toFixed(1)} of a wall` };
          }
          let run = 0;
          for (let i = 1; i < after.length; i++) run += dist(after[i - 1], after[i]);
          return {
            ok: true,
            from,
            angle,
            fingers: moves.slice(0, sim.at + 1).map((m) => m.css),
            fingersBase: moves.slice(0, sim.at + 1).map((m) => m.base),
            turnAt: k,
            run,
            wall: sim.hit.wall,
            contact,
            mirrored: { x: 2 * pf.axisX - contact.x, y: contact.y },
          };
        };
        if (crash.scan) {
          const found = [];
          for (let from = 0.1; from <= 0.9; from += 0.04) {
            for (let angle = -180; angle < 180; angle += 10) {
              const c = tryCrash(from, angle);
              if (c.ok) {
                found.push({ from: +from.toFixed(2), angle, run: +c.run.toFixed(0), wall: c.wall, at: c.mirrored });
              }
            }
          }
          return { ...out, candidates: found };
        }
        return { ...out, crash: tryCrash(crash.from, crash.angle) };
      } finally {
        Object.assign(g, keep);
      }
    },
    { FAT, crash }
  );
  if (!res.ok) throw new Error(`planRoute: no proved route for this level\n  ${res.tried.join('\n  ')}`);
  return res;
}

/**
 * When each move goes out, in seconds from the press, for a hand at `speed`
 * base px a second — preview.mjs `schedule`. It leaves the dot at half speed
 * and is up to speed by 0.4 s, and it slows by up to 40% into a bend.
 */
function schedule(base, speed) {
  const heading = (p, q) => Math.atan2(q.y - p.y, q.x - p.x);
  const at = [0];
  let t = 0;
  for (let i = 1; i < base.length; i++) {
    const d = Math.hypot(base[i].x - base[i - 1].x, base[i].y - base[i - 1].y);
    const p0 = base[Math.max(0, i - 3)];
    const p1 = base[i - 1];
    const p2 = base[Math.min(base.length - 1, i + 1)];
    let bend = 0;
    if (p0 !== p1 && p1 !== p2) {
      let da = Math.abs(heading(p1, p2) - heading(p0, p1));
      if (da > Math.PI) da = 2 * Math.PI - da;
      bend = Math.min(1, da / (Math.PI / 2));
    }
    const ramp = Math.min(1, 0.5 + t * 1.25);
    t += d / (speed * ramp * (1 - 0.4 * bend));
    at.push(t);
  }
  return at;
}

/** The hand speed (base px a second) at which `schedule` takes `seconds` over `base`, and its schedule. */
function paced(base, seconds) {
  let lo = 20;
  let hi = 5000;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    const at = schedule(base, mid);
    if (at[at.length - 1] > seconds) lo = mid;
    else hi = mid;
  }
  return { speed: hi, at: schedule(base, hi) };
}

/** How long a hand takes over level 48's route, and over the Daily's (`paced`). */
const SOLVE_SECONDS = Number(process.env.FW_SOLVE_SECONDS ?? 6.4);
const DAILY_SECONDS = Number(process.env.FW_DAILY_SECONDS ?? 8.6);
const paceLine = (p) => `paced at ${p.speed.toFixed(0)} base px/s (${p.at[p.at.length - 1].toFixed(1)} s planned)`;

/**
 * Send planned positions as real mouse input, one event per PROCESSED move:
 * after each, wait until a Phaser pointer reports exactly that position, so
 * the browser can never coalesce two moves into one the proof never checked.
 * `until` stops early — at a phase, or after a number of moves — and
 * `release: false` leaves the button down (a stroke caught mid-draw).
 *
 * `pace` is a hand's timing for the WHOLE route (`paced`): no move goes out
 * before its time, so a fast machine does not draw a 0.8 s line no hand could
 * — the result card prints the time the game measured, and the ribbon's
 * width is read off it. The handshake can only make a move later, never
 * earlier; `steady` and the check at the end catch a clock that stalled.
 */
async function drive(page, fingers, fingersBase, { release = true, stopAt = fingers.length, untilPhase = null, pace = null } = {}) {
  const seen = (i) =>
    page.waitForFunction(
      ([x, y]) => window.game.input.pointers.some((p) => Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01),
      [fingersBase[i].x, fingersBase[i].y],
      { polling: 'raf', timeout: 15000 }
    );
  const phase = () => page.evaluate(() => window.game.scene.getScene('Game').phase);
  const fps = await steady(page);
  await page.mouse.move(fingers[0].x, fingers[0].y);
  await seen(0);
  const w0 = await page.evaluate(() => performance.now());
  await page.mouse.down();
  await seen(0);
  if ((await phase()) !== 'drawing') {
    await page.mouse.up();
    throw new Error('drive: the stroke did not start — something else owns the screen');
  }
  const t0 = Date.now();
  for (let i = 1; i < stopAt; i++) {
    if (pace) {
      const wait = t0 + pace[i] * 1000 - Date.now();
      if (wait > 1) await new Promise((r) => setTimeout(r, wait));
    }
    await page.mouse.move(fingers[i].x, fingers[i].y);
    await seen(i);
    if (untilPhase && (await phase()) === untilPhase) break;
  }
  const w1 = await page.evaluate(() => performance.now());
  const span = await page.evaluate(() => {
    const t = window.game.scene.getScene('Game').recorder.times;
    return t[t.length - 1] - t[0];
  });
  if (release) await page.mouse.up();
  // The game timed the stroke off a frame clock that stalled: see `steady`.
  if (span < 0.85 * (w1 - w0) - 600) {
    throw new Error(`drive: the game timed a ${((w1 - w0) / 1000).toFixed(1)} s stroke at ${(span / 1000).toFixed(1)} s — its frame clock stalled; rerun on a quieter machine`);
  }
  return { fps, span, wall: w1 - w0 };
}

/**
 * Wait until the game loop draws at a real frame rate. The game stamps a
 * stroke with its own frame clock whenever an event's timestamp strays a
 * second from it (GameScene.inputTime), so on a machine too loaded to draw
 * frames a ten-second stroke is recorded as a one-second one: the card then
 * says "0.8 s", and the ribbon, which reads its width off those stamps, thins
 * to a hair. Neither is anything a player would see.
 */
async function steady(page, { fps = 40, tries = 40 } = {}) {
  let rate = 0;
  for (let k = 0; k < tries; k++) {
    rate = await page.evaluate(
      () =>
        new Promise((done) => {
          const f0 = window.game.loop.frame;
          const t0 = performance.now();
          setTimeout(() => done(((window.game.loop.frame - f0) * 1000) / (performance.now() - t0)), 1000);
        })
    );
    if (rate >= fps) return rate;
    console.log(`  waiting: the game loop draws ${rate.toFixed(0)} fps, under ${fps}`);
    await page.waitForTimeout(15000);
  }
  throw new Error(`steady: the game loop never reached ${fps} fps (last ${rate.toFixed(0)})`);
}

const timing = (t) => `the game timed the stroke at ${(t.span / 1000).toFixed(1)} s (wall ${(t.wall / 1000).toFixed(1)} s, loop at ${t.fps.toFixed(0)} fps)`;

/** What the game recorded against what the proof recorded — 0 when faithful. */
const drift = (page, want) =>
  page.evaluate((want) => {
    const got = window.game.scene.getScene('Game').recorder.points;
    let worst = 0;
    for (let i = 0; i < Math.min(want.length, got.length); i++) {
      worst = Math.max(worst, Math.hypot(got[i].x - want[i].x, got[i].y - want[i].y));
    }
    return { worst, got: got.length, want: want.length };
  }, want);

const idle = (page) =>
  page
    .waitForFunction(
      () => {
        const g = window.game.scene.getScene('Game');
        return g && g.sys.isActive() && g.phase === 'idle' && !!g.level;
      },
      null,
      { timeout: 45000 }
    )
    .then(() => page.waitForTimeout(700));

const phaseOf = (page) => page.evaluate(() => window.game.scene.getScene('Game').phase);

/** What the Game scene and the save say now — the proof log's second witness. */
const gameSays = (page) =>
  page.evaluate(async () => {
    const g = window.game.scene.getScene('Game');
    const { Progress } = await window.__fwImport('/src/systems/Progress.ts');
    const { todayISO } = await window.__fwImport('/src/core/CalendarDay.ts');
    const d = Progress.data;
    return {
      phase: g.phase,
      attempts: g.attempts,
      mirrorDeaths: g.mirrorDeaths,
      totalDeaths: g.totalDeaths,
      hint: g.hintText?.visible && g.hintText.alpha > 0 ? g.hintText.text : null,
      arrow: g.ink.arrowRects().length > 0,
      revealUp: g.time.now < g.revealHoldUntil,
      teachMirrorN: d.teachMirrorN,
      reveals: d.reveals,
      adsRemoved: d.adsRemoved,
      medal: g.winMedal,
      stars: g.winStars,
      ratio: g.winRatio,
      streak: Progress.dailyStreak(todayISO()),
    };
  });

/* ----------------------------------------------------------------- frames */

// The crash for frames 2 and 7, chosen by eye from the candidates `crashes`
// prints: the route's own first stretch, then a turn the reflection cannot take.
const CRASH = { from: Number(process.env.FW_CRASH_FROM ?? 0.38), angle: Number(process.env.FW_CRASH_ANGLE ?? -110) };

const proof = {};
const log = (id, line) => {
  console.log(`  ${line}`);
  (proof[id] ??= []).push(line);
};
const routeLine = (r) =>
  `route ${r.level.id} "${r.level.name}": planned at r=${r.plan.toFixed(1)} (hitRadius ${r.hitRadius.toFixed(1)} +${(r.plan - r.hitRadius).toFixed(1)}), gap ${r.gap}, step ${r.step}, ${r.fingers.length} moves; proved event by event at r=${r.hitRadius.toFixed(1)}, ink clear at r=1`;

const seeder = await open(null, { settle: 1500, menu: false });
const built = await buildSaves(seeder.page);
await seeder.ctx.close();
if (built.marker !== 'ADS:off') {
  console.log(`REFUSED: the server on ${GAME} is ${built.marker}, not ADS:off — store media never come from an ad build`);
  await b.close();
  process.exit(1);
}
console.log(`server ${GAME} is ${built.marker}; hitRadius ${built.hitRadius.toFixed(2)}`);
for (const n of built.notes) console.log(`  ${n}`);
if (built.galleryCount < 12) {
  console.log('not enough clean gallery runs — aborting');
  await b.close();
  process.exit(1);
}
const S = built.saves;

async function level48(save) {
  const s = await open(save);
  await go(s.page, 'Game', { levelIndex: 47, from: 'LevelSelect' }, 200);
  await idle(s.page);
  return s;
}

// `node capture.mjs crashes`: every turn off level 48's route that dies on the
// reflection alone, to choose CRASH from.
if (want.includes('crashes')) {
  const s = await level48(S.at48Fresh);
  const r = await planRoute(s.page, { crash: { scan: true } });
  console.log(routeLine(r));
  for (const c of r.candidates) {
    console.log(`  from ${c.from} angle ${c.angle}: run ${c.run}px, reflection hits wall ${c.wall} at (${c.at.x.toFixed(0)}, ${c.at.y.toFixed(0)})`);
  }
  await s.ctx.close();
}

// 1 — mid-stroke, attempt 1: the ink 60% along the proved route, the button still down.
if (wanted('01')) {
  console.log('01 one line, two mazes');
  const s = await level48(S.at48);
  const r = await planRoute(s.page);
  log('01', routeLine(r));
  const stop = Math.round(r.fingers.length * Number(process.env.FW_DRAW_AT ?? 0.6));
  const p = paced(r.fingersBase, SOLVE_SECONDS);
  const t = await drive(s.page, r.fingers, r.fingersBase, { release: false, stopAt: stop, pace: p.at });
  const d = await drift(s.page, r.recorded);
  log('01', `drove ${stop}/${r.fingers.length} moves, ${paceLine(p)}, button held; recorded ${d.got} samples, worst drift from the proof ${d.worst.toFixed(4)}; phase ${await phaseOf(s.page)}; ${timing(t)}`);
  await s.page.waitForTimeout(250);
  await shot(s.page, '01-level48-drawing');
  await s.page.mouse.up();
  await s.ctx.close();
}

// 2 — the first mirror death of a save: the reflection hits, the game teaches it.
if (wanted('02')) {
  console.log('02 dodge walls you can’t see');
  const s = await level48(S.at48Fresh);
  const r = await planRoute(s.page, { crash: CRASH });
  log('02', routeLine(r));
  if (!r.crash.ok) throw new Error(`02: the crash at ${JSON.stringify(CRASH)} does not hold: ${r.crash.why}`);
  log('02', `crash: the route's first ${r.crash.turnAt} moves, then a turn at ${CRASH.angle}°; simulated: the reflection hits wall ${r.crash.wall} at (${r.crash.mirrored.x.toFixed(0)}, ${r.crash.mirrored.y.toFixed(0)}), own line clear by > hitRadius+4`);
  /*
   * Two moments of the same death: the flash itself (the red stroke, the
   * splat at the reflection's contact, the struck wall hot, the dashed arc
   * over the fold labelled "your reflection"), and the ghost that follows it
   * (the × at both ends, the arc still up) — compose.py uses the flash.
   */
  const marks = [['02a-level48-mirror-crash', Number(process.env.FW_CRASH_AT ?? 260)], ['02b-level48-mirror-crash-ghost', 640]];
  await freezeAt(s.page, 'failed', marks.map(([, at]) => at));
  // The hand that solves it, at the same speed, until the turn.
  const speed = paced(r.fingersBase, SOLVE_SECONDS).speed;
  const t = await drive(s.page, r.crash.fingers, r.crash.fingersBase, { untilPhase: 'failed', release: false, pace: schedule(r.crash.fingersBase, speed) });
  log('02', `paced at ${speed.toFixed(0)} base px/s; ${timing(t)}`);
  for (const [i, [name]] of marks.entries()) {
    const froze = await frozen(s.page, i);
    const g = await gameSays(s.page);
    if (g.mirrorDeaths !== 1 || g.totalDeaths !== 1) throw new Error(`02: expected one mirror death, the game counts ${g.mirrorDeaths} of ${g.totalDeaths}`);
    if (!g.arrow) throw new Error(`02: ${name} has no arc arrow over the fold`);
    log('02', `${name}: frozen ${froze.toFixed(0)} ms (game time) after the death; the game says phase ${g.phase}, attempt ${g.attempts}, deaths ${g.totalDeaths} (mirror ${g.mirrorDeaths}), arc arrow up (labelled deaths so far ${g.teachMirrorN}), reveals ${g.reveals}`);
    await s.page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`  ${name}.png`);
    await s.page.evaluate(() => window.game.loop.wake());
  }
  await s.page.mouse.up();
  await s.ctx.close();
}

// 3 — the win: the bloom, the board stepped back, the result card's three stars and the next fold.
if (wanted('03')) {
  console.log('03 clear both, earn three stars');
  const s = await level48(S.at48);
  const r = await planRoute(s.page);
  log('03', routeLine(r));
  log('03', `line/par ${r.ratio?.toFixed(3)} (★★ at 1.25, ★★★ at 1.10)`);
  const p = paced(r.fingersBase, SOLVE_SECONDS);
  log('03', paceLine(p));
  const t = await drive(s.page, r.fingers, r.fingersBase, { pace: p.at });
  await s.page.waitForFunction(() => window.game.scene.getScene('Game').phase === 'won', null, { timeout: 15000 });
  const d = await drift(s.page, r.recorded);
  const g = await gameSays(s.page);
  log('03', `phase ${g.phase}; recorded ${d.got} samples, worst drift ${d.worst.toFixed(4)}; the game scores line/par ${g.ratio?.toFixed(3)}, stars ${g.stars}; reveals ${g.reveals}; ${timing(t)}`);
  if (g.stars !== 3) throw new Error(`03: the game gave ${g.stars} stars, not three`);
  await s.page.waitForTimeout(3400);
  await shot(s.page, '03-level48-won');
  await s.ctx.close();
}

// 4 — the Daily, day seven: the streak flips 6 -> 7 on the card.
if (wanted('04')) {
  console.log('04 a daily maze for everyone');
  const s = await open(S.daily6);
  /*
   * The card an iPhone signed in to Game Center draws: [Leaderboard] [Share]
   * [Done]. On the web `available` is false and the button is left out; set
   * here, it only picks the card's row. Nothing is submitted — every Game
   * Center call also needs `authed`, which is never set in a browser.
   */
  await s.page.evaluate(async () => {
    const { GameCenter } = await window.__fwImport('/src/systems/GameCenter.ts');
    Object.defineProperty(GameCenter, 'available', { get: () => true, configurable: true });
  });
  await go(s.page, 'Game', { daily: TODAY }, 200);
  await idle(s.page);
  const r = await planRoute(s.page);
  log('04', routeLine(r));
  await s.page.waitForTimeout(2200);
  const p = paced(r.fingersBase, DAILY_SECONDS);
  log('04', paceLine(p));
  const t = await drive(s.page, r.fingers, r.fingersBase, { pace: p.at });
  await s.page.waitForFunction(() => window.game.scene.getScene('Game').phase === 'won', null, { timeout: 15000 });
  const d = await drift(s.page, r.recorded);
  const g = await gameSays(s.page);
  log('04', `phase ${g.phase}; recorded ${d.got} samples, worst drift ${d.worst.toFixed(4)}; streak 6 -> ${g.streak}; reveals ${g.reveals}; ${timing(t)}`);
  await s.page.waitForTimeout(3600);
  await shot(s.page, '04-daily-result');
  await s.ctx.close();
}

// 5 — Levels: the chapter journey, opened from the Menu the way a player
// opens it, on the frontier's chapter. It opens with the frontier at the
// window's foot and a row of stars and numbers cut under the chapter card; a
// real drag of FW_LEVELS_LIFT points (held still before the finger lifts, so
// the path lets go without a glide) takes that row under the card and brings
// up the chapter's +2 gift below the frontier.
if (wanted('05')) {
  console.log('05 300 mazes, no lives');
  const s = await open(S.journey);
  await go(s.page, 'LevelSelect', {}, 2200);
  const lift = Number(process.env.FW_LEVELS_LIFT ?? 50);
  if (lift !== 0) {
    const m = s.page.mouse;
    const x = 201;
    const y0 = 600;
    await m.move(x, y0);
    await m.down();
    for (let k = 1; k <= 12; k++) await m.move(x, y0 - (lift * k) / 12);
    for (let k = 1; k <= 16; k++) await m.move(x + (k % 2), y0 - lift);
    await m.up();
    await s.page.waitForTimeout(900);
  }
  const seen = await s.page.evaluate(async () => {
    const { Progress } = await window.__fwImport('/src/systems/Progress.ts');
    return { cleared: Progress.data.cleared.length, stars: Progress.totalStars(), figures: Progress.data.figures.length, reveals: Progress.data.reveals };
  });
  log('05', `${seen.cleared} folds made, ${seen.stars} stars, ${seen.figures} proved figures on the path; the path dragged ${lift} pt by hand; reveals ${seen.reveals}`);
  await shot(s.page, '05-levels');
  await s.ctx.close();
}

// 6 — the share card: the real renderer, on a proved figure.
if (wanted('06')) {
  console.log('06 send the run');
  if (!built.shareFigure) throw new Error('06: no proved figure for the share card');
  const s = await open(S.levels62, { settle: 600 });
  const url = await s.page.evaluate(async (fig) => {
    const { renderShareCard, shareCardOptions } = await window.__fwImport('/src/render/ShareCard.ts');
    return renderShareCard(fig, shareCardOptions(fig));
  }, built.shareFigure);
  writeFileSync(`${OUT}/06-sharecard.png`, Buffer.from(url.split(',')[1], 'base64'));
  log('06', `renderShareCard(${built.shareFigure.levelId}, ${built.shareFigure.ms} ms) -> 06-sharecard.png`);
  console.log('  06-sharecard.png');
  await s.ctx.close();
}

// 7 — Reveal over the ghost of the last try, spent from the free balance.
if (wanted('07')) {
  console.log('07 stuck? see both mazes');
  const s = await level48(S.at48);
  const r = await planRoute(s.page, { crash: CRASH });
  log('07', routeLine(r));
  if (!r.crash.ok) throw new Error(`07: the crash does not hold: ${r.crash.why}`);
  const speed = paced(r.fingersBase, SOLVE_SECONDS).speed;
  const t = await drive(s.page, r.crash.fingers, r.crash.fingersBase, { untilPhase: 'failed', release: false, pace: schedule(r.crash.fingersBase, speed) });
  log('07', `paced at ${speed.toFixed(0)} base px/s; ${timing(t)}`);
  await s.page.mouse.up();
  await idle(s.page);
  const died = await gameSays(s.page);
  if (died.mirrorDeaths !== 1) throw new Error(`07: expected a mirror death, the game counts ${died.mirrorDeaths}`);
  // Let the death's arc arrow fade on its own (about 2.4 s), so the frame is
  // the folded walls over the ghost of the try, and nothing else.
  await s.page.waitForFunction(() => window.game.scene.getScene('Game').ink.arrowRects().length === 0, null, { polling: 100, timeout: 10000 });
  await s.page.waitForTimeout(400);
  await tap(s.page, 'Game', (g) => g.revealPill);
  await s.page.waitForTimeout(520);
  const g = await gameSays(s.page);
  if (!g.revealUp || g.arrow) throw new Error(`07: expected the folded walls up and the arc arrow gone (reveal ${g.revealUp}, arrow ${g.arrow})`);
  log('07', `the frame-2 crash, taken for real (deaths ${died.totalDeaths}, mirror ${died.mirrorDeaths}); its arc arrow left to fade; then a tap on the Reveal pill: the folded walls up, reveals ${died.reveals} -> ${g.reveals}, adsRemoved ${g.adsRemoved}`);
  await shot(s.page, '07-level48-reveal');
  await s.ctx.close();
}

// 8 — the gallery: twelve proved figures, three rows and the fourth under the list's fade.
if (wanted('08')) {
  console.log('08 each win, a new figure');
  const s = await open(S.gallery);
  await go(s.page, 'Gallery', {}, 1800);
  log('08', `${built.galleryCount} proved figures seeded`);
  await shot(s.page, '08-gallery');
  await s.ctx.close();
}

// 9 — the Menu with today's three in its top strip, and the Missions sheet a tap on it opens.
if (wanted('09')) {
  console.log('09 three goals, every day');
  const s = await open(S.missionsSave, { settle: 2600 });
  // The Menu as it opens — the strip of today's three at its top — and then
  // the sheet a tap on that strip opens; compose.py uses one.
  await shot(s.page, '09m-menu');
  await tap(s.page, 'Menu', (m) => m.children.list.find((o) => o.name === 'mission-strip'));
  await s.page.waitForTimeout(1200);
  const m = await s.page.evaluate(async () => {
    const { Progress } = await window.__fwImport('/src/systems/Progress.ts');
    const t = Progress.missionsToday();
    return { ids: t.ids, progress: t.progress, paid: t.paid, reveals: Progress.data.reveals, sheet: !!window.game.scene.getScene('Menu').sheet };
  });
  log('09', `missions for ${TODAY} as the game deals them: ${m.ids.join(', ')}; progress ${m.progress.join('/')}, paid ${m.paid.join('/')}; the Menu's strip (09m-menu), then a tap on it: sheet open ${m.sheet} (09-missions); reveals ${m.reveals}`);
  await shot(s.page, '09-missions');
  await s.ctx.close();
}

// A partial run keeps the other frames' proof: it replaces only what it captured.
let earlier = {};
if (want.length > 0 && existsSync(`${OUT}/proof.json`)) {
  try {
    earlier = JSON.parse(readFileSync(`${OUT}/proof.json`, 'utf8')).frames ?? {};
  } catch {}
}
writeFileSync(
  `${OUT}/proof.json`,
  JSON.stringify(
    { server: GAME, marker: built.marker, clock: CLOCK, view: { ...VIEW, dpr: DPR, safe: SAFE }, notes: built.notes, frames: { ...earlier, ...proof } },
    null,
    2
  )
);
await b.close();
console.log('done');
