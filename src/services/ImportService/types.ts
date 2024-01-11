import type { ITiddlerFields } from 'tiddlywiki';

export interface ITiddlerTextOnly {
  text: string;
  title: string;
}
export type ITiddlerTextJSON = ITiddlerTextOnly[];
export type ISkinnyTiddler = ITiddlerFields & { _is_skinny: ''; bag: 'default'; revision: '0' };
export type ISkinnyTiddlersJSON = ISkinnyTiddler[];
export type ISkinnyTiddlersJSONBatch = Array<{ key: number; value: ISkinnyTiddler }>;
export type ITiddlerTextsJSONBatch = Array<{ key: number; value: Pick<ITiddlerFields, 'title' | 'text'> }>;
