import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { TiddlersLogOperation } from '../../WikiStorageService/types';

@Entity('tiddlers')
export class TiddlerSQLModel {
  @PrimaryColumn('text')
  title!: string;

  @Column('text')
  text?: string | null;

  @Column('text')
  fields?: string;
}

@Entity('tiddlers_changes_log')
export class TiddlerChangeSQLModel {
  @PrimaryColumn('integer', { generated: true })
  id!: number;

  @Column('text')
  title!: string;

  @Column('text')
  operation!: TiddlersLogOperation;

  @CreateDateColumn()
  timestamp!: Date;
}
