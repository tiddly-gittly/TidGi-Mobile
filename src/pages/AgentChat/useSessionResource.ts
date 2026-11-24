import { useEffect, useMemo } from 'react';

/** Dispose replaced resources while retaining resources reused by strict effects. */
export function useSessionResource(resource: { dispose(): void | Promise<void> }): void {
  const lifetime = useMemo(() => ({ generation: 0 }), [resource]);
  useEffect(() => {
    lifetime.generation += 1;
    return () => {
      const generation = ++lifetime.generation;
      queueMicrotask(() => {
        if (lifetime.generation === generation) void resource.dispose();
      });
    };
  }, [resource, lifetime]);
}
