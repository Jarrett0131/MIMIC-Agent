import cors from "cors";
import express from "express";

import askRouter from "./routes/ask";
import {
  diagnosesRouter,
  importsRouter,
  labsRouter,
  patientRouter,
  patientsRouter,
  vitalsRouter,
} from "./routes/rest";
import { fetchPythonHealth, PythonClientError } from "./services/pythonClient";

const app = express();

app.use(cors());
app.use(express.json({ limit: "25mb" }));

app.get("/health", async (_req, res) => {
  try {
    await fetchPythonHealth();
    res.json({ status: "ok", python_service: "ok" });
  } catch (error: unknown) {
    if (error instanceof PythonClientError) {
      res.json({
        status: "degraded",
        python_service: "unreachable",
        detail: error.message,
      });
      return;
    }

    res.json({
      status: "degraded",
      python_service: "unreachable",
    });
  }
});

app.use("/ask", askRouter);
app.use("/imports", importsRouter);
app.use("/labs", labsRouter);
app.use("/vitals", vitalsRouter);
app.use("/patient", patientRouter);
app.use("/patients", patientsRouter);
app.use("/diagnoses", diagnosesRouter);

export default app;
