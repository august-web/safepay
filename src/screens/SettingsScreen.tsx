import { useEffect, useState } from 'react';
import {ScrollView, Text, View} from 'react-native';
import { useTranslation } from 'react-i18next';

import { announce, voiceChannel } from '../a11y/announcer';
import { AccessibleButton } from '../components/AccessibleButton';
import { HeaderBar } from '../components/HeaderBar';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { THEME_PALETTE_NAMES } from '../constants/theme';
import { useContrastTheme } from '../theme/ContrastThemeProvider';
import { theme, themedStyles } from '../constants/theme';
import { getAppLanguage } from '../i18n';
import { hapticTick } from '../services/haptics';
import { useAudioRoute } from '../services/headphones';
import { getCachedSettings, loadSettings, saveSettings, type NavPreset, type PrivacyMode } from '../services/settings';
import { speak, stopSpeaking, voiceStatusFor, warmUpSpeech } from '../services/speech';
import { sayKey } from '../voice/say';
import { voiceClipCount } from '../voice/voicePack';

export function SettingsScreen({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();

  const [navPreset, setNavPreset] = useState<NavPreset>(getCachedSettings().navPreset);
  const [speechRate, setSpeechRate] = useState<number>(getCachedSettings().speechRate);
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>(getCachedSettings().privacyMode);

  const { palette, setPalette } = useContrastTheme();
  const audioRoute = useAudioRoute();
  const channel = voiceChannel();
  const voice = voiceStatusFor(getAppLanguage());
  const clipCount = voiceClipCount(getAppLanguage());

  const testVoice = () => {
    void hapticTick();
    stopSpeaking();
    // Prefers the bundled native clip, so the demo hears the real Twi/Ewe voice
    // rather than an English voice reading Ghanaian text.
    sayKey('settings.voiceSample');
  };

  const selectContrast = (name: (typeof THEME_PALETTE_NAMES)[number]) => {
    void hapticTick();
    setPalette(name);
    announce(t(`settings.contrast.${name}.label`));
  };

  useEffect(() => {
    warmUpSpeech();
    let ignore = false;
    void (async () => {
      const s = await loadSettings();
      if (!ignore) {
        setNavPreset(s.navPreset);
        setSpeechRate(s.speechRate);
        setPrivacyMode(s.privacyMode);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  const selectNav = (preset: NavPreset) => {
    void hapticTick();
    setNavPreset(preset);
    void saveSettings({ navPreset: preset });
    announce(
      preset === 'linear'
        ? t('settings.navLinear', 'Linear Sequential (TalkBack)')
        : t('settings.navSpatial', 'Spatial Grid (Memory-Based)'),
    );
  };

  const selectSpeechRate = (rate: number, label: string) => {
    void hapticTick();
    setSpeechRate(rate);
    void saveSettings({ speechRate: rate });
    stopSpeaking();
    speak(`Speech rate set to ${label}. SikaVoice MoMo.`, getAppLanguage(), rate);
  };

  const selectPrivacy = (mode: PrivacyMode) => {
    void hapticTick();
    setPrivacyMode(mode);
    void saveSettings({ privacyMode: mode });
    announce(
      mode === 'auto'
        ? t('settings.privacyAuto', 'Auto (Headphones = Voice, Speaker = Haptics)')
        : mode === 'voice'
          ? t('settings.privacyVoiceOnly', 'Always Speak Aloud')
          : t('settings.privacyHapticsOnly', 'Always Silent Haptics'),
    );
  };

  return (
    <View style={styles.screen}>
      <HeaderBar
        title={t('settings.title', 'Settings')}
        subtitle={t('settings.subtitle')}
        showBack
        onBack={onDone}
      />

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        accessibilityLabel={t('settings.title', 'Settings')}
        accessibilityHint="Accessibility preferences and navigation presets"
      >
        {/* Navigation Preset Section (Brief §Local Fit) */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>
            {t('settings.navSection', 'Navigation Preset (WCAG 2.2)')}
          </Text>

          <View
            accessible
            accessibilityRole="radiogroup"
            accessibilityLabel={t('settings.navSection', 'Navigation Preset')}
            accessibilityHint="Choose linear sequential or spatial grid navigation"
            style={styles.optionsColumn}
          >
            <AccessibleButton
              label={t('settings.navLinear', 'Linear Sequential (TalkBack)')}
              hint={t('settings.navLinearDesc', 'Step-by-step layout optimized for screen readers (congenitally blind)')}
              accessibilityState={{ selected: navPreset === 'linear' }}
              variant={navPreset === 'linear' ? 'momo' : 'outline'}
              onPress={() => selectNav('linear')}
              style={styles.optionBtn}
            />
            <Text style={styles.optionDesc}>
              {t('settings.navLinearDesc', 'Step-by-step layout optimized for screen readers (congenitally blind)')}
            </Text>

            <AccessibleButton
              label={t('settings.navSpatial', 'Spatial Grid (Memory-Based)')}
              hint={t('settings.navSpatialDesc', 'Fixed-position tactile layout for muscle memory (adventitiously blind)')}
              accessibilityState={{ selected: navPreset === 'spatial' }}
              variant={navPreset === 'spatial' ? 'momo' : 'outline'}
              onPress={() => selectNav('spatial')}
              style={styles.optionBtn}
            />
            <Text style={styles.optionDesc}>
              {t('settings.navSpatialDesc', 'Fixed-position tactile layout for muscle memory (adventitiously blind)')}
            </Text>
          </View>
        </View>

        {/* TTS Voice Speed Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>
            {t('settings.voiceSection', 'TTS Voice Narration Speed')}
          </Text>

          <View
            accessible
            accessibilityRole="radiogroup"
            accessibilityLabel={t('settings.voiceSection', 'TTS Voice Narration Speed')}
            accessibilityHint="Select voice narration speed"
            style={styles.speedRow}
          >
            <AccessibleButton
              label="0.75×"
              hint={t('settings.speedSlow', '0.75× Slow')}
              accessibilityState={{ selected: speechRate === 0.75 }}
              variant={speechRate === 0.75 ? 'momo' : 'outline'}
              onPress={() => selectSpeechRate(0.75, '0.75')}
              style={styles.speedBtn}
            />
            <AccessibleButton
              label="0.85×"
              hint={t('settings.speedStandard', '0.85× Accessible')}
              accessibilityState={{ selected: speechRate === 0.85 }}
              variant={speechRate === 0.85 ? 'momo' : 'outline'}
              onPress={() => selectSpeechRate(0.85, '0.85')}
              style={styles.speedBtn}
            />
            <AccessibleButton
              label="1.0×"
              hint={t('settings.speedNormal', '1.0× Normal')}
              accessibilityState={{ selected: speechRate === 1.0 }}
              variant={speechRate === 1.0 ? 'momo' : 'outline'}
              onPress={() => selectSpeechRate(1.0, '1.0')}
              style={styles.speedBtn}
            />
          </View>
        </View>

        {/* Voice Output Check - lets a blind user confirm audio works */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>
            {t('settings.voiceCheckSection', 'Voice Output Check')}
          </Text>

          <Text style={styles.statusLine} accessibilityRole="text">
            {channel === 'tts'
              ? t('settings.voiceChannelTts', 'SikaVoice is speaking with its own voice')
              : t('settings.voiceChannelScreenReader', 'Your screen reader is reading SikaVoice aloud')}
          </Text>

          <Text style={styles.statusLine} accessibilityRole="text">
            {audioRoute.isPrivate
              ? t('settings.voiceRoutePrivate', {
                  devices: audioRoute.devices.join(', ') || 'audio device',
                })
              : t('settings.voiceRoutePublic', 'Speaker - amounts are spoken or vibrated discreetly')}
          </Text>

          <Text style={styles.optionDesc}>
            {t('settings.voiceLocaleLine', {
              locale: voice.requested,
              voice: voice.voice ?? t('settings.voiceFallback', 'device default voice'),
            })}
          </Text>

          {clipCount > 0 ? (
            <Text style={styles.optionDesc}>
              {t('settings.voiceClipLine', { count: clipCount })}
            </Text>
          ) : null}

          <AccessibleButton
            label={t('settings.testVoice', 'Test voice output')}
            hint={t(
              'settings.testVoiceHint',
              'Speaks a sample sentence so you can check the volume before a transaction',
            )}
            variant="momo"
            onPress={testVoice}
            style={styles.optionBtn}
          />
        </View>

        {/* Audio Privacy Guard Mode */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>
            {t('settings.privacySection', 'Audio Privacy Guard')}
          </Text>

          <View
            accessible
            accessibilityRole="radiogroup"
            accessibilityLabel={t('settings.privacySection', 'Audio Privacy Guard')}
            accessibilityHint="Configure private audio vs haptic mode behavior"
            style={styles.optionsColumn}
          >
            <AccessibleButton
              label={t('settings.privacyAuto', 'Auto (Headphones = Voice, Speaker = Haptics)')}
              hint="Automatically switch to haptics when not using headphones"
              accessibilityState={{ selected: privacyMode === 'auto' }}
              variant={privacyMode === 'auto' ? 'momo' : 'outline'}
              onPress={() => selectPrivacy('auto')}
              style={styles.optionBtn}
            />
            <AccessibleButton
              label={t('settings.privacyVoiceOnly', 'Always Speak Aloud')}
              hint="Always speak transaction details aloud"
              accessibilityState={{ selected: privacyMode === 'voice' }}
              variant={privacyMode === 'voice' ? 'momo' : 'outline'}
              onPress={() => selectPrivacy('voice')}
              style={styles.optionBtn}
            />
            <AccessibleButton
              label={t('settings.privacyHapticsOnly', 'Always Silent Haptics')}
              hint="Never speak aloud, always use tactile vibrations"
              accessibilityState={{ selected: privacyMode === 'haptic' }}
              variant={privacyMode === 'haptic' ? 'momo' : 'outline'}
              onPress={() => selectPrivacy('haptic')}
              style={styles.optionBtn}
            />
          </View>
        </View>

        {/* Contrast Palette (both options are WCAG AA audited) */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>
            {t('settings.contrastSection', 'Screen Contrast')}
          </Text>

          <View
            accessible
            accessibilityRole="radiogroup"
            accessibilityLabel={t('settings.contrastSection', 'Screen Contrast')}
            accessibilityHint="Choose the colour contrast that is most comfortable to read"
            style={styles.optionsColumn}
          >
            {THEME_PALETTE_NAMES.map((name) => (
              <AccessibleButton
                key={name}
                label={t(`settings.contrast.${name}.label`)}
                hint={t(`settings.contrast.${name}.hint`)}
                accessibilityState={{ selected: palette === name }}
                variant={palette === name ? 'momo' : 'outline'}
                onPress={() => selectContrast(name)}
                style={styles.optionBtn}
              />
            ))}
          </View>
        </View>

        {/* Language Selection */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('common.language', 'Language')}</Text>
          <LanguageSwitcher />
        </View>

        <AccessibleButton
          label={t('common.back', 'Back')}
          hint="Save and return to home screen"
          variant="hero"
          onPress={onDone}
          style={styles.doneBtn}
        />
      </ScrollView>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.typography.heading,
    fontWeight: '900',
    color: colors.navyMidnight,
    marginBottom: theme.spacing.sm,
  },
  statusLine: {
    fontSize: theme.typography.small,
    fontWeight: '700',
    color: colors.text,
    marginBottom: theme.spacing.xs,
  },
  optionsColumn: {
    gap: theme.spacing.xs,
  },
  optionBtn: {
    minHeight: 48,
    borderRadius: theme.radii.md,
  },
  optionDesc: {
    fontSize: theme.typography.tiny,
    color: colors.textMuted,
    marginLeft: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
  },
  speedRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  speedBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: theme.radii.md,
  },
  doneBtn: {
    minHeight: 56,
    borderRadius: theme.radii.lg,
    marginTop: theme.spacing.sm,
  },
}));

