import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useId, useState, type ComponentProps, type ReactNode } from "react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../components/ui/input-group";
import { Label } from "../components/ui/label";

function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | null | undefined;
  readonly htmlFor: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

type FieldProps = {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | null | undefined;
};

export function TeamTextField({
  label,
  hint,
  error,
  ...inputProps
}: FieldProps & Omit<ComponentProps<typeof Input>, "id" | "size">) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...inputProps}
      />
    </Field>
  );
}

export function TeamPasswordField({
  label,
  hint,
  error,
  ...inputProps
}: FieldProps & Omit<ComponentProps<typeof Input>, "id" | "size" | "type">) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <InputGroup>
        <InputGroupInput
          id={id}
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          spellCheck={false}
          {...inputProps}
        />
        <InputGroupAddon align="inline-end">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost-muted"
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {visible ? <EyeOffIcon /> : <EyeIcon />}
          </Button>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  );
}
