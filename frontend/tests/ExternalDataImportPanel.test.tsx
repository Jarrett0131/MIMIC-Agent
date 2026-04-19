import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ExternalDataImportPanel } from "../src/components/ExternalDataImportPanel";

describe("ExternalDataImportPanel", () => {
  it("submits the CSV sample in the default mode", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();

    render(
      <ExternalDataImportPanel
        importing={false}
        error=""
        lastImport={null}
        history={[]}
        historyLoading={false}
        deletingImportId={null}
        onImport={onImport}
        onDeleteImport={() => undefined}
        onRefreshHistory={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "填充 CSV 示例" }));
    await user.click(screen.getByRole("button", { name: "开始导入" }));

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0]?.[0]).toMatchObject({
      mode: "csv",
    });
    expect(onImport.mock.calls[0]?.[0].csvBundle.patientsCsv).toContain("hadm_id");
  });

  it("switches to JSON mode and submits the JSON sample", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();

    render(
      <ExternalDataImportPanel
        importing={false}
        error=""
        lastImport={null}
        history={[]}
        historyLoading={false}
        deletingImportId={null}
        onImport={onImport}
        onDeleteImport={() => undefined}
        onRefreshHistory={() => undefined}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "JSON 数据包" }));
    await user.click(screen.getByRole("button", { name: "填充 JSON 示例" }));
    await user.click(screen.getByRole("button", { name: "开始导入" }));

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0]?.[0]).toMatchObject({
      mode: "json",
    });
    expect(onImport.mock.calls[0]?.[0].rawJson).toContain('"patients"');
  });

  it("switches to Excel mode and submits the selected workbook", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    const { container } = render(
      <ExternalDataImportPanel
        importing={false}
        error=""
        lastImport={null}
        history={[]}
        historyLoading={false}
        deletingImportId={null}
        onImport={onImport}
        onDeleteImport={() => undefined}
        onRefreshHistory={() => undefined}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Excel 工作簿" }));

    const file = new File(["excel-binary"], "external-demo.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new TextEncoder().encode("excel-binary").buffer,
    });

    const input = container.querySelector(
      'input[accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]',
    ) as HTMLInputElement | null;

    expect(input).toBeTruthy();
    await user.upload(input as HTMLInputElement, file);
    await user.click(screen.getByRole("button", { name: "开始导入" }));

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0]?.[0]).toMatchObject({
      mode: "excel",
      workbookName: "external-demo.xlsx",
    });
    expect(onImport.mock.calls[0]?.[0].workbookBase64.length).toBeGreaterThan(0);
  });

  it("renders import history and deletes an item", async () => {
    const user = userEvent.setup();
    const onDeleteImport = vi.fn();

    render(
      <ExternalDataImportPanel
        importing={false}
        error=""
        lastImport={null}
        history={[
          {
            import_id: "external-1",
            dataset_name: "external-demo",
            imported_at: "2026-04-16T12:00:00Z",
            stored_path: "/tmp/external-demo.json",
            patient_count: 1,
            hadm_ids: [900001],
            record_counts: {
              diagnoses: 1,
              labs: 1,
              vitals: 1,
            },
          },
        ]}
        historyLoading={false}
        deletingImportId={null}
        onImport={() => undefined}
        onDeleteImport={onDeleteImport}
        onRefreshHistory={() => undefined}
      />,
    );

    expect(screen.getByText("external-demo")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "删除" }));

    expect(onDeleteImport).toHaveBeenCalledWith("external-1");
  });
});
