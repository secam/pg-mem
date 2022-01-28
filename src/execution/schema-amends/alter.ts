import { _ISchema, _Transaction, SchemaField, NotSupported, _ITable, _IStatementExecutor, asTable, QueryError, _IStatement } from '../../interfaces-private';
import { AlterTableStatement } from 'pgsql-ast-parser';
import { ignore } from '../../utils';
import { resultNoData } from '../exec-utils';

export class Alter implements _IStatementExecutor {

    private table: _ITable;

    constructor({ schema }: _IStatement, private statement: AlterTableStatement) {
        const p = this.statement;
        this.table = asTable(schema.getObject(statement.table));
        ignore(p.only);
    }

    execute(t: _Transaction) {

        let ignored = 0;

        // commit pending data before making changes
        //  (because  does not support further rollbacks)
        t = t.fullCommit();


        for (const change of this.statement.changes) {
            function ignoreChange() {
                ignore(change);
                ignored++;
            }
            switch (change.type) {
                case 'rename':
                    this.table.rename(change.to.name);
                    break;
                case 'add column': {
                    const col = this.table.selection.getColumn(change.column.name.name, true);
                    if (col) {
                        if (change.ifNotExists) {
                            ignoreChange();
                            break;
                        } else {
                            throw new QueryError('Column already exists: ' + col.id);
                        }
                    }
                    this.table.addColumn(change.column, t);
                    break;
                }
                case 'drop column':
                    const col = this.table.getColumnRef(change.column.name, change.ifExists);
                    if (!col) {
                        ignoreChange();
                    } else {
                        col.drop(t);
                    }
                    break;
                case 'drop constraint':
                    const cst = this.table.getConstraint(change.constraint.name);
                    if (change.ifExists && !cst) {
                        ignoreChange();
                        break;
                    }
                    if (!cst) {
                        throw new QueryError(`constraint "${change.constraint.name}" of relation "${this.table.name}" does not exist`, '42704')
                    }
                    cst.uninstall(t);
                    break;
                case 'rename column':
                    this.table.getColumnRef(change.column.name)
                        .rename(change.to.name, t);
                    break;
                case 'alter column':
                    this.table.getColumnRef(change.column.name)
                        .alter(change.alter, t);
                    break;
                case 'rename constraint':
                    throw new NotSupported('rename constraint');
                case 'add constraint':
                    this; this.table.addConstraint(change.constraint, t);
                    break;
                case 'owner':
                    // owner change statements are not supported.
                    // however, in order to support, pg_dump, we're just ignoring them.
                    ignoreChange();
                    break;
                default:
                    throw NotSupported.never(change, 'alter request');

            }
        }


        // new implicit transaction
        t = t.fork();
        return resultNoData('ALTER', this.statement, t, ignored === this.statement.changes.length);
    }
}
