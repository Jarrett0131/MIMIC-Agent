import { Request, Response, Router } from "express";

import { fetchPatient, PythonClientError } from "../services/pythonClient";

const router = Router();

router.get("/:hadm_id", async (req: Request, res: Response) => {
  const hadmId = Number.parseInt(req.params.hadm_id, 10);
  if (Number.isNaN(hadmId) || hadmId <= 0) {
    res.status(400).json({ error: "Invalid hadm_id." });
    return;
  }

  try {
    const patient = await fetchPatient(hadmId);
    res.json(patient);
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
