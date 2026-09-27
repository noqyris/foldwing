/*
 * App Preview, 1.4 — the film at the top of the listing, recorded from the
 * running game (the Night Fold look) and cut to the storyboard:
 *
 *    0.0 -  2.5  "One line. / Two mazes."       a stroke in flight: the line and its mirror
 *    2.5 -  4.8  "Dodge walls / you can't see"  a real mirror death (2.7), the arc arrow over the fold
 *    4.8 -  7.5  "Stuck? See / both mazes."     a tap on Reveal (5.1)
 *    7.5 - 11.3  "Mind your / reflection."      the proved route, at a hand's pace
 *   11.3 - 14.6  "Clear both. / Earn ★★★"       the bloom, three stars, the result card
 *   14.6 - 19.7  "A daily maze / for everyone." the Menu, the Daily (at 2x), the streak flipping 6 -> 7
 *   19.7 - 23.5  "300 mazes. / No lives."       the Levels journey arriving, scrolled back to fold 41
 *
 * (The cut is anchored on what the game logged, so a retake moves these by a
 * few hundredths; the poster frame is 2.0 s, mid-stroke.)
 *
 * capture.mjs's sibling, under its rules, because a preview makes the
 * screenshots' promise in motion and can break it the same ways — and one
 * more: a line animated frame by frame looks exactly like one that was played.
 *
 *   - Every WINNING line is the validator's proved route, planned FAT
 *     (hitRadius+7, +6, +5, never tighter), run through GameScene's own
 *     cursorFor, collision, goal test and StrokeRecorder before a single event
 *     is sent, and its ink checked at radius 1 — capture.mjs `planRoute`.
 *     Driven as real input, and then held to it: the samples the game
 *     recorded must be the proof's, one for one, or the take is recorded
 *     again (see `drive`). The three stars are the game's own score of that
 *     line (Stars.lineRatio against the level's par): the widest plan whose
 *     line the game will score at ★★★ is taken, never a tighter one than +5.
 *   - The crash is a real collision: the proved route's own first stretch,
 *     then a turn the game must kill on the REFLECTION. Simulated first, then
 *     driven until the game itself reports the death.
 *   - The Levels journey shows figures the save holds — each the validator's
 *     proved route, `playable` at the real hitRadius and its card line clear
 *     at radius 1 (capture.mjs `make`) — and each node's stars are that
 *     figure's own line over par, so the stars on the page are the lines on it.
 *   - The film is RECORDED, not drawn: Chrome's screencast of the game playing
 *     in real time, each frame stamped with the moment it was composited. The
 *     edit only chooses which stretches of those takes are shown and how fast
 *     (a 0.5x at the impact, the Daily's stroke at 2x), and lays the captions
 *     on the band above the picture.
 *
 * THE FRAME. The whole phone page, 430x932 pt, is the 886x1920 film (both
 * 9:19.5). The game's canvas is placed inside a safe area (the dev build's
 * `?safe=t,r,b,l`) that starts under the caption band, so the band covers
 * only the page's own sky — the same night the canvas paints, seamlessly
 * (render/Paper) — and nothing of the game is ever under a caption. The side
 * insets keep the world as tall as a modern iPhone's (about 1420 of 750), so
 * every screen is laid out as the tall adaptive canvas lays it out on a phone.
 *
 * THE SOUND is the game's own, but not recorded live: every sound the game
 * asks for during a take (the pen on the paper, a note per obstacle row, the
 * thud and the tear, the stars, the streak) is logged with its moment,
 * carried through the same cut as the picture, and rendered offline through
 * the game's own voices on an OfflineAudioContext over the generated music
 * bed. It must also work muted: the App Store autoplays previews silently, so
 * the captions carry the story.
 *
 * PREREQUISITES (none is a project dependency):
 *
 *   1. an ADS-OFF dev server — never `dev:mock`, whose fake ads must not reach
 *      store media, and never an ADS:on one. The script refuses anything else.
 *        VITE_ADS=off VITE_AD_MODE=test npx vite --port 5200 --strictPort
 *      FW_PORT names another port.
 *   2. playwright with Chrome (FW_PLAYWRIGHT=/path/to/playwright/index.mjs).
 *   3. ffmpeg and ffprobe with libx264 (FW_FFMPEG, FW_FFPROBE).
 *
 * Then, from this directory:
 *
 *   node preview.mjs              # the three takes, then the cut
 *   node preview.mjs takes a      # re-record one take (a = level 48, b = the Daily, c = Levels)
 *   node preview.mjs cut          # re-cut from the recorded takes
 *   node preview.mjs crashes      # the turns off level 48's route that die on the reflection
 *   node preview.mjs probe        # stills of the frame, to check the layout
 *
 * Takes are large (JPEG frames at 860x1864, 50-60 a second) and live outside
 * the repo in FW_PREVIEW_WORK (default: $TMPDIR/foldwing-preview-1.4). The
 * film, its poster frame, a strip of check frames and proof.json land in
 * store/preview/1.4/.
 *
 * Headed Chrome is not a preference: headless falls back to SwiftShader and
 * the canvas comes out blank. Keep its window unoccluded — macOS throttles a
 * hidden one, and a starved game loop times strokes wrong (see `steady`).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { chromium } = await import(process.env.FW_PLAYWRIGHT ?? 'playwright');

const OUT = new URL('../../store/preview/1.4/', import.meta.url).pathname;
const WORK = process.env.FW_PREVIEW_WORK ?? join(tmpdir(), 'foldwing-preview-1.4');
const GAME = `http://localhost:${process.env.FW_PORT ?? '5200'}/`;
const KEY = 'CapacitorStorage.foldwing.save.v1';
const FFMPEG = process.env.FW_FFMPEG ?? 'ffmpeg';
const FFPROBE = process.env.FW_FFPROBE ?? 'ffprobe';
mkdirSync(OUT, { recursive: true });
mkdirSync(WORK, { recursive: true });

// One calendar day for every take: the Daily, the streak and the missions are
// functions of the date. Only the calendar is moved; timers and animation stay real.
const TODAY = '2026-09-27';
const CLOCK = `${TODAY}T12:00:00+02:00`;
const ZONE = 'Europe/Belgrade';

/** How much wider than hitRadius a route is planned, widest first. Never below +5. */
const FAT = [7, 6, 5];
/**
 * Resample steps for a driven route, in base px, 10 first. The film shows the
 * ink growing, and at 20 px a move the tip visibly jumps.
 */
const STEPS = [10, 7, 14, 20, 5];

/*
 * The film: Apple's portrait size for the 6.5"/6.9" slots, 30 fps. The page
 * is 430x932 pt, the film 886x1920: one scale (2.0605 px a point), no crop.
 */
const W = 886;
const H = 1920;
const FPS = 30;
const VW = 430;
const VH = 932;
const DPR = 2;
const RAW_W = VW * DPR;
const RAW_H = VH * DPR;
/** The caption band: solid to BAND, then fading into the page's sky over FADE. */
const BAND = 334;
const FADE = 60;
const CAPTION_PX = 100;
/**
 * The safe area the canvas is fitted into, in points (t, r, b, l): under the
 * band and its fade, and narrow enough that the world is as tall as an
 * iPhone's (750 x ~1420; see Theme.adaptiveHeight).
 */
const SAFE = { top: 194, right: 23, bottom: 12, left: 23 };
const SKY_EDGE = '#081419';
const CREAM = '#F4EDE1';
const GOLD = { hi: '#FBE3A0', mid: '#E2B040', lo: '#B7851C' };

/** The captions, each at most two lines of 13 characters; ★ is drawn as the game's gold star. */
const CAPTIONS = {
  hook: ['One line.', 'Two mazes.'],
  twist: ['Dodge walls', 'you can’t see'],
  reveal: ['Stuck? See', 'both mazes.'],
  solve: ['Mind your', 'reflection.'],
  bloom: ['Clear both.', 'Earn ★★★'],
  daily: ['A daily maze', 'for everyone.'],
  levels: ['300 mazes.', 'No lives.'],
};

// The level-48 crash: the route's own first half, then a turn up and left,
// toward the goal, that sends the reflection up and right into a wall the
// player cannot see. Chosen from `node preview.mjs crashes`.
const CRASH = { from: Number(process.env.FW_CRASH_FROM ?? 0.5), angle: Number(process.env.FW_CRASH_ANGLE ?? -150) };

const args = process.argv.slice(2);
const cmd = args[0] ?? 'all';
const takesWanted = cmd === 'takes' ? (args.length > 1 ? args.slice(1) : ['a', 'b', 'c']) : cmd === 'all' ? ['a', 'b', 'c'] : [];

const b = await chromium.launch({
  headless: false,
  channel: 'chrome',
  args: [`--window-position=${process.env.FW_WINDOW_X ?? 490},-1400`],
});

/* ------------------------------------------------------------------ pages */

