/**
 * Extract a ZIP file (in Uint8Array form) into a target directory.
 *
 * This is a minimal ZIP reader that supports:
 *   - Stored (uncompressed) entries
 *   - Deflated entries (raw inflate)
 *   - UTF-8 file names (bit 11 flag)
 *
 * Used to extract the bundled wiki-template.zip into a new wiki workspace folder.
 * The ZIP may include a pre-baked `.git` directory (single initial commit from CI build).
 */

import { Buffer } from 'buffer';
import * as FileSystem from 'expo-file-system/legacy';
import { ExternalStorage, toPlainPath } from 'expo-tiddlywiki-filesystem-android-external-storage';

interface ZipEntry {
  path: string;
  offset: number;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  crc32: number;
}

// ─── Inflate (RFC 1951) ────────────────────────────────────────────────────────

/**
 * Minimal raw inflate decompression.
 * Supports stored blocks and fixed Huffman blocks.
 */
function inflate(input: Uint8Array): Uint8Array {
  const output: number[] = [];

  function readBits(n: number): number {
    let value = 0;
    for (let index = 0; index < n; index++) {
      if (bytePos >= input.length) throw new Error('Unexpected end of input');
      value |= ((input[bytePos] >> bitPos) & 1) << index;
      bitPos++;
      if (bitPos === 8) {
        bitPos = 0;
        bytePos++;
      }
    }
    return value;
  }

  let bytePos = 0;
  let bitPos = 0;

  for (;;) {
    const bfinal = readBits(1);
    const btype = readBits(2);

    if (btype === 0) {
      // No compression
      if (bitPos !== 0) {
        bitPos = 0;
        bytePos++;
      }
      if (bytePos + 4 > input.length) throw new Error('Unexpected end of stored block');
      const length = input[bytePos] | (input[bytePos + 1] << 8);
      const invertedLength = input[bytePos + 2] | (input[bytePos + 3] << 8);
      bytePos += 4;
      if ((length ^ invertedLength) !== 0xFFFF) throw new Error('Stored block length check failed');
      if (bytePos + length > input.length) throw new Error('Unexpected end of stored block payload');
      for (let index = 0; index < length; index++) {
        output.push(input[bytePos++]);
      }
    } else if (btype === 1) {
      // Fixed Huffman codes
      // Build fixed Huffman tree
      const lengths: number[] = [];
      for (let index = 0; index <= 143; index++) lengths.push(8);
      for (let index = 144; index <= 255; index++) lengths.push(9);
      for (let index = 256; index <= 279; index++) lengths.push(7);
      for (let index = 280; index <= 287; index++) lengths.push(8);

      const litTree = buildHuffmanTree(lengths);
      const distributionTree = buildHuffmanTree(Array<number>(32).fill(5));

      decompressBlock(readBits, litTree, distributionTree, output);
    } else {
      throw new Error(`Unsupported block type: ${btype} (dynamic Huffman not implemented)`);
    }

    if (bfinal) break;
  }

  return new Uint8Array(output);
}

interface HuffmanNode {
  children: [HuffmanNode | null, HuffmanNode | null];
  symbol: number | null;
}

function buildHuffmanTree(lengths: number[]): HuffmanNode {
  // Count codes per length
  const bitLengthCounts: number[] = Array<number>(16).fill(0);
  for (const length of lengths) {
    if (length > 0) bitLengthCounts[length]++;
  }

  // Find numerical value of smallest code for each length
  let code = 0;
  const nextCode: number[] = Array<number>(16).fill(0);
  for (let bits = 1; bits <= 15; bits++) {
    code = (code + bitLengthCounts[bits - 1]) << 1;
    nextCode[bits] = code;
  }

  // Build tree
  const root: HuffmanNode = { children: [null, null], symbol: null };

  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const length = lengths[symbol];
    if (length === 0) continue;

    const codeValue = nextCode[length]++;
    // Insert into tree
    let node = root;
    for (let bit = length - 1; bit >= 0; bit--) {
      const direction = (codeValue >> bit) & 1;
      if (!node.children[direction]) {
        node.children[direction] = { children: [null, null], symbol: null };
      }
      node = node.children[direction]!;
    }
    node.symbol = symbol;
  }

  return root;
}

