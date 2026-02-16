import { useNavigation } from '@react-navigation/native';
import type { StackScreenProps } from '@react-navigation/stack';
import React from 'react';
import { RootStackParameterList } from '../../../App';
import { Importer } from '../../Importer/Index';

export function ScanQRCodeTab(): React.JSX.Element {
  const navigation = useNavigation<StackScreenProps<RootStackParameterList, 'MainMenu'>['navigation']>();
  return (
    <Importer
      navigation={navigation as never}
      route={{ key: 'Importer-ScanTab', name: 'Importer', params: { addAsServer: true } } as never}
    />
  );
}
