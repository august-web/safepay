import {Image, Text, View} from 'react-native';
import { useTranslation } from 'react-i18next';

import { theme, themedStyles } from '../constants/theme';
import { AccessibleButton } from './AccessibleButton';
import { MicButton } from './MicButton';

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
  const displayTitle = title ?? t('app.name', 'SikaVoice');

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {showBack ? (
          <AccessibleButton
            label="←"
            hint={t('common.back', 'Back')}
            variant="ghost"
            onPress={onBack}
            style={styles.backButton}
            textStyle={styles.backButtonText}
          />
        ) : (
          <View style={styles.brandIconContainer}>
            <Image
              source={require('../../assets/safepay-symbol.png')}
              style={styles.brandIconImage}
              resizeMode="contain"
              accessibilityLabel="SafePay Icon"
              accessibilityHint="Official SafePay tactile emblem"
              accessibilityIgnoresInvertColors
            />
          </View>
        )}

        <View style={styles.titleContainer}>
          <Text
            accessibilityRole="header"
            accessibilityLabel={`${displayTitle}${subtitle ? `, ${subtitle}` : ''}`}
            accessibilityHint="Header navigation"
            style={styles.title}
          >
            {displayTitle}
          </Text>
          {subtitle != null ? (
            <Text style={styles.subtitle}>{subtitle}</Text>
          ) : !showBack ? (
            <Text style={styles.yelloGreeting}>{t('home.yelloGreeting', "Y'ello! MoMo Companion")}</Text>
          ) : null}
        </View>

        {/* On sub-pages the SafePay badge is hidden so long localized titles
            keep the full width and never collide with the back arrow. */}
        {!showBack || rightAction != null || showVoice ? (
        <View style={styles.rightContainer}>
          {rightAction != null ? (
            rightAction
          ) : (
            <>
              <View
                accessible
                accessibilityRole="text"
                accessibilityLabel={t('app.securityBadge', 'MTN MoMo SafePay Verified')}
                accessibilityHint="Security certification badge"
                style={styles.securityBadge}
              >
                <Image
                  source={require('../../assets/safepay-symbol.png')}
                  style={styles.badgeLogo}
                  resizeMode="contain"
                  accessibilityLabel="SafePay verified badge"
                  accessibilityHint="Verified secure transaction shield"
                  accessibilityIgnoresInvertColors
                />
                <Text style={styles.securityText}>SafePay</Text>
              </View>
              {onOpenSettings ? (
                <AccessibleButton
                  label="⚙️"
                  hint={t('settings.openSettings', 'Open accessibility settings')}
                  variant="ghost"
                  onPress={onOpenSettings}
                  style={styles.settingsButton}
                  textStyle={styles.settingsButtonText}
                />
              ) : null}
            </>
          )}
          {showVoice ? <MicButton /> : null}
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
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: theme.spacing.sm,
    marginRight: theme.spacing.xs,
  },
  backButtonText: {
    fontSize: 22,
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
    justifyContent: 'center',
  },
  title: {
    fontSize: theme.typography.heading,
    fontWeight: '900',
    color: colors.safepayBlue,
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
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.safepayTint,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radii.full,
    gap: 6,
    borderWidth: 1.5,
    borderColor: colors.safepayBlue,
  },
  badgeLogo: {
    width: 16,
    height: 16,
  },
  securityText: {
    fontSize: theme.typography.tiny,
    fontWeight: '800',
    color: colors.navyMidnight,
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
