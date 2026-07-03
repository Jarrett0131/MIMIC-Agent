import { Request, Response, Router } from "express";

import {
  deleteClinicalImport,
  fetchClinicalImportHistory,
  fetchDiagnoses,
  fetchPatient,
  fetchPatientIds,
  fetchRecentLabs,
  fetchRecentVitals,
  importClinicalCsvData,
  importClinicalData,
  importClinicalExcelData,
  PythonClientError,
} from "../services/pythonClient";
import type {
  ClinicalDataCsvImportRequest,
  ClinicalDataExcelImportRequest,
  ClinicalDataImportRequest,
} from "../types";

/**
 * REST passthrough routes the frontend uses directly for structured data
 * (patient selection, evidence panels, data import). These proxy the Python
 * data-service and are separate from the agent chat route (routes/ask.ts).
 */

function sendError(res: Response, error: unknown): void {
  if (error instanceof PythonClientError) {
    res.status(error.status ?? 502).json({ error: error.message });
    return;
  }

  const message = error instanceof Error ? error.message : "Internal server error.";
  res.status(500).json({ error: message });
}

function parseHadmId(raw: unknown): number | null {
  const hadmId = Number.parseInt(String(raw ?? ""), 10);
  return Number.isNaN(hadmId) || hadmId <= 0 ? null : hadmId;
}

function parseLimit(raw: unknown, fallback = 12): number {
  const limit = Number.parseInt(String(raw ?? ""), 10);
  return Number.isNaN(limit) ? fallback : limit;
}

// --- patient ---------------------------------------------------------------

export const patientRouter = Router();

patientRouter.get("/:hadm_id", async (req: Request, res: Response) => {
  const hadmId = parseHadmId(req.params.hadm_id);
  if (!hadmId) {
    res.status(400).json({ error: "Invalid hadm_id." });
    return;
  }

  try {
    res.json(await fetchPatient(hadmId));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

export const patientsRouter = Router();

patientsRouter.get("/ids", async (_req: Request, res: Response) => {
  try {
    res.json(await fetchPatientIds());
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// --- diagnoses -------------------------------------------------------------

export const diagnosesRouter = Router();

diagnosesRouter.get("/:hadm_id", async (req: Request, res: Response) => {
  const hadmId = parseHadmId(req.params.hadm_id);
  if (!hadmId) {
    res.status(400).json({ error: "Invalid hadm_id." });
    return;
  }

  try {
    res.json(await fetchDiagnoses(hadmId));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// --- labs / vitals ---------------------------------------------------------

function buildMeasurementRouter(
  fetcher: (hadmId: number, keyword: string, limit: number) => Promise<unknown>,
): Router {
  const router = Router();

  router.get("/recent", async (req: Request, res: Response) => {
    const hadmId = parseHadmId(req.query.hadm_id);
    const keyword = String(req.query.keyword ?? "").trim();

    if (!hadmId) {
      res.status(400).json({ error: "Invalid hadm_id." });
      return;
    }
    if (!keyword) {
      res.status(400).json({ error: "Missing query parameter: keyword." });
      return;
    }

    try {
      res.json(await fetcher(hadmId, keyword, parseLimit(req.query.limit)));
    } catch (error: unknown) {
      sendError(res, error);
    }
  });

  return router;
}

export const labsRouter = buildMeasurementRouter(fetchRecentLabs);
export const vitalsRouter = buildMeasurementRouter(fetchRecentVitals);

// --- imports ---------------------------------------------------------------

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
    typeof (payload.excel_bundle as { workbook_base64?: unknown }).workbook_base64 ===
      "string"
  );
}

export const importsRouter = Router();

importsRouter.get("/clinical-data", async (_req: Request, res: Response) => {
  try {
    res.json(await fetchClinicalImportHistory());
  } catch (error: unknown) {
    sendError(res, error);
  }
});

importsRouter.post("/clinical-data", async (req: Request, res: Response) => {
  if (!isImportRequest(req.body)) {
    res.status(400).json({ error: 'Request body must include a "bundle.patients" array.' });
    return;
  }
  try {
    res.status(201).json(await importClinicalData(req.body));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

importsRouter.post("/clinical-data/csv", async (req: Request, res: Response) => {
  if (!isCsvImportRequest(req.body)) {
    res.status(400).json({ error: 'Request body must include a "csv_bundle.patients_csv" string.' });
    return;
  }
  try {
    res.status(201).json(await importClinicalCsvData(req.body));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

importsRouter.post("/clinical-data/excel", async (req: Request, res: Response) => {
  if (!isExcelImportRequest(req.body)) {
    res.status(400).json({ error: 'Request body must include a "excel_bundle.workbook_base64" string.' });
    return;
  }
  try {
    res.status(201).json(await importClinicalExcelData(req.body));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

importsRouter.delete("/clinical-data/:import_id", async (req: Request, res: Response) => {
  const importId = String(req.params.import_id ?? "").trim();
  if (!importId) {
    res.status(400).json({ error: "Invalid import_id." });
    return;
  }
  try {
    res.json(await deleteClinicalImport(importId));
  } catch (error: unknown) {
    sendError(res, error);
  }
});
