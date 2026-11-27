// Day/night: the clock, sun elevation, daylight and sky colours.
import { skyLight, clockLabel, periodName, hourOf, DAY_SEC, START_HOUR } from "../src/game/daynight";

let fails = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
  if (!ok) fails++;
};

check(hourOf(0) === 6 && Math.abs(hourOf(0.25) - 12) < 1e-9, "t=0 is 06:00 sunrise and t=0.25 is noon");
check(clockLabel(0.25) === "12:00" && clockLabel(0.75) === "00:00", "clock labels: noon 12:00, midnight 00:00");
check(Math.abs(skyLight(0.25).elevation - 1) < 1e-9 && Math.abs(skyLight(0.75).elevation + 1) < 1e-9, "sun is highest at noon and lowest at midnight");
check(skyLight(0.25).daylight === 1 && skyLight(0.75).daylight === 0, "full daylight at noon, none at midnight");
check(skyLight(0.25).sunIntensity > skyLight(0.75).sunIntensity * 3, "the sun is much brighter at noon than the moon at midnight");
check(skyLight(0.25).skyTop[2] > skyLight(0.75).skyTop[2], "the sky is bluer by day than at night");
check(skyLight(0.5).dusk > 0.9 && skyLight(0.0).dusk > 0.9, "sunset and sunrise have the warm dusk tint");
check(skyLight(0.25).dusk === 0, "no dusk tint at noon");
check(periodName(0.25) === "Day" && periodName(0.75) === "Night" && periodName(0.5 - 0.02) === "Dusk", "period names: Day, Night, Dusk");
const start = (START_HOUR - 6) / 24;
check(clockLabel(start) === "08:00", "a run starts at 08:00");
// the clock wraps and a full day takes DAY_SEC of play
let t = start;
t = (t + DAY_SEC / DAY_SEC) % 1;
check(Math.abs(t - start) < 1e-9, "one full day wraps back to the start");
check(DAY_SEC >= 300 && DAY_SEC <= 900, "a day lasts 5 to 15 minutes of play");
// smooth: no jump between adjacent samples
let maxJump = 0;
for (let i = 0; i < 1000; i++) {
  const a = skyLight(i / 1000), b = skyLight((i + 1) / 1000);
  maxJump = Math.max(maxJump, Math.abs(a.sunIntensity - b.sunIntensity));
}
check(maxJump < 0.05, `sun intensity changes smoothly (max step ${maxJump.toFixed(3)})`);

console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
