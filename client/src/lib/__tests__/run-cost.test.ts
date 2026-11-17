/**
 * @file run-cost.test.ts
 * @description Claude Code's run cost is shown only for Claude models.
 */
import { describe, expect, it } from "vitest";
import { claudeCostApplies } from "../run-cost";

describe("claudeCostApplies", () => {
  it("accepts Claude models", () => {
    expect(claudeCostApplies(["claude-opus-5-5", "claude-haiku-5-5"])).toBe(true);
  });
  it("rejects a local or gateway model", () => {
    expect(claudeCostApplies(["qwen3-coder-next"])).toBe(false);
    expect(claudeCostApplies(["claude-haiku-5-5", "qwen3-coder-next:latest"])).toBe(false);
    expect(claudeCostApplies(["cloud-strong"])).toBe(false);
  });
  it("keeps the cost when no model is known yet", () => {
    expect(claudeCostApplies([])).toBe(true);
    expect(claudeCostApplies([undefined, null, ""])).toBe(true);
  });
});
