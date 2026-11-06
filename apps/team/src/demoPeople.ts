import type { TeamContext, UserRow } from "./context.ts";
import { nowIso } from "./context.ts";
import { sendMessage } from "./messages.ts";

const PEOPLE = [
  { id: "demo-ada", githubId: -1, login: "ada-demo", name: "Ada Demo" },
  { id: "demo-grace", githubId: -2, login: "grace-demo", name: "Grace Demo" },
  { id: "demo-linus", githubId: -3, login: "linus-demo", name: "Linus Demo" },
  { id: "demo-margaret", githubId: -4, login: "margaret-demo", name: "Margaret Demo" },
] as const;

const REPLY_DELAY_MS = 1200;
const REPLIES = [
  "Sounds good to me.",
  "Can you say more about that?",
  "Nice, I'll take a look this afternoon.",
  "Ha, agreed.",
  "Let me get back to you on that.",
];

/** Creates the fake teammates (negative GitHub ids never collide with real accounts). */
export async function seedDemoPeople(ctx: TeamContext): Promise<ReadonlyMap<string, UserRow>> {
  const people = new Map<string, UserRow>();
  for (const person of PEOPLE) {
    await ctx.db.query(
      `INSERT INTO users (id, github_id, github_login, name, avatar_url, email, created_at)
       VALUES ($1, $2, $3, $4, NULL, $5, $6) ON CONFLICT (github_id) DO NOTHING`,
      [
        person.id,
        person.githubId,
        person.login,
        person.name,
        `${person.login}@demo.test`,
        nowIso(ctx),
      ],
    );
    const [row] = await ctx.db.query<UserRow>("SELECT * FROM users WHERE github_id = $1", [
      person.githubId,
    ]);
    if (row) people.set(row.id, row);
  }
  return people;
}

/** Makes the fake teammates answer, a moment later, whenever a real person writes to them. */
export function demoReplies(
  ctx: TeamContext,
  people: ReadonlyMap<string, UserRow>,
  schedule: (fn: () => Promise<unknown>, ms: number) => void = (fn, ms) =>
    void setTimeout(() => void fn(), ms),
): NonNullable<TeamContext["afterMessage"]> {
  let turn = 0;
  return ({ conversationId, senderId, recipientId }) => {
    const bot = people.get(recipientId);
    if (!bot || people.has(senderId)) return;
    const reply = REPLIES[turn++ % REPLIES.length] ?? "Sounds good to me.";
    schedule(
      () => sendMessage(ctx, bot, conversationId, reply).catch(() => undefined),
      REPLY_DELAY_MS,
    );
  };
}
