import { cn } from "../lib/utils";
import { teamInitials } from "./team.logic";

export function TeamAvatar({
  name,
  size = "md",
}: {
  readonly name: string;
  readonly size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-primary/12 font-medium text-foreground",
        size === "sm" ? "size-5 text-3xs" : "size-10 text-sm",
      )}
    >
      {teamInitials(name)}
    </span>
  );
}