/** A fresh context per take, its save seeded before any app code runs (see capture.mjs `open`). */
async function open(save, { settle = 1200, menu = true } = {}) {
  const ctx = await b.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: DPR,
    hasTouch: true,
    isMobile: true,
    timezoneId: ZONE,
  });
  await ctx.addInitScript(appImport);
  await ctx.addInitScript(quietHmr);
  await ctx.addInitScript(eventLog);
  await ctx.addInitScript(shiftClock, new Date(CLOCK).getTime());
  await ctx.addInitScript(
    ([k, v, day]) => {
      try {
        if (v) localStorage.setItem(k, v);
        // The logo has drawn itself in today already: a take never opens on half a logo.
        localStorage.setItem('foldwing.logoDay', day);
      } catch {}
    },
    [KEY, save ? JSON.stringify(save) : null, TODAY]
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  THROW', e.message));
  await page.goto(`${GAME}?safe=${SAFE.top},${SAFE.right},${SAFE.bottom},${SAFE.left}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => !!window.game, null, { timeout: 180000 });
  if (menu) {
    await skipIntro(page);
    await page.waitForFunction(() => window.game.scene.isActive('Menu'), null, { timeout: 180000 });
    await watch(page);
  }
  await page.waitForTimeout(settle);
  return { ctx, page };
}

/** `__fwImport(path)`: the APP'S instance of a module (see capture.mjs). */
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

/** Other sessions edit this tree; a hot reload mid-take would tear the scene down. */
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

/**
 * The take's log, on the clock the screencast stamps its frames with: wall
 * time in seconds, from `performance.timeOrigin`, which the shifted calendar
 * does not touch. Every press, move and lift is in it; `watch` adds the
 * game's phases and the sounds it asks for.
 */
function eventLog() {
  window.__fwEv = [];
  const now = () => (performance.timeOrigin + performance.now()) / 1000;
  window.__fwMark = (name, data = {}) => window.__fwEv.push({ name, t: now(), ...data });
  for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
    addEventListener(type, (e) => window.__fwMark(type, { x: e.clientX, y: e.clientY }), { capture: true, passive: true });
  }
}

/**
 * Log what the edit and the soundtrack need from the game itself: every change
 * of running scenes or of the Game's phase, at the frame it is drawn, and
 * every sound the game asks `Audio` (and the music its duck) for — with sound
 * off in the save, so the machine stays quiet. The calls are logged whether
 * or not the service can play them.
 */
async function watch(page) {
  await page.evaluate(async () => {
    const { Audio } = await window.__fwImport('/src/systems/Audio.ts');
    const { Music } = await window.__fwImport('/src/systems/Music.ts');
    const hook = (obj, k, note) => {
      const real = obj[k].bind(obj);
      obj[k] = (...a) => {
        note(...a);
        return real(...a);
      };
    };
    hook(Audio, 'rowNote', (k) => window.__fwMark('sound', { kind: 'note', step: Math.max(0, Math.floor(k)) }));
    hook(Audio, 'ting', (k) => window.__fwMark('sound', { kind: 'ting', step: Math.max(0, Math.floor(k ?? Audio.step - 1)) }));
    hook(Audio, 'starNote', (i) => window.__fwMark('sound', { kind: 'star', i }));
    hook(Audio, 'celebrate', (medal) => window.__fwMark('sound', { kind: 'celebrate', medal: !!medal }));
    for (const k of ['thud', 'tear', 'tock', 'pop', 'reward', 'streakUp', 'penStart', 'penStop']) {
      hook(Audio, k, () => window.__fwMark('sound', { kind: k }));
    }
    hook(Audio, 'penSpeed', (v) => window.__fwMark('pen', { v }));
    hook(Music, 'duck', (on) => window.__fwMark('duck', { on: !!on }));
    // The game loop's own frame count, ten times a second: how smoothly the
    // game itself ran, which the screencast's frame rate does not show.
    setInterval(() => window.__fwMark('loop', { frame: window.game.loop.frame }), 100);
    let was = '';
    window.game.events.on('postrender', () => {
      const scenes = window.game.scene
        .getScenes(true)
        .map((s) => s.sys.settings.key)
        .join(',');
      const g = window.game.scene.getScene('Game');
      const phase = g && g.sys.isActive() ? g.phase : '';
      if (`${scenes}|${phase}` !== was) {
        was = `${scenes}|${phase}`;
        window.__fwMark('state', { scenes, phase });
      }
    });
  });
}

/** The opening film (native only): a tap on its layer is the player's own skip. */
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

/** Where a game object is on the page, in CSS px (found by scene and a JS accessor). */
async function whereIs(page, sceneKey, accessor) {
  const at = await page.evaluate(
    ([k, src]) => {
      const s = window.game.scene.getScene(k);
      const o = new Function('s', `return (${src})(s)`)(s);
      if (!o) return null;
      const m = o.getWorldTransformMatrix ? o.getWorldTransformMatrix() : null;
      const p = m ? { x: m.tx, y: m.ty } : { x: o.x, y: o.y };
      const sm = window.game.scale;
      const r = sm.canvasBounds;
      return { x: r.x + p.x / sm.displayScale.x, y: r.y + p.y / sm.displayScale.y };
    },
    [sceneKey, accessor.toString()]
  );
  if (!at) throw new Error(`whereIs: ${accessor} is not on ${sceneKey}`);
  return { x: Math.round(at.x), y: Math.round(at.y) };
}

/** A real tap on a game object, at its position (capture.mjs `tap`). */
async function tap(page, sceneKey, accessor) {
  const q = await whereIs(page, sceneKey, accessor);
  await page.mouse.move(q.x, q.y);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
  return q;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
/** Wait until `s` seconds past the page-clock moment `t` (both on the take's wall clock). */
const until = (t, s) => sleep((t + s) * 1000 - Date.now());
const lastEvent = async (page, name) => page.evaluate((n) => window.__fwEv.filter((e) => e.name === n).pop() ?? null, name);

/* ------------------------------------------------------------------ saves */

/**
 * The takes' saves, built inside a page from the app's own modules (see
 * capture.mjs `buildSaves`). Never ∞: `adsRemoved` is false and the balance
 * is a count any player holds.
 */
async function buildSaves(page) {
  return page.evaluate(
    async ({ TODAY, FAT }) => {
      const imp = window.__fwImport;
      const { LEVELS } = await imp('/src/data/levels.ts');
      const { shiftISO } = await imp('/src/core/CalendarDay.ts');
      const { dueMarks } = await imp('/src/core/Rewards.ts');
      const { missionsFor } = await imp('/src/core/Missions.ts');
      const { validateLevel } = await imp('/src/core/LevelValidator.ts');
      const { Playfield } = await imp('/src/core/Playfield.ts');
      const { CollisionSystem } = await imp('/src/core/CollisionSystem.ts');
      const { renderStroke } = await imp('/src/core/StrokeRecorder.ts');
      const { lineLength, lineRatio, roundRatio, starsFor } = await imp('/src/core/Stars.ts');
      const { BASE_HEIGHT, BASE_WIDTH, METRICS } = await imp('/src/render/Theme.ts');
      const { ADS_MARKER } = await imp('/src/systems/adProvider.ts');

      const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
      const noon = new Date(`${TODAY}T12:00:00`).getTime();

      // A SAVED figure: proved samples, `playable` at the real hitRadius and
      // the card's own redrawn line clear at radius 1 — capture.mjs `make`.
      const make = (level, ms, wobble, plan) => {
        const res = validateLevel(level, pf, { cell: 4, hitRadius: plan, goalRadius: METRICS.goalRadius });
        if (!res.solvable || res.path.length < 3) return null;
        const raw = res.path.map((q, i) => ({
          x: q.x + Math.sin(i / 6) * wobble,
          y: q.y + Math.cos(i / 9) * wobble * 0.4,
        }));
        const times = raw.map((_, i) => Math.round((i / (raw.length - 1)) * ms));
        const walls = level.walls.map((w) => pf.toScreenRect(w));
        const collision = new CollisionSystem(walls, METRICS.hitRadius, pf.axisX);
        const inked = new CollisionSystem(walls, 1, pf.axisX);
        const clean = (pts, sys) => pts.every((p, i) => i === 0 || !sys.blocks(pts[i - 1], p));
        for (const gap of [14, 11, 9, 7, 5]) {
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
          if (pts.length < 4 || !clean(pts, collision)) continue;
          if (!clean(renderStroke(pts, ts, METRICS.renderMaxSpacing, METRICS.smoothIterations).points, inked)) continue;
          return { gap, pts, figure: { levelId: level.id, levelName: level.name, points: pts.map((q) => pf.toNormalized(q)), times: ts, ms } };
        }
        return null;
      };
      /** A proved figure for level `idx`, and its line over par as the game would score it. */
      const proved = (idx, ms, wob, at) => {
        const level = LEVELS[idx];
        for (const plan of FAT.map((d) => METRICS.hitRadius + d)) {
          for (const wobble of [wob, 0]) {
            const got = make(level, ms, wobble, plan);
            if (got) {
              const ratio = lineRatio(lineLength(got.pts), level.parPx ?? null);
              return {
                note: `${level.id}: plan r=${plan.toFixed(1)} (hitRadius ${METRICS.hitRadius.toFixed(1)}), gap ${got.gap}, wobble ${wobble}, line ${ratio?.toFixed(3)}x par = ${ratio ? starsFor(ratio) : '?'} stars`,
                ratio,
                figure: { ...got.figure, at, walls: level.walls, start: level.start, goal: level.goal },
              };
            }
          }
        }
        return { note: `${level.id}: REJECTED — no route proves at hitRadius+${FAT.join('/+')}`, figure: null, ratio: null };
      };

      // A player's line on the levels they have cleared without a figure on
      // show: a spread of one, two and three stars, as a player's is.
      const spread = [1.07, 1.19, 1.08, 1.31, 1.09, 1.22, 1.05];

      /** A player `n` folds in (capture.mjs `player`). */
      const player = (n, { streak = 0, doneToday = false } = {}) => {
        const cleared = LEVELS.slice(0, n).map((l) => l.id);
        const bestMs = {};
        const bestRatio = {};
        cleared.forEach((id, k) => {
          bestMs[id] = 3800 + ((k * 937) % 7000);
          bestRatio[id] = roundRatio(spread[k % spread.length]);
        });
        const daily = {};
        for (let d = 0; d < streak; d++) {
          daily[shiftISO(TODAY, -((doneToday ? 0 : 1) + d))] = { ms: 31000 + d * 4100, deaths: d % 3, foldSense: 58 + (d % 17) };
        }
        return {
          version: 3,
          unlockedIndex: n,
          bestMs,
          cleared,
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
          medals: cleared.filter((id) => starsFor(bestRatio[id]) >= 2),
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
          nudgeAsks: 3,
          nudgeAskedOn: TODAY,
          sessionMinutes: [1140, 1150, 1135, 1160, 1145, 1150, 1140],
          lastSeen: TODAY,
          playDays: 24,
          bestRatio,
          teachMirrorN: 3,
        };
      };

      const notes = [];

      // Take A: level 48 at the frontier, on a save that has never seen a
      // mirror death — so the game teaches it: the wall twice, and the arc
      // arrow labelled "your reflection".
      const at48Fresh = { ...player(47, { streak: 6 }), taught: ['reveal'], teachMirrorN: 0 };

      // Takes B and C: one player, 57 folds in — chapter III (folds 41-60)
      // nearly made, a figure for every fold of it — on a six-day run ending
      // yesterday. B plays today's Daily (the run becomes seven); C is the same
      // player after it, the Daily done and its mission paid.
      const withFigures = (s) => {
        const figures = [];
        for (let idx = 40; idx < 57; idx++) {
          const r = proved(idx, 5200 + ((idx * 613) % 4800), 1.4, noon - (57 - idx) * 5 * 3600000);
          notes.push(`figure ${r.note}`);
          if (!r.figure) continue;
          figures.push(r.figure);
          if (r.ratio !== null) s.bestRatio[r.figure.levelId] = roundRatio(r.ratio);
        }
        s.figures = figures.reverse();
        s.medals = s.cleared.filter((id) => starsFor(s.bestRatio[id]) >= 2);
        return s;
      };
      const daily6 = withFigures(player(57, { streak: 6 }));
      const journey = withFigures(player(57, { streak: 7, doneToday: true }));
      const dealt = missionsFor(TODAY, { clearedCount: 57, unclearedCount: LEVELS.length - 57 });
      journey.missions = {
        ...dealt,
        progress: dealt.ids.map((id) => (id === 'daily' ? 1 : 0)),
        paid: dealt.ids.map((id) => id === 'daily'),
      };
      notes.push(`journey missions dealt for ${TODAY}: ${dealt.ids.join(', ')}`);

      return { marker: ADS_MARKER, hitRadius: METRICS.hitRadius, notes, saves: { at48Fresh, daily6, journey }, figureCount: journey.figures.length };
    },
    { TODAY, FAT }
  );
}

/* ------------------------------------------------------------ the stroke */

/**
 * Plan a PROVED route through the level the Game scene is showing and, with
 * `crash`, a real mirror death along it. capture.mjs `planRoute`: the
 * validator's path planned FAT, decimated, resampled into the exact pointer
 * positions the driver will send, proved by running GameScene's own move
 * logic over them, and its ink checked against the walls at radius 1.
 *
 * `three`: take the widest plan whose line the game will score at ★★★ —
 * Stars.lineRatio of the recorded samples plus the goal entry, exactly as
 * GameScene.win scores it — never tighter than +5.
 */
async function planRoute(page, { crash = null, steps = STEPS, three = false } = {}) {
  const res = await page.evaluate(
    async ({ FAT, STEPS, crash, three }) => {
      const imp = window.__fwImport;
      const { validateLevel } = await imp('/src/core/LevelValidator.ts');
      const { CollisionSystem } = await imp('/src/core/CollisionSystem.ts');
      const { StrokeRecorder, renderStroke } = await imp('/src/core/StrokeRecorder.ts');
      const { segCircleEntryT, segRect, dist } = await imp('/src/core/Geometry.ts');
      const { lineLength, lineRatio, starsFor } = await imp('/src/core/Stars.ts');
      const { METRICS } = await imp('/src/render/Theme.ts');

      const g = window.game.scene.getScene('Game');
      if (!g || !g.sys.isActive()) throw new Error('planRoute: the Game scene is not running');
      if (g.phase !== 'idle') throw new Error(`planRoute: Game is ${g.phase}, not idle`);
      const { level, pf, collision, startPx, goalPx } = g;
      const par = g.par;
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
        const entry = (prev, cur, t) => ({ x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t });
        for (let k = 1; k < base.length; k++) {
          const prev = rec.last;
          const cur = cursorOf(base[k]);
          const goalT = segCircleEntryT(prev, cur, goalPx, METRICS.goalRadius);
          if (collision.blocks(prev, cur)) {
            const hit = collision.firstHit(prev, cur);
            if (goalT !== null && goalT < (hit?.t ?? 0)) return { ok: true, at: k, rec, end: entry(prev, cur, goalT) };
            return { ok: false, why: `hit at move ${k}${hit?.mirror ? ' (mirror)' : ''}`, at: k, hit, prev, cur, rec };
          }
          if (goalT !== null) return { ok: true, at: k, rec, end: entry(prev, cur, goalT) };
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
            for (const step of STEPS) {
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
              const scored = [...sim.rec.points, sim.end];
              const ratio = lineRatio(lineLength(scored), par);
              const stars = ratio !== null ? starsFor(ratio) : 0;
              if (three && stars < 3) {
                tried.push(`plan ${plan.toFixed(1)} gap ${gap} step ${step}: line ${ratio?.toFixed(3)}x par, ${stars} stars`);
                continue;
              }
              route = {
                plan,
                gap,
                step,
                moves: moves.slice(0, sim.at + 1),
                recorded: sim.rec.points.map((p) => ({ x: p.x, y: p.y })),
                lineLen: lineLength(scored),
                ratio,
                stars,
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
          lineLen: route.lineLen,
          par,
          ratio: route.ratio,
          stars: route.stars,
        };
        if (!crash) return out;

        // A crash: the route's first `from` of its moves, then one straight
        // turn at `angle` (degrees, 0 = right, -90 = up) — kept only if the
        // game dies on the REFLECTION, first, with the player's own line clear
        // of every wall by a visible margin (capture.mjs `tryCrash`).
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
          if (!sim.hit.mirror) return { ok: false, why: 'the player’s own line hit first' };
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
            recorded: sim.rec.points.map((p) => ({ x: p.x, y: p.y })),
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
              if (c.ok) found.push({ from: +from.toFixed(2), angle, run: +c.run.toFixed(0), wall: c.wall, at: c.mirrored });
            }
          }
          return { ...out, candidates: found };
        }
        return { ...out, crash: tryCrash(crash.from, crash.angle) };
      } finally {
        Object.assign(g, keep);
      }
    },
    { FAT, STEPS: steps, crash, three }
  );
  if (!res.ok) throw new Error(`planRoute: no proved route for this level\n  ${res.tried.join('\n  ')}`);
  return res;
}

/**
 * When each move goes out, in seconds from the press, for a hand at `speed`
 * base px a second. It leaves the dot at half speed and is up to speed by
 * 0.4 s, and it slows by up to 40% into a bend, measured over a few moves
 * either side so a corner is a slowing and not a stop.
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

/** The speed at which `schedule` takes `seconds` over `base`, and that schedule. */
function paced(base, seconds) {
  let lo = 20;
  let hi = 5000;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    const at = schedule(base, mid);
    if (at[at.length - 1] > seconds) lo = mid;
    else hi = mid;
  }
  let len = 0;
  for (let i = 1; i < base.length; i++) len += Math.hypot(base[i].x - base[i - 1].x, base[i].y - base[i - 1].y);
  const at = schedule(base, hi);
  return { at, speed: hi, mean: len / at[at.length - 1], len };
}

/** A take whose stroke the game did not receive exactly as proved: record it again. */
class Unfaithful extends Error {}

/**
 * Send planned positions as real mouse input (CDP Input.dispatchMouseEvent,
 * as a hand's arrive) on the schedule, and then PROVE the game received them
 * one by one: the samples the game recorded must be exactly the samples the
 * proof recorded, plus the point the stroke ended on. A move the browser
 * merged into the next would have changed them (the game tests every segment
 * from its last recorded sample), so equality means the game ran exactly the
 * proved segments. Anything else throws Unfaithful and the take is recorded
 * again — never softened until it passes.
 */
async function drive(page, fingers, want, at, { release = true, ends = 'won', pressAt = 0 } = {}) {
  const fps = await steady(page);
  await sleep(pressAt - 40 - Date.now());
  const cdp = await page.context().newCDPSession(page);
  const mouse = (type, p, down) =>
    cdp.send('Input.dispatchMouseEvent', {
      type,
      x: p.x,
      y: p.y,
      button: down || type !== 'mouseMoved' ? 'left' : 'none',
      buttons: down ? 1 : 0,
      clickCount: type === 'mouseMoved' ? 0 : 1,
    });
  const phase = () => page.evaluate(() => window.game.scene.getScene('Game').phase);
  await mouse('mouseMoved', fingers[0], false);
  await sleep(40);
  const w0 = await page.evaluate(() => performance.now());
  await mouse('mousePressed', fingers[0], true);
  await page
    .waitForFunction(() => window.game.scene.getScene('Game').phase === 'drawing', null, { polling: 'raf', timeout: 3000 })
    .catch(() => {});
  if ((await phase()) !== 'drawing') {
    await mouse('mouseReleased', fingers[0], false);
    await cdp.detach().catch(() => {});
    throw new Error('drive: the stroke did not start — something else owns the screen');
  }
  const t0 = Date.now();
  let late = 0;
  const sent = [];
  for (let i = 1; i < fingers.length; i++) {
    const wait = t0 + at[i] * 1000 - Date.now();
    if (wait > 1) await sleep(wait);
    else late = Math.max(late, -wait);
    sent.push(mouse('mouseMoved', fingers[i], true));
  }
  await Promise.all(sent);
  await page
    .waitForFunction((p) => window.game.scene.getScene('Game').phase === p, ends, { polling: 'raf', timeout: 5000 })
    .catch(() => {});
  const w1 = await page.evaluate(() => performance.now());
  const got = await page.evaluate((want) => {
    const g = window.game.scene.getScene('Game');
    const pts = g.recorder.points;
    const t = g.recorder.times;
    let worst = 0;
    for (let i = 0; i < Math.min(want.length, pts.length); i++) {
      worst = Math.max(worst, Math.hypot(pts[i].x - want[i].x, pts[i].y - want[i].y));
    }
    return { phase: g.phase, samples: pts.length, worst, span: t[t.length - 1] - t[0] };
  }, want);
  if (release) await mouse('mouseReleased', fingers[fingers.length - 1], false);
  await cdp.detach().catch(() => {});
  const res = { fps, span: got.span, wall: w1 - w0, late, phase: got.phase, samples: got.samples, want: want.length, worst: got.worst };
  if (got.phase !== ends || got.samples !== want.length + 1 || got.worst > 1e-6) {
    throw new Unfaithful(`the game ${got.phase === ends ? 'recorded' : `ended ${got.phase}, and recorded`} ${got.samples} samples (the proof: ${want.length} + the end), worst drift ${got.worst.toFixed(4)}`);
  }
  // The game timed the stroke off a frame clock that stalled: see `steady`.
  if (got.span < 0.85 * (w1 - w0) - 600) {
    throw new Unfaithful(`the game timed a ${((w1 - w0) / 1000).toFixed(1)} s stroke at ${(got.span / 1000).toFixed(1)} s — its frame clock stalled`);
  }
  return res;
}

/** Run a take until its strokes are faithful, at most `tries` times. */
async function retake(id, tries, take) {
  for (let k = 1; ; k++) {
    try {
      return await take(k);
    } catch (e) {
      if (!(e instanceof Unfaithful) || k >= tries) throw e;
      console.log(`  take ${id}, try ${k}: ${e.message} — again`);
    }
  }
}

/** Wait until the game loop draws at a real frame rate — see capture.mjs `steady`. */
async function steady(page, { fps = 40, tries = 40 } = {}) {
  let rate = 0;
  for (let k = 0; k < tries; k++) {
    rate = await page.evaluate(
      () =>
        new Promise((done) => {
          const f0 = window.game.loop.frame;
          const t0 = performance.now();
          setTimeout(() => done(((window.game.loop.frame - f0) * 1000) / (performance.now() - t0)), 400);
        })
    );
    if (rate >= fps) return rate;
    console.log(`  waiting: the game loop draws ${rate.toFixed(0)} fps, under ${fps}`);
    await page.waitForTimeout(15000);
  }
  throw new Error(`steady: the game loop never reached ${fps} fps (last ${rate.toFixed(0)})`);
}

const timing = (t) =>
  `${t.samples} samples, the proof's ${t.want} + the end, worst drift ${t.worst.toFixed(4)}; the game timed the stroke at ${(t.span / 1000).toFixed(2)} s (wall ${(t.wall / 1000).toFixed(2)} s, loop at ${t.fps.toFixed(0)} fps, worst lateness ${t.late.toFixed(0)} ms)`;

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

/** What the Game scene and the save say now — the proof log's second witness. */
const gameSays = (page) =>
  page.evaluate(async () => {
    const g = window.game.scene.getScene('Game');
    const { Progress } = await window.__fwImport('/src/systems/Progress.ts');
    const { todayISO } = await window.__fwImport('/src/core/CalendarDay.ts');
    const d = Progress.data;
    const card = g.resultCard;
    return {
      phase: g.phase,
      attempts: g.attempts,
      mirrorDeaths: g.mirrorDeaths,
      totalDeaths: g.totalDeaths,
      reveals: d.reveals,
      adsRemoved: d.adsRemoved,
      ratio: g.winRatio,
      stars: g.winStars,
      streak: Progress.dailyStreak(todayISO()),
      teachMirrorN: d.teachMirrorN,
      card: card ? { stars: card.spec?.stars, sub: card.spec?.sub, chips: card.spec?.chips?.map((c) => c.text), daily: card.spec?.daily ? { streak: card.spec.daily.streak, title: card.spec.daily.title } : null } : null,
    };
  });

const routeLine = (r) =>
  `route ${r.level.id} "${r.level.name}": planned at r=${r.plan.toFixed(1)} (hitRadius ${r.hitRadius.toFixed(1)} +${(r.plan - r.hitRadius).toFixed(1)}), gap ${r.gap}, step ${r.step}, ${r.fingers.length} moves, ${r.lineLen.toFixed(0)} base px = ${r.ratio?.toFixed(3)}x par (${r.stars} stars); proved event by event at r=${r.hitRadius.toFixed(1)}, ink clear at r=1`;
const paceLine = (p, css) =>
  `paced at ${p.mean.toFixed(0)} base px/s on average (${(p.mean / css).toFixed(0)} pt/s) over ${p.at[p.at.length - 1].toFixed(2)} s`;

/* ------------------------------------------------------------- recording */

/**
 * Record the page with Chrome's screencast until the returned stop() is
 * called: every composited frame as a JPEG, stamped with its wall time, plus
 * the take's event log.
 */
async function record(page, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => {
    const file = `${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, file), Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await page.evaluate(() => window.__fwMark('record'));
  // Every second frame: taking all of them starved the page's main thread
  // often enough that it merged pointer moves (see `drive`).
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: RAW_W, maxHeight: RAW_H, everyNthFrame: 2 });
  return async () => {
    await cdp.send('Page.stopScreencast');
    await cdp.detach().catch(() => {});
    const events = await page.evaluate(() => window.__fwEv);
    writeFileSync(join(dir, 'frames.json'), JSON.stringify(frames));
    writeFileSync(join(dir, 'events.json'), JSON.stringify(events));
    const span = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0;
    /*
     * `smooth(windows)`: throws if, while something was moving, the page went
     * more than 120 ms without a frame, or the game loop itself ran under
     * 40 fps over any tenth of a second — either is a hitch the film would
     * show, so the take is recorded again. A still screen sends no frames and
     * needs none, so only the given [from, to] spans are checked.
     */
    const smooth = (windows) => {
      const inside = (a, b) => windows.some(([from, to]) => b > from && a < to);
      let gap = 0;
      for (let i = 1; i < frames.length; i++) {
        if (inside(frames[i - 1].t, frames[i].t)) gap = Math.max(gap, frames[i].t - frames[i - 1].t);
      }
      if (gap > 0.12) throw new Unfaithful(`the page went ${(gap * 1000).toFixed(0)} ms without a frame while it moved`);
      const ticks = events.filter((e) => e.name === 'loop');
      let slowest = Infinity;
      for (let i = 1; i < ticks.length; i++) {
        if (!inside(ticks[i - 1].t, ticks[i].t)) continue;
        slowest = Math.min(slowest, (ticks[i].frame - ticks[i - 1].frame) / (ticks[i].t - ticks[i - 1].t));
      }
      if (slowest < 40) throw new Unfaithful(`the game loop fell to ${slowest.toFixed(0)} fps while it moved`);
      return gap;
    };
    return { frames: frames.length, seconds: span, fps: span > 0 ? (frames.length - 1) / span : 0, smooth, events };
  };
}

/* ------------------------------------------------------------------ takes */

const proof = existsSync(join(WORK, 'proof.json')) ? JSON.parse(readFileSync(join(WORK, 'proof.json'), 'utf8')) : { takes: {} };
const log = (id, line) => {
  console.log(`  ${line}`);
  ((proof.takes[id] ??= { lines: [] }).lines ??= []).push(line);
};

let S = null;
let built = null;
if (takesWanted.length || cmd === 'crashes' || cmd === 'probe') {
  const seeder = await open(null, { settle: 1500, menu: false });
  built = await buildSaves(seeder.page);
  await seeder.ctx.close();
  if (built.marker !== 'ADS:off') {
    console.log(`REFUSED: the server on ${GAME} is ${built.marker}, not ADS:off — store media never come from an ad build`);
    await b.close();
    process.exit(1);
  }
  console.log(`server ${GAME} is ${built.marker}; hitRadius ${built.hitRadius.toFixed(2)}`);
  for (const n of built.notes) console.log(`  ${n}`);
  S = built.saves;
  proof.server = GAME;
  proof.marker = built.marker;
  proof.clock = CLOCK;
  proof.frame = { page: `${VW}x${VH} pt @${DPR}`, safe: SAFE, band: BAND, fade: FADE };
  proof.notes = built.notes;
}

async function level48(save) {
  const s = await open(save);
  await go(s.page, 'Game', { levelIndex: 47, from: 'LevelSelect' }, 200);
  await idle(s.page);
  return s;
}

// The CSS width of a base unit, for saying a pace in points.
const cssPerBase = async (page) => page.evaluate(() => 1 / window.game.scale.displayScale.x);

if (cmd === 'probe') {
  const dir = join(WORK, 'probe');
  mkdirSync(dir, { recursive: true });
  for (const [name, save, fn] of [
    ['menu', S.daily6, async () => {}],
    ['game48', S.at48Fresh, async (p) => {
      await go(p, 'Game', { levelIndex: 47, from: 'LevelSelect' }, 200);
      await idle(p);
      const r = await planRoute(p, { crash: CRASH, three: true });
      console.log(`  ${routeLine(r)}`);
      console.log(`  crash ${JSON.stringify(r.crash.ok ? { turnAt: r.crash.turnAt, run: r.crash.run, wall: r.crash.wall } : r.crash.why)}`);
    }],
    ['levels', S.journey, async (p) => {
      await tap(p, 'Menu', (m) => {
        const walk = (list) => {
          for (const o of list) {
            if (o.name === 'tile-levels') return o;
            if (o.list) {
              const r = walk(o.list);
              if (r) return r;
            }
          }
          return null;
        };
        return walk(m.children.list);
      });
      await p.waitForFunction(() => window.game.scene.isActive('LevelSelect'), null, { timeout: 45000 });
      await p.waitForTimeout(2500);
    }],
  ]) {
    const s = await open(save, { settle: 1500 });
    await fn(s.page);
    await s.page.waitForTimeout(800);
    await s.page.screenshot({ path: join(dir, `${name}.png`) });
    const geo = await s.page.evaluate(() => {
      const c = window.game.canvas.getBoundingClientRect();
      return { game: `${window.game.scale.gameSize.width}x${window.game.scale.gameSize.height}`, canvas: [c.x, c.y, c.width, c.height].map((v) => Math.round(v * 10) / 10) };
    });
    console.log(`  ${name}: ${JSON.stringify(geo)}`);
    await s.ctx.close();
  }
}

if (cmd === 'crashes') {
  const s = await level48(S.at48Fresh);
  const r = await planRoute(s.page, { crash: { scan: true } });
  console.log(routeLine(r));
  for (const c of r.candidates) {
    console.log(`  from ${c.from} angle ${c.angle}: run ${c.run}px, reflection hits wall ${c.wall} at (${c.at.x.toFixed(0)}, ${c.at.y.toFixed(0)})`);
  }
  await s.ctx.close();
}

/*
 * A — level 48, one unbroken take for 0-15 s: attempt 1 climbs and veers
 * into a real mirror death (the game teaches it: the arc arrow, "your
 * reflection"); the ghost stays; one tap on Reveal spends 3 -> 2; attempt 2
 * is the proved route at a hand's pace; the win blooms into three stars and
 * the result card.
 */
const T = {
  crashSeconds: Number(process.env.FW_CRASH_SECONDS ?? 4.2),
  revealAfter: Number(process.env.FW_REVEAL_AFTER ?? 2.05),
  solveAfter: Number(process.env.FW_SOLVE_AFTER ?? 2.4),
  solveSeconds: Number(process.env.FW_SOLVE_SECONDS ?? 3.8),
  dailySeconds: Number(process.env.FW_DAILY_SECONDS ?? 3.6),
};

if (takesWanted.includes('a')) {
  console.log('take a: level 48');
  const dir = join(WORK, 'a');
  await retake('a', 8, async (k) => {
    proof.takes.a = { lines: [], try: k };
    const s = await open(S.at48Fresh);
    try {
      await go(s.page, 'Game', { levelIndex: 47, from: 'LevelSelect' }, 200);
      await idle(s.page);
      const perBase = await cssPerBase(s.page);
      const r = await planRoute(s.page, { crash: CRASH, three: true });
      log('a', routeLine(r));
      if (!r.crash.ok) throw new Error(`a: the crash at ${JSON.stringify(CRASH)} does not hold: ${r.crash.why}`);
      log('a', `crash: the route's first ${r.crash.turnAt} of ${r.fingers.length} moves, then a turn at ${CRASH.angle}° for ${r.crash.run.toFixed(0)} px; simulated: the reflection hits wall ${r.crash.wall} at (${r.crash.mirrored.x.toFixed(0)}, ${r.crash.mirrored.y.toFixed(0)}), own line clear by > hitRadius+4`);
      const p1 = paced(r.crash.fingersBase, T.crashSeconds);
      const p2 = paced(r.fingersBase, T.solveSeconds);
      log('a', `attempt 1 ${paceLine(p1, 1 / perBase)}; the turn at ${p1.at[r.crash.turnAt - 1].toFixed(2)} s`);
      log('a', `attempt 2 ${paceLine(p2, 1 / perBase)}`);

      const stop = await record(s.page, dir);
      await s.page.waitForTimeout(700);
      const t1 = await drive(s.page, r.crash.fingers, r.crash.recorded, p1.at, { release: false, ends: 'failed' });
      const died = await gameSays(s.page);
      log('a', `attempt 1: ${timing(t1)}`);
      if (died.mirrorDeaths !== 1 || died.totalDeaths !== 1) {
        throw new Error(`a: expected one mirror death, the game counts ${died.mirrorDeaths} of ${died.totalDeaths}`);
      }
      if (died.teachMirrorN !== 1) throw new Error(`a: the arc arrow was not labelled (teachMirrorN ${died.teachMirrorN})`);
      // The finger comes off a moment after the thud, where it stopped.
      await s.page.waitForTimeout(240);
      await s.page.mouse.move(r.crash.fingers[r.crash.fingers.length - 1].x, r.crash.fingers[r.crash.fingers.length - 1].y);
      await s.page.mouse.up();
      const fail = (await s.page.evaluate(() => window.__fwEv.find((e) => e.name === 'state' && e.phase === 'failed'))).t;
      log('a', `the game says: phase ${died.phase}, attempt ${died.attempts}, deaths ${died.totalDeaths} (mirror ${died.mirrorDeaths}), arrow labelled "your reflection" (teachMirrorN ${died.teachMirrorN}), reveals ${died.reveals}, adsRemoved ${died.adsRemoved}`);

      await idle(s.page);
      await until(fail, T.revealAfter);
      const at = await tap(s.page, 'Game', (g) => g.revealPill);
      const tapped = await lastEvent(s.page, 'pointerdown');
      await s.page.waitForTimeout(300);
      const revealed = await gameSays(s.page);
      log('a', `a tap on the Reveal pill at (${at.x}, ${at.y}) pt: reveals ${died.reveals} -> ${revealed.reveals}, adsRemoved ${revealed.adsRemoved}`);
      if (revealed.reveals !== died.reveals - 1) throw new Error('a: the Reveal did not spend one reveal');

      const pressAt = (tapped.t + T.solveAfter) * 1000;
      const t2 = await drive(s.page, r.fingers, r.recorded, p2.at, { pressAt });
      const won = await gameSays(s.page);
      log('a', `attempt 2: ${timing(t2)}; the game scores line/par ${won.ratio?.toFixed(3)}, ${won.stars} stars`);
      if (won.stars !== 3) throw new Error(`a: the game gave the proved line ${won.stars} stars, not 3`);
      await s.page.waitForTimeout(4300);
      const card = await gameSays(s.page);
      log('a', `the result card: ${JSON.stringify(card.card)}`);
      const rec = await stop();
      const ev = (name, pred = () => true) => rec.events.filter((e) => e.name === name && pred(e));
      const presses = ev('state', (e) => e.phase === 'drawing');
      const wonAt = ev('state', (e) => e.phase === 'won')[0].t;
      const gap = rec.smooth([
        [presses[0].t, fail + 0.7],
        [tapped.t, tapped.t + 0.6],
        [presses[presses.length - 1].t, wonAt + 3.0],
      ]);
      log('a', `recorded ${rec.frames} frames over ${rec.seconds.toFixed(1)} s (${rec.fps.toFixed(0)} fps, longest gap in motion ${(gap * 1000).toFixed(0)} ms)`);
    } finally {
      await s.ctx.close();
    }
  });
}

