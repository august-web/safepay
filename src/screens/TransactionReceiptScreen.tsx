import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { announce } from '../a11y/announcer';
import { needsOwnVoice } from '../a11y/screenReader';
import { useEarLight, useSpotlight } from '../a11y/spotlight';
import { AccessibleButton } from '../components/AccessibleButton';
import { HeaderBar } from '../components/HeaderBar';
import { theme, themedStyles } from '../constants/theme';
import { getAppLanguage } from '../i18n';
import { hapticAmount, hapticConfirm, hapticTick } from '../services/haptics';
import { speak } from '../services/speech';
import { formatMoney, getBalance, type Transaction } from '../services/transactions';
import { sayMoneyTransaction } from '../voice/moneySpeech';
import { sayPlan, stopAllVoices, type SayPlan } from '../voice/say';

/**
 * The receipt that follows every successful transaction, from either the touch
 * flows or the spoken dialogue.
 *
 * It is a MoMo statement slip, not a confirmation toast: the whole transaction
 * is read out loud in the user's language and the app only returns Home when the
 * reading has finished, so nobody has to remember what they just heard. Touching
 * anything takes over - the reading stops and the slip stays put.
 */

const SPOT_RECEIPT = 'receipt';
const SPOT_TYPE = 'type';
const SPOT_AMOUNT = 'amount';
const SPOT_PARTY = 'party';
const SPOT_FEE = 'fee';
const SPOT_REFERENCE = 'reference';
const SPOT_BALANCE = 'balance';

interface Row {
  id: string;
  captionKey: string;
  caption: string;
  value: string;
  parts: SayPlan;
}

