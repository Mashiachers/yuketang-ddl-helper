# Frozen Data & Service Contracts (v0.2.0)

All TypeScript types are defined in `src/types/resources.ts` and re-exported from `src/types/index.ts`.
Agents A, B, C, and D MUST conform to these exact types without modifying `src/types/resources.ts` directly.

## 1. Schema Version
- `RESOURCE_SCHEMA_VERSION = '0.2.0'`
- Every exported JSON (`manifest.json`, `course.json`, `materials.json`, `assignments.json`, `context.json`, and stored `CourseResourceIndex`) MUST include `schemaVersion: RESOURCE_SCHEMA_VERSION`.

## 2. Stable Resource Keys & Deduplication
- Course material key: `buildMaterialKey(courseId, type, id)` → `${courseId}:${type}:${id}` (normalized, stable across syncs).
- Assignment / Exam / Announcement key: `${courseId}:${kind}:${id}`.
- Duplicate detection MUST NOT rely on filename alone: compare `resourceKey`, and when bytes are available compare SHA-256 `checksum` + `size` + `sourceUpdatedAt`.

## 3. Sensitive Data Exclusion Contract
The following keys/patterns MUST NEVER appear in any exported JSON, Markdown, diagnostic entry, or stored `DownloadRecord`:
- `cookie`, `csrftoken`, `sessionid`, `token`, `authorization`, `password`, `secret`, `jwt`, `auth`
- URLs with embedded credentials (`user:pass@host`) or non-`https:` / `http:` protocols (`javascript:`, `data:`, `file:`)

## 4. Agent Interface Contracts

### 4.1 Agent A Exports (`src/core/resources/endpoints.ts`, `src/core/resources/adapter.ts`)
- `RESOURCE_ENDPOINT_SPECS`: metadata list documenting every endpoint, its `scope`, `verifiedOn`, and `experimental: boolean`.
- `stripHtmlToText(raw: string): string`: safe pure-TS HTML tag/entity stripper (no DOM `innerHTML` execution!).
- `sanitizeResourceUrl(raw: unknown, origin: string, allowExternalHttps?: boolean): string | undefined`
- `buildMaterialKey(courseId: string, type: MaterialType, id: string): string`
- `discoverCourseResources(platform: PlatformInfo, options: ResourceDiscoveryOptions): Promise<ResourceDiscoveryResult>`
  - Options: `{ cookie?: string; fetchImpl?: typeof fetch; signal?: AbortSignal; courseIds?: string[]; maxPages?: number; timeoutMs?: number; maxRetries?: number; onProgress?: (completed: number, total: number) => void; existingCourses?: CourseInfo[]; existingHomework?: HomeworkItem[] }`
- Pure normalizers for direct unit testing:
  - `normalizeResourceCourses(input: unknown, platform: PlatformInfo): Course[]`
  - `normalizeCourseMaterials(input: unknown, course: Course, origin: string, options?: { experimental?: boolean; chapterId?: string; chapterTitle?: string }): CourseMaterial[]`
  - `normalizeSlidePages(input: unknown, origin: string): SlidePageAsset[]`
  - `normalizeAnnouncements(input: unknown, course: Course, origin: string): Announcement[]`
  - `mapHomeworkToDomain(items: readonly HomeworkItem[], platform: PlatformInfo): { assignments: Assignment[]; exams: Exam[] }`

### 4.2 Agent B Exports (`src/core/resources/`)
- `naming.ts`:
  - `sanitizeFilename(name: string, fallback?: string): string`
  - `sanitizePathSegment(segment: string, fallback?: string): string`
  - `deduplicateFilename(filename: string, usedNames: Set<string>): string`
  - `buildSafeRelativePath(segments: string[]): string` (rejects `..`, leading `/`, drive letters, NUL bytes, Windows reserved device names `CON`/`PRN`/`AUX`/`NUL`/`COM1`–`LPT9`)
- `zip.ts`:
  - `interface ZipEntryInput { path: string; data: Uint8Array | string; modifiedAt?: Date }`
  - `buildZipArchive(entries: readonly ZipEntryInput[]): Uint8Array`
  - `readZipEntryNames(zipBytes: Uint8Array): string[]` (lightweight test/inspection helper)
- `pdf.ts`:
  - `buildPdfFromJpegPages(pages: readonly { bytes: Uint8Array; width: number; height: number }[]): Uint8Array`
  - `mergeSlideImagesToPdf(images: readonly { bytes: Uint8Array; mimeType: string; width?: number; height?: number }[], converter?: SlideImageConverter): Promise<Uint8Array>`
- `indexStore.ts`:
  - `computeSha256Hex(bytes: Uint8Array): Promise<string>`
  - `loadResourceIndex(origin: string, sourcePlatform: string): Promise<CourseResourceIndex>`
  - `saveResourceIndex(index: CourseResourceIndex): Promise<void>`
  - `reconcileMaterialsWithIndex(materials: readonly CourseMaterial[], index: CourseResourceIndex): { materials: CourseMaterial[]; newCount: number; updatedCount: number }`
  - `recordDownloadOutcome(index: CourseResourceIndex, result: DownloadItemResult, nowIso?: string): CourseResourceIndex`
- `downloadService.ts`:
  - `createDownloadService(deps?: { fetchImpl?: typeof fetch; imageConverter?: SlideImageConverter })`
  - Methods: `downloadMaterial`, `downloadBatch`, `triggerBrowserDownload`
- `exportService.ts`:
  - `buildExportFiles(input: ExportBuildInput): Promise<{ files: ZipEntryInput[]; manifest: ExportManifest }>`
  - `exportAsZip(input: ExportBuildInput): Promise<{ zipBytes: Uint8Array; filename: string; manifest: ExportManifest }>`
  - `buildCourseReadmeMarkdown(...)`, `buildAiContextFiles(...)`, `buildNotebookLmFiles(...)`
- `resourceService.ts`:
  - `createResourceService(options)` implementing `CourseProvider` plus `syncResources`, `getUpcomingDeadlines`, `getSyncStatus`, `getChangesSince`.
- `demoResources.ts`:
  - `createDemoResourceDiscovery(now?: number, origin?: string): ResourceDiscoveryResult`
  - `createDemoFileBytes(material: CourseMaterial): { bytes: Uint8Array; mimeType: string }` (real valid minimal PDF/text/JPEG bytes so Demo Mode downloads & ZIP/PDF exports work end-to-end!)

### 4.3 Agent C Exports (`src/ui/`)
- `src/ui/hooks/useResourceCenter.ts`: manages resource discovery, course/type/search filters, selection, batch download progress/cancel/retry, and AI workflow exports.
- `src/ui/components/ResourceCenterPanel.tsx`: Course Resource Center tab UI.
- `src/ui/components/AiWorkflowPanel.tsx`: AI Workflow Center UI (knowledge base / NotebookLM / AI Context / JSON / Markdown export + integrated PromptPanel).
- `src/ui/components/DdlDrawer.tsx`: Clean 4-tab drawer navigation preserving all v0.1 behavior.
