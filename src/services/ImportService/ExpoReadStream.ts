/* eslint-disable unicorn/no-null */
import * as fs from 'expo-file-system';
import { Readable } from 'readable-stream';

class ExpoReadStream extends Readable {
  private readonly fileUri: string;
  private fileSize: number;
  private currentPosition: number;
  private readonly chunkSize: number;

  constructor(fileUri: string, options: fs.ReadingOptions) {
    super();
    this.fileUri = fileUri;
    this.fileSize = 0; // Initialize file size (could be fetched if necessary)
    this.currentPosition = options.position ?? 0;
    /**
     * Default chunk size in bytes. React Native Expo will OOM at 110MB, so we set this to 1/50 of it to balance speed and memory usage and importantly the feedback for user.
     * If this is too large, the progress bar will be stuck when down stream processing this chunk, but too small will waste too much time in fs hand shake.
     */
    this.chunkSize = options.length ?? 1024 * 1024 * 5;
    void this._init();
  }

  async _init() {
    try {
      const fileInfo = await fs.getInfoAsync(this.fileUri, { size: true });
      if (fileInfo.exists) {
        this.fileSize = fileInfo.size ?? 0;
      } else {
        this.fileSize = 0;
      }
    } catch (error) {
      this.emit('error', error);
    }
  }

  _read() {
    const readingOptions = {
      encoding: fs.EncodingType.Base64,
      position: this.currentPosition,
      length: this.chunkSize,
    } satisfies fs.ReadingOptions;
    fs.readAsStringAsync(this.fileUri, readingOptions).then(chunk => {
      if (chunk.length === 0) {
        // End of the stream
        this.emit('progress', 1);
        this.push(null);
      } else {
        this.currentPosition = Math.min(this.chunkSize + this.currentPosition, this.fileSize);
        this.emit('progress', this.fileSize === 0 ? 0.5 : (this.currentPosition / this.fileSize));
        this.push(Buffer.from(chunk, 'base64'));
      }
    }).catch(error => {
      this.emit('error', error);
    });
  }
}

export function createReadStream(fileUri: string, options: fs.ReadingOptions = {}): ExpoReadStream {
  return new ExpoReadStream(fileUri, options);
}
