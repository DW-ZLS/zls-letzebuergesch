# Privacy Policy — ZLS Lëtzebuergesch MCP server

*Draft for review. To be published at an HTTPS URL before any public listing.*

**Controller:** Zenter fir d'Lëtzebuerger Sprooch (ZLS), Luxembourg. Contact: *[TODO: e-mail address]*

## What the server processes

| Function | Data processed | Where |
|---|---|---|
| Spellcheck, n-rule check (without LOD verification) | The text submitted by the user | In memory, inside the server process only |
| Corpus search | The search query | In memory, inside the server process only |
| Dictionary lookups (LOD tools, `verify_with_lod`) | Only the individual word(s) being looked up | Sent to lod.lu (ZLS) |
| Corpus download (first use) | No user data | Request to data.public.lu |

## Collection, use and storage

The server does not collect personal data, create user profiles or keep logs of requests or submitted text.
Dictionary responses are cached in memory for up to 6 hours to reduce load on lod.lu and are
discarded when the process stops. The corpus file is cached on disk and contains no user data.

## Sharing with third parties

No data is sold or shared. The only external services contacted are lod.lu and data.public.lu,
both operated by or for the Luxembourg State. Standard web-server logs on those services
(IP address, time, requested URL) are governed by their own privacy notices.

*When hosted remotely:* the hosting provider's access logs are limited to technical data
(IP address, timestamp, status code) and are kept for no more than *[TODO: n]* days for security purposes.
Tool arguments are not logged.

## Retention

No user content is retained. In-memory caches are cleared on restart and expire after 6 hours.

## Your rights

Since no personal data is stored, there is nothing to access, correct or delete. For questions, contact
*[TODO: e-mail address]* or the Commission nationale pour la protection des données (CNPD).

*Last updated: [TODO: date]*
