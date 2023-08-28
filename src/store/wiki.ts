import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

interface WikiState {
  increase: (by: number) => void;
  wikis: number;
}

export const useWikiStore = create<WikiState>()(
  devtools(
    persist(
      (set) => ({
        wikis: 0,
        increase: (by) => {
          set((state) => ({ wikis: state.wikis + by }));
        },
      }),
      {
        name: 'wiki-storage',
      },
    ),
  ),
);
