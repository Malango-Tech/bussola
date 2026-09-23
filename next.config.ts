import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content Security Policy.
 *
 * Everything Bussola renders comes from its own origin: fonts are self-hosted
 * by next/font, brand icons live in /public, and provider APIs are called from
 * the server, never the browser. So the policy can be `'self'` almost
 * everywhere. Scripts still need `'unsafe-inline'` for the bootstrap Next
 * inlines into every page (a nonce would force every route to render
 * dynamically); `'unsafe-eval'` is only for the dev server's hot reloader.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Nothing here is meant to be framed — not even a share page, which carries
  // a bearer token in its URL.
  "frame-ancestors 'none'",
  // No upgrade-insecure-requests: a self-hosted install is often reached over
  // plain http on a LAN address, where upgrading every subresource to https
  // would break the page outright.
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Share links carry their token in the path; never leak it in a Referer.
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Only honoured over HTTPS, so harmless on a plain-http localhost install.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  // Native/WASM database drivers must stay outside the bundle.
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react"],
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
