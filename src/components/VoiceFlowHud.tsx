import { AccessibilityInfo, ScrollView, Text, View } from 'react-native';

import { useTranslation } from 'react-i18next';

import { theme, themedStyles } from '../constants/theme';
import type { VoiceFlowStatus } from '../voice/VoiceFlowController';
import { AccessibleButton } from './AccessibleButton';

/**
 * The visible half of the voice conversation.
 *
 * The blind user hears the flow; sighted judges and the presenter see which
 * question the app just asked and what it heard. Announced politely to
 * TalkBack as well, so the visible state never contradicts the spoken one.
 */
export function VoiceFlowHud({
  status,
  onCancel,
}: {
  status: VoiceFlowStatus;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  return (
    <View
      style={styles.screen}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${t('vcmd.stepOf', { x: status.step, y: status.of })}. ${status.prompt}${
        status.heard != null ? `. ${t('vcmd.heard')}: ${status.heard}` : ''
      }`}
      accessibilityHint={t('voice.transcriptHint', 'Shows the questions and recognized answers in this conversation')}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>{t('app.name')}</Text>
          <Text accessibilityRole="header" style={styles.title}>
            {t('voice.conversation', 'Voice conversation')}
          </Text>
        </View>
        <Text style={styles.step}>{t('vcmd.stepOf', { x: status.step, y: status.of })}</Text>
      </View>

      <ScrollView
        style={styles.transcript}
        contentContainerStyle={styles.transcriptContent}
        accessibilityLabel={t('voice.transcript', 'Conversation transcript')}
        accessibilityHint={t('voice.transcriptHint', 'Scroll to review the conversation')}
      >
        {status.transcript.map((entry, index) => (
          <View key={`${entry.speaker}-${index}`} style={styles.entry}>
            <Text style={entry.speaker === 'app' ? styles.appLabel : styles.userLabel}>
              {entry.speaker === 'app'
                ? t('voice.safePay', 'SafePay')
                : t('voice.you', 'You')}
            </Text>
            <Text style={styles.entryText}>{entry.text}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.currentPrompt} accessibilityLiveRegion="polite">
        <Text style={styles.currentLabel}>{t('voice.currentQuestion', 'Current question')}</Text>
        <Text style={styles.prompt}>{status.prompt}</Text>
      </View>

      <AccessibleButton
        label={t('common.cancel', 'Cancel')}
        hint={t('common.cancelHint', 'Double-tap to stop this voice conversation')}
        variant="outline"
        onPress={onCancel}
        style={styles.cancelButton}
      />
    </View>
  );
}

/** Keeps the HUD visible state honest across mounts. */
export function announceFlowStatus(status: VoiceFlowStatus): void {
  AccessibilityInfo.announceForAccessibility(status.prompt);
}

const styles = themedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  eyebrow: {
    fontSize: theme.typography.small,
    fontWeight: '800',
    color: colors.textMuted,
  },
  title: {
    fontSize: theme.typography.title,
    fontWeight: '900',
    color: colors.navyMidnight,
  },
  transcript: {
    flex: 1,
  },
  transcriptContent: {
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  entry: {
    backgroundColor: colors.surface,
    borderRadius: theme.radii.md,
    borderLeftWidth: 5,
    borderLeftColor: colors.safepayBlue,
    padding: theme.spacing.md,
    gap: 4,
  },
  appLabel: {
    fontSize: theme.typography.small,
    fontWeight: '900',
    color: colors.safepayBlue,
  },
  userLabel: {
    fontSize: theme.typography.small,
    fontWeight: '900',
    color: colors.goldInk,
  },
  entryText: {
    fontSize: theme.typography.body,
    lineHeight: 26,
    color: colors.text,
  },
  currentPrompt: {
    backgroundColor: colors.safepayTint,
    borderRadius: theme.radii.md,
    borderWidth: 2,
    borderColor: colors.safepayBlue,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  currentLabel: {
    fontSize: theme.typography.small,
    fontWeight: '900',
    color: colors.safepayBlue,
  },
  step: {
    fontSize: theme.typography.small,
    fontWeight: '900',
    color: colors.navyMidnight,
    paddingTop: theme.spacing.xs,
  },
  prompt: {
    fontSize: theme.typography.heading,
    lineHeight: 30,
    fontWeight: '900',
    color: colors.text,
  },
  cancelButton: {
    minHeight: 52,
  },
}));
