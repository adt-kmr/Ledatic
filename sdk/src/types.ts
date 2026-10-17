export type Channel = "upi" | "mobile_banking" | "internet_banking";

export interface KeystrokeEvent {
  key: string;
  eventType: "keydown" | "keyup";
  timestamp: number;
  dwellTime?: number;   // ms key held down
  flightTime?: number;  // ms between keyup and next keydown
}

export interface MouseEvent {
  x: number;
  y: number;
  eventType: "move" | "click" | "scroll";
  pressure?: number;
  timestamp: number;
  velocity?: number;
}

export interface TouchEvent {
  x: number;
  y: number;
  pressure: number;
  touchSize: number;
  eventType: "touchstart" | "touchend" | "touchmove";
  timestamp: number;
}

export interface NavigationEvent {
  fromField: string;
  toField: string;
  timestamp: number;
  dwellMs: number;
}

export interface EnvironmentSignals {
  screenShareActive: boolean;
  clipboardSource: "typed" | "pasted" | "unknown";
  tabVisible: boolean;
  deviceType: "desktop" | "mobile" | "tablet";
  userAgent: string;
  screenResolution: string;
}

export interface SignalBundle {
  sessionId: string;
  userId: string;
  channel: Channel;
  imeiHash: string;
  keystrokeEvents: KeystrokeEvent[];
  mouseEvents: MouseEvent[];
  touchEvents: TouchEvent[];
  navigationEvents: NavigationEvent[];
  environment: EnvironmentSignals;
  timestampMs: number;
}

export interface SDKConfig {
  apiUrl: string;
  userId: string;
  channel: Channel;
  imeiHash: string;
  flushIntervalMs?: number;  // default 500ms
}
