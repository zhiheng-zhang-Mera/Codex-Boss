# SESSION-CONTRACT (Phases 10N/10O)

Contract ids: `session`, `login-health`.
Platform-neutral; session policies are per-task decisions.

## 1. Session lifecycle vNext (10N)

Session kinds on top of existing policy:

```text
TEMPORARY      short-lived; default for long autonomous tasks
REUSABLE       may be reused by related tasks
PERSISTENT     long-lived context explicitly requested
AUTO_DELETE    deleted after the owning task completes/expires
```

Goals addressed:

- multi-device growth of web chat history
- concurrent nodes of one account
- session pool (bounded)
- stale session reaping
- provider login health
- chat garbage collection

Defaults:

- Long-running autonomous tasks default to `TEMPORARY` unless the task
  explicitly requires long-lived context.

## 2. Login health (10O)

A login status scanner reports per provider/account:

```text
provider
sessionPresent
authenticated
requiresLogin
requiresMFA
requiresCaptcha
expired
unknown
```

Rules:

- Never attempt to bypass CAPTCHA, MFA, or provider human verification.
- States requiring human action form a human-gated state (visible pause), never
  a Boss crash.
- Scanner output is observational: a session is "authenticated" only when that
  was actually observed.
