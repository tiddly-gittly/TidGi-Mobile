import Ionicons from '@expo/vector-icons/Ionicons';
import { createMaterialBottomTabNavigator } from '@react-navigation/material-bottom-tabs';
import { StackScreenProps } from '@react-navigation/stack';
import React, { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { RootStackParameterList } from '../../App';
import { CreateFromTemplateTab } from './tabs/CreateFromTemplateTab';
import { CreateWebpageShortcutTab } from './tabs/CreateWebpageShortcutTab';

type CreateWorkspaceTabParameterList = {
  CreateFromTemplate: undefined;
  CreateWebpageShortcut: undefined;
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const Tab = createMaterialBottomTabNavigator<CreateWorkspaceTabParameterList>();

export const CreateWorkspace: FC<StackScreenProps<RootStackParameterList, 'CreateWorkspace'>> = ({ navigation: _navigation }) => {
  const { t } = useTranslation();

  return (
    <Tab.Navigator>
      <Tab.Screen
        name='CreateFromTemplate'
        component={CreateFromTemplateTab}
        options={{ title: t('AddWorkspace.CreateFromTemplate'), tabBarIcon: ({ color }: { color: string }) => <Ionicons name='copy' color={color} size={26} /> }}
      />
      <Tab.Screen
        name='CreateWebpageShortcut'
        component={CreateWebpageShortcutTab}
        options={{ title: t('AddWorkspace.CreateWebpageShortcut'), tabBarIcon: ({ color }: { color: string }) => <Ionicons name='bookmark' color={color} size={26} /> }}
      />
    </Tab.Navigator>
  );
};
