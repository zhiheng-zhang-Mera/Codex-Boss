# Security Policy

Do not open a public issue containing credentials, personal data, private transcripts, health records, exploit details, or third-party copyrighted assets. Report a vulnerability through GitHub's private security-advisory workflow for this repository.

This pre-alpha project has no production support guarantee. Treat browser automation, device control, health-data processing, and generated decisions as untrusted until independently reviewed and tested in a bounded environment.

The optional WeChat/QQ PC relay is local, opt-in, and receive-only. It inspects accessibility text from visible client windows, emits only lines carrying the configured command prefix, and always requires a user to load and submit a pending command in Codex Boss. It must not be modified to extract credentials, session tokens, hidden chat history, or to bypass platform controls. Remote chat content remains untrusted input and must never directly execute shell, file, browser, or account actions.
