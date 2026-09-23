import { afterEach, describe, expect, it, vi } from "vitest";
import { logger, serializeError, setErrorReporter } from "./log";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BUSSOLA_LOG_FORMAT;
  delete process.env.BUSSOLA_LOG_LEVEL;
  setErrorReporter(undefined);
});

describe("logger", () => {
  it("writes one JSON object per line with scope and fields", () => {
    process.env.BUSSOLA_LOG_FORMAT = "json";
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger("sync", { connectionId: "con_1" }).warn("backing off", { failures: 3 });

    const entry = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(entry).toMatchObject({
      level: "warn",
      scope: "sync",
      msg: "backing off",
      connectionId: "con_1",
      failures: 3,
    });
  });

  it("serialises errors, which JSON.stringify would drop", () => {
    const serialized = serializeError(new Error("boom", { cause: new Error("root") }));
    expect(serialized).toMatchObject({
      name: "Error",
      message: "boom",
      cause: { message: "root" },
    });
  });

  it("respects the configured level", () => {
    process.env.BUSSOLA_LOG_LEVEL = "error";
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger("x").warn("ignored");
    expect(spy).not.toHaveBeenCalled();
  });

  it("hands errors to a configured reporter, and survives a broken one", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];
    setErrorReporter(({ message }) => seen.push(message));
    logger("x").error("it broke", {}, new Error("e"));
    expect(seen).toEqual(["it broke"]);

    setErrorReporter(() => {
      throw new Error("reporter down");
    });
    expect(() => logger("x").error("again")).not.toThrow();
  });
});
