import { cn } from "../lib/utils";
import { teamInitials } from "./team.logic";

export function TeamAvatar({
  name,
  avatarUrl,
  size = "md",
}: {
  readonly name: string;
  readonly avatarUrl?: string | null | undefined;
  readonly size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 overflow-hidden items-center justify-center rounded-full bg-primary/12 font-medium text-foreground",
        size === "sm" ? "size-5 text-3xs" : "size-10 text-sm",
      )}
    >
      {teamInitials(name)}
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="absolute inset-0 size-full object-cover"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
    </span>
  );
}
