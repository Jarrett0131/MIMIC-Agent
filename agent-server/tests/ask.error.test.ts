import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFetchPatient,
  mockFetchDiagnoses,
  mockFetchRecentLabs,
  mockFetchRecentVitals,
  mockFetchPythonHealth,
} = vi.hoisted(() => ({
  mockFetchPatient: vi.fn(),
  mockFetchDiagnoses: vi.fn(),
  mockFetchRecentLabs: vi.fn(),
  mockFetchRecentVitals: vi.fn(),
  mockFetchPythonHealth: vi.fn(),
}));

vi.mock("../src/services/pythonClient", async () => {
  const actual = await vi.importActual<typeof import("../src/services/pythonClient")>(
    "../src/services/pythonClient",
  );

  return {
    ...actual,
    fetchPatient: mockFetchPatient,
    fetchDiagnoses: mockFetchDiagnoses,
    fetchRecentLabs: mockFetchRecentLabs,
    fetchRecentVitals: mockFetchRecentVitals,
    fetchPythonHealth: mockFetchPythonHealth,
  };
});

import app from "../src/app";
import { PythonClientError } from "../src/services/pythonClient";

describe("/ask error handling", () => {
  beforeEach(() => {
    mockFetchPatient.mockReset();
    mockFetchDiagnoses.mockReset();
    mockFetchRecentLabs.mockReset();
    mockFetchRecentVitals.mockReset();
    mockFetchPythonHealth.mockReset();
  });

  it("returns the unified error shape when the Python service is unreachable", async () => {
    mockFetchRecentLabs.mockRejectedValueOnce(
      new PythonClientError("Python data-service is unreachable", 502),
    );

    const response = await request(app).post("/ask").send({
      hadm_id: 100001,
      question: "latest lactate lab result",
    });

    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: "PYTHON_SERVICE_ERROR",
        source: "python-service",
      },
    });
    expect(Array.isArray(response.body.workflow_state)).toBe(true);
    expect(response.body.workflow_state).toContain("error");
    expect(Array.isArray(response.body.tool_trace)).toBe(true);
  });

  it("returns success=false with error details when tool argument resolution fails", async () => {
    const response = await request(app).post("/ask").send({
      hadm_id: 100001,
      question: "latest potassium lab result",
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBeTruthy();
    expect(response.body.error.code).toBe("TOOL_ARGUMENT_NOT_SUPPORTED");
    expect(response.body.workflow_state).toContain("error");
  });
});
