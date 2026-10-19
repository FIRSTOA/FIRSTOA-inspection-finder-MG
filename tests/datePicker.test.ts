import { describe, expect, it, vi } from "vitest";
import { openNativePicker } from "../src/datePicker";

describe("openNativePicker", () => {
  it("showPicker 를 부른다", () => {
    const showPicker = vi.fn();
    openNativePicker({ currentTarget: { showPicker } });
    expect(showPicker).toHaveBeenCalledOnce();
  });
  it("없거나 던져도 조용히 넘어간다", () => {
    expect(() => openNativePicker({ currentTarget: {} })).not.toThrow();
    expect(() => openNativePicker({ currentTarget: { showPicker: () => { throw new Error("x"); } } })).not.toThrow();
  });
});
