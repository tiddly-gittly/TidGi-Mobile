import { errorConstructors } from 'serialize-error';

/* Custom Error */
export class IpcProxyError extends Error {
  constructor(message?: string | undefined) {
    super(message);
    this.name = this.constructor.name;
  }
}
errorConstructors.set('IpcProxyError', IpcProxyError as ErrorConstructor);

/* Utils */
// eslint-disable-next-line @typescript-eslint/ban-types
export function isFunction(value: unknown): value is Function {
  return value !== undefined && typeof value === 'function';
}

/**
 * Fix ContextIsolation
 * @param key original key
 * @returns
 */
export function getSubscriptionKey(key: string): string {
  return `${key}Subscribe`;
}
