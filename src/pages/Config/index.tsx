import React from 'react';
import { Switch, TextInput } from 'react-native';
import { styled } from 'styled-components/native';
import { useConfig } from './useConfig';

const ConfigContainer = styled.View`
  flex: 1;
  padding: 20px;
`;

export const Config = () => {
  const [config, setConfig] = useConfig();

  return (
    <ConfigContainer>
      <Switch
        value={config.runInBackground}
        onValueChange={(value) => {
          setConfig({ ...config, runInBackground: value });
        }}
      />
      <TextInput
        value={config.editorName}
        onChangeText={(name) => {
          setConfig({ ...config, editorName: name });
        }}
      />
    </ConfigContainer>
  );
};
