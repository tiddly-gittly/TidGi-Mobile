/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
import { useAssets } from 'expo-asset';
import * as fs from 'expo-file-system';
import { useEffect, useState } from 'react';
import emptyWiki from '../../../assets/emptyWiki.html';
import { getWikiFilePath, getWikiTiddlerStorePath } from '../../constants/paths';
import { IWikiWorkspace } from '../../store/wiki';

export interface IHtmlContent {
  html: string;
  tiddlerStoreScript: string;
}
export function useTiddlyWiki(workspace: IWikiWorkspace) {
  const [htmlContent, setHtmlContent] = useState<IHtmlContent | null>(null);
  const [loadHtmlError, setLoadHtmlError] = useState('');

  useEffect(() => {
    const fetchHTML = async () => {
      try {
        setHtmlContent(null);
        const html = await fs.readAsStringAsync(getWikiFilePath(workspace)); // 'file:///data/user/0/host.exp.exponent/cache/ExponentAsset-8568a405f924c561e7d18846ddc10c97.html');
        const tiddlerStoreScript = await fs.readAsStringAsync(getWikiTiddlerStorePath(workspace));
        setHtmlContent({ html, tiddlerStoreScript });
      } catch (error) {
        console.error(error, (error as Error).stack);
        setLoadHtmlError((error as Error).message);
      }
    };

    void fetchHTML();
  }, [workspace]);
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
