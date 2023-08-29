/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
import { useAssets } from 'expo-asset';
import * as fs from 'expo-file-system';
import { useEffect, useState } from 'react';
import emptyWiki from '../../../assets/emptyWiki.html';

export function useTiddlyWiki(htmlUri: string) {
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [loadHtmlError, setLoadHtmlError] = useState('');

  // for debug
  // const emptyHtmlUri = useEmptyWikiUri()
  // htmlUri = emptyHtmlUri

  useEffect(() => {
    if (!htmlUri) return;
    const fetchHTML = async () => {
      try {
        setHtmlContent(null);
        const content = await fs.readAsStringAsync(htmlUri);
        const modifiedContent = content; // .replace('</body>', '<script>console.log("loaded")</script></body>');
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

export function useEmptyWikiUri() {
  const [htmlUri, setHtmlUri] = useState('');

  const [assets] = useAssets([emptyWiki]);
  useEffect(() => {
    const emptyWikiFileUri = assets?.[0]?.localUri;
    if (!emptyWikiFileUri) return;
    setHtmlUri(emptyWikiFileUri);
  }, [assets]);
  return htmlUri;
}
