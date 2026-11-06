import { Check, Copy } from "lucide";
import { isValidElement, memo, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { ensureLocalApi } from "../../localApi";
import { parsePullRequestUrl } from "../../team/messages.logic";
import { MorphIcon } from "../MorphIcon";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Button } from "../ui/button";

const OPENABLE_URL = /^(?:https?:|mailto:)/i;
const REMARK_PLUGINS = [remarkGfm];
const DISALLOWED_ELEMENTS = ["img", "table", "thead", "tbody", "tr", "th", "td", "input"];

function MessageLink({
  href,
  children,
}: {
  href?: string | undefined;
  children?: React.ReactNode;
}) {
  if (href === undefined || !OPENABLE_URL.test(href)) return <>{children}</>;
  const pull = children === href ? parsePullRequestUrl(href) : null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        void ensureLocalApi().shell.openExternal(href);
      }}
      className={
        pull
          ? "inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 align-middle text-xs text-foreground no-underline hover:bg-accent"
          : "text-primary underline underline-offset-2 hover:text-primary/80"
      }
    >
      {pull ? (
        <>
          <PullRequestGlyph.pullRequest className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {pull.repository} #{pull.number}
          </span>
        </>
      ) : (
        children
      )}
    </a>
  );
}

function CodeBlock({ code, children }: { code: string; children: React.ReactNode }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 1500, target: "code" });
  return (
    <div className="group/code relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre">
        {children}
      </pre>
      <div className="absolute top-1 right-1 opacity-0 transition-opacity group-focus-within/code:opacity-100 group-hover/code:opacity-100">
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Copy code"
          onClick={() => copyToClipboard(code, undefined)}
        >
          <MorphIcon className="size-3.5" icon={isCopied ? Check : Copy} />
        </Button>
      </div>
    </div>
  );
}

const Heading = ({ children }: { children?: React.ReactNode }) => (
  <p className="font-semibold whitespace-pre-line">{children}</p>
);

const COMPONENTS: Components = {
  a: MessageLink,
  p: ({ children }) => <p className="whitespace-pre-line">{children}</p>,
  h1: Heading,
  h2: Heading,
  h3: Heading,
  h4: Heading,
  h5: Heading,
  h6: Heading,
  ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="whitespace-pre-line">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border" />,
  code: ({ children }) => (
    <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs [pre_&]:bg-transparent [pre_&]:p-0">
      {children}
    </code>
  ),
  pre: ({ children }) => {
    const inner = isValidElement<{ children?: unknown }>(children) ? children.props.children : "";
    return (
      <CodeBlock code={typeof inner === "string" ? inner.replace(/\n$/, "") : ""}>
        {children}
      </CodeBlock>
    );
  },
};

/** Memoized per body: long threads re-render often and the Markdown parse is the costly part. */
export const MessageMarkdown = memo(function MessageMarkdown({ body }: { readonly body: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-sm leading-relaxed wrap-anywhere text-foreground">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        components={COMPONENTS}
        disallowedElements={DISALLOWED_ELEMENTS}
        unwrapDisallowed
        skipHtml
      >
        {body}
      </ReactMarkdown>
    </div>
  );
});
