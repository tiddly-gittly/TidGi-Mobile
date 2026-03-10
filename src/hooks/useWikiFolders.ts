import { Directory } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { WIKI_FOLDER_PATH } from '../constants/paths';

export const useWikiFolders = () => {
  const [foldername, setFolderName] = useState<string[]>([]);

  useEffect(() => {
    const loadFolderName = () => {
      if (!WIKI_FOLDER_PATH) return;
      try {
        const directory = new Directory(WIKI_FOLDER_PATH);
        const entries = directory.list();
        const wikiFolderNames = entries.map(entry => entry.name);
        setFolderName(wikiFolderNames);
      } catch (error) {
        console.warn('Error loading foldername:', error);
      }
    };

    loadFolderName();
  }, []);

  return foldername;
};
