import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { MAX_VOCABULARY_TERMS, preferencesStore, updatePreferences } from '../../storage/preferences';
import { useStore } from '../../state/observable-store';
import { Action, Divider, Text, TextField } from '../controls';
import { radius, space, useColors } from '../theme';

export function DictionaryScreen() {
  const colors = useColors();
  const preferences = useStore(preferencesStore);
  const [term, setTerm] = useState('');
  const [spoken, setSpoken] = useState('');
  const [written, setWritten] = useState('');

  const isVocabularyFull = preferences.vocabulary.length >= MAX_VOCABULARY_TERMS;

  const addTerm = () => {
    const value = term.trim();
    if (!value || isVocabularyFull || preferences.vocabulary.includes(value)) {
      return;
    }
    void updatePreferences({ vocabulary: [...preferences.vocabulary, value] });
    setTerm('');
  };

  const addReplacement = () => {
    if (!spoken.trim() || !written.trim()) {
      return;
    }
    const others = preferences.replacements.filter(item => item.spoken.toLowerCase() !== spoken.trim().toLowerCase());
    void updatePreferences({ replacements: [...others, { spoken: spoken.trim(), written: written.trim() }] });
    setSpoken('');
    setWritten('');
  };

  return (
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <Text variant="title">Dictionary</Text>

      <View style={styles.section}>
        <Text variant="heading">Vocabulary</Text>
        <Text tone="secondary" style={styles.description}>
          Names, products and terms Koto should recognise and spell exactly as written here.
        </Text>
        <View style={styles.inlineForm}>
          <View style={styles.grow}>
            <TextField
              label="Word or phrase"
              placeholder="Sarvam"
              value={term}
              onChangeText={setTerm}
              onSubmitEditing={addTerm}
              maxLength={64}
            />
          </View>
          <Action label="Add word" variant="primary" isDisabled={!term.trim() || isVocabularyFull} onPress={addTerm} />
        </View>
        <Text variant="mono" tone="tertiary">
          {preferences.vocabulary.length} of {MAX_VOCABULARY_TERMS}
        </Text>
        <View style={styles.terms}>
          {preferences.vocabulary.map(item => (
            <View key={item} style={[styles.term, { borderColor: colors.borderDefault }]}>
              <Text>{item}</Text>
              <Action
                label="Remove"
                variant="quiet"
                accessibilityHint={`Removes ${item} from vocabulary`}
                onPress={() => void updatePreferences({ vocabulary: preferences.vocabulary.filter(value => value !== item) })}
              />
            </View>
          ))}
        </View>
      </View>

      <Divider />

      <View style={styles.section}>
        <Text variant="heading">Replacements</Text>
        <Text tone="secondary" style={styles.description}>
          When Koto hears the first phrase, it writes the second. Useful for words that are often misheard or that you
          want written a particular way.
        </Text>
        <View style={styles.inlineForm}>
          <View style={styles.grow}>
            <TextField label="When I say" placeholder="koto speech" value={spoken} onChangeText={setSpoken} />
          </View>
          <View style={styles.grow}>
            <TextField
              label="Write"
              placeholder="Koto Speech"
              value={written}
              onChangeText={setWritten}
              onSubmitEditing={addReplacement}
            />
          </View>
          <Action label="Add replacement" variant="primary" isDisabled={!spoken.trim() || !written.trim()} onPress={addReplacement} />
        </View>
        {preferences.replacements.map(item => (
          <View key={item.spoken} style={styles.replacement}>
            <Text style={styles.grow}>{item.spoken}</Text>
            <Text tone="tertiary">→</Text>
            <Text style={styles.grow}>{item.written}</Text>
            <Action
              label="Remove"
              variant="quiet"
              onPress={() =>
                void updatePreferences({ replacements: preferences.replacements.filter(value => value.spoken !== item.spoken) })
              }
            />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.xxl, gap: space.xl, maxWidth: 820 },
  section: { gap: space.md },
  description: { maxWidth: 600 },
  inlineForm: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  grow: { flex: 1 },
  terms: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  term: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingLeft: 12,
  },
  replacement: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
});
