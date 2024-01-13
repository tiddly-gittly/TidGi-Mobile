import { useEffect, useState } from 'react';
import { AsyncReturnType } from 'type-fest';

/**
 * Use value from service, especially constant value that never changes
 * This will only update once, won't listen on later update.
 * @param valuePromise A promise contain the value we want to use in React
 * @param defaultValue empty array or undefined, as initial value
 */
export function usePromiseValue<T, DefaultValueType = T | undefined>(
  asyncValue: () => Promise<T>,
  defaultValue?: AsyncReturnType<typeof asyncValue>,
  dependency: unknown[] = [],
): T | DefaultValueType {
  const [value, valueSetter] = useState<T | DefaultValueType>(defaultValue as T | DefaultValueType);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependency);

  return value;
}
