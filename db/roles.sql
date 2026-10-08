-- Roles of the Druid database (druid-internal docs/plan-migration-postgresql.md, lot 4). Run once by the PostgreSQL
-- superuser when the database is created (docker-entrypoint-initdb.d on druid-test, the CI job, by hand elsewhere);
-- idempotent, run with psql (it uses \gexec). Passwords are set outside this file (ALTER ROLE … PASSWORD from the
-- secrets of the instance).
--
--   druid_owner  owns the database and its schema: runs the migrations (dbmate), the only role with DDL rights.
--   druid_app    the application (server.cjs, jobs): reads and writes rows, never changes the schema.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'druid_owner') THEN CREATE ROLE druid_owner LOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'druid_app') THEN CREATE ROLE druid_app LOGIN; END IF;
END $$;

-- The database belongs to druid_owner (PostgreSQL 15+: the public schema belongs to the database owner, and nobody
-- else may create objects in it).
SELECT format('ALTER DATABASE %I OWNER TO druid_owner', current_database()) \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO druid_app', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO druid_app;

-- Every table and sequence the migrations create: rows only for the application.
ALTER DEFAULT PRIVILEGES FOR ROLE druid_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO druid_app;
ALTER DEFAULT PRIVILEGES FOR ROLE druid_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO druid_app;
ALTER DEFAULT PRIVILEGES FOR ROLE druid_owner IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO druid_app;
