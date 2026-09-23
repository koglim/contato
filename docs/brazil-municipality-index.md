# Brazilian municipality authority snapshot

Location Resolution checks a checked-in IBGE municipality-seat index before calling Pelias for Brazilian queries. It only short-circuits when the normalized municipality name identifies exactly one official record, or when an explicit UF identifies exactly one record. An explicit UF with no exact official name+UF match and names absent from the index continue through the existing Pelias resolver.

The snapshot is generated from IBGE's **Censo Demográfico 2022: Localidades do Brasil** GeoPackage, using rows categorized as `Cidade` and deduplicated by the seven-digit `CD_MUN` code. When IBGE represents a state capital both as a municipal seat and as a capital, both rows must agree on name, UF, and coordinates; conflicting records fail generation.

Current snapshot metadata:

- Source release listed by IBGE: 2025-11-19
- Source version: Censo Demográfico 2022 — Localidades do Brasil
- Municipality records: 5,570 unique `CD_MUN` codes
- Snapshot: `apps/api/src/modules/location-resolution/data/brazil-municipalities.json`
- Source archive SHA-256 is embedded in the snapshot metadata.

To update the snapshot, download the official [IBGE GeoPackage archive](https://geoftp.ibge.gov.br/organizacao_do_territorio/estrutura_territorial/localidades/Localidades_do_Brasil/2022/Localidades_Brasil_gpkg.zip), then run:

```powershell
python apps/api/scripts/update-brazil-municipality-index.py C:\path\to\Localidades_Brasil_gpkg.zip
```

The generator uses only Python's standard library, writes a deterministic compact JSON snapshot, records the source archive hash, and validates the expected number and shape of records. Review IBGE's new release date, source URL, and expected record count in the generator before adopting an updated source. The API reads only the checked-in JSON file and never calls IBGE at runtime.
