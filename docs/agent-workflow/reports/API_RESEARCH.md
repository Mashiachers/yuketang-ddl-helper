# Yuketang Read-Only Resource API Research Report (`v0.2.0-beta`)

- **Author**: Agent A (API Research & Platform Adapter)
- **Date**: 2026-11-24
- **Scope**: Read-only course, chapter, slide, courseware attachment, announcement, and assignment/exam discovery APIs across Yuketang (`*.yuketang.cn`) branches.
- **Compliance Boundary**: Strictly read-only student access to authorized course metadata and downloadable resources. No auto-attendance, auto-answering, auto-submission, video farming, DRM bypass, or third-party data exfiltration.

---

## 1. Evidence Classification Policy

To prevent fabricating API behavior, every finding in this report is classified into one of three tiers:

1. **Live-Verified (This Project, v0.1)**: Directly observed against a real authenticated Changjiang Yuketang (`changjiang.yuketang.cn`) session during v0.1 development. Marked `experimental: false` in `RESOURCE_ENDPOINT_SPECS`.
2. **OSS-Audited / Unverified Live Here**: Directly verified in the public source code or engineering documentation of open-source projects audited below, but **not** yet executed against a live authenticated session during this v0.2 development pass. Marked `experimental: true` in `RESOURCE_ENDPOINT_SPECS` per **ADR-004**.
3. **Mock / Fixture-Tested**: Exercised by automated Vitest unit tests using sanitized synthetic payloads in `tests/fixtures/yuketang-resources.ts`.

---

## 2. Open-Source Reference Audit

### 2.1 `powercess/yuketang-mcp`

- **URL**: `https://github.com/powercess/yuketang-mcp`
- **Last Pushed (audited)**: `2026-10-26`
- **License**: **MIT License** (`spdx_id: MIT`, verified via GitHub API and `README.md`)
- **Purpose**: Read-only Node/Bun MCP server exposing Yuketang web student portal capabilities (`ykt_courses`, `ykt_classroom`, `ykt_activities`, `ykt_lesson`, `ykt_slides`, `ykt_lesson_summary`, `ykt_replay_timeline`, `ykt_mind_map`, `ykt_notes`, `ykt_score`, `ykt_course_progress`, `ykt_live`, `ykt_discussion`). Explicitly prohibits side-effect operations (check-in, answering, danmaku).
- **Audited Source Files**: `src/api.ts`, `src/client.ts`, `README.md`
- **Key Technical Findings**:
  1. **Four Regional Hosts (Non-Interchangeable Sessions)**:
     - `standard` → `www.yuketang.cn`
     - `hetang` → `pro.yuketang.cn`
     - `changjiang` → `changjiang.yuketang.cn`
     - `huanghe` → `huanghe.yuketang.cn`
     - Session cookies (`sessionid`) are strictly isolated per regional host.
  2. **Headers**:
     - `xtbz: ykt` is **required** for `/c27/*` and `/mooc-api/*` endpoints (missing it produces business code `40000`; sending `xtbz: cloud` produces `80005` on `/mooc-api/*`), and harmless on other endpoints.
  3. **Three Response Status Envelopes**:
     - Yuketang backends are not uniform; responses use one of three mutually exclusive status families:
       - `code === 0` (or `'0'`)
       - `errcode === 0` (or `'0'`)
       - `success === true` (with `error_code` / `sub_code` on failure)
     - Platform business error codes are 5-digit integers (not HTTP status codes):
       - `50000`, `401002`, `10005`: Session expired / unauthorized (do not retry; require login)
       - `40000`: Missing `xtbz: ykt` header
       - `80005`: Wrong `xtbz` value on `/mooc-api/*`
       - `80019`: Deprecated `/mooc-api/v1/lms/learn/course/chapter` rejected → use `/c27/online_courseware/schedule/course/progress/` instead
       - `20007`, `20009`: Resource not readable with current student role
       - `50401`: Query parameter naming mismatch (e.g., `liveId` camelCase vs `live_id` snake_case)
  4. **Learn-Log Pagination Quirk**:
     - Endpoint: `/v2/api/web/logs/learn/{classroom_id}?actype=-1&page={page}&offset={size}&sort=-1`
     - `page` is **0-based**; `offset` is **page size** (1–200), NOT an item skip offset.
     - `has_more` is documented as unreliable (can report `true` when already exhausted); termination should check `activities.length < size` (combined with duplicate-page and `maxPages` guards).
  5. **Endpoint Generation Findings**:
     - **Slides**: `/api/v3/lesson-summary/student/presentation?presentation_id=...&lesson_id=...` returns full `slides[]` with `index` (1-based) and `cover` image URL. Supersedes `/api/v3/lesson/presentation/fetch` (returns HTTP 401 after class ends) and `/api/v3/classroom-report/student/ppt` (`visible` field is always `true`).
     - **Chapters**: `/c27/online_courseware/schedule/course/progress/?classroom_id=...&course_id=...` returns `course_progress[].section_leaf_list[]` with `name`, `id`, `leaf_type`, `is_locked`, `score_deadline`, and `progress`, avoiding `80019` on `/mooc-api/v1/lms/learn/course/chapter`.
     - **Announcements**: `/v/discussion/v2/announcements/?cid={classroom_id}&limit=20&offset=0&type=9` returns announcement records under `data.data`.
     - **Slide Image CDN**: Slide `cover` URLs are reported as downloadable via HTTP without sending Yuketang cookies (though browser extension `fetch()` remains subject to CDN CORS headers).

