import type { ITiddlerFieldsParam } from 'tiddlywiki';

/**
 * Copy from $:/plugins/linonetwo/tw-mobile-sync 's src/tw-mobile-sync/types.ts
 */
export interface ISyncEndPointRequest {
  deleted?: string[];
  lastSync: string | undefined;
  tiddlers: Array<Partial<ITiddlerFieldsParam>>;
}
export interface ISyncEndPointResponse {
  deletes: string[];
  updates: ITiddlerFieldsParam[];
}
export interface ITiddlywikiServerStatus {
  anonymous: boolean;
  read_only: boolean;
  space: {
    recipe: string;
  };
  tiddlywiki_version: string;
  username: string;
}
