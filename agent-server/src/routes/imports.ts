import { Request, Response, Router } from "express";

import {
  deleteClinicalImport,
  fetchClinicalImportHistory,
  importClinicalCsvData,
  importClinicalExcelData,
  importClinicalData,
  PythonClientError,
} from "../services/pythonClient";
import type {
  ClinicalDataCsvImportRequest,
  ClinicalDataExcelImportRequest,
  ClinicalDataImportRequest,
} from "../types";

const router = Router();

router.get("/clinical-data", async (_req: Request, res: Response) => {
  try {
    const response = await fetchClinicalImportHistory();
    res.json(response);
  } catch (error: unknown) {
    if (error instanceof PythonClientError) {
      res.status(error.status ?? 502).json({ error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Internal server error.";
    res.status(500).json({ error: message });
  }
});

function isImportRequest(value: unknown): value is ClinicalDataImportRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const payload = value as Partial<ClinicalDataImportRequest>;
  return (
    typeof payload.bundle === "object" &&
    payload.bundle !== null &&
    Array.isArray((payload.bundle as { patients?: unknown[] }).patients)
  );
}

function isCsvImportRequest(value: unknown): value is ClinicalDataCsvImportRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const payload = value as Partial<ClinicalDataCsvImportRequest>;
  return (
    typeof payload.csv_bundle === "object" &&
    payload.csv_bundle !== null &&
    typeof (payload.csv_bundle as { patients_csv?: unknown }).patients_csv === "string"
  );
}

function isExcelImportRequest(value: unknown): value is ClinicalDataExcelImportRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const payload = value as Partial<ClinicalDataExcelImportRequest>;
  return (
    typeof payload.excel_bundle === "object" &&
    payload.excel_bundle !== null &&
    typeof (payload.excel_bundle as { workbook_base64?: unknown }).workbook_base64 === "string"
  );
}

router.post("/clinical-data", async (req: Request, res: Response) => {
  if (!isImportRequest(req.body)) {
    res.status(400).json({
      error: 'Request body must include a "bundle.patients" array.',
    });
    return;
  }

  try {
    const response = await importClinicalData(req.body);
    res.status(201).json(response);
  } catch (error: unknown) {
    if (error instanceof PythonClientError) {
      res.status(error.status ?? 502).json({ error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Internal server error.";
    res.status(500).json({ error: message });
  }
});

router.post("/clinical-data/csv", async (req: Request, res: Response) => {
  if (!isCsvImportRequest(req.body)) {
    res.status(400).json({
      error: 'Request body must include a "csv_bundle.patients_csv" string.',
    });
    return;
  }

  try {
    const response = await importClinicalCsvData(req.body);
    res.status(201).json(response);
  } catch (error: unknown) {
    if (error instanceof PythonClientError) {
      res.status(error.status ?? 502).json({ error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Internal server error.";
    res.status(500).json({ error: message });
  }
});

router.post("/clinical-data/excel", async (req: Request, res: Response) => {
  if (!isExcelImportRequest(req.body)) {
    res.status(400).json({
      error: 'Request body must include a "excel_bundle.workbook_base64" string.',
    });
    return;
  }

  try {
    const response = await importClinicalExcelData(req.body);
    res.status(201).json(response);
  } catch (error: unknown) {
    if (error instanceof PythonClientError) {
      res.status(error.status ?? 502).json({ error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Internal server error.";
    res.status(500).json({ error: message });
  }
});

router.delete("/clinical-data/:import_id", async (req: Request, res: Response) => {
  const importId = String(req.params.import_id ?? "").trim();
  if (!importId) {
    res.status(400).json({ error: "Invalid import_id." });
    return;
  }

  try {
    const response = await deleteClinicalImport(importId);
    res.json(response);
  } catch (error: unknown) {
    if (error instanceof PythonClientError) {
      res.status(error.status ?? 502).json({ error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Internal server error.";
    res.status(500).json({ error: message });
  }
});

export default router;
