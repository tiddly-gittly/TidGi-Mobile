import { promises as fs } from 'fs';

const gradleFilePath = './android/app/build.gradle';
let gradleFileContent = await fs.readFile(gradleFilePath, 'utf8');

// Correctly comment out the 'signingConfig' line in the 'release' build type
gradleFileContent = gradleFileContent.replaceAll(/signingConfig signingConfigs.debug/g, '// signingConfig signingConfigs.debug');

await fs.writeFile(gradleFilePath, gradleFileContent);
