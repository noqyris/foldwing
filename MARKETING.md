# Foldwing — reels playbook

Research notes, 2026-08-07. For short-form (TikTok / IG Reels / YT Shorts).

## The brain-hemisphere hook: verdict

The pitch was: *"did you know doing two things at once activates your left
and right hemisphere — train it with this app"*, with an AI-generated (fal.ai)
brain visual as the hook.

**Do not run the claim as stated.** Two reasons:

1. **It is a known neuromyth.** The left-logic/right-creative split was
   debunked in the literature decades ago; both hemispheres are active in
   every task and cannot be trained separately — they are wired together
   through ~250M fibers of the corpus callosum. A "did you know" that savvy
   commenters can debunk becomes the comment section, and not in a good way.
2. **It is a regulatory pattern.** The FTC fined Lumosity $2M specifically
   for unsubstantiated "brain training" benefit claims; the standing order
   requires controlled clinical evidence for that class of claim. Any ad
   copy promising cognitive benefits ("improves focus/memory/multitasking")
   is the same exposure with a smaller wallet.

**Keep the INSTINCT, change the framing.** The true, self-demonstrating
version of the same idea: *your conscious attention cannot track a line and
its mirror at the same time* — that is a divided-attention fact everyone has
felt (pat head, rub stomach), it IS the game mechanic, and the viewer can
verify it in the clip itself in two seconds. Feeling-claims ("your brain
will hate this", "this broke me") are safe; benefit-claims are not.

## What performs in this genre (and what to avoid)

- **Hook in the first 1–3 seconds**, tied to REAL gameplay. Creatives whose
  hook connects to the actual loop outperform and retain; fake-gameplay ads
  are the genre's known cancer (installs that churn, comment backlash).
- **The fail hook** is the puzzle-genre classic: show a plausible attempt
  dying "unfairly", trigger *"I could do better"*, harvest the correction in
  comments. Foldwing has a UNIQUE fail: dying on a wall that is not there —
  no other game can show that shot.
- **UGC-style beats polished.** Screen-capture + captions + trending sound
  reads native; cinematic AI intros read as ad and get swiped, so if fal.ai
  is used at all, cap it at ~1.5–2s and cut hard to real capture.

## Reel concepts, ranked

1. **"Why did I die?!"** (the flagship). Real capture: finger draws through
   what looks like open space → death flash on NOTHING → freeze →
   Reveal paints the folded walls → "ohhhh." Overlay: `the maze is folded.
   half of it is invisible.` CTA: `level 6 breaks people`. Comment bait
   built in.
2. **"Your brain can't track both."** The corrected hemisphere hook. 1.5s
   fal.ai visual of a line splitting into mirrored twins (abstract, on the
   game's paper palette — not a glowing brain) → real capture where the
   MIRROR dies while the player watches their own line → `you're drawing
   one line. you're responsible for two.`
3. **The Reveal wow.** Left half nearly empty → tap ⊙ Reveal → the whole
   hidden labyrinth blooms in rose → `this level looks empty. it isn't.`
   Pure satisfying-content energy, no words needed.
4. **Daily Fold social proof.** `everyone on earth gets the same maze
   today` → speedrun capture → share card with time → `beat 2:41 and I'll
   pin you.` Repeatable daily; builds the streak habit it advertises.
5. **Par flex.** `the perfect line is 1.00× par. I got 1.04.` → capture of
   a near-perfect run with the gold medal verdict → score-attack audience.
6. **ASMR win.** No voice, no captions: one clean run, the gate notes
   rising (the game plays a scale as you pass each row), figure blooms,
   share card. Sound-on content — the audio ladder is an unused asset.

Rotate 1→3 as paid creative candidates; 4→6 are organic/retention posts.

## Production pipeline

- **Raw capture is automatable here.** The QA harness already plays any
  level with a simulated finger at 120fps in a real browser at exact
  iPhone proportions; recording it (playwright video / simulator
  `simctl io recordVideo`) yields clean 9:16 gameplay: scripted wins,
  scripted deaths on folded walls, reveal moments, daily runs. A clip
  library can be regenerated on demand — no phone filming required.
- **fal.ai**: hook shots only (concept 2), 1.5–2s, paper/ink palette to
  match the game; never gameplay imitation.
- **Assembly**: CapCut — hook (≤2s) → fail/wow (3–4s) → reveal/payoff
  (2–3s) → CTA card (1s, App Store badge + "Foldwing"). Captions burned in
  (sound-off viewers), trending low-fi sound under the game's own audio.
- **Measure**: hook-rate (3s view %), hold to 75%, install CTR; kill
  creatives under benchmark weekly and refill from the library.

## Claim guardrails (hard rules)

- No cognitive-benefit claims (focus, memory, IQ, "brain training",
  hemispheres). Feeling-claims and challenge-claims only.
- No fabricated stats ("99% fail") — use real funnel numbers once
  analytics exist, or none.
- All gameplay shown must be real capture of the shipped game.

## Sources

- https://theconversation.com/mondays-medical-myth-you-can-selectively-train-your-left-or-right-brain-4704
- https://biomedicalodyssey.blogs.hopkinsmedicine.org/2019/05/left-vs-right-brained-why-the-brain-laterality-myth-persists/
- https://www.sciencenewstoday.org/left-brain-vs-right-brain-truth-or-myth
- https://www.ftc.gov/news-events/news/press-releases/2016/01/lumosity-pay-2-million-settle-ftc-deceptive-advertising-charges-its-brain-training-program
- https://megadigital.ai/en/blog/tiktok-ads-for-puzzle-games/
- https://www.blog.udonis.co/mobile-marketing/mobile-games/fake-mobile-game-ads
