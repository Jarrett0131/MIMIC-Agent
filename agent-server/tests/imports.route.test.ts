import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDeleteClinicalImport,
  mockFetchClinicalImportHistory,
  mockImportClinicalData,
  mockImportClinicalCsvData,
  mockImportClinicalExcelData,
  mockFetchPythonHealth,
} = vi.hoisted(() => ({
  mockDeleteClinicalImport: vi.fn(),
  mockFetchClinicalImportHistory: vi.fn(),
  mockImportClinicalData: vi.fn(),
  mockImportClinicalCsvData: vi.fn(),
  mockImportClinicalExcelData: vi.fn(),
  mockFetchPythonHealth: vi.fn(),
}));

vi.mock("../src/services/pythonClient", async () => {
  const actual = await vi.importActual<typeof import("../src/services/pythonClient")>(
    "../src/services/pythonClient",
  );

  return {
    ...actual,
    deleteClinicalImport: mockDeleteClinicalImport,
    fetchClinicalImportHistory: mockFetchClinicalImportHistory,
    importClinicalData: mockImportClinicalData,
    importClinicalCsvData: mockImportClinicalCsvData,
    importClinicalExcelData: mockImportClinicalExcelData,
    fetchPythonHealth: mockFetchPythonHealth,
  };
});

import app from "../src/app";
import { PythonClientError } from "../src/services/pythonClient";

describe("/imports/clinical-data", () => {
  beforeEach(() => {
    mockDeleteClinicalImport.mockReset();
    mockFetchClinicalImportHistory.mockReset();
    mockImportClinicalData.mockReset();
    mockImportClinicalCsvData.mockReset();
    mockImportClinicalExcelData.mockReset();
    mockFetchPythonHealth.mockReset();
  });

  it("returns import history from the Python service", async () => {
    mockFetchClinicalImportHistory.mockResolvedValue({
      items: [
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
      ],
      total: 1,
    });

    const response = await request(app).get("/imports/clinical-data");

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(mockFetchClinicalImportHistory).toHaveBeenCalledTimes(1);
  });

  it("proxies a valid import request to the Python service", async () => {
    mockImportClinicalData.mockResolvedValue({
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
    });

    const response = await request(app).post("/imports/clinical-data").send({
      dataset_name: "external-demo",
      bundle: {
        patients: [
          {
            hadm_id: 900001,
            patient_overview: {
              subject_id: 500001,
            },
          },
        ],
      },
    });

    expect(response.status).toBe(201);
    expect(response.body.hadm_ids).toEqual([900001]);
    expect(mockImportClinicalData).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed requests before proxying", async () => {
    const response = await request(app).post("/imports/clinical-data").send({
      dataset_name: "broken",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("bundle.patients");
    expect(mockImportClinicalData).not.toHaveBeenCalled();
  });

  it("forwards upstream validation errors", async () => {
    mockImportClinicalData.mockRejectedValueOnce(
      new PythonClientError("Import external clinical data failed (status 400): invalid bundle", 400),
    );

    const response = await request(app).post("/imports/clinical-data").send({
      bundle: {
        patients: [
          {
            hadm_id: 900001,
          },
        ],
      },
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("invalid bundle");
  });

  it("proxies CSV import requests to the Python service", async () => {
    mockImportClinicalCsvData.mockResolvedValue({
      import_id: "external-csv-1",
      dataset_name: "external-csv-demo",
      imported_at: "2026-04-16T12:00:00Z",
      stored_path: "/tmp/external-csv-demo.json",
      patient_count: 1,
      hadm_ids: [900002],
      record_counts: {
        diagnoses: 1,
        labs: 1,
        vitals: 1,
      },
    });

    const response = await request(app).post("/imports/clinical-data/csv").send({
      dataset_name: "external-csv-demo",
      csv_bundle: {
        patients_csv: "hadm_id,subject_id\n900002,500002",
      },
    });

    expect(response.status).toBe(201);
    expect(response.body.hadm_ids).toEqual([900002]);
    expect(mockImportClinicalCsvData).toHaveBeenCalledTimes(1);
  });

  it("proxies Excel import requests to the Python service", async () => {
    mockImportClinicalExcelData.mockResolvedValue({
      import_id: "external-xlsx-1",
      dataset_name: "external-xlsx-demo",
      imported_at: "2026-04-16T12:00:00Z",
      stored_path: "/tmp/external-xlsx-demo.json",
      patient_count: 1,
      hadm_ids: [900003],
      record_counts: {
        diagnoses: 1,
        labs: 1,
        vitals: 1,
      },
    });

    const response = await request(app).post("/imports/clinical-data/excel").send({
      dataset_name: "external-xlsx-demo",
      excel_bundle: {
        workbook_base64: "ZmFrZS14bHN4",
        workbook_name: "external-demo.xlsx",
      },
    });

    expect(response.status).toBe(201);
    expect(response.body.hadm_ids).toEqual([900003]);
    expect(mockImportClinicalExcelData).toHaveBeenCalledTimes(1);
  });

  it("deletes an imported dataset through the proxy", async () => {
    mockDeleteClinicalImport.mockResolvedValue({
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
    });

    const response = await request(app).delete("/imports/clinical-data/external-1");

    expect(response.status).toBe(200);
    expect(response.body.import_id).toBe("external-1");
    expect(mockDeleteClinicalImport).toHaveBeenCalledWith("external-1");
  });
});
