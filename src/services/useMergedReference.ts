/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/prevent-abbreviations */
import { MutableRefObject, useRef } from 'react';
import { NativeSyntheticEvent } from 'react-native';
import { WebView } from 'react-native-webview';
import { WebViewMessage } from 'react-native-webview/lib/WebViewTypes';

export type WebViewRefType = MutableRefObject<WebView | null>;
export type OnMessageRefType = MutableRefObject<(event: NativeSyntheticEvent<WebViewMessage>) => void>;
/**
 * Type guard to check if the provided references are of type `OnMessageRefType`.
 *
 * @param {Array<WebViewRefType | OnMessageRefType>} references - Array of MutableRefObject references.
 * @returns {references is OnMessageRefType[]} - True if references are of type `OnMessageRefType`, false otherwise.
 */
const isFunctionReference = (references: Array<WebViewRefType | OnMessageRefType>): references is OnMessageRefType[] => {
  return typeof references[0]?.current === 'function';
};
/**
 * Merges multiple MutableRefObject references into a single reference.
 * - If the references are for WebView (`WebViewRefType`), setting the `.current` property of the merged reference
 *   will set the `.current` property of all individual references.
 * - If the references are for a function (`OnMessageRefType`), invoking the merged reference's `.current` method
 *   will invoke all the individual reference methods.
 *
 * @template T - Type of the reference, can be `WebViewRefType` or `OnMessageRefType`.
 * @param {...T[]} references - Array of MutableRefObject references.
 * @returns {T} - Merged MutableRefObject reference.
 */
export function useMergedReference<T extends WebViewRefType | OnMessageRefType>(...references: T[]): T {
  const mergedReference = useRef<T['current']>(null) as T;

  if (isFunctionReference(references)) {
    // Get an array of the original functions before we overwrite them
    mergedReference.current = ((event: NativeSyntheticEvent<WebViewMessage>) => {
      references
        .map((ref: OnMessageRefType) => ref.current)
        .forEach((originalOnMessageFunction) => {
          originalOnMessageFunction?.(event);
        });
    }) as T['current'];
  } else {
    // Update the merged reference to update all WebView references when set.
    Object.defineProperty(mergedReference, 'current', {
      set(value: WebView | null) {
        references.forEach(reference => {
          if (reference && 'current' in reference) {
            reference.current = value;
          }
        });
      },
      get() {
        // Use the first reference as the representative value for `mergedReference.current`
        return references[0]?.current;
      },
    });
  }

  return mergedReference;
}
