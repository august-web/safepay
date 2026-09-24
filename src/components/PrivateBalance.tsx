import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { announce } from '../a11y/announcer';
import { theme, themedStyles } from '../constants/theme';
import { hapticTick } from '../services/haptics';
import { formatMoney } from '../services/transactions';

/**
 * Balance shown through the Home screen's privacy pattern (Polish 6): dots
 * until deliberately revealed, with the reveal/hide state announced for
 * screen-reader users. Used in transaction-screen headers so a shoulder
 * surfer never reads the balance from across the room.
 */
export function PrivateBalance({ amount }: { amount: number }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  const toggle = () => {
    const next = !visible;
    setVisible(next);
    void hapticTick();
    announce(
      next
        ? `${t('home.balanceLabel')}: ${formatMoney(amount)}`
        : t('home.balanceHidden'),
    );
  };

  const label = visible
    ? `${t('home.balanceLabel')}: ${formatMoney(amount)}`
    : t('home.balanceHiddenLabel', 'Balance hidden');

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={
        visible
          ? t('home.hideBalance', 'Double-tap to hide the balance')
          : t('home.showBalance', 'Double-tap to reveal the balance')
      }
      onPress={toggle}
      hitSlop={8}
    >
      <Text style={styles.text}>{visible ? formatMoney(amount) : '••••••'}</Text>
    </Pressable>
  );
}

const styles = themedStyles((colors) => ({
  text: {
    fontSize: theme.typography.tiny,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
}));
