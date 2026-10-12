import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { announce } from '../a11y/announcer';
import { needsOwnVoice } from '../a11y/screenReader';
import { HeaderBar } from '../components/HeaderBar';
import { MAIN_MENU, RadialVoiceMenu, type RadialOption } from '../components/RadialVoiceMenu';
import { theme, themedStyles } from '../constants/theme';
import { getAppLanguage } from '../i18n';
import { speak } from '../services/speech';
import { sayKey, stopAllVoices } from '../voice/say';
import { matchVoiceIntent } from '../voice/commands';
import type { TranscriptSink } from '../voice/VoiceCommandProvider';

export interface RadialMenuScreenProps {
  onSelect: (option: RadialOption) => void;
  onBack: () => void;
  onOpenSettings?: () => void;
  /**
   * While the wheel is open it owns the microphone's transcripts: a spoken
   * command spins the wheel instead of jumping straight into a feature, so
   * the user always hears what was understood before anything opens.
   */
  onVoiceSink: (sink: TranscriptSink | null) => void;
}

export function RadialMenuScreen({
  onSelect,
  onBack,
  onOpenSettings,
  onVoiceSink,
}: RadialMenuScreenProps) {
  const { t } = useTranslation();
  const [voiceCommand, setVoiceCommand] = useState<string | null>(null);
  // Latest navigation handler, read from inside the sink so the sink itself is
  // registered once (a fresh sink every render would re-render the navigator).
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });

  useEffect(() => {
    const sink: TranscriptSink = {
      isActive: () => true,
      handleTranscript: (transcript) => {
        // The wheel owns every utterance while open, so the two global
        // controls a blind user must never lose still work: get me out,
        // and be quiet.
        const intent = matchVoiceIntent(transcript);
        if (intent === 'home') {
          onBackRef.current();
          return true;
        }
        if (intent === 'stop') {
          stopAllVoices();
          return true;
        }
        setVoiceCommand(transcript);
        return true;
      },
    };
    onVoiceSink(sink);
    return () => onVoiceSink(null);
  }, [onVoiceSink]);

  useEffect(() => {
    // Orientation for users without a screen reader: the hub is visual only,
    // so the open state must announce itself. Twi gets the native help clip
    // (zero quota); other languages go through the speak() ladder.
    const language = getAppLanguage();
    if (!needsOwnVoice()) {
      announce(t('radial.openHint'));
      return;
    }
    if (sayKey('vcmd.helpNative', { language, fallbackText: t('radial.openHint') }) === 'skipped') {
      speak(t('radial.openHint'), language);
    }
    // Runs once on mount; language changes re-orient via the header/back flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.screen}>
      <HeaderBar showBack onBack={onBack} onOpenSettings={onOpenSettings} />
      <View style={styles.body}>
        <RadialVoiceMenu
          menu={MAIN_MENU}
          onSelect={onSelect}
          voiceCommand={voiceCommand}
          onVoiceCommandConsumed={() => setVoiceCommand(null)}
        />
      </View>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.md,
  },
}));
