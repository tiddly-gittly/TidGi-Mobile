import Ionicons from '@expo/vector-icons/Ionicons';
import { createMaterialBottomTabNavigator } from '@react-navigation/material-bottom-tabs';
import { StackScreenProps } from '@react-navigation/stack';
import React, { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { RootStackParameterList } from '../../App';
import { CreateFromTemplateTab } from './tabs/CreateFromTemplateTab';
import { CreateWebpageShortcutTab } from './tabs/CreateWebpageShortcutTab';
import { ScanQRCodeTab } from './tabs/ScanQRCodeTab';

type CreateWorkspaceTabParameterList = {
  ScanQRCode: undefined;
  CreateFromTemplate: undefined;
  CreateWebpageShortcut: undefined;
};

// The navigator factory is untyped in this version of react-navigation-paper;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const Tab = createMaterialBottomTabNavigator<CreateWorkspaceTabParameterList>();

export const CreateWorkspace: FC<StackScreenProps<RootStackParameterList, 'CreateWorkspace'>> = ({ navigation: _navigation }) => {
  const { t } = useTranslation();

  return (
    <Tab.Navigator>
      <Tab.Screen
        name='ScanQRCode'
        component={ScanQRCodeTab}
        options={{
          title: t('AddWorkspace.ScanFromWiki'),
          tabBarAccessibilityLabel: 'create-workspace-tab-scan-qr',
          tabBarIcon: ({ color }: { color: string }) => <Ionicons name='qr-code' color={color} size={26} />,
          tabBarTestID: 'create-workspace-tab-scan-qr',
        }}
      />
      <Tab.Screen
        name='CreateFromTemplate'
        component={CreateFromTemplateTab}
        options={{
          title: t('AddWorkspace.CreateFromTemplate'),
          tabBarAccessibilityLabel: 'create-workspace-tab-template',
          tabBarIcon: ({ color }: { color: string }) => <Ionicons name='copy' color={color} size={26} />,
          tabBarTestID: 'create-workspace-tab-template',
        }}
      />
      <Tab.Screen
        name='CreateWebpageShortcut'
        component={CreateWebpageShortcutTab}
        options={{
          title: t('AddWorkspace.CreateWebpageShortcut'),
          tabBarAccessibilityLabel: 'create-workspace-tab-webpage',
          tabBarIcon: ({ color }: { color: string }) => <Ionicons name='bookmark' color={color} size={26} />,
          tabBarTestID: 'create-workspace-tab-webpage',
        }}
      />
    </Tab.Navigator>
  );
};
