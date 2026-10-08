import { useQuery } from '@tanstack/react-query';
import { ENDPOINTS, url } from './api/endpoints';
import { AnomalyRowSchema, NotificationCountSchema, cursorPage } from '@fleet/shared';
import { api } from './services';
import { BADGE_PAGE_SIZE } from './core/policy';

/**
 * B-08 (needs confirmation): the backend exposes no count endpoints, so a badge is the size of the
 * first page (limit 50) with a trailing "+" whenever `has_more` is true. Every list here is a cursor
 * page; there is no offset anywhere.
 */
export function useBadgeCounts() {
  // The anomalies badge is still a page-size bound: there is no anomaly-count endpoint, and
  // `GET /reports/analytics` (which has `anomalies_open`) needs `report:read`, which a driver lacks.
  const anomalies = useQuery({
    queryKey: ['anomalies', 'count'],
    queryFn: () => api.get(url(ENDPOINTS.anomalies), { query: { limit: BADGE_PAGE_SIZE }, schema: cursorPage(AnomalyRowSchema) }),
    staleTime: 30_000,
    gcTime: 300_000,
  });
  // S-08 resolved: `GET /notifications/count` is a real count, not a page-size lower bound. Its UNREAD
  // predicate matches the gateway's own snapshot filter, so the badge and the inbox agree by construction.
  const notes = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: () => api.get(url(ENDPOINTS.notificationCount), { schema: NotificationCountSchema }),
    staleTime: 30_000,
    gcTime: 300_000,
  });
  return {
    anomalies: anomalies.data?.data.length ?? 0,
    anomaliesMore: !!anomalies.data?.has_more,
    unread: notes.data?.unread ?? 0,
  };
}