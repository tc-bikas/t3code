import { createFileRoute } from "@tanstack/react-router";

import { OrganisationSettings } from "../components/settings/OrganisationSettings";

export const Route = createFileRoute("/_chat/settings/organisation")({
  component: OrganisationSettings,
});
