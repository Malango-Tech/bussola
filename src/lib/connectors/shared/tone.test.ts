import { describe, expect, it } from "vitest";
import { toneClass } from "./tone";

describe("toneClass", () => {
  it("gives every tone its own tracker colour", () => {
    const classes = (["ok", "warn", "error", "idle"] as const).map(toneClass);
    expect(classes).toEqual([
      "bg-success",
      "bg-warning",
      "bg-destructive",
      "bg-muted-foreground/30",
    ]);
  });
});
