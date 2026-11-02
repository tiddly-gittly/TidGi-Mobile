import { installMobilePromiseCapabilities } from '..';

it('resolves and rejects using the original promise constructor', async () => {
  class NativePromise<T> extends Promise<T> {}
  const existing = Object.getOwnPropertyDescriptor(Promise, 'withResolvers');
  Reflect.deleteProperty(Promise, 'withResolvers');
  try {
    installMobilePromiseCapabilities(NativePromise);
  } finally {
    if (existing) Object.defineProperty(Promise, 'withResolvers', existing);
  }
  const withResolvers: <T>() => {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  } = Reflect.get(NativePromise, 'withResolvers');
  const resolved = withResolvers.call(NativePromise);
  expect(resolved.promise).toBeInstanceOf(NativePromise);
  resolved.resolve(Promise.resolve('complete'));
  await expect(resolved.promise).resolves.toBe('complete');
  const rejected = withResolvers.call(NativePromise);
  const reason = new Error('cancelled');
  rejected.reject(reason);
  await expect(rejected.promise).rejects.toBe(reason);
  installMobilePromiseCapabilities(NativePromise);
  expect(Reflect.get(NativePromise, 'withResolvers')).toBe(withResolvers);
});
