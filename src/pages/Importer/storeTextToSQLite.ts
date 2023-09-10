import * as fs from 'expo-file-system';
import type { ITiddlerFields } from 'tiddlywiki';
import { Repository } from 'typeorm';
import { getWikiTiddlerSkinnyStoreCachePath, getWikiTiddlerTextStoreCachePath } from '../../constants/paths';
import { sqliteServiceService } from '../../services/SQLiteService';
import { TiddlerSQLModel } from '../../services/SQLiteService/orm';
import { IWikiWorkspace } from '../../store/wiki';

export interface ITiddlerTextOnly {
  text: string;
  title: string;
}
export type ITiddlerTextJSON = ITiddlerTextOnly[];
export type ISkinnyTiddler = ITiddlerFields & { _is_skinny: ''; bag: 'default'; revision: '0' };
export type ISkinnyTiddlersJSON = ISkinnyTiddler[];

export async function storeTiddlersToSQLite(workspace: IWikiWorkspace, setProgress: { fields: (progress: number) => void; text: (progress: number) => void }) {
  const dataSource = await sqliteServiceService.getDatabase(workspace);
  const tiddlerRepo = dataSource.getRepository(TiddlerSQLModel);

  // Use the helper functions to get data and then save it
  const fieldsData = await getSkinnyDataFromPath(getWikiTiddlerSkinnyStoreCachePath(workspace));
  await saveWithProgress(tiddlerRepo, fieldsData, setProgress.fields);
  const textData = await getTextDataFromPath(getWikiTiddlerTextStoreCachePath(workspace));
  await saveWithProgress(tiddlerRepo, textData, setProgress.text);
}

async function saveWithProgress(repo: Repository<TiddlerSQLModel>, data: TiddlerSQLModel[], setProgress: (progress: number) => void = () => {}) {
  const CHUNK_SIZE = 500;
  const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
  for (let index = 0; index < totalChunks; index++) {
    const chunk = data.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
    await repo.save(chunk);
    setProgress((index + 1) / totalChunks);
  }
}

async function getSkinnyDataFromPath(path: string): Promise<TiddlerSQLModel[]> {
  try {
    const rawData = await fs.readAsStringAsync(path);
    const jsonData = JSON.parse(rawData) as ISkinnyTiddlersJSON;
    const mappedData = jsonData.map(tiddler => {
      const tiddlerModel = new TiddlerSQLModel();
      tiddlerModel.title = tiddler.title;
      tiddlerModel.text = tiddler.text;
      tiddlerModel.fields = JSON.stringify(tiddler);
      return tiddlerModel;
    });
    return mappedData;
  } catch (error) {
    throw new Error(`Failed to read data from path: ${path}, ${(error as Error).message}`);
  }
}

async function getTextDataFromPath(path: string): Promise<TiddlerSQLModel[]> {
  try {
    const rawData = await fs.readAsStringAsync(path);
    const jsonData = JSON.parse(rawData) as ITiddlerTextJSON;
    const mappedData = jsonData.map(tiddler => {
      const tiddlerModel = new TiddlerSQLModel();
      tiddlerModel.title = tiddler.title;
      tiddlerModel.text = tiddler.text;
      return tiddlerModel;
    });
    return mappedData;
  } catch (error) {
    throw new Error(`Failed to read data from path: ${path}, ${(error as Error).message}`);
  }
}
