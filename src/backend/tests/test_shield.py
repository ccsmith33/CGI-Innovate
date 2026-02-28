import pytest

from app.services.shield import redact_pii


def test_redact_hero_alias_from_text():
    result = redact_pii(
        "Tony Stark reported a situation.",
        {"hero_alias": "Tony Stark", "secure_contact": "555-0101"},
    )
    assert "Tony Stark" not in result.redacted_text
    assert "[REDACTED-NAME]" in result.redacted_text
    assert "hero_alias:Tony Stark" in result.patterns_matched


def test_redact_standard_phone():
    result = redact_pii("Call 555-867-5309 for info.")
    assert "555-867-5309" not in result.redacted_text
    assert "[REDACTED-PHONE]" in result.redacted_text


def test_redact_vanity_phone():
    result = redact_pii("Contact via 555-GOD-OF-THUNDER")
    assert "555-GOD-OF-THUNDER" not in result.redacted_text
    assert "[REDACTED-PHONE]" in result.redacted_text


def test_redact_short_phone():
    result = redact_pii("Call 555-0101 now.")
    assert "555-0101" not in result.redacted_text
    assert "[REDACTED-PHONE]" in result.redacted_text


def test_redact_known_hero_inline():
    result = redact_pii("Bruce Banner was seen in the lab.")
    assert "Bruce Banner" not in result.redacted_text
    assert "[REDACTED-NAME]" in result.redacted_text
    assert "known_hero:Bruce Banner" in result.patterns_matched


def test_metadata_redacted():
    result = redact_pii(
        "Some text",
        {"hero_alias": "Tony Stark", "secure_contact": "555-0101 (Iron Line)"},
    )
    assert result.redacted_metadata["hero_alias"] == "[REDACTED]"
    assert result.redacted_metadata["secure_contact"] == "[REDACTED]"


def test_sha256_hash_computed():
    result = redact_pii("Test text")
    assert len(result.original_hash) == 64
    assert all(c in "0123456789abcdef" for c in result.original_hash)


def test_no_pii_in_output():
    text = "Tony Stark called 555-867-5309 and Bruce Banner at 555-GOD-OF-THUNDER"
    metadata = {"hero_alias": "Tony Stark", "secure_contact": "555-0101 (Iron Line)"}
    result = redact_pii(text, metadata)

    # No PII should appear anywhere
    assert "Tony Stark" not in result.redacted_text
    assert "555-867-5309" not in result.redacted_text
    assert "555-GOD-OF-THUNDER" not in result.redacted_text
    assert "Bruce Banner" not in result.redacted_text
    assert result.redacted_metadata.get("hero_alias") == "[REDACTED]"
    assert result.redacted_metadata.get("secure_contact") == "[REDACTED]"


def test_no_metadata_returns_clean():
    result = redact_pii("Just a clean report with no PII.")
    assert result.redacted_text == "Just a clean report with no PII."
    assert result.redacted_metadata == {}
    assert result.patterns_matched == []
