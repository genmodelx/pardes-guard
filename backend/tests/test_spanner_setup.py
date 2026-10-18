"""The schema splitter used to apply infra/spanner/schema.sql to the emulator or a real instance."""

from app.scripts.spanner_setup import missing, object_name, statements


def test_schema_splits_into_ten_tables_three_indexes_and_the_graph():
    parts = statements()
    kinds = [object_name(s)[0] for s in parts]
    assert kinds.count("TABLE") == 10 and kinds.count("INDEX") == 3 and kinds.count("PROPERTY GRAPH") == 1
    assert len(parts) == 14 and all(";" not in s and "--" not in s for s in parts)
    assert object_name(parts[-1]) == ("PROPERTY GRAPH", "IntegrityGraph")


def test_statements_already_in_the_database_are_skipped():
    parts = statements()
    # Spanner returns its own formatting of what it holds; only the object's kind and name matter.
    existing = ["CREATE TABLE Recruiters (\n  rkey STRING(100) NOT NULL,\n  label STRING(200),\n) PRIMARY KEY(rkey)"]
    todo = missing(parts, existing)
    assert len(todo) == 13 and all(object_name(s) != ("TABLE", "Recruiters") for s in todo)
    assert missing(parts, parts) == []
