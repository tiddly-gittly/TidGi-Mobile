/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// import { escape } from 'html-escaper';

await $`cd plugins && pnpm build`;
fs.mkdirpSync('assets/plugins');
// use .html to prevent include its content directly in the bundle. Only .html will be recognized as asset, .txt will say "not exist"
const syncadaptorUi = fs.readFileSync('plugins/dist/$__plugins_linonetwo_expo-file-system-syncadaptor-ui.json');
fs.writeFileSync('assets/plugins/syncadaptor-ui.html', syncadaptorUi);
const syncadaptor = fs.readFileSync('plugins/dist/$__plugins_linonetwo_expo-file-system-syncadaptor.json');
fs.writeFileSync('assets/plugins/syncadaptor.html', syncadaptor);
