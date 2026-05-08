def insert_file_row(db, table_name: str, data: dict):
    """
    Insert a file row that may include file_size_bytes.

    Existing deployments can run briefly before the SQL migration is applied;
    retry without file_size_bytes so uploads continue to work.
    """
    try:
        return db.table(table_name).insert(data).execute()
    except Exception:
        if "file_size_bytes" not in data:
            raise
        fallback = {k: v for k, v in data.items() if k != "file_size_bytes"}
        return db.table(table_name).insert(fallback).execute()
