import { createContext, useContext } from 'react';

export interface ConfigFocusTarget {
  field?: 'access-token' | 'api-key' | 'api-mode' | 'base-url' | 'cloud-url' | 'model';
  item?: string;
}

export const ConfigFocusContext = createContext<ConfigFocusTarget>({});

export function useConfigFocus(): ConfigFocusTarget {
  return useContext(ConfigFocusContext);
}
