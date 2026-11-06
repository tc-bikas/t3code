export interface EmojiEntry {
  readonly emoji: string;
  readonly name: string;
  readonly keywords: ReadonlyArray<string>;
}

export interface EmojiCategory {
  readonly id: string;
  readonly label: string;
  readonly emojis: ReadonlyArray<EmojiEntry>;
}

/** One-tap reactions shown above the full set. */
export const QUICK_REACTIONS: ReadonlyArray<string> = ["👍", "❤️", "😂", "🎉", "👀", "🙏"];

// "emoji name: keywords". A small curated set for the system emoji font; no images.
const SOURCE: ReadonlyArray<readonly [id: string, label: string, entries: ReadonlyArray<string>]> =
  [
    [
      "smileys",
      "Smileys",
      [
        "😀 grinning: happy smile",
        "😃 smiley: happy joy",
        "😄 smile: happy laugh",
        "😁 beaming: grin teeth",
        "😆 laughing: lol haha",
        "😅 sweat smile: relief nervous",
        "😂 joy: lol tears funny laugh",
        "🤣 rofl: rolling laugh funny",
        "🙂 slight smile: ok fine",
        "🙃 upside down: silly sarcasm",
        "😉 wink: flirt",
        "😊 blush: happy shy",
        "😇 innocent: angel halo",
        "🥰 smiling with hearts: love adore",
        "😍 heart eyes: love wow",
        "🤩 star struck: wow amazing excited",
        "😘 kiss: blow love",
        "😋 yum: tasty delicious",
        "😛 tongue: silly playful",
        "😜 wink tongue: silly joke",
        "🤔 thinking: hmm consider",
        "🤨 raised eyebrow: skeptical doubt",
        "😐 neutral: meh blank",
        "😑 expressionless: unimpressed",
        "🙄 eye roll: annoyed whatever",
        "😏 smirk: smug",
        "😬 grimace: awkward yikes",
        "😌 relieved: calm peaceful",
        "😴 sleeping: tired zzz",
        "🤤 drooling: want hungry",
        "😎 sunglasses: cool",
        "🤓 nerd: geek glasses",
        "😕 confused: unsure puzzled",
        "😟 worried: concerned",
        "🥺 pleading: please puppy",
        "😢 cry: sad tear",
        "😭 sob: crying loud sad",
        "😤 huffing: frustrated proud",
        "😡 angry: mad rage",
        "🤯 mind blown: shocked explode",
        "😱 scream: fear shocked",
        "😳 flushed: embarrassed surprised",
        "🥳 party: celebrate birthday",
        "🤗 hug: thanks warm",
        "🫡 salute: respect ok",
        "🫠 melting: awkward overwhelmed",
      ],
    ],
    [
      "gestures",
      "People",
      [
        "👍 thumbs up: yes approve like good +1",
        "👎 thumbs down: no disapprove dislike -1",
        "👏 clap: applause bravo congrats",
        "🙌 raised hands: hooray celebrate praise",
        "🙏 pray: thanks please grateful",
        "🤝 handshake: deal agree",
        "👋 wave: hello bye hi",
        "✌️ victory: peace two",
        "🤞 fingers crossed: luck hope",
        "👌 ok hand: perfect fine",
        "🤌 pinched fingers: chef kiss italian",
        "💪 muscle: strong flex",
        "👀 eyes: look watching see",
        "🧠 brain: smart think",
        "🫶 heart hands: love care",
        "🤷 shrug: dunno idk",
        "🤦 facepalm: oops mistake",
        "🙋 raising hand: question me",
        "🫂 hug people: support comfort",
        "👑 crown: king queen",
      ],
    ],
    [
      "symbols",
      "Hearts & symbols",
      [
        "❤️ red heart: love",
        "🧡 orange heart: love",
        "💛 yellow heart: love",
        "💚 green heart: love",
        "💙 blue heart: love",
        "💜 purple heart: love",
        "🖤 black heart: love",
        "💔 broken heart: sad heartbreak",
        "💯 hundred: perfect score",
        "✅ check mark: done yes complete",
        "❌ cross: no wrong cancel",
        "⚠️ warning: caution careful",
        "❓ question: what why",
        "❗ exclamation: important alert",
        "➕ plus: add",
        "➖ minus: remove",
        "✨ sparkles: new magic shine",
        "⭐ star: favorite",
        "🔥 fire: hot lit awesome",
        "⚡ lightning: fast energy",
        "💥 collision: boom bang",
        "💡 light bulb: idea",
        "🎯 target: goal bullseye",
        "🚀 rocket: launch ship fast",
        "🏆 trophy: win champion",
        "🥇 gold medal: first winner",
      ],
    ],
    [
      "nature",
      "Nature",
      [
        "🐶 dog: puppy pet",
        "🐱 cat: kitten pet",
        "🦊 fox: clever",
        "🐻 bear: teddy",
        "🐼 panda: cute",
        "🦄 unicorn: magic",
        "🐢 turtle: slow",
        "🐌 snail: slow",
        "🐛 bug: insect issue defect",
        "🦋 butterfly: pretty",
        "🌱 seedling: grow new",
        "🌳 tree: nature",
        "🌸 blossom: flower spring",
        "🌈 rainbow: colors pride",
        "☀️ sun: sunny day",
        "🌙 moon: night",
        "⛅ cloud: weather",
        "❄️ snowflake: cold winter",
      ],
    ],
    [
      "food",
      "Food & drink",
      [
        "☕ coffee: tea hot drink",
        "🍵 tea: green hot drink",
        "🍺 beer: cheers drink",
        "🍷 wine: drink",
        "🥂 clinking glasses: cheers toast celebrate",
        "🍕 pizza: food",
        "🍔 burger: food",
        "🍟 fries: food",
        "🌮 taco: food",
        "🍣 sushi: food",
        "🍎 apple: fruit",
        "🍌 banana: fruit",
        "🍓 strawberry: fruit",
        "🍰 cake: dessert birthday",
        "🍪 cookie: dessert",
        "🍩 donut: dessert",
      ],
    ],
    [
      "objects",
      "Activities & objects",
      [
        "🎉 party popper: celebrate congrats tada",
        "🎊 confetti: celebrate party",
        "🎁 gift: present",
        "🎂 birthday cake: celebrate",
        "🎮 game: controller play",
        "🎵 music: note song",
        "📌 pushpin: pin important",
        "📎 paperclip: attach",
        "📝 memo: note write",
        "📅 calendar: date schedule",
        "📣 megaphone: announce",
        "🔔 bell: notification",
        "🔒 lock: secure private",
        "🔑 key: access",
        "🔧 wrench: fix tool",
        "🛠️ tools: build fix",
        "🧪 test tube: experiment test",
        "💻 laptop: computer code",
        "📦 package: ship box",
        "🚧 construction: wip work in progress",
        "🚢 ship: deploy release",
        "⏳ hourglass: waiting time",
        "⏰ alarm clock: time reminder",
      ],
    ],
  ];

