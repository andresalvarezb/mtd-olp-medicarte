from __future__ import annotations

import difflib
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path.cwd()
MIG = ROOT / "packages/database/migrations"
JOURNAL = MIG / "meta/_journal.json"


def git_show(ref: str, path: str) -> bytes:
    return subprocess.check_output(
        ["git", "show", f"{ref}:{path}"],
        cwd=ROOT,
    )


def ref_has(ref: str, path: str) -> bool:
    rc = subprocess.run(
        ["git", "cat-file", "-e", f"{ref}:{path}"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return rc.returncode == 0


def normalized(data: bytes) -> bytes:
    return (
        data
        .replace(b"\r\n", b"\n")
        .rstrip(b"\n")
        + b"\n"
    )


BASE_PATHS = {
    "0031_novelty_logical_key.sql":
        "packages/database/migrations/0031_novelty_logical_key.sql",

    "0033_tariff_provenance_snapshots.sql":
        "packages/database/migrations/0033_tariff_provenance_snapshots.sql",

    "0034_tariff_prepare_confirm.sql":
        "packages/database/migrations/0034_tariff_prepare_confirm.sql",

    "_journal.json":
        "packages/database/migrations/meta/_journal.json",
}

def find_historical_baseline() -> str | None:
    """
    Busca en TODO el historial Git un commit que contenga
    simultáneamente las migraciones ya desplegadas en producción
    y el journal correspondiente.

    No depende de que develop/origin-develop todavía apunten
    a ese estado histórico.
    """

    paths = list(BASE_PATHS.values())

    commits_raw = subprocess.check_output(
        [
            "git",
            "rev-list",
            "--all",
            "--",
            *paths,
        ],
        cwd=ROOT,
        text=True,
    )

    commits = [
        line.strip()
        for line in commits_raw.splitlines()
        if line.strip()
    ]

    for commit in commits:
        if all(
            ref_has(commit, path)
            for path in paths
        ):
            return commit

    return None


BASE_REF = find_historical_baseline()

if BASE_REF is None:
    raise SystemExit(
        "ERROR: no encontré un commit histórico que contenga "
        "0031_novelty_logical_key, "
        "0033_tariff_provenance_snapshots, "
        "0034_tariff_prepare_confirm y su journal."
    )

print(f"BASE_REF={BASE_REF}")


# ============================================================
# 1. VERIFICAR HASHES DEL BASELINE HISTORICO
# ============================================================

expected_hashes = {
    "0031_novelty_logical_key.sql":
        "d00efa529258a001e7eacc0a2c40a54d51bc8f768b18143f37d07c9d4117ebf3",

    "0033_tariff_provenance_snapshots.sql":
        "3b69248052446f0ef09518c0f6ecd81e3a0086ccdaad72d406b3ff62fb3daa3e",

    "0034_tariff_prepare_confirm.sql":
        "7a28af525bbce751e97cfa59d7000c09811d8922d90c86df0a48b61981f60bd4",
}

baseline_files: dict[str, bytes] = {}

print()
print("==================================================")
print("1. VALIDAR MIGRACIONES HISTORICAS")
print("==================================================")

for filename, expected in expected_hashes.items():
    data = git_show(
        BASE_REF,
        BASE_PATHS[filename],
    )

    actual = hashlib.sha256(data).hexdigest()

    print(
        f"{filename}\n"
        f"  EXPECTED={expected}\n"
        f"  ACTUAL  ={actual}"
    )

    if actual != expected:
        raise SystemExit(
            "\nERROR: el baseline Git no coincide con "
            f"la migración aplicada en producción: {filename}"
        )

    baseline_files[filename] = data

print("HISTORICAL_HASHES=PASS")


# ============================================================
# 2. CONFIRMAR QUE LAS MIGRACIONES DUPLICADAS SON LAS MISMAS
# ============================================================

duplicates: dict[str, str] = {}

print()
print("==================================================")
print("2. VALIDAR MIGRACIONES HISTORICAS VS NUEVAS")
print("==================================================")
print(
    "DUPLICATE_VALIDATION=NOT_APPLICABLE"
)
print(
    "REASON=Las migraciones modernas 0056, "
    "0058 y 0059 contienen cambios funcionales "
    "posteriores a la historia productiva."
)


# ============================================================
# 3. MAPEO DEFINITIVO
#
# Producción histórica termina en:
#
#   0031_novelty_logical_key
#   0033_tariff_provenance_snapshots
#   0034_tariff_prepare_confirm
#
# Todas las migraciones modernas existentes desde el 0031
# actual se preservan y se desplazan secuencialmente desde 0035.
#
# No se descarta ninguna migración moderna.
# ============================================================

current_operational_files = sorted(
    p.name
    for p in MIG.glob("*.sql")
    if int(p.name[:4]) >= 31
)

if not current_operational_files:
    raise SystemExit(
        "ERROR: no encontré migraciones modernas "
        "desde 0031."
    )

mapping: list[tuple[str, str]] = []

for offset, source in enumerate(
    current_operational_files
):
    target_number = 35 + offset

    if "_" not in source:
        raise SystemExit(
            f"ERROR: nombre de migración inesperado: "
            f"{source}"
        )

    suffix = source.split(
        "_",
        1,
    )[1]

    target = (
        f"{target_number:04d}_"
        f"{suffix}"
    )

    mapping.append(
        (
            source,
            target,
        )
    )

print()
print("==================================================")
print("3. MAPEO DE MIGRACIONES MODERNAS")
print("==================================================")

for source, target in mapping:
    print(
        f"{source} -> {target}"
    )

print(
    f"NEW_MIGRATION_COUNT="
    f"{len(mapping)}"
)

expected_source_first = (
    "0031_esp001_domain_separation.sql"
)

expected_source_last = (
    "0071_purchase_order_operational_dates.sql"
)

if (
    current_operational_files[0]
    != expected_source_first
):
    raise SystemExit(
        "ERROR: primera migración moderna inesperada: "
        + current_operational_files[0]
    )

if (
    current_operational_files[-1]
    != expected_source_last
):
    raise SystemExit(
        "ERROR: última migración moderna inesperada: "
        + current_operational_files[-1]
    )

if len(mapping) != 41:
    raise SystemExit(
        "ERROR: se esperaban 41 migraciones modernas; "
        f"encontradas={len(mapping)}"
    )

expected_targets = {
    "0035_esp001_domain_separation.sql",
    "0040_esp005_purchase_orders.sql",
    "0041_esp006_supplier_deliveries.sql",
    "0042_esp007_receipts.sql",
    "0043_esp008_inventory_ledger.sql",
    "0060_novelty_logical_key.sql",
    "0061_novelty_logical_key_unique.sql",
    "0062_tariff_provenance_snapshots.sql",
    "0063_tariff_prepare_confirm.sql",
    "0073_inventory_availability.sql",
    "0074_purchase_order_operational_rbac.sql",
    "0075_purchase_order_operational_dates.sql",
}

actual_targets = {
    target
    for _, target in mapping
}

missing_targets = sorted(
    expected_targets
    - actual_targets
)

if missing_targets:
    raise SystemExit(
        "ERROR: faltan destinos esperados: "
        + ", ".join(
            missing_targets
        )
    )

print(
    "MAPPING_VALIDATION=PASS"
)


# ============================================================
# 4. VALIDAR QUE NO VAMOS A PERDER NINGUN SQL
# ============================================================

current_new = {
    p.name
    for p in MIG.glob("*.sql")
    if int(p.name[:4]) >= 31
}

expected_current = {
    source
    for source, _ in mapping
} | set(duplicates)

missing = sorted(
    expected_current - current_new
)

unexpected = sorted(
    current_new - expected_current
)

if missing or unexpected:
    print()
    print("MISSING=", missing)
    print("UNEXPECTED=", unexpected)

    raise SystemExit(
        "ERROR: conjunto de migraciones distinto "
        "al esperado. No se modificó nada."
    )

print()
print("MIGRATION_SET_VALIDATION=PASS")


# ============================================================
# 5. CARGAR JOURNAL HISTORICO REAL
# ============================================================

baseline_journal = json.loads(
    git_show(
        BASE_REF,
        BASE_PATHS["_journal.json"],
    ).decode("utf-8")
)

historical_entries = [
    entry
    for entry in baseline_journal["entries"]
    if entry["idx"] <= 33
]

expected_tail = [
    (
        30,
        1790374020663,
        "0030_retry_failed_bulk_updates",
    ),
    (
        31,
        1790460420663,
        "0031_novelty_logical_key",
    ),
    (
        32,
        1790546820663,
        "0033_tariff_provenance_snapshots",
    ),
    (
        33,
        1790546821663,
        "0034_tariff_prepare_confirm",
    ),
]

actual_tail = [
    (
        entry["idx"],
        entry["when"],
        entry["tag"],
    )
    for entry in historical_entries[-4:]
]

if actual_tail != expected_tail:
    print(
        "EXPECTED_TAIL=",
        expected_tail,
    )
    print(
        "ACTUAL_TAIL=",
        actual_tail,
    )

    raise SystemExit(
        "ERROR: journal histórico inesperado."
    )


# ============================================================
# 6. CREAR JOURNAL NUEVO
# ============================================================

last_when = historical_entries[-1]["when"]

new_entries = []

for offset, (_, target_name) in enumerate(
    mapping,
    start=1,
):
    new_entries.append(
        {
            "idx":
                len(historical_entries)
                + offset
                - 1,

            "version":
                "7",

            "when":
                last_when
                + offset * 1000,

            "tag":
                Path(
                    target_name
                ).stem,

            "breakpoints":
                True,
        }
    )

new_journal = {
    "version":
        baseline_journal["version"],

    "dialect":
        baseline_journal["dialect"],

    "entries":
        historical_entries
        + new_entries,
}


# ============================================================
# 7. BACKUP LOCAL ANTES DE MODIFICAR
# ============================================================

backup_root = Path(
    tempfile.mkdtemp(
        prefix="mtd-migration-lineage-"
    )
)

backup_dir = (
    backup_root
    / "migrations"
)

shutil.copytree(
    MIG,
    backup_dir,
)

print()
print(
    f"MIGRATION_BACKUP={backup_dir}"
)


# ============================================================
# 8. CONSTRUIR NUEVO CONJUNTO EN MEMORIA
# ============================================================

new_sql: dict[str, bytes] = {}

# 0000 -> 0030 se conservan exactamente como están.
for p in MIG.glob("*.sql"):
    number = int(
        p.name[:4]
    )

    if number <= 30:
        new_sql[p.name] = (
            p.read_bytes()
        )


# Baseline histórico desplegado.
for filename, data in baseline_files.items():
    new_sql[filename] = data


# Nuevas migraciones renumeradas.
for source, target in mapping:
    new_sql[target] = (
        MIG
        .joinpath(source)
        .read_bytes()
    )


# ============================================================
# 9. APLICAR ATOMICAMENTE A LOS ARCHIVOS
# ============================================================

try:
    for p in MIG.glob("*.sql"):
        p.unlink()

    for filename in sorted(new_sql):
        (
            MIG / filename
        ).write_bytes(
            new_sql[filename]
        )

    JOURNAL.write_text(
        json.dumps(
            new_journal,
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

except Exception:
    print()
    print(
        "ERROR AL ESCRIBIR. "
        "Restaurando backup..."
    )

    shutil.rmtree(
        MIG
    )

    shutil.copytree(
        backup_dir,
        MIG,
    )

    raise


# ============================================================
# 10. VALIDACION FINAL
# ============================================================

sql_names = sorted(
    p.name
    for p in MIG.glob("*.sql")
)

journal_tags = [
    e["tag"]
    for e in new_journal["entries"]
]

missing_files = [
    f"{tag}.sql"
    for tag in journal_tags
    if f"{tag}.sql"
    not in sql_names
]

if missing_files:
    raise SystemExit(
        "ERROR: journal referencia archivos ausentes: "
        + ", ".join(missing_files)
    )

print()
print("==================================================")
print("MIGRATION LINEAGE REBUILT")
print("==================================================")
print(
    f"HISTORICAL_LAST="
    f"{historical_entries[-1]['tag']}"
)
print(
    f"NEW_FIRST="
    f"{new_entries[0]['tag']}"
)
print(
    f"NEW_LAST="
    f"{new_entries[-1]['tag']}"
)
print(
    f"TOTAL_JOURNAL_ENTRIES="
    f"{len(new_journal['entries'])}"
)
print("MIGRATION_LINEAGE=PASS")
