import { useCallback, useEffect, useRef, useState } from 'react';
import {Animated, Platform, ScrollView, Text, View} from 'react-native';
import { useTranslation } from 'react-i18next';

import { announce, announceError, announceSuccess } from '../a11y/announcer';
import { useAnnounceOnFocus } from '../a11y/useAnnounceOnFocus';
import { AccessibleButton } from '../components/AccessibleButton';
import { AccessibleField } from '../components/AccessibleField';
import { HeaderBar } from '../components/HeaderBar';
import { theme, themedStyles } from '../constants/theme';
import { getAppLanguage } from '../i18n';
import { localizedFailureReason } from '../i18n/failureReason';
import {
  authenticateWithBiometrics,
  getBiometricCapability,
  getBiometricTypeName,
} from '../services/biometrics';
import { hapticCancel, hapticConfirm, hapticError, hapticTick } from '../services/haptics';
import { useIsPrivateAudio } from '../services/headphones';
import { speak, stopSpeaking } from '../services/speech';
import { calculateFee, getBalance, sendMoney, type SendResult } from '../services/transactions';

const GHS = 'GH₵';

function formatMoney(amount: number): string {
  return `${GHS} ${amount.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Normalizes Ghana numbers: +233XXXXXXXXX / 233XXXXXXXXX -> 0XXXXXXXXX */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[\s()-]/g, '');
  if (digits.startsWith('+233')) return `0${digits.slice(4)}`;
  if (digits.startsWith('233') && digits.length === 12) return `0${digits.slice(3)}`;
  return digits;
}

function isValidGhanaPhone(raw: string): boolean {
  return /^0\d{9}$/.test(normalizePhone(raw));
}

type Phase = 'form' | 'review' | 'processing' | 'result';

const CANCEL_WINDOW_MS = 3000;

export function SendMoneyScreen({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('form');
  const [amountText, setAmountText] = useState('');
  const [phoneText, setPhoneText] = useState('');
  const [nameText, setNameText] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; phone?: string; name?: string }>({});
  const [balance, setBalance] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const privateAudio = useIsPrivateAudio();
  const [secondsRemaining, setSecondsRemaining] = useState(3);

  // Initialize animated value in state to comply with React 19 rules
  const [countdownAnim] = useState(() => new Animated.Value(1));
  const cancelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const amount = Number.parseFloat(amountText.replace(/,/g, ''));
  const fee = Number.isFinite(amount) && amount > 0 ? calculateFee(amount) : 0;
  const total = Number.isFinite(amount) && amount > 0 ? amount + fee : 0;
  const reviewName = nameText.trim() || t('home.unknownRecipient');

  useEffect(() => {
    void getBalance().then(setBalance);
    return () => {
      if (cancelTimer.current != null) clearTimeout(cancelTimer.current);
      if (countdownInterval.current != null) clearInterval(countdownInterval.current);
      stopSpeaking();
    };
  }, []);

  useAnnounceOnFocus(phase === 'review' ? t('send.reviewHeading') : null);

  const readBackMessage = t('send.readBack', {
    amount: formatMoney(amount),
    recipient: reviewName,
    fee: formatMoney(fee),
    total: formatMoney(total),
  });

  /** Spoken read-back when the audio route is private, haptics otherwise. */
  const playReadBack = useCallback(() => {
    void hapticTick();
    if (privateAudio) {
      speak(readBackMessage, getAppLanguage());
    } else {
      void hapticConfirm();
      announce(readBackMessage);
    }
  }, [privateAudio, readBackMessage]);

  const validate = useCallback((): boolean => {
    const nextErrors: typeof errors = {};
    if (!Number.isFinite(amount) || amount <= 0) {
      nextErrors.amount = t('send.errors.amount');
    } else if (amount + fee > balance) {
      nextErrors.amount = t('send.errors.insufficient');
    }
    if (!isValidGhanaPhone(phoneText)) {
      nextErrors.phone = t('send.errors.phone');
    }
    if (nameText.trim().length === 0) {
      nextErrors.name = t('send.errors.name');
    }
    setErrors(nextErrors);
    const firstError = nextErrors.amount ?? nextErrors.phone ?? nextErrors.name;
    if (firstError != null) {
      void hapticError();
      announceError(firstError);
      return false;
    }
    return true;
  }, [amount, balance, fee, nameText, phoneText, t]);

  const goToReview = () => {
    stopSpeaking();
    if (validate()) {
      void hapticTick();
      setPhase('review');
    }
  };

  const backToForm = () => {
    stopSpeaking();
    void hapticTick();
    setPhase('form');
  };

  const finalize = useCallback(async () => {
    setCanCancel(false);
    if (countdownInterval.current != null) clearInterval(countdownInterval.current);

    const sendResult = await sendMoney({
      amount,
      fee,
      recipientPhone: normalizePhone(phoneText),
      recipientName: nameText.trim(),
    });

    setResult(sendResult);
    setPhase('result');

    if (sendResult.status === 'confirmed') {
      void hapticConfirm();
      announceSuccess(
        t('send.confirmedAnnouncement', {
          amount: formatMoney(amount),
          recipient: reviewName,
          reference: sendResult.transaction?.reference ?? '',
        }),
      );
    } else {
      void hapticError();
      announceError(
        t('send.failedAnnouncement', {
          reason: localizedFailureReason(t, sendResult.reason),
        }),
      );
    }
  }, [amount, fee, nameText, phoneText, reviewName, t]);

  const startCancelWindow = useCallback(() => {
    cancelledRef.current = false;
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
      void finalize();
    }, CANCEL_WINDOW_MS);
  }, [countdownAnim, finalize, t]);

  const cancelBeforeSend = () => {
    cancelledRef.current = true;
    if (cancelTimer.current != null) clearTimeout(cancelTimer.current);
    if (countdownInterval.current != null) clearInterval(countdownInterval.current);
    setCanCancel(false);
    void hapticCancel();
    announceError(t('send.cancelledBeforeSend'));
    setPhase('form');
  };

  const confirmPayment = async () => {
    setConfirming(true);
    try {
      const capability = await getBiometricCapability();
      if (!capability.hasHardware || !capability.isEnrolled) {
        // Demo path (simulator/web): proceed without biometrics but notify user
        announce(t('send.biometricUnavailable'));
        startCancelWindow();
        return;
      }

      const typeName = await getBiometricTypeName();
      const authResult = await authenticateWithBiometrics(
        t('send.biometricPrompt'),
        t('common.cancel'),
      );

      switch (authResult.status) {
        case 'success':
          startCancelWindow();
          break;
        case 'user_cancel':
          void hapticCancel();
          announceError(
            t('send.authFailedAnnouncement', { reason: t('send.authCancelled') }),
          );
          break;
        case 'lockout':
          void hapticError();
          announceError(t('send.authFailedAnnouncement', { reason: t('send.authLocked') }));
          break;
        case 'failed':
          void hapticError();
          announceError(
            t('send.authFailedAnnouncement', {
              reason: `${t('send.authFailed')}${
                typeName != null ? ` (${t(`send.biometricType.${typeName}`)})` : ''
              }`,
            }),
          );
          break;
      }
    } finally {
      setConfirming(false);
    }
  };

  const resetForm = () => {
    setAmountText('');
    setPhoneText('');
    setNameText('');
    setErrors({});
    setResult(null);
    setPhase('form');
    void getBalance().then(setBalance);
  };

  // Step indicator
  const currentStep = phase === 'form' ? 1 : phase === 'review' || phase === 'processing' ? 2 : 3;

  const renderStepIndicator = () => (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={t('send.stepIndicator', {
        current: currentStep,
        total: 3,
        stepName:
          currentStep === 1
            ? t('send.step1')
            : currentStep === 2
              ? t('send.step2')
              : t('send.step3'),
      })}
      accessibilityHint="Progress across send money steps"
      style={styles.stepContainer}
    >
      <View style={styles.stepBarTrack}>
        <View
          style={[
            styles.stepBarFill,
            { width: currentStep === 1 ? '33%' : currentStep === 2 ? '66%' : '100%' },
          ]}
        />
      </View>
      <View style={styles.stepLabelsRow}>
        <Text style={[styles.stepLabel, currentStep >= 1 ? styles.stepActive : null]}>
          {t('send.step1', '1. Details')}
        </Text>
        <Text style={[styles.stepLabel, currentStep >= 2 ? styles.stepActive : null]}>
          {t('send.step2', '2. Verify')}
        </Text>
        <Text style={[styles.stepLabel, currentStep >= 3 ? styles.stepActive : null]}>
          {t('send.step3', '3. Receipt')}
        </Text>
      </View>
    </View>
  );

  // ---------------------------------------------------------------- form
  if (phase === 'form') {
    return (
      <View style={styles.screen}>
        <HeaderBar
          title={t('send.title')}
          subtitle={formatMoney(balance)}
          showBack
          onBack={onDone}
        />

        <ScrollView
          style={styles.screen}
          contentContainerStyle={styles.content}
          accessibilityLabel={t('send.title')}
          accessibilityHint="Form to enter recipient and amount"
        >
          {renderStepIndicator()}

          <View style={styles.formCard}>
            <AccessibleField
              label={t('send.amountLabel')}
              hint={t('send.amountHint')}
              prefix="GH₵"
              error={errors.amount ?? null}
              value={amountText}
              onChangeText={(text) => setAmountText(text.replace(/[^0-9.,]/g, ''))}
              keyboardType="decimal-pad"
              inputMode="decimal"
              autoComplete="off"
            />

            {/* Live Fee Calculator Preview */}
            {Number.isFinite(amount) && amount > 0 ? (
              <View
                accessible
                accessibilityRole="text"
                accessibilityLabel={t('send.feePreview', {
                  fee: formatMoney(fee),
                  total: formatMoney(total),
                })}
                accessibilityHint="Calculated mobile money fee and total amount"
                style={styles.feeCard}
              >
                <Text style={styles.feeLabel}>
                  {t('send.feePreview', {
                    fee: formatMoney(fee),
                    total: formatMoney(total),
                  })}
                </Text>
              </View>
            ) : null}

            <AccessibleField
              label={t('send.phoneLabel')}
              hint={t('send.phoneHint')}
              helper={t('send.phoneHelper', 'Accepted networks: MTN, Telecel, AT Ghana')}
              error={errors.phone ?? null}
              value={phoneText}
              onChangeText={setPhoneText}
              keyboardType="phone-pad"
              inputMode="tel"
              autoComplete="tel"
            />

            <AccessibleField
              label={t('send.nameLabel')}
              hint={t('send.nameHint')}
              error={errors.name ?? null}
              value={nameText}
              onChangeText={setNameText}
              autoComplete="name"
              returnKeyType="done"
            />
          </View>

          <AccessibleButton
            label={t('send.reviewButton')}
            hint={t('send.reviewButtonHint')}
            variant="hero"
            onPress={goToReview}
            style={styles.ctaButton}
            icon={<Text style={styles.btnEmoji}>🔍</Text>}
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

  // --------------------------------------------------------------- review
  if (phase === 'review') {
    return (
      <View style={styles.screen}>
        <HeaderBar
          title={t('send.reviewHeading')}
          showBack
          onBack={backToForm}
        />

        <ScrollView
          style={styles.screen}
          contentContainerStyle={styles.content}
          accessibilityLabel={t('send.reviewHeading')}
          accessibilityHint="Review transaction details and listen to verification read-back"
        >
          {renderStepIndicator()}

          {/* Digital Receipt Voucher */}
          <View style={styles.voucherCard}>
            <View style={styles.voucherTop}>
              <Text style={styles.voucherTag}>MTN MoMo SafePay</Text>
              <Text style={styles.voucherTotalAmount}>{formatMoney(total)}</Text>
              <Text style={styles.voucherTotalCaption}>{t('send.reviewTotalLabel')}</Text>
            </View>

            <View style={styles.voucherDivider} />

            <View style={styles.voucherRows}>
              <ReviewRow caption={t('send.reviewRecipientLabel')} value={reviewName} />
              <ReviewRow caption={t('send.reviewPhoneLabel')} value={normalizePhone(phoneText)} />
              <ReviewRow caption={t('send.reviewAmountLabel')} value={formatMoney(amount)} />
              <ReviewRow caption={t('send.reviewFeeLabel')} value={formatMoney(fee)} />
            </View>
          </View>

          {/* Audio Read-Back Card */}
          <View style={styles.audioReadCard}>
            <View style={styles.audioReadHeader}>
              <Text style={styles.audioReadIcon}>🔊</Text>
              <View style={styles.audioReadMeta}>
                <Text style={styles.audioReadTitle}>
                  {privateAudio ? t('privacy.privateTitle') : t('privacy.publicTitle')}
                </Text>
                <Text style={styles.audioReadSub}>
                  {privateAudio
                    ? t('privacy.privateDesc')
                    : t('privacy.publicDesc')}
                </Text>
              </View>
            </View>

            <AccessibleButton
              label={t('send.replay', 'Speak Details Again')}
              hint={t('send.replay')}
              variant="gold"
              onPress={playReadBack}
              style={styles.replayBtn}
              icon={<Text style={styles.smallEmoji}>🔁</Text>}
            />
          </View>

          <AccessibleButton
            label={t('common.confirm')}
            hint={t('send.confirmHint')}
            variant="hero"
            loading={confirming}
            onPress={() => {
              void confirmPayment();
            }}
            style={styles.ctaButton}
            icon={<Text style={styles.btnEmoji}>🔒</Text>}
          />

          <AccessibleButton
            label={t('common.cancel')}
            hint={t('send.cancelHint')}
            variant="danger"
            onPress={backToForm}
            style={styles.secondaryButton}
          />
        </ScrollView>
      </View>
    );
  }

  // ----------------------------------------------------------- processing (3-second cancel window)
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
              {t('send.cancelPrompt', 'Tap Cancel below within 3 seconds to abort this payment.')}
            </Text>

            {/* Visual Animated Countdown Bar */}
            <View style={styles.progressTrack}>
              <Animated.View
                style={[styles.progressFill, { width: progressWidth }]}
              />
            </View>

            {canCancel ? (
              <AccessibleButton
                label={t('common.cancel', 'CANCEL PAYMENT NOW')}
                hint={t('send.cancelHint')}
                variant="danger"
                onPress={cancelBeforeSend}
                style={styles.cancelCta}
                icon={<Text style={styles.btnEmoji}>🛑</Text>}
              />
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  // --------------------------------------------------------------- result
  const isSuccess = result?.status === 'confirmed';

  return (
    <View style={styles.screen}>
      <HeaderBar title={isSuccess ? t('send.confirmed') : t('send.failed')} />

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        accessibilityLabel={isSuccess ? t('send.confirmed') : t('send.failed')}
        accessibilityHint="Transaction outcome summary voucher"
      >
        {renderStepIndicator()}

        <View style={[styles.resultCard, isSuccess ? styles.resultSuccess : styles.resultFailed]}>
          <View style={[styles.resultBadge, isSuccess ? styles.badgeSuccess : styles.badgeFailed]}>
            <Text style={styles.resultIcon}>{isSuccess ? '✓' : '✕'}</Text>
          </View>

          <Text
            accessibilityRole="header"
            style={[styles.resultTitle, isSuccess ? styles.textSuccess : styles.textFailed]}
          >
            {isSuccess ? t('send.confirmed') : t('send.failed')}
          </Text>

          {isSuccess && result?.transaction != null ? (
            <View style={styles.resultDetails}>
              <ReviewRow
                caption={t('send.reviewAmountLabel')}
                value={formatMoney(result.transaction.amount)}
              />
              <ReviewRow
                caption={t('send.reviewRecipientLabel')}
                value={result.transaction.recipientName}
              />
              <ReviewRow
                caption={t('send.reference')}
                value={result.transaction.reference}
              />
            </View>
          ) : (
            <Text style={styles.failReason}>
              {result?.reason != null
                ? localizedFailureReason(t, result.reason)
                : t('send.failureGeneric')}
            </Text>
          )}
        </View>

        <AccessibleButton
          label={t('send.sendAnother', 'Send Another Payment')}
          hint={t('send.sendAnother')}
          variant="primary"
          onPress={resetForm}
          style={styles.ctaButton}
        />

        <AccessibleButton
          label={t('send.backToHome', 'Back to Home')}
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
      accessibilityHint={`Details for ${caption}`}
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
  stepContainer: {
    marginBottom: theme.spacing.lg,
  },
  stepBarTrack: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: theme.radii.full,
    overflow: 'hidden',
    marginBottom: theme.spacing.xs,
  },
  stepBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  stepLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stepLabel: {
    fontSize: theme.typography.tiny,
    fontWeight: '600',
    color: colors.textLight,
  },
  stepActive: {
    color: colors.primary,
    fontWeight: '800',
  },
  formCard: {
    backgroundColor: colors.surface,
    padding: theme.spacing.lg,
    borderRadius: theme.radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: theme.spacing.lg,
  },
  feeCard: {
    backgroundColor: colors.accentGoldLight,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radii.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: colors.accentGold,
  },
  feeLabel: {
    fontSize: theme.typography.small,
    fontWeight: '700',
    color: colors.accentGoldDark,
  },
  ctaButton: {
    minHeight: 56,
    borderRadius: theme.radii.lg,
    marginBottom: theme.spacing.sm,
    ...Platform.select({
      web: {
        boxShadow: '0 4px 12px rgba(11, 95, 191, 0.25)',
      },
      default: {
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
        elevation: 3,
      },
    }),
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: theme.radii.lg,
    marginBottom: theme.spacing.sm,
  },
  btnEmoji: {
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
    ...Platform.select({
      web: {
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
      },
    }),
  },
  voucherTop: {
    backgroundColor: colors.navy,
    padding: theme.spacing.lg,
    alignItems: 'center',
  },
  voucherTag: {
    fontSize: theme.typography.tiny,
    fontWeight: '800',
    color: colors.accentGold,
    letterSpacing: 0.5,
    marginBottom: theme.spacing.xs,
  },
  voucherTotalAmount: {
    fontSize: 36,
    fontWeight: '900',
    color: colors.textOnNavy,
    letterSpacing: -0.5,
  },
  voucherTotalCaption: {
    fontSize: theme.typography.small,
    color: colors.textOnNavyMuted,
    fontWeight: '600',
  },
  voucherDivider: {
    height: 1,
    backgroundColor: colors.border,
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
  audioReadCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  audioReadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  audioReadIcon: {
    fontSize: 24,
  },
  audioReadMeta: {
    flex: 1,
  },
  audioReadTitle: {
    fontSize: theme.typography.small,
    fontWeight: '800',
    color: colors.primaryDark,
  },
  audioReadSub: {
    fontSize: theme.typography.tiny,
    color: colors.textMuted,
  },
  replayBtn: {
    minHeight: 44,
    borderRadius: theme.radii.md,
  },
  smallEmoji: {
    fontSize: 16,
    marginRight: 4,
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
    ...Platform.select({
      web: {
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
      },
    }),
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
    color: colors.text,
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
  resultDetails: {
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: theme.spacing.sm,
  },
  failReason: {
    fontSize: theme.typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
}));
