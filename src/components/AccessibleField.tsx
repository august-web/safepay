import { useId, useState } from 'react';
import {Text, TextInput, View, type TextInputProps} from 'react-native';

import { theme, themedStyles } from '../constants/theme';

export interface AccessibleFieldProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string | null;
  helper?: string | null;
  prefix?: string | null;
  suffix?: string | null;
}

/**
 * Text field whose visible label is programmatically associated with the
 * input, with high-contrast borders and clear focus rings for low-vision users.
 */
export function AccessibleField({
  label,
  hint,
  error,
  helper,
  prefix,
  suffix,
  ...inputProps
}: AccessibleFieldProps) {
  const id = useId();
  const [focused, setFocused] = useState(false);

  const effectiveHint = hint ?? `Enter ${label}`;

  const hasError = Boolean(error != null && error.length > 0);

  return (
    <View style={styles.container}>
      <Text nativeID={`label-${id}`} style={styles.label}>
        {label}
      </Text>

      <View
        style={[
          styles.inputWrapper,
          focused ? styles.inputFocused : null,
          hasError ? styles.inputError : null,
        ]}
      >
        {prefix != null ? (
          <View style={styles.prefixBadge}>
            <Text style={styles.prefixText}>{prefix}</Text>
          </View>
        ) : null}

        <TextInput
          {...inputProps}
          nativeID={id}
          accessibilityLabel={label}
          accessibilityHint={effectiveHint}
          aria-labelledby={`label-${id}`}
          aria-invalid={hasError}
          accessibilityLiveRegion="polite"
          onChangeText={inputProps.onChangeText}
          onFocus={(event) => {
            setFocused(true);
            inputProps.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            inputProps.onBlur?.(event);
          }}
          style={[styles.input, prefix != null ? styles.inputWithPrefix : null, inputProps.style]}
          placeholderTextColor={theme.colors.placeholder}
        />

        {suffix != null ? (
          <View style={styles.suffixBadge}>
            <Text style={styles.suffixText}>{suffix}</Text>
          </View>
        ) : null}
      </View>

      {hasError ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          accessibilityHint="Input validation error"
          style={styles.error}
        >
          ⚠️ {error}
        </Text>
      ) : helper != null && helper.length > 0 ? (
        <Text style={styles.helper}>{helper}</Text>
      ) : null}
    </View>
  );
}

const styles = themedStyles((colors) => ({
  container: {
    marginBottom: theme.spacing.md,
  },
  label: {
    fontSize: theme.typography.small,
    fontWeight: '700',
    color: colors.text,
    marginBottom: theme.spacing.xs,
    letterSpacing: 0.2,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: theme.radii.md,
    minHeight: theme.touchTarget.minSize,
    overflow: 'hidden',
  },
  prefixBadge: {
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: theme.spacing.md,
    minHeight: theme.touchTarget.minSize,
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1.5,
    borderRightColor: colors.border,
  },
  prefixText: {
    fontSize: theme.typography.body,
    fontWeight: '800',
    color: colors.navy,
  },
  suffixBadge: {
    paddingHorizontal: theme.spacing.sm,
    justifyContent: 'center',
  },
  suffixText: {
    fontSize: theme.typography.small,
    color: colors.textMuted,
  },
  input: {
    flex: 1,
    minHeight: theme.touchTarget.minSize,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontSize: theme.typography.body,
    color: colors.text,
    backgroundColor: 'transparent',
  },
  inputWithPrefix: {
    paddingLeft: theme.spacing.md,
  },
  inputFocused: {
    borderColor: colors.borderFocus,
    borderWidth: 2,
    backgroundColor: colors.surface,
  },
  inputError: {
    borderColor: colors.danger,
    borderWidth: 2,
  },
  error: {
    marginTop: theme.spacing.xs,
    fontSize: theme.typography.small,
    fontWeight: '600',
    color: colors.danger,
  },
  helper: {
    marginTop: theme.spacing.xs,
    fontSize: theme.typography.tiny,
    color: colors.textMuted,
  },
}));
