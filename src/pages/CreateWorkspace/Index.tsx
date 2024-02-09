/* eslint-disable unicorn/no-nested-ternary */
/* eslint-disable unicorn/no-useless-undefined */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StackScreenProps } from '@react-navigation/stack';
import React, { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { RootStackParameterList } from '../../App';
import { CreateFromTemplateTab } from './tabs/CreateFromTemplateTab';
import { CreateWebpageShortcutTab } from './tabs/CreateWebpageShortcutTab';
import { ScanFromWikiTab } from './tabs/ScanFromWikiTab';

const Tab = createBottomTabNavigator();

export const CreateWorkspace: FC<StackScreenProps<RootStackParameterList, 'CreateWorkspace'>> = ({ navigation }) => {
  const { t } = useTranslation();

  return (
    <Tab.Navigator>
      <Tab.Screen name='CreateFromTemplate' component={CreateFromTemplateTab} options={{ title: t('AddWorkspace.CreateFromTemplate') }} />
      <Tab.Screen name='ScanFromWiki' component={ScanFromWikiTab} options={{ title: t('AddWorkspace.ScanFromWiki') }} />
      <Tab.Screen name='CreateWebpageShortcut' component={CreateWebpageShortcutTab} options={{ title: t('AddWorkspace.CreateWebpageShortcut') }} />
    </Tab.Navigator>
  );
};
