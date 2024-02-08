import { ISharedFile } from './types';

/**
 * We replace the text with filePath before calling this.
 * @param files [{"contentUri": "content://com.google.android.apps.photos.contentprovider/0/1/content%3A%2F%2Fmedia%2Fexternal%2Fimages%2Fmedia%2F22483/ORIGINAL/NONE/image%2Fjpeg/1673810121", "fileName": "1694162284670.jpg", "filePath": "/data/user/0/ren.onetwo.mobile/cache/1694162284670.jpg", "mimeType": "image/jpeg", "subject": null, "text": null, "weblink": null}]
 * @returns
 */
export const importBinaryTiddlers = (files: ISharedFile[]) => {
  const importBinaryTiddlersScript = `
    /* eslint-disable unicorn/no-null */
    /* eslint-disable no-var */
      var temporaryWidget = $tw.wiki.makeWidget(
      $tw.wiki.parseText('text/vnd.tiddlywiki', '<$navigator story="$:/StoryList" history="$:/HistoryList" />;', { parentWidget: $tw.rootWidget, document }),
      { parentWidget: $tw.rootWidget, document, variables: {} },
    );
    temporaryWidget.render(document.createElement('div'), null);
    var sharedContentsToImport = ${JSON.stringify(files)};
    var parsedContentToImport = sharedContentsToImport.flatMap((content) => {
      return $tw.wiki.deserializeTiddlers(content.mimeType ?? 'text/plain', content.text, { title: content.fileName })
    });
    temporaryWidget.children[0].children[0].dispatchEvent({ type: 'tm-import-tiddlers', param: JSON.stringify(parsedContentToImport) });
  `;
  return importBinaryTiddlersScript;
};

export const importTextTiddlers = (files: ISharedFile[]) => {
  const importTextTiddlersScript = `
    /* eslint-disable unicorn/no-null */
    /* eslint-disable no-var */
    var temporaryWidget = $tw.wiki.makeWidget(
      $tw.wiki.parseText('text/vnd.tiddlywiki', '<$navigator story="$:/StoryList" history="$:/HistoryList" />', { parentWidget: $tw.rootWidget, document }),
      { parentWidget: $tw.rootWidget, document, variables: {} },
    );
    temporaryWidget.render(document.createElement('div'), null);
    var sharedContentsToImport = ${JSON.stringify(files)};
    sharedContentsToImport.forEach(function(block) {
      temporaryWidget.children[0].children[0].dispatchEvent({ type: 'tm-new-tiddler', param: { text: block.text, url: block.weblink } });
    });
  `;
  return importTextTiddlersScript;
};
