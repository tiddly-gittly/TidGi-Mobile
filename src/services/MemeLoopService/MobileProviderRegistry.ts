/**
 * Mobile-specific ProviderRegistry with secure API key storage.
 *
 * Supports:
 * - Custom providers (name + baseURL + apiKey stored in expo-secure-store)
 * - MemeLoop subscription mode (uses cloud JWT)
 * - Vercel AI SDK LanguageModelV1 integration
 */
import * as SecureStore from 'expo-secure-store';
import type { ILLMProvider } from './protocol-types';

export interface MobileProviderConfig {
  name: string;
  baseUrl: string;
  apiKey?: string; // Optional - will be loaded from secure store
  models?: string[];
}

const SECURE_STORE_PREFIX = 'memeloop_provider_key_';

export class MobileProviderRegistry {
  private providers = new Map<string, ILLMProvider>();
  private configs = new Map<string, MobileProviderConfig>();

  /**
   * Register a provider with secure API key storage.
   */
  async register(config: MobileProviderConfig, apiKey?: string): Promise<void> {
    // Store API key securely if provided
    if (apiKey) {
      await SecureStore.setItemAsync(
        `${SECURE_STORE_PREFIX}${config.name}`,
        apiKey,
      );
    }

    // Create ILLMProvider instance
    const provider: ILLMProvider = {
      name: config.name,
      model: null, // Will be set by AI SDK integration
      async chat(request: unknown) {
        // Legacy chat method - delegates to OpenAI-compatible API
        const key = await SecureStore.getItemAsync(
          `${SECURE_STORE_PREFIX}${config.name}`,
        );
        if (!key) {
          throw new Error(`No API key found for provider: ${config.name}`);
        }

        const response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `Provider ${config.name} error: ${response.status} ${text.slice(0, 200)}`,
          );
        }

        const responsePayload: unknown = await response.json();
        return responsePayload;
      },
    };

    this.providers.set(config.name, provider);
    this.configs.set(config.name, config);
  }

  /**
   * Register MemeLoop subscription provider (uses cloud JWT).
   */
  registerSubscription(cloudUrl: string, jwt: string): void {
    const provider: ILLMProvider = {
      name: 'memeloop-subscription',
      model: null,
      async chat(request: unknown) {
        const response = await fetch(`${cloudUrl}/api/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwt}`,
          },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `MemeLoop subscription error: ${response.status} ${text.slice(0, 200)}`,
          );
        }

        const responsePayload: unknown = await response.json();
        return responsePayload;
      },
    };

    this.providers.set('memeloop-subscription', provider);
  }

  /**
   * Unregister a provider and remove its API key.
   */
  async unregister(name: string): Promise<void> {
    this.providers.delete(name);
    this.configs.delete(name);
    await SecureStore.deleteItemAsync(`${SECURE_STORE_PREFIX}${name}`).catch(
      () => {},
    );
  }

  /**
   * Get a provider by name.
   */
  get(name: string): ILLMProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * List all registered provider names.
   */
  list(): string[] {
    return Array.from(this.providers.keys()).sort();
  }

  /**
   * Get provider config (without API key).
   */
  getConfig(name: string): MobileProviderConfig | undefined {
    return this.configs.get(name);
  }

  /**
   * Check if a provider has an API key stored.
   */
  async hasApiKey(name: string): Promise<boolean> {
    const key = await SecureStore.getItemAsync(`${SECURE_STORE_PREFIX}${name}`);
    return key !== null;
  }

  /**
   * Get the default provider (first registered or subscription if active).
   */
  getDefault(): ILLMProvider | undefined {
    const subscription = this.providers.get('memeloop-subscription');
    if (subscription) return subscription;

    const names = this.list();
    return names.length > 0 ? this.providers.get(names[0]) : undefined;
  }
}
