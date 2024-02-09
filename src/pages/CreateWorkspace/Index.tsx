import Ionicons from '@expo/vector-icons/Ionicons';
import { createMaterialBottomTabNavigator } from '@react-navigation/material-bottom-tabs';
import { StackScreenProps } from '@react-navigation/stack';
import React, { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { RootStackParameterList } from '../../App';
import { CreateFromTemplateTab } from './tabs/CreateFromTemplateTab';
import { CreateWebpageShortcutTab } from './tabs/CreateWebpageShortcutTab';

const Tab = createMaterialBottomTabNavigator();

export const CreateWorkspace: FC<StackScreenProps<RootStackParameterList, 'CreateWorkspace'>> = ({ navigation }) => {
  const { t } = useTranslation();

  return (
    <Tab.Navigator>
      <Tab.Screen
        name='CreateFromTemplate'
        component={CreateFromTemplateTab}
        options={{ title: t('AddWorkspace.CreateFromTemplate'), tabBarIcon: ({ color }) => <Ionicons name='copy' color={color} size={26} /> }}
      />
      <Tab.Screen
        name='CreateWebpageShortcut'
        component={CreateWebpageShortcutTab}
        options={{ title: t('AddWorkspace.CreateWebpageShortcut'), tabBarIcon: ({ color }) => <Ionicons name='bookmark' color={color} size={26} /> }}
      />
    </Tab.Navigator>
  );
};
