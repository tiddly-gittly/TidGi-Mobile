import useDebouncedCallback from 'beautiful-react-hooks/useDebouncedCallback';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { Button, SegmentedButtons, Switch, Text, TextInput } from 'react-native-paper';
import { FlexibleText, SwitchContainer } from '../../../components/PreferenceWidgets';
import { useConfigStore } from '../../../store/config';
import { getActionHandler } from '../schema/actionRegistry';
import { getCustomItem } from '../schema/customItems';
import { ActionItemSchema, CustomItemSchema, LinkItemSchema, PreferenceItemSchema, SegmentedItemSchema, TextInputItemSchema, ToggleItemSchema } from '../schema/types';

// --- Toggle -------------------------------------------------------------------

function ToggleItemRenderer({ item }: { item: ToggleItemSchema }) {
  const { t } = useTranslation();
  const value = (useConfigStore(state => state[item.configKey]) ?? false) as boolean;
  const setConfig = useConfigStore(state => state.set);

  return (
    <View>
      <Text variant='titleLarge'>{t(item.titleKey)}</Text>
      <SwitchContainer>
        <FlexibleText>{item.descriptionKey ? t(item.descriptionKey) : ''}</FlexibleText>
        <Switch
          value={value}
          onValueChange={(newValue) => {
            setConfig({ [item.configKey]: newValue });
          }}
        />
      </SwitchContainer>
    </View>
  );
}

// --- Segmented ----------------------------------------------------------------

const SegmentedOuter = { marginBottom: 15 } as const;

function SegmentedItemRenderer({ item }: { item: SegmentedItemSchema }) {
  const { t } = useTranslation();
  const value = (useConfigStore(state => state[item.configKey]) ?? '') as string;
  const setConfig = useConfigStore(state => state.set);

  const buttons = item.options.map(opt => ({
    label: t(opt.labelKey),
    value: opt.value,
  }));

  return (
    <View>
      <Text variant='titleLarge'>{t(item.titleKey)}</Text>
      <View style={SegmentedOuter}>
        <SegmentedButtons
          value={value}
          onValueChange={(newValue) => {
            setConfig({ [item.configKey]: newValue });
          }}
          buttons={buttons}
        />
      </View>
    </View>
  );
}

// --- Text Input ---------------------------------------------------------------

const styledInput = StyleSheet.create({ input: { marginTop: 10, marginBottom: 4 } });

function TextInputItemRenderer({ item }: { item: TextInputItemSchema }) {
  const { t } = useTranslation();
  const initialValue = (useConfigStore(state => state[item.configKey]) ?? '') as string;
  const setConfig = useConfigStore(state => state.set);

  // Always maintain local state; debounce flushes to store if requested
  const [localValue, setLocalValue] = useState(initialValue);
  const debouncedWrite = useDebouncedCallback((text: string) => {
    setConfig({ [item.configKey]: text });
  }, [item.configKey, setConfig]);

  const handleChange = (text: string) => {
    setLocalValue(text);
    if (item.debounce) {
      debouncedWrite(text);
    } else {
      setConfig({ [item.configKey]: text });
    }
  };

  return (
    <View>
      <TextInput
        label={t(item.titleKey)}
        value={localValue}
        onChangeText={handleChange}
        style={styledInput.input}
      />
      {item.descriptionKey && <Text variant='bodySmall'>{t(item.descriptionKey)}</Text>}
    </View>
  );
}

// --- Action -------------------------------------------------------------------

function ActionItemRenderer({ item }: { item: ActionItemSchema }) {
  const { t } = useTranslation();
  const handler = getActionHandler(item.actionId);

  const run = () => {
    void handler?.();
  };

  const handlePress = () => {
    if (item.confirmTitleKey) {
      Alert.alert(
        t(item.confirmTitleKey),
        item.confirmMessageKey ? t(item.confirmMessageKey) : undefined,
        [
          { text: t('Common.Cancel'), style: 'cancel' },
          { text: t('Yes'), style: 'destructive', onPress: run },
        ],
      );
    } else {
      run();
    }
  };

  return (
    <View style={styles.actionContainer}>
      {item.descriptionKey && <Text variant='bodySmall' style={styles.actionDescription}>{t(item.descriptionKey)}</Text>}
      <Button mode={item.buttonMode ?? 'outlined'} onPress={handlePress}>
        {t(item.buttonTitleKey)}
      </Button>
    </View>
  );
}

// --- Link ---------------------------------------------------------------------

function LinkItemRenderer({ item }: { item: LinkItemSchema }) {
  const { t } = useTranslation();

  return (
    <View style={styles.linkRow}>
      <Text variant='titleLarge' style={styles.linkTitle}>{t(item.titleKey)}</Text>
      {item.linkTextKey && (
        <Text
          variant='titleLarge'
          style={styles.linkText}
          onPress={async () => {
            try {
              if (await Linking.canOpenURL(item.url)) {
                await Linking.openURL(item.url);
              }
            } catch (error) {
              console.error('[LinkItem] open url error:', error);
            }
          }}
        >
          {t(item.linkTextKey)}
        </Text>
      )}
    </View>
  );
}

// --- Custom -------------------------------------------------------------------

function CustomItemRenderer({ item }: { item: CustomItemSchema }) {
  const Component = getCustomItem(item.customKey);
  if (!Component) return null;
  return <Component />;
}

// --- Dispatcher ---------------------------------------------------------------

export function PreferenceItem({ item }: { item: PreferenceItemSchema }): React.JSX.Element | null {
  switch (item.type) {
    case 'toggle':
      return <ToggleItemRenderer item={item} />;
    case 'segmented':
      return <SegmentedItemRenderer item={item} />;
    case 'text-input':
      return <TextInputItemRenderer item={item} />;
    case 'action':
      return <ActionItemRenderer item={item} />;
    case 'link':
      return <LinkItemRenderer item={item} />;
    case 'custom':
      return <CustomItemRenderer item={item} />;
  }
}

const styles = StyleSheet.create({
  actionContainer: {
    marginBottom: 8,
  },
  actionDescription: {
    marginBottom: 8,
    opacity: 0.75,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  linkTitle: {
    flex: 1,
  },
  linkText: {
    textDecorationLine: 'underline',
  },
});
