import { useEffect, useRef, useState, useCallback } from "react";
import { BehaviorSDK } from "./BehaviorSDK";
import type { SDKConfig } from "./types";

export interface SignalBreakdown {
  keystrokes: number;
  mouseEvents: number;
  touchEvents: number;
  navigationEvents: number;
}

export interface UseBehaviorSDKReturn {
  signalCount: number;
  breakdown: SignalBreakdown;
  trackFieldEntry: (field: string) => void;
  trackFieldExit: (field: string) => void;
  sessionId: string;
}

export function useBehaviorSDK(config: SDKConfig): UseBehaviorSDKReturn {
  const sdkRef = useRef<BehaviorSDK | null>(null);
  const [signalCount, setSignalCount] = useState(0);
  const [breakdown, setBreakdown] = useState<SignalBreakdown>({ keystrokes: 0, mouseEvents: 0, touchEvents: 0, navigationEvents: 0 });
  const [sessionId, setSessionId] = useState("");

  useEffect(() => {
    const sdk = new BehaviorSDK(config);
    sdkRef.current = sdk;
    sdk.start();
    setSessionId(sdk.currentSessionId);

    const counter = setInterval(() => {
      setSignalCount(sdk.getTotalSignalCount());
      setBreakdown(sdk.getSignalBreakdown());
    }, 500);

    return () => {
      clearInterval(counter);
      sdk.stop();
    };
  // Config is static (defined at module level, never changes) — SDK is created once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trackFieldEntry = useCallback((field: string) => {
    sdkRef.current?.trackFieldEntry(field);
  }, []);

  const trackFieldExit = useCallback((field: string) => {
    sdkRef.current?.trackFieldExit(field);
  }, []);

  return { signalCount, breakdown, trackFieldEntry, trackFieldExit, sessionId };
}
