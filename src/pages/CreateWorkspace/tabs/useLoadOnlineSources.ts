import * as fs from 'expo-file-system';
import { flatten, uniqBy } from 'lodash';
import { useCallback, useEffect, useState } from 'react';

import { ITemplateListItem } from '../../../components/TemplateList';

export function useLoadOnlineSources(onlineSourcesUrls: string[], temporaryFileLocation: string, defaultList?: ITemplateListItem[]): ITemplateListItem[] {
  const [webPages, webPagesSetter] = useState<ITemplateListItem[]>(defaultList ?? []);
  const fetchJSON = useCallback(async (sourceUrl: string) => {
    const result = await fs.downloadAsync(sourceUrl, temporaryFileLocation, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
    if (result.status !== 200) {
      // delete text file if have server error like 404
      const content = await fs.readAsStringAsync(temporaryFileLocation, { encoding: 'utf8' });
      const errorMessage = `${content} Status: ${result.status}`;
      await fs.deleteAsync(temporaryFileLocation);
      throw new Error(errorMessage);
    }
  }, [temporaryFileLocation]);
  useEffect(() => {
    const loadOnlineSources = async () => {
      const fetchedLists = await Promise.all(onlineSourcesUrls.map(async (sourceUrl: string) => {
        try {
          const { exists } = await fs.getInfoAsync(temporaryFileLocation);
          let content: string;
          if (exists) {
            // try read from cache first
            content = await fs.readAsStringAsync(temporaryFileLocation, { encoding: 'utf8' });
            // stale while revalidate
            void fetchJSON(sourceUrl);
          } else {
            await fetchJSON(sourceUrl);
            content = await fs.readAsStringAsync(temporaryFileLocation, { encoding: 'utf8' });
          }
          return JSON.parse(content) as ITemplateListItem[];
        } catch (error) {
          console.warn('Failed to fetch online sources', error);
          return [];
        }
      }));
      webPagesSetter(uniqBy([...flatten(fetchedLists), ...(defaultList ?? [])], 'title'));
    };
    void loadOnlineSources();
  }, [defaultList, fetchJSON, onlineSourcesUrls, temporaryFileLocation]);
  return webPages;
}
