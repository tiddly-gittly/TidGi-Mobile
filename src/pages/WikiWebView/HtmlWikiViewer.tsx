import React, { useCallback, useMemo, useRef } from 'react';
import { useTheme } from 'react-native-paper';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { FAKE_USER_AGENT } from '../../constants/webview';
import { saveLocalHtmlWorkspace } from '../../services/HtmlWorkspaceService';
import { IHtmlWorkspace } from '../../store/workspace';

interface IHtmlWikiViewerProps {
  workspace: IHtmlWorkspace;
}

interface IHtmlWikiMessage {
  html?: string;
  type?: string;
}

function installTidGiMobileHtmlSaver(): void {
  const currentWindow = window as Window & {
    $tw?: {
      notifier?: { display: (title: string) => void };
      saverHandler?: {
        numChanges: number;
        saveWiki: (options?: Record<string, unknown>) => boolean;
        titleSavedNotification: string;
        updateDirtyStatus: () => void;
        wiki: {
          getTiddlerText: (title: string, defaultText?: string) => string;
          renderTiddler: (type: string, template: string, options?: Record<string, unknown>) => string;
        };
      };
    };
    ReactNativeWebView?: { postMessage: (message: string) => void };
    __tidgiMobileHtmlSaverInstalled?: boolean;
  };
  if (currentWindow.__tidgiMobileHtmlSaverInstalled) {
    return;
  }
  currentWindow.__tidgiMobileHtmlSaverInstalled = true;

  const postHtml = (html: string) => {
    currentWindow.ReactNativeWebView?.postMessage(JSON.stringify({ html, type: 'tidgi-html-save' }));
  };
  const patchSaverHandler = () => {
    const saverHandler = currentWindow.$tw?.saverHandler;
    if (!saverHandler) {
      return false;
    }
    saverHandler.saveWiki = function saveHtmlWikiOnMobile(options?: Record<string, unknown>) {
      const wiki = (options?.wiki as typeof saverHandler.wiki | undefined) ?? saverHandler.wiki;
      const optionTemplate = options?.template;
      const template = (typeof optionTemplate === 'string' ? optionTemplate : wiki.getTiddlerText('$:/config/SaveWikiButton/Template', '$:/core/save/all')).trim();
      const optionDownloadType = options?.downloadType;
      const downloadType = typeof optionDownloadType === 'string' ? optionDownloadType : 'text/html';
      const text = wiki.renderTiddler(downloadType, template, options);
      postHtml(text);
      saverHandler.numChanges = 0;
      saverHandler.updateDirtyStatus();
      currentWindow.$tw?.notifier?.display(saverHandler.titleSavedNotification);
      const callback = options?.callback;
      if (typeof callback === 'function') {
        (callback as () => void)();
      }
      return true;
    };
    return true;
  };
  let attempts = 0;
  const tryPatch = () => {
    if (patchSaverHandler() || attempts >= 200) {
      return;
    }
    attempts += 1;
    window.setTimeout(tryPatch, 50);
  };
  tryPatch();
  window.addEventListener('load', tryPatch, { once: true });
}

export function HtmlWikiViewer({ workspace }: IHtmlWikiViewerProps): React.JSX.Element {
  const theme = useTheme();
  const webViewReference = useRef<WebView | null>(null);
  const injectedJavaScript = useMemo(() => `(${installTidGiMobileHtmlSaver.toString()})(); true;`, []);
  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as IHtmlWikiMessage;
      if (message.type === 'tidgi-html-save' && typeof message.html === 'string') {
        void saveLocalHtmlWorkspace(workspace, message.html);
      }
    } catch (error) {
      console.warn('[HtmlWikiViewer] Ignoring invalid WebView message', error);
    }
  }, [workspace]);

  return (
    <WebView
      ref={webViewReference}
      style={{ backgroundColor: theme.colors.background }}
      source={{ uri: workspace.htmlFileLocation }}
      originWhitelist={['*']}
      allowFileAccess
      allowFileAccessFromFileURLs
      allowUniversalAccessFromFileURLs
      javaScriptEnabled
      domStorageEnabled
      mixedContentMode='always'
      userAgent={FAKE_USER_AGENT}
      injectedJavaScriptBeforeContentLoaded={injectedJavaScript}
      onMessage={onMessage}
    />
  );
}
