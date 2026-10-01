# Public repository

This repository is public. Publish generic engine code, synthetic test fixtures
and public library/platform references only.

- Keep credentials, deployed proxy addresses/usernames, customer destination
  allowlists, infrastructure inventories, private repository names and personal
  filesystem paths out of source, docs, fixtures, commit messages and CI logs.
- Inspecting a private checkout does not authorize publishing its contents.
- Use example.com or reserved .test domains for examples. Load operational
  proxy/authentication settings from private environment or secret bindings.
- Review the staged diff before every push. Do not disable credential scanning.
- Tinyproxy support must be generic HTTP/CONNECT support. Do not embed a
  deployment's configuration or substitute a new gateway without user direction.

# Engine ownership

Nimbo must implement browser capabilities in its own engine. Obscura may be
used as a public reference and a test comparator, but never as a runtime
backend, library dependency or fallback. Passing a request to Obscura does not
count as implementing or validating a Nimbo capability.
