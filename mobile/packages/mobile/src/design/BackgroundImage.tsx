import React from 'react';
import { Image, type ImageSourcePropType, StyleSheet, View } from 'react-native';
import { color } from './tokens';

type Props = {
  source: ImageSourcePropType;
  children?: React.ReactNode;
  testID?: string;
};

export function BackgroundImage({ source, children, testID }: Props) {
  return (
    <View testID={testID} style={styles.root}>
      <Image source={source} style={styles.image} resizeMode="cover" />
      <View style={styles.overlay} />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  image: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
  overlay: { position: 'absolute', inset: 0, backgroundColor: color.asphalt, opacity: 0.55 },
  content: { flex: 1 },
});
