// The quick questions Higgins offers before anyone has typed anything.
//
// Twenty of them, covering the three things a person actually wants from Apollo:
// what their own phone is doing, how to use the app, and how scams work. A small
// handful is shown at a time and rotated, so the suggestions feel alive rather
// than a fixed menu — and so twenty ideas fit in the space of four.

export const QUICK_QUESTIONS: string[] = [
  // Your phone, right now
  "Is my device protected?",
  "Why is Apollo growling?",
  "What has Apollo found this week?",
  "Which protections aren't on yet?",
  "Can Apollo screen my calls?",
  "Are my messages being checked?",
  "Is this Wi-Fi safe to use?",
  // Using Apollo
  "I want to check a message",
  "I want to check an email",
  "I want to check a link",
  "How do I check a phone number?",
  "Where do I see my past threats?",
  "How do I share something into Apollo?",
  "What does Apollo keep about me?",
  // Scams and safety
  "What scams are going around right now?",
  "How do I spot a fake delivery text?",
  "Someone called claiming to be my bank",
  "I clicked a link I shouldn't have",
  "How do I know if an email is really from my bank?",
  "What should I do if I've been scammed?",
];

/** A stable-length random selection, never repeating within the set. */
export function pickQuickQuestions(count: number, exclude: string[] = []): string[] {
  const pool = QUICK_QUESTIONS.filter((question) => !exclude.includes(question));
  const picked: string[] = [];
  const taken = new Set<number>();
  const limit = Math.min(count, pool.length);
  while (picked.length < limit) {
    const index = Math.floor(Math.random() * pool.length);
    if (taken.has(index)) continue;
    taken.add(index);
    picked.push(pool[index]);
  }
  return picked;
}
