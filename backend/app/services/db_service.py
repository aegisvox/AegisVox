import sqlite3
from pathlib import Path
from typing import Optional

DB_FILE = Path(__file__).resolve().parents[3] / "assistant.db"

class DBService:
    def __init__(self, db_path: Path = DB_FILE):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self._initialize()

    def _initialize(self) -> None:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER,
                role TEXT,
                content TEXT,
                html TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(session_id) REFERENCES sessions(id)
            )
            """
        )
        self.connection.commit()

    def create_session(self) -> int:
        cursor = self.connection.cursor()
        cursor.execute("INSERT INTO sessions DEFAULT VALUES")
        self.connection.commit()
        return cursor.lastrowid

    def log_message(self, session_id: int, role: str, content: str, html: Optional[str] = None) -> None:
        cursor = self.connection.cursor()
        cursor.execute(
            "INSERT INTO messages (session_id, role, content, html) VALUES (?, ?, ?, ?)",
            (session_id, role, content, html),
        )
        self.connection.commit()

    def close(self) -> None:
        try:
            self.connection.close()
        except Exception:
            pass
