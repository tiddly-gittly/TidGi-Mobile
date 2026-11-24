type AbortHost = Pick<typeof globalThis, 'AbortController' | 'AbortSignal'>;

function abortError(name: 'AbortError' | 'TimeoutError'): Error {
  const message = name === 'AbortError' ? 'The operation was aborted.' : 'The operation timed out.';
  if (typeof DOMException !== 'undefined') return new DOMException(message, name);
  const error = new Error(message);
  error.name = name;
  return error;
}

/** Extend RN 0.81's abort-controller 3 without replacing signals used by fetch. */
export function installMobileAbortMethods(host: AbortHost = globalThis): void {
  const { AbortController: Controller, AbortSignal: Signal } = host;
  if (!('reason' in Signal.prototype)) {
    const reasons = new WeakMap<AbortSignal, unknown>();
    // Preserve the native method and invoke it with its original receiver below.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const nativeAbort = Controller.prototype.abort;
    Object.defineProperty(Signal.prototype, 'reason', {
      configurable: true,
      get(this: AbortSignal) {
        return this.aborted ? reasons.get(this) : undefined;
      },
    });
    Controller.prototype.abort = function(reason?: unknown): void {
      if (!this.signal.aborted) reasons.set(this.signal, reason === undefined ? abortError('AbortError') : reason);
      nativeAbort.call(this);
    };
  }
  if (typeof Signal.prototype.throwIfAborted !== 'function') {
    Signal.prototype.throwIfAborted = function(): void {
      if (this.aborted) throw this.reason;
    };
  }
  if (typeof Signal.abort !== 'function') {
    Signal.abort = (reason?: unknown): AbortSignal => {
      const controller = new Controller();
      controller.abort(reason);
      return controller.signal;
    };
  }
  if (typeof Signal.timeout !== 'function') {
    Signal.timeout = (milliseconds: number): AbortSignal => {
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new RangeError('Invalid timeout');
      const controller = new Controller();
      // RN timers use signed 32-bit delays. Chain long deadlines without overflow.
      let remaining = milliseconds;
      const schedule = (): void => {
        const delay = Math.min(remaining, 2_147_483_647);
        remaining -= delay;
        setTimeout(() => {
          if (remaining > 0) schedule();
          else controller.abort(abortError('TimeoutError'));
        }, delay);
      };
      schedule();
      return controller.signal;
    };
  }
  if (typeof Signal.any !== 'function') {
    Signal.any = (signals: AbortSignal[]): AbortSignal => {
      const controller = new Controller();
      const subscriptions = new Map<AbortSignal, () => void>();
      const abort = (source: AbortSignal): void => {
        for (const [signal, listener] of subscriptions) signal.removeEventListener('abort', listener);
        subscriptions.clear();
        controller.abort(source.reason);
      };
      for (const signal of signals) {
        if (signal.aborted) {
          abort(signal);
          break;
        }
        if (subscriptions.has(signal)) continue;
        const listener = (): void => {
          abort(signal);
        };
        subscriptions.set(signal, listener);
        signal.addEventListener('abort', listener, { once: true });
      }
      return controller.signal;
    };
  }
}

installMobileAbortMethods();
