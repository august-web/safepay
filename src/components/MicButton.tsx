import { useEffect, useState } from 'react';
import { Animated, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useVoiceCommands } from '../voice/VoiceCommandProvider';
import { AccessibleButton } from './AccessibleButton';
import { theme, themedStyles } from '../constants/theme';

/**
 * Tap-to-talk control for SafePay's spoken commands.
 *
 * Two visual states (Polish 10): the idle glyph is a static mic; while the
 * session is live the glyph turns into a pulsing red dot so it is never
 * ambiguous whether the app is capturing audio - extra important on a
 * financial app whose mic can be always-on.
 */
export function MicButton() {
  const { t } = useTranslation();
  const { listening, available, blockedReason, toggleListening } = useVoiceCommands();
  // React 19 rule: never touch refs during render - build the Animated.Value
  // lazily in state, exactly like the countdown timers on the money screens.
  const [pulse] = useState(() => new Animated.Value(0.45));

  useEffect(() => {
    if (!listening) {
      pulse.stopAnimation();
      pulse.setValue(0.45);
      return;
    }
    // Gentle opacity breathe - visible without being alarming.
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [listening, pulse]);

  const label = listening
    ? t('voice.stopListening', 'Stop listening')
    : t('voice.listen', 'Voice command');

  const hint = !available
    ? t('voice.notAvailableShort', 'Voice commands are not available on this phone')
    : blockedReason === 'permission'
      ? t('voice.permissionDeniedShort', 'Microphone access is turned off for SafePay')
      : listening
        ? t('voice.listeningHint', 'Speak now, or tap again to stop')
        : t('voice.listenHint', 'Tap, then say balance, statement, send money, or help');
  const visibleLabel = listening
    ? t('voice.listening', 'Listening')
    : t('voice.listen', 'Voice');

  return (
    <AccessibleButton
      label={label}
      hint={hint}
      variant={listening ? 'danger' : 'navy'}
      onPress={toggleListening}
      style={styles.micBtn}
      accessibilityState={{
        busy: listening,
        selected: listening,
        disabled: !available || blockedReason === 'permission',
      }}
    >
      {listening ? (
        <>
          <Animated.View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.liveDot, { opacity: pulse }]}
          />
          <Text style={styles.statusText}>{visibleLabel}</Text>
        </>
      ) : (
        <>
          <Text style={styles.glyph}>🎙️</Text>
          <Text style={styles.statusText}>{visibleLabel}</Text>
        </>
      )}
    </AccessibleButton>
  );
}

const styles = themedStyles((colors) => ({
  micBtn: {
    minWidth: 96,
    minHeight: 48,
    paddingHorizontal: theme.spacing.md,
    marginLeft: 6,
    borderRadius: theme.radii.full,
    borderWidth: 0,
    borderColor: 'transparent',
  },
  glyph: {
    fontSize: 18,
    color: colors.onPrimary,
  },
  liveDot: {
    width: 14,
    height: 14,
    borderRadius: theme.radii.full,
    backgroundColor: colors.onPrimary,
  },
  statusText: {
    color: colors.onPrimary,
    fontSize: theme.typography.small,
    fontWeight: '800',
  },
}));
