/**
 * Extract a ZIP file (in Uint8Array form) into a target directory.
 *
 * This is a minimal ZIP reader that supports:
 *   - Stored (uncompressed) entries
 *   - Deflated entries (raw inflate)
 *   - UTF-8 file names (bit 11 flag)
 *
 * Used to extract the bundled wiki-template.zip into a new wiki workspace folder.
 */

import * as FileSystem from 'expo-file-system/legacy';

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
  let pos = 0;

  function readBits(n: number): number {
    let value = 0;
    for (let i = 0; i < n; i++) {
      if (bytePos >= input.length) throw new Error('Unexpected end of input');
      value |= ((input[bytePos] >> bitPos) & 1) << i;
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

  while (true) {
    const bfinal = readBits(1);
    const btype = readBits(2);

    if (btype === 0) {
      // No compression
      bitPos = 0; // Skip to byte boundary
      bytePos++; // Actually we need to align to byte
      if (bytePos + 4 > input.length) throw new Error('Unexpected end of stored block');
      const len = input[bytePos] | (input[bytePos + 1] << 8);
      const nlen = input[bytePos + 2] | (input[bytePos + 3] << 8);
      bytePos += 4;
      if ((len ^ nlen) !== 0xFFFF) throw new Error('Stored block length check failed');
      for (let i = 0; i < len; i++) {
        output.push(input[bytePos++]);
      }
    } else if (btype === 1) {
      // Fixed Huffman codes
      // Build fixed Huffman tree
      const lengths: number[] = [];
      for (let i = 0; i <= 143; i++) lengths.push(8);
      for (let i = 144; i <= 255; i++) lengths.push(9);
      for (let i = 256; i <= 279; i++) lengths.push(7);
      for (let i = 280; i <= 287; i++) lengths.push(8);

      const litTree = buildHuffmanTree(lengths);
      const distTree = buildHuffmanTree(new Array(32).fill(5));

      decompressBlock(readBits, litTree, distTree, output);
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
  const blCount = new Array(16).fill(0);
  for (const len of lengths) {
    if (len > 0) blCount[len]++;
  }

  // Find numerical value of smallest code for each length
  let code = 0;
  const nextCode = new Array(16).fill(0);
  for (let bits = 1; bits <= 15; bits++) {
    code = (code + blCount[bits - 1]) << 1;
    nextCode[bits] = code;
  }

  // Build tree
  const root: HuffmanNode = { children: [null, null], symbol: null };

  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const len = lengths[symbol];
    if (len === 0) continue;

    const codeValue = nextCode[len]++;
    // Insert into tree
    let node = root;
    for (let bit = len - 1; bit >= 0; bit--) {
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
  distTree: HuffmanNode,
  output: number[],
): void {
  const lengthExtraBits = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const lengthBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const distExtraBits = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const distBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];

  function decodeSymbol(tree: HuffmanNode): number {
    let node = tree;
    while (node.symbol === null) {
      const bit = readBits(1);
      node = node.children[bit]!;
    }
    return node.symbol;
  }

  while (true) {
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

      const distIndex = decodeSymbol(distTree);
      let distance = distBase[distIndex];
      if (distExtraBits[distIndex] > 0) {
        distance += readBits(distExtraBits[distIndex]);
      }

      // Copy from output
      const start = output.length - distance;
      for (let i = 0; i < length; i++) {
        output.push(output[start + i]);
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

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) {
      throw new Error(`Central directory entry ${i} not found at offset ${pos}`);
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

// ─── Main Extraction ────────────────────────────────────────────────────────────

/**
 * Extract a ZIP file (as Uint8Array) to a target directory.
 * Creates directories as needed.
 *
 * @param zipData - The ZIP file content as Uint8Array
 * @param targetDir - The target directory path (e.g., 'file:///data/.../wikis/my-wiki/')
 */
export async function extractZipToDirectory(zipData: Uint8Array, targetDir: string): Promise<void> {
  // Ensure target directory exists
  const dirInfo = await FileSystem.getInfoAsync(targetDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
  }

  // Parse ZIP
  const { entries, cdOffset } = parseZipEndRecord(zipData);
  const fileEntries = parseCentralDirectory(zipData, cdOffset, entries);

  console.log(`[extractZipToDirectory] Extracting ${fileEntries.length} files to ${targetDir}`);

  for (const entry of fileEntries) {
    // Skip directory entries (those ending with /)
    if (entry.path.endsWith('/')) continue;
    // Skip .git entries (we don't want git history in new workspace)
    if (entry.path.includes('/.git/') || entry.path.startsWith('.git/')) continue;
    // Skip tidgi.config.json from template (let the app create its own)
    if (entry.path.endsWith('tidgi.config.json')) continue;

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
    const targetPath = `${targetDir}${entry.path}`;

    // Ensure parent directory exists
    const parentDir = targetPath.substring(0, targetPath.lastIndexOf('/'));
    const parentInfo = await FileSystem.getInfoAsync(parentDir);
    if (!parentInfo.exists) {
      await FileSystem.makeDirectoryAsync(parentDir, { intermediates: true });
    }

    // Write file
    // Convert to base64 for expo-file-system write
    const base64 = btoa(String.fromCharCode(...fileContent));
    await FileSystem.writeAsStringAsync(targetPath, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }

  console.log(`[extractZipToDirectory] Extraction complete: ${fileEntries.length} files to ${targetDir}`);
}
