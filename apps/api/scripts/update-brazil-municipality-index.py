#!/usr/bin/env python3
"""Generate the checked-in municipality lookup from IBGE's 2022 GeoPackage."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import sys
import tempfile
import unicodedata
import zipfile
from pathlib import Path


SOURCE_URL = (
    "https://geoftp.ibge.gov.br/organizacao_do_territorio/estrutura_territorial/"
    "localidades/Localidades_do_Brasil/2022/Localidades_Brasil_gpkg.zip"
)
SOURCE_RELEASE = "2025-11-19"
EXPECTED_MUNICIPALITIES = 5570
OUTPUT = Path(__file__).resolve().parents[1] / "src/modules/location-resolution/data/brazil-municipalities.json"


def normalize_name(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    unaccented = "".join(char for char in decomposed if unicodedata.category(char) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^\w]+", " ", unaccented, flags=re.UNICODE)).strip().upper()


def generate(archive_path: Path, output_path: Path = OUTPUT) -> int:
    archive_hash = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix="ibge-localidades-") as temporary_directory:
        with zipfile.ZipFile(archive_path) as archive:
            gpkg_members = [name for name in archive.namelist() if name.lower().endswith(".gpkg")]
            if len(gpkg_members) != 1:
                raise ValueError(f"Expected one GeoPackage in {archive_path}, found {len(gpkg_members)}")
            gpkg_path = Path(temporary_directory) / "source.gpkg"
            with archive.open(gpkg_members[0]) as source, gpkg_path.open("wb") as target:
                target.write(source.read())

        connection = sqlite3.connect(f"file:{gpkg_path.as_posix()}?mode=ro", uri=True)
        try:
            table_row = connection.execute(
                "SELECT table_name FROM gpkg_contents WHERE data_type = 'features' ORDER BY table_name LIMIT 1"
            ).fetchone()
            if table_row is None:
                raise ValueError("IBGE GeoPackage contains no feature table")
            table_name = table_row[0]
            required_columns = {
                "CD_MUN", "NM_MUN", "SIGLA_UF", "CT_LOCALIDADE", "SCT_LOCALIDADE",
                "NM_LOCALIDADE", "LAT_LOCALIDADE", "LONG_LOCALIDADE",
            }
            columns = {row[1] for row in connection.execute(f'PRAGMA table_info("{table_name}")')}
            if not required_columns.issubset(columns):
                raise ValueError(f"Unexpected IBGE schema; missing {sorted(required_columns - columns)}")

            rows = connection.execute(
                f'''SELECT CD_MUN, NM_MUN, SIGLA_UF, SCT_LOCALIDADE, NM_LOCALIDADE,
                           LAT_LOCALIDADE, LONG_LOCALIDADE
                    FROM "{table_name}"
                    WHERE CT_LOCALIDADE = 'Cidade'
                    ORDER BY CD_MUN,
                      CASE SCT_LOCALIDADE
                        WHEN 'Sede Municipal' THEN 0
                        WHEN 'Capital Estadual' THEN 1
                        WHEN 'Capital Federal' THEN 2
                        ELSE 3
                      END,
                      NM_LOCALIDADE'''
            ).fetchall()
        finally:
            connection.close()

    municipalities: dict[str, dict[str, object]] = {}
    for code, name, state, _subcategory, locality_name, latitude, longitude in rows:
        if not code or not name or not state or latitude is None or longitude is None:
            raise ValueError(f"Incomplete IBGE city record for code {code!r}")
        if name != locality_name:
            raise ValueError(f"City name differs from municipality name for code {code}: {locality_name!r}")
        record = {
            "code": str(code),
            "name": name,
            "normalizedName": normalize_name(name),
            "state": state,
            "latitude": float(latitude),
            "longitude": float(longitude),
        }
        existing = municipalities.get(str(code))
        if existing is not None and existing != record:
            raise ValueError(f"Conflicting official city records for municipality code {code}")
        municipalities[str(code)] = record

    values = sorted(municipalities.values(), key=lambda record: (str(record["normalizedName"]), str(record["state"]), str(record["code"])))
    if len(values) != EXPECTED_MUNICIPALITIES:
        raise ValueError(f"Expected {EXPECTED_MUNICIPALITIES} unique municipalities, found {len(values)}")

    result = {
        "metadata": {
            "source": "IBGE — Censo Demográfico 2022: Localidades do Brasil",
            "sourceUrl": SOURCE_URL,
            "sourceVersion": "Censo Demográfico 2022",
            "sourceReleaseDate": SOURCE_RELEASE,
            "sourceSha256": archive_hash,
            "generatedBy": "apps/api/scripts/update-brazil-municipality-index.py",
            "municipalityCount": len(values),
        },
        "municipalities": values,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return len(values)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(f"Usage: {Path(sys.argv[0]).name} <Localidades_Brasil_gpkg.zip>")
    count = generate(Path(sys.argv[1]).resolve())
    print(f"Generated {count} municipalities: {OUTPUT}")
