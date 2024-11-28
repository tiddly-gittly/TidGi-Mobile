/** This file is commented out, because expo-application block the f-droid integration. issue #6 */
import * as Application from 'expo-application';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { Button, Text } from 'react-native-paper';

export function CopyDebugInfoButton(): JSX.Element {
  const { t } = useTranslation();

  return (
    <Button
      onPress={async () => {
        const debugInfo = JSON.stringify(
          {
            app: {
              appId: Application.applicationId,
              nativeAppVersion: Application.nativeApplicationVersion,
              nativeBuildVersion: Application.nativeBuildVersion,
            },
          },
          undefined,
          2,
        );
        console.log(debugInfo);
        await Clipboard.setStringAsync(debugInfo);
      }}
      mode='outlined'
    >
      <Text>{t('ContextMenu.Copy')} v{Application.nativeApplicationVersion ?? '?-?-?'}</Text>
    </Button>
  );
}
