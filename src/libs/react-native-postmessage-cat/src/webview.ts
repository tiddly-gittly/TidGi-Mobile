/**
 * This file runs in React Native, interfacing with the WebView
 */
import { serializeError, deserializeError } from 'serialize-error';
import { ProxyDescriptor, ProxyPropertyType, Request, RequestType, Response, ResponseType } from './common';
import { getSubscriptionKey, WebViewProxyError } from './utils'; // Assuming you'll adjust utils.ts as well

type WebViewInstance = any; // Placeholder. Replace with appropriate WebView instance type if required.

export function createProxy<T>(descriptor: ProxyDescriptor, webViewInstance: WebViewInstance): T {
    const result: any = {};

    Object.keys(descriptor.properties).forEach((propertyKey) => {
        const propertyType = descriptor.properties[propertyKey];

        Object.defineProperty(result, propertyKey, {
            enumerable: true,
            get: () => getProperty(propertyType, propertyKey, descriptor.channel, webViewInstance),
        });
    });

    return result as T;
}

function getProperty(
    propertyType: ProxyPropertyType,
    propertyKey: string,
    channel: string,
    webViewInstance: WebViewInstance
): any {
    switch (propertyType) {
        case ProxyPropertyType.Value:
        case ProxyPropertyType.Function:
            return (...args: any[]) => {
                return makeRequest({ type: RequestType.Apply, propKey: propertyKey, args }, channel, webViewInstance);
            };
        case ProxyPropertyType.Value$:
        case ProxyPropertyType.Function$:
            // Handle Observable types if necessary
            throw new WebViewProxyError("Observable types are currently not supported for WebView");
        default:
            throw new WebViewProxyError(`Unrecognised ProxyPropertyType [${propertyType}]`);
    }
}

function makeRequest(request: Request, channel: string, webViewInstance: WebViewInstance): Promise<any> {
    return new Promise((resolve, reject) => {
        const messageHandler = (event: any) => {
            const response: Response = JSON.parse(event.data);
            switch (response.type) {
                case ResponseType.Result:
                    resolve(response.result);
                    break;
                case ResponseType.Error:
                    reject(deserializeError(JSON.parse(response.error)));
                    break;
                default:
                    reject(new WebViewProxyError(`Unhandled response type [${response.type}]`));
            }
        };
        
        // Add the event listener for this specific request
        document.addEventListener('message', messageHandler);

        webViewInstance.postMessage(JSON.stringify(request));

        // TODO: You might want to consider a mechanism to remove the event listener after a timeout or after receiving the message
    });
}

// You can export other types or utilities as needed
