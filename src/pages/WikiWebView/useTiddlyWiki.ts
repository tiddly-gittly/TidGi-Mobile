/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
import { useAssets } from 'expo-asset';
import * as fs from 'expo-file-system';
import { useEffect, useState } from 'react';
import emptyWiki from '../../../assets/emptyWiki.html';

export function useTiddlyWiki(htmlUri: string) {
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [loadHtmlError, setLoadHtmlError] = useState('');

  useEffect(() => {
    if (!htmlUri) return;
    const fetchHTML = async () => {
      try {
        setHtmlContent(null);
        const content = await fs.readAsStringAsync(htmlUri); // 'file:///data/user/0/host.exp.exponent/cache/ExponentAsset-8568a405f924c561e7d18846ddc10c97.html');
        const modifiedContent = content.replace('</body>', '<script>console.log("loaded")</script></body>');
        setHtmlContent(modifiedContent);
      } catch (error) {
        console.error(error, (error as Error).stack);
        setLoadHtmlError((error as Error).message);
      }
    };

    void fetchHTML();
  }, [htmlUri]);
  return { htmlContent, loadHtmlError };
}

export function useEmptyTiddlyWiki() {
  const [htmlContent, setHtmlContent] = useState('');

  const [assets, error] = useAssets([emptyWiki]);
  useEffect(() => {
    const emptyWikiFileUri = assets?.[0]?.localUri;
    if (emptyWikiFileUri === undefined || emptyWikiFileUri === null) return;
    const fetchHTML = async () => {
      const content = await fs.readAsStringAsync(emptyWikiFileUri);
      const modifiedContent = content.replace('</body>', '<script>console.log("loaded")</script></body>');
      setHtmlContent(modifiedContent);
    };

    void fetchHTML();
  }, [assets]);
  return htmlContent;
}
