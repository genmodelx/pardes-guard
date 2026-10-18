"""Create the integrity-network database and apply infra/spanner/schema.sql, one statement at a time.

The local emulator (the default) gets its instance, database and schema. It runs only when
SPANNER_EMULATOR_HOST is set, so it can never touch a real project by accident:

    python -m app.scripts.spanner_setup --project pardes-guard-local --instance pardes-local-instance --database pardes-local-db

A real Cloud Spanner instance must already exist (create the free trial instance with gcloud first,
see infra/spanner/README.md); this script never creates or upgrades a real instance. With --real it
creates the database if missing and applies the statements the database does not have yet:

    python -m app.scripts.spanner_setup --real --project PROJECT --instance pardes-trial --database integrity

Run from backend/. Statements already in the database are skipped, so running it twice is safe.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

SCHEMA = Path(__file__).resolve().parents[3] / "infra" / "spanner" / "schema.sql"
_NAME = re.compile(r"^\s*CREATE\s+(?:UNIQUE\s+)?(?:NULL_FILTERED\s+)?(TABLE|INDEX|PROPERTY\s+GRAPH)\s+(\w+)", re.IGNORECASE)


def statements(path: Path = SCHEMA) -> list[str]:
    """The schema file as single statements: comments removed, split on semicolons."""
    text = "\n".join(line.split("--", 1)[0] for line in path.read_text(encoding="utf-8").splitlines())
    return [s.strip() for s in text.split(";") if s.strip()]


def object_name(statement: str) -> tuple[str, str] | None:
    """("TABLE", "Recruiters") for "CREATE TABLE Recruiters (...)"."""
    m = _NAME.match(statement)
    return (re.sub(r"\s+", " ", m.group(1).upper()), m.group(2)) if m else None


def missing(wanted: list[str], existing: list[str]) -> list[str]:
    have = {object_name(s) for s in existing} - {None}
    return [s for s in wanted if object_name(s) not in have]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", required=True)
    parser.add_argument("--instance", required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--real", action="store_true", help="use real Cloud Spanner (the instance must exist)")
    args = parser.parse_args()

    emulator = os.environ.get("SPANNER_EMULATOR_HOST")
    if args.real and emulator:
        print("SPANNER_EMULATOR_HOST is set, so --real would still go to the emulator. Remove it first:")
        print("  Remove-Item Env:SPANNER_EMULATOR_HOST     (PowerShell)")
        return 2
    if not args.real and not emulator:
        print("SPANNER_EMULATOR_HOST is not set. For the local emulator run first:")
        print('  $env:SPANNER_EMULATOR_HOST = "127.0.0.1:9010"     (PowerShell)')
        print("For a real instance, pass --real.")
        return 2

    from google.api_core import exceptions
    from google.cloud import spanner

    where = f"emulator at {emulator}" if emulator else "Cloud Spanner"
    print(f"Target: {where}, projects/{args.project}/instances/{args.instance}/databases/{args.database}")
    client = spanner.Client(project=args.project)
    instance = client.instance(args.instance)

    if not instance.exists():
        if args.real:
            print("The instance does not exist. Create the free trial instance with gcloud first (infra/spanner/README.md).")
            return 1
        config = f"projects/{args.project}/instanceConfigs/emulator-config"
        client.instance(args.instance, configuration_name=config, display_name=args.instance, node_count=1).create().result(timeout=120)
        print(f"Created emulator instance {args.instance}")

    database = instance.database(args.database)
    if not database.exists():
        database.create().result(timeout=300)
        print(f"Created database {args.database}")

    database.reload()
    todo = missing(statements(), list(database.ddl_statements))
    if not todo:
        print("Schema is already complete: 10 tables, 3 indexes and the IntegrityGraph property graph.")
        return 0
    for i, statement in enumerate(todo, start=1):
        kind, name = object_name(statement) or ("STATEMENT", "?")
        print(f"[{i}/{len(todo)}] CREATE {kind} {name}", flush=True)
        try:
            database.update_ddl([statement]).result(timeout=600)
        except exceptions.GoogleAPICallError as exc:
            print(f"  Failed: {exc}")
            return 1
    print("Schema applied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
