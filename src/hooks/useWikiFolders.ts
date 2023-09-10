import * as fs from 'expo-file-system';
import { useEffect, useState } from 'react';
import { WIKI_FOLDER_PATH } from '../constants/paths';

export const useWikiFolders = () => {
  const [foldername, setFolderName] = useState<string[]>([]);

  useEffect(() => {
    const loadFolderName = async () => {
      if (WIKI_FOLDER_PATH === undefined) return;
      try {
        const wikiFolderNames = await fs.readDirectoryAsync(WIKI_FOLDER_PATH);
        setFolderName(wikiFolderNames);
      } catch (error) {
        console.warn('Error loading foldername:', error);
      }
    };

    void loadFolderName();
  }, []);

  return foldername;
};
