import type Phaser from 'phaser';

/**
 * A tiny handle on the running Phaser game so non-render systems can pause the
 * loop. Used around full-screen ads: with the canvas still animating underneath,
 * the WebView keeps burning CPU/GPU while the ad renders on top, which on real
 * devices makes the ad sluggish — sometimes to the point where its close button
 * doesn't respond. Pausing while the ad is up gives the ad the whole device.
 *
 * Kept out of src/scenes on purpose: systems must not import scenes, and this
 * only ever touches the game's loop, never its content. Registered once, from
 * main.ts, straight after the game is created.
 */

let game: Phaser.Game | null = null;
let depth = 0;

export function registerGame(g: Phaser.Game): void {
  game = g;
}

/** Pause rendering + the update loop (reference-counted, so nesting is safe). */
export function pauseGameLoop(): void {
  depth++;
  if (depth > 1 || !game) return;
  try {
    game.loop.sleep();
  } catch {
    // loop not ready — nothing to pause
  }
}

export function resumeGameLoop(): void {
  depth = Math.max(0, depth - 1);
  if (depth > 0 || !game) return;
  try {
    game.loop.wake();
  } catch {
    // ignore
  }
}

/**
 * Whether something full-screen has the loop paused right now. Counted, not
 * read off the loop itself, so it answers the same with no game registered —
 * and it is the ad's claim on the screen, not Phaser's own blur handling.
 */
export function gameLoopPaused(): boolean {
  return depth > 0;
}
