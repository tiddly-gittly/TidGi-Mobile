import * as Application from 'expo-application';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import { useConfigStore } from '../../store/config';
import { expoFileSystemStorage } from '../../utils/expoFileSystemStorage';

type MobileAnalyticsEventName = 'app.launched' | 'tiddler.created';

interface IAnalyticsEventProperties {
  [key: string]: string | number | boolean | undefined;
}

interface IAnalyticsSecretSettings {
  deviceFirstLaunchDate?: string;
  deviceId?: string;
  deviceLastLaunchDate?: string;
}

interface ITrackPayload {
  event_name: MobileAnalyticsEventName;
  hostname: string;
  pathname: string;
  properties?: Record<string, string | number | boolean>;
  site_id: string;
  type: 'custom_event';
  user_id?: string;
}

const ANALYTICS_HOST = 'https://analytics.tidgi.fun';
const ANALYTICS_HOSTNAME = 'mobile.tidgi.fun';
const ANALYTICS_PATHNAME = '/mobile';
const ANALYTICS_SECRETS_KEY = 'analytics-secrets';
const ANALYTICS_SITE_ID = 'ea075d0b269d';
const DEFAULT_TIMEOUT_MS = 5000;

const allowedPropertiesByEvent: Record<MobileAnalyticsEventName, ReadonlySet<string>> = {
  'app.launched': new Set(['platform', 'version', 'firstLaunchDate', 'daysSinceLastLaunch', 'isFirstLaunch']),
  'tiddler.created': new Set(['storage', 'isSubWiki']),
};

const queuedEvents: Array<{ eventName: MobileAnalyticsEventName; properties?: IAnalyticsEventProperties }> = [];
let appStateSubscription: { remove: () => void } | undefined;
let flushInFlight: Promise<void> | undefined;

function isEnabled(): boolean {
  return !useConfigStore.getState().analyticsOptOut;
}

function sanitizeProperties(properties?: IAnalyticsEventProperties): Record<string, string | number | boolean> | undefined {
  if (!properties) {
    return undefined;
  }

  const sanitizedEntries = Object.entries(properties).filter(([, value]) => (
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  ));

  if (sanitizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(sanitizedEntries) as Record<string, string | number | boolean>;
}

function sanitizePropertiesForEvent(eventName: MobileAnalyticsEventName, properties?: IAnalyticsEventProperties): Record<string, string | number | boolean> | undefined {
  const sanitized = sanitizeProperties(properties);
  if (!sanitized) {
    return undefined;
  }

  const filteredEntries = Object.entries(sanitized).filter(([key]) => allowedPropertiesByEvent[eventName].has(key));
  if (filteredEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(filteredEntries) as Record<string, string | number | boolean>;
}

async function readSecrets(): Promise<IAnalyticsSecretSettings> {
  const raw = await expoFileSystemStorage.getItem(ANALYTICS_SECRETS_KEY);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as IAnalyticsSecretSettings;
  }
  return {};
}

function createDeviceId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function getOrCreateDeviceId(): Promise<string> {
  const secrets = await readSecrets();
  if (secrets.deviceId) {
    return secrets.deviceId;
  }

  const nextDeviceId = createDeviceId();
  expoFileSystemStorage.setItem(ANALYTICS_SECRETS_KEY, { ...secrets, deviceId: nextDeviceId });
  return nextDeviceId;
}

function getTrackUrl(): string {
  return `${ANALYTICS_HOST}/api/track`;
}

async function buildPayload(eventName: MobileAnalyticsEventName, properties?: Record<string, string | number | boolean>): Promise<ITrackPayload> {
  const deviceId = await getOrCreateDeviceId();
  return {
    site_id: ANALYTICS_SITE_ID,
    type: 'custom_event',
    event_name: eventName,
    properties,
    hostname: ANALYTICS_HOSTNAME,
    pathname: ANALYTICS_PATHNAME,
    user_id: deviceId,
  };
}

async function sendEvent(eventName: MobileAnalyticsEventName, properties?: Record<string, string | number | boolean>): Promise<boolean> {
  try {
    const payload = await buildPayload(eventName, properties);
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(getTrackUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });

      return response.ok;
    } finally {
      clearTimeout(timeoutHandle);
    }
  } catch {
    return false;
  }
}

async function flushQueue(): Promise<void> {
  if (flushInFlight) {
    return flushInFlight;
  }

  flushInFlight = (async () => {
    while (queuedEvents.length > 0) {
      const nextEvent = queuedEvents[0];
      const sent = await sendEvent(nextEvent.eventName, sanitizePropertiesForEvent(nextEvent.eventName, nextEvent.properties));
      if (!sent) {
        break;
      }
      queuedEvents.shift();
    }
  })().finally(() => {
    flushInFlight = undefined;
  });

  return flushInFlight;
}

export function initializeMobileAnalytics(): () => void {
  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        void flushQueue();
      }
    });
  }

  return () => {
    appStateSubscription?.remove();
    appStateSubscription = undefined;
  };
}

export async function trackMobileEvent(eventName: MobileAnalyticsEventName, properties?: IAnalyticsEventProperties): Promise<void> {
  if (!isEnabled()) {
    return;
  }

  const sanitizedProperties = sanitizePropertiesForEvent(eventName, properties);
  const sent = await sendEvent(eventName, sanitizedProperties);
  if (!sent) {
    queuedEvents.push({ eventName, properties: sanitizedProperties });
  }
}

export async function trackMobileAppLaunch(): Promise<void> {
  if (!isEnabled()) {
    return;
  }

  const secrets = await readSecrets();
  const now = new Date();
  const todayDate = now.toISOString().slice(0, 10);
  const isFirstLaunch = !secrets.deviceFirstLaunchDate;
  const firstLaunchDate = secrets.deviceFirstLaunchDate ?? todayDate;

  let daysSinceLastLaunch: number | undefined;
  if (secrets.deviceLastLaunchDate) {
    const lastDate = new Date(secrets.deviceLastLaunchDate);
    daysSinceLastLaunch = Math.floor((now.getTime() - lastDate.getTime()) / 86_400_000);
  }

  expoFileSystemStorage.setItem(ANALYTICS_SECRETS_KEY, {
    ...secrets,
    deviceFirstLaunchDate: firstLaunchDate,
    deviceLastLaunchDate: todayDate,
  });

  await trackMobileEvent('app.launched', {
    platform: Platform.OS,
    version: Application.nativeApplicationVersion ?? Application.applicationVersion ?? 'unknown',
    firstLaunchDate,
    isFirstLaunch,
    ...(daysSinceLastLaunch !== undefined ? { daysSinceLastLaunch } : {}),
  });
}

export async function trackNewUserTiddlerCreated(isSubWiki: boolean): Promise<void> {
  await trackMobileEvent('tiddler.created', {
    storage: 'filesystem',
    isSubWiki,
  });
}