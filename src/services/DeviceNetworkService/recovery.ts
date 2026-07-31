export type CloudRecoveryReason = 'app-foreground' | 'cloud-configured' | 'heartbeat-failed' | 'manual' | 'relay-expiring' | 'startup';

export interface CloudRecoveryCoordinatorOptions {
  debounceMs?: number;
  maximumAttempts?: number;
  retryDelaysMs?: readonly number[];
  recover: (reason: CloudRecoveryReason) => Promise<void>;
}

/** Coalesces lifecycle/network signals and bounds retry work to one in-flight run. */
export class CloudRecoveryCoordinator {
  private readonly debounceMs: number;
  private readonly maximumAttempts: number;
  private readonly retryDelaysMs: readonly number[];
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<void>;
  private pendingReason?: CloudRecoveryReason;
  private disposed = false;

  constructor(private readonly options: CloudRecoveryCoordinatorOptions) {
    this.debounceMs = options.debounceMs ?? 500;
    this.maximumAttempts = options.maximumAttempts ?? 3;
    this.retryDelaysMs = options.retryDelaysMs ?? [1_000, 3_000];
  }

  public schedule(reason: CloudRecoveryReason): void {
    if (this.disposed) return;
    if (this.inFlight) return;
    this.pendingReason = reason;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runPending().catch(() => undefined);
    }, this.debounceMs);
  }

  public async runNow(reason: CloudRecoveryReason): Promise<void> {
    if (this.disposed) return;
    if (this.inFlight) return this.inFlight;
    this.pendingReason = reason;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.runPending();
  }

  public dispose(): void {
    this.disposed = true;
    this.pendingReason = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async runPending(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const reason = this.pendingReason;
    if (!reason || this.disposed) return;
    this.pendingReason = undefined;
    this.inFlight = this.runWithRetry(reason).finally(() => {
      this.inFlight = undefined;
      if (this.pendingReason && !this.disposed) this.schedule(this.pendingReason);
    });
    return this.inFlight;
  }

  private async runWithRetry(reason: CloudRecoveryReason): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maximumAttempts; attempt++) {
      try {
        await this.options.recover(reason);
        return;
      } catch (error) {
        lastError = error;
        if (attempt + 1 >= this.maximumAttempts) break;
        const delay = this.retryDelaysMs[Math.min(attempt, this.retryDelaysMs.length - 1)] ?? 0;
        if (delay > 0) await new Promise<void>(resolve => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }
}
