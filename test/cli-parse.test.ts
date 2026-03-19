import { describe, expect, it } from "vitest";
import { parseOnlyMessageIds } from "../src/cli-parse.js";

describe("parseOnlyMessageIds", () => {
  it("parses comma and space separated lists", () => {
    expect([...parseOnlyMessageIds("3,7,12")!].sort((a, b) => a - b)).toEqual([3, 7, 12]);
    expect([...parseOnlyMessageIds("3 7")!]).toEqual([3, 7]);
  });
  it("empty -> undefined", () => {
    expect(parseOnlyMessageIds(undefined)).toBeUndefined();
    expect(parseOnlyMessageIds("")).toBeUndefined();
  });
});
