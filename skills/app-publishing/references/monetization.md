# Monetization design (casual games)

Revenue comes from **retention × sessions × ad quality**, not from cramming in impressions. Every pattern below trades a little short-term ARPDAU for a lot of D1/D7 retention — which nets out higher.

## Interstitial cadence: a hybrid gate

A *count* decides **where** an ad may appear (a natural break); *time + session rules* decide **whether** it actually shows. Ship all of these together:

| Rule | Typical value | Why |
|---|---|---|
| Onboarding grace | no ads until ~level 8 | Players haven't met the hook yet; early sessions monetize poorly anyway |
| Clears per interstitial | every 3rd win | A learnable rhythm — predictability is what players tolerate |
| Minimum spacing | ≥180s between ads | Reads "calm"; structurally prevents back-to-back ads |
| Session warm-up | no ad in the first ~90s | Stops a surprise ad on the first clear of a returning session |
| Session cap | ≤3 interstitials | The 4th is the lowest-value, highest-annoyance impression |
| After a rewarded ad | mute interstitials ~5 min | Don't double-tax someone who just volunteered attention |
| Milestones | never on a pack/chapter finale or the last level | An ad chaser ruins the best moment in the game |

Implement the gate as a **single non-consuming predicate** (e.g. `interstitialWouldShow(level)`), then have the "show" function act on it. That one source of truth lets other systems (like the rating prompt) ask "would an ad fire here?" and stay out of the way.

**Only spend the counter when an ad actually rendered.** On no-fill or offline, leave the counter armed so the next break retries.

## Rewarded ads: opt-in value exchange

- Always opt-in, with the reward named **before** the video.
- **Bank the reward, don't auto-consume it.** "Watch a video → you now have a hint" beats "watch a video → hint used immediately": players choose when to spend, which makes them watch more videos.
- Show the stash count on the button (a small badge) so the currency feels real.
- Give a **free daily top-up** (e.g. +1/day). It's a cheap retention hook and a reason to open the app.

## The "Remove Ads" IAP

- One-time, cheap (≈$0.99), Non-Consumable.
- **Bundle extra value** beyond removing ads — e.g. unlimited hints. It roughly doubles perceived worth at zero marginal cost.
- **Put the perk in the button**: "Remove ads · $0.99" with a sub-line "No ads + unlimited hints" converts better than price alone.
- Upsell it *at the moment of friction* (inside the "you're out of hints" modal), not with a nag popup.
- Owners must get a visibly better app: no banner, no interstitials, the perk always on, and a small confirmation line so they know what they bought.
- Persist ownership locally so a relaunch never needs a store round-trip; still expose **Restore purchases**.

## The rating prompt

- Fire at a **delight peak** — right after a win the player is proud of (e.g. first 3-star clear), a beat after the celebration animation, never after a failure.
- **One shot ever**, guarded by a persisted flag. The OS caps prompts anyway (~3/year on iOS) and gives no callback, so spend your one ask well.
- **Never pair it with an ad** on the same event — check the ad predicate first and skip the ask if an ad is about to fire.
- Never gate content on it, never incentivize it, never wire it to a button (against store rules).

## Ordering matters

At any single moment, at most **one** interruption: ad *or* rating prompt *or* upsell. Decide the priority explicitly rather than letting them collide.

## What to measure

D1/D7 retention and session length **alongside** ARPDAU. If a cadence change lifts ARPDAU but drops D7, it lost money — churned players stop generating impressions entirely.
