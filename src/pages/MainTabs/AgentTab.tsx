/**
 * Agent tab — conversation list + chat entry point.
 */
import type { StackNavigationProp } from '@react-navigation/stack';
import React, { useCallback, useState } from 'react';
import type { RootStackParameterList } from '../../App';
import { AgentChat } from '../AgentChat';

interface AgentTabProps {
  rootNavigation: StackNavigationProp<RootStackParameterList>;
}

export function AgentTab({ rootNavigation }: AgentTabProps): React.JSX.Element {
  return <AgentChat />;
}
