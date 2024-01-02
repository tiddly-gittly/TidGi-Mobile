export enum TiddlersLogOperation {
  DELETE = 'DELETE',
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
}
export interface ISkinnyTiddlerWithText {
  fields: string;
  text: string;
  title: string;
}
export interface ITiddlerChange {
  id: number;
  operation: TiddlersLogOperation;
  timestamp: string;
  title: string;
}

export interface IWikiServerStatusObject {
  anonymous: boolean;
  read_only: boolean;
  space: {
    recipe: string;
  };
  tiddlywiki_version?: string;
  username: string;
}
