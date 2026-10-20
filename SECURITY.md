# Security policy

Please report vulnerabilities privately to **frolicmap.official@gmail.com**
rather than in a public issue. GitHub Private Vulnerability Reporting will be
enabled when the repository becomes public (Security tab > Report a
vulnerability) as a second channel; either one is fine. This is a best-effort,
volunteer project, so there is no response-time commitment. In scope: the
Cloudflare Worker (`worker/`) and the web app (SPA) in this repository.
frolicmap has no user accounts and stores no personal data beyond a keyed
pseudonymous identifier derived from the visitor's IP address, used to detect
sequential scraping of place records. The identifier is an HMAC-SHA256 keyed with a server-side secret, so it cannot be
reversed by hashing candidate IP addresses. It is stored with a short counter of
recent lookups and deleted after 24 hours of inactivity. The cleanup sweep is
probabilistic (about 1 in 100 writes triggers it), so a row can outlive 24 hours
until a later sweep removes it.
