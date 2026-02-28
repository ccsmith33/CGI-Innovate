import hashlib
import re
from dataclasses import dataclass, field


KNOWN_HEROES = [
    "Tony Stark",
    "Natasha Romanoff",
    "Thor Odinson",
    "Peter Parker",
    "Bruce Banner",
    "Steve Rogers",
    "Wanda Maximoff",
    "Clint Barton",
    "Scott Lang",
    "T'Challa",
    "Stephen Strange",
    "Carol Danvers",
]

# Order matters: vanity pattern first, then standard 10-digit, then short 7-digit, then parenthetical
PHONE_PATTERNS = [
    re.compile(r"\b555-[A-Z][-A-Z]*\b"),
    re.compile(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b"),
    re.compile(r"\b\d{3}[-.\s]?\d{4}\b"),
    re.compile(r"\(\d{3}\)\s?\d{3}[-.\s]?\d{4}\b"),
]


@dataclass
class RedactionResult:
    redacted_text: str
    redacted_metadata: dict
    original_hash: str
    patterns_matched: list[str] = field(default_factory=list)


def redact_pii(raw_text: str, metadata: dict | None = None) -> RedactionResult:
    original_hash = hashlib.sha256(raw_text.encode()).hexdigest()
    patterns_matched: list[str] = []
    redacted = raw_text
    meta = metadata or {}

    # Step 1: Redact hero_alias from metadata in text
    hero_alias = meta.get("hero_alias", "")
    if hero_alias and hero_alias in redacted:
        redacted = redacted.replace(hero_alias, "[REDACTED-NAME]")
        patterns_matched.append(f"hero_alias:{hero_alias}")

    # Step 2: Redact phone patterns
    for pattern in PHONE_PATTERNS:
        matches = pattern.findall(redacted)
        for match in matches:
            patterns_matched.append(f"phone:{match}")
        redacted = pattern.sub("[REDACTED-PHONE]", redacted)

    # Step 3: Redact known hero names (defensive pass)
    for hero in KNOWN_HEROES:
        if hero in redacted:
            redacted = redacted.replace(hero, "[REDACTED-NAME]")
            patterns_matched.append(f"known_hero:{hero}")

    # Step 4: Build redacted metadata
    redacted_metadata = dict(meta)
    if "hero_alias" in redacted_metadata and redacted_metadata["hero_alias"]:
        redacted_metadata["hero_alias"] = "[REDACTED]"
    if "secure_contact" in redacted_metadata and redacted_metadata["secure_contact"]:
        redacted_metadata["secure_contact"] = "[REDACTED]"

    return RedactionResult(
        redacted_text=redacted,
        redacted_metadata=redacted_metadata,
        original_hash=original_hash,
        patterns_matched=patterns_matched,
    )
