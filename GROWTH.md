# Foldwing — monetization & gameplay roadmap

Research notes, 2026-08-07. Sources at the bottom; numbers are industry
benchmarks, not promises.

**Status (same day):** shipped in build 16 — Daily Fold with streaks (date
seeds the deterministic generator; `systems/Daily.ts`), chapters of 20 in the
level select, par + medals (validator route arc as `parPx`, gold at ≤1.25×),
ghost of the previous attempt, the contextual reveal offer at 3 deaths (skip
moves to 6), and the 20-reveals consumable (`com.noqyris.foldwing.reveals20`,
$1.99 base, live in ASC, offered in the out-of-reveals sheet next to the
rewarded option). Build 18 added **Fold Sense** — a 0..100 skill rating
(line-vs-par, tries, reveals, mirror-death share, fold exposure; EMA
profile score) shown on wins and the menu, plus the Wordle-style
spoiler-safe TEXT share for the Daily. Guardrail: it is a game rating, not
a cognition claim — never market it as brain anything (see MARKETING.md).
Still open from this list: Foldwing Plus SKU, weekly Impossible fold, Zen
mode, Game Center (planned in MARKETING-PLAN.md phase 2 alongside the
streak widget and web daily).

## Monetization: what fits THIS game

Foldwing is a session-based logic puzzle with a frustration-retry loop —
the genre runs **hybrid** (ads + IAP), and so do 78% of the top-100 grossing
iOS games. Casual puzzle ARPDAU benchmarks sit around $0.08–0.15, with
logic/puzzle titles typically splitting ~30% ads / ~70% IAP once IAP exists.

What we already have is the right skeleton — the job is to deepen it, not
replace it:

1. **Rewarded video becomes the centerpiece, not the garnish.** Rewarded
   eCPMs run ~3× interstitials ($15–25 vs $5–8) with ~98% fill and the least
   retention damage because they are opt-in. In a maze game the REVEAL is a
   genuinely valuable hint (it shows the folded walls — the hidden half of
   the map), and SKIP is genuinely valuable relief. Both already run on
   rewarded. Deepen: make the reveal offer appear contextually after N deaths
   on the same level ("see the folded walls?"), not only behind the eye
   button. Contextual rewarded placements convert far better than passive
   ones.
2. **Keep interstitials rare and time-floored** (current: every 3rd win /
   5th attempt AND 120s floor). Logic-puzzle players churn on interruption;
   the revenue center of gravity should shift toward rewarded + IAP as the
   game matures. Do not add more interstitial pressure.
3. **IAP ladder** (today only Remove Ads):
   - `Remove Ads` — keep, price anchor.
   - `Reveal bundle` (consumable, e.g. 20 reveals) — the natural "hint pack";
     hint bundles are the second pillar of puzzle IAP (benchmark example:
     $4.99 remove-ads + $9.99 hint bundle → ~1.8% daily conversion).
   - Later, `Foldwing Plus` one-time: remove ads + unlimited reveals +
     gallery export in high-res. One SKU that bundles everything readable in
     one sentence.
4. **Banner stays** — it monetizes the level-select/menu dwell time and the
   game already reserves its strip. No change.

**Priority order:** contextual rewarded reveal offer → reveal bundle IAP →
Plus SKU. All three sit behind the AdMob review clearing and real traffic —
measure, then tune.

## Gameplay: what to add, in order of leverage

1. **Daily Fold.** One maze per day, the same for every player worldwide —
   the generator is deterministic, so `seed = date` makes this nearly free to
   build. Add a streak counter and a tiny calendar of past days. Daily
   puzzles + streaks are the strongest retention pattern in the genre (streak
   holders return at multiples of baseline; the NYT games business is built
   on exactly this loop). The share card already exists — "Daily Fold #37,
   2:41, 3 attempts" is the viral surface.
2. **Chapters/packs.** 300 levels read as an undifferentiated wall; cutting
   them into named chapters of 20 (with the existing tone-banded names as
   chapter titles: First folds → Severe folds) gives players intermediate
   finish lines and a place to feel progress. Pure UI — the set is already
   ordered.
3. **Par + medals.** The solver knows the optimal route length; showing
   "your line: 1.8× par" after a win converts every completed level into a
   replayable score-attack for perfectionists, at zero content cost. Medal at
   ≤1.25× par. (This also seeds a future leaderboard without needing one now.)
4. **Ghost replay on retry.** After a death, show the player's previous
   attempt as a faint ghost line for the first seconds — turns frustration
   into information, softens the retry loop the difficulty curve is designed
   to create.
5. **Later / bigger:** weekly "Impossible fold" (one extremely hard maze, a
   week to crack it), Zen mode (no fail — trace freely, for the gallery),
   Game Center achievements for streaks and chapters.

**Do NOT add:** timers/energy systems (kills the "one more try" loop this
game runs on), forced tutorials, level-locked hint paywalls (reveals must
stay earnable — that is what makes the rewarded loop honest).

## Sources

- https://cas.ai/blog/hybrid-monetization-in-mobile-games-a-practical-guide/
- https://www.juegostudio.com/blog/arpdau-benchmarks-by-game-genre
- https://gamegrowthadvisor.com/blog/2026-04-02-f2p-monetization-models-comparison-2026/
- https://gamegrowthadvisor.com/blog/2026-04-16-hybrid-casual-game-design-strategy-2026/
- https://coinis.com/glossary/app-monetization
- https://www.deconstructoroffun.com/blog/2024/8/5/win-streak-the-gift-that-keeps-on-giving
- https://uxmag.com/articles/the-psychology-of-hot-streak-game-design-how-to-keep-players-coming-back-every-day-without-shame
- https://www.ivey.uwo.ca/hba/blog/2025/03/the-daily-puzzle-phenomenon-how-nyt-turned-games-into-a-subscription-goldmine/
- https://mobilegamedoctor.com/2025/05/30/illuminating-level-creation-for-free-to-play-puzzle-games/
- https://www.randomforestservices.com/post/balancing-game-difficulty-using-predictive-analytics-when-challenge-helps-retention
