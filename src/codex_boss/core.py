from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class Verdict(StrEnum):
    ACCEPT = "accept"
    REJECT = "reject"
    DISPUTED = "disputed"
    REVIEW_REQUIRED = "review_required"


@dataclass(frozen=True, slots=True)
class Claim:
    claim_id: str
    text: str
    source_artifact: str
    confidence: float | None = None

    def __post_init__(self) -> None:
        if not self.claim_id.strip() or not self.source_artifact.strip():
            raise ValueError("claim_id and source_artifact are required")
        if self.confidence is not None and not 0 <= self.confidence <= 1:
            raise ValueError("confidence must be in [0, 1]")


@dataclass(slots=True)
class Deliberation:
    claims: list[Claim] = field(default_factory=list)

    def add(self, claim: Claim) -> None:
        if any(item.claim_id == claim.claim_id for item in self.claims):
            raise ValueError(f"duplicate claim_id: {claim.claim_id}")
        self.claims.append(claim)

    def verdict(self) -> Verdict:
        if not self.claims or any(item.confidence is None for item in self.claims):
            return Verdict.REVIEW_REQUIRED
        texts = {item.text.strip().casefold() for item in self.claims}
        if len(texts) > 1:
            return Verdict.DISPUTED
        return Verdict.ACCEPT
