import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import {Image, Text, View} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { I18nextProvider } from 'react-i18next';

import { announce } from './src/a11y/announcer';
import { initScreenReaderState, needsOwnVoice } from './src/a11y/screenReader';
import { i18n, initI18n } from './src/i18n';
import { formatMoney, getBalance } from './src/services/transactions';
import { stopSpeaking, warmUpSpeech } from './src/services/speech';
import { VoiceCommandProvider } from './src/voice/VoiceCommandProvider';
import { VoiceFlowController } from './src/voice/VoiceFlowController';
import { sayKey, sayPlan, type SayPlan } from './src/voice/say';
import { configureVoiceAudioMode } from './src/voice/voicePack';
import { getCachedSettings, loadSettings } from './src/services/settings';
import type { VoiceIntent } from './src/voice/commands';
import { BuyAirtimeScreen } from './src/screens/BuyAirtimeScreen';
import { CashOutScreen } from './src/screens/CashOutScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { SendMoneyScreen } from './src/screens/SendMoneyScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SmsImportScreen } from './src/screens/SmsImportScreen';
import { StatementScreen } from './src/screens/StatementScreen';
import { VoiceFlowHud } from './src/components/VoiceFlowHud';
import type { TranscriptSink } from './src/voice/VoiceCommandProvider';
import type { VoiceFlowStatus } from './src/voice/VoiceFlowController';
import { theme, themedStyles } from './src/constants/theme';
import { ContrastThemeProvider, useContrastTheme } from './src/theme/ContrastThemeProvider';

/* The branded launch screen is drawn by the app itself (LoadingView below),
   not by the OS: the native splash icon is unreliable on OEM Android skins,
   which render the splash background but drop the icon. This view is plain
   React Native, so it renders everywhere — it just needs a minimum dwell time,
   otherwise i18n init wins the race and the logo flashes for a single frame. */
const LAUNCH_MIN_VISIBLE_MS = 900;

/** Spoken welcome is read once per install, for users without a screen reader. */
const WELCOME_SEEN_KEY = 'sikavoice.welcomeSpoken';

