import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialMigration1694340434906 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    let tableExists = await queryRunner.hasTable('tiddlers');
    if (!tableExists) {
      await queryRunner.query(`
        CREATE TABLE "tiddlers" (
          "title" TEXT PRIMARY KEY NOT NULL,
          "text" TEXT,
          "fields" TEXT
        )
      `);
    }
    tableExists = await queryRunner.hasTable('tiddlers_changes_log');
    if (!tableExists) {
      await queryRunner.query(`
        CREATE TABLE "tiddlers_changes_log" (
          "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          "title" TEXT NOT NULL,
          "operation" TEXT NOT NULL,
          "timestamp" DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "tiddlers"`);
    await queryRunner.query(`DROP TABLE "tiddlers_changes_log"`);
  }
}
