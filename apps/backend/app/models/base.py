"""Shared Pydantic base model with camelCase serialization."""

from pydantic import BaseModel, ConfigDict


def _to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(w.capitalize() for w in parts[1:])


class CamelModel(BaseModel):
    """Base model that serialises fields as camelCase in JSON responses."""

    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
    )