export function TransactionReceiptScreen({
  transaction,
  onDone,
}: {
  transaction: Transaction;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [balance, setBalance] = useState<number | null>(null);
  const spot = useSpotlight();
  const light = useEarLight();
  const balanceRef = useRef<number | null>(null);
  const readOnce = useRef(false);
  const returned = useRef(false);
  const takenOver = useRef(false);
  /** Handing the sentence to TalkBack ends the app's visibility into it. */
  const handedToReader = useRef(false);
  /**
   * Latest `onDone`, read only from callbacks. Keeping the callback identity
   * stable across renders means a `speak()` completion still firing while the
   * slip is on screen lands on the current handler rather than a stale one.
   */
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });

  // The slip shows the money the wallet holds now: every transaction service
  // call has already moved the balance before this screen mounted.
  useEffect(() => {
    let ignore = false;
    void getBalance().then((next) => {
      balanceRef.current = next;
      if (!ignore) setBalance(next);
    });
    return () => {
      ignore = true;
    };
  }, []);

  const directionKey = `receipt.direction.${transaction.type}`;
  const heldBalance = () => balanceRef.current ?? 0;

  /** Ends the visit: only if the user has not taken over and nothing returned yet. */
  const finish = () => {
    if (returned.current || takenOver.current || handedToReader.current) return;
    returned.current = true;
    doneRef.current();
  };

  /** Plain-language sentence for languages with no clip pack, and for TalkBack. */
  const spokenSentence = () =>
    [
      t('vcmd.transactionComplete'),
      `${t(directionKey)} ${transaction.recipientName}`,
      `${t('receipt.amountLabel')} ${formatMoney(transaction.amount)}`,
      transaction.fee > 0
        ? `${t('receipt.feeLabel')} ${formatMoney(transaction.fee)}`
        : null,
      `${t('receipt.newBalanceLabel')} ${formatMoney(heldBalance())}`,
      `${t('receipt.referenceLabel')} ${transaction.reference}`,
    ]
      .filter((line): line is string => line != null)
      .join('. ');

  /**
   * Says the line, then returns home when the app's own voice has finished with
   * it. With a screen reader the live region is the only voice and its end is not
   * observable, so the slip waits for the user instead of pulling the ground from
   * under a sentence TalkBack is still reading in their own settings.
   */
  const readReceipt = () => {
    light(SPOT_RECEIPT);
    sayMoneyTransaction(
      {
        introKey: 'vcmd.transactionComplete',
        directionKey,
        transaction,
        balance: heldBalance(),
      },
      {
        fallback: () => {
          if (needsOwnVoice()) {
            speak(spokenSentence(), getAppLanguage(), undefined, {
              onDone: finish,
              onStopped: finish,
              onError: finish,
            });
          } else {
            handedToReader.current = true;
            announce(spokenSentence());
          }
        },
        onDone: finish,
      },
    );
  };

  useEffect(() => {
    if (readOnce.current) return;
    readOnce.current = true;
    void hapticConfirm();
    readReceipt();
    // Mount only: the slip is read once, and only the user reads it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Any touch: stop talking, and stop counting on the reading to navigate. */
  const takeOver = () => {
    takenOver.current = true;
    stopAllVoices();
  };

  const rows: Row[] = [
    {
      id: SPOT_TYPE,
      captionKey: 'receipt.typeLabel',
      caption: t('receipt.typeLabel'),
      value: t(`home.type.${transaction.type}`),
      parts: [{ kind: 'key', key: `home.type.${transaction.type}` }],
    },
    {
      id: SPOT_AMOUNT,
      captionKey: 'receipt.amountLabel',
      caption: t('receipt.amountLabel'),
      value: formatMoney(transaction.amount),
      parts: [{ kind: 'money', amount: transaction.amount }],
    },
    {
      id: SPOT_PARTY,
      captionKey: directionKey,
      caption: t(directionKey),
      value: transaction.recipientName,
      parts: [{ kind: 'name', name: transaction.recipientName }],
    },
    ...(transaction.fee > 0
      ? [
          {
            id: SPOT_FEE,
            captionKey: 'receipt.feeLabel',
            caption: t('receipt.feeLabel'),
            value: formatMoney(transaction.fee),
            parts: [{ kind: 'money', amount: transaction.fee }] as SayPlan,
          },
        ]
      : []),
    {
      id: SPOT_REFERENCE,
      captionKey: 'receipt.referenceLabel',
      caption: t('receipt.referenceLabel'),
      value: transaction.reference,
      parts: [{ kind: 'digits', value: transaction.reference }],
    },
    {
      id: SPOT_BALANCE,
      captionKey: 'receipt.newBalanceLabel',
      caption: t('receipt.newBalanceLabel'),
      value: formatMoney(balance ?? 0),
      parts: [{ kind: 'money', amount: balance ?? 0 }],
    },
  ];

  const readLine = (row: Row) => {
    takeOver();
    void hapticAmount();
    light(row.id);
    const plan: SayPlan = [{ kind: 'key', key: row.captionKey }, ...row.parts];
    sayPlan(plan, {
      fallback: () => {
        const line = `${row.caption}: ${row.value}`;
        if (needsOwnVoice()) speak(line, getAppLanguage());
        else announce(line);
      },
    });
  };

  return (
    <View style={styles.screen}>
      <HeaderBar title={t('receipt.title')} />

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        accessibilityLabel={t('receipt.title')}
        accessibilityHint={t('receipt.stayNote')}
        onScrollBeginDrag={takeOver}
      >
        {/* The card is a plain container: an `accessible` wrapper here would
            merge its rows into one focus stop and hide them from TalkBack. */}
        <View style={[styles.voucher, spot === SPOT_RECEIPT ? styles.voucherLit : null]}>
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel={`${t('receipt.heading')}. ${t(directionKey)}: ${transaction.recipientName}. ${t('receipt.amountLabel')}: ${formatMoney(transaction.amount)}`}
            accessibilityHint={t('receipt.reReadHint')}
            onFocus={() => light(SPOT_RECEIPT)}
            onPressIn={() => {
              void hapticTick();
              light(SPOT_RECEIPT);
            }}
            onPress={readReceipt}
            style={({ pressed }) => [styles.voucherTop, pressed ? styles.pressed : null]}
          >
            <Text style={styles.voucherTag}>✓ {t('receipt.heading')}</Text>
            <Text style={styles.voucherAmount} numberOfLines={1} adjustsFontSizeToFit>
              {formatMoney(transaction.amount)}
            </Text>
            <Text style={styles.voucherParty}>{transaction.recipientName}</Text>
          </Pressable>

          {rows.map((row) => (
            <ReceiptRow
              key={row.id}
              id={row.id}
              caption={row.caption}
              value={row.value}
              spot={spot}
              light={light}
              onPress={() => readLine(row)}
            />
          ))}

          <Text style={styles.stayNote}>{t('receipt.stayNote')}</Text>
        </View>

        <AccessibleButton
          label={t('receipt.reRead')}
          hint={t('receipt.reReadHint')}
          variant="primary"
          onPress={() => {
            takenOver.current = false;
            returned.current = false;
            handedToReader.current = false;
            readReceipt();
          }}
          style={styles.ctaButton}
        />

        <AccessibleButton
          label={t('send.backToHome')}
          hint={t('send.backToHome')}
          variant="secondary"
          onPress={() => {
            takeOver();
            onDone();
          }}
          style={styles.secondaryButton}
        />
      </ScrollView>
    </View>
  );
}

function ReceiptRow({
  id,
  caption,
  value,
  spot,
  light,
  onPress,
  style,
}: {
  id: string;
  caption: string;
  value: string;
  spot: string | null;
  light: (id: string) => void;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const receded = spot != null && spot !== id;
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${caption}: ${value}`}
      accessibilityHint={t('receipt.rowHint')}
      onFocus={() => light(id)}
      onPressIn={() => light(id)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        spot === id ? styles.rowLit : null,
        pressed ? styles.pressed : null,
        style,
      ]}
    >
      <Text style={[styles.rowCaption, receded ? styles.textReceded : null]} numberOfLines={1}>
        {caption}
      </Text>
      <Text style={[styles.rowValue, receded ? styles.textReceded : null]} numberOfLines={1}>
        {value}
      </Text>
    </Pressable>
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
  voucher: {
    backgroundColor: colors.surface,
    borderRadius: theme.radii.xl,
    borderWidth: 1.5,
    borderColor: colors.success,
    marginBottom: theme.spacing.md,
    overflow: 'hidden',
  },
  voucherLit: {
    borderColor: colors.borderFocus,
    borderWidth: 3,
  },
  voucherTop: {
    backgroundColor: colors.navyMidnight,
    padding: theme.spacing.lg,
    alignItems: 'center',
  },
  voucherTag: {
    fontSize: theme.typography.tiny,
    fontWeight: '800',
    color: colors.momoYellow,
    letterSpacing: 0.5,
    marginBottom: theme.spacing.xs,
  },
  voucherAmount: {
    fontSize: 34,
    fontWeight: '900',
    color: colors.textOnNavy,
    letterSpacing: -0.5,
  },
  voucherParty: {
    fontSize: theme.typography.body,
    color: colors.textOnNavyMuted,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.sm,
    minHeight: 56,
    paddingHorizontal: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLit: {
    backgroundColor: colors.surfaceElevated,
  },
  rowCaption: {
    fontSize: theme.typography.small,
    color: colors.textMuted,
    fontWeight: '700',
    flexShrink: 0,
  },
  rowValue: {
    fontSize: theme.typography.body,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'right',
    flexShrink: 1,
  },
  textReceded: {
    color: colors.textMuted,
  },
  stayNote: {
    fontSize: theme.typography.small,
    color: colors.textMuted,
    fontWeight: '600',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  ctaButton: {
    minHeight: 56,
    borderRadius: theme.radii.lg,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: theme.radii.lg,
    marginTop: theme.spacing.sm,
  },
  pressed: {
    opacity: 0.85,
  },
}));
