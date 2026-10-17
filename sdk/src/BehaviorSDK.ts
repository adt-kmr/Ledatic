import type {
  SDKConfig, SignalBundle, KeystrokeEvent,
  MouseEvent, TouchEvent, NavigationEvent, EnvironmentSignals
} from "./types";
import { getToken } from "./auth";

/** HMAC-SHA-256 of rawImei with the shared secret — matches server-side Python hmac.new(). */
export async function computeImeiHmac(rawImei: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawImei));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Stable browser fingerprint used as proxy for device IMEI in web demo. */
export function getDeviceFingerprint(): string {
  return [
    navigator.userAgent,
    `${window.screen.width}x${window.screen.height}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    String(window.screen.colorDepth),
    String(navigator.hardwareConcurrency ?? ""),
  ].join("|");
}

/**
 * Citadel Web Signal Capture SDK
 * Captures 40+ behavioral signals from first keypress at login screen.
 * Emits signal bundles to the Citadel backend every 500ms.
 */
export class BehaviorSDK {
  private config: Required<SDKConfig>;
  private sessionId: string;
  private keystrokeBuffer: KeystrokeEvent[] = [];
  private mouseBuffer: MouseEvent[] = [];
  private touchBuffer: TouchEvent[] = [];
  private navigationBuffer: NavigationEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private lastKeyUpTime: number = 0;
  private lastKeyDownTime: number = 0;
  private currentField: string = "";
  private fieldEnterTime: number = 0;
  private lastClipboardContent: string = "";
  private screenShareDetected: boolean = false;
  private cumulativeSignalCount: number = 0;
  private _keystrokesSent: number = 0;
  private _mouseSent: number = 0;
  private _touchSent: number = 0;
  private _navSent: number = 0;

  constructor(config: SDKConfig) {
    this.config = { flushIntervalMs: 500, ...config };
    this.sessionId = crypto.randomUUID();
  }

  /** Attach all event listeners and start the flush loop. */
  start(): void {
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("click", this.onMouseClick);
    document.addEventListener("scroll", this.onScroll);
    document.addEventListener("touchstart", this.onTouchStart);
    document.addEventListener("touchend", this.onTouchEnd);
    document.addEventListener("paste", this.onPaste);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.detectScreenShare();
    this.flushTimer = setInterval(() => this.flush(), this.config.flushIntervalMs);
  }

  /** Remove all listeners and stop the flush loop. */
  stop(): void {
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("click", this.onMouseClick);
    document.removeEventListener("scroll", this.onScroll);
    document.removeEventListener("touchstart", this.onTouchStart);
    document.removeEventListener("touchend", this.onTouchEnd);
    document.removeEventListener("paste", this.onPaste);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flush();
  }

  get currentSessionId(): string {
    return this.sessionId;
  }

  /** Returns cumulative signal count since session start — never resets on flush. */
  getTotalSignalCount(): number {
    return this.cumulativeSignalCount;
  }

  /** Returns real per-type signal counts — not estimates. */
  getSignalBreakdown(): { keystrokes: number; mouseEvents: number; touchEvents: number; navigationEvents: number } {
    return {
      keystrokes:       this.keystrokeBuffer.length + this._keystrokesSent,
      mouseEvents:      this.mouseBuffer.length    + this._mouseSent,
      touchEvents:      this.touchBuffer.length    + this._touchSent,
      navigationEvents: this.navigationBuffer.length + this._navSent,
    };
  }

  /** Call from onFocus of a form field to track field-entry time. */
  trackFieldEntry(fieldName: string): void {
    this.currentField = fieldName;
    this.fieldEnterTime = performance.now();
  }

  /** Call from onBlur of a form field to record navigation event. */
  trackFieldExit(fieldName: string): void {
    if (!this.currentField) return;
    const dwellMs = performance.now() - this.fieldEnterTime;
    this.navigationBuffer.push({
      fromField: this.currentField,
      toField: fieldName,
      timestamp: performance.now(),
      dwellMs,
    });
    this.currentField = fieldName;
  }

  // ── Event Handlers ───────────────────────────────────────────────────

  private onKeyDown = (e: globalThis.KeyboardEvent): void => {
    const now = performance.now();
    this.lastKeyDownTime = now;
    this.keystrokeBuffer.push({
      key: this.sanitizeKey(e.key),
      eventType: "keydown",
      timestamp: now,
    });
    this.cumulativeSignalCount++;
  };

  private onKeyUp = (e: globalThis.KeyboardEvent): void => {
    const now = performance.now();
    const dwellTime = now - this.lastKeyDownTime;
    const flightTime = this.lastKeyUpTime > 0 ? this.lastKeyDownTime - this.lastKeyUpTime : 0;
    this.lastKeyUpTime = now;
    this.keystrokeBuffer.push({
      key: this.sanitizeKey(e.key),
      eventType: "keyup",
      timestamp: now,
      dwellTime,
      flightTime: flightTime > 0 ? flightTime : undefined,
    });
  };

  private onMouseMove = (e: globalThis.MouseEvent): void => {
    this.mouseBuffer.push({
      x: e.clientX,
      y: e.clientY,
      eventType: "move",
      timestamp: performance.now(),
    });
    this.cumulativeSignalCount++;
  };

  private onMouseClick = (e: globalThis.MouseEvent): void => {
    this.mouseBuffer.push({
      x: e.clientX,
      y: e.clientY,
      eventType: "click",
      timestamp: performance.now(),
    });
  };

  private onScroll = (): void => {
    this.mouseBuffer.push({
      x: window.scrollX,
      y: window.scrollY,
      eventType: "scroll",
      velocity: 0,
      timestamp: performance.now(),
    });
  };

  private onTouchStart = (e: globalThis.TouchEvent): void => {
    const touch = e.touches[0];
    if (!touch) return;
    this.touchBuffer.push({
      x: touch.clientX,
      y: touch.clientY,
      pressure: (touch as any).force ?? 0.5,
      touchSize: (touch as any).radiusX ?? 10,
      eventType: "touchstart",
      timestamp: performance.now(),
    });
  };

  private onTouchEnd = (e: globalThis.TouchEvent): void => {
    const touch = e.changedTouches[0];
    if (!touch) return;
    this.touchBuffer.push({
      x: touch.clientX,
      y: touch.clientY,
      pressure: (touch as any).force ?? 0,
      touchSize: (touch as any).radiusX ?? 10,
      eventType: "touchend",
      timestamp: performance.now(),
    });
  };

  private onPaste = (e: ClipboardEvent): void => {
    this.lastClipboardContent = e.clipboardData?.getData("text") ?? "";
  };

  private onVisibilityChange = (): void => {
    // Tab switch — signals potential coaching session; recorded in environment
  };

  // ── Screen Share Detection ────────────────────────────────────────────
  private detectScreenShare(): void {
    if (typeof navigator.mediaDevices?.getDisplayMedia === "function") {
      const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = async (constraints?: DisplayMediaStreamOptions) => {
        this.screenShareDetected = true;
        return original(constraints);
      };
    }
  }

  // ── Flush ─────────────────────────────────────────────────────────────
  private async flush(): Promise<void> {
    if (
      this.keystrokeBuffer.length === 0 &&
      this.mouseBuffer.length === 0 &&
      this.touchBuffer.length === 0
    ) {
      return;
    }

    const ksChunk  = this.keystrokeBuffer.splice(0);
    const msChunk  = this.mouseBuffer.splice(0);
    const tsChunk  = this.touchBuffer.splice(0);
    const navChunk = this.navigationBuffer.splice(0);

    this._keystrokesSent += ksChunk.length;
    this._mouseSent      += msChunk.length;
    this._touchSent      += tsChunk.length;
    this._navSent        += navChunk.length;

    const bundle: SignalBundle = {
      sessionId: this.sessionId,
      userId: this.config.userId,
      channel: this.config.channel,
      imeiHash: this.config.imeiHash,
      keystrokeEvents: ksChunk,
      mouseEvents: msChunk,
      touchEvents: tsChunk,
      navigationEvents: navChunk,
      environment: this.buildEnvironment(),
      timestampMs: Date.now(),
    };

    // Clear clipboard flag after each flush
    this.lastClipboardContent = "";

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = getToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
      await fetch(`${this.config.apiUrl}/api/signals/ingest`, {
        method: "POST",
        headers,
        body: JSON.stringify(bundle),
      });
    } catch {
      // Silent fail — signals are not critical path; next flush continues
    }
  }

  private buildEnvironment(): EnvironmentSignals {
    return {
      screenShareActive: this.screenShareDetected,
      clipboardSource: this.lastClipboardContent ? "pasted" : "typed",
      tabVisible: document.visibilityState === "visible",
      deviceType: this.detectDeviceType(),
      userAgent: navigator.userAgent,
      screenResolution: `${window.screen.width}x${window.screen.height}`,
    };
  }

  private detectDeviceType(): "desktop" | "mobile" | "tablet" {
    const ua = navigator.userAgent;
    if (/tablet|ipad/i.test(ua)) return "tablet";
    if (/mobile|android|iphone/i.test(ua)) return "mobile";
    return "desktop";
  }

  private sanitizeKey(key: string): string {
    if (key.length === 1 && /[a-zA-Z]/.test(key)) return "ALPHA";
    if (key.length === 1 && /[0-9]/.test(key)) return "DIGIT";
    if (key.length === 1) return "SPECIAL";
    return key;
  }
}