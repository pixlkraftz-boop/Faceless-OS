/**
 * domain-lookup.mjs — find a Google Business Profile by DOMAIN, not by name.
 *
 * Why this exists
 * ---------------
 * site-check's fifth wrong answer: "Duffield Kitchens has no Google listing",
 * concluded three separate times. The listing is named "Duffield Kitchens";
 * the website is derby-kitchens.com. Every lookup was keyed on the name, so
 * the name and the domain never met and absence was inferred from a miss.
 *
 * The local-seo skill documents the fix directly:
 *
 *   "search_local_businesses: One call with the brand name as `query` and a
 *    wide radius returns category, rating, review count, claimed status,
 *    coordinates, and `cid` for every location."
 *   "Match businesses by `cid` or `place_id` when you have one. Name matching
 *    collides with chains and similarly named businesses."
 *
 * So: query wide by every plausible brand string, then decide the match on the
 * row's DOMAIN. A row named nothing like the query still matches when its
 * website is the domain we are looking for.
 *
 * The absence rule
 * ----------------
 * This module never reports that a business has no listing. A search that
 * returns no domain match yields `status: "inconclusive"` carrying the exact
 * queries that were tried, so the gap is auditable and hand-checkable. Failure
 * five was not a matching bug so much as a tool asserting absence from a miss;
 * that assertion is not available here by construction.
 *
 * Wiring
 * ------
 * Pure by design — no network, no MCP client, no credentials. Inject the
 * search call so this stays testable and so it works against whatever client
 * the caller already has:
 *
 *   deps.searchLocalBusinesses({ query, latitude, longitude, radiusMeters })
 *     -> { businesses: [row, ...] }   (a bare array is accepted too)
 *
 * Point it at the OpenSEO MCP `search_local_businesses` tool. Rows are read
 * loosely: the domain is taken from a `domain` field when present, otherwise
 * derived from `url` / `website` / `contact_url` / `site`.
 *
 * Run the tests after any change:  node tools/domain-lookup.test.mjs
 */

/** Public suffixes that carry a second label, so the registrable domain is 3 parts. */
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk',
  'ac.uk', 'gov.uk', 'nhs.uk', 'police.uk', 'mod.uk',
  'com.au', 'net.au', 'org.au', 'co.nz', 'co.za', 'com.br', 'co.jp',
  'co.in', 'com.mx', 'co.il', 'com.sg', 'com.tr',
]);

/** Tokens that carry no brand signal when a query is built from a domain. */
const NOISE_TOKENS = new Set([
  'www', 'the', 'ltd', 'limited', 'llp', 'plc', 'uk', 'gb', 'co', 'inc', 'llc',
  'online', 'site', 'website', 'web', 'official', 'home', 'homepage', 'my', 'get',
]);

/**
 * Reduce any of a bare host, a full URL, or a scheme-less URL to a lowercase
 * hostname. Returns null when there is no usable host.
 */
export function normalizeDomain(input) {
  if (typeof input !== 'string') return null;

  let value = input.trim().toLowerCase();
  if (value === '') return null;

  // A bare host has no scheme; give the URL parser one so both shapes take the
  // same path and path/query/port/credentials are stripped by the parser
  // rather than by hand-rolled regex.
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) {
    if (value.includes('://')) return null; // malformed scheme, e.g. "ht!tp://x"
    value = `http://${value}`;
  }

  let host;
  try {
    host = new URL(value).hostname;
  } catch {
    return null;
  }

  host = host.replace(/\.+$/, ''); // trailing dot on a fully-qualified name
  if (host.startsWith('www.')) host = host.slice(4);

  // A hostname must have a dot and at least one label either side. Reject
  // bare words ("localhost") and anything with an empty label ("a..b").
  if (!host.includes('.')) return null;
  if (host.split('.').some((label) => label === '')) return null;

  return host;
}

/**
 * The registrable domain — one label above the public suffix. Lets
 * shop.example.co.uk match example.co.uk.
 */
export function registrableDomain(host) {
  const normalized = normalizeDomain(host);
  if (normalized === null) return null;

  const parts = normalized.split('.');
  if (parts.length <= 2) return normalized;

  const lastTwo = parts.slice(-2).join('.');
  const take = MULTI_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  return parts.slice(-take).join('.');
}

/**
 * True when two domains identify the same site. Exact host match, or a shared
 * registrable domain so subdomain and apex agree.
 */
export function domainsMatch(a, b) {
  const hostA = normalizeDomain(a);
  const hostB = normalizeDomain(b);
  if (hostA === null || hostB === null) return false;
  if (hostA === hostB) return true;

  const rootA = registrableDomain(hostA);
  const rootB = registrableDomain(hostB);
  return rootA !== null && rootA === rootB;
}

/** Pull the domain off a SERP row, however that row spells "website". */
export function rowDomain(row) {
  if (row === null || typeof row !== 'object') return null;
  for (const field of ['domain', 'url', 'website', 'contact_url', 'site']) {
    const candidate = normalizeDomain(row[field]);
    if (candidate !== null) return candidate;
  }
  return null;
}

/**
 * Brand-ish search strings derived from a domain. derby-kitchens.com yields
 * "derby kitchens"; the noise tokens are dropped only when something is left
 * to search for.
 */
