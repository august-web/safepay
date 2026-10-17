import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { announce } from '../a11y/announcer';
import { needsOwnVoice } from '../a11y/screenReader';
import { useEarLight, useSpotlight } from '../a11y/spotlight';
import { HeaderBar } from '../components/HeaderBar';
import { theme, themedStyles } from '../constants/theme';
import { getAppLanguage } from '../i18n';
import { hapticAmount, hapticTick } from '../services/haptics';
import { listAlerts, markAlertsRead, subscribeSms, type MoMoAlert } from '../services/momoSms';
import { speak } from '../services/speech';
import { sayMoneyTransaction } from '../voice/moneySpeech';

/**
 * The MoMo alert thread, simulated on purpose.
 *
 * Real SMS reading needs a permission a hackathon demo should not ask for, and a
 * blind user cannot make TalkBack read another app's messages anyway. Every
 * alert here was produced by a transaction this app just completed, so the
 * thread is a second surface over the same record rather than a parser guessing
 * at pasted text.
 */
export function SmsInboxScreen({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [alerts, setAlerts] = useState<MoMoAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const spot = useSpotlight();
  const light = useEarLight();
  const firstLoad = useRef(true);

  useEffect(() => {
    const refresh = () => {
      void listAlerts().then((next) => {
        setAlerts(next);
        setLoading(false);
      });
    };
    refresh();
    const unsubscribe = subscribeSms(refresh);
    return unsubscribe;
  }, []);

  // Opening the thread is how the alerts get read: the unread badge on Home
  // clears itself here rather than in a second place the user must find.
  useEffect(() => {
    if (!firstLoad.current || loading) return;
    firstLoad.current = false;
    void markAlertsRead();
  }, [loading]);

  const readAlert = (alert: MoMoAlert) => {
    void hapticAmount();
    light(alert.id);
    sayMoneyTransaction(
      {
        introKey: 'sms.sayNew',
        directionKey: `receipt.direction.${alert.transaction.type}`,
        transaction: alert.transaction,
        balance: alert.balance,
      },
      {
        fallback: () => {
          if (needsOwnVoice()) speak(alert.content, getAppLanguage());
          else announce(alert.content);
        },
      },
    );
  };

  return (
    <View style={styles.screen}>
      <HeaderBar
        title={t('sms.inboxTitle')}
        subtitle={t('sms.inboxSubtitle')}
        showBack
        onBack={onDone}
      />

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        accessibilityLabel={t('sms.inboxTitle')}
        accessibilityHint={t('sms.openInboxHint')}
      >
        {loading ? (
          <Text style={styles.plainText}>{t('home.loading')}</Text>
        ) : alerts.length === 0 ? (
          <Text style={styles.plainText}>{t('sms.empty')}</Text>
        ) : (
          alerts.map((alert) => (
            <Pressable
              key={alert.id}
              accessible
              accessibilityRole="button"
              accessibilityLabel={alert.content}
              accessibilityHint={t('sms.reRead')}
              onFocus={() => light(alert.id)}
              onPressIn={() => {
                void hapticTick();
                light(alert.id);
              }}
              onPress={() => readAlert(alert)}
              style={({ pressed }) => [
                styles.message,
                spot === alert.id ? styles.messageLit : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <View style={styles.messageHead}>
                <Text style={styles.sender}>{t('sms.sender')}</Text>
                <Text style={styles.timestamp}>
                  {new Date(alert.createdAt).toLocaleString('en-GH', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
              <Text style={styles.messageBody}>{alert.content}</Text>
            </Pressable>
          ))
        )}

        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          accessibilityHint={t('common.back')}
          onPress={onDone}
          style={({ pressed }) => [styles.backRow, pressed ? styles.pressed : null]}
        >
          <Text style={styles.backLabel}>{t('common.back')}</Text>
        </Pressable>
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
  message: {
    backgroundColor: colors.surface,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    minHeight: 76,
    justifyContent: 'center',
  },
  messageLit: {
    borderColor: colors.borderFocus,
    borderWidth: 3,
    backgroundColor: colors.surfaceElevated,
  },
  messageHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  sender: {
    fontSize: theme.typography.small,
    fontWeight: '900',
    color: colors.safepayBlue,
  },
  timestamp: {
    fontSize: theme.typography.tiny,
    fontWeight: '600',
    color: colors.textMuted,
  },
  messageBody: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 24,
  },
  plainText: {
    fontSize: theme.typography.body,
    color: colors.textMuted,
    fontWeight: '600',
    paddingVertical: theme.spacing.md,
  },
  backRow: {
    minHeight: 56,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: theme.radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: theme.spacing.md,
  },
  backLabel: {
    fontSize: theme.typography.body,
    fontWeight: '800',
    color: colors.text,
  },
  pressed: {
    opacity: 0.85,
  },
}));
