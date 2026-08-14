# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, report
privately by email to `ritesh.wanave@siemens.com` or via a [private advisory]
(https://github.com/RiteshWanave/vsc-gitlab-mr/security/advisories/new).

Please include:

- The extension version you're using
- The VS Code version and OS
- A description of the issue and, if possible, how to reproduce it
- The impact you observed

You should receive a response within a few days. If you don't, please follow up.

## What this project treats as a security concern

- Leaking of the GitLab personal access token (the extension stores it only in
  VS Code's secure secret storage and never writes it to disk).
- Exfiltration of repository data or credentials by the webview forms.
- Dependency vulnerabilities in the shipped extension.

## Secure handling guidelines

- The token is requested once via an input box (`password: true`) and stored
  with `ExtensionContext.secrets` — never log it, never put it in configuration
  or in the repository.
- The MR-creation webview uses a strict CSP and only posts messages to the
  extension host; template content is treated as untrusted markdown.
- Report any suspected information disclosure in webview rendering (e.g.
  template placeholders or MR descriptions leaking data).

## Supported versions

Only the latest release on the `main` branch is supported with security fixes.
