/* eslint-disable unicorn/no-null */
import React from 'react';
import { useWorkspaceStore } from '../../../store/workspace';
import { WebPageEditModelContent } from './WebPageModelContent';
import { WikiEditModalContent } from './WikiModelContent';

export function EditItemModel({ id, onClose }: { id?: string; onClose: () => void }) {
  const workspace = useWorkspaceStore(state => id === undefined ? undefined : state.workspaces.find((w) => w.id === id));

  switch (workspace?.type) {
    case undefined:
    case 'wiki': {
      return <WikiEditModalContent id={id} onClose={onClose} />;
    }
    case 'webpage': {
      return <WebPageEditModelContent id={id} onClose={onClose} />;
    }
    default: {
      return null;
    }
  }
}
