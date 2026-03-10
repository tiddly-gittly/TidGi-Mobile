import { Button, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';

export const FooterRow = styled.View`
  flex-direction: row;
  justify-content: flex-end;
  margin-top: 16px;
`;

export const LogScrollView = styled.ScrollView`
  max-height: 420px;
  min-height: 220px;
`;

export const LogText = styled(Text)`
  font-size: 12px;
  padding: 8px;
`;

export const RoutingDescription = styled(Text)`
  margin-bottom: 12px;
  margin-top: 4px;
`;

export const TagInputField = styled(TextInput)`
  margin-bottom: 8px;
`;

export const TagsRow = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 12px;
`;

export const PathFilterInput = styled(TextInput)`
  margin-top: 12px;
`;

export const SaveButton = styled(Button)`
  margin-top: 16px;
`;
