import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useStore } from '../state/observable-store';
import { displayVersion, installUpdate, type UpdateState, updateStore } from '../updates/app-updates';
import { Action, Text } from './controls';
import { radius, space, useColors } from './theme';

export function updateActionLabel(): string {
  return 'Update and restart';
}

function headline(update: UpdateState): string {
  if (update.status === 'installing') {
    return 'Installing update';
  }
  const version = (update.status === 'available' || update.status === 'failed') && update.version ? update.version : '';
  return `Koto ${displayVersion(version)} is available`;
}

/** Sidebar card shown only while an update is waiting, installing, or failed to install. */
export function UpdateNotice() {
  const colors = useColors();
  const update = useStore(updateStore);

  if (update.status !== 'available' && update.status !== 'installing' && !(update.status === 'failed' && update.version)) {
    return null;
  }

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.card, { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderDefault }]}
    >
      <Text variant="label">{headline(update)}</Text>
      {update.status === 'installing' ? (
        <Text tone="secondary" style={styles.body}>
          Koto will close and reopen in a moment.
        </Text>
      ) : update.status === 'failed' ? (
        <Text tone="error" style={styles.body}>
          {update.message}
        </Text>
      ) : update.notes ? (
        <Text tone="secondary" style={styles.body} numberOfLines={3}>
          {update.notes}
        </Text>
      ) : null}
      {update.status !== 'installing' ? (
        <Action label={updateActionLabel()} variant="primary" onPress={() => void installUpdate()} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.sm },
  body: { fontSize: 14, lineHeight: 20 },
});
