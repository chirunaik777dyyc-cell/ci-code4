# CI Codes v3.0 Verification Report

Verification run: 2026-10-25

## Automated checks completed

The following command completed successfully in the project folder:

```bash
npm run check
```

It ran these checks:

- Node.js server syntax validation.
- Inline application JavaScript syntax validation.
- Syntax validation of both embedded worker scripts.
- UI handler declaration checks and static DOM ID-reference checks.
- Checks for key judge logic, execution guards, and required public files.
- JavaScript worker behavior tests for console output, object formatting, warnings, and exception reporting.
- Local HTTP integration tests for the home page, privacy/terms, manifest, robots, sitemap, health route, security headers, missing routes, path traversal rejection, malformed JSON, unsupported languages, unsafe compiler filenames, oversized request rejection, compiler proxy forwarding, Bearer token forwarding, and rate limiting.

## Not certified by these checks

- Browser end-to-end interaction: the automation environment blocked navigation to its local test server, so buttons and UI flows were not fully clicked through in a real browser.
- Python execution: Pyodide must load from its external CDN. The runtime could not be executed end-to-end in this environment.
- SQLite execution: SQL.js and its WebAssembly binary must load from cdnjs. The runtime could not be executed end-to-end in this environment.
- Real cloud compilation: the integration tests use a local mock compiler to verify the proxy contract; they do not compile real programs using an external service.
- Deployment on Render, real device/browser compatibility, SEO verification, and Google Search Console verification.

## Required setup for online compilation

The server supports these environment variables:

- `PISTON_API_URL`: full URL to a Piston-compatible `/execute` endpoint.
- `PISTON_API_TOKEN`: optional Bearer token sent to the configured compiler endpoint.

The public Piston API's access policy changed in February 2026. Anonymous execution may not be available; configure an authorized service or a self-hosted Piston-compatible service. Never put compiler tokens in browser JavaScript or commit them to GitHub.

## Before public launch

- Replace `YOUR_DEPLOYED_DOMAIN` in both sitemap files with the deployed HTTPS hostname.
- Replace the Google Search Console verification placeholder in `public/index.html` with the site's actual verification token.
- Verify Python, SQL, HTML preview, autosave, file operations, sharing, and all intended languages on the deployed site in a supported browser.
- Review privacy/terms for the site's actual behavior and deployment jurisdiction.
