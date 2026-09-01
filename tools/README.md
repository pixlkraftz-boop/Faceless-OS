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

### Tests

```
node tools/domain-lookup.test.mjs
```

31 assertions. Mutation-tested: ten bugs were reintroduced one at a time
(matching on name rather than domain, `co.uk` treated as a plain TLD, `www.`
left on the host, absence asserted from a miss, no early stop after a `cid`
hit, noise-trimming emptying a query, the `domain` field no longer preferred
over `url`, a malformed domain reaching a paid search, de-duplication removed,
bare words accepted as hostnames) and the suite was confirmed to fail on each.

### Note on placement

This is Local Growth / SEO tooling and it sits in the FacelessOS repository
because that is the only repository this session had. The `Local Growth - SEO`
working tree is not on this machine. Move it if it belongs elsewhere.
