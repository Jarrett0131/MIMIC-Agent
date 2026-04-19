import { Request, Response, Router } from "express";

import { fetchPatientIds, PythonClientError } from "../services/pythonClient";

const router = Router();

router.get("/ids", async (_req: Request, res: Response) => {
  try {
    const payload = await fetchPatientIds();
    res.json(payload);
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
