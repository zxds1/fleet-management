import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View, type RefreshControlProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, space } from './tokens';
import { OfflineTag } from './states';

/** The one page container: safe-area padding, keyboard avoidance, consistent spacing, optional pull-to-refresh and offline tag. */
export function Screen({ children, refreshControl, offlineTag = false, center = false, padded = true, testID }: { children: React.ReactNode; refreshControl?: React.ReactElement<RefreshControlProps>; offlineTag?: boolean; center?: boolean; padded?: boolean; testID?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView testID={testID} style={{ flex: 1, backgroundColor: color.dust }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView refreshControl={refreshControl} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: padded ? space.md : 0, paddingBottom: (padded ? space.md : 0) + insets.bottom, gap: space.md, flexGrow: 1, justifyContent: center ? 'center' : 'flex-start' }}>
        {offlineTag ? <OfflineTag /> : null}{children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
/** A non-scrolling column for screens that host their own FlatList. */
export const Column = ({ children }: { children: React.ReactNode }) => <View style={{ flex: 1, backgroundColor: color.dust }}>{children}</View>;
