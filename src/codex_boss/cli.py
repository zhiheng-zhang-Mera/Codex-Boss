from __future__ import annotations

import argparse
import json

from .core import Claim, Deliberation


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate an evidence-linked starter claim.")
    parser.add_argument("text")
    parser.add_argument("--source", required=True)
    parser.add_argument("--confidence", type=float)
    args = parser.parse_args()
    case = Deliberation()
    case.add(Claim("cli-claim", args.text, args.source, args.confidence))
    print(json.dumps({"verdict": case.verdict().value, "claim_count": len(case.claims)}))
