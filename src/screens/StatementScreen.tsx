import { useCallback, useEffect, useRef, useState } from 'react';
import {Platform, ScrollView, Text, View} from 'react-native';
import { useTranslation } from 'react-i18next';

import { announce } from '../a11y/announcer';
import { needsOwnVoice } from '../a11y/screenReader';
import { AccessibleButton } from '../components/AccessibleButton';
import { HeaderBar } from '../components/HeaderBar';
import { PrivacyAudioBanner } from '../components/PrivacyAudioBanner';
import { theme, themedStyles } from '../constants/theme';
import { getAppLanguage } from '../i18n';
import { hapticAmount, hapticTick } from '../services/haptics';
import { useIsPrivateAudio } from '../services/headphones';
import { speak, stopSpeaking } from '../services/speech';
import { listTransactions, type Transaction } from '../services/transactions';

const GHS = 'GH₵';

function formatMoney(amount: number): string {
  return `${GHS} ${amount.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

type FilterType = 'all' | 'receive' | 'send' | 'airtime';

export function StatementScreen({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const isPrivateAudio = useIsPrivateAudio();

  // Audio player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  /** Invalidates a pending utterance completion when the user moves the player. */
  const playbackToken = useRef(0);
  /** TalkBack path has no completion callback, so it uses an estimated timer. */
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let ignore = false;
    void (async () => {
      const txns = await listTransactions();
      if (!ignore) {
        setTransactions(txns);
        setLoading(false);
      }
    })();
    return () => {
      ignore = true;
      stopSpeaking();
    };
  }, []);

  const filteredTransactions = transactions.filter((txn) => {
    if (filter === 'all') return true;
    return txn.type === filter;
  });

  // Calculate totals
  const totalIn = transactions
    .filter((txn) => txn.type === 'receive' && txn.status === 'confirmed')
    .reduce((sum, txn) => sum + txn.amount, 0);

  const totalOut = transactions
    .filter((txn) => (txn.type === 'send' || txn.type === 'airtime') && txn.status === 'confirmed')
    .reduce((sum, txn) => sum + txn.amount + txn.fee, 0);

  /**
   * Speaks one transaction and reports when the voice has finished.
   *
   * The player advances on that completion callback (with a safety timer as a
   * backstop), not on a fixed delay: a fixed 4.5s timer cut long entries off
   * mid-sentence and left silence after short ones - which reads as "the voice
   * is broken" to the person listening to it.
   */
  const speakTransactionItem = useCallback(
    (txn: Transaction, index: number, totalCount: number, onFinished?: () => void) => {
      const text = `${t('statement.nowReading', { current: index + 1, total: totalCount })}: ${t(
        'home.transactionLabel',
        {
          name: txn.recipientName,
          type: t(`home.type.${txn.type}`),
          amount: formatMoney(txn.amount),
          status: t(`home.status.${txn.status}`),
        },
      )}`;

      // Speak through the app's own voice whenever the app is the one talking
      // (private route, or no screen reader running) so the player gets a real
      // completion callback. Only hand off to TalkBack when it will speak.
      if (isPrivateAudio || needsOwnVoice()) {
        speak(text, getAppLanguage(), undefined, {
          onDone: onFinished,
          onStopped: onFinished,
          onError: () => onFinished?.(),
        });
        return;
      }

      void hapticAmount();
      announce(text);
      if (onFinished != null) {
        // TalkBack exposes no completion callback: estimate reading time.
        const estimated = Math.min(14_000, Math.max(3_000, text.length * 90));
        fallbackTimer.current = setTimeout(onFinished, estimated);
      }
    },
    [isPrivateAudio, t],
  );

  // Declarative speech playback cycle - advances when the voice finishes.
  useEffect(() => {
    if (!isPlaying || currentIndex == null) return;

    // The list shrinks if the filter changes: nothing to narrate, and the
    // filter handler resets the player.
    const currentTxn = filteredTransactions[currentIndex];
    if (currentTxn == null) return;

    // Each playback step owns a token, so an interrupted utterance cannot
    // advance the player after the user has moved on.
    const token = ++playbackToken.current;

    const advance = () => {
      if (token !== playbackToken.current) return;
      setCurrentIndex((prev) => {
        if (prev == null) return null;
        const next = prev + 1;
        if (next >= filteredTransactions.length) {
          setIsPlaying(false);
          announce(t('statement.allCompleted', 'Statement reading finished.'));
          return null;
        }
        return next;
      });
    };

    // Backstop for engines that never fire onDone, so the player cannot hang.
    const guard = setTimeout(advance, 20_000);
    speakTransactionItem(currentTxn, currentIndex, filteredTransactions.length, advance);

    return () => {
      clearTimeout(guard);
      if (fallbackTimer.current != null) {
        clearTimeout(fallbackTimer.current);
        fallbackTimer.current = null;
      }
    };
  }, [isPlaying, currentIndex, filteredTransactions, speakTransactionItem, t]);

  const handlePlayAll = () => {
    void hapticTick();
    if (isPlaying) {
      setIsPlaying(false);
      // Invalidate the in-flight utterance so its completion cannot skip ahead.
      playbackToken.current += 1;
      stopSpeaking();
      announce(t('statement.pause', 'Pause'));
    } else {
      if (filteredTransactions.length === 0) {
        announce(t('statement.empty', 'No transactions'));
        return;
      }
      stopSpeaking();
      setCurrentIndex(0);
      setIsPlaying(true);
    }
  };

  const handleNext = () => {
    void hapticTick();
    playbackToken.current += 1;
    if (filteredTransactions.length === 0) return;
    const nextIdx = currentIndex == null ? 0 : Math.min(currentIndex + 1, filteredTransactions.length - 1);
    setCurrentIndex(nextIdx);
    const txn = filteredTransactions[nextIdx];
    if (txn != null) {
      speakTransactionItem(txn, nextIdx, filteredTransactions.length);
    }
  };

  const handlePrevious = () => {
    void hapticTick();
    playbackToken.current += 1;
    if (filteredTransactions.length === 0) return;
    const prevIdx = currentIndex == null ? 0 : Math.max(currentIndex - 1, 0);
    setCurrentIndex(prevIdx);
    const txn = filteredTransactions[prevIdx];
    if (txn != null) {
      speakTransactionItem(txn, prevIdx, filteredTransactions.length);
    }
  };

  const selectFilter = (nextFilter: FilterType) => {
    void hapticTick();
    playbackToken.current += 1;
    stopSpeaking();
    setIsPlaying(false);
    setCurrentIndex(null);
    setFilter(nextFilter);
  };

  return (
    <View style={styles.screen}>
      <HeaderBar
        title={t('statement.title', 'MoMo Statement')}
        subtitle={t('statement.subtitle', 'Spoken Statement Narrator')}
        showBack
        onBack={onDone}
      />

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        accessibilityLabel={t('statement.title', 'MoMo Statement')}
        accessibilityHint="Transaction statement and audio player"
      >
        <PrivacyAudioBanner isPrivateAudio={isPrivateAudio} />

        {/* Financial Summary Strip */}
        <View style={styles.summaryStrip}>
          <View style={[styles.summaryCard, styles.summaryCardIn]}>
            <Text style={styles.summaryLabel}>{t('statement.totalIn', 'Money In')}</Text>
            <Text
              accessibilityRole="text"
              accessibilityLabel={`${t('statement.totalIn')}: ${formatMoney(totalIn)}`}
              accessibilityHint="Total money received"
              style={styles.summaryValueIn}
            >
              +{formatMoney(totalIn)}
            </Text>
          </View>

          <View style={[styles.summaryCard, styles.summaryCardOut]}>
            <Text style={styles.summaryLabel}>{t('statement.totalOut', 'Money Out')}</Text>
            <Text
              accessibilityRole="text"
              accessibilityLabel={`${t('statement.totalOut')}: ${formatMoney(totalOut)}`}
              accessibilityHint="Total money sent and spent"
              style={styles.summaryValueOut}
            >
              −{formatMoney(totalOut)}
            </Text>
          </View>
        </View>

        {/* Audio Statement Narrator Player */}
        <View style={styles.playerCard}>
          <View style={styles.playerHeader}>
            <View style={styles.playerDotPill}>
              <Text style={styles.playerDot}>{isPlaying ? '🟢' : '⚪'}</Text>
              <Text style={styles.playerHeaderText}>
                {isPlaying
                  ? currentIndex != null
                    ? t('statement.nowReading', {
                        current: currentIndex + 1,
                        total: filteredTransactions.length,
                      })
                    : t('common.processing', 'Playing…')
                  : t('statement.playerHeading', 'Audio Statement Player')}
              </Text>
            </View>
          </View>

          <View style={styles.playerControls}>
            <AccessibleButton
              label="⏮️"
              hint={t('statement.prev', 'Previous transaction')}
              variant="outline"
              onPress={handlePrevious}
              style={styles.controlBtn}
              textStyle={styles.controlBtnText}
            />

            <AccessibleButton
              label={isPlaying ? `⏸️ ${t('statement.pause', 'Pause')}` : `▶️ ${t('statement.playAll', 'Play All')}`}
              hint={isPlaying ? t('statement.pauseHint') : t('statement.playAllHint')}
              variant="momo"
              onPress={handlePlayAll}
              style={styles.playAllBtn}
            />

            <AccessibleButton
              label="⏭️"
              hint={t('statement.next', 'Next transaction')}
              variant="outline"
              onPress={handleNext}
              style={styles.controlBtn}
              textStyle={styles.controlBtnText}
            />
          </View>
        </View>

        {/* Filter Chips */}
        <View
          accessible
          accessibilityRole="radiogroup"
          accessibilityLabel="Transaction filters"
          accessibilityHint="Filter statement by type"
          style={styles.filterRow}
        >
          {(['all', 'receive', 'send', 'airtime'] as const).map((filterKey) => {
            const isSelected = filter === filterKey;
            const filterLabel =
              filterKey === 'all'
                ? t('statement.filterAll', 'All')
                : filterKey === 'receive'
                  ? t('statement.filterReceive', 'Received')
                  : filterKey === 'send'
                    ? t('statement.filterSend', 'Sent')
                    : t('statement.filterAirtime', 'Airtime');

            return (
              <AccessibleButton
                key={filterKey}
                label={filterLabel}
                hint={`Filter by ${filterLabel}`}
                accessibilityState={isSelected ? { selected: true } : { selected: false }}
                variant={isSelected ? 'momo' : 'outline'}
                onPress={() => selectFilter(filterKey)}
                style={[styles.filterChip, isSelected ? styles.filterChipSelected : null]}
              />
            );
          })}
        </View>

        {/* Transactions Feed */}
        <View style={styles.transactionsSection}>
          {loading ? (
            <View style={styles.emptyCard}>
              <Text style={styles.mutedText}>{t('home.loading')}</Text>
            </View>
          ) : filteredTransactions.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.mutedText}>{t('statement.noFilterTransactions')}</Text>
            </View>
          ) : (
            filteredTransactions.map((txn, index) => {
              const isReceive = txn.type === 'receive';
              const isAirtime = txn.type === 'airtime';
              const isCurrent = currentIndex === index && isPlaying;
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
                  style={[
                    styles.txnCard,
                    isCurrent ? styles.txnCardActive : null,
                  ]}
                >
                  <View style={[styles.txnIconCircle, isReceive ? styles.iconIn : styles.iconOut]}>
                    <Text style={styles.txnIconText}>{icon}</Text>
                  </View>

                  <View style={styles.txnBody}>
                    <Text style={styles.txnName}>{txn.recipientName}</Text>
                    <Text style={styles.txnMeta}>
                      {t(`home.type.${txn.type}`)} • {txn.reference}
                    </Text>
                    {txn.fee > 0 ? (
                      <Text style={styles.txnFee}>
                        {t('send.reviewFeeLabel', 'Fee')}: {formatMoney(txn.fee)}
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.txnEnd}>
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
                      onPress={() => speakTransactionItem(txn, index, filteredTransactions.length)}
                      style={styles.singleListenBtn}
                      textStyle={styles.singleListenText}
                    />
                  </View>
                </View>
              );
            })
          )}
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
  summaryStrip: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...Platform.select({
      web: {
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.04)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
      },
    }),
  },
  summaryCardIn: {
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
  },
  summaryCardOut: {
    borderLeftWidth: 4,
    borderLeftColor: colors.navyMidnight,
  },
  summaryLabel: {
    fontSize: theme.typography.tiny,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: 2,
  },
  summaryValueIn: {
    fontSize: theme.typography.subheading,
    fontWeight: '900',
    color: colors.success,
  },
  summaryValueOut: {
    fontSize: theme.typography.subheading,
    fontWeight: '900',
    color: colors.navyMidnight,
  },
  playerCard: {
    backgroundColor: colors.navyMidnight,
    borderRadius: theme.radii.xl,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    ...Platform.select({
      web: {
        boxShadow: '0 4px 12px rgba(0, 27, 58, 0.25)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
        elevation: 3,
      },
    }),
  },
  playerHeader: {
    marginBottom: theme.spacing.sm,
  },
  playerDotPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playerDot: {
    fontSize: 10,
  },
  playerHeaderText: {
    fontSize: theme.typography.small,
    fontWeight: '800',
    color: colors.textOnNavy,
  },
  playerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  controlBtn: {
    minWidth: 48,
    minHeight: 48,
    paddingHorizontal: theme.spacing.sm,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  controlBtnText: {
    fontSize: 18,
  },
  playAllBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: theme.radii.md,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  filterChip: {
    minHeight: 44,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radii.full,
  },
  filterChipSelected: {
    borderColor: colors.navyMidnight,
    borderWidth: 1.5,
  },
  transactionsSection: {
    gap: theme.spacing.xs,
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
    borderWidth: 1.5,
    borderColor: colors.border,
    minHeight: 64,
  },
  txnCardActive: {
    borderColor: colors.momoYellow,
    backgroundColor: colors.momoYellowLight,
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
  txnIconText: {
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
  txnMeta: {
    fontSize: theme.typography.tiny,
    color: colors.textMuted,
    fontWeight: '500',
  },
  txnFee: {
    fontSize: theme.typography.tiny,
    color: colors.warning,
    fontWeight: '600',
  },
  txnEnd: {
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
  singleListenBtn: {
    minHeight: 32,
    minWidth: 32,
    paddingHorizontal: 4,
    paddingVertical: 2,
    marginTop: 2,
  },
  singleListenText: {
    fontSize: 14,
  },
}));
