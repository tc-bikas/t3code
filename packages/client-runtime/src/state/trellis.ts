import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { createEnvironmentRpcCommand } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createTrellisEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    // Commands, not cached queries: the dialog rechecks when the window regains focus.
    status: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:trellis:status",
      tag: WS_METHODS.trellisStatus,
    }),
    startConnect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:trellis:start-connect",
      tag: WS_METHODS.trellisStartConnect,
    }),
    searchIssues: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:trellis:search-issues",
      tag: WS_METHODS.trellisSearchIssues,
    }),
    disconnect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:trellis:disconnect",
      tag: WS_METHODS.trellisDisconnect,
    }),
  };
}
