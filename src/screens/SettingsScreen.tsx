import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { announce, voiceChannel } from '../a11y/announcer';
import { useEarLight, useSpotlight } from '../a11y/spotlight';
import { HeaderBar } from '../components/HeaderBar';
import { THEME_PALETTE_NAMES, theme, themedStyles } from '../constants/theme';
import { getAppLanguage, setAppLanguage, SUPPORTED_LANGUAGES, type AppLanguage } from '../i18n';
import { hapticCycle, hapticTick, hapticWrap } from '../services/haptics';
import { useAudioRoute } from '../services/headphones';
import {
  getCachedSettings,
  loadSettings,
  saveSettings,
  type NavPreset,
  type PrivacyMode,
} from '../services/settings';
import {
  ttsVoiceStatusFor,
  voiceStatusFor,
  warmUpSpeech,
  type TtsVoiceStatus,
} from '../services/speech';
import { useContrastTheme } from '../theme/ContrastThemeProvider';
import { useVoiceCommands } from '../voice/VoiceCommandProvider';
import { sayKey } from '../voice/say';
import { voiceClipCount } from '../voice/voicePack';

/**
 * Settings for ears first, built the same way Home was: one focus stop per
 * decision, the whole option list spoken in the hint so nothing is hidden
 * behind a screen, and the screen lit by what the app is saying.
 *
 * Each setting is one stop that moves to its next value when double-tapped.
 * A cycle control normally hides its choices from someone who cannot see the
 * display, so the hint always reads the full list - you hear every option
 * before you spend taps finding it.
 */

const SPOT_NAV = 'set:nav';
const SPOT_SPEED = 'set:speed';
const SPOT_PRIVACY = 'set:privacy';
const SPOT_CONTRAST = 'set:contrast';
const SPOT_LANGUAGE = 'set:language';
const SPOT_LISTEN = 'set:listen';
const SPOT_VOICE = 'set:voice';
const SPOT_DIAG = 'set:diag';
const SPOT_SETUP = 'set:setup';
const SPOT_DONE = 'set:done';

const RATE_BY_VALUE: Record<string, number> = { slow: 0.75, standard: 0.85, fast: 1.0 };
const VALUE_BY_RATE: Record<string, string> = { '0.75': 'slow', '0.85': 'standard', '1': 'fast' };

interface SayOptions {
  rate?: number;
  language?: AppLanguage;
}

interface CycleSpec {
  id: string;
  /** i18n key of the setting's name. */
  nameKey: string;
  /** i18n key prefix the values live under, e.g. `settings.navValue`. */
  valueBase: string;
  values: readonly string[];
  current: string;
  apply: (value: string) => void;
  /**
   * How to say the value that was just chosen. The speed stop speaks at the
   * rate it picked, so the confirmation demonstrates the setting.
   */
  sayAs?: (value: string) => SayOptions;
}

export interface SettingsScreenProps {
  onDone: () => void;
  /** When present, offers the Phase 2 onboarding walkthrough again. */
  onRunSetup?: () => void;
}

