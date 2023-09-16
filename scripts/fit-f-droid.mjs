import fs from 'fs-extra';
import path from 'path';

const projectRoot = path.join(__dirname, '..');

const expoLocationPath = path.join(projectRoot, 'node_modules', 'expo-location');
const expoApplicationPath = path.join(projectRoot, 'node_modules', 'expo-application');

await Promise.all([fs.unlink(expoLocationPath), fs.unlink(expoApplicationPath)]);
await Promise.all([fs.copy(path.join(projectRoot, 'libs', 'expo-location'), expoLocationPath), fs.copy(path.join(projectRoot, 'libs', 'expo-application'), expoApplicationPath)]);
