import * as fs from 'expo-file-system';
import { useEffect, useState } from 'react';
import { CONFIG_PATH } from '../../constants/paths';

interface IConfig {
  editorName: string;
  runInBackground: boolean;
}

export const useConfig = (): [IConfig, (newConfig: IConfig) => void] => {
  const [config, setConfig] = useState<IConfig>({
    runInBackground: false,
    editorName: 'Default Editor',
  });

  useEffect(() => {
    const loadConfig = async () => {
      if (CONFIG_PATH === undefined) return;
      try {
        const savedConfig = await fs.readAsStringAsync(CONFIG_PATH);
        setConfig(JSON.parse(savedConfig) as IConfig);
      } catch (error) {
        console.warn('Error loading configuration:', error);
      }
    };

    void loadConfig();
  }, []);

  const updateConfig = async (newConfig: IConfig) => {
    if (CONFIG_PATH === undefined) return;
    try {
      await fs.writeAsStringAsync(CONFIG_PATH, JSON.stringify(newConfig));
      setConfig(newConfig);
    } catch (error) {
      console.error('Error saving configuration:', error);
    }
  };

  return [config, updateConfig];
};
