import { ExternalLinkIcon } from "lucide-react";

import { Alert, AlertAction, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";

/** Shown wherever the Team server answers with a link instead of sending an email. */
export function DevMailLink({
  devLink,
  label = "Open link",
}: {
  readonly devLink: string;
  readonly label?: string;
}) {
  return (
    <Alert variant="info" role="note">
      <AlertDescription>Dev mode: no email is sent. Open this link instead.</AlertDescription>
      <AlertAction>
        <Button
          size="xs"
          variant="outline"
          render={<a href={devLink} target="_blank" rel="noreferrer noopener" />}
        >
          {label}
          <ExternalLinkIcon />
        </Button>
      </AlertAction>
    </Alert>
  );
}
