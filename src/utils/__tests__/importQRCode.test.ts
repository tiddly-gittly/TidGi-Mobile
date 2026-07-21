import { extractServerFieldsFromQR, isHtmlQRData, isImportQRData, looksLikeUtf8Mojibake, parseImportQRCode, parsePossiblyMojibakeJson } from '../importQRCode';

describe('importQRCode', () => {
  const samplePayload = {
    baseUrl: 'http://192.168.1.10:5212',
    workspaceId: 'wiki-1',
    workspaceName: '笔记',
    token: 'secret',
    tokenAuthHeaderName: 'authorization',
    tokenAuthHeaderValue: 'Bearer secret',
  };

  it('parses a normal desktop QR JSON payload', () => {
    const result = parseImportQRCode(JSON.stringify(samplePayload));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.baseUrl).toBe(samplePayload.baseUrl);
    expect(result.data.workspaceId).toBe(samplePayload.workspaceId);
    expect(isImportQRData(result.data)).toBe(true);
    expect(isHtmlQRData(result.data)).toBe(false);
  });

  it('recovers UTF-8 mojibake from Latin-1 mis-decode', () => {
    const json = JSON.stringify(samplePayload);
    // Simulate Android ZXing Latin-1 mis-decode of UTF-8 byte-mode QR content.
    const mojibake = Array.from(new TextEncoder().encode(json), byte => String.fromCharCode(byte)).join('');
    expect(looksLikeUtf8Mojibake(mojibake)).toBe(true);
    const parsed = parsePossiblyMojibakeJson(mojibake);
    expect(isImportQRData(parsed)).toBe(true);
    if (!isImportQRData(parsed)) return;
    expect(parsed.workspaceName).toBe('笔记');
  });

  it('extracts server fields from desktop QR JSON', () => {
    const fields = extractServerFieldsFromQR(JSON.stringify(samplePayload));
    expect(fields).toEqual({
      uri: 'http://192.168.1.10:5212',
      name: '笔记',
      useStandardGitProtocol: false,
      workspaceId: 'wiki-1',
      token: 'secret',
      tokenAuthHeaderName: 'authorization',
      tokenAuthHeaderValue: 'Bearer secret',
    });
  });

  it('extracts server fields from a plain URL', () => {
    const fields = extractServerFieldsFromQR('http://desktop.local:5212/path');
    expect(fields).toEqual({
      uri: 'http://desktop.local:5212',
      useStandardGitProtocol: false,
    });
  });

  it('returns undefined for garbage QR content', () => {
    expect(extractServerFieldsFromQR('not-a-url-or-json')).toBeUndefined();
  });

  it('recognizes html sync QR payloads', () => {
    const result = parseImportQRCode(JSON.stringify({
      baseUrl: 'http://192.168.1.10:5212',
      workspaceId: 'html-1',
      workspaceName: 'HTML Wiki',
      syncType: 'html',
      htmlUrl: 'http://192.168.1.10:5212/html/wiki.html',
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isHtmlQRData(result.data)).toBe(true);
  });
});
