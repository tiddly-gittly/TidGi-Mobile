import * as SecureStore from 'expo-secure-store';

const EXTERNAL_API_CONFIG_KEY = 'memeloop_external_api_config_v1';
const MAXIMUM_API_KEY_LENGTH = 16_384;
const MAXIMUM_IDENTIFIER_LENGTH = 512;
const MAXIMUM_URL_LENGTH = 2_048;
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code <= 0x1F || code === 0x7F) return true;
  }
  return false;
}

export interface ExternalAPIConfig {
  apiKey: string;
  apiMode: 'chat-completions' | 'responses';
  baseURL: string;
  modelId: string;
  providerId: string;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function normalizeExternalAPIConfig(value: ExternalAPIConfig): ExternalAPIConfig {
  const apiKey = value.apiKey.trim();
  const providerId = value.providerId.trim();
  const modelId = value.modelId.trim();
  const rawURL = value.baseURL.trim().replace(/\/+$/, '');
  if (!apiKey || !providerId || !modelId || !rawURL) throw new Error('external_api_config_incomplete');
  const apiMode: unknown = value.apiMode;
  if (apiMode !== 'chat-completions' && apiMode !== 'responses') throw new Error('external_api_invalid_api_mode');
  if (
    apiKey.length > MAXIMUM_API_KEY_LENGTH || rawURL.length > MAXIMUM_URL_LENGTH ||
    providerId.length > MAXIMUM_IDENTIFIER_LENGTH || modelId.length > MAXIMUM_IDENTIFIER_LENGTH
  ) {
    throw new Error('external_api_config_too_large');
  }
  if (hasControlCharacter(providerId) || hasControlCharacter(modelId)) throw new Error('external_api_invalid_identifier');
  let url: URL;
  try {
    url = new URL(rawURL);
  } catch {
    throw new Error('external_api_invalid_url');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new Error('external_api_invalid_url');
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('external_api_invalid_url');
  const pathname = url.pathname === '/' ? '/v1' : url.pathname.replace(/\/+$/, '');
  return {
    apiKey,
    apiMode,
    baseURL: `${url.origin}${pathname}`,
    modelId,
    providerId,
  };
}

export function parseExternalAPIConfig(value: string | null): ExternalAPIConfig | undefined {
  if (!value) return undefined;
  try {
    const record = JSON.parse(value) as Partial<ExternalAPIConfig>;
    if (
      typeof record.apiKey !== 'string' || typeof record.baseURL !== 'string' ||
      typeof record.modelId !== 'string' || typeof record.providerId !== 'string' ||
      (record.apiMode !== 'chat-completions' && record.apiMode !== 'responses')
    ) return undefined;
    return normalizeExternalAPIConfig(record as ExternalAPIConfig);
  } catch {
    return undefined;
  }
}

export async function loadExternalAPIConfig(): Promise<ExternalAPIConfig | undefined> {
  return parseExternalAPIConfig(await SecureStore.getItemAsync(EXTERNAL_API_CONFIG_KEY));
}

export async function saveExternalAPIConfig(config: ExternalAPIConfig): Promise<ExternalAPIConfig> {
  const normalized = normalizeExternalAPIConfig(config);
  await SecureStore.setItemAsync(EXTERNAL_API_CONFIG_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function clearExternalAPIConfig(): Promise<void> {
  await SecureStore.deleteItemAsync(EXTERNAL_API_CONFIG_KEY);
}