/*
 * B — the Daily. The Menu with its Daily card ("6 day streak") and the
 * missions strip; a tap on the card's Play; today's maze solved on a proved
 * route; the result card flipping the streak 6 -> 7.
 */
const dailyPill = (m) =>
  m.dailyCard.list.find((o) => typeof o.texture?.key === 'string' && o.texture.key.includes('daily-pill')) ?? m.dailyCard;

if (takesWanted.includes('b')) {
  console.log('take b: the Daily');
  const dir = join(WORK, 'b');
  await retake('b', 8, async (k) => {
    proof.takes.b = { lines: [], try: k };
    const s = await open(S.daily6, { settle: 2400 });
    try {
      const perBase = await cssPerBase(s.page);
      const stop = await record(s.page, dir);
      await s.page.waitForTimeout(1300);
      const at = await tap(s.page, 'Menu', dailyPill);
      log('b', `a tap on the Menu's Daily card, on its Play, at (${at.x}, ${at.y}) pt`);
      await s.page.waitForFunction(() => window.game.scene.isActive('Game'), null, { timeout: 45000 });
      await idle(s.page);
      // Shown at 2x, so a coarser step costs nothing on screen, and fewer,
      // wider-spaced moves are fewer for a busy page to merge.
      const r = await planRoute(s.page, { steps: [20, 14, 10] });
      log('b', routeLine(r));
      const p = paced(r.fingersBase, T.dailySeconds);
      log('b', `the Daily ${paceLine(p, 1 / perBase)}`);
      const t = await drive(s.page, r.fingers, r.recorded, p.at);
      const g = await gameSays(s.page);
      log('b', `${timing(t)}; streak 6 -> ${g.streak}; reveals ${g.reveals}`);
      if (g.streak !== 7) throw new Error(`b: the Daily took the streak to ${g.streak}, not 7`);
      await s.page.waitForTimeout(3600);
      const card = await gameSays(s.page);
      log('b', `the result card: ${JSON.stringify(card.card)}`);
      const rec = await stop();
      const drew = rec.events.find((e) => e.name === 'state' && e.phase === 'drawing').t;
      const wonAt = rec.events.find((e) => e.name === 'state' && e.phase === 'won').t;
      const gap = rec.smooth([[drew, wonAt + 2.5]]);
      log('b', `recorded ${rec.frames} frames over ${rec.seconds.toFixed(1)} s (${rec.fps.toFixed(0)} fps, longest gap in motion ${(gap * 1000).toFixed(0)} ms)`);
    } finally {
      await s.ctx.close();
    }
  });
}

