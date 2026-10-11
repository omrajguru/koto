import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { dictationService } from '../../dictation/dictation-service';
import DesktopIntegration from '../../native/NativeDesktopIntegration';
import { type DictationRecord, historyStore, removeRecord } from '../../storage/dictation-history';
import { useStore } from '../../state/observable-store';
import { Action, Divider, Text } from '../controls';
import { space } from '../theme';

const STATUS_LABEL: Partial<Record<DictationRecord['status'], string>> = {
  transcribing: 'Transcribing',
  copied: 'On clipboard',
  saved: 'Not inserted',
  failed: 'Not transcribed',
  empty: 'No speech',
};

// Fixed names rather than Intl, which Hermes on Windows may not include.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CONFIRMATION_WINDOW_MS = 4000;

export function formatTime(iso: string): string {
  const date = new Date(iso);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const now = new Date();
  const isToday = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (isToday) {
    return `${hours}:${minutes}`;
  }
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${hours}:${minutes}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.max(1, Math.round(seconds))} s`;
  }
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

function DictationRow({ record }: { record: DictationRecord }) {
  const [copyLabel, setCopyLabel] = useState('Copy');
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const statusLabel = STATUS_LABEL[record.status];
  const canRetry = record.status === 'failed' && Boolean(record.audioPath);
  const text = record.text || record.rawTranscript;

  const copy = async () => {
    try {
      await DesktopIntegration.copyText(text);
      setCopyLabel('Copied');
    } catch {
      setCopyLabel('Clipboard busy, try again');
    }
    setTimeout(() => setCopyLabel('Copy'), 1600);
  };

  // Deleting removes the recording too. For untranscribed dictations that is the only copy, so confirm first.
  const requestDelete = () => {
    if (isConfirmingDelete) {
      void removeRecord(record.id);
      return;
    }
    setIsConfirmingDelete(true);
    setTimeout(() => setIsConfirmingDelete(false), CONFIRMATION_WINDOW_MS);
  };

  return (
    <View style={styles.row}>
      <View style={styles.rowMeta}>
        <Text variant="mono" tone="tertiary">
          {formatTime(record.createdAt)}
        </Text>
        <Text variant="mono" tone="tertiary">
          {formatDuration(record.durationSeconds)}
        </Text>
        {statusLabel ? (
          <Text variant="mono" tone={record.status === 'failed' ? 'error' : 'secondary'}>
            {statusLabel}
          </Text>
        ) : null}
        {record.unpolishedText ? (
          <Text variant="mono" tone="tertiary">
            Tidied by AI
          </Text>
        ) : null}
      </View>
      <View style={styles.rowBody}>
        {text ? <Text selectable>{text}</Text> : null}
        {record.failureReason ? <Text tone="secondary">{record.failureReason}</Text> : null}
        {/* A borderless first action is pulled left so its label lines up with the text above. */}
        <View style={[styles.rowActions, !canRetry && styles.rowActionsAlignedToText]}>
          {canRetry ? <Action label="Transcribe again" variant="secondary" onPress={() => void dictationService.retry(record.id)} /> : null}
          {text ? <Action label={copyLabel} variant="quiet" onPress={() => void copy()} /> : null}
          {record.unpolishedText ? (
            <Action label="Copy without AI" variant="quiet" onPress={() => void DesktopIntegration.copyText(record.unpolishedText ?? '')} />
          ) : null}
          <Action
            label={isConfirmingDelete ? (text ? 'Delete entry and recording' : 'Delete recording permanently') : 'Delete'}
            variant={isConfirmingDelete ? 'destructive' : 'quiet'}
            onPress={requestDelete}
          />
        </View>
      </View>
    </View>
  );
}

export function HistoryScreen() {
  const history = useStore(historyStore);

  // A plain ScrollView rather than FlatList: FlatList estimates the height of rows it has not
  // drawn, and on Windows the estimate left a long empty stretch to scroll through. History
  // holds at most 500 records, so drawing them all is cheap.
  return (
    <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text variant="title">Hold Ctrl + Win and speak</Text>
        <Text variant="lede" tone="secondary" style={styles.lede}>
          Release to insert the text where your cursor is. To dictate without holding, press Ctrl + Win twice, then
          press it once more (or click the orb) to finish. Esc cancels.
        </Text>
      </View>
      {history.length === 0 ? (
        <Text tone="secondary" style={styles.empty}>
          Nothing dictated yet. Every dictation is kept here, including ones that could not be inserted.
        </Text>
      ) : (
        history.map((record, index) => (
          <React.Fragment key={record.id}>
            {index > 0 ? <Divider /> : null}
            <DictationRow record={record} />
          </React.Fragment>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.xxl, paddingTop: space.xxl, paddingBottom: space.xxxl, maxWidth: 920 },
  header: { marginBottom: space.xl, gap: space.md },
  lede: { maxWidth: 620 },
  row: { flexDirection: 'row', gap: space.lg, paddingVertical: space.md },
  rowMeta: { width: 120, gap: 2, paddingTop: 2 },
  rowBody: { flex: 1, gap: space.sm },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  rowActionsAlignedToText: { marginLeft: -12 },
  empty: { marginTop: space.lg },
});