function decompressBlock(
  readBits: (n: number) => number,
  litTree: HuffmanNode,
  distributionTree: HuffmanNode,
  output: number[],
): void {
  const lengthExtraBits = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const lengthBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const distributionExtraBits = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const distributionBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];

  function decodeSymbol(tree: HuffmanNode): number {
    let node = tree;
    while (node.symbol === null) {
      const bit = readBits(1);
      node = node.children[bit]!;
    }
    return node.symbol;
  }

  for (;;) {
    const symbol = decodeSymbol(litTree);

    if (symbol < 256) {
      output.push(symbol);
    } else if (symbol === 256) {
      // End of block
      break;
    } else {
      // Length/distance pair
      const lengthIndex = symbol - 257;
      let length = lengthBase[lengthIndex];
      if (lengthExtraBits[lengthIndex] > 0) {
        length += readBits(lengthExtraBits[lengthIndex]);
      }

      const distributionIndex = decodeSymbol(distributionTree);
      let distance = distributionBase[distributionIndex];
      if (distributionExtraBits[distributionIndex] > 0) {
        distance += readBits(distributionExtraBits[distributionIndex]);
      }

      // Copy from output
      const start = output.length - distance;
      for (let index = 0; index < length; index++) {
        output.push(output[start + index]);
      }
    }
  }
}

// ─── ZIP Parser ─────────────────────────────────────────────────────────────────

function parseZipEndRecord(data: Uint8Array): { entries: number; cdOffset: number; cdSize: number } {
  // Search for end of central directory signature backwards from end
  // (there might be a comment after it, but we assume no comment)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const size = data.length;

  for (let pos = size - 22; pos >= 0; pos--) {
    if (view.getUint32(pos, true) === 0x06054b50) {
      const entries = view.getUint16(pos + 8, true);
      const cdSize = view.getUint32(pos + 12, true);
      const cdOffset = view.getUint32(pos + 16, true);
      return { entries, cdOffset, cdSize };
    }
  }

  throw new Error('End of central directory record not found');
}

function parseCentralDirectory(data: Uint8Array, cdOffset: number, entryCount: number): ZipEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const entries: ZipEntry[] = [];
  let pos = cdOffset;

  for (let index = 0; index < entryCount; index++) {
    if (view.getUint32(pos, true) !== 0x02014b50) {
      throw new Error(`Central directory entry ${index} not found at offset ${pos}`);
    }

    const compressionMethod = view.getUint16(pos + 10, true);
    const crc32 = view.getUint32(pos + 16, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const uncompressedSize = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);

    const nameBytes = data.slice(pos + 46, pos + 46 + nameLength);
    const name = new TextDecoder().decode(nameBytes);

    entries.push({
      path: name,
      offset: localOffset,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      crc32,
    });

    pos += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

interface LocalHeader {
  nameLength: number;
  extraLength: number;
  dataOffset: number;
}

function parseLocalHeader(data: Uint8Array, offset: number): LocalHeader {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  if (view.getUint32(offset, true) !== 0x04034b50) {
    throw new Error(`Local file header not found at offset ${offset}`);
  }

  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataOffset = offset + 30 + nameLength + extraLength;

  return { nameLength, extraLength, dataOffset };
}

function getSafeZipEntryPath(entryPath: string): string | null {
  const normalizedPath = entryPath.replace(/\\/g, '/');
  if (
    normalizedPath.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalizedPath) ||
    normalizedPath.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    return null;
  }

  return normalizedPath;
}

// ─── Main Extraction ────────────────────────────────────────────────────────────

