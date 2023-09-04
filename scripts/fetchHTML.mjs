// import {escape, unescape} from 'html-escaper';

const host = '192.168.3.15:5212';
const html = await fetch(`http://${host}/tw-mobile-sync/get-skinny-html`).then(response => response.text());
const skinnyStore = await fetch(`http://${host}/tw-mobile-sync/get-skinny-tiddlywiki-tiddler-store-script`).then(response => response.text());
const skinnyTextsCache = await fetch(`http://${host}/tw-mobile-sync/get-skinny-tiddler-text`).then(response => response.text());
const nonSkinny = await fetch(`http://${host}/tw-mobile-sync/get-non-skinny-tiddlywiki-tiddler-store-script`).then(response => response.text());
console.log(`html: ${(Buffer.byteLength(html) / 1024).toFixed(1)}kb`);
console.log(`skinnyStore: ${(Buffer.byteLength(skinnyStore) / 1024).toFixed(1)}kb`);
console.log(`skinnyTextsCache: ${(Buffer.byteLength(skinnyTextsCache) / 1024).toFixed(1)}kb`);
console.log(`nonSkinny: ${(Buffer.byteLength(nonSkinny) / 1024).toFixed(1)}kb`);
fs.mkdirp('scripts/fetchHTML');
fs.writeFileSync('scripts/fetchHTML/skinny.html', html);
fs.writeFileSync('scripts/fetchHTML/skinnyTiddlerStore.json', skinnyStore);
fs.writeFileSync('scripts/fetchHTML/skinnyTextsCache.json', skinnyTextsCache);
fs.writeFileSync('scripts/fetchHTML/tiddlerStore.json', nonSkinny);

// const getSkinnyTiddlywikiTiddlerStoreScriptUrl = new URL(`http://${host}/tw-mobile-sync/get-skinny-html`);
// getSkinnyTiddlywikiTiddlerStoreScriptUrl.pathname = '/tw-mobile-sync/get-skinny-tiddlywiki-tiddler-store-script';
// console.log(getSkinnyTiddlywikiTiddlerStoreScriptUrl.toString())
