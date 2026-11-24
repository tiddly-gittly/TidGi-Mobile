// React Native 0.81 ships these Flow modules without TypeScript declarations.
declare module 'react-native/src/private/webapis/dom/events/Event' {
  const NativeEvent: typeof globalThis.Event;
  export default NativeEvent;
}
declare module 'react-native/src/private/webapis/dom/events/EventTarget' {
  const NativeEventTarget: typeof globalThis.EventTarget;
  export default NativeEventTarget;
}
declare module 'react-native/src/private/webapis/dom/events/CustomEvent' {
  const NativeCustomEvent: typeof globalThis.CustomEvent;
  export default NativeCustomEvent;
}
