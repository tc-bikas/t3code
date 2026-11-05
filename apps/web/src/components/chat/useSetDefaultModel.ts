import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ModelSelection, ProjectId } from "@t3tools/contracts";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import { isConfiguredDefaultModel, planDefaultModelPatch } from "./defaultModelPatch";

/** Saves the composer's current model and options as the default for new threads. */
export function useSetDefaultModel(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly selection: ModelSelection;
}) {
  const { environmentId, projectId, selection } = input;
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const update = useAtomCommand(serverEnvironment.updateSettings, "Default model update");
  if (!config) return null;
  const { settings } = config;
  return {
    isDefault: isConfiguredDefaultModel(settings, projectId, selection),
    disabled: !canWrite,
    setDefault: async () => {
      const plan = planDefaultModelPatch({
        settings,
        projectId,
        supportsOverrides: config.environment.capabilities.projectSettingsOverrides === true,
        selection,
      });
      const result = await update({ environmentId, input: { patch: plan.patch } });
      if (result._tag !== "Success") return;
      toastManager.add({
        type: "success",
        title: "Default model saved",
        description:
          plan.scope === "project"
            ? "New threads in this project start on this model."
            : "New threads start on this model.",
      });
    },
  };
}
