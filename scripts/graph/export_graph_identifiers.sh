#!/usr/bin/env bash
# Export of the identifiers the CRISalid knowledge graph (IKG, Neo4j) holds for the directory's persons, read by
# scripts/import_graph_snapshot.ts (druid-internal docs/plan-migration-postgresql.md, lot 11 c). Run on the host of
# the graph: cypher-shell inside the Neo4j container, with the credentials of that container (NEO4J_AUTH), so that
# Druid itself never holds an access to the graph. Read-only query, persons `local-<uid>` and the identifier types
# Druid follows.
#   export_graph_identifiers.sh <output file> [neo4j container]     (default container: crisalid-neo4j)
set -euo pipefail

OUT=${1:?usage: export_graph_identifiers.sh <output file> [neo4j container]}
CONTAINER=${2:-crisalid-neo4j}

QUERY='MATCH (p:Person)-[:HAS_IDENTIFIER]->(i:AgentIdentifier)
WHERE p.uid STARTS WITH "local-" AND i.type IN ["orcid", "idref", "idhals", "idhali", "scopus"]
RETURN p.uid AS uid, i.type AS type, i.value AS value'

# Written next to the target then renamed: an interrupted export never leaves a truncated file under the final name.
umask 077
TMP="$OUT.partial"
docker exec "$CONTAINER" sh -c 'cypher-shell -u "${NEO4J_AUTH%%/*}" -p "${NEO4J_AUTH#*/}" --format plain "$0"' "$QUERY" > "$TMP"
mv "$TMP" "$OUT"
echo "export_graph_identifiers: $(($(wc -l < "$OUT") - 1)) identifiers written to $OUT"
