import { useAssets } from 'expo-asset';
import * as fs from 'expo-file-system';
import { useEffect, useState } from 'react';
import emptyWiki from '../../../assets/emptyWiki.html';

export function useTiddlyWiki() {
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
