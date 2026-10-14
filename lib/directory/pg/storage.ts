// Directory storage on PostgreSQL, assembled once for every runtime (druid-internal docs/plan-migration-postgresql.md,
// lot 10 a): the Node server (server/apiV1.ts createServerStorage) and the Cloudflare Functions (functions/_lib/storage.js,
// one database client per request through Hyperdrive) build the same repository, domain commands, publications store
// and « tables » view from a Kysely instance.
import type { Db } from '../../db/client';
import { createPgPublicationsStore } from '../../publications/pg';
import type { PublicationsStore } from '../../publications/store';
import type { AlignCacheSource, AlignCommands } from '../alignCommands';
import type { AlignTexts } from '../alignTexts';
import type { LdapCacheSnapshot } from '../repository';
import { createPgAlignCommands } from './alignCommands';
import { createPgDirectoryCommands } from './commands';
import { createPgDirectoryRepository } from './repository';
import { createPgTableClient } from './tableClient';

export interface PgStorageOptions {
  db: Db;
  /** LDAP status cache of the instance (Nantes); absent on Cloudflare. */
  loadLdapCache?: () => Promise<LdapCacheSnapshot>;
  /** Grist store still holding the axis corrections of a structure (Nantes, until lot 10 d); absent = no axes. */
  gristPublications?: PublicationsStore;
  /** Author of the writes made through the « tables » view (jobs, server routes). */
  tablesActor?: string;
  /** Alignment commands, when the runtime can read the alignment caches. */
  align?: { caches: AlignCacheSource; texts: AlignTexts; hasQualinka: boolean };
}

export const createPgStorage = ({ db, loadLdapCache, gristPublications, tablesActor = 'server', align }: PgStorageOptions) => {
  const repository = createPgDirectoryRepository({ db, loadLdapCache });
  const commands = createPgDirectoryCommands({ db, repository });
  const alignCommands: AlignCommands | undefined = align
    ? createPgAlignCommands({ db, repository, caches: align.caches, texts: align.texts, hasQualinka: align.hasQualinka })
    : undefined;
  return {
    kind: 'postgres' as const,
    db,
    repository,
    commands,
    publications: createPgPublicationsStore({ db, grist: gristPublications }),
    /** Migrated tables seen as the Grist document (reads of server.cjs, jobs, reports): lib/directory/pg/tableClient.ts. */
    tables: createPgTableClient({ db, actor: tablesActor }),
    align: alignCommands,
  };
};
export type PgStorage = ReturnType<typeof createPgStorage>;
