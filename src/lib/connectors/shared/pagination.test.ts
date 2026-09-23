import { describe, expect, it, vi } from "vitest";
import { collectPages, type Page } from "./pagination";

/** Pages of `size` numbers, numbered from 1, `total` pages in all. */
function numberedPages(total: number, size = 2) {
  return vi.fn(async (page: number = 1): Promise<Page<number, number>> => ({
    items: Array.from({ length: size }, (_, i) => (page - 1) * size + i),
    next: page < total ? page + 1 : null,
  }));
}

describe("collectPages", () => {
  it("walks every page when they fit under the cap", async () => {
    const fetchPage = numberedPages(3);
    const result = await collectPages(fetchPage, 5);

    expect(result).toEqual({ items: [0, 1, 2, 3, 4, 5], truncated: false });
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([
      undefined,
      2,
      3,
    ]);
  });

  it("is not truncated when the last page lands exactly on the cap", async () => {
    const result = await collectPages(numberedPages(3), 3);
    expect(result.truncated).toBe(false);
    expect(result.items).toHaveLength(6);
  });

  it("stops at the cap and says so when there is more", async () => {
    const fetchPage = numberedPages(10);
    const result = await collectPages(fetchPage, 2);

    expect(result).toEqual({ items: [0, 1, 2, 3], truncated: true });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("threads an opaque cursor through unchanged", async () => {
    const pages: Record<string, Page<string, string>> = {
      start: { items: ["sub_1", "sub_2"], next: "sub_2" },
      sub_2: { items: ["sub_3"], next: undefined },
    };
    const result = await collectPages<string, string>(
      async (cursor) => pages[cursor ?? "start"],
      5,
    );
    expect(result).toEqual({ items: ["sub_1", "sub_2", "sub_3"], truncated: false });
  });

  it("returns an empty, complete result for an empty first page", async () => {
    const result = await collectPages<number, number>(
      async () => ({ items: [], next: null }),
      5,
    );
    expect(result).toEqual({ items: [], truncated: false });
  });

  it("lets a failing page reject the whole walk", async () => {
    await expect(
      collectPages(async () => {
        throw new Error("Stripe API 500: boom");
      }, 5),
    ).rejects.toThrow("Stripe API 500");
  });
});
