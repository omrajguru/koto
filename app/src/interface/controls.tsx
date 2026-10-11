import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  type PressableProps,
  StyleSheet,
  Text as NativeText,
  type TextProps,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { controlHeight, MINIMUM_HIT_SIZE, radius, space, typography, useColors } from './theme';

type TextVariant = keyof typeof typography;

export function Text({
  variant = 'body',
  tone = 'primary',
  style,
  ...props
}: TextProps & { variant?: TextVariant; tone?: 'primary' | 'secondary' | 'tertiary' | 'accent' | 'error' | 'success' }) {
  const colors = useColors();
  const color = {
    primary: colors.textPrimary,
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
    accent: colors.accent,
    error: colors.error,
    success: colors.success,
  }[tone];
  return <NativeText {...props} style={[typography[variant] as object, { color }, style]} />;
}

/** Tracks hover so controls can respond to the pointer on desktop. */
function useHover() {
  const [isHovered, setIsHovered] = useState(false);
  return {
    isHovered,
    hoverProps: { onHoverIn: () => setIsHovered(true), onHoverOut: () => setIsHovered(false) },
  };
}

export type ActionVariant = 'primary' | 'secondary' | 'quiet' | 'destructive';

export function Action({
  label,
  variant = 'secondary',
  isDisabled = false,
  onPress,
  accessibilityHint,
}: {
  label: string;
  variant?: ActionVariant;
  isDisabled?: boolean;
  onPress: () => void;
  accessibilityHint?: string;
}) {
  const colors = useColors();
  const { isHovered, hoverProps } = useHover();
  const palette = {
    primary: { background: isHovered ? colors.accentHover : colors.accent, border: 'transparent', text: colors.onAccent },
    secondary: {
      background: isHovered ? colors.backgroundTertiary : 'transparent',
      border: isHovered ? colors.borderStrong : colors.borderDefault,
      text: colors.textPrimary,
    },
    quiet: { background: isHovered ? colors.backgroundTertiary : 'transparent', border: 'transparent', text: colors.textSecondary },
    destructive: {
      background: isHovered ? colors.backgroundTertiary : 'transparent',
      border: isHovered ? colors.error : colors.borderDefault,
      text: colors.error,
    },
  }[variant];
  return (
    <Pressable
      {...(hoverProps as Partial<PressableProps>)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: palette.background,
          borderColor: palette.border,
          opacity: isDisabled ? 0.45 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        variant === 'quiet' && styles.quietAction,
      ]}
    >
      <Text variant="label" style={{ color: palette.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Immediate on/off setting. Backed by an accessible switch role. */
export function Toggle({
  label,
  description,
  isOn,
  onChange,
}: {
  label: string;
  description?: string;
  isOn: boolean;
  onChange: (isOn: boolean) => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: isOn }}
      onPress={() => onChange(!isOn)}
      style={styles.toggleRow}
    >
      <View style={styles.toggleText}>
        <Text variant="label">{label}</Text>
        {description ? (
          <Text variant="body" tone="secondary" style={styles.description}>
            {description}
          </Text>
        ) : null}
      </View>
      <View
        style={[
          styles.track,
          { backgroundColor: isOn ? colors.accent : colors.backgroundTertiary, borderColor: isOn ? colors.accent : colors.borderDefault },
        ]}
      >
        <View style={[styles.thumb, isOn ? styles.thumbOn : styles.thumbOff, { backgroundColor: isOn ? colors.onAccent : colors.textSecondary }]} />
      </View>
    </Pressable>
  );
}

export function TextField({ label, ...props }: TextInputProps & { label: string }) {
  const colors = useColors();
  const [isFocused, setIsFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text variant="label" tone="secondary">
        {label}
      </Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.textTertiary}
        onFocus={event => {
          setIsFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={event => {
          setIsFocused(false);
          props.onBlur?.(event);
        }}
        style={[
          typography.body as object,
          styles.input,
          {
            color: colors.textPrimary,
            backgroundColor: colors.backgroundSecondary,
            borderColor: isFocused ? colors.accent : colors.borderDefault,
          },
        ]}
      />
    </View>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/** Custom listbox. Expands in place so it never fights window edges or scroll containers. */
export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  const colors = useColors();
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find(option => option.value === value) ?? options[0];
  return (
    <View style={styles.field}>
      <Text variant="label" tone="secondary">
        {label}
      </Text>
      <Pressable
        accessibilityRole="combobox"
        accessibilityLabel={`${label}: ${selected.label}`}
        accessibilityState={{ expanded: isOpen }}
        onPress={() => setIsOpen(open => !open)}
        style={[styles.input, styles.selectTrigger, { backgroundColor: colors.backgroundSecondary, borderColor: isOpen ? colors.accent : colors.borderDefault }]}
      >
        <Text>{selected.label}</Text>
        <Text tone="tertiary">{isOpen ? '⌃' : '⌄'}</Text>
      </Pressable>
      {isOpen ? (
        <ScrollView accessibilityRole="list" showsVerticalScrollIndicator={false} style={[styles.listbox, { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderDefault }]}>
          {options.map(option => {
            const isSelected = option.value === value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                style={({ pressed }) => [styles.option, { backgroundColor: pressed || isSelected ? colors.backgroundTertiary : 'transparent' }]}
              >
                <Text>{option.label}</Text>
                {isSelected ? <Text tone="accent">✓</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

export function Divider() {
  const colors = useColors();
  return <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />;
}

const styles = StyleSheet.create({
  action: {
    // Same height as text fields, so buttons beside inputs share both edges.
    minHeight: controlHeight.lg,
    minWidth: MINIMUM_HIT_SIZE,
    paddingHorizontal: 18,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quietAction: { paddingHorizontal: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', minHeight: MINIMUM_HIT_SIZE, gap: space.md, paddingVertical: space.sm },
  toggleText: { flex: 1 },
  description: { marginTop: 2, fontSize: 14, lineHeight: 20 },
  track: { width: 40, height: 24, borderRadius: 12, borderWidth: 1, justifyContent: 'center' },
  thumb: { width: 18, height: 18, borderRadius: 9 },
  thumbOn: { marginLeft: 18 },
  thumbOff: { marginLeft: 2 },
  field: { gap: space.sm },
  input: { minHeight: controlHeight.lg, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 10 },
  selectTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listbox: { borderWidth: 1, borderRadius: radius.sm, paddingVertical: space.xs, maxHeight: 320, overflow: 'hidden' },
  option: { minHeight: MINIMUM_HIT_SIZE - 8, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  divider: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
});
