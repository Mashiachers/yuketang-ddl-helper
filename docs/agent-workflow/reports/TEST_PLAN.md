# QA test plan and evidence

**Under test** W:\yuketang, develop/v0.2-resource-export, e749b55cc6adf22acf16eba84ad9df3217dc0971  
**Environment** Windows, Node 24.15.0, npm 11.12.1, Vite 6.4.6, Vitest 3.2.7  
**Run date** 2026-11-24, Asia/Shanghai

## Executed commands

| Command | Exit | Measured result |
| --- | ---: | --- |
| npm run typecheck | 0 | tsc --noEmit passed after a test-only DOM typing fix. |
| npm test | 1 | 99 passed, 8 failed, 107 total. core.test.ts 22/22, resource-adapter.test.ts 25/25, resource-export.test.ts 35/35, qa-security.test.ts 17/25. |
| npm run build | 0 | Vite built popup, preview, content and background bundles in dist. |
| npm run package | 0 | Created release/yuketang-ddl-helper-v0.1.0.zip, 297,955 bytes, 13 entries. The archive and built manifest report 0.1.0, so the v0.2.0-beta artifact criterion fails. |
| npm audit --json, official npm registry | 1 | 2 critical and 1 moderate package findings, all in the development tree. |
| npm audit --omit=dev --json, official npm registry | 0 | Registry reported zero production dependency advisories. |

Package SHA-256 for this run is 96a3750435035b0286787d99a3ed36550eeb7ba2ed5ba8e1c688971c7c1e813e. Opened the ZIP via .NET, enumerated entries and checked manifest.json. This verifies archive creation and contents. Browser installation and cross-platform extraction remain unverified.

## Test matrix

| Area | Coverage | Result | Verification boundary |
| --- | --- | --- | --- |
| v0.1 DDL | All 22 original assertions from ac13b75 plus a backend bridge test with a seeded effective personal deadline, a resource ICS export and legacy prompt formatting. | Pass | Original core tests and locally mocked adapter input. Board UI, clipboard, and calendar application import remain unverified. |
| Adapter discovery | Existing suite covers mock pages, fallback branch shapes, slide hydration, duplicate-page detection, retry, timeout, cancellation and 401. Added unsafe URL, HTML and prototype-field cases. | Pass except unknown diagnostic code echo | Mock HTTP response objects. Real login and branch coverage remain unverified. |
| Privacy | Tests inspect normalized objects, diagnostics, serialized index, export manifest and all five sets of generated payloads with synthetic credential and student markers. ICS includes concrete event content. | Structured and recognized tokens pass. Unknown error code and free-text student identifier fail. | Pure local code, mock data and storage. Binary attachment content, arbitrary opaque tokens and browser network telemetry remain outside this evidence. |
| File and archive safety | Direct path rejection, named device files, control and bidi tags, normalization and deduplication, local/central ZIP members, CRC32 and merged JPEG page order. Active suffixes tested at the simulated anchor. | Paths, ZIP structure and PDF order pass. Five active suffix checks fail. | In-memory bytes and inert text bodies. No file execution attempted. Windows and macOS extraction/display remain unverified. |
| Index integrity | Adapter field projection, absent inherited-key effects, persisted shape validation, deduplication, namespace and checksum checks. | Projection, no observed prototype mutation, and regular outcomes pass. Invalid persisted entries survive. | Mock localStorage and existing unit tests. Real chrome.storage.local, cross-tab writes, login changes and quota-pressure recovery remain unverified. |
| Demo production backend | createBrowserResourceBackend sync, single PDF, two-file batch ZIP, every export mode, download status, failure count and live/Demo separation. | Pass | Two courses, six resources, seven intercepted Blob handoffs, five downloaded records, one unavailable video reported as a failed attempt, zero fetch calls. DOM anchors and storage are simulated in Node. |
| Cancellation and recovery | Pre-aborted batch and AI Context export, unsupported slide merge, forced retry and index refresh. Existing tests cover in-flight abort, timeout, transient retry, per-item failures and byte limits. | Pass | Mock transport plus real local service logic. Cancellation during actual browser save, persistence races and peak browser memory remain unverified. |
| AI Context | Course title and announcement carry instruction-like test text. Confirmed the static study prompt keeps trust boundaries and the content stays in the data payload. | Pass | Format-level verification. Model behavior and NotebookLM import remain unverified. |
| MV3 and dependencies | Manifest guard, permissions, content-script scope, package declarations, dependency graph digest, source baseline diff and registry audit. | No permission expansion or new dependencies. Development advisories remain open. | Static and registry checks. Browser permission prompt remains unverified. |

## Assertion failures to keep visible

The QA suite uses ordinary assertions. The release should drive them green through implementation fixes.

| Cases | Source of failure | Finding |
| ---: | --- | --- |
| 1 | Unknown server business-code text is returned in diagnostic notes. | P1-01 |
| 1 | Labeled synthetic student identifier reaches assignments.json, assignments.md and deadlines.ics. | P1-02 |
| 5 | Simulated browser download receives executable or active-document suffixes from inert fixtures. | P1-03 |
| 1 | Loader accepts null and invalid prototype-shaped index records. | P2-01 |

The artifact version issue is verified by inspection of the built files. [SECURITY_REVIEW.md](SECURITY_REVIEW.md) contains the source locations, targeted test filters and remediation.

## Remaining acceptance work

1. Fix each P1 and rerun all four npm commands. Verify the corrected archive filename, packaged MV3 version, display version and approved permissions.
2. Run the unpacked extension in authorized Chrome and Edge sessions. Check first-run permissions, resource and AI views, light and dark themes, single and batch saves, progress, cancellation and failure recovery, then verify the v0.1 board, clipboard and calendar paths.
3. Use an authorized test account and representative courses to check the card, chapter, slide and announcement response families, signed CDN assets, controlled redirects and CORS failure behavior. Preserve experimental labels until each claimed endpoint has live evidence. Local tests assert metadata that identifies only the legacy Changjiang course list and learn-log routes as historically verified.
4. Verify real storage isolation and concurrent writes, account switching, large-batch memory, Windows archive extraction, PDF page readability and the NotebookLM-friendly subset with user-provided or Demo material. Capture real browser evidence if needed for sign-off.

**Disposition** The implementation passes typecheck, build and packaging commands. Tests and artifact identity fail the v0.2.0-beta release gate.
