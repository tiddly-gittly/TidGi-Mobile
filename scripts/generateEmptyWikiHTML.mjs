/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable unicorn/prevent-abbreviations */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { TiddlyWiki } from 'tiddlywiki';

/**
 * wikiHtmlExtensions
 */
const isHtmlWikiRegex = /(?:html|htm|Html|HTML|HTM|HTA|hta)$/;
export const isHtmlWiki = (htmlWikiPath) => isHtmlWikiRegex.test(htmlWikiPath);

async function packetHTMLFromWikiFolder(folderWikiPath, pathOfNewHTML, constants) {
  // tiddlywiki ./mywikifolder --rendertiddler '$:/core/save/all' mywiki.html text/plain
  // . /mywikifolder is the path to the wiki folder, which generally contains the tiddlder and plugins directories
  const { TIDDLYWIKI_PACKAGE_FOLDER } = constants;
  const wikiInstance = TiddlyWiki();
  process.env.TIDDLYWIKI_PLUGIN_PATH = path.resolve(TIDDLYWIKI_PACKAGE_FOLDER, 'plugins');
  process.env.TIDDLYWIKI_THEME_PATH = path.resolve(TIDDLYWIKI_PACKAGE_FOLDER, 'themes');
  process.env.TIDDLYWIKI_LANGUAGE_PATH = path.resolve(TIDDLYWIKI_PACKAGE_FOLDER, 'languages');
  // a .html file path should be provided, but if provided a folder path, we can add /index.html to fix it.
  wikiInstance.boot.argv = [
    folderWikiPath,
    '--rendertiddler',
    '$:/core/save/all',
    isHtmlWiki(pathOfNewHTML) ? pathOfNewHTML : `${pathOfNewHTML}/index.html`,
    'text/plain',
  ];
  await new Promise((resolve, reject) => {
    try {
      wikiInstance.boot.startup({
        bootPath: TIDDLYWIKI_PACKAGE_FOLDER,
        callback: () => {
          resolve();
        },
      });
    } catch (error) {
      reject(error);
    }
  });
}

const projectRoot = path.join(__dirname, '..');
// FIXME: now working, will mix all editions in node_modules to create a strange wiki. Now download manually from https://tiddlywiki.com/ instead.
await packetHTMLFromWikiFolder(
  path.join(projectRoot, 'node_modules/tiddlywiki/editions/empty'),
  path.join(projectRoot, 'assets', 'emptyWiki.html'),
  { TIDDLYWIKI_PACKAGE_FOLDER: path.join(projectRoot, 'node_modules/tiddlywiki') },
);
