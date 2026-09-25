import { useCallback, useEffect, useRef, useState } from 'react';
import {Animated, ScrollView, Text, View} from 'react-native';
import { useTranslation } from 'react-i18next';

import { announce, announceError, announceSuccess } from '../a11y/announcer';
import { AccessibleButton } from '../components/AccessibleButton';
import { AccessibleField } from '../components/AccessibleField';
import { HeaderBar } from '../components/HeaderBar';
import { PrivateBalance } from '../components/PrivateBalance';
import { theme, themedStyles } from '../constants/theme';
import { getAppLanguage } from '../i18n';
import { localizedFailureReason } from '../i18n/failureReason';
import { authenticateWithBiometrics, getBiometricCapability } from '../services/biometrics';
import { hapticAmount, hapticCancel, hapticConfirm, hapticError, hapticTick } from '../services/haptics';
import { useIsPrivateAudio } from '../services/headphones';
import { speak, stopSpeaking } from '../services/speech';
import { calculateFee, cashOut, getBalance, type SendResult } from '../services/transactions';
import { sayPlan } from '../voice/say';
import { parseCashoutUtterance } from '../voice/dictation';
import { useScreenDictation } from '../voice/useScreenDictation';
import { VoiceDictationCard } from '../components/VoiceDictationCard';

const GHS = 'GH₵';

