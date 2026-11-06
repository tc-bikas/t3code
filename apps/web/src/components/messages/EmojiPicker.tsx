import { useState } from "react";

import { EMOJI_CATEGORIES, QUICK_REACTIONS, searchEmoji } from "../../team/emoji";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

function EmojiButton({
  emoji,
  label,
  onPick,
}: {
  readonly emoji: string;
  readonly label: string;
  readonly onPick: (emoji: string) => void;
}) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      title={label}
      onClick={() => onPick(emoji)}
    >
      <span className="text-base leading-none">{emoji}</span>
    </Button>
  );
}

const GRID = "grid grid-cols-8 gap-0.5";

/** A quick row, a search box, and the curated set by category. Mounted only while open. */
export function EmojiPicker({ onPick }: { readonly onPick: (emoji: string) => void }) {
  const [query, setQuery] = useState("");
  const results = searchEmoji(query);
  const searching = query.trim() !== "";
  return (
    <div className="flex flex-col gap-2">
      <Input
        autoFocus
        size="sm"
        type="search"
        aria-label="Search emoji"
        placeholder="Search emoji"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
        {searching ? (
          results.length > 0 ? (
            <div className={GRID}>
              {results.map((entry) => (
                <EmojiButton
                  key={entry.emoji}
                  emoji={entry.emoji}
                  label={entry.name}
                  onPick={onPick}
                />
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-muted-foreground">No emoji found</p>
          )
        ) : (
          <>
            <section aria-label="Frequently used" className={GRID}>
              {QUICK_REACTIONS.map((emoji) => (
                <EmojiButton
                  key={emoji}
                  emoji={emoji}
                  label={`React with ${emoji}`}
                  onPick={onPick}
                />
              ))}
            </section>
            {EMOJI_CATEGORIES.map((category) => (
              <section
                key={category.id}
                aria-label={category.label}
                className="flex flex-col gap-1"
              >
                <h3 className="px-1 text-3xs font-medium text-muted-foreground">
                  {category.label}
                </h3>
                <div className={GRID}>
                  {category.emojis.map((entry) => (
                    <EmojiButton
                      key={entry.emoji}
                      emoji={entry.emoji}
                      label={entry.name}
                      onPick={onPick}
                    />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
