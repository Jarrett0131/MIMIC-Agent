import { describe, expect, it } from "vitest";

import { loadPhase3EvalDataset } from "../src/evaluation/evalDataset";

describe("phase3 evaluation dataset", () => {
  it("loads the evalset and validates the required structure", async () => {
    const { dataset } = await loadPhase3EvalDataset("../evaluation/datasets/phase3_evalset.json");

    expect(dataset.version).toBe("phase3.v1");
    expect(dataset.samples.length).toBeGreaterThanOrEqual(30);
    expect(
      dataset.samples.filter((sample) => sample.category === "structured").length,
    ).toBeGreaterThan(0);
    expect(dataset.samples.filter((sample) => sample.category === "rag").length).toBeGreaterThan(0);
    expect(
      dataset.samples.filter((sample) => sample.category === "follow_up").length,
    ).toBeGreaterThan(0);

    dataset.samples.forEach((sample) => {
      expect(sample.id).toBeTruthy();
      expect(sample.question).toBeTruthy();
      expect(sample.expected_route).toBeTruthy();
      expect(sample.expected_tool).toBeTruthy();

      if (sample.category === "rag") {
        expect(sample.expected_titles?.length ?? 0).toBeGreaterThan(0);
      }
    });
  });
});