### 2.2 `siye4366/xxt-Tool`

- **URL**: `https://github.com/siye4366/xxt-Tool`
- **Last Pushed (audited)**: `2026-11-17`
- **License**: **MIT License** (`spdx_id: MIT`, verified via GitHub API)
- **Purpose**: Lightweight Android dashboard for Chaoxing (学习通) and Yuketang homework/exam deadlines and course schedules.
- **Audited Source Files**: `app/src/main/java/com/xxkg/board/YtApi.kt`, `README.md`
- **Key Technical Findings**:
  1. **Host & Headers**: Defaults to `www.yuketang.cn`, follows user's selected regional host after login; sends `Cookie`, `xtbz: ykt`, `X-CSRFToken` (from `csrftoken` cookie), `Referer`, and `classroom-id` (specifically required on `/mooc-api/v1/lms/learn/leaf_info/...`).
  2. **Activity Types in `/v2/api/web/logs/learn/{classroom_id}`**:
     - `type = 5`: Exercise / exam with `status` (`0/1` pending, `2` submitted, `3` graded), `score`, `total_score`, `deadline`.
     - `type = 19`: Courseware homework with nested `content.leaf_id` and `content.score_d` (deadline). Submission/grading status is checked via `/mooc-api/v1/lms/learn/leaf_info/{classroom_id}/{leaf_id}/` (`data.is_assessed`).
  3. **Safe Course Fallback URL**:
     - Confirms `courseware_id` from learn logs does **not** match direct activity web routes (interpolating it yields "资源已删除"); linking to `/v2/web/studentLog/{classroom_id}` is the reliable fallback.
  4. **Classroom End-Time & Upcoming Exam Disambiguation**:
     - `/v2/api/web/classrooms/{classroom_id}?role=5` provides `data.class_end` (course end time).
     - `/api/v3/classroom/on-lesson-upcoming-exam` returns `data.upcomingExam[]` (`classroom_id`, `title`) used to distinguish exams from quizzes.
  5. **Deduplication Caveat**:
     - Learn logs can return duplicate entries within the same classroom; deduplication by stable key is necessary.

### 2.3 `OneTHU Docs` (`https://onethu.github.io/docs/`)

- **URL**: `https://onethu.github.io/docs/`
- **Last Updated (audited)**: `2026-11-18` (OneTHU 0.11 series)
- **License**: **OneTHU Custom Noncommercial License** (verified via `https://onethu.github.io/docs/license/`). Prohibits commercial use and mandates attribution when reusing code; upstream dependencies include LearnX (MIT with Tsinghua-affiliation restriction) and THU Info (BSL 1.1 / MIT).
  - **Compliance Note for Yuketang DDL Helper**: Because OneTHU uses a non-commercial custom license, **zero code is copied** from OneTHU into this repository. Only publicly documented behavioral observations and troubleshooting lessons are referenced.
- **Target Yuketang Branch**: `https://pro.yuketang.cn` (Hetang / Tsinghua).
- **Audited Pages**: `/docs/license/`, `/docs/external-homework/`, `/docs/reviews/2026-10-26-yuketang-agent-access/`, `/docs/reviews/2026-10-26-rain-wechat-recovery/`.
- **Key Engineering & Reliability Lessons**:
  1. **Pagination Safety**: Multi-page learn-log reads (>200 items) must deduplicate overlapping activities across pages and detect **duplicate-page loops** (if a subsequent page returns the same items as an earlier page, stop immediately and flag incomplete rather than looping).
  2. **Zero Deadline Trap**: `deadline = 0` must be normalized to `null` (no deadline), never rendered as `1970-01-01`.
  3. **Session Expiration & HTTP 200 HTML Login Trap**:
     - On `pro.yuketang.cn`, endpoints may require `sessionid` and `uv_id` cookies.
     - Expired sessions can return HTTP `401`/`403`, redirects, or HTTP `200` with a login HTML page instead of JSON. Clients must detect non-JSON / auth failures and never silently mask an expired session as valid empty/stale data.
  4. **Untrusted Rich Content & Obfuscated Assets**:
     - Exercise/announcement HTML may contain custom obfuscated fonts (`exam_font_<hash>.ttf`), LaTeX formulas, and cookie-gated images. For read-only metadata/AI export, safely stripping HTML to plain text (without DOM execution) avoids XSS and broken font rendering.
  5. **Read-Only Reference Endpoints Noted**:
     - `/v/exam/cover` (exam submission status)
     - `get_exercise_list` (`status: 3 | 4` for graded)
     - Student detail path `/ai-workspace/lms-graph/...`

