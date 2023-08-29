import { useAssets } from 'expo-asset';
import * as fs from 'expo-file-system';
import { useEffect, useState } from 'react';
import emptyWiki from '../../../assets/emptyWiki.html';

export function useTiddlyWiki(htmlUri: string) {
  const [htmlContent, setHtmlContent] = useState('');

  useEffect(() => {
    if (htmlUri === undefined || htmlUri === null) return;
    const fetchHTML = async () => {
      const content = await fs.readAsStringAsync(htmlUri);
      const modifiedContent = content.replace('</body>', '<script>console.log("loaded")</script></body>');
      setHtmlContent(modifiedContent);
    };

    void fetchHTML();
  }, [htmlUri]);
  return htmlContent;
}

export function useEmptyWikiUri() {
  const [htmlUri, setHtmlUri] = useState('');

  const [assets] = useAssets([emptyWiki]);
  useEffect(() => {
    const emptyWikiFileUri = assets?.[0]?.localUri;
    if (emptyWikiFileUri === undefined || emptyWikiFileUri === null) return;
    setHtmlUri(emptyWikiFileUri);
  }, [assets]);
  return htmlUri;
}
