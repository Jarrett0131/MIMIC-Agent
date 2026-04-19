import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import App from "../src/App";

vi.mock("../src/components/ChatPanel", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));

vi.mock("../src/components/DashboardHeader", () => ({
  DashboardHeader: () => <div data-testid="dashboard-header" />,
}));

vi.mock("../src/components/DevDebugPanel", () => ({
  DevDebugPanel: () => null,
}));

vi.mock("../src/components/PatientDataCanvas", () => ({
  PatientDataCanvas: () => <div data-testid="patient-data-canvas" />,
}));

vi.mock("../src/hooks/useClinicalImports", () => ({
  useClinicalImports: () => ({
    importState: {
      loading: false,
      error: "",
      summary: null,
      history: [],
      historyLoading: false,
      deletingImportId: null,
    },
    refreshImportHistory: () => undefined,
    handleImportClinicalData: () => undefined,
    handleDeleteImport: () => undefined,
  }),
}));

vi.mock("../src/hooks/useDashboardData", () => ({
  useDashboardData: () => ({
    vitals: [],
    labs: [],
    loading: false,
    error: "",
  }),
}));

vi.mock("../src/hooks/useDebugRequests", () => ({
  useDebugRequests: () => ({
    debugRequests: [],
    pushDebugRequest: () => ({
      id: "debug-request-1",
      startedAt: performance.now(),
    }),
    patchDebugRequest: () => undefined,
  }),
}));

vi.mock("../src/hooks/usePatientOptions", () => ({
  usePatientOptions: () => ({
    patientOptions: [],
    patientOptionsTotal: 0,
    patientOptionsLoading: false,
    patientOptionsError: "",
    reloadPatientOptions: () => undefined,
  }),
}));

describe("App import dialog", () => {
  it("traps focus inside the import dialog and restores focus when closed", async () => {
    const user = userEvent.setup();

    render(<App />);

    const toggleButton = screen.getByRole("button", { name: "导入外部数据" });
    toggleButton.focus();
    expect(document.activeElement).toBe(toggleButton);

    await user.click(toggleButton);

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("tab", { name: "CSV 表格" }),
      );
    });

    const refreshButton = screen.getByRole("button", { name: "刷新" });

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(refreshButton);

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "CSV 表格" }),
    );

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "导入外部数据" })).toBeNull();
      expect(document.activeElement).toBe(toggleButton);
    });
  });
});
