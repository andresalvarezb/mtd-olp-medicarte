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

duplicates = {
    "0056_novelty_logical_key.sql":
        "0031_novelty_logical_key.sql",

    "0058_tariff_provenance_snapshots.sql":
        "0033_tariff_provenance_snapshots.sql",

    "0059_tariff_prepare_confirm.sql":
        "0034_tariff_prepare_confirm.sql",
}

print()
print("==================================================")
print("2. VALIDAR MIGRACIONES DUPLICADAS")
print("==================================================")

for current_name, historical_name in duplicates.items():
    current_path = MIG / current_name

    if not current_path.exists():
        raise SystemExit(
            f"ERROR: falta {current_name}"
        )

    current = normalized(
        current_path.read_bytes()
    )

    historical = normalized(
        baseline_files[historical_name]
    )

    if current != historical:
        print()
        print(
            f"DIFF={current_name} "
            f"vs {historical_name}"
        )

        diff = difflib.unified_diff(
            historical.decode(
                "utf-8",
                errors="replace",
            ).splitlines(),

            current.decode(
                "utf-8",
                errors="replace",
            ).splitlines(),

            fromfile=historical_name,
            tofile=current_name,
            lineterm="",
        )

        print("\n".join(diff))

        raise SystemExit(
            "\nERROR: la supuesta migración duplicada "
            "tiene cambios funcionales. No se modificó nada."
        )

    print(
        f"{current_name}=HISTORICAL_DUPLICATE"
    )

print("DUPLICATE_VALIDATION=PASS")


# ============================================================
# 3. MAPEO DEFINITIVO
#
# La historia productiva termina en 0034.
# Todas las funcionalidades nuevas comienzan en 0035.
# ============================================================

mapping = [
    ("0031_esp001_domain_separation.sql",
     "0035_esp001_domain_separation.sql"),

    ("0032_esp002_planning_periods.sql",
     "0036_esp002_planning_periods.sql"),

    ("0033_esp003_patient_scheduling.sql",
     "0037_esp003_patient_scheduling.sql"),

    ("0034_patient_schedule_duplicate_identity.sql",
     "0038_patient_schedule_duplicate_identity.sql"),

    ("0035_esp004_demand_consolidation.sql",
     "0039_esp004_demand_consolidation.sql"),

    ("0036_esp005_purchase_orders.sql",
     "0040_esp005_purchase_orders.sql"),

    ("0037_esp006_supplier_deliveries.sql",
     "0041_esp006_supplier_deliveries.sql"),

    ("0038_esp007_receipts.sql",
     "0042_esp007_receipts.sql"),

    ("0039_esp008_inventory_ledger.sql",
     "0043_esp008_inventory_ledger.sql"),

    ("0040_esp009_stock_transfers.sql",
     "0044_esp009_stock_transfers.sql"),

    ("0041_esp010_patient_applications.sql",
     "0045_esp010_patient_applications.sql"),

    ("0042_esp011_operational_outcomes.sql",
     "0046_esp011_operational_outcomes.sql"),

    ("0043_esp012_application_audits.sql",
     "0047_esp012_application_audits.sql"),

    ("0044_esp013_analytics.sql",
     "0048_esp013_analytics.sql"),

    ("0045_esp014_bulk_imports.sql",
     "0049_esp014_bulk_imports.sql"),

    ("0046_esp014_claim_fencing.sql",
     "0050_esp014_claim_fencing.sql"),

    ("0047_esp015_point_scopes.sql",
     "0051_esp015_point_scopes.sql"),

    ("0048_esp016_legacy_cutover.sql",
     "0052_esp016_legacy_cutover.sql"),

    ("0049_esp017_operational_reconciliation.sql",
     "0053_esp017_operational_reconciliation.sql"),

    ("0050_esp018_reconciliation_governance.sql",
     "0054_esp018_reconciliation_governance.sql"),

    ("0051_esp019_reconciliation_operations.sql",
     "0055_esp019_reconciliation_operations.sql"),

    ("0052_esp020_identity_access_metadata.sql",
     "0056_esp020_identity_access_metadata.sql"),

    ("0053_esp020_custom_roles.sql",
     "0057_esp020_custom_roles.sql"),

    ("0054_authorization_based_projected_demand.sql",
     "0058_authorization_based_projected_demand.sql"),

    ("0055_authorization_import_and_purchase_points.sql",
     "0059_authorization_import_and_purchase_points.sql"),

    # 0056 es duplicado histórico -> se elimina.

    ("0057_novelty_logical_key_unique.sql",
     "0060_novelty_logical_key_unique.sql"),

    # 0058 y 0059 son duplicados históricos -> se eliminan.

    ("0060_tariff_preview_result_codes.sql",
     "0061_tariff_preview_result_codes.sql"),

    ("0061_authorization_demand_identity.sql",
     "0062_authorization_demand_identity.sql"),

    ("0062_purchase_order_optional_logistics.sql",
     "0063_purchase_order_optional_logistics.sql"),

    ("0063_purchase_order_authorization_sources.sql",
     "0064_purchase_order_authorization_sources.sql"),

    ("0064_inventory_locations.sql",
     "0065_inventory_locations.sql"),

    ("0065_inventory_lot_location_identity.sql",
     "0066_inventory_lot_location_identity.sql"),

    ("0066_inventory_location_bridge.sql",
     "0067_inventory_location_bridge.sql"),

    ("0067_procurement_fungible_netting.sql",
     "0068_procurement_fungible_netting.sql"),

    ("0068_product_delivery_point_mappings.sql",
     "0069_product_delivery_point_mappings.sql"),
]


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
