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
  - Still to do: Titan shifting, perks and families (decide scope), a hooked-release momentum check on landing.
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
  - Still to do: check on a real phone; narrow screens (under ~700 px) will still crowd the HUD; sensitivity settings; landscape-only lock.
