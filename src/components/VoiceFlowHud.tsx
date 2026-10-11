import { AccessibilityInfo, ScrollView, Text, TextInput, View } from 'react-native';
import { useState } from 'react';

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
 *
 * The typed-answer row is the brief's touch/text fallback: a user who cannot
 * speak (or a rehearsal) answers by keyboard and walks the identical flow —
 * no microphone, no gateway request.
 */
export function VoiceFlowHud({
  status,
  onCancel,
  onTypedAnswer,
}: {
  status: VoiceFlowStatus;
  onCancel: () => void;
  onTypedAnswer?: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');

  const sendTyped = () => {
    const answer = typed.trim();
    if (answer.length === 0 || onTypedAnswer == null) return;
    setTyped('');
    onTypedAnswer(answer);
  };

  return (
    <View
      style={styles.screen}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${t('vcmd.stepOf', { x: status.step, y: status.of })}. ${status.prompt}${
        status.heard != null ? `. ${t('vcmd.heard')}: ${status.heard}` : ''
      }`}
      accessibilityHint={t('voice.transcriptHint', 'Shows the questions and recognized answers in this conversation')}
    >
      {/* Small labels share one row and the title gets the full width below:
          a 28px title and a long step string ("Ɖoɖo fifi 1 ƒe 6 me") can
          together exceed a narrow screen, and the trailing label would be
          clipped at the screen edge. */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.eyebrow} numberOfLines={1}>
            {t('app.name')}
          </Text>
          <Text style={styles.step} numberOfLines={1}>
            {t('vcmd.stepOf', { x: status.step, y: status.of })}
          </Text>
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          {t('voice.conversation', 'Voice conversation')}
        </Text>
      </View>

      {/* Decorative mirror of the spoken "step x of y" line — hidden from
          accessibility so TalkBack never reads the bar instead of the words. */}
      <View
        style={styles.progressTrack}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        <View
          style={[
            styles.progressFill,
            { width: `${Math.round((status.step / Math.max(status.of, 1)) * 100)}%` },
          ]}
        />
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

      {onTypedAnswer != null ? (
        <View style={styles.typeRow}>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder={t('voice.typeAnswer', { defaultValue: 'Or type your answer' })}
            placeholderTextColor={theme.colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={sendTyped}
            accessibilityLabel={t('voice.typeAnswer', { defaultValue: 'Or type your answer' })}
            accessibilityHint={t('voice.typeAnswerHint', {
              defaultValue: 'Types the answer instead of speaking it',
            })}
            style={styles.typeField}
          />
          <AccessibleButton
            label={t('voice.sendAnswer', { defaultValue: 'Send answer' })}
            hint={t('voice.sendAnswerHint', {
              defaultValue: 'Double-tap to answer the current question with the typed text',
            })}
            variant="outline"
            disabled={typed.trim().length === 0}
            onPress={sendTyped}
            style={styles.typeSend}
          />
        </View>
      ) : null}

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
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
    gap: theme.spacing.xs,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  eyebrow: {
    flexShrink: 1,
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
    flexShrink: 0,
    fontSize: theme.typography.small,
    fontWeight: '900',
    color: colors.navyMidnight,
  },
  progressTrack: {
    height: 5,
    borderRadius: theme.radii.full,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: theme.radii.full,
    backgroundColor: colors.safepayBlue,
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
  typeRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'center',
  },
  typeField: {
    flex: 1,
    minHeight: theme.touchTarget.minSize,
    borderRadius: theme.radii.md,
    borderWidth: 1.5,
    borderColor: colors.controlBorder,
    backgroundColor: colors.surface,
    paddingHorizontal: theme.spacing.md,
    color: colors.text,
    fontSize: theme.typography.body,
  },
  typeSend: {
    minHeight: theme.touchTarget.minSize,
  },
}));