/**
 * Extract a ZIP file (as Uint8Array) to a target directory.
 * Creates directories as needed.
 *
 * @param zipData - The ZIP file content as Uint8Array
 * @param targetDirectory - The target directory path (e.g., 'file:///data/.../wikis/my-wiki/')
 * @param useExternalStorage - Whether the target is on external SD card / user-accessible storage
 */
export async function extractZipToDirectory(
  zipData: Uint8Array,
  targetDirectory: string,
  useExternalStorage = false,
  onProgress?: (current: number, total: number) => void,
): Promise<void> {
  const normalizedTargetDirectory = targetDirectory.endsWith('/') ? targetDirectory : `${targetDirectory}/`;

  // Ensure target directory exists
  if (useExternalStorage) {
    const plainPath = toPlainPath(normalizedTargetDirectory);
    const info = await ExternalStorage.getInfo(plainPath);
    if (!info.exists) {
      await ExternalStorage.mkdir(plainPath);
    }
  } else {
    const directoryInfo = await FileSystem.getInfoAsync(normalizedTargetDirectory);
    if (!directoryInfo.exists) {
      await FileSystem.makeDirectoryAsync(normalizedTargetDirectory, { intermediates: true });
    }
  }

  // Parse ZIP
  const { entries, cdOffset } = parseZipEndRecord(zipData);
  const fileEntries = parseCentralDirectory(zipData, cdOffset, entries);

  let extracted = 0;
  let totalFiles = 0;
  for (const entry of fileEntries) {
    if (entry.path.endsWith('/')) continue;
    if (entry.path.endsWith('tidgi.config.json')) continue;
    totalFiles++;
  }

  console.log(`[extractZipToDirectory] Extracting ${totalFiles} files to ${normalizedTargetDirectory}`);

  for (const entry of fileEntries) {
    // Skip directory entries (those ending with /)
    if (entry.path.endsWith('/')) continue;
    // Skip tidgi.config.json from template (let the app create its own)
    if (entry.path.endsWith('tidgi.config.json')) continue;

    const safeEntryPath = getSafeZipEntryPath(entry.path);
    if (!safeEntryPath) {
      console.warn(`[extractZipToDirectory] Skipping unsafe path: ${entry.path}`);
      continue;
    }

    // Parse local header to find data
    const localHeader = parseLocalHeader(zipData, entry.offset);
    const compressedData = zipData.slice(localHeader.dataOffset, localHeader.dataOffset + entry.compressedSize);

    // Decompress
    let fileContent: Uint8Array;
    if (entry.compressionMethod === 0) {
      // Stored (no compression)
      fileContent = compressedData;
    } else if (entry.compressionMethod === 8) {
      // Deflated
      fileContent = inflate(compressedData);
    } else {
      console.warn(`[extractZipToDirectory] Unsupported compression method ${entry.compressionMethod} for ${entry.path}, skipping`);
      continue;
    }

    // Build target file path
    const targetPath = `${normalizedTargetDirectory}${safeEntryPath}`;

    // Ensure parent directory exists
    const parentDirectory = targetPath.substring(0, targetPath.lastIndexOf('/'));

    if (useExternalStorage) {
      const parentPlain = toPlainPath(parentDirectory);
      const parentInfo = await ExternalStorage.getInfo(parentPlain);
      if (!parentInfo.exists) {
        await ExternalStorage.mkdir(parentPlain);
      }
    } else {
      const parentInfo = await FileSystem.getInfoAsync(parentDirectory);
      if (!parentInfo.exists) {
        await FileSystem.makeDirectoryAsync(parentDirectory, { intermediates: true });
      }
    }

    // Write file
    const base64 = Buffer.from(fileContent).toString('base64');
    if (useExternalStorage) {
      await ExternalStorage.writeFileBase64(toPlainPath(targetPath), base64);
    } else {
      await FileSystem.writeAsStringAsync(targetPath, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
    extracted++;
    onProgress?.(extracted, totalFiles);
  }

  console.log(`[extractZipToDirectory] Extraction complete: ${totalFiles} files to ${normalizedTargetDirectory}`);
}
