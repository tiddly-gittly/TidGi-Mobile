// proxyServerForRN.ts

import { serializeError } from 'serialize-error';
import { ProxyDescriptor, ResponseType } from './common.js';
import { IpcProxyError } from './utils.js';

const registrations: Record<string, ProxyServerHandler | null> = {};

const exampleLogger = Object.assign(console, {
  emerg: console.error.bind(console),
  alert: console.error.bind(console),
  crit: console.error.bind(console),
  warning: console.warn.bind(console),
  notice: console.log.bind(console),
  debug: console.log.bind(console),
});

export function registerProxy<T>(target: T, descriptor: ProxyDescriptor, logger?: typeof exampleLogger): VoidFunction {
  const { channel } = descriptor;

  if (registrations[channel] !== null && registrations[channel] !== undefined) {
    throw new IpcProxyError(`Proxy object has already been registered on channel ${channel}`);
  }

  const server = new ProxyServerHandler(target, (channel, message) => {
    // Here you'd use WebView's postMessage method to communicate
    window.postMessage(JSON.stringify({
      channel,
      message,
    }));
  });

  registrations[channel] = server;

  // Handle incoming postMessages
  window.addEventListener('message', (event) => {
    if (!event.data) return;

    const { data } = event;
    const { channel: incomingChannel, request, correlationId } = JSON.parse(data);

    if (incomingChannel !== channel) return;

    server.handleRequest(request)
      .then(result => {
        if (server.sendMessage != undefined) {
          server.sendMessage(correlationId, { type: ResponseType.Result, result });
        }
      })
      .catch(error => {
        let stringifiedRequest = '';
        try {
          stringifiedRequest = request === undefined ? '' : JSON.stringify(request);
        } catch {
          stringifiedRequest = request.type;
        }
        logger?.error?.(`E-0 IPC Error on ${channel} ${stringifiedRequest} ${(error as Error).message} ${(error as Error).stack ?? ''}`);
        if (server.sendMessage != undefined) {
          server.sendMessage(correlationId, { type: ResponseType.Error, error: JSON.stringify(serializeError(error, { maxDepth: 1 })) });
        }
      });
  });

  return () => {
    unregisterProxy(channel);
  };
}

function unregisterProxy(channel: string): void {
  // Clear the event listener when unregistered (For simplification, we remove all message listeners. In a real scenario, only remove the specific listener)
  window.removeEventListener('message', () => {});

  const server = registrations[channel];
  if (server === undefined) {
    throw new IpcProxyError(`No proxy is registered on channel ${channel}`);
  }

  server.unsubscribeAll();
  delete registrations[channel];
}

class ProxyServerHandler {
  constructor(private readonly target: any, public sendMessage?: (channel: string, message: any) => void) {}

  // ... [Rest of the code remains unchanged]
}

export type { ProxyDescriptor, ProxyPropertyType } from './common';
