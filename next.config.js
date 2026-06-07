const path = require('path');
const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  disable: process.env.NODE_ENV === "development" || process.env.DISABLE_PWA === "1",
  register: true,
  cacheStartUrl: true,
  cacheOnFrontendNav: true,
  fallbacks: {
    document: "/~offline",
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // The app reads Antigravity runtime state from user-profile folders at
  // request time. Those folders must not be bundled into the standalone server;
  // tracing them on Windows can fail on protected junctions such as
  // "Application Data".
  outputFileTracingExcludes: {
    '*': [
      'C:/Users/*/**',
      '/Users/*/**',
      '/home/*/**',
      '**/.gemini/**',
      '**/AppData/**',
      '**/Application Data/**',
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // instrumentation.ts is enabled by default in Next.js 16+ (no experimental flag needed)
  // Declare an empty turbopack config so Next.js 16's Turbopack-by-default mode doesn't
  // error when it detects the webpack config injected by @ducanh2912/next-pwa.
  turbopack: {},
  // Fix 1: puppeteer-core must NOT be bundled/minified by Turbopack â€?it
  // contains native WebSocket code with a `mask()` function that Turbopack's
  // minifier mangles (renaming it to `b`), causing "b.mask is not a function"
  // at runtime. `serverExternalPackages` keeps it as a native Node.js
  // require in the standalone build, preserving the module intact.
  // Note: `puppeteer` (full) is on Next.js's default external list, but
  // `puppeteer-core` is NOT â€?so we must declare it explicitly.
  serverExternalPackages: ['puppeteer-core'],
  // Fix 2: Next.js 16.1.6 on Node 24 fails to transpose function properties
  // from next.config.ts via SWC. The default generateBuildId becomes undefined,
  // causing "TypeError: generate is not a function" during the build.
  // Using next.config.js (CJS) avoids this TS transpilation path entirely.
  generateBuildId: async () => `v${require('./package.json').version}`,
  webpack: (config) => {
    config.resolve.alias['@'] = __dirname;
    return config;
  },
};

module.exports = withPWA(nextConfig);
