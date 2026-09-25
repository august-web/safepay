import { useCallback, useEffect, useRef, useState } from 'react';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { announce } from '../a11y/announcer';
import { isScreenReaderEnabled } from '../a11y/screenReader';
import { AccessibleButton } from '../components/AccessibleButton';
import { theme, themedStyles } from '../constants/theme';
import {
  getAppLanguage,
  i18n,
  LANGUAGE_NAMES,
  setAppLanguage,
  SUPPORTED_LANGUAGES,
  type AppLanguage,
} from '../i18n';
import { hapticTick } from '../services/haptics';
import {
  authenticateWithBiometrics,
  getBiometricCapability,
  getBiometricTypeName,
} from '../services/biometrics';
import { saveSettings } from '../services/settings';
import { fold, isStopUtterance, matchVoiceIntent } from '../voice/commands';
import { parseYesNo } from '../voice/flowParse';
import { sayKeyAsync } from '../voice/say';
import { useScreenDictation } from '../voice/useScreenDictation';
import type { TranscriptSink } from '../voice/VoiceCommandProvider';

/**
 * Voice-first onboarding (Phase 2 of the build plan).
 *
 * One state machine, not a pile of screens. Every step is answerable by voice
 * (the always-on mic routes utterances here through the provider's sink seam)
 * and by touch, every step is spoken in the user's language, and no answer can
 * dead-end the flow: an unparsed answer re-asks, "gyae" exits cleanly.
 *
 * The screen never touches transaction code - it only writes settings.
 */

type OnboardingStepName =
  | 'welcome'
  | 'mic'
  | 'listening'
  | 'contacts'
  | 'language'
  | 'talkback'
  | 'micTest'
  | 'voiceTest'
  | 'biometrics'
  | 'teach'
  | 'done';

const STEP_ORDER: OnboardingStepName[] = [
  'welcome',
  'mic',
  'listening',
  'contacts',
  'language',
  'talkback',
  'micTest',
  'voiceTest',
  'biometrics',
  'teach',
  'done',
];

/** The spoken + displayed prompt for each step (one fixed key per step). */
const STEP_PROMPT_KEY: Record<OnboardingStepName, string> = {
  welcome: 'onboarding.welcomeBody',
  mic: 'onboarding.micBody',
  listening: 'onboarding.listeningBody',
  contacts: 'onboarding.contactsBody',
  language: 'onboarding.languageTitle',
  talkback: 'onboarding.talkbackBody',
  micTest: 'onboarding.micTestBody',
  voiceTest: 'onboarding.voiceTestBody',
  biometrics: 'onboarding.bioBody',
  teach: 'onboarding.teachBody',
  done: 'onboarding.doneBody',
};

const NEXT_STEP: Record<OnboardingStepName, OnboardingStepName> = {
  welcome: 'mic',
  mic: 'listening',
  listening: 'contacts',
  contacts: 'language',
  language: 'talkback',
  talkback: 'micTest',
  micTest: 'voiceTest',
  voiceTest: 'biometrics',
  biometrics: 'teach',
  teach: 'done',
  done: 'done',
};

/** Utterances that mean "go on", on top of the shared yes-words. */
const ADVANCE_PATTERN = /\b(next|continue|done|ready|go|kɔ so|tɔ so|tso ke|kɛshi)\b/;

/** Spoken language names, folded, per app language. */
const LANGUAGE_WORDS: Record<AppLanguage, RegExp> = {
  tw: /twi|akan|chwi|tui/,
  ee: /ewe|eve|eʋe|ebwe/,
  ga: /\bga\b|gã/,
  pcm: /pidgin|broken/,
  en: /english|oyibo/,
};

type TranscriptEntry = { speaker: 'app' | 'user'; text: string };

