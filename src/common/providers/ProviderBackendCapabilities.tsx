import * as React from 'react';

/**
 * rapid-mlx static-export patch (2026-06-03):
 *
 * The upstream `ProviderBackendCapabilities` blocks initial render until
 * it gets a successful response from the `/api/edge/backend.listCapabilities`
 * tRPC endpoint AND the server `gitSha` + `pkgVersion` match the bundle's.
 * On a `next export` static deploy there is no Next.js server, so the
 * endpoint 404s, `versionVerified` stays `null`, and the gate returns
 * `null` — the entire app renders blank.
 *
 * We're running in CSF-only mode (every LLM call is browser→relay
 * direct), so the backend capabilities concept doesn't apply — every
 * `hasLlm*` is false because there is no server-side preconfiguration.
 * Render the children immediately and skip the entire query.
 *
 * Keep the same component signature so the rest of the tree is unchanged.
 */
export function ProviderBackendCapabilities(props: { children: React.ReactNode }) {
  return <>{props.children}</>;
}
