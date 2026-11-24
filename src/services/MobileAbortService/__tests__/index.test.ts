import { installMobileAbortMethods } from '..';

// Resolve exactly the abort-controller package used by RN's setUpXHR.
const nativePath = require.resolve('abort-controller/dist/abort-controller', { paths: [require.resolve('react-native/package.json')] });
const native = jest.requireActual<{ AbortController: typeof AbortController; AbortSignal: typeof AbortSignal }>(nativePath);
installMobileAbortMethods(native);

afterEach(() => {
  jest.useRealTimers();
});
it('preserves explicit/default reasons before listeners run and throws only after abort', () => {
  const controller = new native.AbortController();
  expect(() => {
    controller.signal.throwIfAborted();
  }).not.toThrow();
  const reason = new Error('cancelled');
  const observed = jest.fn((): unknown => controller.signal.reason);
  controller.signal.addEventListener('abort', observed);
  controller.abort(reason);
  controller.abort(new Error('later'));
  expect(observed).toHaveReturnedWith(reason);
  expect(observed).toHaveBeenCalledTimes(1);
  expect(() => {
    controller.signal.throwIfAborted();
  }).toThrow(reason);
  expect(native.AbortSignal.abort().reason).toMatchObject({ name: 'AbortError' });
  expect(native.AbortSignal.abort(null).reason).toBeNull();
});
it('combines native signals and removes listeners after the first abort', () => {
  const first = new native.AbortController();
  const second = new native.AbortController();
  const remove = jest.spyOn(first.signal, 'removeEventListener');
  const combined = native.AbortSignal.any([first.signal, second.signal, first.signal]);
  second.abort('second');
  first.abort('first');
  expect(combined.reason).toBe('second');
  expect(remove).toHaveBeenCalledTimes(1);
  expect(native.AbortSignal.any([second.signal]).reason).toBe('second');
  expect(native.AbortSignal.any([]).aborted).toBe(false);
});
it('times out asynchronously with TimeoutError and validates timeout ranges', () => {
  jest.useFakeTimers();
  const signal = native.AbortSignal.timeout(10);
  expect(signal.aborted).toBe(false);
  jest.advanceTimersByTime(10);
  expect(signal.reason).toMatchObject({ name: 'TimeoutError' });
  expect(() => native.AbortSignal.timeout(-1)).toThrow(RangeError);
  expect(() => native.AbortSignal.timeout(Infinity)).toThrow(RangeError);
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const abort = native.AbortController.prototype.abort;
  installMobileAbortMethods(native);
  // eslint-disable-next-line @typescript-eslint/unbound-method
  expect(native.AbortController.prototype.abort).toBe(abort);
});
