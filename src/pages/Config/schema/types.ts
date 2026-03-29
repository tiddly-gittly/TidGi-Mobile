import { ConfigState } from '../../../store/config';

export interface BaseItemSchema {
  key: string;
  titleKey: string;
  descriptionKey?: string;
  /** Restrict this item to a specific platform. Filtered out at section-data build time. */
  platform?: 'android' | 'ios';
}

export interface ToggleItemSchema extends BaseItemSchema {
  type: 'toggle';
  configKey: keyof ConfigState;
}

export interface SegmentedItemSchema extends BaseItemSchema {
  type: 'segmented';
  configKey: keyof ConfigState;
  options: ReadonlyArray<{ labelKey: string; value: string }>;
}

export interface TextInputItemSchema extends BaseItemSchema {
  type: 'text-input';
  configKey: keyof ConfigState;
  /** Debounce store writes — use a local copy during fast typing. */
  debounce?: boolean;
}

export interface ActionItemSchema extends BaseItemSchema {
  type: 'action';
  buttonTitleKey: string;
  buttonMode?: 'text' | 'outlined' | 'contained';
  /** When set the renderer shows an Alert.alert confirmation before running the handler. */
  confirmTitleKey?: string;
  confirmMessageKey?: string;
  actionId: string;
}

export interface LinkItemSchema extends BaseItemSchema {
  type: 'link';
  url: string;
  /** i18n key for the clickable link label (shown on the right). */
  linkTextKey?: string;
}

export interface CustomItemSchema extends BaseItemSchema {
  type: 'custom';
  /** Key looked up in the customItems registry to obtain the React component to render. */
  customKey: string;
}

export type PreferenceItemSchema =
  | ToggleItemSchema
  | SegmentedItemSchema
  | TextInputItemSchema
  | ActionItemSchema
  | LinkItemSchema
  | CustomItemSchema;

export interface PreferenceSectionSchema {
  id: string;
  titleKey: string;
  items: PreferenceItemSchema[];
}
