import type {
  ModelSelection,
  ProjectId,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import { modelSelectionsEqual } from "@t3tools/shared/model";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

/**
 * New threads read a project's own default when it sets one, so that is where a pick must land
 * to take effect. Everything else follows the environment default.
 */
function writesProjectOverride(input: {
  readonly settings: ServerSettings;
  readonly projectId: ProjectId | null;
  readonly supportsOverrides: boolean;
}) {
  return (
    input.supportsOverrides &&
    input.projectId !== null &&
    (input.settings.projectSettingsOverrides[input.projectId]?.defaultModelSelection ?? null) !==
      null
  );
}

export function planDefaultModelPatch(input: {
  readonly settings: ServerSettings;
  readonly projectId: ProjectId | null;
  readonly supportsOverrides: boolean;
  readonly selection: ModelSelection;
}): { readonly patch: ServerSettingsPatch; readonly scope: "project" | "environment" } {
  if (input.projectId !== null && writesProjectOverride(input)) {
    return {
      scope: "project",
      patch: {
        projectSettingsOverrides: {
          [input.projectId]: {
            ...input.settings.projectSettingsOverrides[input.projectId],
            defaultModelSelection: input.selection,
          },
        },
      },
    };
  }
  return { scope: "environment", patch: { defaultModelSelection: input.selection } };
}

export function isConfiguredDefaultModel(
  settings: ServerSettings,
  projectId: ProjectId | null,
  selection: ModelSelection,
) {
  const configured = resolveProjectSettings(settings, projectId).settings.defaultModelSelection;
  return configured !== null && modelSelectionsEqual(configured, selection);
}
