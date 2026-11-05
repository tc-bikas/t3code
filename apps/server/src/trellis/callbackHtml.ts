const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );

const STYLES = `
  :root { color-scheme: light dark; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px 16px; background: #f6f7f9; color: #17191f; }
  main { width: min(100%, 440px); }
  h1 { margin: 0 0 8px; font-size: 20px; }
  p { margin: 0 0 12px; line-height: 1.5; color: #4b5060; }
  @media (prefers-color-scheme: dark) {
    body { background: #0f1115; color: #e6e8ee; }
    p { color: #a0a6b4; }
  }
`;

export function renderTrellisCallbackPage(
  result: { readonly connected: true } | { readonly connected: false; readonly reason: string },
): string {
  const title = result.connected ? "Trellis connected" : "Trellis wasn't connected";
  const body = result.connected
    ? "<p>You can close this tab and return to T3 Code.</p>"
    : `<p>${escapeHtml(result.reason)}</p><p>Close this tab and try again from T3 Code.</p>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${escapeHtml(title)}</title>
    <style>${STYLES}</style>
  </head>
  <body>
    <main><h1>${escapeHtml(title)}</h1>${body}</main>
  </body>
</html>`;
}
