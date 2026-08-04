import * as SecureStore from 'expo-secure-store';

const CLOUD_CONFIG_KEY = 'device_network_cloud_config_v1';
const MAXIMUM_ACCESS_TOKEN_LENGTH = 16_384;
const MAXIMUM_CLOUD_URL_LENGTH = 2_048;

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export interface DeviceNetworkCloudConfig {
  accessToken: string;
  cloudUrl: string;
  model?: string;
  provider?: string;
}

export interface CloudLlmConnection {
  apiKey: string;
  baseURL: string;
  headers?: Record<string, string>;
  modelId: string;
}

export function normalizeCloudConfig(value: DeviceNetworkCloudConfig): DeviceNetworkCloudConfig {
  const cloudUrl = value.cloudUrl.trim().replace(/\/+$/, '');
  const accessToken = value.accessToken.trim();
  if (!cloudUrl || !accessToken) throw new Error('cloud_config_incomplete');
  if (cloudUrl.length > MAXIMUM_CLOUD_URL_LENGTH || accessToken.length > MAXIMUM_ACCESS_TOKEN_LENGTH) {
    throw new Error('cloud_config_too_large');
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(cloudUrl);
  } catch {
    throw new Error('cloud_config_invalid_url');
  }
  if (parsedUrl.protocol !== 'https:' && !(parsedUrl.protocol === 'http:' && isLoopbackHostname(parsedUrl.hostname))) {
    throw new Error('cloud_config_invalid_url');
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash || (parsedUrl.pathname !== '/' && parsedUrl.pathname !== '')) {
    throw new Error('cloud_config_invalid_url');
  }
  return {
    cloudUrl: parsedUrl.origin,
    accessToken,
    ...(value.provider?.trim() ? { provider: value.provider.trim() } : {}),
    ...(value.model?.trim() ? { model: value.model.trim() } : {}),
  };
}

export function cloudLlmConnection(config: DeviceNetworkCloudConfig): CloudLlmConnection {
  const normalized = normalizeCloudConfig(config);
  return {
    apiKey: normalized.accessToken,
    baseURL: `${normalized.cloudUrl}/api/llm/v1`,
    modelId: normalized.model ?? 'gpt-4o-mini',
    ...(normalized.provider ? { headers: { 'x-agent-type': normalized.provider } } : {}),
  };
}

export function parseCloudConfig(value: string | null): DeviceNetworkCloudConfig | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<DeviceNetworkCloudConfig>;
    if (typeof parsed.cloudUrl !== 'string' || typeof parsed.accessToken !== 'string') return undefined;
    return normalizeCloudConfig({
      cloudUrl: parsed.cloudUrl,
      accessToken: parsed.accessToken,
      ...(typeof parsed.provider === 'string' ? { provider: parsed.provider } : {}),
      ...(typeof parsed.model === 'string' ? { model: parsed.model } : {}),
    });
  } catch {
    return undefined;
  }
}

export async function loadCloudConfig(): Promise<DeviceNetworkCloudConfig | undefined> {
  return parseCloudConfig(await SecureStore.getItemAsync(CLOUD_CONFIG_KEY));
}

export async function saveCloudConfig(config: DeviceNetworkCloudConfig): Promise<DeviceNetworkCloudConfig> {
  const normalized = normalizeCloudConfig(config);
  await SecureStore.setItemAsync(CLOUD_CONFIG_KEY, JSON.stringify(normalized));
  return normalized;
}

/** Applies verified credentials before making them durable. */
export async function applyAndSaveCloudConfig(
  config: DeviceNetworkCloudConfig,
  applyVerifiedConfig: (config: DeviceNetworkCloudConfig) => Promise<DeviceNetworkCloudConfig>,
): Promise<DeviceNetworkCloudConfig> {
  const normalized = normalizeCloudConfig(config);
  const applied = await applyVerifiedConfig(normalized);
  return saveCloudConfig(applied);
}

export async function clearCloudConfig(): Promise<void> {
  await SecureStore.deleteItemAsync(CLOUD_CONFIG_KEY);
}
