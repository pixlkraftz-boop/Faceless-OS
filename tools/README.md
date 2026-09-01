# tools/

## domain-lookup.mjs

Finds a Google Business Profile by **domain** instead of by name.

### The failure it closes

site-check's fifth wrong answer: *"Duffield Kitchens has no Google listing"*,
concluded across three separate checks. The listing is named **Duffield
Kitchens**; the website is **derby-kitchens.com**. Every check was keyed on the
name, so the name and the domain never met — and a miss was read as an absence.

The `local-seo` skill documents the technique that finds it:

> `search_local_businesses`: One call with the brand name as `query` and a wide
> radius returns category, rating, review count, claimed status, coordinates,
> and `cid` for every location.

> Match businesses by `cid` or `place_id` when you have one. Name matching
> collides with chains and similarly named businesses.

So the lookup queries wide by every plausible brand string, then decides the
match on the row's `domain` field. A listing named nothing like the query still
matches when its website is the domain being looked for.

### It will not tell you a business has no listing

A search with no domain match returns `status: "inconclusive"` and the exact
queries it tried — never "no listing exists". Failure five was less a matching
bug than a tool asserting absence from a miss; that sentence is not reachable
here by construction. Every result, hit or miss, carries `verified: false`, per
the standing rule that nothing automated reaches a prospect unchecked.

### Wiring

Pure — no network, no MCP client, no credentials. Inject the search call:

```js
import { findBusinessByDomain } from './tools/domain-lookup.mjs';

const result = await findBusinessByDomain(
  { domain: 'derby-kitchens.com', name: 'Duffield Kitchens' },  // name optional
  { searchLocalBusinesses: /* your OpenSEO search_local_businesses call */ },
);
```

The injected function receives `{ query, latitude, longitude, radiusMeters }`
and may return either `{ businesses: [...] }` or a bare array. Rows are read
loosely: the domain comes from a `domain` field when present, otherwise from
`url` / `website` / `contact_url` / `site`.

Cost control: queries run in order — known trading name first, then names
derived from the domain — and stop as soon as a row with a `cid` or `place_id`
matches. A malformed domain is rejected before any paid call.

### Running it by hand

The standing rule is that no automated finding reaches a prospect unchecked, so
the lookup is runnable directly. Give it SERP rows you already have and it will
tell you which one actually belongs to the domain — no credit is spent, because
nothing is re-fetched:

```
node tools/domain-lookup.mjs --domain derby-kitchens.com --rows rows.json
some-fetch | node tools/domain-lookup.mjs --domain derby-kitchens.com --rows -
```

`--rows` takes a JSON array of rows or a `{ "businesses": [...] }` object; `-`
reads stdin. `--name` supplies a known trading name, `--json` emits the raw
result object.

On the real case:

```
MATCHED  derby-kitchens.com
  Duffield Kitchens
    cid 333   place_id —
    found via domain query "derby kitchens"
    NOTE: listing name differs from the query — a name-only lookup would have missed it.
```

Exit codes: **0** matched, **3** nothing matched, **2** bad invocation. `3` is
not a finding of absence — it means this search did not match, and the queries
it tried are printed so the gap can be checked by hand.

### Tests

```
node tools/domain-lookup.test.mjs
```

38 assertions. Mutation-tested: seventeen bugs were reintroduced one at a time
and the suite was confirmed to fail on each:

*Matching* — matching on name rather than domain; `co.uk` treated as a plain
TLD; `www.` left on the host; the `domain` field no longer preferred over
`url`; bare words accepted as hostnames; de-duplication removed.

*Absence* — absence asserted from a miss; a miss rendered as "has no Google
listing"; the queries tried hidden from the miss report; the no-match exit code
collapsed into success.

*Cost* — no early stop after a `cid` hit; a malformed domain reaching a paid
search.

*CLI* — a flag accepted as another flag's value; unknown flags silently
ignored; the name-mismatch warning dropped; the hand-check note never printed;
noise-trimming emptying a query.

### Keeping the OpenSEO plugin installed

`.claude/hooks/session-start.sh` reinstalls the OpenSEO plugin (nine SEO skills
plus its MCP server) at the start of every remote session.

Claude Code on the web clones this repo into a fresh container each session and
reclaims it afterwards. The plugin installs per-user rather than per-repo, so
without the hook every web session starts without it. The hook fixes that once
it is on the default branch.

It no-ops on a local machine (`CLAUDE_CODE_REMOTE` unset), is idempotent — both
plugin commands exit 0 when already installed — and never fails a session: this
repo's tests are zero-dependency Node and do not need the plugin.

The one part that cannot be scripted is the MCP login, which is interactive.
The hook prints the reminder: run `/mcp`, pick OpenSEO, sign in.

### Note on placement

This is Local Growth / SEO tooling and it sits in the FacelessOS repository
because that is the only repository this session had. The `Local Growth - SEO`
working tree is not on this machine. Move it if it belongs elsewhere.
