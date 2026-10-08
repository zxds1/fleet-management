import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../services';
import { cursorPage } from '@fleet/shared';

/** Rule 8: cursor + limit + has_more only. Never offsets. */
export function useCursorList<T extends z.ZodTypeAny>(key: string[], path: string, item: T, params: Record<string, string | number | boolean | undefined> = {}, opts: { staleTime?: number; gcTime?: number } = {}) {
  const page = cursorPage(item);
  const q = useInfiniteQuery({
    queryKey: [...key, params], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get(path, { schema: page, query: { limit: 50, ...params, cursor: pageParam } }),
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined), placeholderData: keepPreviousData, ...opts,   // changing a filter keeps the old rows on screen until the new ones arrive (no flash of skeleton)
  });
  return { ...q, items: (q.data?.pages.flatMap((p) => p.data) ?? []) as z.infer<T>[] };
}