/*
 * C — the Levels journey: a tap on the Menu's Levels tile, the chapter page
 * arriving on the frontier, then a thumb's drag back up the path through the
 * figures of the chapter, let go still moving.
 */
const levelsTile = (m) => {
  const walk = (list) => {
    for (const o of list) {
      if (o.name === 'tile-levels') return o;
      if (o.list) {
        const r = walk(o.list);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(m.children.list);
};

if (takesWanted.includes('c')) {
  console.log('take c: the Levels journey');
  const dir = join(WORK, 'c');
  if (built.figureCount < 15) throw new Error('c: not enough proved figures for the journey');
  await retake('c', 8, async (k) => {
    proof.takes.c = { lines: [], try: k };
    const s = await open(S.journey, { settle: 2000 });
    try {
      log('c', `${built.figureCount} proved figures seeded (folds 41-57)`);
      const stop = await record(s.page, dir);
      await s.page.waitForTimeout(900);
      const at = await tap(s.page, 'Menu', levelsTile);
      log('c', `a tap on the Levels tile at (${at.x}, ${at.y}) pt`);
      await s.page.waitForFunction(() => window.game.scene.isActive('LevelSelect'), null, { timeout: 45000 });
      await s.page.waitForTimeout(Number(process.env.FW_LEVELS_SETTLE ?? 800));
      // A thumb's slow drag down the page (the path scrolls back from the
      // frontier toward fold 41): eased in and out, let go still moving a
      // little so the list settles on its own — sent on a schedule, like the
      // strokes, so the scroll does not depend on how busy the machine is.
      const cdp = await s.page.context().newCDPSession(s.page);
      const mouse = (type, x, y, down) =>
        cdp.send('Input.dispatchMouseEvent', { type, x, y, button: down || type !== 'mouseMoved' ? 'left' : 'none', buttons: down ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
      const x0 = Number(process.env.FW_DRAG_X ?? 300);
      const y0 = Number(process.env.FW_DRAG_Y ?? 500);
      const dragPt = Number(process.env.FW_DRAG ?? 345);
      const dragMs = Number(process.env.FW_DRAG_MS ?? 1500);
      await mouse('mouseMoved', x0, y0, false);
      await mouse('mousePressed', x0, y0, true);
      const t0 = Date.now() + 40;
      const n = Math.round(dragMs / 16);
      const sent = [];
      let x = x0;
      let y = y0;
      for (let i = 1; i <= n; i++) {
        await sleep(t0 + i * 16 - Date.now());
        const u = i / n;
        // Smoothstep, with a little constant speed left in it at the lift.
        const e = 0.8 * u * u * (3 - 2 * u) + 0.2 * u;
        x = Math.round(x0 - i * 0.15);
        y = Math.round(y0 + dragPt * e);
        sent.push(mouse('mouseMoved', x, y, true));
      }
      await Promise.all(sent);
      await mouse('mouseReleased', x, y, false);
      await cdp.detach().catch(() => {});
      await s.page.waitForTimeout(Number(process.env.FW_LEVELS_HOLD ?? 2200));
      const scrolled = await s.page.evaluate(() => window.game.scene.getScene('LevelSelect').page?.view?.scrolled ?? null);
      const rec = await stop();
      const downs = rec.events.filter((e) => e.name === 'pointerdown');
      const gap = rec.smooth([[downs[downs.length - 1].t, downs[downs.length - 1].t + 1.6]]);
      log('c', `a drag of ${dragPt} pt down the journey over ${dragMs} ms, let go moving; the list rests at ${scrolled?.toFixed?.(0)}; recorded ${rec.frames} frames over ${rec.seconds.toFixed(1)} s (${rec.fps.toFixed(0)} fps, longest gap in motion ${(gap * 1000).toFixed(0)} ms)`);
    } finally {
      await s.ctx.close();
    }
  });
}

if (takesWanted.length) writeFileSync(join(WORK, 'proof.json'), JSON.stringify(proof, null, 2));

/* -------------------------------------------------------------------- cut */

function loadTake(id) {
  const dir = join(WORK, id);
  if (!existsSync(join(dir, 'frames.json'))) throw new Error(`cut: take ${id} has not been recorded (node preview.mjs takes ${id})`);
  const events = JSON.parse(readFileSync(join(dir, 'events.json'), 'utf8'));
  // What happened before the camera ran (the way in) is not the take.
  const from = events.find((e) => e.name === 'record')?.t ?? -Infinity;
  return {
    id,
    dir,
    frames: JSON.parse(readFileSync(join(dir, 'frames.json'), 'utf8')),
    events: events.filter((e) => e.t >= from),
    before: events.filter((e) => e.t < from),
  };
}

const find = (take, pred, after = -Infinity, what = 'event') => {
  const e = take.events.find((x) => x.t > after && pred(x));
  if (!e) throw new Error(`cut: take ${take.id} has no ${what}`);
  return e;
};
const state = (phase) => (e) => e.name === 'state' && e.phase === phase;
const num = (k, d) => Number(process.env[k] ?? d);

/**
 * The edit: which stretch of which take fills each moment of the film, and at
 * what speed, anchored on what the game itself logged — the death, the tap,
 * the win — so a retake that runs a little long or short still cuts on the
 * same beats. Returns the picture, the captions and the taps to mark.
 */
function edit(A, B, C) {
  const shots = [];
  const captions = [];
  const taps = [];
  let t = 0;
  const shot = (take, src, len, speed = 1) => {
    shots.push({ take, out: t, len, src, speed });
    t += len;
  };
  const outOf = (take, s) => {
    const sh = shots.find((x) => x.take === take && s >= x.src - 1e-9 && s < x.src + x.len * x.speed - 1e-9);
    return sh ? sh.out + (s - sh.src) / sh.speed : null;
  };

  // 0 - 15: take A in one stretch but for the impact, held at half speed for
  // 0.8 s. The film opens mid-stroke, so the line is already climbing.
  const fail = find(A, state('failed'), -Infinity, 'death').t;
  const reveal = find(A, (e) => e.name === 'pointerdown', fail + 0.5, 'Reveal tap');
  const solve = find(A, state('drawing'), reveal.t, 'second stroke').t;
  const won = find(A, state('won'), solve, 'win').t;
  const lead = num('FW_CUT_LEAD', 2.52);
  shot('a', fail - 0.1 - lead, lead);
  shot('a', fail - 0.1, 0.8, 0.5);
  const winAt = t + (won - (fail + 0.3));
  shot('a', fail + 0.3, winAt + num('FW_CUT_BLOOM', 3.3) - t);
  const revealAt = outOf('a', reveal.t);
  const solveAt = outOf('a', solve);
  captions.push({ lines: CAPTIONS.hook, from: 0, to: 2.5 });
  // The words for the reveal are up a beat before the tap, not during it.
  const revealWords = Math.min(4.8, revealAt - 0.25);
  captions.push({ lines: CAPTIONS.twist, from: 2.5, to: revealWords });
  captions.push({ lines: CAPTIONS.reveal, from: revealWords, to: solveAt - 0.05 });
  captions.push({ lines: CAPTIONS.solve, from: solveAt - 0.05, to: winAt });
  captions.push({ lines: CAPTIONS.bloom, from: winAt, to: t });
  taps.push({ take: 'a', t: reveal.t, x: reveal.x, y: reveal.y });

  // Take B: the Menu for the tap on the Daily card; cut to the stroke, at 2x;
  // the win at real speed until the streak has flipped and been read.
  const cardTap = find(B, (e) => e.name === 'pointerdown', -Infinity, 'Daily card tap');
  const draw = find(B, state('drawing'), cardTap.t, 'Daily stroke').t;
  const dwon = find(B, state('won'), draw, 'Daily win').t;
  const dailyFrom = t;
  shot('b', cardTap.t - num('FW_CUT_MENU', 0.5), num('FW_CUT_MENU', 0.5) + 0.3);
  shot('b', draw - 0.1, (dwon - draw + 0.1) / 2, 2);
  shot('b', dwon, num('FW_CUT_DAILYWIN', 2.4));
  captions.push({ lines: CAPTIONS.daily, from: dailyFrom, to: t });
  taps.push({ take: 'b', t: cardTap.t, x: cardTap.x, y: cardTap.y });

  // Take C: the journey building itself in — from the moment the Menu has
  // handed over (the tap on its Levels tile is the take's, not the film's) —
  // the drag, the glide, and the page held.
  const tileTap = find(C, (e) => e.name === 'pointerdown', -Infinity, 'Levels tap');
  const entered = find(C, (e) => e.name === 'state' && e.scenes.split(',').includes('LevelSelect'), tileTap.t, 'Levels scene').t;
  const drag = find(C, (e) => e.name === 'pointerdown', tileTap.t + 0.2, 'journey drag');
  const lift = find(C, (e) => e.name === 'pointerup', drag.t, 'drag release');
  const endFrom = t;
  const from = entered + num('FW_CUT_TILE', 0.05);
  shot('c', from, lift.t + num('FW_CUT_GLIDE', 1.5) - from);
  captions.push({ lines: CAPTIONS.levels, from: endFrom, to: t });
  const path = C.events.filter((e) => e.name === 'pointermove' && e.t >= drag.t && e.t <= lift.t);
  taps.push({ take: 'c', t: drag.t, x: drag.x, y: drag.y, until: lift.t, path });

  for (const k of taps) {
    k.out = outOf(k.take, k.t);
    k.outUntil = k.until ? outOf(k.take, k.until) : null;
    if (k.path) k.path = k.path.map((e) => ({ out: outOf(k.take, e.t), x: e.x, y: e.y })).filter((e) => e.out !== null);
  }
  const anchors = {
    impactAt: outOf('a', fail),
    revealTapAt: revealAt,
    solveAt,
    winAt,
    dailyTapAt: outOf('b', cardTap.t),
    dailyWinAt: outOf('b', dwon),
    levelsAt: outOf('c', from),
    end: t,
  };
  return { shots, captions, taps, duration: t, anchors, outOf };
}

/** Where a CSS point of the page lands in the film. */
const toFilm = (p) => ({ x: (p.x * DPR * W) / RAW_W, y: (p.y * DPR * H) / RAW_H });

function ff(argv, what) {
  try {
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { stdio: ['ignore', 'inherit', 'inherit'], maxBuffer: 1 << 26 });
  } catch (e) {
    throw new Error(`ffmpeg (${what}) failed: ${e.message}`);
  }
}
const probe = (file, entries) =>
  JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', ...entries, file], { encoding: 'utf8' }));

/** The newest frame composited at or before `s` (a frame stays up until the next arrives). */
function frameAt(take, s) {
  const f = take.frames;
  let lo = 0;
  let hi = f.length - 1;
  if (s <= f[0].t) return f[0];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (f[mid].t <= s + 0.002) lo = mid;
    else hi = mid - 1;
  }
  return f[lo];
}

/**
 * The band, the captions and the touch dot, drawn in the page with the
 * game's display face (Georgia Bold, the titles' face), cream on the sky's
 * own darkest blue; a ★ is the result card's gold star, drawn. The band is
 * solid to BAND and fades into the page's sky over FADE — the page there is
 * the night the canvas paints, so nothing of the game is ever under it.
 */
async function drawOverlays(page, captions) {
  return page.evaluate(
    ({ captions, W, BAND, FADE, CAPTION_PX, SKY_EDGE, CREAM, GOLD }) => {
      const png = (c) => c.toDataURL('image/png').split(',')[1];
      const band = document.createElement('canvas');
      band.width = W;
      band.height = BAND + FADE;
      {
        const x = band.getContext('2d');
        x.fillStyle = SKY_EDGE;
        x.fillRect(0, 0, W, BAND);
        const g = x.createLinearGradient(0, BAND, 0, BAND + FADE);
        // An eased fade (smoothstep), so the edge never reads as a line.
        for (let i = 0; i <= 10; i++) {
          const u = i / 10;
          const a = 1 - u * u * (3 - 2 * u);
          g.addColorStop(u, `rgba(8,20,25,${a.toFixed(3)})`);
        }
        x.fillStyle = g;
        x.fillRect(0, BAND, W, FADE);
      }
      const star = (x, cx, cy, r) => {
        const pts = [];
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const rr = i % 2 === 0 ? r : r * 0.45;
          pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
        }
        const path = () => {
          x.beginPath();
          pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
          x.closePath();
        };
        x.save();
        x.lineJoin = 'round';
        x.shadowColor = 'rgba(240,192,90,0.45)';
        x.shadowBlur = r * 0.5;
        const grad = x.createRadialGradient(cx - r * 0.25, cy - r * 0.35, r * 0.05, cx, cy, r * 1.05);
        grad.addColorStop(0, GOLD.hi);
        grad.addColorStop(0.55, GOLD.mid);
        grad.addColorStop(1, GOLD.lo);
        path();
        x.fillStyle = grad;
        x.fill();
        x.shadowBlur = 0;
        x.lineWidth = Math.max(2, r * 0.07);
        x.strokeStyle = 'rgba(251,240,214,0.85)';
        path();
        x.stroke();
        x.restore();
      };
      const texts = captions.map(({ lines }) => {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = BAND;
        const x = c.getContext('2d');
        x.font = `bold ${CAPTION_PX}px Georgia`;
        x.textBaseline = 'alphabetic';
        x.fillStyle = CREAM;
        // A line is words, then any stars: each star an em-wide glyph's room.
        const parts = lines.map((l) => {
          const i = l.indexOf('★');
          return i < 0 ? { words: l, stars: 0 } : { words: l.slice(0, i).trimEnd(), stars: l.length - i };
        });
        const starR = CAPTION_PX * 0.42;
        const starStep = starR * 2.15;
        const m = parts.map((p) => x.measureText(p.words || 'M'));
        const widths = parts.map((p, i) => {
          const ink = p.words ? m[i].actualBoundingBoxLeft + m[i].actualBoundingBoxRight : 0;
          return ink + (p.stars ? (p.words ? CAPTION_PX * 0.28 : 0) + starStep * p.stars - (starStep - 2 * starR) : 0);
        });
        const too = lines.findIndex((l, i) => l.length > 13 || widths[i] > W - 2 * 56);
        if (too >= 0) throw new Error(`caption line too long: ${lines[too]} (${lines[too].length} chars, ${widths[too].toFixed(0)}px)`);
        const step = Math.floor(CAPTION_PX * 1.17);
        const asc = m[0].actualBoundingBoxAscent;
        const desc = Math.max(m[m.length - 1].actualBoundingBoxDescent, parts[parts.length - 1].stars ? starR * 0.2 : 0);
        const block = step * (lines.length - 1) + asc + desc;
        const base0 = (BAND - block) / 2 + asc;
        parts.forEach((p, i) => {
          let at = (W - widths[i]) / 2;
          const base = base0 + i * step;
          if (p.words) {
            x.fillText(p.words, at + m[i].actualBoundingBoxLeft, base);
            at += m[i].actualBoundingBoxLeft + m[i].actualBoundingBoxRight + CAPTION_PX * 0.28;
          }
          // Stars sit on the cap height's middle, as a glyph would.
          const cy = base - CAPTION_PX * 0.36;
          for (let s = 0; s < p.stars; s++) star(x, at + starR + s * starStep, cy, starR);
        });
        return png(c);
      });
      // The touch dot: a soft cream disc with a firmer rim, as iOS draws one.
      const d = document.createElement('canvas');
      d.width = d.height = 72;
      const x = d.getContext('2d');
      x.fillStyle = 'rgba(244,237,225,0.30)';
      x.beginPath();
      x.arc(36, 36, 27, 0, Math.PI * 2);
      x.fill();
      x.lineWidth = 3;
      x.strokeStyle = 'rgba(244,237,225,0.75)';
      x.beginPath();
      x.arc(36, 36, 27, 0, Math.PI * 2);
      x.stroke();
      return { band: png(band), texts, dot: png(d) };
    },
    { captions, W, BAND, FADE, CAPTION_PX, SKY_EDGE, CREAM, GOLD }
  );
}

/**
 * The soundtrack, rendered offline through the game's own voices: the bed
 * from its first bar (started a bar before the film so it is already sounding
 * at 0) and ducked under the pen as the game ducks it, the pen on the paper
 * from the speeds the game reported, every one-shot a take asked for at its
 * moment in the film. Levels are the game's — master 0.5, music bus 0.14 —
 * then the whole is raised so its peak sits at -3 dBFS.
 */
async function renderSound(page, sounds, pens, ducks, duration) {
  return page.evaluate(
    async ({ sounds, pens, ducks, duration }) => {
      const imp = window.__fwImport;
      const A = await imp('/src/systems/Audio.ts');
      const M = await imp('/src/systems/Music.ts');
      const rate = 48000;
      const lead = M.BAR_SECONDS;
      const ctx = new OfflineAudioContext(2, Math.ceil((lead + duration) * rate), rate);
      const master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const music = ctx.createGain();
      music.gain.value = A.MUSIC_LEVEL;
      music.connect(ctx.destination);
      for (let bar = 0, at = 0.05; at < lead + duration; bar++, at += M.BAR_SECONDS) M.scheduleBar(ctx, music, at, bar);
      for (const d of ducks) {
        const at = lead + d.out;
        if (d.on) music.gain.setTargetAtTime(M.DUCK_LEVEL, at, M.DUCK_DOWN_SECONDS / 3);
        else music.gain.setTargetAtTime(A.MUSIC_LEVEL, at + M.DUCK_HOLD_MS / 1000, M.DUCK_UP_SECONDS / 3);
      }
      const played = {};
      const count = (k) => (played[k] = (played[k] ?? 0) + 1);
      for (const s of sounds) {
        const at = lead + s.out;
        if (s.kind === 'note') A.scheduleNote(ctx, master, at, s.step);
        else if (s.kind === 'ting') A.scheduleTing(ctx, master, at, s.step);
        else if (s.kind === 'thud') A.scheduleThud(ctx, master, at);
        else if (s.kind === 'tear') A.scheduleTear(ctx, master, at);
        else if (s.kind === 'tock') A.scheduleTock(ctx, master, at);
        else if (s.kind === 'star') A.scheduleStarNote(ctx, master, at, s.i);
        else if (s.kind === 'celebrate') A.scheduleCelebration(ctx, master, at, s.medal);
        else if (s.kind === 'pop') A.schedulePop(ctx, master, at);
        else if (s.kind === 'reward') A.scheduleReward(ctx, master, at);
        else if (s.kind === 'streakUp') A.scheduleStreakUp(ctx, master, at);
        else continue;
        count(s.kind);
      }
      // The pen: one voice a stroke, the speeds as the game reported them,
      // silent after PEN_STALL_MS without a move, cut at the lift/death/win.
      for (const p of pens) {
        const voice = A.startPenVoice(ctx, master, lead + p.start);
        for (let i = 0; i < p.speeds.length; i++) {
          const s = p.speeds[i];
          voice.speed(s.v, lead + s.out);
          const next = p.speeds[i + 1];
          const stall = s.out + A.PEN_STALL_MS / 1000 / (s.rate ?? 1);
          if ((!next || next.out > stall) && stall < p.end) voice.speed(0, lead + stall);
        }
        voice.cut(lead + p.end);
        count('pen');
      }
      const rendered = await ctx.startRendering();
      const from = Math.round(lead * rate);
      const n = Math.round(duration * rate);
      const ch = [0, 1].map((c) => rendered.getChannelData(c).subarray(from, from + n));
      let peak = 0;
      for (const c of ch) for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(c[i]));
      const gain = peak > 0 ? 0.708 / peak : 1;
      const fadeOut = Math.round(0.8 * rate);
      const pcm = new Int16Array(n * 2);
      for (let i = 0; i < n; i++) {
        const env = Math.min(1, i / (0.02 * rate), (n - i) / fadeOut);
        for (let c = 0; c < 2; c++) pcm[i * 2 + c] = Math.max(-32768, Math.min(32767, Math.round(ch[c][i] * gain * env * 32767)));
      }
      const head = new DataView(new ArrayBuffer(44));
      const str = (o, s) => [...s].forEach((q, i) => head.setUint8(o + i, q.charCodeAt(0)));
      str(0, 'RIFF');
      head.setUint32(4, 36 + pcm.byteLength, true);
      str(8, 'WAVE');
      str(12, 'fmt ');
      head.setUint32(16, 16, true);
      head.setUint16(20, 1, true);
      head.setUint16(22, 2, true);
      head.setUint32(24, rate, true);
      head.setUint32(28, rate * 4, true);
      head.setUint16(32, 4, true);
      head.setUint16(34, 16, true);
      str(36, 'data');
      head.setUint32(40, pcm.byteLength, true);
      const all = new Uint8Array(44 + pcm.byteLength);
      all.set(new Uint8Array(head.buffer), 0);
      all.set(new Uint8Array(pcm.buffer), 44);
      let s = '';
      for (let i = 0; i < all.length; i += 0x8000) s += String.fromCharCode(...all.subarray(i, i + 0x8000));
      return { wav: btoa(s), peak, gain, played };
    },
    { sounds, pens, ducks, duration }
  );
}

/** The takes' sound requests carried through the cut: one-shots, pen strokes, ducks. */
function soundsFor(cut, takes) {
  const sounds = [];
  const pens = [];
  const ducks = [];
  const speedOf = (take, t) => cut.shots.find((x) => x.take === take && t >= x.src && t < x.src + x.len * x.speed)?.speed ?? 1;
  for (const take of takes) {
    const all = [...take.before, ...take.events];
    let pen = null;
    const close = (t) => {
      if (!pen) return;
      const endOut = cut.outOf(take.id, t) ?? pen.lastOut;
      if (pen.speeds.length && endOut !== null) pens.push({ start: pen.start, end: Math.max(endOut, pen.start + 0.02), speeds: pen.speeds });
      pen = null;
    };
    for (const e of all) {
      const out = cut.outOf(take.id, e.t);
      if (e.name === 'sound' && e.kind === 'penStart') {
        close(e.t);
        pen = { start: out, at: e.t, speeds: [], lastOut: out };
        continue;
      }
      // AudioService.penStart cuts any bed still running first — through
      // penStop — so a stop in the same instant as a start is the start's own.
      if (e.name === 'sound' && e.kind === 'penStop') {
        if (pen && e.t - pen.at < 0.005) continue;
        close(e.t);
        continue;
      }
      if (e.name === 'pen' && pen) {
        if (out === null) continue;
        // A stroke already running when the film opens starts sounding at its first shown move.
        if (pen.start === null) pen.start = out;
        const rate = speedOf(take.id, e.t);
        pen.speeds.push({ out, v: e.v * rate, rate });
        pen.lastOut = out;
        continue;
      }
      if (out === null) continue;
      if (e.name === 'sound') sounds.push({ ...e, out });
      else if (e.name === 'duck') ducks.push({ out, on: e.on });
    }
    close(Infinity);
  }
  return { sounds, pens: pens.filter((p) => p.start !== null), ducks };
}

if (cmd === 'cut' || cmd === 'all') {
  console.log('cut');
  const A = loadTake('a');
  const B = loadTake('b');
  const C = loadTake('c');
  const cut = edit(A, B, C);
  const takes = { a: A, b: B, c: C };
  const total = Math.round(cut.duration * FPS);
  console.log(`  ${cut.duration.toFixed(2)} s, ${total} frames; shots:`);
  for (const s of cut.shots) console.log(`    ${s.out.toFixed(2)}-${(s.out + s.len).toFixed(2)} take ${s.take} from ${(s.src - takes[s.take].frames[0].t).toFixed(2)} s at ${s.speed}x`);
  console.log(`  anchors ${JSON.stringify(Object.fromEntries(Object.entries(cut.anchors).map(([k, v]) => [k, v === null ? null : +v.toFixed(2)])))}`);
  console.log(`  captions ${cut.captions.map((c) => `${c.from.toFixed(2)}-${c.to.toFixed(2)} "${c.lines.join(' / ')}"`).join('; ')}`);

  const tmp = join(WORK, 'cut');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(join(tmp, 'seq'), { recursive: true });

  /*
   * One film frame per output tick, each the newest take frame composited by
   * that moment in the take: a symlinked sequence, scaled to the film in one
   * pass; the band, captions and dots go on in the last pass, on the film's
   * own clock.
   */
  for (let k = 0; k < total; k++) {
    const tOut = k / FPS;
    const sh = cut.shots.find((s) => tOut >= s.out - 1e-9 && tOut < s.out + s.len - 1e-9) ?? cut.shots[cut.shots.length - 1];
    const src = sh.src + (tOut - sh.out) * sh.speed;
    const take = takes[sh.take];
    symlinkSync(join(take.dir, frameAt(take, src).file), join(tmp, 'seq', `${String(k).padStart(5, '0')}.jpg`));
  }

  // Overlays and sound need the game's modules and fonts: one quiet page.
  const s = await open(null, { settle: 800, menu: false });
  const marker = await s.page.evaluate(async () => (await window.__fwImport('/src/systems/adProvider.ts')).ADS_MARKER);
  if (marker !== 'ADS:off') throw new Error(`cut: the server is ${marker}, not ADS:off`);
  const art = await drawOverlays(s.page, cut.captions);
  writeFileSync(join(tmp, 'band.png'), Buffer.from(art.band, 'base64'));
  art.texts.forEach((b64, i) => writeFileSync(join(tmp, `caption${i}.png`), Buffer.from(b64, 'base64')));
  writeFileSync(join(tmp, 'dot.png'), Buffer.from(art.dot, 'base64'));

  const snd = soundsFor(cut, [A, B, C]);
  const audio = await renderSound(s.page, snd.sounds, snd.pens, snd.ducks, total / FPS);
  writeFileSync(join(tmp, 'sound.wav'), Buffer.from(audio.wav, 'base64'));
  console.log(`  sound: ${JSON.stringify(audio.played)}, ${snd.ducks.length} ducks; raised ${(20 * Math.log10(audio.gain)).toFixed(1)} dB to a -3 dBFS peak`);
  await s.ctx.close();

  // The last pass: the picture scaled to the film, the band, the captions
  // (each dipping out and in over DIP), the dots, the sound.
  const inputs = ['-framerate', String(FPS), '-i', join(tmp, 'seq', '%05d.jpg')];
  const graph = [`[0:v]scale=${W}:${H}:flags=lanczos+accurate_rnd,format=rgba[p0]`];
  inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(total / FPS), '-i', join(tmp, 'band.png'));
  graph.push(`[p0][1:v]overlay=0:0[p1]`);
  let last = 'p1';
  let idx = 2;
  const DIP = 0.12;
  cut.captions.forEach((c, i) => {
    inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(total / FPS), '-i', join(tmp, `caption${i}.png`));
    const fadeIn = i === 0 ? '' : `,fade=t=in:st=${c.from.toFixed(3)}:d=${DIP}:alpha=1`;
    const fadeOut = i === cut.captions.length - 1 ? '' : `,fade=t=out:st=${(c.to - DIP).toFixed(3)}:d=${DIP}:alpha=1`;
    const to = i === cut.captions.length - 1 ? c.to + 1 : c.to;
    graph.push(`[${idx}:v]format=rgba${fadeIn}${fadeOut}[c${i}]`);
    graph.push(`[${last}][c${i}]overlay=0:0:enable='gte(t,${c.from.toFixed(3)})*lt(t,${to.toFixed(3)})'[v${idx}]`);
    last = `v${idx}`;
    idx += 1;
  });
  cut.taps.forEach((k, i) => {
    if (k.out === null) return;
    inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(total / FPS), '-i', join(tmp, 'dot.png'));
    const end = (k.outUntil ?? k.out + 0.12) + 0.05;
    graph.push(`[${idx}:v]format=rgba,fade=t=in:st=${k.out.toFixed(3)}:d=0.06:alpha=1,fade=t=out:st=${end.toFixed(3)}:d=0.22:alpha=1[d${i}]`);
    let xs;
    let ys;
    if (k.path && k.path.length > 1) {
      // A finger that moves: piecewise-linear between the logged positions.
      const pts = [{ out: k.out, x: k.x, y: k.y }, ...k.path].map((p) => ({ out: p.out, ...toFilm(p) }));
      const expr = (key) =>
        pts
          .slice(1)
          .reverse()
          .reduce(
            (acc, p, j) => {
              const prev = pts[pts.length - 2 - j];
              const span = Math.max(1e-3, p.out - prev.out);
              return `if(lt(t,${p.out.toFixed(4)}),${prev[key].toFixed(1)}+(${(p[key] - prev[key]).toFixed(1)})*(t-${prev.out.toFixed(4)})/${span.toFixed(4)},${acc})`;
            },
            pts[pts.length - 1][key].toFixed(1)
          );
      xs = `${expr('x')}-36`;
      ys = `${expr('y')}-36`;
    } else {
      const p = toFilm(k);
      xs = (p.x - 36).toFixed(1);
      ys = (p.y - 36).toFixed(1);
    }
    graph.push(`[${last}][d${i}]overlay=x='${xs}':y='${ys}':eval=frame:enable='gte(t,${(k.out - 0.02).toFixed(3)})*lt(t,${(end + 0.25).toFixed(3)})'[v${idx}]`);
    last = `v${idx}`;
    idx += 1;
  });
  graph.push(`[${last}]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[vout]`);
  inputs.push('-i', join(tmp, 'sound.wav'));
  const audioIn = idx;
  writeFileSync(join(tmp, 'graph.txt'), graph.join(';\n'));

  /*
   * Apple's spec: H.264 up to High Profile Level 4.0 at a 10-12 Mbps target,
   * progressive, at most 30 fps; stereo AAC at 256 kbps, 44.1 or 48 kHz. The
   * rate is held constant at 11 Mbps (HRD CBR) to sit inside the stated
   * target rather than under it.
   */
  const film = join(OUT, 'preview.mp4');
  const venc = [
    '-c:v', 'libx264', '-profile:v', 'high', '-level:v', '4.0', '-preset', 'slow',
    '-b:v', '11M', '-minrate', '11M', '-maxrate', '11M', '-bufsize', '11M', '-x264-params', 'nal-hrd=cbr:force-cfr=1:colorprim=bt709:transfer=bt709:colormatrix=bt709',
    '-g', '60', '-r', String(FPS), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  ];
  const aenc = (codec) => (codec === 'aac_at' ? ['-c:a', 'aac_at', '-aac_at_mode', 'cbr'] : ['-c:a', 'aac']);
  const encode = (codec) =>
    ff([...inputs, '-filter_complex_script', join(tmp, 'graph.txt'), '-map', '[vout]', '-map', `${audioIn}:a`, ...venc, ...aenc(codec), '-b:a', '256k', '-ar', '48000', '-ac', '2', '-t', (total / FPS).toFixed(3), '-movflags', '+faststart', film], `encode (${codec})`);
  try {
    encode('aac_at');
  } catch {
    encode('aac');
  }

  // Check it the way App Store Connect will, and look at it.
  const info = probe(film, ['-show_streams', '-show_format']);
  const v = info.streams.find((x) => x.codec_type === 'video');
  const a = info.streams.find((x) => x.codec_type === 'audio');
  const facts = {
    size: `${v.width}x${v.height}`,
    fps: v.avg_frame_rate,
    codec: `${v.codec_name} ${v.profile} level ${v.level / 10}`,
    pix_fmt: v.pix_fmt,
    video_kbps: Math.round(Number(v.bit_rate) / 1000),
    audio: `${a.codec_name} ${a.channels} ch ${a.sample_rate} Hz ${Math.round(Number(a.bit_rate) / 1000)} kbps`,
    duration: Number(info.format.duration),
    megabytes: Number(info.format.size) / 1e6,
  };
  const fails = [];
  if (facts.size !== `${W}x${H}`) fails.push(`size ${facts.size}`);
  if (facts.fps !== '30/1') fails.push(`frame rate ${facts.fps}`);
  if (v.codec_name !== 'h264' || !/High|Main/.test(v.profile) || v.level > 40) fails.push(`codec ${facts.codec}`);
  if (v.pix_fmt !== 'yuv420p') fails.push(`pixel format ${v.pix_fmt}`);
  if (a.codec_name !== 'aac' || a.channels !== 2) fails.push(`audio ${facts.audio}`);
  if (facts.duration < 15 || facts.duration > 30) fails.push(`duration ${facts.duration}`);
  if (facts.megabytes >= 500) fails.push(`size ${facts.megabytes} MB`);
  console.log(`  ${JSON.stringify(facts)}`);
  if (fails.length) throw new Error(`the film breaks Apple's spec: ${fails.join('; ')}`);

  // The poster frame is 2.0 s (00:00:02:00); the strip is the check frames.
  const checks = [0, 2, 5, 10, 15, 20];
  const checkDir = join(WORK, 'check');
  mkdirSync(checkDir, { recursive: true });
  for (const at of checks) ff(['-ss', String(at), '-i', film, '-frames:v', '1', join(checkDir, `t${String(at).padStart(2, '0')}.png`)], `frame at ${at} s`);
  ff(['-ss', '2', '-i', film, '-frames:v', '1', join(OUT, 'poster.png')], 'poster');
  ff([...checks.flatMap((at) => ['-i', join(checkDir, `t${String(at).padStart(2, '0')}.png`)]), '-filter_complex', `${checks.map((_, i) => `[${i}:v]scale=295:-1[s${i}]`).join(';')};${checks.map((_, i) => `[s${i}]`).join('')}hstack=inputs=${checks.length}`, join(OUT, 'frames.png')], 'check strip');

  proof.cut = {
    shots: cut.shots.map((x) => ({ ...x, src: x.src - takes[x.take].frames[0].t })),
    captions: cut.captions,
    anchors: cut.anchors,
    taps: cut.taps.map(({ path, ...k }) => ({ ...k, moves: path?.length ?? 0 })),
    sounds: audio.played,
    facts,
    checks: checks.map((at) => join(checkDir, `t${String(at).padStart(2, '0')}.png`)),
  };
  writeFileSync(join(OUT, 'proof.json'), JSON.stringify(proof, null, 2));
  console.log(`  ${film}\n  ${join(OUT, 'poster.png')}\n  ${join(OUT, 'frames.png')}`);
}

await b.close();
console.log('done');
