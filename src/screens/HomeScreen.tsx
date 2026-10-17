import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { announce } from '../a11y/announcer';
import { useEarLight, useSpotlight } from '../a11y/spotlight';
import { HeaderBar } from '../components/HeaderBar';
import { PrivacyAudioBanner } from '../components/PrivacyAudioBanner';
import { theme, themedStyles } from '../constants/theme';
import { getAppLanguage } from '../i18n';
import { hapticAmount, hapticNav, hapticTick, type NavSignature } from '../services/haptics';
import { useIsPrivateAudio } from '../services/headphones';
import {
  alertSummary,
  listAlerts,
  subscribeSms,
  takePendingBanner,
  type MoMoAlert,
} from '../services/momoSms';
import { getCachedSettings, loadSettings, type NavPreset } from '../services/settings';
import { speak, stopSpeaking } from '../services/speech';
import {
  DEMO_ACCOUNT_NAME,
  formatMoney,
  getBalance,
  listTransactions,
  type Transaction,
} from '../services/transactions';
import { sayPlan, type SayPlan } from '../voice/say';

/**
 * Home for ears first: five regions, one focus stop per thing a user can do.
 * No icons (a merged label replaces the children in the a11y tree anyway, so an
 * emoji costs layout and buys no information), no nested buttons, no decorative
 * images, nothing under the 48dp floor.
 */

const SPOT_BALANCE = 'balance';
const SPOT_SPEAK = 'speak';
const SPOT_INBOX = 'inbox';
const SPOT_BANNER = 'banner';
/** Long enough to be noticed and reached for, short enough to not litter Home. */
const BANNER_MS = 10_000;

interface Service {
  id: string;
  nav: NavSignature;
  label: string;
  hint: string;
  run: () => void;
}

export interface HomeScreenProps {
  onSendMoney: () => void;
  onViewStatement: () => void;
  onBuyAirtime: () => void;
  onCashOut: () => void;
  onOpenSettings: () => void;
  onOpenInbox: () => void;
}