function parseEntry(source: string): EmojiEntry {
  const space = source.indexOf(" ");
  const colon = source.indexOf(":");
  return {
    emoji: source.slice(0, space),
    name: source.slice(space + 1, colon),
    keywords: source
      .slice(colon + 1)
      .split(" ")
      .filter((word) => word !== ""),
  };
}

export const EMOJI_CATEGORIES: ReadonlyArray<EmojiCategory> = SOURCE.map(
  ([id, label, entries]) => ({ id, label, emojis: entries.map(parseEntry) }),
);

const ALL_EMOJI = EMOJI_CATEGORIES.flatMap((category) => category.emojis);

function scoreWord(word: string, term: string): number {
  if (word === term) return 3;
  if (word.startsWith(term)) return 2;
  return word.includes(term) ? 1 : 0;
}

/** Entries matching every term of the query, best matches first; names outrank keywords. */
export function searchEmoji(query: string): ReadonlyArray<EmojiEntry> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const scored: Array<{ entry: EmojiEntry; score: number; index: number }> = [];
  ALL_EMOJI.forEach((entry, index) => {
    const nameWords = entry.name.split(" ");
    let total = 0;
    for (const term of terms) {
      const inName = Math.max(...nameWords.map((word) => scoreWord(word, term)));
      const inKeywords = Math.max(0, ...entry.keywords.map((word) => scoreWord(word, term)));
      const best = Math.max(inName * 2, inKeywords);
      if (best === 0) {
        total = 0;
        break;
      }
      total += best;
    }
    if (total > 0) scored.push({ entry, score: total, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map(({ entry }) => entry);
}
