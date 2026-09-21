import { forwardRef } from 'react';
import {ActivityIndicator, Platform, Pressable, Text, View, type PressableProps, type StyleProp, type TextStyle, type ViewStyle, } from 'react-native';

import { theme, themedStyles } from '../constants/theme';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'danger'
  | 'gold'
  | 'momo'
  | 'outline'
  | 'ghost'
  | 'hero'
  | 'navy';

export interface AccessibleButtonProps extends Omit<PressableProps, 'children'> {
  label: string;
  hint?: string;
  variant?: ButtonVariant;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  children?: React.ReactNode;
}

export const AccessibleButton = forwardRef<View, AccessibleButtonProps>(
  function AccessibleButton(
    {
      label,
      hint,
      variant = 'primary',
      icon,
      iconPosition = 'left',
      loading = false,
      disabled = false,
      onPress,
      style,
      textStyle,
      children,
      ...rest
    },
    ref,
  ) {
    const isDisabled = disabled || loading;

    // Resolve variant styling
    let background: string;
    let foreground: string;
    let borderColor = 'transparent';
    let minHeight: number = theme.touchTarget.minSize;

    switch (variant) {
      case 'hero':
        background = theme.colors.navyMidnight;
        foreground = theme.colors.momoYellow;
        minHeight = 56;
        break;
      case 'momo':
        background = theme.colors.momoYellow;
        foreground = theme.colors.navyMidnight;
        break;
      case 'gold':
        background = theme.colors.accentGold;
        foreground = theme.colors.navyMidnight;
        break;
      case 'navy':
        background = theme.colors.navyMidnight;
        foreground = theme.colors.onPrimary;
        break;
      case 'danger':
        background = theme.colors.danger;
        foreground = theme.colors.onPrimary;
        break;
      case 'outline':
        background = 'transparent';
        foreground = theme.colors.navyMidnight;
        borderColor = theme.colors.borderDark;
        break;
      case 'ghost':
        background = 'transparent';
        foreground = theme.colors.textMuted;
        break;
      case 'secondary':
        background = theme.colors.primaryLight;
        foreground = theme.colors.primaryDark;
        break;
      case 'primary':
      default:
        background = theme.colors.primary;
        foreground = theme.colors.onPrimary;
        break;
    }

    const computedBg = isDisabled ? theme.colors.disabled : background;
    const computedFg = isDisabled ? theme.colors.textMuted : foreground;

    return (
      <Pressable
        ref={ref}
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint ?? (label ? `Double-tap to activate ${label}` : undefined)}
        accessibilityState={isDisabled ? { disabled: true, busy: loading } : { busy: loading }}
        onPress={onPress}
        disabled={isDisabled}
        style={({ pressed }) => [
          styles.base,
          {
            backgroundColor: computedBg,
            borderColor,
            borderWidth: borderColor !== 'transparent' ? 1.5 : 0,
            minHeight,
          },
          variant === 'momo' ? styles.momoShadow : null,
          pressed && !isDisabled ? styles.pressed : null,
          style,
        ]}
        {...rest}
      >
        {loading ? (
          <ActivityIndicator color={computedFg} size="small" />
        ) : (
          <>
            {icon != null && iconPosition === 'left' ? icon : null}
            {children != null ? (
              children
            ) : (
              <Text
                style={[
                  styles.text,
                  variant === 'hero' ? styles.heroText : null,
                  variant === 'momo' ? styles.momoText : null,
                  { color: computedFg },
                  textStyle,
                ]}
              >
                {label}
              </Text>
            )}
            {icon != null && iconPosition === 'right' ? icon : null}
          </>
        )}
      </Pressable>
    );
  },
);

const styles = themedStyles((colors) => ({
  base: {
    minHeight: theme.touchTarget.minSize,
    minWidth: theme.touchTarget.minSize,
    borderRadius: theme.radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  text: {
    fontSize: theme.typography.body,
    fontWeight: '700',
    textAlign: 'center',
  },
  heroText: {
    fontSize: theme.typography.subheading,
    fontWeight: '800',
  },
  momoText: {
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  momoShadow: {
    ...Platform.select({
      web: {
        boxShadow: '0 2px 8px rgba(229, 183, 0, 0.3)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
      },
    }),
  },
}));
