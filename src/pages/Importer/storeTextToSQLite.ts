import * as fs from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { getWikiSkinnyTiddlerTextSqliteName, getWikiTiddlerTextStoreCachePath } from '../../constants/paths';
import { IWikiWorkspace } from '../../store/wiki';

type ITiddlerTextJSON = Array<{ text: string; title: string }>;

export async function storeTextToSQLite(workspace: IWikiWorkspace, setProgress: (progress: number) => void = () => {}) {
  const database = SQLite.openDatabase(getWikiSkinnyTiddlerTextSqliteName(workspace));
  await database.transactionAsync(async tx => {
    await tx.executeSqlAsync('CREATE TABLE IF NOT EXISTS tiddlers (title TEXT PRIMARY KEY, text TEXT);');
    let tiddlerTextsJSON: ITiddlerTextJSON;
    try {
      const tiddlerTexts = await fs.readAsStringAsync(getWikiTiddlerTextStoreCachePath(workspace));
      // TODO: stream result to prevent OOM
      tiddlerTextsJSON = JSON.parse(tiddlerTexts) as ITiddlerTextJSON;
    } catch (error) {
      throw new Error(`Failed to read tiddler text store, ${(error as Error).message}`);
    }
    setProgress(0);
    const batches = createBatches(tiddlerTextsJSON);
    const batchLength = batches.length;
    for (let index = 0; index < batchLength; index++) {
      try {
        await insertBatch(tx, batches[index]);
        setProgress((index + 1) / batchLength);
      } catch (error) {
        throw new Error(`Insert text to SQLite batch error: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
      }
    }
  });
}

const BATCH_SIZE = 499; // Max is 999, We divide by 2 as we have 2 fields (title, text) for each row

// Split the data into batches
function createBatches(data: ITiddlerTextJSON) {
  const batches = [];
  for (let index = 0; index < data.length; index += BATCH_SIZE) {
    batches.push(data.slice(index, index + BATCH_SIZE));
  }
  return batches;
}

// Insert a single batch
async function insertBatch(tx: SQLite.SQLTransactionAsync, batch: ReturnType<typeof createBatches>[0]) {
  const placeholders = batch.map(() => '(?, ?)').join(',');
  const query = `INSERT INTO tiddlers (title, text) VALUES ${placeholders};`;

  const bindParameters = batch.flatMap(row => [row.title, row.text]);

  return await tx.executeSqlAsync(query, bindParameters);
}
