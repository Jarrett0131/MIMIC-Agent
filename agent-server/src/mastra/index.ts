import { Mastra } from "@mastra/core/mastra";

import { mimicAgent } from "./agents/mimicAgent";

export const mastra = new Mastra({
  agents: { mimicAgent },
  server: {
    // Keep Studio / the Mastra dev server off :3001, which belongs to the
    // Express agent-server the frontend talks to.
    port: 4111,
  },
});
