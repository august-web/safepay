import { useEffect, useState } from 'react';
import {ScrollView, Text, View} from 'react-native';
import { useTranslation } from 'react-i18next';

import { announce, announceError, announceSuccess } from '../a11y/announcer';
import { AccessibleButton } from '../components/AccessibleButton';
import { AccessibleField } from '../components/AccessibleField';
import { HeaderBar } from '../components/HeaderBar';
import { theme, themedStyles } from '../constants/theme';
import { getAppLanguage } from '../i18n';
import { localizedFailureReason } from '../i18n/failureReason';
import { authenticateWithBiometrics, getBiometricCapability } from '../services/biometrics';
import { hapticCancel, hapticConfirm, hapticError, hapticTick } from '../services/haptics';
import { useIsPrivateAudio } from '../services/headphones';
import { speak, stopSpeaking } from '../services/speech';
import { buyAirtime, getBalance, type SendResult } from '../services/transactions';

const GHS = 'GH₵';

function formatMoney(amount: number): string {
  return `${GHS} ${amount.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const PRESET_AMOUNTS = [5, 10, 20, 50];
const MY_NUMBER = '0241234567';

export function BuyAirtimeScreen({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<'form' | 'review' | 'result'>('form');
  const [recipientType, setRecipientType] = useState<'self' | 'other'>('self');
  const [serviceType, setServiceType] = useState<'credit' | 'data'>('credit');
  const [phone, setPhone] = useState(MY_NUMBER);
  const [amountText, setAmountText] = useState('10');
  const [balance, setBalance] = useState(0);
  const isPrivateAudio = useIsPrivateAudio();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  const amount = Number.parseFloat(amountText.replace(/,/g, ''));

  useEffect(() => {
    void getBalance().then(setBalance);
    return () => {
      stopSpeaking();
    };
  }, []);

  const selectRecipient = (type: 'self' | 'other') => {
    void hapticTick();
    setRecipientType(type);
    if (type === 'self') {
      setPhone(MY_NUMBER);
    } else {
      setPhone('');
    }
  };

  const selectService = (type: 'credit' | 'data') => {
    void hapticTick();
    setServiceType(type);
  };

  const selectPresetAmount = (val: number) => {
    void hapticTick();
    setAmountText(String(val));
  };

  const serviceName = serviceType === 'credit' ? t('airtime.credit') : t('airtime.data');

  const readBackMessage = t('airtime.readBack', {
    amount: formatMoney(amount || 0),
    service: serviceName,
    phone: phone || MY_NUMBER,
  });

  const playReadBack = () => {
    void hapticTick();
    if (isPrivateAudio) {
      speak(readBackMessage, getAppLanguage());
    } else {
      void hapticConfirm();
      announce(readBackMessage);
    }
  };

  const validate = (): boolean => {
    if (!Number.isFinite(amount) || amount <= 0) {
      void hapticError();
      announceError(t('airtime.errorAmount'));
      return false;
    }
    if (amount > balance) {
      void hapticError();
      announceError(t('send.errors.insufficient'));
      return false;
    }
    if (phone.trim().length < 10) {
      void hapticError();
      announceError(t('airtime.errorPhone'));
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

  const confirmAirtime = async () => {
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

      const res = await buyAirtime({
        amount,
        recipientPhone: phone,
        recipientName: recipientType === 'self' ? 'Self' : phone,
      });

      setResult(res);
      setPhase('result');

      if (res.status === 'confirmed') {
        void hapticConfirm();
        announceSuccess(
          t('airtime.confirmedAnnouncement', {
            amount: formatMoney(amount),
            phone,
          }),
        );
      } else {
        void hapticError();
        announceError(t('send.failedAnnouncement', { reason: localizedFailureReason(t, res.reason) }));
      }
    } finally {
      setConfirming(false);
    }
  };

  const resetForm = () => {
    setAmountText('10');
    setRecipientType('self');
    setPhone(MY_NUMBER);
    setPhase('form');
    void getBalance().then(setBalance);
  };

  // Form Screen
  if (phase === 'form') {
    return (
      <View style={styles.screen}>
        <HeaderBar
          title={t('airtime.title')}
          subtitle={formatMoney(balance)}
          showBack
          onBack={onDone}
        />

        <ScrollView
          style={styles.screen}
          contentContainerStyle={styles.content}
          accessibilityLabel={t('airtime.title')}
          accessibilityHint="Buy airtime or data bundles"
        >
          {/* Recipient Segmented Selector */}
          <View style={styles.card}>
            <Text style={styles.label}>{t('airtime.recipient')}</Text>
            <View
              accessible
              accessibilityRole="radiogroup"
              accessibilityLabel={t('airtime.recipient')}
              accessibilityHint="Choose yourself or another phone number"
              style={styles.segmentedRow}
            >
              <AccessibleButton
                label={t('airtime.self')}
                hint="Buy for your own registered phone number"
                accessibilityState={{ selected: recipientType === 'self' }}
                variant={recipientType === 'self' ? 'momo' : 'outline'}
                onPress={() => selectRecipient('self')}
                style={styles.segmentBtn}
              />
              <AccessibleButton
                label={t('airtime.other')}
                hint="Enter another mobile phone number"
                accessibilityState={{ selected: recipientType === 'other' }}
                variant={recipientType === 'other' ? 'momo' : 'outline'}
                onPress={() => selectRecipient('other')}
                style={styles.segmentBtn}
              />
            </View>
          </View>

          {/* Service Type (Credit vs Data) */}
          <View style={styles.card}>
            <Text style={styles.label}>{t('airtime.serviceType')}</Text>
            <View
              accessible
              accessibilityRole="radiogroup"
              accessibilityLabel={t('airtime.serviceType')}
              accessibilityHint="Choose airtime credit or internet data"
              style={styles.segmentedRow}
            >
              <AccessibleButton
                label={t('airtime.credit')}
                hint="Select normal airtime credit balance"
                accessibilityState={{ selected: serviceType === 'credit' }}
                variant={serviceType === 'credit' ? 'momo' : 'outline'}
                onPress={() => selectService('credit')}
                style={styles.segmentBtn}
              />
              <AccessibleButton
                label={t('airtime.data')}
                hint="Select internet data bundle"
                accessibilityState={{ selected: serviceType === 'data' }}
                variant={serviceType === 'data' ? 'momo' : 'outline'}
                onPress={() => selectService('data')}
                style={styles.segmentBtn}
              />
            </View>
          </View>

          {/* Phone Number Field */}
          {recipientType === 'other' ? (
            <AccessibleField
              label={t('airtime.phoneLabel')}
              hint={t('airtime.phoneHint')}
              prefix="📱"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              inputMode="tel"
              autoComplete="tel"
            />
          ) : null}

          {/* Amount Selection */}
          <View style={styles.card}>
            <Text style={styles.label}>{t('airtime.quickAmounts')}</Text>

            <View
              accessible
              accessibilityRole="radiogroup"
              accessibilityLabel={t('airtime.quickAmounts')}
              accessibilityHint="Preset airtime amounts"
              style={styles.quickGrid}
            >
              {PRESET_AMOUNTS.map((val) => {
                const isSelected = amount === val;
                return (
                  <AccessibleButton
                    key={val}
                    label={`GH₵ ${val}`}
                    hint={`Select ${val} cedis airtime`}
                    accessibilityState={{ selected: isSelected }}
                    variant={isSelected ? 'momo' : 'outline'}
                    onPress={() => selectPresetAmount(val)}
                    style={styles.quickBtn}
                  />
                );
              })}
            </View>

            <AccessibleField
              label={t('airtime.amountLabel')}
              hint={t('airtime.amountHint')}
              prefix="GH₵"
              value={amountText}
              onChangeText={(text) => setAmountText(text.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              inputMode="decimal"
            />
          </View>

          <AccessibleButton
            label={t('common.continue')}
            hint="Review and confirm airtime purchase"
            variant="hero"
            onPress={goToReview}
            style={styles.ctaButton}
            icon={<Text style={styles.ctaEmoji}>⚡</Text>}
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

  // Review Screen
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
          accessibilityHint="Check airtime purchase details"
        >
          <View style={styles.voucherCard}>
            <View style={styles.voucherTop}>
              <Text style={styles.voucherTag}>MTN MoMo Airtime</Text>
              <Text style={styles.voucherAmount}>{formatMoney(amount)}</Text>
              <Text style={styles.voucherSub}>{serviceName}</Text>
            </View>

            <View style={styles.voucherRows}>
              <ReviewRow caption={t('airtime.recipient')} value={recipientType === 'self' ? t('airtime.self') : phone} />
              <ReviewRow caption={t('airtime.serviceType')} value={serviceName} />
              <ReviewRow caption={t('send.reviewFeeLabel')} value="GH₵ 0.00" />
            </View>
          </View>

          {/* Audio Read-Back Button */}
          <AccessibleButton
            label={t('send.replay')}
            hint="Reads purchase details aloud again"
            variant="gold"
            onPress={playReadBack}
            style={styles.replayBtn}
            icon={<Text style={styles.ctaEmoji}>🔊</Text>}
          />

          <AccessibleButton
            label={t('common.confirm')}
            hint="Authorize payment with your fingerprint"
            variant="hero"
            loading={confirming}
            onPress={() => {
              void confirmAirtime();
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

  // Result Screen
  const isSuccess = result?.status === 'confirmed';

  return (
    <View style={styles.screen}>
      <HeaderBar title={isSuccess ? t('airtime.confirmed') : t('send.failed')} />

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        accessibilityLabel={isSuccess ? t('airtime.confirmed') : t('send.failed')}
        accessibilityHint="Airtime purchase confirmation result"
      >
        <View style={[styles.resultCard, isSuccess ? styles.resultSuccess : styles.resultFailed]}>
          <View style={[styles.resultBadge, isSuccess ? styles.badgeSuccess : styles.badgeFailed]}>
            <Text style={styles.resultIcon}>{isSuccess ? '✓' : '✕'}</Text>
          </View>

          <Text style={[styles.resultTitle, isSuccess ? styles.textSuccess : styles.textFailed]}>
            {isSuccess ? t('airtime.confirmed') : t('send.failed')}
          </Text>

          {isSuccess && result?.transaction != null ? (
            <View style={styles.resultRows}>
              <ReviewRow caption={t('airtime.amountLabel')} value={formatMoney(result.transaction.amount)} />
              <ReviewRow caption={t('airtime.phoneLabel')} value={result.transaction.recipientPhone} />
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
          label={t('airtime.buyMore', 'Buy More Airtime')}
          hint="Make another airtime purchase"
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
  card: {
    backgroundColor: colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: theme.spacing.md,
  },
  label: {
    fontSize: theme.typography.small,
    fontWeight: '800',
    color: colors.text,
    marginBottom: theme.spacing.sm,
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  segmentBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: theme.radii.md,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  quickBtn: {
    flex: 1,
    minWidth: '45%',
    minHeight: 44,
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
