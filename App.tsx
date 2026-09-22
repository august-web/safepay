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
import { sayKey } from './src/voice/say';
import type { VoiceIntent } from './src/voice/commands';
import { BuyAirtimeScreen } from './src/screens/BuyAirtimeScreen';
import { CashOutScreen } from './src/screens/CashOutScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { SendMoneyScreen } from './src/screens/SendMoneyScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SmsImportScreen } from './src/screens/SmsImportScreen';
import { StatementScreen } from './src/screens/StatementScreen';
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
        // Know whether a screen reader is running before anything is spoken, so
        // the app never talks over TalkBack and never stays silent without it.
        await initScreenReaderState();
        // Probe the TTS engine up front: the first utterance is otherwise
        // delayed (or dropped) while the engine initialises.
        warmUpSpeech();
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
        // Speak directly: the welcome must be audible before the user has
        // touched anything. With a screen reader running we hand the text over
        // instead, so the two voices never talk over each other.
        if (needsOwnVoice()) sayKey('onboarding.voiceWelcome');
        else announce(i18n.t('onboarding.voiceWelcome'));
        await AsyncStorage.setItem(WELCOME_SEEN_KEY, 'true');
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

type Screen = 'home' | 'send' | 'statement' | 'airtime' | 'cashout' | 'settings' | 'sms';

function RootNavigator() {
  const { palette } = useContrastTheme();
  const [screen, setScreen] = useState<Screen>('home');
  const home = () => setScreen('home');

  /**
   * Spoken commands, handled where navigation actually lives.
   *
   * Every branch confirms out loud before moving, because a user who cannot see
   * the screen must never be left guessing whether their command was heard.
   */
  const handleVoiceIntent = useCallback((intent: VoiceIntent) => {
    // Feature names are fixed phrases, so they play as native Twi/Ewe clips
    // when one exists and fall back to device TTS otherwise.
    const open = (clipKey: string) => {
      sayKey(clipKey);
    };

    switch (intent) {
      case 'balance': {
        setScreen('home');
        void (async () => {
          const balance = await getBalance();
          announce(`${i18n.t('home.balanceLabel')}: ${formatMoney(balance)}`);
        })();
        return;
      }
      case 'statement':
        open('home.statement');
        setScreen('statement');
        return;
      case 'send':
        open('home.sendMoney');
        setScreen('send');
        return;
      case 'airtime':
        open('home.buyAirtime');
        setScreen('airtime');
        return;
      case 'cashout':
        open('home.cashOut');
        setScreen('cashout');
        return;
      case 'settings':
        open('settings.title');
        setScreen('settings');
        return;
      case 'home':
        setScreen('home');
        announce(i18n.t('home.greeting'));
        return;
      case 'help':
        stopSpeaking();
        sayKey('voice.help');
        return;
      default:
        return;
    }
  }, []);

  const content = (() => {
    switch (screen) {
      case 'send':
        return <SendMoneyScreen onDone={home} />;
      case 'statement':
        return <StatementScreen onDone={home} />;
      case 'airtime':
        return <BuyAirtimeScreen onDone={home} />;
      case 'cashout':
        return <CashOutScreen onDone={home} />;
      case 'settings':
        return <SettingsScreen onDone={home} />;
      case 'sms':
        return <SmsImportScreen onDone={home} onViewStatement={() => setScreen('statement')} />;
      default:
        return (
          <HomeScreen
            onSendMoney={() => setScreen('send')}
            onViewStatement={() => setScreen('statement')}
            onBuyAirtime={() => setScreen('airtime')}
            onCashOut={() => setScreen('cashout')}
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
      <VoiceCommandProvider onIntent={handleVoiceIntent}>{content}</VoiceCommandProvider>
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
        accessibilityLabel="SafePay Logo"
        accessibilityHint="SafePay brand identity logo"
        accessibilityIgnoresInvertColors
      />
      <Text accessibilityRole="header" style={styles.loadingText}>
        SafePay
      </Text>
      <Text style={styles.loadingSubtext}>MoMo Accessibility Companion</Text>
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