export function SettingsScreen({ onDone, onRunSetup }: SettingsScreenProps) {
  const { t } = useTranslation();

  const [navPreset, setNavPreset] = useState<NavPreset>(getCachedSettings().navPreset);
  const [speechRate, setSpeechRate] = useState<number>(getCachedSettings().speechRate);
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>(getCachedSettings().privacyMode);
  const [autoListen, setAutoListen] = useState<boolean>(getCachedSettings().autoListen);

  const [language, setLanguage] = useState<AppLanguage>(getAppLanguage());
  const [diagOpen, setDiagOpen] = useState(false);
  const [testPhrase, setTestPhrase] = useState('');
  const [tts, setTts] = useState<TtsVoiceStatus | null>(null);

  const { palette, setPalette } = useContrastTheme();
  const audioRoute = useAudioRoute();
  const channel = voiceChannel();
  const voice = voiceStatusFor(language);
  const clipCount = voiceClipCount(language);
  const spot = useSpotlight();
  const light = useEarLight();
  const { injectTranscript } = useVoiceCommands();

  useEffect(() => {
    warmUpSpeech();
    let ignore = false;
    void (async () => {
      const s = await loadSettings();
      if (!ignore) {
        setNavPreset(s.navPreset);
        setSpeechRate(s.speechRate);
        setPrivacyMode(s.privacyMode);
        setAutoListen(s.autoListen);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    void ttsVoiceStatusFor(language).then((status) => {
      if (!ignore) setTts(status);
    });
    return () => {
      ignore = true;
    };
  }, [language]);

  /**
   * Says a state change on whichever channel the user is hearing: the screen
   * reader's own voice when one is running, otherwise the app's bundled native
   * clip. Never both, or the user hears the same word twice.
   */
  const say = (key: string, options: SayOptions = {}) => {
    const text = options.language != null ? t(key, { lng: options.language }) : t(key);
    if (channel === 'screenReader') {
      announce(text);
      return;
    }
    if (sayKey(key, { ...options, fallbackText: text }) !== 'clip') announce(text);
  };

  const specs: CycleSpec[] = [
    {
      id: SPOT_NAV,
      nameKey: 'settings.navSection',
      valueBase: 'settings.navValue',
      values: ['linear', 'spatial'],
      current: navPreset,
      apply: (value) => {
        const next = value as NavPreset;
        setNavPreset(next);
        void saveSettings({ navPreset: next });
      },
    },
    {
      id: SPOT_SPEED,
      nameKey: 'settings.voiceSection',
      valueBase: 'settings.speedValue',
      values: ['slow', 'standard', 'fast'],
      current: VALUE_BY_RATE[String(speechRate)] ?? 'standard',
      apply: (value) => {
        const next = RATE_BY_VALUE[value] ?? 0.85;
        setSpeechRate(next);
        void saveSettings({ speechRate: next });
      },
      sayAs: (value) => ({ rate: RATE_BY_VALUE[value] }),
    },
    {
      id: SPOT_PRIVACY,
      nameKey: 'settings.privacySection',
      valueBase: 'settings.privacyValue',
      values: ['auto', 'voice', 'haptic'],
      current: privacyMode,
      apply: (value) => {
        const next = value as PrivacyMode;
        setPrivacyMode(next);
        void saveSettings({ privacyMode: next });
      },
    },
    {
      id: SPOT_CONTRAST,
      nameKey: 'settings.contrastSection',
      valueBase: 'settings.contrastValue',
      values: THEME_PALETTE_NAMES,
      current: palette,
      apply: (value) => setPalette(value as (typeof THEME_PALETTE_NAMES)[number]),
    },
    {
      id: SPOT_LANGUAGE,
      nameKey: 'common.language',
      valueBase: 'settings.languageValue',
      values: SUPPORTED_LANGUAGES,
      current: language,
      apply: (value) => {
        const next = value as AppLanguage;
        void setAppLanguage(next);
        setLanguage(next);
      },
      // Answers in the language just chosen, so the change proves itself.
      sayAs: (value) => ({ language: value as AppLanguage }),
    },
    {
      id: SPOT_LISTEN,
      nameKey: 'settings.autoListen',
      valueBase: 'settings.listenValue',
      values: ['on', 'off'],
      current: autoListen ? 'on' : 'off',
      apply: (value) => {
        const next = value === 'on';
        setAutoListen(next);
        void saveSettings({ autoListen: next });
      },
    },
  ];

  const testVoice = () => {
    light(SPOT_VOICE);
    void hapticTick();
    say('settings.voiceSample');
  };

  const runPipelineTest = () => {
    const phrase = testPhrase.trim();
    if (phrase.length === 0) return;
    light(SPOT_DIAG);
    void hapticTick();
    injectTranscript(phrase);
    announce(t('settings.testPipelineDone'));
  };

  /**
   * The instruments a sighted developer reads (which TTS tier answered, how
   * much quota is left, the clip count, the typed pipeline test) are not
   * something a blind MoMo user can operate, so they live behind one stop that
   * says the headline out loud and opens only when asked.
   */
  const toggleDiagnostics = () => {
    const next = !diagOpen;
    setDiagOpen(next);
    light(SPOT_DIAG);
    void (next ? hapticCycle() : hapticTick());
    say('settings.voiceCheckSection');
  };

  const diagSummary =
    tts == null
      ? t('settings.voiceTtsLoading')
      : t('settings.diagSummary', {
          channel: t(`settings.diagChannel.${tts.channel}`),
          remaining: `${tts.remaining}`,
        });

  return (
    <View style={styles.screen}>
      <HeaderBar
        title={t('settings.titleShort')}
        subtitle={t('settings.subtitle')}
        showBack
        onBack={onDone}
      />

      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {specs.map((spec, index) => (
          <View key={spec.id}>
            <CycleRow spec={spec} spot={spot} light={light} say={say} />
            {index === specs.length - 1 ? null : <View style={styles.divider} />}
          </View>
        ))}

        <ActionRow
          id={SPOT_VOICE}
          spot={spot}
          light={light}
          label={t('settings.testVoice')}
          hint={t('settings.testVoiceHint')}
          onPress={testVoice}
        />

        {diagOpen ? (
          <View style={styles.diagBlock}>
            <Text style={styles.statusLine}>
              {channel === 'tts'
                ? t('settings.voiceChannelTts')
                : t('settings.voiceChannelScreenReader')}
            </Text>
            <Text style={styles.statusLine}>
              {audioRoute.isPrivate
                ? t('settings.voiceRoutePrivate', {
                    devices: audioRoute.devices.join(', ') || t('settings.voiceFallback'),
                  })
                : t('settings.voiceRoutePublic')}
            </Text>
            <Text style={styles.statusLine}>
              {t('settings.voiceLocaleLine', {
                locale: voice.requested,
                voice: voice.voice ?? t('settings.voiceFallback'),
              })}
            </Text>
            {clipCount > 0 ? (
              <Text style={styles.statusLine}>
                {t('settings.voiceClipLine', { count: clipCount })}
              </Text>
            ) : null}
            <Text style={styles.statusLine}>
              {tts == null
                ? t('settings.voiceTtsLoading')
                : tts.channel === 'lab'
                  ? t('settings.voiceTtsChannelLab', {
                      remaining: tts.remaining,
                      limit: tts.limit,
                    })
                  : tts.channel === 'public'
                    ? t('settings.voiceTtsChannelPublic')
                    : t('settings.voiceTtsChannelDevice')}
            </Text>

            <Text style={styles.fieldLabel}>{t('settings.testPipelineTitle')}</Text>
            <TextInput
              value={testPhrase}
              onChangeText={setTestPhrase}
              placeholder={t('settings.testPipelineField')}
              placeholderTextColor={theme.colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={t('settings.testPipelineField')}
              accessibilityHint={t('settings.testPipelineHint')}
              style={styles.pipelineField}
            />
            <ActionRow
              id={`${SPOT_DIAG}:run`}
              spot={spot}
              light={light}
              label={t('settings.testPipelineRun')}
              hint={t('settings.testPipelineRunHint')}
              onPress={runPipelineTest}
              disabled={testPhrase.trim().length === 0}
              compact
            />
            <ActionRow
              id={`${SPOT_DIAG}:close`}
              spot={spot}
              light={light}
              label={t('common.close')}
              hint={t('settings.diagCloseHint')}
              onPress={toggleDiagnostics}
              compact
            />
          </View>
        ) : (
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel={`${t('settings.voiceCheckSection')}: ${diagSummary}`}
            accessibilityHint={t('settings.diagOpenHint')}
            accessibilityState={{ expanded: false }}
            onFocus={() => light(SPOT_DIAG)}
            onPressIn={() => {
              void hapticTick();
              light(SPOT_DIAG);
            }}
            onPress={toggleDiagnostics}
            style={({ pressed }) => [
              styles.row,
              spot === SPOT_DIAG ? styles.rowLit : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text
              style={[styles.rowCaption, recede(spot, SPOT_DIAG) ? styles.textReceded : null]}
              numberOfLines={1}
            >
              {t('settings.voiceCheckSection')}
            </Text>
            <Text
              style={[styles.rowValue, recede(spot, SPOT_DIAG) ? styles.textReceded : null]}
              numberOfLines={1}
            >
              {diagSummary}
            </Text>
          </Pressable>
        )}

        {onRunSetup != null ? (
          <ActionRow
            id={SPOT_SETUP}
            spot={spot}
            light={light}
            label={t('settings.runSetup')}
            hint={t('settings.runSetupHint')}
            onPress={() => {
              light(SPOT_SETUP);
              void hapticTick();
              onRunSetup();
            }}
          />
        ) : null}

        <ActionRow
          id={SPOT_DONE}
          spot={spot}
          light={light}
          label={t('common.back')}
          hint={t('common.backHint')}
          large
          onPress={() => {
            light(SPOT_DONE);
            void hapticTick();
            onDone();
          }}
        />
      </ScrollView>
    </View>
  );
}

interface CycleRowProps {
  spec: CycleSpec;
  spot: string | null;
  light: (id: string) => void;
  say: (key: string, options?: SayOptions) => void;
}

/** One decision, one stop: the name, the value, and the whole list in the hint. */
function CycleRow({ spec, spot, light, say }: CycleRowProps) {
  const { t } = useTranslation();
  const index = Math.max(0, spec.values.indexOf(spec.current));
  const name = t(spec.nameKey);
  const value = t(`${spec.valueBase}.${spec.current}`);
  const receded = recede(spot, spec.id);

  const advance = () => {
    const nextIndex = (index + 1) % spec.values.length;
    const next = spec.values[nextIndex];
    spec.apply(next);
    light(spec.id);
    // Wrapping back to the first value is felt differently from a normal step,
    // so the user knows they have been all the way round without counting taps.
    void (nextIndex === 0 ? hapticWrap() : hapticCycle());
    say(`${spec.valueBase}.${next}`, spec.sayAs?.(next));
  };

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${name}: ${value}`}
      accessibilityHint={t('settings.cycleHint', {
        options: spec.values.map((value2) => t(`${spec.valueBase}.${value2}`)).join(', '),
      })}
      onFocus={() => light(spec.id)}
      onPressIn={() => {
        void hapticTick();
        light(spec.id);
      }}
      onPress={advance}
      style={({ pressed }) => [
        styles.row,
        spot === spec.id ? styles.rowLit : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.rowCaption, receded ? styles.textReceded : null]} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[styles.rowValue, receded ? styles.textReceded : null]} numberOfLines={1}>
        {value}
      </Text>
    </Pressable>
  );
}

interface ActionRowProps {
  id: string;
  spot: string | null;
  light: (id: string) => void;
  label: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
  compact?: boolean;
  large?: boolean;
}

/** A plain action: one focus stop, nothing inside it separately reachable. */
function ActionRow({
  id,
  spot,
  light,
  label,
  hint,
  onPress,
  disabled,
  compact,
  large,
}: ActionRowProps) {
  const receded = recede(spot, id);
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled}
      onFocus={() => {
        if (!disabled) light(id);
      }}
      onPressIn={() => {
        if (disabled) return;
        void hapticTick();
        light(id);
      }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        compact ? styles.rowCompact : null,
        large ? styles.rowLarge : null,
        spot === id ? styles.rowLit : null,
        disabled ? styles.rowDisabled : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text
        style={[
          large ? styles.rowValueLarge : styles.rowValue,
          receded && !disabled ? styles.textReceded : null,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {compact ? null : (
        <Text
          style={[styles.rowCaption, receded && !disabled ? styles.textReceded : null]}
          numberOfLines={2}
        >
          {hint}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * True when the ear is on something else. Recession is carried by the palette's
 * muted roles rather than a fractional opacity, because opacity on text drops it
 * under the AA contrast this repo gates on.
 */
function recede(spot: string | null, id: string): boolean {
  return spot != null && spot !== id;
}

const styles = themedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xxl,
  },
  row: {
    minHeight: 76,
    justifyContent: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radii.md,
    borderWidth: 3,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  rowCompact: {
    minHeight: 60,
  },
  rowLarge: {
    minHeight: 96,
    borderColor: colors.border,
  },
  rowLit: {
    borderColor: colors.borderFocus,
    backgroundColor: colors.surfaceElevated,
    transform: [{ scale: 1.01 }],
  },
  rowDisabled: {
    borderColor: colors.border,
  },
  rowCaption: {
    fontSize: theme.typography.small,
    fontWeight: '700',
    color: colors.textMuted,
    marginTop: 2,
  },
  rowValue: {
    fontSize: theme.typography.heading,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: -0.2,
  },
  rowValueLarge: {
    fontSize: theme.typography.subheading,
    fontWeight: '900',
    color: colors.text,
  },
  textReceded: {
    color: colors.textMuted,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  diagBlock: {
    backgroundColor: colors.surface,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  statusLine: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 24,
  },
  fieldLabel: {
    fontSize: theme.typography.small,
    fontWeight: '800',
    color: colors.textMuted,
    marginTop: theme.spacing.sm,
  },
  // Input outline uses the 3:1 controlBorder token (WCAG 1.4.11), per the
  // palette rules in the README.
  pipelineField: {
    minHeight: theme.touchTarget.minSize,
    borderRadius: theme.radii.md,
    borderWidth: 1.5,
    borderColor: colors.controlBorder,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    color: colors.text,
    fontSize: theme.typography.body,
    backgroundColor: colors.background,
  },
  pressed: {
    opacity: 0.85,
  },
}));
