import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
  type ServerSettings,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { isConfiguredDefaultModel, planDefaultModelPatch } from "./defaultModelPatch";

const projectId = ProjectId.make("project-1");
const pick: ModelSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-opus-5-5",
  options: [{ id: "effort", value: "high" }],
};
const other: ModelSelection = { ...pick, model: "claude-sonnet-5-5", options: [] };

const withProjectDefault = (selection: ModelSelection | null): ServerSettings => ({
  ...DEFAULT_SERVER_SETTINGS,
  projectSettingsOverrides: {
    [projectId]: { defaultProjectScripts: [], defaultModelSelection: selection },
  },
});

it("writes where new threads read their default", () => {
  const base = { projectId, supportsOverrides: true, selection: pick } as const;

  expect(planDefaultModelPatch({ ...base, settings: DEFAULT_SERVER_SETTINGS })).toEqual({
    scope: "environment",
    patch: { defaultModelSelection: pick },
  });
  expect(planDefaultModelPatch({ ...base, settings: withProjectDefault(null) }).scope).toBe(
    "environment",
  );
  expect(
    planDefaultModelPatch({
      ...base,
      supportsOverrides: false,
      settings: withProjectDefault(other),
    }).scope,
  ).toBe("environment");

  const project = planDefaultModelPatch({ ...base, settings: withProjectDefault(other) });
  expect(project.scope).toBe("project");
  expect(project.patch.projectSettingsOverrides?.[projectId]).toEqual({
    defaultProjectScripts: [],
    defaultModelSelection: pick,
  });
});

it("compares the pick with the default new threads would use", () => {
  expect(isConfiguredDefaultModel(DEFAULT_SERVER_SETTINGS, projectId, pick)).toBe(false);
  expect(isConfiguredDefaultModel(withProjectDefault(pick), projectId, pick)).toBe(true);
  expect(isConfiguredDefaultModel(withProjectDefault(other), projectId, pick)).toBe(false);
});
