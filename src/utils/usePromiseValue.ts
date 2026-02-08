import { useEffect, useState } from 'react';

/**
 * Use value from service, especially constant value that never changes
 * This will only update once, won't listen on later update.
 * @param valuePromise A promise contain the value we want to use in React
 * @param defaultValue empty array or undefined, as initial value
 */
export function usePromiseValue<T>(
  asyncValue: () => Promise<T>,
  defaultValue?: T,
  dependency: unknown[] = [],
): T | undefined {
  const [value, valueSetter] = useState<T | undefined>(defaultValue);
  // use initial value
  useEffect(() => {
    void (async () => {
      try {
        valueSetter(await asyncValue());
      } catch (error) {
        console.error(error);
        if (defaultValue !== undefined) {
          valueSetter(defaultValue);
        }
      }
    })();
  }, dependency);

  return value;
}
