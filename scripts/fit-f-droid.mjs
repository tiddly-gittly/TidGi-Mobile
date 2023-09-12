import fs from 'fs-extra';

await Promise.all([fs.unlink('node_modules/expo-location'), fs.unlink('node_modules/expo-application')]);
await Promise.all([fs.copy('libs/expo-location', 'node_modules/expo-location'), fs.copy('libs/expo-application', 'node_modules/expo-application')]);
