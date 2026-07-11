import { describe, expect, it } from "vitest";
import {
  parseIntegerArray,
  parseJsonRecord,
  parseStringArray,
} from "../src/util/json.js";

describe("JSON persistence helpers", () => {
  it("keeps only integers from persisted arrays", () => {
    expect(parseIntegerArray('[1,2.5,"3",4,null]')).toEqual([1, 4]);
  });

  it("keeps only strings from persisted arrays", () => {
    expect(parseStringArray('["idle",1,"favorite",null]')).toEqual([
      "idle",
      "favorite",
    ]);
  });

  it("returns an empty array for missing, malformed or non-array JSON", () => {
    for (const value of [undefined, null, "not-json", '{"value": 1}']) {
      expect(parseIntegerArray(value)).toEqual([]);
      expect(parseStringArray(value)).toEqual([]);
    }
  });

  it("parses records without accepting arrays or primitive values", () => {
    expect(parseJsonRecord('{"status":"online","count":2}')).toEqual({
      status: "online",
      count: 2,
    });
    for (const value of [undefined, null, "not-json", "[]", '"value"']) {
      expect(parseJsonRecord(value)).toEqual({});
    }
  });
});
