import unittest

from codex_boss import Claim, Deliberation, Verdict


class DeliberationTests(unittest.TestCase):
    def test_missing_confidence_requires_review(self) -> None:
        case = Deliberation([Claim("a", "proposal", "raw/a.md")])
        self.assertEqual(case.verdict(), Verdict.REVIEW_REQUIRED)

    def test_conflicting_claims_remain_disputed(self) -> None:
        case = Deliberation([
            Claim("a", "ship", "raw/a.md", 0.8),
            Claim("b", "do not ship", "raw/b.md", 0.7),
        ])
        self.assertEqual(case.verdict(), Verdict.DISPUTED)

    def test_duplicate_claim_ids_are_rejected(self) -> None:
        case = Deliberation([Claim("a", "one", "raw/a.md", 0.8)])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            case.add(Claim("a", "two", "raw/b.md", 0.8))


if __name__ == "__main__":
    unittest.main()
