/* eslint-disable unicorn/prevent-abbreviations */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { mkdir, readFile, writeFile, rmdir } from 'fs/promises';
import { $ } from 'zx';

if (process.platform === 'win32') {
  $.prefix = '';
  $.shell = 'pwsh.exe';
}
// Read the TypeScript file
const tsFilePath = 'src/pages/WikiWebView/useStreamChunksToWebView/streamChunksPreloadScript.ts';
const tsContent = await readFile(tsFilePath, 'utf8');

// Replace all occurrences of 'export' with an empty string
const modifiedTsContent = tsContent.replaceAll('export ', '');

// Write the modified content to a temporary file
const tmpTsFilePath = 'build/streamChunksPreloadScript.ts';
try {
  await mkdir('build');
} catch {}
await writeFile(tmpTsFilePath, modifiedTsContent);

// Use TypeScript compiler to compile the temporary file
const outFilePath = 'assets/preload/streamChunksPreloadScript.js.html';
try {
  await $`tsc ${tmpTsFilePath.replace('C:\\', '/')} --outFile ${outFilePath}`;
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await rmdir('build', { recursive: true });
}

// Optionally, you can log the output file path or perform other actions
console.log(`Compiled file written to: ${outFilePath}`);
