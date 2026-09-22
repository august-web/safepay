import {Text} from 'react-native';
import { useTranslation } from 'react-i18next';

import { useVoiceCommands } from '../voice/VoiceCommandProvider';
import { AccessibleButton } from './AccessibleButton';
import { theme, themedStyles } from '../constants/theme';

/**
 * Tap-to-talk control for SikaVoice's spoken commands.
 *
 * The recognition provider announces its own state ("Listening", "I did not
 * hear anything", permission problems), so this button only has to expose an
 * accurate label and hint to screen-reader users - and a large touch target,
 * because it is the control a blind user reaches for most.
 */
export function MicButton() {
  const { t } = useTranslation();
  const { listening, available, blockedReason, toggleListening } = useVoiceCommands();

  const label = listening
    ? t('voice.stopListening', 'Stop listening')
    : t('voice.listen', 'Voice command');

  const hint = !available
    ? t('voice.notAvailableShort', 'Voice commands are not available on this phone')
    : blockedReason === 'permission'
      ? t('voice.permissionDeniedShort', 'Microphone access is turned off for SikaVoice')
      : listening
        ? t('voice.listeningHint', 'Speak now, or tap again to stop')
        : t('voice.listenHint', 'Tap, then say balance, statement, send money, or help');

  return (
    <AccessibleButton
      label={label}
      hint={hint}
      variant={listening ? 'danger' : 'navy'}
      onPress={toggleListening}
      style={styles.micBtn}
    >
      <Text style={styles.glyph}>{listening ? '🔴' : '🎙️'}</Text>
    </AccessibleButton>
  );
}

const styles = themedStyles((colors) => ({
  micBtn: {
    minWidth: 48,
    minHeight: 48,
    paddingHorizontal: theme.spacing.sm,
    marginLeft: 6,
    borderRadius: theme.radii.full,
    borderWidth: 0,
    borderColor: 'transparent',
  },
  glyph: {
    fontSize: 18,
    color: colors.onPrimary,
  },
}));
