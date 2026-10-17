import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { readDraft, writeDraftField, clearDraft, useDraftState } from "../formDraft";

const STORE = "test.draft";

beforeEach(() => localStorage.clear());

describe("formDraft", () => {
  it("merges fields instead of overwriting the draft", () => {
    writeDraftField(STORE, "userId", "danish_k");
    writeDraftField(STORE, "email", "d@example.com");
    expect(readDraft(STORE)).toEqual({ userId: "danish_k", email: "d@example.com" });
  });

  it("treats a corrupt or missing draft as empty", () => {
    expect(readDraft(STORE)).toEqual({});
    localStorage.setItem(STORE, "{not json");
    expect(readDraft(STORE)).toEqual({});
  });

  it("restores a field after the component unmounts (signup → sign in → back)", () => {
    const first = renderHook(() => useDraftState(STORE, "userId", ""));
    act(() => first.result.current[1]("danish_k"));
    first.unmount();

    const second = renderHook(() => useDraftState(STORE, "userId", ""));
    expect(second.result.current[0]).toBe("danish_k");
  });

  it("falls back to the initial value once the draft is cleared", () => {
    const first = renderHook(() => useDraftState(STORE, "step", 1));
    act(() => first.result.current[1](2));
    first.unmount();
    clearDraft(STORE);

    const second = renderHook(() => useDraftState(STORE, "step", 1));
    expect(second.result.current[0]).toBe(1);
  });
});