export default function App() {
  const [ready, setReady] = useState(false);
  const [minElapsed, setMinElapsed] = useState(false);
  const welcomeHandled = useRef(false);

  useEffect(() => {
    void (async () => {
      try {
        await initI18n();
        // Settings must be known before the navigator mounts, so the
        // always-on voice listener honours the user's saved choice.
        await loadSettings();
        // Know whether a screen reader is running before anything is spoken, so
        // the app never talks over TalkBack and never stays silent without it.
        await initScreenReaderState();
        // Probe the TTS engine up front: the first utterance is otherwise
        // delayed (or dropped) while the engine initialises.
        warmUpSpeech();
        // Clips must play even with the ringer off - a blind user has no
        // visual cue that a silent phone missed a prompt.
        await configureVoiceAudioMode();
      } finally {
        setReady(true);
      }
    })();
    const timer = setTimeout(() => setMinElapsed(true), LAUNCH_MIN_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, []);

  const booted = ready && minElapsed;

  /**
   * Spoken orientation on first launch. Blind users who have not enabled
   * TalkBack get instructions from the app itself instead of a silent screen.
   */
  useEffect(() => {
    if (!booted || welcomeHandled.current) return;
    welcomeHandled.current = true;
    void (async () => {
      try {
        const seen = await AsyncStorage.getItem(WELCOME_SEEN_KEY);
        if (seen === 'true') {
          announce(i18n.t('home.greeting'));
          return;
        }
        // Mark seen unconditionally so the boot welcome never replays after
        // onboarding: the onboarding state machine owns the first-launch
        // orientation when it has not completed yet.
        await AsyncStorage.setItem(WELCOME_SEEN_KEY, 'true');
        if (!getCachedSettings().onboardingComplete) return;
        // Speak directly: the welcome must be audible before the user has
        // touched anything. With a screen reader running we hand the text over
        // instead, so the two voices never talk over each other.
        if (needsOwnVoice()) sayKey('onboarding.voiceWelcome');
        else announce(i18n.t('onboarding.voiceWelcome'));
      } catch {
        // Storage unavailable: skip the one-time welcome.
      }
    })();
  }, [booted]);

  return (
    <SafeAreaProvider>
      {/* Android 15+ forces edge-to-edge, so the app must inset itself or the
          header renders under the status bar clock and battery icons. */}
      <SafeAreaView style={styles.root} edges={['top']}>
        <ContrastThemeProvider>
          <I18nextProvider i18n={i18n}>
            <Suspense fallback={null}>
              {booted ? <RootNavigator /> : <LoadingView />}
            </Suspense>
            <StatusBar style="dark" />
          </I18nextProvider>
        </ContrastThemeProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

type Screen = 'onboarding' | 'home' | 'send' | 'statement' | 'airtime' | 'cashout' | 'settings' | 'sms';

function RootNavigator() {
  const { palette } = useContrastTheme();
  // First run starts in the onboarding state machine, not on Home: a blind
  // user must be oriented and have permissions explained before anything else.
  const [screen, setScreen] = useState<Screen>(
    getCachedSettings().onboardingComplete ? 'home' : 'onboarding',
  );
  const home = () => setScreen('home');
  /** Visible mirror of the active voice conversation (VoiceFlowHud). */
  const [flowStatus, setFlowStatus] = useState<VoiceFlowStatus | null>(null);
  /** Onboarding owns the mic's utterances while it is mounted (Phase 2). */
  const [onboardingSink, setOnboardingSink] = useState<TranscriptSink | null>(null);

  /**
   * Conversational flow driver: money features started by voice become a
   * spoken dialogue (who -> how much -> read-back -> yes/no -> result) instead
   * of dropping the blind user on a form they cannot see. Created once in a
   * lazy state initializer, so its identity is stable for the provider.
   */
  const [flowController] = useState(
    () =>
      new VoiceFlowController({
        navigate: (next) => setScreen(next),
        onDone: () => {
          setFlowStatus(null);
          setScreen('home');
        },
        onStatus: setFlowStatus,
      }),
  );

  /**
   * Spoken commands, handled where navigation actually lives.
   *
   * Every branch confirms out loud before moving, because a user who cannot see
   * the screen must never be left guessing whether their command was heard.
   */
  const handleVoiceIntent = useCallback(
    (intent: VoiceIntent) => {
    // Feature names are fixed phrases, so they play as native Twi/Ewe clips
    // when one exists and fall back to device TTS otherwise.
    const open = (clipKey: string) => {
      sayKey(clipKey);
    };

    switch (intent) {
      case 'balance': {
        flowController.cancel(true);
        setScreen('home');
        void (async () => {
          const balance = await getBalance();
          // Composed natively: vcmd.balanceIs clip + native number atoms for
          // the amount - never the English-accented device voice.
          const plan: SayPlan = [
            { kind: 'key', key: 'vcmd.balanceIs' },
            { kind: 'money', amount: balance },
          ];
          sayPlan(plan, {
            fallback: () =>
              announce(`${i18n.t('vcmd.balanceIs')} ${formatMoney(balance)}`),
          });
        })();
        return;
      }
      case 'statement':
        flowController.cancel(true);
        open('home.statement');
        setScreen('statement');
        return;
      case 'send':
        // Voice-initiated: run the full spoken dialogue flow.
        flowController.start({ kind: 'send' });
        return;
      case 'airtime':
        flowController.start({ kind: 'airtime', self: false });
        return;
      case 'cashout':
        flowController.start({ kind: 'cashout' });
        return;
      case 'settings':
        flowController.cancel(true);
        open('settings.title');
        setScreen('settings');
        return;
      case 'home':
        flowController.cancel(true);
        setScreen('home');
        announce(i18n.t('home.greeting'));
        return;
      case 'help':
        flowController.cancel(true);
        stopSpeaking();
        sayKey('vcmd.helpNative');
        return;
      default:
        return;
    }
    },
    [flowController],
  );

  const content = (() => {
    switch (screen) {
      case 'onboarding':
        return <OnboardingScreen onDone={home} onVoiceSink={setOnboardingSink} />;
      case 'send':
        return <SendMoneyScreen onDone={home} />;
      case 'statement':
        return <StatementScreen onDone={home} />;
      case 'airtime':
        return <BuyAirtimeScreen onDone={home} />;
      case 'cashout':
        return <CashOutScreen onDone={home} />;
      case 'settings':
        return (
          <SettingsScreen
            onDone={home}
            onRunSetup={() => setScreen('onboarding')}
          />
        );
      case 'sms':
        return <SmsImportScreen onDone={home} onViewStatement={() => setScreen('statement')} />;
      default:
        return (
          <HomeScreen
            onSendMoney={() => flowController.start({ kind: 'send' })}
            onViewStatement={() => setScreen('statement')}
            onBuyAirtime={() => flowController.start({ kind: 'airtime', self: false })}
            onCashOut={() => flowController.start({ kind: 'cashout' })}
            onOpenSettings={() => setScreen('settings')}
            onOpenSms={() => setScreen('sms')}
          />
        );
    }
  })();

  return (
    // Keyed by palette so every screen repaints with the new colours, while the
    // navigation state above stays put — changing contrast must not navigate.
    <View key={palette} style={styles.screenBoundary}>
      {/* Voice-first: the mic opens on launch (autoStart) and stays open
          between utterances (alwaysOn), so a blind user never has to find
          the mic button to issue the next command. During onboarding the
          mic's utterances route to the setup flow instead of commands. */}
      <VoiceCommandProvider
        onIntent={handleVoiceIntent}
        autoStart={getCachedSettings().autoListen}
        flowController={onboardingSink ?? flowController}
      >
        {flowStatus == null ? content : (
          <VoiceFlowHud
            status={flowStatus}
            onCancel={() => flowController.cancel(false)}
          />
        )}
      </VoiceCommandProvider>
    </View>
  );
}

/**
 * Rendered before i18n finishes initializing, so it must not call
 * useTranslation (the instance is not ready and the tree would suspend).
 */
function LoadingView() {
  return (
    <View style={styles.loading}>
      <Image
        source={require('./assets/safepay-logo-transparent.png')}
        style={styles.loadingLogo}
        resizeMode="contain"
        accessibilityLabel="SafePay logo"
        accessibilityHint="SafePay brand identity logo"
        accessibilityIgnoresInvertColors
      />
      <Text accessibilityRole="header" style={styles.loadingText}>
        SafePay
      </Text>
      <Text style={styles.loadingSubtext}>MTN MoMo Accessibility Companion</Text>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  screenBoundary: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // Matches the native splash background (app.json) and the page colour, so
    // the hand-off splash -> this view -> Home is one continuous surface.
    backgroundColor: colors.background,
    gap: theme.spacing.xs,
  },
  loadingLogo: {
    width: 140,
    height: 140,
  },
  loadingText: {
    fontSize: theme.typography.title,
    fontWeight: '900',
    color: colors.safepayBlue,
    letterSpacing: -0.5,
  },
  loadingSubtext: {
    fontSize: theme.typography.small,
    fontWeight: '600',
    color: colors.textMuted,
  },
}));
