// RN 0.81 includes the DOM event implementations but does not expose these
// globals on Hermes. Install them before libp2p evaluates Event subclasses.
// Keep this version-specific boundary in the native bootstrap, not shared Core.
import CustomEvent from 'react-native/src/private/webapis/dom/events/CustomEvent';
import Event from 'react-native/src/private/webapis/dom/events/Event';
import EventTarget from 'react-native/src/private/webapis/dom/events/EventTarget';

/** @param {Partial<Pick<typeof globalThis, 'Event' | 'EventTarget' | 'CustomEvent'>>} host */
export function installMobileWebEvents(host = globalThis) {
  for (const [name, implementation] of Object.entries({ Event, EventTarget, CustomEvent })) {
    if (typeof host[name] === 'undefined') {
      Object.defineProperty(host, name, { configurable: true, writable: true, value: implementation });
    }
  }
}

installMobileWebEvents();
