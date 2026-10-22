# Certificate pinning material

This directory holds the **CA certificate the app trusts and nothing else**.

`PinnedHttpClientAdapter` builds a `SecurityContext(withTrustedRoots: false)`
from `api-ca.pem` and hands it to every HTTP connection, so the system root
store is never consulted for the API host. A certificate signed by any other
authority is rejected by the TLS stack before the application sees it.

## What goes here

`api-ca.pem` — the PEM-encoded CA certificate that signed the API's leaf
certificate (the ALB's certificate in the deployed topology, or the local
stack's certificate in development).

## What does NOT go here

- Leaf certificate hashes. Those are build-time material and are passed as
  `--dart-define=PINNED_CERT_SHA256=<base64 sha256 of the leaf DER>,<...>`.
  Two or more are required, so a single mis-issued certificate cannot take the
  fleet's traffic down with it.
- Anything secret. A public CA certificate is not a secret.

## Rotation

1. Add the new leaf's hash to `PINNED_CERT_SHA256` and ship. A pinned leaf is
   accepted even before its issuer is bundled — that is the rotation path.
2. When the new CA is in use everywhere, replace `api-ca.pem`.
3. Remove the old hash.
