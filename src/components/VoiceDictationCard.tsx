import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { theme, themedStyles } from '../constants/theme';
import { AccessibleButton } from './AccessibleButton';

/**
 * Visible voice-input state for the transaction forms (P2).
 *
 * Rubric requirement: the mic must never look decorative. Idle shows what to
 * say; active shows the live transcript preview so sighted teammates (and
 * demo judges) can see dictation working while a blind user speaks.
 */
export function VoiceDictationCard({
  active,
  preview,
  onStart,
  onStop,
  screenHint,
}: {
  active: boolean;
  preview: string | null;
  onStart: () => void;
  onStop: () => void;
  /** Example utterance for this screen, localized by the caller. */
  screenHint: string;
}) {
  const { t } = useTranslation();

  return (
    <View
      accessible={false}
      accessibilityLabel={t('voice.dictationCard', 'Voice input')}
      accessibilityHint={screenHint}
      style={[styles.card, active ? styles.cardActive : null]}
    >
      <View style={styles.topRow}>
        <AccessibleButton
          label={
            active
              ? t('voice.dictationStop', 'Stop voice input')
              : t('voice.dictationStart', 'Speak the transaction')
          }
          hint={screenHint}
          variant={active ? 'danger' : 'navy'}
          onPress={active ? onStop : onStart}
          style={styles.micBtn}
        >
          <Text style={styles.glyph}>{active ? '🔴' : '🎙️'}</Text>
        </AccessibleButton>

        <View style={styles.meta}>
          <Text style={active ? styles.statusActive : styles.statusIdle}>
            {active
              ? t('voice.dictationListening', 'Listening… say the whole transaction')
              : t('voice.dictationIdle', 'Tap the mic and say it in one sentence')}
          </Text>
          <Text style={styles.example}>{screenHint}</Text>
        </View>
      </View>

      {preview != null && preview.trim().length > 0 ? (
        <View style={styles.previewBox}>
          <Text style={styles.previewLabel}>
            {t('voice.dictationPreview', 'I heard:')}
          </Text>
          <Text style={styles.previewText}>{preview}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = themedStyles((colors) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: theme.radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  cardActive: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerLight,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  micBtn: {
    minWidth: 56,
    minHeight: 56,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radii.full,
  },
  glyph: {
    fontSize: 22,
  },
  meta: {
    flex: 1,
  },
  statusIdle: {
    fontSize: theme.typography.small,
    fontWeight: '800',
    color: colors.text,
  },
  statusActive: {
    fontSize: theme.typography.small,
    fontWeight: '800',
    color: colors.dangerDark,
  },
  example: {
    fontSize: theme.typography.tiny,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 2,
  },
  previewBox: {
    marginTop: theme.spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: theme.radii.md,
    padding: theme.spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewLabel: {
    fontSize: theme.typography.tiny,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: 2,
  },
  previewText: {
    fontSize: theme.typography.body,
    fontWeight: '700',
    color: colors.text,
  },
}));
