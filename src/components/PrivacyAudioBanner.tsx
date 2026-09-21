import {Text, View} from 'react-native';
import { useTranslation } from 'react-i18next';

import { theme, themedStyles } from '../constants/theme';

export interface PrivacyAudioBannerProps {
  isPrivateAudio: boolean;
}

export function PrivacyAudioBanner({ isPrivateAudio }: PrivacyAudioBannerProps) {
  const { t } = useTranslation();

  const label = isPrivateAudio
    ? t('privacy.privateAudioActive', 'Headphones Connected — Private Voice Read-Back Active')
    : t('privacy.speakerHapticActive', 'Speaker Active — Tactile Haptic Privacy Shield Active');

  const hint = isPrivateAudio
    ? t('privacy.privateHint', 'Your transaction amounts and PIN will be spoken privately in your ear.')
    : t('privacy.speakerHint', 'Amounts will vibrate silently instead of being spoken aloud in public.');

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={[
        styles.banner,
        isPrivateAudio ? styles.bannerPrivate : styles.bannerPublic,
      ]}
    >
      <View style={styles.iconCircle}>
        <Text style={styles.icon}>{isPrivateAudio ? '🎧' : '📳'}</Text>
      </View>
      <View style={styles.textContainer}>
        <Text style={[styles.title, isPrivateAudio ? styles.textPrivate : styles.textPublic]}>
          {isPrivateAudio
            ? t('privacy.privateTitle', 'Private Audio Mode')
            : t('privacy.publicTitle', 'Tactile Privacy Shield')}
        </Text>
        <Text style={styles.description}>
          {isPrivateAudio
            ? t('privacy.privateDesc', 'Spoken read-back active via earphones')
            : t('privacy.publicDesc', 'Vibration mode active in public')}
        </Text>
      </View>
      <View
        style={[
          styles.badge,
          isPrivateAudio ? styles.badgePrivate : styles.badgePublic,
        ]}
      >
        <Text
          style={[
            styles.badgeText,
            isPrivateAudio ? styles.badgeTextPrivate : styles.badgeTextPublic,
          ]}
        >
          {isPrivateAudio ? 'SECURE' : 'DISCREET'}
        </Text>
      </View>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radii.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    gap: theme.spacing.sm,
  },
  bannerPrivate: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  bannerPublic: {
    backgroundColor: colors.accentGoldLight,
    borderColor: colors.accentGold,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: theme.radii.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 18,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: theme.typography.small,
    fontWeight: '800',
  },
  textPrivate: {
    color: colors.primaryDark,
  },
  textPublic: {
    color: colors.accentGoldDark,
  },
  description: {
    fontSize: theme.typography.tiny,
    color: colors.textMuted,
    fontWeight: '500',
  },
  badge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 3,
    borderRadius: theme.radii.full,
  },
  badgePrivate: {
    backgroundColor: colors.primary,
  },
  badgePublic: {
    backgroundColor: colors.accentGoldDark,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  badgeTextPrivate: {
    color: colors.onPrimary,
  },
  badgeTextPublic: {
    color: colors.surface,
  },
}));