---

## 3. Yuketang Branch Compatibility Matrix

| Branch | Hostname | `PlatformInfo.variant` | Session Isolation | Known API Quirks |
| :--- | :--- | :--- | :--- | :--- |
| **Changjiang (长江雨课堂)** | `changjiang.yuketang.cn` | `changjiang` | Isolated | v0.1 live-verified for `/v2/api/web/courses/list` and `/v2/api/web/logs/learn/{classroom_id}` (page 0). Requires `xtbz: ykt` on `/c27/*` and `/mooc-api/*`. |
| **Main / Standard (雨课堂)** | `www.yuketang.cn` / `yuketang.cn` | `main` | Isolated | Used as default in `powercess/yuketang-mcp` and `siye4366/xxt-Tool`; supports `/v2/api/web/*`, `/api/v3/*`, `/c27/*`, `/v/discussion/v2/*`. |
| **Hetang / Pro (荷塘雨课堂)** | `pro.yuketang.cn` | `hetang` | Isolated | Audited via OneTHU & `powercess/yuketang-mcp`. Often requires `sessionid` + `uv_id` cookies; `/mooc-api/.../course/chapter` may return `80019` (use `/c27/.../course/progress/`). |
| **Huanghe (黄河雨课堂)** | `huanghe.yuketang.cn` | `huanghe` | Isolated | Listed in `powercess/yuketang-mcp` regional table; shares `/v2/api/web/*` & `/api/v3/*` schema, unverified live in this project. |
| **Custom University Subdomains** | `*.yuketang.cn` | `custom` | Isolated | Campus-branded deployments (e.g., `*.yuketang.cn`) vary between `/v2/api/web/*`, `/mooc-api/*`, and `/c27/*`; fallback probing + sanitized diagnostics are essential. |

---

## 4. Verified vs. Experimental Endpoint Table

> Per **ADR-004**, every endpoint not directly verified against a live Yuketang session in this repository is explicitly tagged `experimental: true` in `src/core/resources/endpoints.ts`.

| Spec ID | Endpoint Path Template | Scope | Live-Verified in This Repo | `experimental` | Source / Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `courses-v2-list` | `/v2/api/web/courses/list?identity=2` | `courses` | Yes (`changjiang.yuketang.cn`, v0.1) | **`false`** | v0.1 baseline; confirmed in `powercess/yuketang-mcp` & `siye4366/xxt-Tool`. |
| `courses-mooc-user` | `/mooc-api/v1/lms/user/user-courses/?status=1&page=1&page_size=50` | `courses` | No | **`true`** | v0.1 fallback candidate for MOOC/campus deployments; requires `xtbz: ykt`. |
| `classroom-detail-v2` | `/v2/api/web/classrooms/{classroom_id}?role=5` | `courses` | No | **`true`** | OSS-audited (`powercess/yuketang-mcp`, `siye4366/xxt-Tool`); exposes `course_id`, `free_sku_id`, `uv_id`, `class_end`. |
| `learn-logs-v2` | `/v2/api/web/logs/learn/{classroom_id}?actype=-1&page={p}&offset={n}&sort=-1` | `materials` | Yes (`changjiang.yuketang.cn`, v0.1 page 0) | **`false`** | v0.1 baseline for activity logs. Multi-page pagination (`page >= 1`) & non-homework material extraction audited via OSS and unit-tested with fixtures. |
| `course-progress-c27` | `/c27/online_courseware/schedule/course/progress/?classroom_id={classroom_id}&course_id={course_id}` | `chapters` | No | **`true`** | OSS-audited (`powercess/yuketang-mcp`); preferred chapter/leaf tree (`course_progress[].section_leaf_list[]`), requires `xtbz: ykt`. |
| `course-chapter-mooc` | `/mooc-api/v1/lms/learn/course/chapter?cid={course_id}&classroom_id={classroom_id}` | `chapters` | No | **`true`** | Fallback chapter tree; known to return business code `80019` on newer branches, requires `xtbz: ykt`. |
| `courseware-pub-news` | `/c27/online_courseware/xty/kls/pub_news/{course_id}/` | `materials` | No | **`true`** | v0.1 legacy fallback candidate; requires `xtbz: ykt`. |
| `leaf-info-mooc` | `/mooc-api/v1/lms/learn/leaf_info/{classroom_id}/{leaf_id}/` | `materials` | No | **`true`** | OSS-audited (`siye4366/xxt-Tool`); requires `xtbz: ykt` + `classroom-id` header. |
| `lesson-summary-v3` | `/api/v3/lesson-summary/student?lesson_id={lesson_id}` | `slides` | No | **`true`** | OSS-audited (`powercess/yuketang-mcp`); returns `presentations[]` list (`id`, `title`, `cover`, `slidesCount`). |
| `lesson-presentation-v3` | `/api/v3/lesson-summary/student/presentation?presentation_id={presentation_id}&lesson_id={lesson_id}` | `slides` | No | **`true`** | OSS-audited (`powercess/yuketang-mcp`); returns ordered `slides[]` with `index` and `cover` image URLs. |
| `cards-detlist-v2` | `/v2/api/web/cards/detlist/{courseware_id}?classroom_id={classroom_id}` | `slides` | No | **`true`** | Publicly documented v2 courseware card/slide detail endpoint; unverified live here. |
| `discussion-announcements-v2` | `/v/discussion/v2/announcements/?cid={classroom_id}&limit=20&offset=0&type=9` | `announcements` | No | **`true`** | OSS-audited (`powercess/yuketang-mcp`); course announcements under `data.data`. |
| `course-homework-v2` | `/v2/api/web/courses/{classroom_id}/homework` | `materials` | No | **`true`** | v0.1 fallback candidate for legacy course homework/attachments. |

