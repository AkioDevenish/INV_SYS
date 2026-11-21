import type { NextConfig } from "next";

const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const isDev = process.env.NODE_ENV === "development";

// Baseline CSP for static assets and API routes not matched by src/proxy.ts.
// Matched document routes receive a per-request nonce CSP from src/proxy.ts.
const baselineCsp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Permit the development app to serve HMR resources from optional LAN/tunnel
  // origins specified via ALLOWED_DEV_ORIGINS (comma-separated).
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Uploaded files and the reminder-email preview send their own,
        // stricter policy; config headers would otherwise overwrite it.
        source: "/((?!api/files/|api/reminders/preview).*)",
        headers: [{ key: "Content-Security-Policy", value: baselineCsp }],
      },
    ];
  },
  experimental: {
    // Server Actions cap request bodies at 1MB by default, which a catalogue
    // spreadsheet can exceed once it carries a few hundred rows.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
