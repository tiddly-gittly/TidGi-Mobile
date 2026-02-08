import { File } from 'expo-file-system';
import { flatten, uniqBy } from 'lodash';
import { useCallback, useEffect, useState } from 'react';

import { ITemplateListItem } from '../../../components/TemplateList';

export function useLoadOnlineSources(onlineSourcesUrls: string[], temporaryFileLocation: string, defaultList?: ITemplateListItem[]): [ITemplateListItem[], boolean] {
  const [loading, setLoading] = useState(true);
  const [webPages, webPagesSetter] = useState<ITemplateListItem[]>(defaultList ?? []);
  const fetchJSON = useCallback(async (sourceUrl: string) => {
    setLoading(true);
    try {
      const destFile = new File(temporaryFileLocation);
      const file = await File.downloadFileAsync(sourceUrl, destFile, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
      // Check if download was successful by checking if file exists
      if (!file.exists) {
        throw new Error('Download failed');
      }
    } catch (error: unknown) {
      console.warn('Failed to download online sources', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [temporaryFileLocation]);
  useEffect(() => {
    const loadOnlineSources = async () => {
      const fetchedLists = await Promise.all(onlineSourcesUrls.map(async (sourceUrl: string) => {
        try {
          const file = new File(temporaryFileLocation);
          let content: string;
          if (file.exists) {
            // try read from cache first
            content = await file.text();
            // stale while revalidate
            void fetchJSON(sourceUrl).catch(error => {
              console.warn('Failed to fetch online sources when swr in useLoadOnlineSources', error);
            });
          } else {
            await fetchJSON(sourceUrl);
            const newFile = new File(temporaryFileLocation);
            content = await newFile.text();
          }
          return JSON.parse(content) as ITemplateListItem[];
        } catch (error) {
          console.warn('Failed to load online sources in useLoadOnlineSources', error);
          return [];
        }
      }));
      webPagesSetter(uniqBy([...flatten(fetchedLists), ...(defaultList ?? [])], 'title'));
    };
    void loadOnlineSources();
  }, [defaultList, fetchJSON, onlineSourcesUrls, temporaryFileLocation]);
  return [webPages, loading];
}