export function brandQueriesFromDomain(domain) {
  const root = registrableDomain(domain);
  if (root === null) return [];

  const parts = root.split('.');
  const suffix = MULTI_PART_SUFFIXES.has(parts.slice(-2).join('.'))
    ? parts.slice(-2).join('.')
    : parts.slice(-1).join('.');
  const label = root.slice(0, root.length - suffix.length - 1);
  if (label === '') return [];

  const tokens = label.split(/[-_.]+/).filter((token) => token !== '');
  if (tokens.length === 0) return [];

  const spaced = tokens.join(' ');
  const meaningful = tokens.filter((token) => !NOISE_TOKENS.has(token));

  const queries = [spaced];
  // Only offer the trimmed variant when trimming actually removed noise and
  // left a brand behind — "the-uk-co.com" must not collapse to "".
  if (meaningful.length > 0 && meaningful.length < tokens.length) {
    queries.push(meaningful.join(' '));
  }
  // The bare label is worth trying when it was hyphenated: some listings are
  // registered as one word.
  if (tokens.length > 1) queries.push(tokens.join(''));

  return [...new Set(queries)];
}

/** Order and de-duplicate the queries to spend, name first when supplied. */
export function buildQueryPlan({ domain, name } = {}) {
  const plan = [];
  const seen = new Set();

  const push = (raw, source) => {
    if (typeof raw !== 'string') return;
    const query = raw.trim().replace(/\s+/g, ' ');
    if (query === '') return;
    const key = query.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    plan.push({ query, source });
  };

  // The known trading name is the strongest signal and is tried first — it is
  // what would have found Duffield Kitchens on the first call.
  push(name, 'name');
  for (const query of brandQueriesFromDomain(domain)) push(query, 'domain');

  return plan;
}

export const DEFAULT_RADIUS_METERS = 50000;

/**
 * Look a business up by domain.
 *
 * @param {object} target
 *   @param {string} target.domain        - the site to find the listing for (required)
 *   @param {string} [target.name]        - trading name, if known
 *   @param {{latitude:number, longitude:number}} [target.near] - search centre
 *   @param {number} [target.radiusMeters] - defaults to a deliberately wide 50km
 * @param {object} deps
 *   @param {Function} deps.searchLocalBusinesses - injected MCP call
 *
 * @returns {Promise<{status:'found'|'inconclusive'|'invalid_domain', ...}>}
 *   `found`        - matches[] ranked, each with cid/placeId/coordinate
 *   `inconclusive` - no domain match; carries attempts[] for hand-checking.
 *                    NOT a finding of "no listing".
 */
export async function findBusinessByDomain(target = {}, deps = {}) {
  const { domain, name, near, radiusMeters = DEFAULT_RADIUS_METERS } = target;
  const { searchLocalBusinesses } = deps;

  if (typeof searchLocalBusinesses !== 'function') {
    throw new TypeError('findBusinessByDomain requires deps.searchLocalBusinesses');
  }

  const normalizedDomain = normalizeDomain(domain);
  if (normalizedDomain === null) {
    return {
      status: 'invalid_domain',
      domain: domain ?? null,
      matches: [],
      attempts: [],
      verified: false,
      note: 'Could not read a hostname from the supplied domain.',
    };
  }

  const plan = buildQueryPlan({ domain: normalizedDomain, name });
  const attempts = [];
  const matches = [];
  const seenListings = new Set();

  for (const { query, source } of plan) {
    let rows = [];
    let error = null;

    try {
      const response = await searchLocalBusinesses({
        query,
        latitude: near?.latitude,
        longitude: near?.longitude,
        radiusMeters,
      });
      rows = Array.isArray(response) ? response : (response?.businesses ?? []);
      if (!Array.isArray(rows)) rows = [];
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }

    let hitsThisQuery = 0;

    for (const row of rows) {
      const foundDomain = rowDomain(row);
      if (foundDomain === null) continue;
      if (!domainsMatch(foundDomain, normalizedDomain)) continue;

      hitsThisQuery += 1;

      // Prefer cid/place_id as identity per the skill's guardrail; fall back to
      // the domain so a row lacking both is still de-duplicated.
      const cid = row.cid ?? null;
      const placeId = row.place_id ?? row.placeId ?? null;
      const key = cid ?? placeId ?? `${foundDomain}::${row.name ?? ''}`;
      if (seenListings.has(key)) continue;
      seenListings.add(key);

      matches.push({
        name: row.name ?? null,
        domain: foundDomain,
        cid,
        placeId,
        latitude: row.latitude ?? row.lat ?? null,
        longitude: row.longitude ?? row.lng ?? row.lon ?? null,
        rating: row.rating ?? null,
        reviews: row.reviews ?? row.review_count ?? row.reviewCount ?? null,
        isClaimed: row.isClaimed ?? row.is_claimed ?? null,
        category: row.category ?? null,
        // How the row was reached — a match found only via a domain-derived
        // query is exactly the case a name-keyed lookup would have missed.
        matchedVia: source,
        matchedQuery: query,
        // The listing name differing from the query is the Duffield signature.
        nameDiffersFromQuery: typeof row.name === 'string'
          ? row.name.trim().toLowerCase() !== query.toLowerCase()
          : null,
        row,
      });
    }

    attempts.push({ query, source, radiusMeters, rowsReturned: rows.length, matched: hitsThisQuery, error });

    // A cid-bearing match is authoritative; stop rather than buy more searches.
    if (matches.some((match) => match.cid !== null || match.placeId !== null)) break;
  }

  if (matches.length > 0) {
    return {
      status: 'found',
      domain: normalizedDomain,
      matches,
      attempts,
      verified: false,
      note: 'Automated match on the listing website domain. Confirm by hand before it goes in front of anyone.',
    };
  }

  return {
    status: 'inconclusive',
    domain: normalizedDomain,
    matches: [],
    attempts,
    verified: false,
    // Deliberately not "no listing exists" — that sentence is failure five.
    note: 'No listing matched this domain in the queries tried. This is not evidence that no listing exists: '
      + 'the trading name may differ from the domain, the radius may be too tight, or the listing may omit its website. '
      + 'Check by hand before drawing any conclusion.',
  };
}
