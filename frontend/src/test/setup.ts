import "@testing-library/jest-dom";

// Mock IntersectionObserver
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(window, "IntersectionObserver", {
  writable: true,
  value: MockIntersectionObserver,
});

// Mock requestAnimationFrame
Object.defineProperty(window, "requestAnimationFrame", {
  writable: true,
  value: (cb: FrameRequestCallback) => setTimeout(cb, 0),
});

// Mock cancelAnimationFrame
Object.defineProperty(window, "cancelAnimationFrame", {
  writable: true,
  value: (id: number) => clearTimeout(id),
});

// Mock EventSource
class MockEventSource {
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 0;
  CONNECTING = 0;
  OPEN = 1;
  CLOSED = 2;

  constructor(url: string) {
    this.url = url;
    this.readyState = 1;
  }

  close() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
}
Object.defineProperty(window, "EventSource", {
  writable: true,
  value: MockEventSource,
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] || null,
  };
})();
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

// Mock performance.memory
Object.defineProperty(performance, "memory", {
  value: {
    usedJSHeapSize: 0,
    totalJSHeapSize: 0,
    jsHeapSizeLimit: 0,
  },
});

// Silence console.error in tests (optional)
// const originalError = console.error;
// console.error = (...args: any[]) => {
//   if (typeof args[0] === 'string' && args[0].includes('Warning:')) return;
//   originalError.call(console, ...args);
// };
