declare module 'noise-handshake' {
  export interface NoiseXxHandshakePeer {
    initialise(prologue: Buffer, remoteStatic?: Buffer): void;
    send(payload?: Buffer): Buffer;
    recv(buf: Buffer): Buffer;
    complete: boolean;
    tx: Buffer;
    rx: Buffer;
    rs: Buffer;
    hash: Buffer;
  }

  export default class Noise {
    constructor(
      pattern: string,
      initiator: boolean,
      staticKeypair?: { publicKey: Buffer; secretKey: Buffer },
    );
    initialise(prologue: Buffer, remoteStatic?: Buffer): void;
    send(payload?: Buffer): Buffer;
    recv(buf: Buffer): Buffer;
    complete: boolean;
    tx: Buffer;
    rx: Buffer;
    rs: Buffer;
    hash: Buffer;
  }
}

declare module 'noise-handshake/dh.js' {
  export function generateKeyPair(): { publicKey: Buffer; secretKey: Buffer };
}

declare module 'react-native-zeroconf' {
  export interface ZeroconfService {
    name: string;
    host: string;
    port: number;
    addresses?: string[];
    txt?: Record<string, string>;
  }

  export default class Zeroconf {
    on(
      event: 'resolved' | 'remove',
      listener: (service: ZeroconfService) => void,
    ): void;
    on(event: 'error', listener: (error: unknown) => void): void;
    scan(type: string, protocol: string, domain: string): void;
    stop(): void;
    removeAllListeners(): void;
  }
}
