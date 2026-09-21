import { useState } from 'react';
import {ScrollView, Text, View} from 'react-native';
import { useTranslation } from 'react-i18next';

import { announceError, announceSuccess } from '../a11y/announcer';
import { AccessibleButton } from '../components/AccessibleButton';
import { AccessibleField } from '../components/AccessibleField';
import { HeaderBar } from '../components/HeaderBar';
import { theme, themedStyles } from '../constants/theme';
import { getAppLanguage } from '../i18n';
import { hapticConfirm, hapticError, hapticTick } from '../services/haptics';
import { isHeadphonesConnected } from '../services/headphones';
import { speak, stopSpeaking } from '../services/speech';
import { importSmsTransaction, type Transaction, type TransactionType } from '../services/transactions';

const GHS = 'GH₵';

function formatMoney(amount: number): string {
  return `${GHS} ${amount.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const SAMPLE_SMS = [
  'Payment received for GHS 250.00 from Kojo Asante (0244112233). Current Balance: GHS 1,450.00. Transaction ID: 9876543210.',
  'Payment made for GHS 120.00 to Akosua Darko (0208899001). Fee: GHS 1.00. Current Balance: GHS 1,079.00. Transaction ID: 5544332211.',
  'Cash Out of GHS 200.00 made at Mama Grace Venture (Agent: 654321). Fee: GHS 2.00. Transaction ID: 7788990011.',
];

export function SmsImportScreen({
  onDone,
  onViewStatement,
}: {
  onDone: () => void;
  onViewStatement: () => void;
}) {
  const { t } = useTranslation();

  const [smsText, setSmsText] = useState(SAMPLE_SMS[0]);
  const [parsedTxn, setParsedTxn] = useState<Transaction | null>(null);
  const [sampleIndex, setSampleIndex] = useState(0);

  const loadNextSample = () => {
    void hapticTick();
    const nextIdx = (sampleIndex + 1) % SAMPLE_SMS.length;
    setSampleIndex(nextIdx);
    setSmsText(SAMPLE_SMS[nextIdx]);
    setParsedTxn(null);
  };

  const parseMoMoSms = async () => {
    void hapticTick();
    stopSpeaking();

    const text = smsText.trim();
    let type: TransactionType = 'send';
    let amount = 0;
    let fee = 0;
    let partyName = 'Unknown Party';
    let partyPhone = '0000000000';
    let reference = `SMS-${Date.now() % 10000}`;

    // Regex matchers for Ghana MTN MoMo confirmation formats
    if (text.toLowerCase().includes('payment received')) {
      type = 'receive';
      const amtMatch = text.match(/GHS\s*([\d,.]+)/i);
      if (amtMatch) amount = parseFloat(amtMatch[1].replace(/,/g, ''));

      const fromMatch = text.match(/from\s+([^(]+)\s*\(([^)]+)\)/i);
      if (fromMatch) {
        partyName = fromMatch[1].trim();
        partyPhone = fromMatch[2].trim();
      }
    } else if (text.toLowerCase().includes('cash out')) {
      type = 'withdraw';
      const amtMatch = text.match(/GHS\s*([\d,.]+)/i);
      if (amtMatch) amount = parseFloat(amtMatch[1].replace(/,/g, ''));

      const feeMatch = text.match(/Fee:\s*GHS\s*([\d,.]+)/i);
      if (feeMatch) fee = parseFloat(feeMatch[1].replace(/,/g, ''));

      const agentMatch = text.match(/at\s+([^(]+)\s*\(Agent:\s*([^)]+)\)/i);
      if (agentMatch) {
        partyName = agentMatch[1].trim();
        partyPhone = agentMatch[2].trim();
      }
    } else if (text.toLowerCase().includes('payment made')) {
      type = 'send';
      const amtMatch = text.match(/GHS\s*([\d,.]+)/i);
      if (amtMatch) amount = parseFloat(amtMatch[1].replace(/,/g, ''));

      const feeMatch = text.match(/Fee:\s*GHS\s*([\d,.]+)/i);
      if (feeMatch) fee = parseFloat(feeMatch[1].replace(/,/g, ''));

      const toMatch = text.match(/to\s+([^(]+)\s*\(([^)]+)\)/i);
      if (toMatch) {
        partyName = toMatch[1].trim();
        partyPhone = toMatch[2].trim();
      }
    } else {
      void hapticError();
      announceError(t('sms.errorNoMatch'));
      return;
    }

    const refMatch = text.match(/Transaction ID:\s*(\w+)/i);
    if (refMatch) reference = refMatch[1];

    const saved = await importSmsTransaction({
      type,
      amount,
      recipientPhone: partyPhone,
      recipientName: partyName,
      fee,
      reference,
    });

    setParsedTxn(saved);
    void hapticConfirm();

    const announceMsg = t('sms.successAnnouncement', {
      amount: formatMoney(amount),
      party: partyName,
    });

    const isPrivate = await isHeadphonesConnected();
    if (isPrivate) {
      speak(announceMsg, getAppLanguage());
    } else {
      announceSuccess(announceMsg);
    }
  };

  return (
    <View style={styles.screen}>
      <HeaderBar
        title={t('sms.title')}
        subtitle={t('sms.subtitle')}
        showBack
        onBack={onDone}
      />

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        accessibilityLabel={t('sms.title')}
        accessibilityHint="Tool to extract and import transactions from MTN MoMo SMS"
      >
        <View style={styles.card}>
          <AccessibleField
            label={t('sms.inputLabel')}
            hint={t('sms.inputHint')}
            value={smsText}
            onChangeText={setSmsText}
            multiline
            numberOfLines={4}
            style={styles.smsInput}
          />

          <AccessibleButton
            label={t('sms.loadSample', 'Load Another Sample SMS')}
            hint="Cycles through different MTN MoMo received and sent SMS texts"
            variant="outline"
            onPress={loadNextSample}
            style={styles.sampleBtn}
            icon={<Text style={styles.btnEmoji}>🔄</Text>}
          />
        </View>

        <AccessibleButton
          label={t('sms.parseBtn', 'Parse & Import Transaction')}
          hint="Extracts amount, recipient and ID, then adds to your MoMo statement"
          variant="hero"
          onPress={() => {
            void parseMoMoSms();
          }}
          style={styles.ctaBtn}
          icon={<Text style={styles.btnEmoji}>⚡</Text>}
        />

        {/* Parsed Result Voucher */}
        {parsedTxn != null ? (
          <View style={styles.resultVoucher}>
            <View style={styles.voucherTop}>
              <Text style={styles.voucherSuccessTag}>✓ {t('sms.parsedTag')}</Text>
              <Text style={styles.voucherAmount}>{formatMoney(parsedTxn.amount)}</Text>
              <Text style={styles.voucherParty}>{parsedTxn.recipientName}</Text>
            </View>

            <View style={styles.voucherDetails}>
              <ReviewRow caption={t('airtime.serviceType')} value={t(`home.type.${parsedTxn.type}`)} />
              <ReviewRow caption={t('sms.party')} value={parsedTxn.recipientName} />
              <ReviewRow caption={t('send.reviewPhoneLabel')} value={parsedTxn.recipientPhone} />
              <ReviewRow caption={t('cashout.feeLabel')} value={formatMoney(parsedTxn.fee)} />
              <ReviewRow caption={t('sms.reference')} value={parsedTxn.reference} />
            </View>

            <AccessibleButton
              label={t('home.viewAllStatement', 'View in Statement')}
              hint="Navigate to the statement narrator to listen to this transaction"
              variant="momo"
              onPress={onViewStatement}
              style={styles.statementBtn}
            />
          </View>
        ) : null}

        <AccessibleButton
          label={t('common.back')}
          hint={t('common.back')}
          variant="secondary"
          onPress={onDone}
          style={styles.secondaryBtn}
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
      accessibilityHint={`Extracted ${caption}`}
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
    borderRadius: theme.radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: theme.spacing.md,
  },
  smsInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  sampleBtn: {
    minHeight: 44,
    borderRadius: theme.radii.md,
  },
  btnEmoji: {
    fontSize: 18,
    marginRight: 4,
  },
  ctaBtn: {
    minHeight: 56,
    borderRadius: theme.radii.lg,
    marginBottom: theme.spacing.md,
  },
  secondaryBtn: {
    minHeight: 48,
    borderRadius: theme.radii.lg,
  },
  resultVoucher: {
    backgroundColor: colors.surface,
    borderRadius: theme.radii.xl,
    borderWidth: 1.5,
    borderColor: colors.success,
    marginBottom: theme.spacing.md,
    overflow: 'hidden',
  },
  voucherTop: {
    backgroundColor: colors.navyMidnight,
    padding: theme.spacing.lg,
    alignItems: 'center',
  },
  voucherSuccessTag: {
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
  voucherDetails: {
    padding: theme.spacing.md,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
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
  statementBtn: {
    margin: theme.spacing.md,
    minHeight: 48,
    borderRadius: theme.radii.md,
  },
}));
