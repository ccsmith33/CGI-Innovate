"""Seed the database from the challenge CSV and JSON files."""

import json
import os
import sys
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import Base
from app.models.resource_log import ResourceLog
from app.models.intel_report import IntelReport
from app.models.redaction_log import RedactionLog
from app.services.shield import redact_pii


def get_sync_database_url() -> str:
    url = os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://sentinel:change-me-in-production@localhost:5432/sentinel",
    )
    # Convert async URL to sync
    return url.replace("+asyncpg", "").replace("+aiosqlite", "")


def seed_resources(session: Session, data_dir: Path) -> int:
    csv_path = data_dir / "historical_avengers_data.csv"
    print(f"Reading CSV from {csv_path}...")
    df = pd.read_csv(csv_path)

    # Group by (timestamp, sector_id, resource_type) and average across 5 replicas
    agg = df.groupby(["timestamp", "sector_id", "resource_type"]).agg(
        stock_level=("stock_level", "mean"),
        usage_rate_hourly=("usage_rate_hourly", "mean"),
        snap_event_detected=("snap_event_detected", "any"),
    ).reset_index()

    print(f"Aggregated to {len(agg)} rows from {len(df)} raw rows")

    rows_inserted = 0
    batch = []
    for _, row in agg.iterrows():
        batch.append(
            {
                "timestamp": pd.Timestamp(row["timestamp"]),
                "sector_id": row["sector_id"],
                "resource_type": row["resource_type"],
                "stock_level": float(row["stock_level"]),
                "usage_rate_hourly": float(row["usage_rate_hourly"]),
                "snap_event_detected": bool(row["snap_event_detected"]),
            }
        )
        rows_inserted += 1
        if rows_inserted % 500 == 0:
            print(f"  Prepared {rows_inserted} rows...")

    # Bulk insert
    session.execute(ResourceLog.__table__.insert(), batch)
    session.commit()
    print(f"Inserted {rows_inserted} resource log rows.")
    return rows_inserted


def seed_intel_reports(session: Session, data_dir: Path) -> int:
    json_path = data_dir / "field_intel_reports.json"
    print(f"Reading JSON from {json_path}...")

    with open(json_path) as f:
        reports = json.load(f)

    print(f"Found {len(reports)} intel reports")

    count = 0
    for report_data in reports:
        redaction_result = redact_pii(
            report_data["raw_text"], report_data.get("metadata")
        )

        report = IntelReport(
            report_id=report_data["report_id"],
            raw_text=report_data["raw_text"],
            redacted_text=redaction_result.redacted_text,
            metadata_json=redaction_result.redacted_metadata,
            priority=report_data.get("priority", "Routine"),
            status="pending",
            timestamp=pd.Timestamp(report_data["timestamp"]),
        )
        session.add(report)

        log_entry = RedactionLog(
            report_id=report_data["report_id"],
            original_text_hash=redaction_result.original_hash,
            redacted_text=redaction_result.redacted_text,
            patterns_matched=redaction_result.patterns_matched,
        )
        session.add(log_entry)
        count += 1

    session.commit()
    print(f"Inserted {count} intel reports with redaction logs.")
    return count


def main():
    data_dir = Path(__file__).resolve().parent.parent.parent.parent / "Prompt-Resources" / "challenger_package" / "challenger_package"

    if not data_dir.exists():
        # Try alternate path without nested challenger_package
        data_dir = Path(__file__).resolve().parent.parent.parent.parent / "Prompt-Resources"

    print(f"Data directory: {data_dir}")

    db_url = get_sync_database_url()
    print(f"Connecting to database: {db_url.split('@')[-1] if '@' in db_url else db_url}")

    engine = create_engine(db_url)

    # Create tables
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        # Check if already seeded
        existing = session.execute(text("SELECT COUNT(*) FROM resource_logs")).scalar()
        if existing and existing > 0:
            print(f"Database already has {existing} resource log rows. Skipping seed.")
            return

        resource_count = seed_resources(session, data_dir)
        report_count = seed_intel_reports(session, data_dir)

        print(f"\nSeed complete: {resource_count} resource rows, {report_count} intel reports.")


if __name__ == "__main__":
    main()