export function OnboardingScreen({
  onDone,
  onVoiceSink,
}: {
  onDone: () => void;
  /** Registers this screen as the mic's transcript sink while it is mounted. */
  onVoiceSink: (sink: TranscriptSink | null) => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<OnboardingStepName>('welcome');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const [lang, setLang] = useState<AppLanguage>(getAppLanguage());
  const [micState, setMicState] = useState<'unknown' | 'granted' | 'denied' | 'permanent'>(
    'unknown',
  );
  const [bio, setBio] = useState<{
    hasHardware: boolean;
    isEnrolled: boolean;
    typeName: string | null;
  } | null>(null);
  const [bioBusy, setBioBusy] = useState(false);
  const screenReaderOn = isScreenReaderEnabled();

  /** Always-current step for the stable voice handler. */
  const stepRef = useRef<OnboardingStepName>('welcome');
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const pushTranscript = useCallback((speaker: 'app' | 'user', text: string) => {
    setTranscript((prev) => [...prev.slice(-7), { speaker, text }]);
  }, []);

  /**
   * Speaks one fixed key at the next quiet moment, honouring the app-wide
   * voice policy: native clips for Twi/Ewe (never the English-accented device
   * voice), device TTS / screen reader for English, Ga and Pidgin.
   */
  const speakKeys = useCallback(async (keys: string[]) => {
    for (const key of keys) {
      const played = await sayKeyAsync(key).catch(() => false);
      const language = getAppLanguage();
      if (!played && language !== 'tw' && language !== 'ee') {
        announce(i18n.t(key));
      }
    }
  }, []);

  const goTo = useCallback(
    (next: OnboardingStepName) => {
      const promptKey = STEP_PROMPT_KEY[next];
      setStep(next);
      pushTranscript('app', i18n.t(promptKey));
      void speakKeys([promptKey]);
    },
    [pushTranscript, speakKeys],
  );

  /** "Gyae" during setup pauses onboarding - it never traps the user. */
  const exitOnboarding = useCallback(() => {
    pushTranscript('app', i18n.t('onboarding.exited'));
    void speakKeys(['onboarding.exited']);
    onDone();
  }, [onDone, pushTranscript, speakKeys]);

  const complete = useCallback(() => {
    void saveSettings({ onboardingComplete: true });
    onDone();
  }, [onDone]);

  // ---- microphone permission step -------------------------------------

  const requestMic = useCallback(async () => {
    try {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (result.granted) {
        setMicState('granted');
        pushTranscript('app', i18n.t('onboarding.micGranted'));
        void speakKeys(['onboarding.micGranted']);
        return;
      }
      if (result.canAskAgain === false) {
        setMicState('permanent');
        pushTranscript('app', i18n.t('onboarding.micPermanent'));
        void speakKeys(['onboarding.micPermanent']);
        return;
      }
      setMicState('denied');
    } catch {
      setMicState('denied');
    }
    pushTranscript('app', i18n.t('onboarding.micDenied'));
    void speakKeys(['onboarding.micDenied']);
  }, [pushTranscript, speakKeys]);

  // ---- microphone test step (one dictation utterance) -------------------

  const micRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onMicTestFinal = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      pushTranscript('user', trimmed.length > 0 ? trimmed : '…');
      setLastHeard(trimmed);
      void (async () => {
        const language = getAppLanguage();
        if (language === 'tw' || language === 'ee') {
          // The heard phrase itself is dynamic, so Twi/Ewe play the fixed
          // "you said" + "the microphone works" pair instead of raw TTS.
          await sayKeyAsync('vcmd.heard').catch(() => false);
          await sayKeyAsync('onboarding.micTestOk').catch(() => false);
        } else {
          announce(
            `${i18n.t('onboarding.micTestHeard', { text: trimmed })} ${i18n.t('onboarding.micTestOk')}`,
          );
        }
      })();
      if (micAdvanceTimerRef.current != null) clearTimeout(micAdvanceTimerRef.current);
      micAdvanceTimerRef.current = setTimeout(() => goTo('voiceTest'), 1600);
    },
    [goTo, pushTranscript],
  );

  const { dictationActive, preview, startDictation, stopDictation } =
    useScreenDictation(onMicTestFinal);

  // ---- voice output test step -------------------------------------------

  const playSample = useCallback(() => {
    void (async () => {
      await sayKeyAsync('settings.voiceSample').catch(() => false);
      const language = getAppLanguage();
      if (language !== 'tw' && language !== 'ee') {
        announce(i18n.t('settings.voiceSample'));
      }
    })();
  }, []);

  // ---- biometrics step ----------------------------------------------------

  useEffect(() => {
    if (step !== 'biometrics' || bio != null) return;
    let ignore = false;
    void (async () => {
      const [capability, typeName] = await Promise.all([
        getBiometricCapability(),
        getBiometricTypeName(),
      ]);
      if (ignore) return;
      setBio({ ...capability, typeName });
      const statusKey = !capability.hasHardware
        ? 'onboarding.bioNone'
        : !capability.isEnrolled
          ? 'onboarding.bioNotEnrolled'
          : 'onboarding.bioReady';
      pushTranscript('app', i18n.t(statusKey));
      await speakKeys([statusKey]);
    })();
    return () => {
      ignore = true;
    };
  }, [step, bio, pushTranscript, speakKeys]);

  const runBioTest = useCallback(async () => {
    if (bioBusy) return;
    setBioBusy(true);
    const result = await authenticateWithBiometrics(
      i18n.t('onboarding.bioTest'),
      i18n.t('common.cancel'),
    );
    setBioBusy(false);
    const key =
      result.status === 'success'
        ? 'onboarding.bioSuccess'
        : result.status === 'user_cancel'
          ? 'onboarding.bioCancelled'
          : result.status === 'lockout'
            ? 'onboarding.bioLockout'
            : 'onboarding.bioFailed';
    pushTranscript('app', i18n.t(key));
    await speakKeys([key]);
    if (result.status === 'success') {
      setTimeout(() => goTo('teach'), 1500);
    }
  }, [bioBusy, goTo, pushTranscript, speakKeys]);

  // ---- step entry side effects --------------------------------------------

  useEffect(() => {
    if (step !== 'mic') return;
    let ignore = false;
    void (async () => {
      try {
        const status = await ExpoSpeechRecognitionModule.getPermissionsAsync();
        if (ignore) return;
        if (status.granted) {
          setMicState('granted');
          pushTranscript('app', i18n.t('onboarding.micGranted'));
          void speakKeys(['onboarding.micGranted']);
        } else if (status.canAskAgain === false) {
          setMicState('permanent');
          pushTranscript('app', i18n.t('onboarding.micPermanent'));
          void speakKeys(['onboarding.micPermanent']);
        }
      } catch {
        // Status unknown - the Allow button and "yes" both can still ask.
      }
    })();
    return () => {
      ignore = true;
    };
  }, [step, pushTranscript, speakKeys]);

  useEffect(() => {
    if (step !== 'talkback') return;
    const statusKey = screenReaderOn ? 'onboarding.srOn' : 'onboarding.srOff';
    void (async () => {
      pushTranscript('app', i18n.t(statusKey));
      await speakKeys([statusKey]);
    })();
  }, [step, screenReaderOn, pushTranscript, speakKeys]);

  useEffect(() => {
    if (step !== 'micTest') {
      if (micRetryTimerRef.current != null) clearTimeout(micRetryTimerRef.current);
      return;
    }
    startDictation();
    // Silence is a dead end for a blind user: if nothing arrives, re-ask
    // once spoken and re-arm the mic.
    const reask = () => {
      pushTranscript('app', i18n.t('onboarding.micTestRetry'));
      void speakKeys(['onboarding.micTestRetry']);
      startDictation();
      micRetryTimerRef.current = setTimeout(reask, 12_000);
    };
    micRetryTimerRef.current = setTimeout(reask, 12_000);
    return () => {
      if (micRetryTimerRef.current != null) clearTimeout(micRetryTimerRef.current);
    };
  }, [step, startDictation, pushTranscript, speakKeys]);

  useEffect(() => {
    if (step !== 'voiceTest') return;
    void (async () => {
      await speakKeys(['onboarding.voiceTestBody', 'onboarding.voiceTestAsk']);
      playSample();
    })();
  }, [step, speakKeys, playSample]);

  useEffect(() => {
    return () => {
      if (micAdvanceTimerRef.current != null) clearTimeout(micAdvanceTimerRef.current);
      stopDictation();
    };
  }, [stopDictation]);

  // ---- voice answers --------------------------------------------------------

  const applyLanguage = useCallback(
    async (code: AppLanguage) => {
      await setAppLanguage(code);
      setLang(code);
      pushTranscript('app', i18n.t('onboarding.languageChanged'));
      await speakKeys(['onboarding.languageChanged']);
      // Re-ask in the newly chosen language so the user hears it switch.
      pushTranscript('app', i18n.t('onboarding.languageTitle'));
      await speakKeys(['onboarding.languageTitle']);
    },
    [pushTranscript, speakKeys],
  );

  const handleTeachUtterance = useCallback(
    (transcript: string) => {
      const intent = matchVoiceIntent(transcript);
      const key =
        intent === 'balance'
          ? 'onboarding.teachBalance'
          : intent === 'send'
            ? 'onboarding.teachSend'
            : intent === 'stop'
              ? 'onboarding.teachStop'
              : /\b(next|continue|done|ready)\b/.test(fold(transcript))
                ? null
                : 'onboarding.teachAgain';
      if (key == null) {
        goTo('done');
        return;
      }
      pushTranscript('app', i18n.t(key));
      void speakKeys([key]);
    },
    [goTo, pushTranscript, speakKeys],
  );

  const handleVoiceAnswer = useCallback(
    (transcript: string) => {
      const current = stepRef.current;
      const trimmed = transcript.trim();
      pushTranscript('user', trimmed);

      // Teach step intercepts the stop words: "gyae" is the lesson material,
      // not an exit request. Every other step treats it as cancel.
      if (current === 'teach') {
        handleTeachUtterance(trimmed);
        return;
      }
      if (isStopUtterance(trimmed)) {
        exitOnboarding();
        return;
      }

      switch (current) {
        case 'welcome':
          goTo('mic');
          return;
        case 'mic': {
          const answer = parseYesNo(trimmed);
          if (answer === 'yes') {
            void requestMic();
            return;
          }
          if (answer === 'no' || micState === 'granted' || micState === 'permanent') {
            goTo('listening');
            return;
          }
          void requestMic();
          return;
        }
        case 'listening':
        case 'contacts':
          goTo(NEXT_STEP[stepRef.current]);
          return;
        case 'language': {
          const matched = (SUPPORTED_LANGUAGES as readonly AppLanguage[]).find((code) =>
            LANGUAGE_WORDS[code].test(fold(trimmed)),
          );
          if (matched != null) {
            void applyLanguage(matched);
            return;
          }
          if (parseYesNo(trimmed) === 'yes' || ADVANCE_PATTERN.test(fold(trimmed))) {
            goTo('talkback');
            return;
          }
          pushTranscript('app', i18n.t('onboarding.languageTitle'));
          void speakKeys(['onboarding.languageTitle']);
          return;
        }
        case 'talkback': {
          const folded = fold(trimmed);
          const preset =
            /\b(linear|step|sequential|first|one|anammɔn)\b/.test(folded) ||
            parseYesNo(trimmed) === 'yes'
              ? 'linear'
              : /\b(spatial|grid|fixed|second|two|baabi)\b/.test(folded)
                ? 'spatial'
                : null;
          if (preset == null) {
            pushTranscript('app', i18n.t('onboarding.talkbackBody'));
            void speakKeys(['onboarding.talkbackBody']);
            return;
          }
          void saveSettings({ navPreset: preset });
          pushTranscript('app', i18n.t('onboarding.navSaved'));
          void speakKeys(['onboarding.navSaved']);
          goTo('micTest');
          return;
        }
        case 'micTest':
          // The dictation hook owns this step's utterance; anything that still
          // lands here (e.g. a command word) just re-arms the test.
          startDictation();
          return;
        case 'voiceTest': {
          const answer = parseYesNo(trimmed);
          if (answer === 'yes') {
            pushTranscript('app', i18n.t('onboarding.voiceTestOk'));
            void speakKeys(['onboarding.voiceTestOk']);
            goTo('biometrics');
            return;
          }
          pushTranscript('app', i18n.t('onboarding.voiceTestNo'));
          void speakKeys(['onboarding.voiceTestNo']);
          playSample();
          return;
        }
        case 'biometrics': {
          const answer = parseYesNo(trimmed);
          if (answer === 'no') {
            goTo('teach');
            return;
          }
          void runBioTest();
          return;
        }
        case 'done':
          complete();
          return;
        default:
          return;
      }
    },
    [
      applyLanguage,
      complete,
      exitOnboarding,
      goTo,
      handleTeachUtterance,
      micState,
      playSample,
      pushTranscript,
      requestMic,
      runBioTest,
      speakKeys,
      startDictation,
    ],
  );

  // The sink is created once and delegates to the newest handler, so the
  // provider can hold one stable object for the whole setup.
  const handlerRef = useRef<(transcript: string) => void>(() => {});
  const [sink] = useState<TranscriptSink>(() => ({
    isActive: () => true,
    handleTranscript: (transcript) => {
      handlerRef.current(transcript);
      return true;
    },
  }));
  useEffect(() => {
    handlerRef.current = handleVoiceAnswer;
  }, [handleVoiceAnswer]);
  useEffect(() => {
    onVoiceSink(sink);
    return () => onVoiceSink(null);
  }, [onVoiceSink, sink]);

  // ---- touch controls --------------------------------------------------------

  const stepIndex = STEP_ORDER.indexOf(step) + 1;
  const promptText = i18n.t(STEP_PROMPT_KEY[step]);

  const primary = (labelKey: string, action: () => void) => (
    <AccessibleButton
      label={t(labelKey)}
      hint={t('onboarding.nextHint')}
      variant="hero"
      onPress={() => {
        void hapticTick();
        action();
      }}
      style={styles.primaryButton}
    />
  );

  const skipButton = (
    <AccessibleButton
      label={t('onboarding.skip')}
      hint={t('onboarding.skipHint')}
      variant="outline"
      onPress={() => {
        void hapticTick();
        goTo(NEXT_STEP[step]);
      }}
      style={styles.secondaryButton}
    />
  );

  const chip = (
    selected: boolean,
    label: string,
    hint: string,
    onPress: () => void,
  ) => (
    <AccessibleButton
      label={`${selected ? '✓ ' : ''}${label}`}
      hint={hint}
      accessibilityState={selected ? { selected: true } : undefined}
      variant={selected ? 'momo' : 'outline'}
      onPress={() => {
        void hapticTick();
        onPress();
      }}
      style={[styles.chip, selected ? styles.selectedChip : null]}
    />
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          {t('onboarding.screenTitle')}
        </Text>
        <Text style={styles.stepLine}>
          {t('onboarding.stepOf', { x: stepIndex, y: STEP_ORDER.length })}
        </Text>
      </View>

      <ScrollView
        style={styles.transcript}
        contentContainerStyle={styles.transcriptContent}
        accessibilityLabel={t('onboarding.screenTitle')}
        accessibilityHint={t('onboarding.screenTitle')}
      >
        {transcript.map((entry, index) => (
          <View key={`${entry.speaker}-${index}`} style={styles.entry}>
            <Text style={entry.speaker === 'app' ? styles.appLabel : styles.userLabel}>
              {entry.speaker === 'app' ? t('app.name') : t('vcmd.heard')}
            </Text>
            <Text style={styles.entryText}>{entry.text}</Text>
          </View>
        ))}
      </ScrollView>

      {/* The live region re-announces the question when the step changes, so
          TalkBack users hear the new step without hunting for it. */}
      <View style={styles.currentPrompt} accessibilityLiveRegion="polite">
        <Text style={styles.prompt}>{promptText}</Text>
        {step === 'micTest' && (dictationActive || preview != null) ? (
          <Text style={styles.previewLine}>
            {preview != null && preview.trim().length > 0
              ? `${t('voice.dictationPreview')} ${preview}`
              : t('voice.listening')}
          </Text>
        ) : null}
        {lastHeard != null && step !== 'micTest' ? (
          <Text style={styles.heardLine}>
            {t('vcmd.heard')}: {lastHeard}
          </Text>
        ) : null}
      </View>

      <View style={styles.controls}>
        {step === 'welcome' ? primary('onboarding.start', () => goTo('mic')) : null}

        {step === 'mic' ? (
          <>
            {micState === 'granted' || micState === 'permanent'
              ? primary('onboarding.next', () => goTo('listening'))
              : primary(
                  'onboarding.micAllow',
                  () => void requestMic(),
                )}
            {skipButton}
          </>
        ) : null}

        {step === 'listening' || step === 'contacts' ? (
          <>
            {primary('onboarding.next', () => goTo(NEXT_STEP[step]))}
            {skipButton}
          </>
        ) : null}

        {step === 'language' ? (
          <>
            <View
              accessible
              accessibilityRole="radiogroup"
              accessibilityLabel={t('onboarding.languageTitle')}
              accessibilityHint={t('common.languageSwitchHint')}
              style={styles.chipColumn}
            >
              {(SUPPORTED_LANGUAGES as readonly AppLanguage[]).map((code) =>
                chip(
                  lang === code,
                  LANGUAGE_NAMES[code],
                  t('common.languageSwitchHint'),
                  () => void applyLanguage(code),
                ),
              )}
            </View>
            {primary('onboarding.next', () => goTo('talkback'))}
          </>
        ) : null}

        {step === 'talkback' ? (
          <>
            <View
              accessible
              accessibilityRole="radiogroup"
              accessibilityLabel={t('onboarding.talkbackTitle')}
              accessibilityHint={t('onboarding.talkbackBody')}
              style={styles.chipColumn}
            >
              {chip(
                true,
                t('onboarding.navLinear'),
                t('settings.navLinearDesc'),
                () => {
                  void saveSettings({ navPreset: 'linear' });
                  goTo('micTest');
                },
              )}
              {chip(
                false,
                t('onboarding.navSpatial'),
                t('settings.navSpatialDesc'),
                () => {
                  void saveSettings({ navPreset: 'spatial' });
                  goTo('micTest');
                },
              )}
            </View>
            {skipButton}
          </>
        ) : null}

        {step === 'micTest' ? (
          <>
            <Text style={styles.statusLine}>
              {dictationActive ? t('voice.listening') : t('onboarding.micTestBody')}
            </Text>
            {skipButton}
          </>
        ) : null}

        {step === 'voiceTest' ? (
          <>
            <AccessibleButton
              label={t('onboarding.voiceTestPlayAgain')}
              hint={t('onboarding.voiceTestBody')}
              variant="secondary"
              onPress={() => {
                void hapticTick();
                playSample();
              }}
              style={styles.secondaryButton}
            />
            {primary('onboarding.next', () => goTo('biometrics'))}
            {skipButton}
          </>
        ) : null}

        {step === 'biometrics' ? (
          <>
            {bio != null && bio.hasHardware && bio.isEnrolled
              ? primary('onboarding.bioTest', () => void runBioTest())
              : primary('onboarding.next', () => goTo('teach'))}
            {skipButton}
          </>
        ) : null}

        {step === 'teach' ? primary('onboarding.teachNext', () => goTo('done')) : null}

        {step === 'done' ? primary('onboarding.doneFinish', complete) : null}
      </View>
    </View>
  );
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
    paddingBottom: theme.spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: theme.typography.heading,
    fontWeight: '900',
    color: colors.navyMidnight,
    flex: 1,
  },
  stepLine: {
    fontSize: theme.typography.small,
    fontWeight: '900',
    color: colors.goldInk,
  },
  transcript: {
    flex: 1,
  },
  transcriptContent: {
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  entry: {
    backgroundColor: colors.surface,
    borderRadius: theme.radii.md,
    borderLeftWidth: 5,
    borderLeftColor: colors.safepayBlue,
    padding: theme.spacing.sm,
    gap: 2,
  },
  appLabel: {
    fontSize: theme.typography.tiny,
    fontWeight: '900',
    color: colors.safepayBlue,
  },
  userLabel: {
    fontSize: theme.typography.tiny,
    fontWeight: '900',
    color: colors.goldInk,
  },
  entryText: {
    fontSize: theme.typography.body,
    lineHeight: 24,
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
  prompt: {
    fontSize: theme.typography.subheading,
    lineHeight: 27,
    fontWeight: '800',
    color: colors.text,
  },
  heardLine: {
    fontSize: theme.typography.small,
    fontWeight: '700',
    color: colors.textMuted,
  },
  previewLine: {
    fontSize: theme.typography.small,
    fontWeight: '700',
    color: colors.safepayBlue,
  },
  statusLine: {
    fontSize: theme.typography.body,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  controls: {
    gap: theme.spacing.sm,
  },
  chipColumn: {
    gap: theme.spacing.xs,
  },
  chip: {
    minHeight: theme.touchTarget.minSize,
    borderRadius: theme.radii.md,
  },
  // WCAG 2.2: selection is carried by the ✓ prefix and a bolder border, never
  // by colour alone.
  selectedChip: {
    borderWidth: 2.5,
    borderColor: colors.navyMidnight,
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: theme.radii.lg,
  },
  secondaryButton: {
    minHeight: 52,
  },
}));
