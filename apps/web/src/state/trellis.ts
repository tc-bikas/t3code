import { createTrellisEnvironmentAtoms } from "@t3tools/client-runtime/state/trellis";

import { connectionAtomRuntime } from "../connection/runtime";

export const trellisEnvironment = createTrellisEnvironmentAtoms(connectionAtomRuntime);
