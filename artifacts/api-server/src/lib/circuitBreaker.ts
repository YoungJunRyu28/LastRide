import { ProviderError } from "./cache";
import { logger } from "./logger";

/**
 * Thrown for failures that suggest the provider itself is down (network
 * error, timeout, 5xx). Only these trip a circuit breaker: 4xx answers and
 * local quota refusals say nothing about the provider's health.
 */
export class ProviderOutageError extends ProviderError {}

/**
 * Per-instance circuit breaker for a paid provider. After `failureThreshold`
 * consecutive outages, calls fail fast for `cooldownMs` without reserving
 * quota or making the HTTP request; afterwards one trial call is let through
 * (half-open) and its outcome closes or re-opens the circuit.
 */
export class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;
  private trialInFlight = false;

  constructor(
    private readonly name: string,
    private readonly options: {
      failureThreshold?: number;
      cooldownMs?: number;
      now?: () => number;
    } = {},
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const now = this.options.now ?? Date.now;
    const tripped = this.failures >= (this.options.failureThreshold ?? 5);
    if (tripped && (now() < this.openUntil || this.trialInFlight)) {
      throw new ProviderError(`${this.name} temporarily unavailable`);
    }
    if (tripped) this.trialInFlight = true;
    try {
      const result = await fn();
      this.failures = 0;
      return result;
    } catch (err) {
      if (err instanceof ProviderOutageError) {
        this.failures += 1;
        if (this.failures >= (this.options.failureThreshold ?? 5)) {
          this.openUntil = now() + (this.options.cooldownMs ?? 30_000);
          logger.warn(
            { provider: this.name, failures: this.failures },
            "Provider circuit opened",
          );
        }
      }
      throw err;
    } finally {
      if (tripped) this.trialInFlight = false;
    }
  }
}
