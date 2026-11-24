export interface EndpointCandidate {
  label: string;
  path: string;
}

export const courseEndpoints: EndpointCandidate[] = [
  { label: '/v2/api/web/courses/list', path: '/v2/api/web/courses/list?identity=2' },
  { label: '/mooc-api/v1/lms/user/user-courses/', path: '/mooc-api/v1/lms/user/user-courses/?status=1&page=1&page_size=50' },
];

export function taskEndpoints(classroomId: string, courseId: string): EndpointCandidate[] {
  return [
    { label: '/v2/api/web/logs/learn/{classroom_id}', path: `/v2/api/web/logs/learn/${encodeURIComponent(classroomId)}?actype=-1&page=0&offset=50&sort=-1` },
    { label: '/v2/api/web/courses/{classroom_id}/homework', path: `/v2/api/web/courses/${encodeURIComponent(classroomId)}/homework` },
    { label: '/c27/online_courseware/xty/kls/pub_news/{course_id}/', path: `/c27/online_courseware/xty/kls/pub_news/${encodeURIComponent(courseId)}/` },
  ];
}
