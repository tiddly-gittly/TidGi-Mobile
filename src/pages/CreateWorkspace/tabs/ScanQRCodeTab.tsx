import { useNavigation } from '@react-navigation/native';
import type { StackScreenProps } from '@react-navigation/stack';
import React from 'react';
import { RootStackParameterList } from '../../../App';
import { Importer } from '../../Importer/Index';

export function ScanQRCodeTab(): React.JSX.Element {
  const navigation = useNavigation<StackScreenProps<RootStackParameterList, 'Importer'>['navigation']>();
  const route: StackScreenProps<RootStackParameterList, 'Importer'>['route'] = {
    key: 'Importer-ScanTab',
    name: 'Importer',
    params: { addAsServer: true },
  };
  return (
    <Importer
      navigation={navigation}
      route={route}
    />
  );
}
