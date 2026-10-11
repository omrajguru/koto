import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, useColorScheme, View } from 'react-native';
import { activityStore } from '../dictation/dictation-service';
import { connectionStore } from '../storage/server-connection';
import { useStore } from '../state/observable-store';
import { LOGOMARK_ON_DARK, LOGOMARK_ON_LIGHT } from './assets/logomarks';
import { Text } from './controls';
import { DictionaryScreen } from './screens/dictionary-screen';
import { HistoryScreen } from './screens/history-screen';
import { SettingsScreen } from './screens/settings-screen';
import { SetupScreen } from './server-settings';
import { MINIMUM_HIT_SIZE, radius, space, useColors } from './theme';
import { UpdateNotice } from './update-notice';

type Section = 'history' | 'dictionary' | 'settings';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'history', label: 'History' },
  { id: 'dictionary', label: 'Dictionary' },
  { id: 'settings', label: 'Settings' },
];


function BrandMark() {
  const isLight = useColorScheme() === 'light';
  return <Image source={{ uri: isLight ? LOGOMARK_ON_LIGHT : LOGOMARK_ON_DARK }} style={styles.brandMark} accessibilityIgnoresInvertColors />;
}

function ActivityIndicator() {
  const activity = useStore(activityStore);
  const label =
    activity.phase !== 'idle'
      ? 'Listening'
      : activity.processingCount > 0
        ? 'Transcribing'
        : 'Ready';
  return (
    <Text variant="mono" tone={label === 'Ready' ? 'tertiary' : 'accent'} accessibilityLiveRegion="polite">
      {label}
    </Text>
  );
}

export function AppShell() {
  const colors = useColors();
  const connection = useStore(connectionStore);
  const [section, setSection] = useState<Section>('history');

  if (connection.status === 'loading') {
    return <View style={[styles.root, { backgroundColor: colors.backgroundPrimary }]} />;
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.backgroundPrimary }]}>
      <View accessibilityRole="menubar" style={[styles.sidebar, { borderRightColor: colors.borderSubtle }]}>
        <View style={styles.identity}>
          <View style={styles.wordmark}>
            <BrandMark />
            <Text variant="heading">Koto</Text>
          </View>
          <ActivityIndicator />
        </View>
        {connection.status === 'ready'
          ? SECTIONS.map(item => {
              const isActive = item.id === section;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: isActive }}
                  onPress={() => setSection(item.id)}
                  style={({ pressed }) => [
                    styles.navigationItem,
                    { backgroundColor: isActive || pressed ? colors.backgroundTertiary : 'transparent' },
                  ]}
                >
                  <Text variant="label" tone={isActive ? 'primary' : 'secondary'}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })
          : null}
        <View style={styles.sidebarFooter}>
          <UpdateNotice />
        </View>
      </View>
      <View style={styles.main}>
        {connection.status === 'notSetUp' ? (
          <SetupScreen />
        ) : section === 'history' ? (
          <HistoryScreen />
        ) : section === 'dictionary' ? (
          <DictionaryScreen />
        ) : (
          <SettingsScreen />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  sidebar: { width: 220, paddingHorizontal: space.md, paddingTop: space.xl, gap: 2, borderRightWidth: StyleSheet.hairlineWidth },
  identity: { paddingHorizontal: 12, marginBottom: space.lg, gap: 2 },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // Artwork is 72 x 90; shown at a third of that, close to the heading's cap height.
  brandMark: { width: 16, height: 20 },
  navigationItem: { minHeight: MINIMUM_HIT_SIZE - 4, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.sm },
  sidebarFooter: { marginTop: 'auto', paddingBottom: space.md },
  main: { flex: 1 },
});
