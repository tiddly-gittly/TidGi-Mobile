import { Text } from 'react-native-paper';
import { styled } from 'styled-components/native';

export const SwitchContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  margin-bottom: 10px;
`;
export const FlexibleText = styled(Text)`
  flex: 1;
  flex-shrink: 1;
  flex-wrap: wrap;
`;
