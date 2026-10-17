import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInterval } from "../useInterval";

describe("useInterval Hook", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls callback at specified interval", () => {
    vi.useFakeTimers();
    const callback = vi.fn();

    renderHook(() => useInterval(callback, 1000));

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(callback).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("does not call callback when delay is null", () => {
    vi.useFakeTimers();
    const callback = vi.fn();

    renderHook(() => useInterval(callback, null));

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(callback).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("clears interval on unmount", () => {
    vi.useFakeTimers();
    const callback = vi.fn();

    const { unmount } = renderHook(() => useInterval(callback, 1000));

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Should only have been called once (before unmount)
    expect(callback).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("updates callback reference", () => {
    vi.useFakeTimers();
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    const { rerender } = renderHook(
      ({ cb }) => useInterval(cb, 1000),
      { initialProps: { cb: callback1 } },
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    rerender({ cb: callback2 });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
