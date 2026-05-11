from __future__ import annotations
import json
from pathlib import Path
import jsonschema

_SCHEMA_PATH = Path(__file__).parent / "schema" / "gene.json"

with _SCHEMA_PATH.open() as f:
    _GENE_SCHEMA = json.load(f)


class GeneValidationError(Exception):
    pass


def validate_gene(gene: dict) -> None:
    """Validate a gene dict against the canonical JSON Schema.

    Raises GeneValidationError if the gene is invalid.
    """
    try:
        jsonschema.validate(instance=gene, schema=_GENE_SCHEMA)
    except jsonschema.ValidationError as exc:
        raise GeneValidationError(exc.message) from exc
