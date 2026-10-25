# CI Codes v3.0 Enterprise

**Founded by Chiragpala Naik MD**

A dark-themed browser IDE for editing code, trying supported in-browser runtimes, previewing HTML, managing small files, and running labs with output-matching checks.

## Project structure

- `public/index.html` — main IDE website and browser-side editor logic
- `public/terms.html` and `public/privacy.html` — supporting pages
- `public/manifest.json` — installable web-app metadata
- `server.js` — zero-dependency Node.js static server, `/healthz` health check, and validated `/api/execute` proxy
- `render.yaml` — Render web-service configuration

## Run locally (Windows, macOS, or Linux)

Install Node.js 20 or newer, open a terminal in this folder, and run:

```bash
npm start
```

Then open `http://localhost:3000`. The app has no npm runtime dependencies, so `npm install` is not required. To run the bundled static checks, use `npm run check` (syntax/smoke checks plus local HTTP integration tests with a mock compiler). On Windows PowerShell, use `node server.js` if the `npm` command is unavailable.

## Deploy to Render

1. Extract the ZIP, then upload the files and folders inside it directly to the root of a GitHub repository (so `server.js`, `package.json`, `render.yaml`, and `public/` are at the repository root) and commit to `main`.
2. In Render, choose **New → Blueprint** and connect that repository to let Render read `render.yaml`, or create a **Web Service** manually with build command `npm run check` and start command `npm start`. Render supplies the `PORT` environment variable. There are no npm runtime dependencies, so an `npm install` step is not required.
3. Wait for deployment, then check `/healthz` on your deployed domain.

## Runtime behavior and limitations

- JavaScript runs in a time-limited browser Web Worker. The Quick REPL also uses a worker instead of evaluating expressions in the main page.
- Python and SQL run locally only after their Pyodide/SQL.js WebAssembly runtimes load from external CDNs. First load may take time and requires internet access.
- HTML/CSS/JavaScript is previewed in a sandboxed iframe.
- C, C++, Java, TypeScript, Rust, Go, C#, PHP, Ruby, and forced-cloud runs depend on a Piston-compatible compiler service through `/api/execute`. Configure `PISTON_API_URL` to the service's execute endpoint and, if required, `PISTON_API_TOKEN` for Bearer authentication. The public Piston API changed its access policy in February 2026, so do not assume anonymous public execution will work; use an authorized service or a self-hosted Piston instance. If the compiler is unavailable or rate-limited, the IDE reports the failure rather than pretending a simulation is a real compile.
- The lab judge checks expected output fragments for the four included examples. It is not a full competitive-programming judge and does not measure memory or time limits.
- “Code Fix & Explain” is a small local heuristic helper, not a connected AI service.
- Contest mode is a local timer and tab-switch counter, not secure exam proctoring.
- Share links store the selected language and active file's code in the URL hash. They are not permanent server-hosted projects and very large code can exceed URL limits.

## Before public launch

- Replace the Google Search Console verification placeholder in `public/index.html` with the actual token from Search Console.
- Replace `YOUR_DEPLOYED_DOMAIN` in both `sitemap.xml` and `public/sitemap.xml` with the real HTTPS domain before submitting it.
- Review privacy/terms text for your actual data flows and jurisdiction.
- Do not put secrets or API keys in browser code.
- Test the site in the browsers and devices you intend to support. The included automated checks validate application/worker syntax, UI handler names, judge logic, and required public files. Core HTTP routes were also smoke-tested during this build; external compiler/CDN availability still depends on the live services.

## GitHub Pages

GitHub Pages does not run Node.js or the `/api/execute` proxy. To use GitHub Pages, publish the contents of `public/` as a static site, but cloud compiler execution will not work there unless you configure a separate backend.
