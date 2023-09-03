export interface IWikiServerStatusObject {
  anonymous: boolean;
  read_only: boolean;
  space: {
    recipe: string;
  };
  tiddlywiki_version?: string;
  username: string;
}
