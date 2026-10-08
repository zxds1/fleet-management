import React from 'react';
import { FlatList, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppError } from '@fleet/shared';
import { Button, EmptyState, ErrorState } from './components';
import { OfflineTag, Skeleton } from './states';
import { color, space } from './tokens';

export interface CursorListLike<T> { items: T[]; isLoading: boolean; isRefetching: boolean; isFetchingNextPage?: boolean; error: unknown; refetch: () => unknown; hasNextPage?: boolean; fetchNextPage: () => unknown }

/**
 * The one list used by every cursor-paginated screen: skeleton while loading, error with a working action, empty state,
 * offline tag on cached rows, pull-to-refresh, and infinite scroll (loads the next page near the end; a button remains for screen-reader users).
 */
export function PagedList<T>({ list, render, keyOf, empty, header, emptyAction }: { list: CursorListLike<T>; render: (item: T) => React.ReactElement; keyOf: (item: T) => string; empty: string; header?: React.ReactElement; emptyAction?: { label: string; onPress: () => void } }) {
  const { t } = useTranslation();
  if (list.isLoading && !list.items.length) return <View style={{ flex: 1, backgroundColor: color.dust, padding: space.md, gap: space.md }}>{header}<Skeleton /></View>;
  return (
    <FlatList
      style={{ backgroundColor: color.dust }} contentContainerStyle={{ padding: space.md, gap: space.md, flexGrow: 1 }} data={list.items} keyExtractor={keyOf} renderItem={({ item }) => render(item)}
      onRefresh={() => void list.refetch()} refreshing={list.isRefetching && !list.isFetchingNextPage} onEndReachedThreshold={0.6} onEndReached={() => { if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage(); }}
      initialNumToRender={10} windowSize={7} removeClippedSubviews
      ListHeaderComponent={<View style={{ gap: space.sm }}>{header}<OfflineTag show={list.items.length > 0} /></View>}
      ListEmptyComponent={list.error ? <ErrorState code={list.error instanceof AppError ? list.error.error_code : 'UNKNOWN'} onAction={() => void list.refetch()} /> : <EmptyState text={empty} actionLabel={emptyAction?.label} onAction={emptyAction?.onPress} />}
      ListFooterComponent={list.hasNextPage ? <Button tone="quiet" label={t('admin.loadMore')} onPress={() => void list.fetchNextPage()} busy={list.isFetchingNextPage} /> : null}
    />
  );
}
