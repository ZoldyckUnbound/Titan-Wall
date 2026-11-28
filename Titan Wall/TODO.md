# Titan Wall — roadmap

## Open from the original brief
- [x] Titan hitboxes: elbows, knees, forearms and thighs (rules.ts checks). Playtest still to do.
- [ ] Proper rigs: crawling Rod Reiss, beast titan (throws stones), colossal, founding titan
- [x] Retreat/teammate AI: 5 squad mates, 1 life per wave, rejoin at next wave, retreat when low and heal at depots (scripts/squad.ts). Fixed a 90 m edge rule left over from the old arena.
- [ ] Balance pass on the 60-wave curve (health, counts, wall timing)
- [ ] Playtest landing, building smash, armoured nape

## New requests
- [~] **Research and implement Roblox "AOT Revolution" mechanics.** Where they conflict with existing logic, AOT Revolution takes priority.
  - Research (thegamer.com, deltiasgaming.com, attackontitanrevolutionwiki.wiki): ODM hooks on Q (left) and E (right), hold to stay attached; LMB cuts with the blades; R reloads blades (3 spare reloads); Space boosts; gas drains while holding/boosting; releasing the hook before landing keeps momentum without gas; hooks catch titans too; reload stations on each map; hold A/D to swing sideways; nape cut from behind.
  - Done: hooks on Q/E (hold keeps the rope), LMB slash, F thunder spear (moved from E), R reload, Space boost, Shift reel. Controls, tutorial and HUD text updated to match.
  - Verified in scripts/aot.ts: A/D swings while hooked, a hooked swing burns no gas, boost lifts while looking down, and depots restock spare blades (the reload stations).
  - Perks and families (decided: full scope, no titan shifting). Three families (House Ackerman, Arlert, Braun) with three perks each, unlocked by lifetime waves cleared (10 / 25 / 45), with a loadout of up to three picked on the menu. Saved in localStorage (titanwall.progress.v1). Checked in scripts/perks.ts and in headless Chromium.
  - Still to do: tune the unlock thresholds and perk strength by playtest.
  - Verified in scripts/aot.ts: letting go of a hook mid-air keeps the speed and burns no gas.
  - Decided against: titan shifting.
- [~] **Bosses after wave 60's founding titan:** multiple bosses (war hammer titan and others) that appear late, with the founding titan on wave 60.
  - Done: wave 60 spawns the Founding Titan (1500 HP, 60 units) with two war-hammer titans, two beasts and Reiss. Hammer and Founding have their own silhouettes (hammer prop, halo, long hair), tuned speed and windup, wider swings, and armour plate (a clean 1.35× cut kills). scripts/bosses.ts checks they can be killed.
  - Still to do: a slam shockwave for the hammer, a Founding pattern, and bosses after 60 (e.g. an endless mode).
- [~] **Ending cutscene:** resolve the story, reward the player for finishing, show the lasting impact of their actions, then credits or a sequel tease.
  - Done: epilogue cards built from the run (squad survival, nape cuts), a "Veteran of the Walls" badge kept in the browser, a sequel tease, and a scrolling credits roll (src/Ending.tsx).
  - Still to do: browser check of the animation, a fuller credits list.
- [~] **Music and sound effects:**
  - Done: procedural score (src/game/music.ts). Every wave has its own key, mode, tempo and pattern (59 distinct themes across 60 waves); the four seasons set the palette (maria / breach / beast / chapter) and wave 60 has its own finale. Drums and the intensity rise as titans close in. Ducks on pause, stops on death or victory.
  - Done since: Reiss steam emitter.
  - Done since: titan footsteps by kind (beast, Reiss, hammer/Founding, normal), spear throw and pin sounds.
  - Done since: a dedicated ending theme (slow D major-pentatonic, no drums) plays on victory; checked in scripts/rules.ts.
  - Still to do: listen-test in a browser and tune the levels.
- [~] **Mobile support:** touch controls that are easy to play.
  - Done: on-screen move stick, look drag, BOOST, HOOK L/R (hold keeps the rope), SLASH, SPEAR, RELOAD, GRAB, PAUSE (src/Touch.tsx). Touch tutorial copy, minimap hidden on phones, HUD bars clear of the buttons. Checked in headless Chromium at 844×390 (no console errors) and in scripts/touch.ts.
  - Portrait phones get a "turn your phone sideways" overlay during a run (CSS only; checked in headless Chromium at 390×844).
  - Still to do: check on a real phone; sensitivity settings; very narrow landscape screens will still crowd the HUD.
- [~] **Latest batch: controls, villages, home page, recruit launches.**
  - Done: hook assist widened from 16° to 24° (ASSIST_OFFSETS in scout.ts; player only). scripts/cinema.ts checks 12° and 20° catch, 40° still misses.
  - Done: every town and village has 8 timber gate posts on its four road axes (city.ts). Village density raised by 35% (about 190–290 buildings per village, measured at seed 1337). Layout-only check; not yet looked at in a browser.
  - Done: home page adds a Settlements panel (built from DISTRICTS) and a Gear, Horses and Supply panel. Every claim was checked against the code (depot lock, HEAL_FLOOR 75, horse restock, retry/save).
  - Blocked: browser screenshot of the home page. Headless Chromium fails with a missing libnss3 in this sandbox, so the phone and desktop checks from earlier sessions could not be rerun.
  - Open: recruit velocity spikes (dv 13–35 m/s, hooks idle, no titan near). A cap that made teammates drop hooks above 28 m/s was tried and did not reduce them (capped runs 22–190, uncapped 57–180), so it was reverted. The cause is not known; next step is a per-frame force trace (collision, hook pull, boost, ground snap).
  - Open: "research" in the latest request is not yet defined. Confirm what the user wants researched before building it.
  - Open: ODM ease beyond the wider assist (for example, air control while hooked, and a gentler pendulum) is still to be tuned by playtest.
- [x] **Research pass (map and ODM ease).**
  - Map: wall radii of 250 km (Sina), 380 km (Rose) and 480 km (Maria) are the commonly cited figures, which is 2500, 3800 and 4800 m at 1:100,000. lore.ts already uses them. Ring gaps are about 100 km (Maria to Rose) and 130 km (Rose to Sina). Sources: reddit r/attackontitan district-size thread, and the r/ShingekiNoKyojin wall-area thread.
  - ODM in other AOT games: AOT Revolution (Roblox) guides list hook assist, nape assist, hook detach, and W/S to steer in the air while hooked, which sets height relative to the titan. Sources: attackontitanrevolutionroblox.wiki beginner guide, and gamerant's "How to Kill Titans in Attack on Titan Revolution".
  - Done from this: W on a hook reels the rope in (7 m/s) and S pays it out (6 m/s), player only, no gas. scripts/aot.ts checks both, and that the rope cannot pass the hook range. Listed on the controls screen and the home page.
  - Already in the game: hook assist (24°), a generous nape reach (3 m plus the nape radius), and hook release that keeps momentum.
  - Not done: a nape-assist option in settings, and a backflip or side-flip dodge. Both are in the guides; neither is required by the request.
