// Higgins' daily greeting — one short line, once a day, matching the time of day and Apollo's current state.
// Pure and deterministic (variant chosen by date) so it can be unit-tested and never needs the network.
import type { ApolloState } from "./types.ts";

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export function timeOfDay(d = new Date()): TimeOfDay {
  const h = d.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

const OPENERS: Record<TimeOfDay, string[]> = {
  morning: ["Good morning.", "Good morning to you.", "A very good morning."],
  afternoon: ["Good afternoon.", "Good afternoon to you.", "Afternoon."],
  evening: ["Good evening.", "Good evening to you.", "A pleasant evening to you."],
  night: ["Still up, I see.", "Burning the midnight oil.", "A late hour, but Apollo doesn't mind."],
};

const STATE_LINES: Record<ApolloState | "lost", string[]> = {
  sniffing: ["Apollo is having a sniff about; I shall report presently.", "Apollo is nose-down on something — do give him a moment."],
  resting: ["Apollo is patrolling and all is quiet. Nothing requires your attention.", "Apollo reports a quiet watch. Carry on with your day.", "All is well on Apollo's rounds. I shall let you know if that changes."],
  ears_up: ["Apollo's ears are up over something from earlier. Not alarming, but worth a glance when you have a moment.", "Apollo noticed a familiar pattern. A careful look would be prudent, though there's no cause for fuss."],
  growling: ["Apollo is growling at something from earlier. I'd suggest a look before you go on.", "Apollo has his hackles up — nothing confirmed, but do have a look at Patrol."],
  barking: ["I'm afraid Apollo is barking. There's a matter that needs your decision — Patrol will show you exactly what.", "Apollo is barking, and rightly so. Do attend to Patrol before anything else this morning."],
  biting: ["Apollo blocked something dangerous and is standing guard. You're quite safe; no action needed unless you'd already entered details.", "Apollo has a threat firmly in hand. He'll stand guard while you get on with things."],
  lost: ["Apollo can't see very much at the moment — some protections are off. Worth a look in Guard when convenient.", "Apollo's view is rather limited just now. Do check Guard so he can do his job properly."],
};

export interface Greeting { text: string; tone: ApolloState | "lost" }

/** Deterministic per calendar day so the line doesn't change on every render. */
export function higginsGreeting(state: ApolloState | "lost", d = new Date()): Greeting {
  const dayIndex = Math.floor(d.getTime() / 86_400_000);
  const openers = OPENERS[timeOfDay(d)];
  const lines = STATE_LINES[state];
  let line = lines[dayIndex % lines.length];
  if (timeOfDay(d) !== "morning") line = line.replace(" this morning", " today");
  return { text: `${openers[dayIndex % openers.length]} Higgins here. ${line}`, tone: state };
}

/** Local calendar-day key used to show the greeting once a day. */
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
