import { Request, Response, Router } from "express";

import { fetchRecentLabs, PythonClientError } from "../services/pythonClient";

const router = Router();

router.get("/recent", async (req: Request, res: Response) => {
  const hadmId = Number.parseInt(String(req.query.hadm_id ?? ""), 10);
  const keyword = String(req.query.keyword ?? "").trim();
  const rawLimit = Number.parseInt(String(req.query.limit ?? "12"), 10);
  const limit = Number.isNaN(rawLimit) ? 12 : rawLimit;

  if (Number.isNaN(hadmId) || hadmId <= 0) {
    res.status(400).json({ error: "Invalid hadm_id." });
    return;
  }

  if (!keyword) {
    res.status(400).json({ error: "Missing query parameter: keyword." });
    return;
  }

  try {
    const records = await fetchRecentLabs(hadmId, keyword, limit);
    res.json(records);
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
