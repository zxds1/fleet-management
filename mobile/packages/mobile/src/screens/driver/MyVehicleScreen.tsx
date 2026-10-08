import React from 'react';
import { View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { shiftActiveQuery, vehicleStatesQuery } from '../../queries';
import { Body, Card, EmptyState, StatusBadge } from '../../design/components';
import { OfflineTag, Skeleton } from '../../design/states';
import { color, space } from '../../design/tokens';
import { useUi } from '../../state/store';

export function MyVehicleScreen() {
  const { t } = useTranslation(); const socketUp = useUi((s) => s.socketUp);
  const shift = useQuery(shiftActiveQuery); const fleet = useQuery({ ...vehicleStatesQuery, refetchInterval: socketUp ? false : 15_000 });
  const mine = fleet.data?.vehicles.find((v) => v.vehicle_id === shift.data?.vehicle_id);
  if (shift.isLoading || fleet.isLoading) return <View style={{ padding: space.md }}><Skeleton rows={2} height={120} /></View>;
  if (!shift.data || !mine) return <EmptyState text={t('vehicle.none')} />;
  // U-10 resolved as far as the API allows: latitude/longitude are NULLABLE. A driver whose tracker has
  // not reported has no position, so there is no map to centre and no stale-marker timestamp to show.
  const hasFix = mine.latitude != null && mine.longitude != null;
  return (
    <View style={{ flex: 1 }}>
      <OfflineTag />{!socketUp ? <Card><Body dim>{t('vehicle.stale')}</Body></Card> : null}
      {!hasFix ? <Card><Body dim>{t('status.OFFLINE')}</Body></Card> : null}
      {hasFix ? <MapView style={{ flex: 1 }} region={{ latitude: mine.latitude as number, longitude: mine.longitude as number, latitudeDelta: 0.02, longitudeDelta: 0.02 }}><Marker coordinate={{ latitude: mine.latitude as number, longitude: mine.longitude as number }} /></MapView> : <View style={{ flex: 1 }} />}
      <View style={{ padding: space.md, backgroundColor: color.paper }}><StatusBadge state={mine.display_state} /></View>
    </View>);
}

