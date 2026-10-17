import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/** Bank demo route that owns Google OAuth completion (token exchange + login). */
export const OAUTH_RETURN_PATH = "/demo/bank";

const OAUTH_QUERY_KEYS = [
  "oauth_token",
  "oauth_user_id",
  "oauth_name",
  "oauth_hash",
  "error",
] as const;

/**
 * Google redirect-mode posts the credential to the backend, which bounces the
 * browser back with session params in the query string. The backend must land
 * on /demo/bank, but older callbacks used "/" — this guard forwards any stray
 * OAuth params to the bank demo so login still completes.
 */
export function OAuthReturnHandler() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (pathname === OAUTH_RETURN_PATH || pathname.startsWith(`${OAUTH_RETURN_PATH}/`)) {
      return;
    }

    const params = new URLSearchParams(search);
    const hasOAuthPayload = OAUTH_QUERY_KEYS.some((key) => params.has(key));
    if (!hasOAuthPayload) return;

    navigate(`${OAUTH_RETURN_PATH}${search}`, { replace: true });
  }, [pathname, search, navigate]);

  return null;
}
