import { defineConfig } from 'astro/config';

// Static output only: no adapter, no server code, no client framework.
export default defineConfig({
  // The site's public address: canonical links and link previews are built from it.
  site: 'https://clinx.org',
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
    // A strict Content-Security-Policy has no 'unsafe-inline': never inline CSS or JS.
    inlineStylesheets: 'never',
  },
  vite: {
    build: {
      // Keep the one small script as a file rather than a data: or inline URL.
      assetsInlineLimit: 0,
    },
  },
  devToolbar: { enabled: false },
});
