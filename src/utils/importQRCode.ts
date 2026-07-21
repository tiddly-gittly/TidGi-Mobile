/**
 * Shared QR payload parsing for TidGi Desktop sync codes.
 *
 * Desktop QR codes are JSON with at least `baseUrl` + `workspaceId`.
 * Some Android scanners (ZXing via expo-camera) mis-decode UTF-8 Byte-mode
 * QR payloads as Latin-1, so we re-decode before/after JSON.parse when needed.
 */

export interface GitQRData {
  baseUrl: string;
  gitUrl?: string;
  token?: string;
  tokenAuthHeaderName?: string;
  tokenAuthHeaderValue?: string;
  workspaceId: string;
  workspaceName?: string;
  subWorkspaces?: Array<{ id: string; mainWikiID?: string; name: string }>;
}

export interface HtmlQRData {
  baseUrl: string;
  htmlUrl: string;
  readOnly?: boolean;
  revision?: string;
  syncType: 'html';
  tokenAuthHeaderName?: string;
  tokenAuthHeaderValue?: string;
  workspaceId: string;
  workspaceName?: string;
}

export type ImportQRData = GitQRData | HtmlQRData;

export interface ServerFieldsFromQR {
  name?: string;
  token?: string;
  tokenAuthHeaderName?: string;
  tokenAuthHeaderValue?: string;
  uri: string;
  /** Desktop QR always uses the TidGi bundle protocol. */
  useStandardGitProtocol: boolean;
  workspaceId?: string;
}

export type ParseImportQRResult =
  | { ok: true; data: ImportQRData }
  | { ok: false; error: 'invalid_format' | 'parse_error'; detail: string; raw: string };

/**
 * True when `raw` looks like UTF-8 bytes that were incorrectly decoded as Latin-1:
 * lead byte (0xC2–0xF4) followed by a continuation byte (0x80–0xBF).
 */
export function looksLikeUtf8Mojibake(raw: string): boolean {
  for (let index = 0; index < raw.length - 1; index += 1) {
    const lead = raw.charCodeAt(index);
    if (lead < 0xC2 || lead > 0xF4) continue;
    const continuation = raw.charCodeAt(index + 1);
    if (continuation >= 0x80 && continuation <= 0xBF) {
      return true;
    }
  }
  return false;
}

function redecodeLatin1AsUtf8Json(raw: string): unknown {
  const bytes = Uint8Array.from({ length: raw.length }, (_, index) => raw.charCodeAt(index) & 0xFF);
  const reDecoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return JSON.parse(reDecoded) as unknown;
}

/**
 * Parse JSON that may have been mojibake-decoded as Latin-1.
 */
export function parsePossiblyMojibakeJson(raw: string): unknown {
  const cleaned = raw.replace(/^\uFEFF/, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    // JSON.parse can "succeed" with garbled CJK (C1 bytes are still valid in JSON
    // strings). Prefer a UTF-8 re-decode when the raw text looks like mojibake.
    if (looksLikeUtf8Mojibake(cleaned)) {
      try {
        return redecodeLatin1AsUtf8Json(cleaned);
      } catch {
        return parsed;
      }
    }
    return parsed;
  } catch {
    try {
      return redecodeLatin1AsUtf8Json(cleaned);
    } catch {
      return JSON.parse(cleaned) as unknown;
    }
  }
}

export function isImportQRData(value: unknown): value is ImportQRData {
  return (
    value !== null &&
    typeof value === 'object' &&
    'baseUrl' in value &&
    'workspaceId' in value &&
    typeof (value as { baseUrl: unknown }).baseUrl === 'string' &&
    typeof (value as { workspaceId: unknown }).workspaceId === 'string' &&
    (value as { baseUrl: string }).baseUrl.length > 0 &&
    (value as { workspaceId: string }).workspaceId.length > 0
  );
}

export function isHtmlQRData(qrData: ImportQRData | undefined): qrData is HtmlQRData {
  return qrData !== undefined && 'syncType' in qrData;
}

export function parseImportQRCode(raw: string): ParseImportQRResult {
  try {
    const parsed = parsePossiblyMojibakeJson(raw);
    if (isImportQRData(parsed)) {
      return { ok: true, data: parsed };
    }
    return {
      ok: false,
      error: 'invalid_format',
      detail: JSON.stringify(parsed, null, 2),
      raw,
    };
  } catch (error) {
    return {
      ok: false,
      error: 'parse_error',
      detail: (error as Error).message,
      raw,
    };
  }
}

/**
 * Extract server URI / auth fields from a desktop QR string, or a plain URL.
 * Used by "add/edit server" flows that only need connection info.
 */
export function extractServerFieldsFromQR(raw: string): ServerFieldsFromQR | undefined {
  const trimmed = raw.replace(/^\uFEFF/, '').trim();
  if (trimmed.length === 0) return undefined;

  const parsed = parseImportQRCode(trimmed);
  if (parsed.ok) {
    const { data } = parsed;
    let uri: string;
    try {
      uri = new URL(data.baseUrl).origin;
    } catch {
      uri = data.baseUrl.replace(/\/$/, '');
    }
    return {
      uri,
      name: data.workspaceName,
      useStandardGitProtocol: false,
      workspaceId: data.workspaceId,
      token: 'token' in data ? data.token : undefined,
      tokenAuthHeaderName: data.tokenAuthHeaderName,
      tokenAuthHeaderValue: data.tokenAuthHeaderValue,
    };
  }

  // Fallback: plain URL pasted/scanned as the server origin
  try {
    const url = new URL(trimmed);
    return {
      uri: url.origin,
      useStandardGitProtocol: false,
    };
  } catch {
    return undefined;
  }
}
