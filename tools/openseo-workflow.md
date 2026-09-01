# OpenSEO operating card

Extracted from the nine skill files shipped by `openseo@openseo` v1.0.0, read
directly. Everything below is quoted or paraphrased from those files — nothing
here is inferred from a session transcript or from memory.

Its job is to stop the two things that cost credits and produced a wrong
conclusion: skipping the free context read, and re-buying research that was
already paid for.

---

## The correction

The workflow is commonly stated as *"run `seo-project-setup` first, it populates
what every other skill reads."* That is half right, and the half that is wrong
makes the process more expensive than it needs to be.

What the skills actually document is a **per-skill inline fallback**. Every one
of the eight non-setup skills carries the same instruction:

> If [the section it needs] is empty, run a minimal inline setup: … then
> continue. **Never front-load the full interview**; suggest `seo-project-setup`
> at the end for the rest.

So a missing context section does not mean stop and run the full interview. It
means fill in *only the section this skill needs*, inline, then carry on.

The non-negotiable step is not `seo-project-setup`. It is **`get_project_context`
first, every time** — it is free, and it carries the research log.

## What each skill actually requires

| Skill | Context section it needs |
| --- | --- |
| `seo-audit` | `business_overview` |
| `local-seo` | `business_overview` |
| `keyword-research` | `business_overview` + `current_goal` |
| `keyword-clustering` | key pages |
| `competitive-landscape` | competitors |
| `competitor-analysis` | competitors |
| `link-prospecting` | `positioning` + competitors |
| `seo-coach` | none — reads whatever is there |

`seo-coach` is the router: it reads `missingSections` and recommends the next
workflow. Empty context usually means the answer is `seo-project-setup`.

---

## The four steps every skill opens with

Identical in eight of the nine skills, verbatim:

1. **`get_project_context` first** — ground the work in it.
2. **Fill only the missing section inline** if the one this skill needs is empty.
3. **Check the research log before spending.** *"If the same research ran within
   the last 30 days, reuse that result and say so instead of re-buying it."*
4. **`update_project_context` on finish** — write back what is durable, and
   append a research-log entry when the session spent credits.

Research-log format, from the skills:

```
{ appendResearchLog: { summary: "<what>: <inputs>. Verdict: <conclusion>" } }
```

Competitor rows are keyed by domain, so a listing with no website cannot be
saved as one. Overwriting a section replaces it — merge into the existing prose
rather than discarding it.

---

## Cost model

### Free — stated explicitly

- `get_project_context`, `update_project_context` — *"Both are free — they spend
  no credits."* Asserted in all nine skills.
- `whoami` — *"confirm connection and remaining credits before spending
  anything."* This is the credit-balance check.
- `list_projects` — *"Do not run research tools just to test connectivity;
  `whoami` and `list_projects` are enough."*

### Spends credits — stated explicitly

- `get_domain_overview` and `research_keywords` — see the ambiguity below.
- `get_local_rank_grid` — *"every point is a paid SERP call."* A 3×3 is nine
  searches. Do not run 5×5, or grids across several keywords, without stating
  the cost first.
- SERP retrieval generally (`get_serp_results`, `get_local_serp_results`).

### Ambiguous — verify before relying on it

`seo-audit` says:

> Keep total spend modest: one audit, one backlinks overview, at most one domain
> overview, and at most one keyword-research call. **Only the overview and
> keyword lookups spend credits.**

The preceding sentence names *two* overviews — backlinks and domain — and the
cost sentence says "the overview", singular. The most plausible reading is that
`get_domain_overview` and `research_keywords` cost, and `run_site_audit` and
`get_backlinks_overview` do not. That is a reading, not a statement.

**Do not budget on it.** Call `whoami` before and after the first audit of a new
project and diff the balance. Record the answer in the research log so it is
settled once.

### Free by design

- `get_business_reviews` returns `processing` with a `taskId` on a queued call;
  calling again with that id costs nothing extra. Wait 30–60 seconds rather than
  polling in a loop.

---

## Looking a business up

The guardrail that matters most, from `local-seo`:

> Match businesses by `cid` or `place_id` when you have one. **Name matching
> collides** with chains and similarly named businesses.

And the technique for finding one at all:

> One call with the brand name as `query` and a wide radius returns category,
> rating, review count, claimed status, coordinates, and `cid` for every
> location.

`search_local_businesses` takes `isClaimed: false` to surface unclaimed listings
directly — *"use `isClaimed: false` to find unclaimed listings when
prospecting."* Any bespoke unclaimed-listing scanner should be checked against
this before it is extended.

Reading a missing grid point, from the same skill:

> A missing rank at a grid point means the business wasn't among the results
> returned there. Read it with that point's `resultsCount`: a full result set
> means outranked; a near-empty one means a sparse SERP, **not proof of
> invisibility**.

Same failure mode as concluding "no listing" from a name-keyed miss — see
`tools/domain-lookup.mjs`.

---

## Sequence for a local prospect

1. `whoami` — connection and credit balance.
2. `list_projects` → `get_project_context`. Free. Read the research log.
3. Anything already researched inside 30 days: reuse, and say so.
4. Fill only the missing section inline if needed.
5. Spend, narrowly. Confirm cost before any grid beyond 3×3.
6. `update_project_context` — competitors, key pages, corrected overview, and a
   research-log entry naming what was bought and what it concluded.

One project per business. Researching a second business inside an existing
project pollutes both.
