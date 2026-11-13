'use strict';
// Keycloak tokens of the signed-in user, kept in the server-side session (never sent to the browser).
//
// Since CRISalid 1.7 the agents chat API no longer accepts a shared key: every client forwards the access token of
// the person, the chat API checks it (issuer, audience crisalid-agents, azp in AGENT_ALLOW_LIST, remaining lifetime)
// and queries the graph toolbox under that identity. /api/chat therefore needs a valid access token of the user
// at every turn, refreshed with the refresh token of the login when it is about to expire.

// The chat API refuses a token with less than MIN_TOKEN_TTL_SECONDS (120 s by default) left, because the
// toolbox token it is exchanged for expires with it. One minute of margin on top of that.
const MIN_TTL_SECONDS = 180;

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Session record of a Keycloak token endpoint response (authorization_code or refresh_token grant).
 * `refresh_expires_in` is 0 for an offline token: no known expiry, recorded as null.
 */
function tokensFromResponse(tokenData, now = nowSeconds()) {
  if (!tokenData || typeof tokenData.access_token !== 'string' || !tokenData.access_token) return null;
  const refreshIn = Number(tokenData.refresh_expires_in || 0);
  return {
    accessToken: tokenData.access_token,
    refreshToken: typeof tokenData.refresh_token === 'string' && tokenData.refresh_token ? tokenData.refresh_token : null,
    accessExpiresAt: now + Number(tokenData.expires_in || 0),
    refreshExpiresAt: refreshIn > 0 ? now + refreshIn : null,
  };
}

/**
 * Access token with at least `minTtl` seconds left: the stored one, or a new one obtained through
 * `refresh(refreshToken)` (which resolves to the token endpoint response). Resolves to
 * `{ accessToken, tokens }`, `tokens` being the record to store back in the session, or to null when the user has
 * to sign in again (no tokens, refresh token expired or refused).
 */
async function freshAccessToken(tokens, refresh, { now = nowSeconds(), minTtl = MIN_TTL_SECONDS } = {}) {
  if (!tokens || !tokens.accessToken) return null;
  if (tokens.accessExpiresAt - now >= minTtl) return { accessToken: tokens.accessToken, tokens };
  if (!tokens.refreshToken) return null;
  if (tokens.refreshExpiresAt !== null && tokens.refreshExpiresAt <= now) return null;
  let data;
  try {
    data = await refresh(tokens.refreshToken);
  } catch {
    return null;
  }
  const next = tokensFromResponse(data, now);
  if (!next) return null;
  // Keycloak sends a new refresh token on every refresh; keep the previous one if it ever does not.
  if (!next.refreshToken) {
    next.refreshToken = tokens.refreshToken;
    next.refreshExpiresAt = tokens.refreshExpiresAt;
  }
  return { accessToken: next.accessToken, tokens: next };
}

module.exports = { MIN_TTL_SECONDS, tokensFromResponse, freshAccessToken };
