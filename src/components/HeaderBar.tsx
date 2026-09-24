import {Image, Text, View} from 'react-native';
import { useTranslation } from 'react-i18next';

import { theme, themedStyles } from '../constants/theme';
import { AccessibleButton } from './AccessibleButton';

export interface HeaderBarProps {
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  onOpenSettings?: () => void;
  /** Voice commands are reachable from every screen by default. */
  showVoice?: boolean;
}

export function HeaderBar({
  title,
  subtitle,
  showBack = false,
  onBack,
  rightAction,
  onOpenSettings,
  showVoice = true,
}: HeaderBarProps) {
  const { t } = useTranslation();
  const displayTitle = title ?? t('app.name', 'SafePay');

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {showBack ? (
          <AccessibleButton
            label={t('common.back', 'Back')}
            hint={t('common.backHint', 'Double-tap to return to the previous screen')}
            variant="ghost"
            onPress={onBack}
            style={styles.backButton}
            textStyle={styles.backButtonText}
          >
            <Text style={styles.backButtonText}>‹</Text>
          </AccessibleButton>
        ) : (
          <View style={styles.brandIconContainer}>
            <Image
              source={require('../../assets/safepay-symbol.png')}
              style={styles.brandIconImage}
              resizeMode="contain"
              accessibilityLabel="SafePay logo"
              accessibilityHint="SafePay brand emblem"
              accessibilityIgnoresInvertColors
            />
          </View>
        )}

        <View style={styles.titleContainer}>
          <Text
            accessibilityRole="header"
            accessibilityLabel={`${displayTitle}${subtitle ? `, ${subtitle}` : ''}`}
            accessibilityHint="Header navigation"
            numberOfLines={1}
            ellipsizeMode="tail"
            style={styles.title}
          >
            {displayTitle}
          </Text>
          {subtitle != null ? (
            <Text style={styles.subtitle}>{subtitle}</Text>
          ) : !showBack ? (
            <Text numberOfLines={2} style={styles.yelloGreeting}>
              {t('home.yelloGreeting', "Y'ello! MoMo Companion")}
            </Text>
          ) : null}
        </View>

        {/* On sub-pages the secure badge is hidden so long localized titles
            keep the full width and never collide with the back arrow. */}
        {!showBack || rightAction != null || showVoice ? (
        <View style={styles.rightContainer}>
          {rightAction != null ? (
            rightAction
          ) : (
            <>
              {onOpenSettings ? (
                <AccessibleButton
                  label={t('settings.openSettings', 'Open accessibility settings')}
                  hint={t('settings.openSettingsHint', 'Double-tap to open contrast, language and voice settings')}
                  variant="ghost"
                  onPress={onOpenSettings}
                  style={styles.settingsButton}
                  textStyle={styles.settingsButtonText}
                >
                  <Text style={styles.settingsButtonText}>⚙️</Text>
                </AccessibleButton>
              ) : null}
            </>
          )}
        </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  container: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: theme.touchTarget.minSize,
  },
  backButton: {
    minWidth: 56,
    minHeight: 44,
    paddingHorizontal: theme.spacing.sm,
    marginRight: theme.spacing.xs,
  },
  backButtonText: {
    fontSize: 38,
    lineHeight: 38,
    fontWeight: '900',
    color: colors.navyMidnight,
  },
  brandIconContainer: {
    width: 42,
    height: 42,
    borderRadius: theme.radii.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.sm,
    borderWidth: 2,
    borderColor: colors.safepayBlue,
    padding: 3,
  },
  brandIconImage: {
    width: 28,
    height: 28,
  },
  titleContainer: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: theme.typography.heading,
    fontWeight: '900',
    color: colors.safepayBlue,
    flexShrink: 1,
    letterSpacing: -0.3,
  },
  yelloGreeting: {
    fontSize: theme.typography.tiny,
    fontWeight: '700',
    color: colors.textMuted,
  },
  subtitle: {
    fontSize: theme.typography.tiny,
    fontWeight: '600',
    color: colors.textMuted,
  },
  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: theme.spacing.sm,
  },
  settingsButton: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 4,
    marginLeft: 6,
  },
  settingsButtonText: {
    fontSize: 20,
  },
}));
