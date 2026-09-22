import { useEffect, useState } from 'react';
import {Image, Platform, Pressable, ScrollView, Text, View} from 'react-native';
import { useTranslation } from 'react-i18next';

import { announce } from '../a11y/announcer';
import { AccessibleButton } from '../components/AccessibleButton';
import { HeaderBar } from '../components/HeaderBar';
import { PrivacyAudioBanner } from '../components/PrivacyAudioBanner';
import { theme, themedStyles } from '../constants/theme';
import { getAppLanguage } from '../i18n';
import { hapticAmount, hapticConfirm, hapticTick } from '../services/haptics';
import { useIsPrivateAudio } from '../services/headphones';
import { getCachedSettings, loadSettings, type NavPreset } from '../services/settings';
import { speak, stopSpeaking } from '../services/speech';
import { getBalance, listTransactions, type Transaction } from '../services/transactions';

const GHS = 'GH₵';

function formatMoney(amount: number): string {
  return `${GHS} ${amount.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export interface HomeScreenProps {
  onSendMoney: () => void;
  onViewStatement: () => void;
  onBuyAirtime: () => void;
  onCashOut: () => void;
  onOpenSettings: () => void;
  onOpenSms: () => void;
}

export function HomeScreen({
  onSendMoney,
  onViewStatement,
  onBuyAirtime,
  onCashOut,
  onOpenSettings,
  onOpenSms,
}: HomeScreenProps) {
  const { t } = useTranslation();
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceVisible, setBalanceVisible] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  // Live audio-route state: updates when headphones are plugged or unplugged.
  const isPrivateAudio = useIsPrivateAudio();
  const [navPreset, setNavPreset] = useState<NavPreset>(getCachedSettings().navPreset);

  useEffect(() => {
    let ignore = false;
    void (async () => {
      const [nextBalance, nextTransactions, appSettings] = await Promise.all([
        getBalance(),
        listTransactions(),
        loadSettings(),
      ]);
      if (!ignore) {
        setBalance(nextBalance);
        setTransactions(nextTransactions);
        setNavPreset(appSettings.navPreset);
        setLoading(false);
      }
    })();
    return () => {
      ignore = true;
      stopSpeaking();
    };
  }, []);

  const toggleBalance = () => {
    const nextVisible = !balanceVisible;
    setBalanceVisible(nextVisible);
    void hapticTick();
    announce(nextVisible ? t('home.balanceShown') : t('home.balanceHidden'));
  };

  const speakBalance = () => {
    if (balance == null) return;
    void hapticTick();
    const message = `${t('home.balanceLabel')}: ${formatMoney(balance)}`;
    if (isPrivateAudio) {
      speak(message, getAppLanguage());
    } else {
      void hapticAmount();
      announce(message);
    }
  };

  const speakSingleTransaction = (txn: Transaction) => {
    void hapticTick();
    const text = t('home.transactionLabel', {
      name: txn.recipientName,
      type: t(`home.type.${txn.type}`),
      amount: formatMoney(txn.amount),
      status: t(`home.status.${txn.status}`),
    });
    if (isPrivateAudio) {
      speak(text, getAppLanguage());
    } else {
      void hapticConfirm();
      announce(text);
    }
  };

  const balanceDisplay = balanceVisible && balance != null ? formatMoney(balance) : '••••••';

  return (
    <View style={styles.screen}>
      <HeaderBar onOpenSettings={onOpenSettings} />

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        accessibilityLabel={t('home.greeting')}
        accessibilityHint="Main home screen content area"
      >
        <PrivacyAudioBanner isPrivateAudio={isPrivateAudio} />

        {/* Iconic MTN MoMo Yellow Wallet Card */}
        <View style={styles.momoCard}>
          <View style={styles.cardHeader}>
            <View style={styles.cardPill}>
              <Image
                source={require('../../assets/safepay-symbol.png')}
                style={styles.cardLogoSymbol}
                resizeMode="contain"
                accessibilityLabel="SafePay Logo"
                accessibilityHint="SafePay verified account emblem"
                accessibilityIgnoresInvertColors
              />
              <Text style={styles.cardPillText}>{t('home.momoAccount', 'MTN Mobile Money')}</Text>
            </View>

            <AccessibleButton
              label={balanceVisible ? t('home.hideBalance', 'Hide') : t('home.showBalance', 'Show')}
              hint={balanceVisible ? t('home.hideBalance') : t('home.showBalance')}
              variant="navy"
              onPress={toggleBalance}
              style={styles.cardEyeBtn}
              textStyle={styles.cardEyeText}
            />
          </View>

          <Text style={styles.balanceCaption}>
            {balanceVisible ? t('home.balanceLabel') : t('home.balanceHiddenLabel')}
          </Text>

          <Text
            accessibilityRole="text"
            accessibilityLabel={`${t('home.balanceLabel')}: ${balanceDisplay}`}
            accessibilityHint="Current mobile money balance"
            style={styles.balanceAmount}
          >
            {balanceDisplay}
          </Text>

          <View style={styles.cardActionsRow}>
            <AccessibleButton
              label={t('home.listenBalance', 'Speak Balance')}
              hint={t('home.listenBalanceHint')}
              variant="navy"
              onPress={speakBalance}
              style={styles.cardActionBtn}
              icon={<Text style={styles.cardBtnEmoji}>🔊</Text>}
            />
          </View>
        </View>

        {/* MTN MoMo Signature Circular Action Tiles */}
        <View style={styles.section}>
          <Text
            accessibilityRole="header"
            aria-level={2}
            accessibilityHint="Quick access mobile money actions"
            style={styles.sectionHeading}
          >
            {t('home.quickActions', 'MoMo Services')}
          </Text>

          {navPreset === 'spatial' ? (
            <View style={styles.spatialGrid}>
              <View style={styles.spatialRow}>
                {/* Quadrant 1: Top-Left - Send */}
                <Pressable
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`Quadrant 1 Top-Left: ${t('home.sendMoney')}`}
                  accessibilityHint="Double-tap to open Send Money transfer"
                  onPressIn={() => {
                    void hapticTick();
                  }}
                  onPress={() => {
                    void hapticTick();
                    onSendMoney();
                  }}
                  style={({ pressed }) => [styles.spatialTile, pressed ? styles.tilePressed : null]}
                >
                  <View style={[styles.spatialTileCircle, styles.circlePrimary]}>
                    <Text style={styles.spatialEmoji}>💸</Text>
                  </View>
                  <Text style={styles.spatialLabel}>{t('home.sendMoney')}</Text>
                  <Text style={styles.spatialHint}>Q1 • Top-Left</Text>
                </Pressable>

                {/* Quadrant 2: Top-Right - Statement */}
                <Pressable
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`Quadrant 2 Top-Right: ${t('home.statement', 'Statement')}`}
                  accessibilityHint="Double-tap to open Spoken Statement Narrator"
                  onPressIn={() => {
                    void hapticTick();
                  }}
                  onPress={() => {
                    void hapticTick();
                    onViewStatement();
                  }}
                  style={({ pressed }) => [styles.spatialTile, pressed ? styles.tilePressed : null]}
                >
                  <View style={[styles.spatialTileCircle, styles.circleYellow]}>
                    <Text style={styles.spatialEmoji}>📻</Text>
                  </View>
                  <Text style={styles.spatialLabel}>{t('home.statement', 'Statement')}</Text>
                  <Text style={styles.spatialHint}>Q2 • Top-Right</Text>
                </Pressable>
              </View>

              <View style={styles.spatialRow}>
                {/* Quadrant 3: Bottom-Left - Airtime */}
                <Pressable
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`Quadrant 3 Bottom-Left: ${t('home.buyAirtime', 'Airtime & Data')}`}
                  accessibilityHint="Double-tap to open Airtime and Internet Data top-up"
                  onPressIn={() => {
                    void hapticTick();
                  }}
                  onPress={() => {
                    void hapticTick();
                    onBuyAirtime();
                  }}
                  style={({ pressed }) => [styles.spatialTile, pressed ? styles.tilePressed : null]}
                >
                  <View style={[styles.spatialTileCircle, styles.circleMuted]}>
                    <Text style={styles.spatialEmoji}>📱</Text>
                  </View>
                  <Text style={styles.spatialLabel}>{t('home.buyAirtime', 'Airtime')}</Text>
                  <Text style={styles.spatialHint}>Q3 • Bottom-Left</Text>
                </Pressable>

                {/* Quadrant 4: Bottom-Right - Cash Out */}
                <Pressable
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`Quadrant 4 Bottom-Right: ${t('home.cashOut', 'Cash Out')}`}
                  accessibilityHint="Double-tap to open Agent Cash Out without PIN sharing"
                  onPressIn={() => {
                    void hapticTick();
                  }}
                  onPress={() => {
                    void hapticTick();
                    onCashOut();
                  }}
                  style={({ pressed }) => [styles.spatialTile, pressed ? styles.tilePressed : null]}
                >
                  <View style={[styles.spatialTileCircle, styles.circleMuted]}>
                    <Text style={styles.spatialEmoji}>🏧</Text>
                  </View>
                  <Text style={styles.spatialLabel}>{t('home.cashOut', 'Cash Out')}</Text>
                  <Text style={styles.spatialHint}>Q4 • Bottom-Right</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.momoActionRow}>
              {/* Send Money */}
              <Pressable
                accessible
                accessibilityRole="button"
                accessibilityLabel={t('home.sendMoney')}
                accessibilityHint={t('home.sendMoneyHint')}
                onPress={() => {
                  void hapticTick();
                  onSendMoney();
                }}
                style={({ pressed }) => [styles.momoTile, pressed ? styles.tilePressed : null]}
              >
                <View style={[styles.momoTileCircle, styles.circlePrimary]}>
                  <Text style={styles.tileEmoji}>💸</Text>
                </View>
                <Text style={styles.tileLabel}>{t('home.sendMoney')}</Text>
              </Pressable>

              {/* Statement Narrator */}
              <Pressable
                accessible
                accessibilityRole="button"
                accessibilityLabel={t('home.statement', 'Statement')}
                accessibilityHint={t('home.statementHint', 'Opens spoken statement narrator')}
                onPress={() => {
                  void hapticTick();
                  onViewStatement();
                }}
                style={({ pressed }) => [styles.momoTile, pressed ? styles.tilePressed : null]}
              >
                <View style={[styles.momoTileCircle, styles.circleYellow]}>
                  <Text style={styles.tileEmoji}>📻</Text>
                </View>
                <Text style={styles.tileLabel}>{t('home.statement', 'Statement')}</Text>
              </Pressable>

              {/* Airtime & Data */}
              <Pressable
                accessible
                accessibilityRole="button"
                accessibilityLabel={t('home.buyAirtime', 'Airtime & Data')}
                accessibilityHint={t('home.buyAirtimeHint')}
                onPress={() => {
                  void hapticTick();
                  onBuyAirtime();
                }}
                style={({ pressed }) => [styles.momoTile, pressed ? styles.tilePressed : null]}
              >
                <View style={[styles.momoTileCircle, styles.circleMuted]}>
                  <Text style={styles.tileEmoji}>📱</Text>
                </View>
                <Text style={styles.tileLabel}>{t('home.buyAirtime', 'Airtime')}</Text>
              </Pressable>

              {/* Cash Out */}
              <Pressable
                accessible
                accessibilityRole="button"
                accessibilityLabel={t('home.cashOut', 'Cash Out')}
                accessibilityHint={t('home.cashOutHint')}
                onPress={() => {
                  void hapticTick();
                  onCashOut();
                }}
                style={({ pressed }) => [styles.momoTile, pressed ? styles.tilePressed : null]}
              >
                <View style={[styles.momoTileCircle, styles.circleMuted]}>
                  <Text style={styles.tileEmoji}>🏧</Text>
                </View>
                <Text style={styles.tileLabel}>{t('home.cashOut', 'Cash Out')}</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Recent Transactions Feed */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text
              accessibilityRole="header"
              aria-level={2}
              accessibilityHint="Recent transaction history"
              style={styles.sectionHeading}
            >
              {t('home.recentTransactions')}
            </Text>

            <AccessibleButton
              label={t('home.viewAllStatement', 'View Statement')}
              hint={t('home.statementHint')}
              variant="ghost"
              onPress={onViewStatement}
              style={styles.viewStatementBtn}
              textStyle={styles.viewStatementText}
            />
          </View>

          {loading ? (
            <View style={styles.emptyCard}>
              <Text style={styles.mutedText}>{t('home.loading')}</Text>
            </View>
          ) : transactions.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.mutedText}>{t('home.noTransactions')}</Text>
            </View>
          ) : (
            transactions.slice(0, 5).map((txn) => {
              const isReceive = txn.type === 'receive';
              const isAirtime = txn.type === 'airtime';
              const isFailed = txn.status === 'failed';
              const icon = isReceive ? '📥' : isAirtime ? '📶' : '📤';

              return (
                <View
                  key={txn.id}
                  accessible
                  accessibilityRole="text"
                  accessibilityLabel={t('home.transactionLabel', {
                    name: txn.recipientName,
                    type: t(`home.type.${txn.type}`),
                    amount: formatMoney(txn.amount),
                    status: t(`home.status.${txn.status}`),
                  })}
                  accessibilityHint={t('home.listenHint')}
                  style={styles.txnCard}
                >
                  <View style={[styles.txnIconCircle, isReceive ? styles.iconIn : styles.iconOut]}>
                    <Text style={styles.txnEmoji}>{icon}</Text>
                  </View>

                  <View style={styles.txnBody}>
                    <Text style={styles.txnName}>{txn.recipientName}</Text>
                    <View style={styles.txnSubRow}>
                      <Text style={styles.txnSubText}>{t(`home.type.${txn.type}`)}</Text>
                      <Text style={styles.txnDot}>•</Text>
                      <Text
                        style={[
                          styles.statusBadge,
                          isFailed
                            ? styles.statusFailed
                            : txn.status === 'confirmed'
                              ? styles.statusConfirmed
                              : styles.statusPending,
                        ]}
                      >
                        {t(`home.status.${txn.status}`)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.txnRight}>
                    <Text
                      style={[
                        styles.txnAmount,
                        isReceive ? styles.amountIn : styles.amountOut,
                        isFailed ? styles.amountFailed : null,
                      ]}
                    >
                      {isReceive ? '+' : '−'}
                      {formatMoney(txn.amount)}
                    </Text>

                    <AccessibleButton
                      label="🔊"
                      hint={`${t('home.listen')}: ${txn.recipientName} ${formatMoney(txn.amount)}`}
                      variant="ghost"
                      onPress={() => speakSingleTransaction(txn)}
                      style={styles.speakBtn}
                      textStyle={styles.speakBtnText}
                    />
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* MoMo SMS Reader & Parser Card */}
        <View style={styles.section}>
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel={`${t('home.smsTool', 'MoMo SMS Parser')}. ${t('sms.subtitle', 'Extract & import transactions on-device from SMS')}`}
            accessibilityHint={t('home.smsToolHint', 'Parse and import transaction confirmation SMS')}
            onPress={() => {
              void hapticTick();
              onOpenSms();
            }}
            style={({ pressed }) => [styles.smsBanner, pressed ? styles.smsBannerPressed : null]}
          >
            <View style={styles.smsBannerIcon}>
              <Text style={styles.smsEmoji}>📩</Text>
            </View>
            <View style={styles.smsBannerBody}>
              <Text style={styles.smsBannerTitle}>{t('home.smsTool', 'MoMo SMS Parser')}</Text>
              <Text style={styles.smsBannerSubtitle}>
                {t('sms.subtitle', 'Extract & import transactions on-device from SMS')}
              </Text>
            </View>
            <Text style={styles.smsBannerArrow}>→</Text>
          </Pressable>
        </View>

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
  momoCard: {
    backgroundColor: colors.momoYellow,
    borderRadius: theme.radii.xl,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.momoYellowDark,
    ...Platform.select({
      web: {
        boxShadow: '0 4px 14px rgba(229, 183, 0, 0.35)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 4,
      },
    }),
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  cardPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(22, 18, 115, 0.12)',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.radii.full,
    gap: 6,
  },
  cardLogoSymbol: {
    width: 18,
    height: 18,
  },
  cardPillDot: {
    color: colors.navyMidnight,
    fontSize: 10,
  },
  cardPillText: {
    fontSize: theme.typography.tiny,
    fontWeight: '900',
    color: colors.navyMidnight,
    letterSpacing: 0.5,
  },
  cardEyeBtn: {
    minHeight: 36,
    minWidth: 70,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radii.full,
  },
  cardEyeText: {
    color: colors.momoYellow,
    fontSize: theme.typography.small,
    fontWeight: '800',
  },
  balanceCaption: {
    fontSize: theme.typography.small,
    color: colors.navyMidnight,
    fontWeight: '700',
    opacity: 0.8,
    marginBottom: 4,
  },
  balanceAmount: {
    fontSize: 38,
    fontWeight: '900',
    color: colors.navyMidnight,
    marginBottom: theme.spacing.md,
    letterSpacing: -0.8,
  },
  cardActionsRow: {
    flexDirection: 'row',
  },
  cardActionBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: theme.radii.md,
  },
  cardBtnEmoji: {
    fontSize: 16,
    marginRight: 4,
  },
  section: {
    marginBottom: theme.spacing.xl,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  sectionHeading: {
    fontSize: theme.typography.heading,
    fontWeight: '900',
    color: colors.navyMidnight,
    letterSpacing: -0.3,
    marginBottom: theme.spacing.xs,
  },
  viewStatementBtn: {
    minHeight: 36,
    paddingHorizontal: theme.spacing.sm,
  },
  viewStatementText: {
    fontSize: theme.typography.small,
    fontWeight: '800',
    color: colors.navyMidnight,
  },
  momoActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.xs,
  },
  momoTile: {
    flex: 1,
    alignItems: 'center',
    minHeight: theme.touchTarget.minSize,
    paddingVertical: theme.spacing.xs,
  },
  tilePressed: {
    opacity: 0.8,
    transform: [{ scale: 0.95 }],
  },
  momoTileCircle: {
    width: 58,
    height: 58,
    borderRadius: theme.radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.xs,
    ...Platform.select({
      web: {
        boxShadow: '0 2px 6px rgba(0, 0, 0, 0.08)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
      },
    }),
  },
  circlePrimary: {
    backgroundColor: colors.navyMidnight,
  },
  circleYellow: {
    backgroundColor: colors.momoYellow,
    borderWidth: 2,
    borderColor: colors.navyMidnight,
  },
  circleMuted: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  tileEmoji: {
    fontSize: 24,
  },
  tileLabel: {
    fontSize: theme.typography.tiny,
    fontWeight: '800',
    color: colors.navyMidnight,
    textAlign: 'center',
  },
  emptyCard: {
    backgroundColor: colors.surface,
    padding: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  mutedText: {
    fontSize: theme.typography.body,
    color: colors.textMuted,
  },
  txnCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radii.lg,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 64,
  },
  txnIconCircle: {
    width: 44,
    height: 44,
    borderRadius: theme.radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  iconIn: {
    backgroundColor: colors.successLight,
  },
  iconOut: {
    backgroundColor: colors.surfaceMuted,
  },
  txnEmoji: {
    fontSize: 18,
  },
  txnBody: {
    flex: 1,
    justifyContent: 'center',
  },
  txnName: {
    fontSize: theme.typography.body,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 2,
  },
  txnSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  txnSubText: {
    fontSize: theme.typography.tiny,
    color: colors.textMuted,
    fontWeight: '600',
  },
  txnDot: {
    fontSize: 10,
    color: colors.textLight,
  },
  statusBadge: {
    fontSize: theme.typography.tiny,
    fontWeight: '800',
  },
  statusConfirmed: {
    color: colors.success,
  },
  statusPending: {
    color: colors.warning,
  },
  statusFailed: {
    color: colors.danger,
  },
  txnRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  txnAmount: {
    fontSize: theme.typography.body,
    fontWeight: '900',
  },
  amountIn: {
    color: colors.success,
  },
  amountOut: {
    color: colors.navyMidnight,
  },
  amountFailed: {
    color: colors.danger,
    textDecorationLine: 'line-through',
  },
  speakBtn: {
    minHeight: 32,
    minWidth: 32,
    paddingHorizontal: 4,
    paddingVertical: 2,
    marginTop: 2,
  },
  speakBtnText: {
    fontSize: 14,
  },
  smsBanner: {
    backgroundColor: colors.surface,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    minHeight: theme.touchTarget.minSize,
    ...Platform.select({
      web: {
        boxShadow: '0 2px 8px rgba(0, 27, 58, 0.06)',
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
  smsBannerPressed: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.momoYellow,
  },
  smsBannerIcon: {
    width: 44,
    height: 44,
    borderRadius: theme.radii.full,
    backgroundColor: colors.momoYellowLight,
    borderWidth: 1.5,
    borderColor: colors.momoYellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smsEmoji: {
    fontSize: 20,
  },
  smsBannerBody: {
    flex: 1,
  },
  smsBannerTitle: {
    fontSize: theme.typography.body,
    fontWeight: '800',
    color: colors.navyMidnight,
  },
  smsBannerSubtitle: {
    fontSize: theme.typography.tiny,
    color: colors.textMuted,
    fontWeight: '600',
    marginTop: 2,
  },
  smsBannerArrow: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.navyMidnight,
  },
  spatialGrid: {
    gap: theme.spacing.md,
  },
  spatialRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  spatialTile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.borderDark,
    minHeight: 115,
    ...Platform.select({
      web: {
        boxShadow: '0 2px 8px rgba(22, 18, 115, 0.06)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 2,
      },
    }),
  },
  spatialTileCircle: {
    width: 52,
    height: 52,
    borderRadius: theme.radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.xs,
  },
  spatialEmoji: {
    fontSize: 24,
  },
  spatialLabel: {
    fontSize: theme.typography.body,
    fontWeight: '800',
    color: colors.navyMidnight,
    textAlign: 'center',
  },
  spatialHint: {
    fontSize: theme.typography.tiny,
    fontWeight: '700',
    color: colors.textMuted,
    marginTop: 2,
  },
}));
