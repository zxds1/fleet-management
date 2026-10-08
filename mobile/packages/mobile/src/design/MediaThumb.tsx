import React from 'react';
import { ENDPOINTS, url } from '../api/endpoints';
import { Pressable, View } from 'react-native';
import { Text } from './Text';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../services';
import { color, font, radius, space } from './tokens';

/**
 * E-06 resolved: there is no `{ url }` JSON body anywhere. `GET /media/{id}` answers 302 to a
 * short-lived presigned GET, so the reader follows the redirect once with the bearer token and hands
 * the object-storage URL to the image loader. The token never reaches the image request.
 */
export function MediaThumb({ mediaId, label, height = 180 }: { mediaId: string | null | undefined; label?: string; height?: number }) {
  const { t } = useTranslation();
  const [big, setBig] = React.useState(false);
  const q = useQuery({
    queryKey: ['media-url', mediaId],
    enabled: !!mediaId,
    queryFn: () => api.resolveMediaUrl(url(ENDPOINTS.mediaObject, { id: mediaId ?? '' })),
    staleTime: 4 * 60_000,
    gcTime: 5 * 60_000,
  });
  if (!mediaId) return <View style={{ height: 56, justifyContent: 'center' }}><Text style={{ fontFamily: font.body, color: color.mist }}>{t('detail.noPhoto')}</Text></View>;
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={label ?? t('detail.photo')} onPress={() => setBig((b) => !b)} style={{ gap: space.xs }}>
      {label ? <Text style={{ fontFamily: font.bodyStrong, color: color.asphalt }}>{label}</Text> : null}
      <Image source={q.data ? { uri: q.data } : undefined} style={{ width: '100%', height: big ? 420 : height, borderRadius: radius.control, backgroundColor: color.line }} contentFit={big ? 'contain' : 'cover'} cachePolicy="disk" transition={150} />
    </Pressable>
  );
}