function formatMoney(amount: number): string {
  return `${GHS} ${amount.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const CANCEL_WINDOW_MS = 3000;

export function CashOutScreen({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<'form' | 'review' | 'processing' | 'result'>('form');
  const [agentCode, setAgentCode] = useState('');
  const [agentName, setAgentName] = useState('');
  const [amountText, setAmountText] = useState('');
  const [balance, setBalance] = useState(0);
  const isPrivateAudio = useIsPrivateAudio();
  const [confirming, setConfirming] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(3);
  const [result, setResult] = useState<SendResult | null>(null);

  const [countdownAnim] = useState(() => new Animated.Value(1));
  const cancelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const amount = Number.parseFloat(amountText.replace(/,/g, ''));
  const fee = Number.isFinite(amount) && amount > 0 ? calculateFee(amount) : 0;
  const total = Number.isFinite(amount) && amount > 0 ? amount + fee : 0;
  const displayAgentName = agentName.trim() || `MoMo Agent ${agentCode}`;

  /** Example utterance for this screen's dictation. */
  const voiceExample = t('cashout.voiceExample', 'Withdraw 200 cedis from agent 123456');

  /**
   * Applies one spoken sentence to the withdrawal form (P2). Fields fill
   * from whatever was understood; the read-back says what was heard so a
   * partial parse is audible, never silent.
   */
  const applyVoiceForm = useCallback(
    (transcript: string) => {
      const fields = parseCashoutUtterance(transcript);
      if (fields.amount != null) setAmountText(String(fields.amount));
      if (fields.agentCode != null) setAgentCode(fields.agentCode);

      void hapticAmount();
      const spoken = t('cashout.voiceReadBack', {
        amount: fields.amount != null ? formatMoney(fields.amount) : '—',
        agentCode: fields.agentCode ?? '—',
      });
      const parts: Parameters<typeof sayPlan>[0] = [
        { kind: 'key', key: 'vcmd.withdrawing' },
        ...(fields.amount != null ? [{ kind: 'money' as const, amount: fields.amount }] : []),
        ...(fields.agentCode != null
          ? [{ kind: 'phone' as const, phone: fields.agentCode }]
          : []),
        { kind: 'key', key: 'vcmd.confirmWithFingerprint' },
      ];
      sayPlan(parts, {
        fallback: () => {
          if (isPrivateAudio) {
            speak(spoken, getAppLanguage());
          } else {
            announce(spoken);
          }
        },
      });
    },
    [isPrivateAudio, t],
  );

  const { dictationActive, preview, startDictation, stopDictation } = useScreenDictation(applyVoiceForm);

  useEffect(() => {
    void getBalance().then(setBalance);
    return () => {
      if (cancelTimer.current != null) clearTimeout(cancelTimer.current);
      if (countdownInterval.current != null) clearInterval(countdownInterval.current);
      stopSpeaking();
    };
  }, []);

  const readBackMessage = t('cashout.readBack', {
    amount: formatMoney(amount || 0),
    agentName: displayAgentName,
    agentCode: agentCode || '000000',
    fee: formatMoney(fee),
    total: formatMoney(total),
  });

  const playReadBack = useCallback(() => {
    void hapticTick();
    void hapticConfirm();
    // Native composition for Twi/Ewe: vcmd clips + number atoms.
    sayPlan(
      [
        { kind: 'key', key: 'vcmd.withdrawing' },
        { kind: 'money', amount: amount || 0 },
        { kind: 'name', name: displayAgentName },
        { kind: 'key', key: 'vcmd.feeIs' },
        { kind: 'money', amount: fee },
        { kind: 'key', key: 'vcmd.totalIs' },
        { kind: 'money', amount: total },
        { kind: 'key', key: 'vcmd.confirmWithFingerprint' },
      ],
      {
        fallback: () => {
          if (isPrivateAudio) {
            speak(readBackMessage, getAppLanguage());
          } else {
            announce(readBackMessage);
          }
        },
      },
    );
  }, [isPrivateAudio, readBackMessage, amount, fee, total, displayAgentName]);

  const validate = (): boolean => {
    if (!Number.isFinite(amount) || amount <= 0) {
      void hapticError();
      announceError(t('cashout.errorAmount'));
      return false;
    }
    if (total > balance) {
      void hapticError();
      announceError(t('send.errors.insufficient'));
      return false;
    }
    if (agentCode.trim().length < 5) {
      void hapticError();
      announceError(t('cashout.errorAgentCode'));
      return false;
    }
    return true;
  };

  const goToReview = () => {
    stopSpeaking();
    if (validate()) {
      void hapticTick();
      setPhase('review');
      playReadBack();
    }
  };

  const finalizeWithdrawal = useCallback(async () => {
    setCanCancel(false);
    if (countdownInterval.current != null) clearInterval(countdownInterval.current);

    const res = await cashOut({
      amount,
      agentCode,
      agentName: displayAgentName,
      fee,
    });

    setResult(res);
    setPhase('result');

    if (res.status === 'confirmed') {
      void hapticConfirm();
      announceSuccess(
        t('cashout.confirmedAnnouncement', {
          amount: formatMoney(amount),
          agentName: displayAgentName,
        }),
      );
    } else {
      void hapticError();
      announceError(t('send.failedAnnouncement', { reason: localizedFailureReason(t, res.reason) }));
    }
  }, [amount, agentCode, displayAgentName, fee, t]);

  const startCancelWindow = useCallback(() => {
    setPhase('processing');
    setCanCancel(true);
    setSecondsRemaining(3);

    countdownAnim.setValue(1);
    Animated.timing(countdownAnim, {
      toValue: 0,
      duration: CANCEL_WINDOW_MS,
      useNativeDriver: false,
    }).start();

    announce(t('send.processing'));

    let sec = 3;
    countdownInterval.current = setInterval(() => {
      sec -= 1;
      setSecondsRemaining(sec);
      if (sec <= 0 && countdownInterval.current != null) {
        clearInterval(countdownInterval.current);
      }
    }, 1000);

    cancelTimer.current = setTimeout(() => {
      void finalizeWithdrawal();
    }, CANCEL_WINDOW_MS);
  }, [countdownAnim, finalizeWithdrawal, t]);

  const cancelWithdrawal = () => {
    if (cancelTimer.current != null) clearTimeout(cancelTimer.current);
    if (countdownInterval.current != null) clearInterval(countdownInterval.current);
    setCanCancel(false);
    void hapticCancel();
    announceError(t('send.cancelledBeforeSend'));
    setPhase('form');
  };

  const confirmCashOut = async () => {
    setConfirming(true);
    try {
      const capability = await getBiometricCapability();
      if (capability.hasHardware && capability.isEnrolled) {
        const auth = await authenticateWithBiometrics(
          t('send.biometricPrompt'),
          t('common.cancel'),
        );
        if (auth.status !== 'success') {
          void hapticCancel();
          announceError(t('send.authFailed'));
          return;
        }
      }
      startCancelWindow();
    } finally {
      setConfirming(false);
    }
  };

  const resetForm = () => {
    setAgentCode('');
    setAgentName('');
    setAmountText('');
    setPhase('form');
    void getBalance().then(setBalance);
  };

  // Form Phase
  if (phase === 'form') {
    return (
      <View style={styles.screen}>
        <HeaderBar
          title={t('cashout.title')}
          subtitle={undefined}
          showBack
          onBack={onDone}
          rightAction={<PrivateBalance amount={balance} />}
        />

        <ScrollView
          style={styles.screen}
          contentContainerStyle={styles.content}
          accessibilityLabel={t('cashout.title')}
          accessibilityHint="Form to enter agent code and withdrawal amount"
        >
          {/* Voice dictation: say the whole withdrawal in one sentence (P2) */}
          <VoiceDictationCard
            active={dictationActive}
            preview={preview}
            onStart={() => {
              void hapticTick();
              startDictation();
            }}
            onStop={stopDictation}
            screenHint={voiceExample}
          />

          <View style={styles.noticeCard}>
            <Text style={styles.noticeEmoji}>🛡️</Text>
            <View style={styles.noticeMeta}>
              <Text style={styles.noticeTitle}>{t('cashout.pinWarningTitle')}</Text>
              <Text style={styles.noticeBody}>
                {t('cashout.pinWarningBody')}
              </Text>
            </View>
          </View>

          <View style={styles.formCard}>
            <AccessibleField
              label={t('cashout.agentCodeLabel')}
              hint={t('cashout.agentCodeHint')}
              helper={t('cashout.agentCodeHelper')}
              prefix="🏪"
              value={agentCode}
              onChangeText={(text) => setAgentCode(text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={6}
            />

            <AccessibleField
              label={t('cashout.agentNameLabel')}
              hint={t('cashout.agentNameHint')}
              value={agentName}
              onChangeText={setAgentName}
              autoComplete="name"
            />

            <AccessibleField
              label={t('cashout.amountLabel')}
              hint={t('cashout.amountHint')}
              prefix="GH₵"
              value={amountText}
              onChangeText={(text) => setAmountText(text.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              inputMode="decimal"
            />

            {Number.isFinite(amount) && amount > 0 ? (
              <View
                accessible
                accessibilityRole="text"
                accessibilityLabel={`${t('cashout.feeLabel')}: ${formatMoney(fee)}. ${t('cashout.totalDeduction')}: ${formatMoney(total)}`}
                accessibilityHint="Calculated withdrawal fee"
                style={styles.feeCard}
              >
                <Text style={styles.feeText}>
                  {t('cashout.feeLabel')}: {formatMoney(fee)} • {t('cashout.totalDeduction')}: {formatMoney(total)}
                </Text>
              </View>
            ) : null}
          </View>

          <AccessibleButton
            label={t('common.continue')}
            hint="Review cash out details and listen to read-back"
            variant="hero"
            onPress={goToReview}
            style={styles.ctaButton}
            icon={<Text style={styles.ctaEmoji}>🔍</Text>}
          />

          <AccessibleButton
            label={t('common.cancel')}
            hint={t('send.cancelHint')}
            variant="secondary"
            onPress={onDone}
            style={styles.secondaryButton}
          />
        </ScrollView>
      </View>
    );
  }

  // Review Phase
  if (phase === 'review') {
    return (
      <View style={styles.screen}>
        <HeaderBar
          title={t('send.reviewHeading')}
          showBack
          onBack={() => setPhase('form')}
        />

        <ScrollView
          style={styles.screen}
          contentContainerStyle={styles.content}
          accessibilityLabel={t('send.reviewHeading')}
          accessibilityHint="Check withdrawal details before authorizing"
        >
          <View style={styles.voucherCard}>
            <View style={styles.voucherTop}>
              <Text style={styles.voucherTag}>{t('cashout.voucherTag')}</Text>
              <Text style={styles.voucherAmount}>{formatMoney(amount)}</Text>
              <Text style={styles.voucherSub}>{t('cashout.voucherSub')}</Text>
            </View>

            <View style={styles.voucherRows}>
              <ReviewRow caption={t('cashout.agentCodeLabel')} value={agentCode} />
              <ReviewRow caption={t('cashout.agentNameLabel')} value={displayAgentName} />
              <ReviewRow caption={t('cashout.feeLabel')} value={formatMoney(fee)} />
              <ReviewRow caption={t('cashout.totalDeduction')} value={formatMoney(total)} />
            </View>
          </View>

          {/* Audio Read-Back Card */}
          <AccessibleButton
            label={t('send.replay')}
            hint="Reads cash out details aloud again"
            variant="gold"
            onPress={playReadBack}
            style={styles.replayBtn}
            icon={<Text style={styles.ctaEmoji}>🔊</Text>}
          />

          <AccessibleButton
            label={t('common.confirm')}
            hint="Authorize cash out with biometrics"
            variant="hero"
            loading={confirming}
            onPress={() => {
              void confirmCashOut();
            }}
            style={styles.ctaButton}
            icon={<Text style={styles.ctaEmoji}>🔒</Text>}
          />

          <AccessibleButton
            label={t('common.cancel')}
            hint={t('send.cancelHint')}
            variant="danger"
            onPress={() => setPhase('form')}
            style={styles.secondaryButton}
          />
        </ScrollView>
      </View>
    );
  }

  // Processing 3-second Cancel Window
  if (phase === 'processing') {
    const progressWidth = countdownAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['0%', '100%'],
    });

    return (
      <View style={styles.screen}>
        <HeaderBar title={t('send.processing')} />

        <View style={styles.processingContainer}>
          <View style={styles.cancelCard}>
            <Text style={styles.countdownNumber}>{secondsRemaining}</Text>
            <Text style={styles.countdownTitle}>
              {t('send.cancelCountdown', { seconds: secondsRemaining })}
            </Text>
            <Text style={styles.countdownPrompt}>
              Tap Cancel below within 3 seconds if you did not mean to withdraw at this agent.
            </Text>

            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
            </View>

            {canCancel ? (
              <AccessibleButton
                label={t('common.cancel', 'CANCEL WITHDRAWAL NOW')}
                hint="Cancel this cash out immediately"
                variant="danger"
                onPress={cancelWithdrawal}
                style={styles.cancelCta}
                icon={<Text style={styles.ctaEmoji}>🛑</Text>}
              />
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  // Result Screen
  const isSuccess = result?.status === 'confirmed';

  return (
    <View style={styles.screen}>
      <HeaderBar title={isSuccess ? t('cashout.confirmed') : t('send.failed')} />

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        accessibilityLabel={isSuccess ? t('cashout.confirmed') : t('send.failed')}
        accessibilityHint="Cash out authorization outcome voucher"
      >
        <View style={[styles.resultCard, isSuccess ? styles.resultSuccess : styles.resultFailed]}>
          <View style={[styles.resultBadge, isSuccess ? styles.badgeSuccess : styles.badgeFailed]}>
            <Text style={styles.resultIcon}>{isSuccess ? '✓' : '✕'}</Text>
          </View>

          <Text style={[styles.resultTitle, isSuccess ? styles.textSuccess : styles.textFailed]}>
            {isSuccess ? t('cashout.confirmed') : t('send.failed')}
          </Text>

          {isSuccess && result?.transaction != null ? (
            <View style={styles.resultRows}>
              <ReviewRow caption={t('cashout.voucherTag')} value={formatMoney(result.transaction.amount)} />
              <ReviewRow caption={t('cashout.voucherAgent')} value={result.transaction.recipientName} />
              <ReviewRow caption={t('send.reference')} value={result.transaction.reference} />
            </View>
          ) : (
            <Text style={styles.errorText}>
              {result?.reason != null
                ? localizedFailureReason(t, result.reason)
                : t('send.failureGeneric')}
            </Text>
          )}
        </View>

        <AccessibleButton
          label={t('cashout.cashOutAnother', 'Another Cash Out')}
          hint="Make another cash withdrawal"
          variant="primary"
          onPress={resetForm}
          style={styles.ctaButton}
        />

        <AccessibleButton
          label={t('send.backToHome')}
          hint={t('send.backToHome')}
          variant="secondary"
          onPress={onDone}
          style={styles.secondaryButton}
        />
      </ScrollView>
    </View>
  );
}

function ReviewRow({ caption, value }: { caption: string; value: string }) {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${caption}: ${value}`}
      accessibilityHint={`Detail for ${caption}`}
      style={styles.reviewRow}
    >
      <Text style={styles.reviewCaption}>{caption}</Text>
      <Text style={styles.reviewValue}>{value}</Text>
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
  noticeCard: {
    flexDirection: 'row',
    backgroundColor: colors.momoYellowLight,
    padding: theme.spacing.md,
    borderRadius: theme.radii.lg,
    borderWidth: 1.5,
    borderColor: colors.momoYellow,
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
    alignItems: 'center',
  },
  noticeEmoji: {
    fontSize: 24,
  },
  noticeMeta: {
    flex: 1,
  },
  noticeTitle: {
    fontSize: theme.typography.small,
    fontWeight: '800',
    color: colors.navyMidnight,
    marginBottom: 2,
  },
  noticeBody: {
    fontSize: theme.typography.tiny,
    color: colors.textMuted,
    fontWeight: '600',
  },
  formCard: {
    backgroundColor: colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: theme.spacing.md,
  },
  feeCard: {
    backgroundColor: colors.momoYellowLight,
    padding: theme.spacing.sm,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: colors.momoYellow,
    marginBottom: theme.spacing.sm,
  },
  feeText: {
    fontSize: theme.typography.tiny,
    fontWeight: '700',
    color: colors.navyMidnight,
  },
  ctaButton: {
    minHeight: 56,
    borderRadius: theme.radii.lg,
    marginBottom: theme.spacing.sm,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: theme.radii.lg,
    marginBottom: theme.spacing.sm,
  },
  ctaEmoji: {
    fontSize: 20,
    marginRight: 4,
  },
  voucherCard: {
    backgroundColor: colors.surface,
    borderRadius: theme.radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: theme.spacing.md,
    overflow: 'hidden',
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
    fontSize: 36,
    fontWeight: '900',
    color: colors.textOnNavy,
    letterSpacing: -0.5,
  },
  voucherSub: {
    fontSize: theme.typography.small,
    color: colors.textOnNavyMuted,
    fontWeight: '600',
  },
  voucherRows: {
    padding: theme.spacing.md,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reviewCaption: {
    fontSize: theme.typography.small,
    color: colors.textMuted,
    fontWeight: '600',
  },
  reviewValue: {
    fontSize: theme.typography.body,
    fontWeight: '800',
    color: colors.text,
  },
  replayBtn: {
    minHeight: 48,
    borderRadius: theme.radii.md,
    marginBottom: theme.spacing.md,
  },
  processingContainer: {
    flex: 1,
    padding: theme.spacing.lg,
    justifyContent: 'center',
  },
  cancelCard: {
    backgroundColor: colors.surface,
    padding: theme.spacing.xl,
    borderRadius: theme.radii.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  countdownNumber: {
    fontSize: 64,
    fontWeight: '900',
    color: colors.danger,
    marginBottom: theme.spacing.xs,
  },
  countdownTitle: {
    fontSize: theme.typography.heading,
    fontWeight: '800',
    color: colors.text,
    marginBottom: theme.spacing.xs,
  },
  countdownPrompt: {
    fontSize: theme.typography.small,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
  },
  progressTrack: {
    width: '100%',
    height: 8,
    backgroundColor: colors.surfaceMuted,
    borderRadius: theme.radii.full,
    overflow: 'hidden',
    marginBottom: theme.spacing.xl,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.danger,
  },
  cancelCta: {
    width: '100%',
    minHeight: 56,
    borderRadius: theme.radii.lg,
  },
  resultCard: {
    backgroundColor: colors.surface,
    padding: theme.spacing.xl,
    borderRadius: theme.radii.xl,
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
    borderWidth: 1.5,
  },
  resultSuccess: {
    borderColor: colors.success,
  },
  resultFailed: {
    borderColor: colors.danger,
  },
  resultBadge: {
    width: 64,
    height: 64,
    borderRadius: theme.radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
  },
  badgeSuccess: {
    backgroundColor: colors.successLight,
  },
  badgeFailed: {
    backgroundColor: colors.dangerLight,
  },
  resultIcon: {
    fontSize: 32,
    fontWeight: '900',
  },
  resultTitle: {
    fontSize: theme.typography.heading,
    fontWeight: '800',
    marginBottom: theme.spacing.md,
    textAlign: 'center',
  },
  textSuccess: {
    color: colors.successDark,
  },
  textFailed: {
    color: colors.dangerDark,
  },
  resultRows: {
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: theme.spacing.sm,
  },
  errorText: {
    fontSize: theme.typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
}));

