/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import type { WindowMeta } from '../../../src/pages/WikiWebView/useWindowMeta';

declare global {
  interface Window {
    meta?: () => WindowMeta;
  }
}

function getInfoTiddlerFields(updateInfoTiddlersCallback: (infos: Array<{ text: string; title: string }>) => void) {
  const mapBoolean = function(value: boolean) {
    return value ? 'yes' : 'no';
  };
  const infoTiddlerFields: Array<{ text: string; title: string }> = [];
  // Basics
  if (!$tw.browser || typeof window === 'undefined') return infoTiddlerFields;
  const isInTidGi = typeof document !== 'undefined';
  const workspaceID = window.meta?.()?.workspaceID;
  infoTiddlerFields.push({ title: '$:/info/tidgi', text: mapBoolean(isInTidGi) }, { title: '$:/info/tidgi-mobile', text: mapBoolean(isInTidGi) });
  if (isInTidGi && workspaceID) {
    infoTiddlerFields.push({ title: '$:/info/tidgi/workspaceID', text: workspaceID });
  }
  return infoTiddlerFields;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
exports.getInfoTiddlerFields = getInfoTiddlerFields;
