import {Platform, View} from 'react-native';
import { useTranslation } from 'react-i18next';

import { announce } from '../a11y/announcer';
import { theme, themedStyles } from '../constants/theme';
import { setAppLanguage, SUPPORTED_LANGUAGES, LANGUAGE_NAMES, type AppLanguage } from '../i18n';
import { hapticTick } from '../services/haptics';
import { AccessibleButton } from './AccessibleButton';

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const active = (i18n.language as AppLanguage) ?? 'tw';

  const select = async (language: AppLanguage) => {
    await setAppLanguage(language);
    void hapticTick();
    announce(t('common.languageChanged', { language: LANGUAGE_NAMES[language] }));
  };

  return (
    <View
      accessible
      accessibilityRole="radiogroup"
      accessibilityLabel={t('common.language')}
      accessibilityHint={t('common.languageSwitchHint')}
      style={[compact ? styles.rowCompact : styles.grid, styles.container]}
    >
      {SUPPORTED_LANGUAGES.map((language) => {
        const selected = language === active;
        return (
          <AccessibleButton
            key={language}
            label={`${selected ? '✓ ' : ''}${LANGUAGE_NAMES[language]}`}
            hint={`${LANGUAGE_NAMES[language]} language${selected ? ', currently selected' : ', double tap to select'}`}
            accessibilityState={selected ? { selected: true } : { selected: false }}
            variant={selected ? 'gold' : 'outline'}
            onPress={() => {
              void select(language);
            }}
            style={[styles.option, selected ? styles.optionSelected : null]}
          />
        );
      })}
    </View>
  );
}

const styles = themedStyles((colors) => ({
  container: {
    backgroundColor: colors.surfaceMuted,
    padding: theme.spacing.xs,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: theme.spacing.md,
  },
  grid: {
    gap: theme.spacing.xs,
  },
  rowCompact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  option: {
    paddingHorizontal: theme.spacing.md,
    minHeight: theme.touchTarget.minSize,
    borderRadius: theme.radii.md,
  },
  optionSelected: {
    ...Platform.select({
      web: {
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
      },
    }),
  },
}));
