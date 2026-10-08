import React from 'react';
import { ENDPOINTS, url } from '../../api/endpoints';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AccidentRowSchema } from '@fleet/shared';
import { useCursorList } from '../../core/lists';
import { fmtDateTime } from '../../format';
import { Body, Card } from '../../design/components';
import { PagedList } from '../../design/PagedList';
import { Text } from '../../design/Text';
import { color, font } from '../../design/tokens';

export function AccidentsScreen({ navigation }: any) {
  // E-16 resolved: there is no tenant-wide `GET /accidents`. The one list endpoint takes `ownScope`;
  // `ownScope=false` makes the backend drop the driver filter and return every accident in the tenant
  // (`packages/api/src/http/routes/accidents.ts`). A driver omits it and sees only their own.
  const { t } = useTranslation();
  const l = useCursorList(['accidents'], url(ENDPOINTS.myAccidents), AccidentRowSchema, { ownScope: false }, { staleTime: 30_000 });
  return <PagedList list={l} keyOf={(a) => a.accident_id} empty={t('admin.emptyAccidents')} render={(a) => (
    <Pressable accessibilityRole="button" onPress={() => navigation.navigate('AccidentDetail', { item: a })}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>{a.mayday ? <Text style={{ fontFamily: font.heading, color: color.brake }}>{t('admin.mayday')}</Text> : <View />}{a.escalation_tier != null ? <Text style={{ fontFamily: font.bodyStrong, color: color.asphalt }}>{t('detail.tierShort', { n: a.escalation_tier })}</Text> : null}</View>
        {a.occurred_at ? <Body dim>{fmtDateTime(a.occurred_at)}</Body> : null}<Body>{a.acknowledged_at ? t('detail.acked') : t('detail.notAcked')}</Body>
      </Card>
    </Pressable>)} />;
}
