# Off-chain anchor lookup

The anchor inspector can search by `sessionHash` (all claims in one session)
or `manifestHash` (one exact verified claim). After decoding transaction input,
it searches the session hash automatically. Results show the original prompt,
agent/model, claim texts, verdicts, and links to the session's evidence. Selecting
a verified claim loads it into the inspector's hash comparison.

The authenticated backend endpoint is
`GET /api/v1/verification/anchor-lookup?sessionHash=0x...`
or `?manifestHash=0x...`. Both filters may be combined; `claimIndex` is an optional
positive integer filter. An empty result means no matching current local record;
backend failures remain errors. The web proxy retains the bearer token server-side.

Migration `003_anchor_lookup.sql` creates SQLite indexes and a dirty-session queue.
Existing sessions are queued by the migration. New or changed sessions, claims,
and appended trace events queue an index refresh. Search refreshes queued records
before querying the indexed hashes. Commitments match the browser's canonical
schema-v1 hashing; a parity test verifies this.

Restart the backend with `npm run api:start` to apply the migration. First lookup
also indexes existing records. A hash cannot recover records from another database
or claim manifests that were changed before being preserved. This index represents
the current local records, not an archive of every prior verification attempt.
