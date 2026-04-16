/**
 * NoiseWebSocketClient: WebSocket client with Noise_XX handshake
 * Based on memeloop ConnectionManager but adapted for React Native
 */

import { Buffer } from 'buffer';
import { createCipheriv, createDecipheriv } from 'crypto';
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, NoiseStaticKeyPair, PendingRequest } from './types';

const MEMELOOP_NOISE_PROLOGUE_V1 = Buffer.from('memeloop-noise-v1', 'utf8');
const RPC_TIMEOUT_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];

interface NoiseXxHandshakePeer {
  initialise(prologue: Buffer, remoteStatic?: Buffer): void;
  send(payload?: Buffer): Buffer;
  recv(buf: Buffer): Buffer;
  complete: boolean;
  tx: Buffer;
  rx: Buffer;
  rs: Buffer;
  hash: Buffer;
}

type NoiseClass = new(
  pattern: string,
  initiator: boolean,
  staticKeypair?: { publicKey: Buffer; secretKey: Buffer },
) => NoiseXxHandshakePeer;

let noiseModule: NoiseClass | null = null;

async function loadNoiseModule(): Promise<NoiseClass> {
  if (!noiseModule) {
    const mod = await import('noise-handshake');
    noiseModule = (mod as { default?: NoiseClass }).default ??
      (mod as unknown as NoiseClass);
  }
  return noiseModule;
}

class NoiseJsonRpcCodec {
  private sendCounter = 0n;

  constructor(
    private readonly sendKey: Buffer,
    private readonly recvKey: Buffer,
  ) {}

  encrypt(utf8Json: string): Buffer {
    const plaintext = Buffer.from(utf8Json, 'utf8');
    const frame = this.encryptFrame(this.sendKey, this.sendCounter, plaintext);
    this.sendCounter += 1n;
    return frame;
  }

  decrypt(frame: Buffer): string {
    const { plaintext } = this.decryptFrame(this.recvKey, frame);
    return plaintext.toString('utf8');
  }

  private encryptFrame(
    key: Buffer,
    counter: bigint,
    plaintext: Buffer,
  ): Buffer {
    const iv = Buffer.alloc(12, 0);
    iv.writeBigUInt64BE(counter, 4);

    const cipher = createCipheriv('chacha20-poly1305', key, iv, {
      authTagLength: 16,
    });
    const encryptedPayload = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    const counterBe = Buffer.alloc(8);
    counterBe.writeBigUInt64BE(counter, 0);
    const body = Buffer.concat([counterBe, encryptedPayload, tag]);

    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length, 0);
    return Buffer.concat([header, body]);
  }

  private decryptFrame(
    key: Buffer,
    frame: Buffer,
  ): { counter: bigint; plaintext: Buffer } {
    if (frame.length < 4 + 8 + 16) throw new Error('Frame too short');

    const frameLength = frame.readUInt32BE(0);
    if (frameLength < 8 + 16 || frame.length < 4 + frameLength) {
      throw new Error('Invalid frame length');
    }

    const body = frame.subarray(4, 4 + frameLength);
    const counter = body.subarray(0, 8).readBigUInt64BE(0);
    const iv = Buffer.alloc(12, 0);
    iv.writeBigUInt64BE(counter, 4);

    const ciphertext = body.subarray(8, body.length - 16);
    const tag = body.subarray(body.length - 16);

    const decipher = createDecipheriv('chacha20-poly1305', key, iv, {
      authTagLength: 16,
    });
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return { counter, plaintext };
  }
}

function encodePublicKey(publicKey: Buffer): string {
  return publicKey
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function isJsonRpcResponse(
  message: JsonRpcResponse | JsonRpcNotification,
): message is JsonRpcResponse {
  return 'id' in message;
}

function isJsonRpcMessage(
  value: unknown,
): value is JsonRpcResponse | JsonRpcNotification {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.jsonrpc === '2.0' &&
    (typeof candidate.id === 'number' || typeof candidate.method === 'string')
  );
}

export type ConnectionState = 'closed' | 'connecting' | 'handshaking' | 'open';

export interface NoiseWebSocketClientOptions {
  staticKeyPair: NoiseStaticKeyPair;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  onOpen?: () => void;
  onClose?: (event: { code?: number; reason?: string }) => void;
  onError?: (error: Error) => void;
  onRemotePublicKey?: (publicKey: string) => void;
}

export class NoiseWebSocketClient {
  private url: string;
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'closed';
  private opts: NoiseWebSocketClientOptions;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private noiseCodec: NoiseJsonRpcCodec | null = null;
  private rpcIdCounter = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private subscriptionHandlers = new Map<
    string,
    Set<(parameters: unknown) => void>
  >();
  private remotePublicKey: string | null = null;

  constructor(url: string, options: NoiseWebSocketClientOptions) {
    this.url = url;
    this.opts = {
      autoReconnect: true,
      maxReconnectAttempts: 10,
      ...options,
    };
  }

  getState(): ConnectionState {
    return this.state;
  }

  getRemotePublicKey(): string | null {
    return this.remotePublicKey;
  }

