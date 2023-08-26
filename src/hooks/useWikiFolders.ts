import * as fs from 'expo-file-system';
import { useEffect, useState } from 'react';
import { WIKI_FOLDER_PATH } from '../constants/paths';

export const useWikiFolders = () => {
  const [wikis, setWikis] = useState<string[]>([]);

  useEffect(() => {
    const loadWikis = async () => {
      if (WIKI_FOLDER_PATH === undefined) return;
      try {
        const wikiFolderNames = await fs.readDirectoryAsync(WIKI_FOLDER_PATH);
        setWikis(wikiFolderNames);
      } catch (error) {
        console.warn('Error loading wikis:', error);
      }
    };

    void loadWikis();
  }, []);

  return wikis;
};
