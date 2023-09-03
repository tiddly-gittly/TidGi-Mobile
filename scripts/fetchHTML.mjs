// import {escape, unescape} from 'html-escaper';

const host = '192.168.3.15:5212';
const html = await fetch(`http://${host}/tw-mobile-sync/get-skinny-html`).then(response => response.text());
const jsonscript = await fetch(`http://${host}/tw-mobile-sync/get-skinny-tiddlywiki-tiddler-store-script`).then(response => response.text());
console.log(Buffer.byteLength(html));
console.log(Buffer.byteLength(jsonscript));
fs.writeFileSync('skinny.html', html);
fs.writeFileSync('tiddlerStore.json', jsonscript);

// const getSkinnyTiddlywikiTiddlerStoreScriptUrl = new URL(`http://${host}/tw-mobile-sync/get-skinny-html`);
// getSkinnyTiddlywikiTiddlerStoreScriptUrl.pathname = '/tw-mobile-sync/get-skinny-tiddlywiki-tiddler-store-script';
// console.log(getSkinnyTiddlywikiTiddlerStoreScriptUrl.toString())