  connect(): void {
    if (
      this.state === 'connecting' ||
      this.state === 'handshaking' ||
      this.state === 'open'
    ) {
      return;
    }
    this.state = 'connecting';
    this.noiseCodec = null;
    this.remotePublicKey = null;

    try {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        void this.performHandshake();
      };

      this.ws.onclose = (event) => {
        this.handleClose(event);
      };
      this.ws.onerror = () => {
        this.opts.onError?.(new Error('WebSocket error'));
      };
    } catch (error) {
      this.state = 'closed';
      this.opts.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
      this.scheduleReconnect();
    }
  }

  private async performHandshake(): Promise<void> {
    const ws = this.ws;
    if (!ws) return;

    try {
      this.state = 'handshaking';
      const Noise = await loadNoiseModule();
      const peer = new Noise('XX', true, this.opts.staticKeyPair);
      peer.initialise(MEMELOOP_NOISE_PROLOGUE_V1);

      const message1 = peer.send();
      ws.send(new Uint8Array(message1));

      const message2 = await this.waitForOneBinaryFrame(ws);
      peer.recv(message2);

      const message3 = peer.send();
      ws.send(new Uint8Array(message3));

      if (!peer.complete) {
        throw new Error('Handshake incomplete');
      }

      this.noiseCodec = new NoiseJsonRpcCodec(peer.tx, peer.rx);
      this.remotePublicKey = encodePublicKey(peer.rs);

      this.state = 'open';
      this.reconnectAttempts = 0;

      ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event);
      };

      if (this.opts.onRemotePublicKey && this.remotePublicKey) {
        this.opts.onRemotePublicKey(this.remotePublicKey);
      }

      this.heartbeatTimer = setInterval(() => {
        this.sendHeartbeat();
      }, HEARTBEAT_INTERVAL_MS);
      this.opts.onOpen?.();
    } catch (error) {
      this.state = 'closed';
      this.noiseCodec = null;
      this.opts.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
      try {
        ws.close();
      } catch (closeError) {
        console.warn(
          'Failed to close websocket after handshake error',
          closeError,
        );
      }
    }
  }

  private waitForOneBinaryFrame(ws: WebSocket): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const done = (event: MessageEvent): void => {
        cleanup();
        const raw: unknown = event.data;
        if (typeof raw === 'string') {
          reject(new Error('Expected binary frame'));
          return;
        }
        if (raw instanceof ArrayBuffer) {
          resolve(Buffer.from(raw));
          return;
        }
        reject(new Error('Unsupported message payload'));
      };
      const onError = (): void => {
        cleanup();
        reject(new Error('WebSocket error during handshake'));
      };
      const cleanup = (): void => {
        ws.removeEventListener('message', done as EventListener);
        ws.removeEventListener('error', onError);
      };
      ws.addEventListener('message', done as EventListener, { once: true });
      ws.addEventListener('error', onError, { once: true });
    });
  }

  private sendRawUtf8(utf8: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.noiseCodec) {
      const enc = this.noiseCodec.encrypt(utf8);
      this.ws.send(new Uint8Array(enc));
    } else {
      this.ws.send(utf8);
    }
  }

  private sendHeartbeat(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        method: 'ping',
        id: null,
      });
      this.sendRawUtf8(payload);
    }
  }

  private handleMessage(event: MessageEvent): void {
    let text: string;
    const raw: unknown = event.data;

    if (this.noiseCodec) {
      const buf = raw instanceof ArrayBuffer
        ? Buffer.from(raw)
        : Buffer.from(String(raw), 'binary');
      try {
        text = this.noiseCodec.decrypt(buf);
      } catch (error) {
        console.warn('Failed to decrypt websocket frame', error);
        return;
      }
    } else {
      text = typeof raw === 'string' ? raw : '';
    }

    try {
      const parsed: unknown = JSON.parse(text);
      if (!isJsonRpcMessage(parsed)) {
        console.warn('Ignoring non-JSON-RPC websocket payload', parsed);
        return;
      }

      const data = parsed;

      if (isJsonRpcResponse(data)) {
        const pending = this.pendingRequests.get(data.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(data.id);
          if (data.error) {
            pending.reject(new Error(data.error.message));
          } else {
            pending.resolve(data.result);
          }
        }
      } else {
        const handlers = this.subscriptionHandlers.get(data.method);
        if (handlers) {
          for (const handler of handlers) {
            try {
              handler(data.parameters);
            } catch (error) {
              console.warn('Subscription handler failed', error);
            }
          }
        }
      }
    } catch (error) {
      console.warn('Failed to parse websocket message', error);
    }
  }

  private handleClose(event: CloseEvent): void {
    this.state = 'closed';
    this.noiseCodec = null;
    this.remotePublicKey = null;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection closed'));
      this.pendingRequests.delete(id);
    }

    this.ws = null;
    this.opts.onClose?.({ code: event.code, reason: event.reason });

    if (
      this.opts.autoReconnect &&
      this.reconnectAttempts < (this.opts.maxReconnectAttempts ?? 10)
    ) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = RECONNECT_DELAYS[
      Math.min(this.reconnectAttempts, RECONNECT_DELAYS.length - 1)
    ];
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  disconnect(): void {
    this.opts.autoReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.state = 'closed';
  }

  rpcCall<T = unknown>(method: string, parameters?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (
        !this.ws ||
        this.ws.readyState !== WebSocket.OPEN ||
        this.state !== 'open'
      ) {
        reject(new Error('Not connected'));
        return;
      }

      const id = ++this.rpcIdCounter;
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        parameters,
      };

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, RPC_TIMEOUT_MS);

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timer,
      });

      this.sendRawUtf8(JSON.stringify(request));
    });
  }

  subscribe(
    method: string,
    handler: (parameters: unknown) => void,
  ): () => void {
    if (!this.subscriptionHandlers.has(method)) {
      this.subscriptionHandlers.set(method, new Set());
    }
    this.subscriptionHandlers.get(method)!.add(handler);

    return () => {
      const handlers = this.subscriptionHandlers.get(method);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.subscriptionHandlers.delete(method);
        }
      }
    };
  }
}