export function HomeScreen({
  onSendMoney,
  onViewStatement,
  onBuyAirtime,
  onCashOut,
  onOpenSettings,
  onOpenInbox,
}: HomeScreenProps) {
  const { t } = useTranslation();
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceVisible, setBalanceVisible] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [alerts, setAlerts] = useState<MoMoAlert[]>([]);
  const [banner, setBanner] = useState<MoMoAlert | null>(null);
  const bannerSpoken = useRef(false);
  const [loading, setLoading] = useState(true);
  // Live audio-route state: updates when headphones are plugged or unplugged.
  const isPrivateAudio = useIsPrivateAudio();
  const [navPreset, setNavPreset] = useState<NavPreset>(getCachedSettings().navPreset);
  const spot = useSpotlight();
  const light = useEarLight();

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

  // The MoMo alert thread mirrors what just happened: unread count live, so the
  // Home stop can say "2 new" without the user opening anything.
  useEffect(() => {
    const refresh = () => {
      void listAlerts().then(setAlerts);
    };
    refresh();
    return subscribeSms(refresh);
  }, []);

  /**
   * A transaction's SMS lands when Home is back, never over the receipt that is
   * still reading itself out. The banner says its own name and fades on its own.
   */
  useEffect(() => {
    let ignore = false;
    let fade: ReturnType<typeof setTimeout> | null = null;
    void (async () => {
      const arrived = takePendingBanner();
      if (arrived == null || ignore || bannerSpoken.current) return;
      bannerSpoken.current = true;
      setBanner(arrived);
      fade = setTimeout(() => setBanner(null), BANNER_MS);
      light(SPOT_BANNER);
      const plan: SayPlan = [
        { kind: 'key', key: 'sms.sayNew' },
        { kind: 'money', amount: arrived.transaction.amount },
      ];
      sayPlan(plan, {
        fallback: () => {
          const message = t('sms.banner', { summary: alertSummary(arrived) });
          if (isPrivateAudio) speak(message, getAppLanguage());
          else announce(message);
        },
      });
    })();
    return () => {
      ignore = true;
      if (fade != null) clearTimeout(fade);
    };
    // Mount only: Home re-receives an alert through the subscription, not here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unread = alerts.filter((alert) => !alert.read).length;

  /**
   * The band is also the privacy toggle, so hiding the figure costs one focus
   * stop instead of two. A blind user is never offered dots: the hidden state
   * is the word for "hidden".
   */
  const toggleBalance = () => {
    const nextVisible = !balanceVisible;
    setBalanceVisible(nextVisible);
    void hapticTick();
    light(SPOT_BALANCE);
    announce(nextVisible ? t('home.balanceShown') : t('home.balanceHidden'));
  };

  const speakBalance = () => {
    if (balance == null) return;
    void hapticAmount();
    light(SPOT_BALANCE);
    const plan: SayPlan = [
      { kind: 'key', key: 'vcmd.balanceIs' },
      { kind: 'money', amount: balance },
    ];
    sayPlan(plan, {
      // Native path: vcmd clip + composed number atoms, no English accent.
      native: undefined,
      fallback: () => {
        const message = `${t('home.balanceLabel')}: ${formatMoney(balance)}`;
        if (isPrivateAudio) {
          speak(message, getAppLanguage());
        } else {
          announce(message);
        }
      },
    });
  };

  const speakSingleTransaction = (txn: Transaction) => {
    void hapticAmount();
    light(`txn:${txn.id}`);
    const language = getAppLanguage();
    const plan: SayPlan = [
      { kind: 'name', name: txn.recipientName },
      { kind: 'key', key: `home.type.${txn.type}` },
      { kind: 'money', amount: txn.amount },
      { kind: 'key', key: `home.status.${txn.status}` },
    ];
    sayPlan(plan, {
      fallback: () => {
        const text = t('home.transactionLabel', {
          name: txn.recipientName,
          type: t(`home.type.${txn.type}`),
          amount: formatMoney(txn.amount),
          status: t(`home.status.${txn.status}`),
        });
        if (isPrivateAudio) {
          speak(text, language);
        } else {
          announce(text);
        }
      },
    });
  };

  const services: Service[] = [
    { id: 'send', nav: 'send', label: t('home.sendMoney'), hint: t('home.sendMoneyHint'), run: onSendMoney },
    { id: 'airtime', nav: 'airtime', label: t('home.buyAirtime'), hint: t('home.buyAirtimeHint'), run: onBuyAirtime },
    { id: 'cashout', nav: 'cashout', label: t('home.cashOut'), hint: t('home.cashOutHint'), run: onCashOut },
    {
      id: 'statement',
      nav: 'statement',
      label: t('home.statement'),
      hint: t('home.statementHint'),
      run: onViewStatement,
    },
  ];

  const figure = balanceVisible && balance != null ? formatMoney(balance) : null;
  const balanceSpoken =
    figure != null ? `${t('home.balanceLabel')}: ${figure}` : t('home.balanceHiddenLabel');

  return (
    <View style={styles.screen}>
      <HeaderBar onOpenSettings={onOpenSettings} />

      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <PrivacyAudioBanner isPrivateAudio={isPrivateAudio} />

        {banner != null ? (
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel={t('sms.banner', { summary: alertSummary(banner) })}
            accessibilityHint={t('sms.bannerHint')}
            onFocus={() => light(SPOT_BANNER)}
            onPressIn={() => light(SPOT_BANNER)}
            onPress={onOpenInbox}
            style={({ pressed }) => [
              styles.smsBanner,
              spot === SPOT_BANNER ? styles.smsBannerLit : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.smsBannerLabel} numberOfLines={2}>
              {t('sms.banner', { summary: alertSummary(banner) })}
            </Text>
          </Pressable>
        ) : null}

        {/* Region 1 - the money itself, flat on the MoMo band. */}
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel={`${t('home.accountHolder')}: ${DEMO_ACCOUNT_NAME}. ${balanceSpoken}`}
          accessibilityHint={t('home.balanceToggleHint')}
          onFocus={() => light(SPOT_BALANCE)}
          onPressIn={() => {
            void hapticTick();
            light(SPOT_BALANCE);
          }}
          onPress={toggleBalance}
          style={({ pressed }) => [
            styles.band,
            spot === SPOT_BALANCE ? styles.bandLit : null,
            spot != null && spot !== SPOT_BALANCE ? styles.bandDim : null,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.bandCaption}>{t('home.momoAccount')}</Text>
          <Text style={styles.bandFigure} numberOfLines={1} adjustsFontSizeToFit>
            {figure ?? t('home.balanceHiddenShort')}
          </Text>
          <Text style={styles.bandNote}>
            {balanceVisible ? DEMO_ACCOUNT_NAME : t('home.tapToReveal')}
          </Text>
        </Pressable>

        {/* Region 2 - hear the figure without pressing the toggle. */}
        <TextRow
          id={SPOT_SPEAK}
          spot={spot}
          label={t('home.listenBalance')}
          hint={t('home.listenBalanceHint')}
          light={light}
          onPress={speakBalance}
        />

        {/* Region 3 - the four things a MoMo user does. */}
        <View style={styles.section}>
          <Text accessibilityRole="header" aria-level={2} style={styles.sectionHeading}>
            {t('home.quickActions')}
          </Text>

          {navPreset === 'spatial' ? (
            // Physical positions kept for muscle memory; the text stays, the
            // "Quadrant 1 Top-Left" narration goes.
            <View style={styles.spatialGrid}>
              <View style={styles.spatialRow}>
                <ServiceRow service={services[0]} spot={spot} light={light} compact />
                <ServiceRow service={services[3]} spot={spot} light={light} compact />
              </View>
              <View style={styles.spatialRow}>
                <ServiceRow service={services[1]} spot={spot} light={light} compact />
                <ServiceRow service={services[2]} spot={spot} light={light} compact />
              </View>
            </View>
          ) : (
            <View style={styles.serviceList}>
              {services.map((service) => (
                <ServiceRow key={service.id} service={service} spot={spot} light={light} />
              ))}
            </View>
          )}
        </View>

        {/* Region 4 - the last two movements; the sentence is the button. */}
        <View style={styles.section}>
          <Text accessibilityRole="header" aria-level={2} style={styles.sectionHeading}>
            {t('home.recentTransactions')}
          </Text>

          {loading ? (
            <Text style={styles.plainText}>{t('home.loading')}</Text>
          ) : transactions.length === 0 ? (
            <Text style={styles.plainText}>{t('home.noTransactions')}</Text>
          ) : (
            transactions.slice(0, 2).map((txn) => {
              const id = `txn:${txn.id}`;
              const sentence = t('home.transactionLabel', {
                name: txn.recipientName,
                type: t(`home.type.${txn.type}`),
                amount: formatMoney(txn.amount),
                status: t(`home.status.${txn.status}`),
              });
              return (
                <Pressable
                  key={txn.id}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={sentence}
                  accessibilityHint={t('home.listenHint')}
                  onFocus={() => light(id)}
                  onPressIn={() => light(id)}
                  onPress={() => speakSingleTransaction(txn)}
                  style={({ pressed }) => [
                    styles.txnRow,
                    spot === id ? styles.txnRowLit : null,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Text
                    style={[styles.txnSentence, recede(spot, id) ? styles.textReceded : null]}
                    numberOfLines={2}
                  >
                    {sentence}
                  </Text>
                </Pressable>
              );
            })
          )}
        </View>

        {/* Region 5 - the MoMo alert thread, one plain row at the bottom. */}
        <TextRow
          id={SPOT_INBOX}
          spot={spot}
          label={
            unread > 0
              ? `${t('sms.openInbox')}. ${t('sms.unread', { count: unread })}`
              : t('sms.openInbox')
          }
          hint={t('sms.openInboxHint')}
          light={light}
          onPress={onOpenInbox}
        />
      </ScrollView>
    </View>
  );
}

/** A destination is felt before it is seen: each one has its own rhythm. */
function openNav(destination: NavSignature, run: () => void): void {
  void hapticNav(destination);
  run();
}

function ServiceRow({
  service,
  spot,
  light,
  compact,
}: {
  service: Service | undefined;
  spot: string | null;
  light: (id: string) => void;
  compact?: boolean;
}) {
  if (service == null) return null;
  return (
    <TextRow
      id={service.id}
      spot={spot}
      label={service.label}
      hint={service.hint}
      light={light}
      onPress={() => openNav(service.nav, service.run)}
      compact={compact}
      style={compact ? styles.spatialCell : styles.divider}
    />
  );
}

interface TextRowProps {
  id: string;
  spot: string | null;
  label: string;
  hint: string;
  light: (id: string) => void;
  onPress: () => void;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * One focus stop, one sentence. Nothing inside it is separately reachable, so
 * TalkBack never has to step through a decoration on the way to an action.
 */
function TextRow({ id, spot, label, hint, light, onPress, compact, style }: TextRowProps) {
  const receded = recede(spot, id);
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onFocus={() => light(id)}
      onPressIn={() => {
        void hapticTick();
        light(id);
      }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        compact ? styles.rowCompact : null,
        spot === id ? styles.rowLit : null,
        pressed ? styles.pressed : null,
        style,
      ]}
    >
      <Text
        style={[styles.rowLabel, receded ? styles.textReceded : null]}
        numberOfLines={compact ? 2 : 1}
      >
        {label}
      </Text>
      {compact ? null : (
        <Text style={[styles.rowHint, receded ? styles.textReceded : null]} numberOfLines={2}>
          {hint}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * True when the ear is on something else. Recession is carried by the palette's
 * muted roles rather than a fractional opacity, because opacity on text drops it
 * under the AA contrast this repo gates on.
 */
function recede(spot: string | null, id: string): boolean {
  return spot != null && spot !== id;
}

const styles = themedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xxl,
  },
  band: {
    backgroundColor: colors.momoYellow,
    borderRadius: theme.radii.lg,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
    minHeight: 168,
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  bandLit: {
    borderWidth: 4,
    borderColor: colors.borderFocus,
    transform: [{ scale: 1.02 }],
  },
  bandDim: {
    backgroundColor: colors.momoYellowLight,
  },
  bandCaption: {
    fontSize: theme.typography.small,
    fontWeight: '800',
    color: colors.onGold,
    opacity: 0.9,
    marginBottom: theme.spacing.xs,
    letterSpacing: 0.2,
  },
  bandFigure: {
    fontSize: 48,
    fontWeight: '900',
    color: colors.onGold,
    letterSpacing: -1,
  },
  bandNote: {
    fontSize: theme.typography.small,
    fontWeight: '700',
    color: colors.onGold,
    opacity: 0.9,
    marginTop: theme.spacing.xs,
  },
  smsBanner: {
    minHeight: 60,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radii.lg,
    backgroundColor: colors.navyMidnight,
    borderWidth: 3,
    borderColor: 'transparent',
    marginTop: theme.spacing.sm,
  },
  smsBannerLit: {
    borderColor: colors.borderFocus,
  },
  smsBannerLabel: {
    fontSize: theme.typography.body,
    fontWeight: '800',
    color: colors.textOnNavy,
  },
  row: {
    minHeight: 76,
    justifyContent: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radii.md,
    borderWidth: 3,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  rowCompact: {
    minHeight: 104,
    paddingHorizontal: theme.spacing.md,
  },
  rowLit: {
    borderColor: colors.borderFocus,
    backgroundColor: colors.surfaceElevated,
    transform: [{ scale: 1.01 }],
  },
  rowLabel: {
    fontSize: theme.typography.heading,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: -0.2,
  },
  rowHint: {
    fontSize: theme.typography.small,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 2,
  },
  textReceded: {
    color: colors.textMuted,
  },
  serviceList: {
    marginTop: theme.spacing.xs,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderRadius: 0,
  },
  section: {
    marginTop: theme.spacing.xl,
  },
  sectionHeading: {
    fontSize: theme.typography.subheading,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: -0.2,
  },
  txnRow: {
    minHeight: 76,
    justifyContent: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radii.md,
    borderWidth: 3,
    borderColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  txnRowLit: {
    borderColor: colors.borderFocus,
    borderBottomColor: colors.borderFocus,
    backgroundColor: colors.surfaceElevated,
    transform: [{ scale: 1.01 }],
  },
  txnSentence: {
    fontSize: theme.typography.body,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 24,
  },
  plainText: {
    fontSize: theme.typography.body,
    color: colors.textMuted,
    fontWeight: '600',
    paddingVertical: theme.spacing.md,
  },
  spatialGrid: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  spatialRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  spatialCell: {
    flex: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.85,
  },
}));
