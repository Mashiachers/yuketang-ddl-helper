export * from './endpoints';
export {
  stripHtmlToText,
  sanitizeResourceUrl,
  buildMaterialKey,
  sanitizeMetadata,
  normalizeResourceCourses,
  normalizeCourseMaterials,
  normalizeSlidePages,
  normalizeAnnouncements,
  mapHomeworkToDomain,
  fetchWithTimeoutAndRetry,
  discoverCourseResources,
  type ResourceDiscoveryOptions,
  type FetchJsonResult,
  type FetchWithRetryOptions,
} from './adapter';
export * from './naming';
export * from './zip';
export * from './pdf';
export * from './indexStore';
export * from './downloadService';
export * from './exportService';
export * from './resourceService';
export * from './demoResources';
