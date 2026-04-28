import { useCallback, useMemo, useState } from "react";

import type { DebugRequestEntry } from "../types";

function createDebugRequestId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function useDebugRequests() {
  const [debugRequests, setDebugRequests] = useState<DebugRequestEntry[]>([]);

  const pushDebugRequest = useCallback((question: string): { id: string; startedAt: number } => {
    const id = createDebugRequestId();
    const startedAt = performance.now();
    const nextEntry: DebugRequestEntry = {
      id,
      question,
      questionType: null,
      toolNames: [],
      success: null,
      durationMs: null,
      status: "running",
      startedAt: new Date().toISOString(),
      routeType: null,
      routeFamily: null,
    };

    setDebugRequests((current) => [nextEntry, ...current].slice(0, 8));

    return { id, startedAt };
  }, []);

  const patchDebugRequest = useCallback((
    id: string,
    updater: (entry: DebugRequestEntry) => DebugRequestEntry,
  ) => {
    setDebugRequests((current) =>
      current.map((entry) => (entry.id === id ? updater(entry) : entry)),
    );
  }, []);

  return useMemo(
    () => ({
      debugRequests,
      pushDebugRequest,
      patchDebugRequest,
    }),
    [debugRequests, patchDebugRequest, pushDebugRequest],
  );
}