---

## 5. Known Technical Limitations & Risk Mitigations

### 5.1 Pagination & Loop Safety
- `/v2/api/web/logs/learn/{classroom_id}` uses `page` (0-based) and `offset` (page size, NOT skip offset).
- Server `has_more` flags can be inaccurate; therefore `adapter.ts` terminates pagination when ANY of the following holds:
  1. Returned row count `< pageSize` (or `0`),
  2. Current page produces the exact same activity ID signature as an already-seen page (duplicate-page guard),
  3. `page + 1 >= maxPages` (configurable safety cap, default `5`).

### 5.2 Signed CDN URLs, Expiration & CORS
- Yuketang slide covers and downloadable attachments are frequently hosted on external object-storage CDNs (e.g., Qiniu / Tencent COS / Alibaba OSS / `*.xuetangx.com` / `*.yuketang.cn` CDN subdomains).
- **Expiration**: Signed download URLs may contain short-lived query signatures (`e`, `token`, `Expires`, `Signature`). Stored `DownloadRecord` objects MUST NOT cache secrets/tokens in metadata and users should re-sync before downloading if a signed URL expires (`401`/`403`).
- **CORS in Browser Extensions**: Because `public/manifest.json` intentionally restricts `host_permissions` to `["https://*.yuketang.cn/*"]` (**ADR-001**), `fetch()` against a third-party CDN without `Access-Control-Allow-Origin` will fail with a CORS/TypeError. The download pipeline classifies this honestly as `cors-blocked` rather than requesting `<all_urls>` or fabricating success.
- **URL Validation**: `sanitizeResourceUrl` permits external `https:` URLs only for explicit media/download assets (`allowExternalHttps: true`), while strictly rejecting `javascript:`, `data:`, `file:`, plaintext external `http:`, control characters, and embedded `user:pass@` credentials.

### 5.3 Error Handling & Non-Retryable Failures
- Retries in `fetchWithTimeoutAndRetry` are strictly bounded (`maxRetries`, default `2`) and restricted to transient failures: network errors, request timeouts, HTTP `429`, and HTTP `5xx`.
- Auth failures (`401`, `403`, `opaqueredirect`, HTTP 200 HTML login page, business auth codes `50000`/`401002`/`10005`), `404`, other `4xx`, invalid JSON, and `AbortSignal` cancellations are **never retried**.

### 5.4 Privacy, Diagnostics & Prompt-Injection Defense
- Every `ResourceEndpointDiagnostic` uses only templated endpoint labels (e.g., `/v2/api/web/logs/learn/{classroom_id}`) — never real `classroomId`, `courseId`, `lessonId`, `Cookie`, `csrftoken`, `sessionid`, or raw API payloads.
- All announcement bodies, course descriptions, and titles pass through pure-TS `stripHtmlToText` (zero DOM `innerHTML` usage) before entering domain objects.
- `CourseMaterial.metadata` uses an allowlist + sensitive-key/value denylist so credentials/tokens can never enter exported JSON or Markdown.
