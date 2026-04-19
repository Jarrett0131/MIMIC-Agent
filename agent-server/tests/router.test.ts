import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFetchPatient,
  mockFetchDiagnoses,
  mockFetchRecentLabs,
  mockFetchRecentVitals,
} = vi.hoisted(() => ({
  mockFetchPatient: vi.fn(),
  mockFetchDiagnoses: vi.fn(),
  mockFetchRecentLabs: vi.fn(),
  mockFetchRecentVitals: vi.fn(),
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
  };
});

import { routeQuestion } from "../src/services/router";

describe("routeQuestion", () => {
  beforeEach(() => {
    mockFetchPatient.mockReset();
    mockFetchDiagnoses.mockReset();
    mockFetchRecentLabs.mockReset();
    mockFetchRecentVitals.mockReset();
  });

  it("maps patient_info to the patient tool", async () => {
    mockFetchPatient.mockResolvedValue({
      hadm_id: 101,
      patient_overview: {},
      diagnoses: [],
    });

    const routedTool = routeQuestion(
      {
        hadm_id: 101,
        question: "patient overview for this admission",
      },
      "patient_info",
    );

    expect(routedTool.tool).toBe("fetchPatient");

    await routedTool.execute();

    expect(mockFetchPatient).toHaveBeenCalledWith(101);
  });

  it("maps diagnosis_query to the diagnoses tool", async () => {
    mockFetchDiagnoses.mockResolvedValue({
      hadm_id: 101,
      diagnoses: [],
    });

    const routedTool = routeQuestion(
      {
        hadm_id: 101,
        question: "icd codes for this patient",
      },
      "diagnosis_query",
    );

    expect(routedTool.tool).toBe("fetchDiagnoses");

    await routedTool.execute();

    expect(mockFetchDiagnoses).toHaveBeenCalledWith(101);
  });

  it("maps lab_query to the labs tool", async () => {
    mockFetchRecentLabs.mockResolvedValue({
      hadm_id: 101,
      keyword: "glucose",
      records: [],
    });

    const routedTool = routeQuestion(
      {
        hadm_id: 101,
        question: "latest glucose lab result",
      },
      "lab_query",
    );

    expect(routedTool.tool).toBe("fetchRecentLabs");

    await routedTool.execute();

    expect(mockFetchRecentLabs).toHaveBeenCalledWith(101, "glucose", 100);
  });

  it("maps vital_query to the vitals tool", async () => {
    mockFetchRecentVitals.mockResolvedValue({
      hadm_id: 101,
      keyword: "heart rate",
      records: [],
    });

    const routedTool = routeQuestion(
      {
        hadm_id: 101,
        question: "latest heart rate vital sign",
      },
      "vital_query",
    );

    expect(routedTool.tool).toBe("fetchRecentVitals");

    await routedTool.execute();

    expect(mockFetchRecentVitals).toHaveBeenCalledWith(101, "heart rate", 100);
  });

  it("maps knowledge questions to the rag tool", async () => {
    const routedTool = routeQuestion(
      {
        hadm_id: 101,
        question: "WBC 是什么意思？",
      },
      "metric_explanation",
    );

    expect(routedTool.tool).toBe("retrieveKnowledge");

    const result = await routedTool.execute();

    expect(result.tool).toBe("retrieveKnowledge");
    expect(result.result_count).toBeGreaterThan(0);
    expect(result.data).toMatchObject({
      route_type: "metric_explanation",
      retriever: "hybrid",
    });
  });
});
