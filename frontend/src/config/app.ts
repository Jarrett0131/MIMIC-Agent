function normalizeUrl(value: string | undefined, fallback: string): string {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    return fallback;
  }

  return trimmedValue.replace(/\/$/, "");
}

export const appConfig = Object.freeze({
  agentServerUrl: normalizeUrl(
    import.meta.env.VITE_AGENT_SERVER_URL ??
      import.meta.env.VITE_AGENT_SERVER_BASE_URL,
    "http://localhost:3001",
  ),
  appTitle: import.meta.env.VITE_APP_TITLE?.trim() || "Clinical Data Agent Demo",
});
