import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { announce } from '../a11y/announcer';
import { theme, themedStyles } from '../constants/theme';
import { hapticConfirm, hapticTick } from '../services/haptics';
import { getAppLanguage } from '../i18n';
import { speak } from '../services/speech';
import { matchVoiceIntent, type VoiceIntent } from '../voice/commands';
import { sayKey } from '../voice/say';

export type RadialOption = {
  id: string;
  label: string;
  desc: string;
  angle: number;
  icon: string;
  intent?: VoiceIntent;
  keywords?: string[];
  /** Native voice-pack clip for this option, e.g. `home.sendMoney`. */
  clipKey?: string;
};

/**
 * Names a wheel option out loud: the native clip when one ships for the user's
 * language (zero TTS quota), otherwise the speak() ladder. Every main-menu
 * option maps to an existing home.* clip, so in Twi a full spin costs nothing.
 */
function speakNode(opt: RadialOption): void {
  const language = getAppLanguage();
  if (opt.clipKey != null && sayKey(opt.clipKey, { language }) === 'clip') return;
  speak(opt.label, language);
}

export type RadialMenuData = {
  title: string;
  subtitle: string;
  options: RadialOption[];
  quickCommands?: string[];
};

export type RadialVoiceMenuProps = {
  menu: RadialMenuData;
  onSelect: (option: RadialOption) => void;
  voiceCommand?: string | null;
  onVoiceCommandConsumed?: () => void;
  statusText?: string;
};

const WHEEL_SIZE = 300;
const RADIUS = 112;
const NODE_SIZE = 72;
const SPIN_DURATION = 2800;
const EXTRA_ROTATIONS = 2;

function polarToCartesian(angleDeg: number, radius: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: WHEEL_SIZE / 2 + radius * Math.cos(rad) - NODE_SIZE / 2,
    y: WHEEL_SIZE / 2 + radius * Math.sin(rad) - NODE_SIZE / 2,
  };
}

function getTopOptionAngle(rotation: number): number {
  const r = ((rotation % 360) + 360) % 360;
  return (360 - r) % 360;
}

function findClosestOption(rotation: number, options: RadialOption[]): RadialOption | null {
  const topAngle = getTopOptionAngle(rotation);
  let closest: RadialOption | null = null;
  let minDiff = 360;
  for (const opt of options) {
    let diff = Math.abs(opt.angle - topAngle);
    if (diff > 180) diff = 360 - diff;
    if (diff < minDiff) {
      minDiff = diff;
      closest = opt;
    }
  }
  return closest;
}

function matchCommandToOption(command: string, options: RadialOption[]): RadialOption | null {
  const cl = command.toLowerCase().trim();

  let best: RadialOption | null = null;
  let bestScore = 0;

  for (const opt of options) {
    if (opt.keywords) {
      for (const kw of opt.keywords) {
        if (cl.includes(kw) && kw.length > bestScore) {
          bestScore = kw.length;
          best = opt;
        }
      }
    }
    if (cl.includes(opt.label.toLowerCase()) && opt.label.length > bestScore) {
      bestScore = opt.label.length;
      best = opt;
    }
  }

  if (best) return best;

  const intent = matchVoiceIntent(command);
  if (intent) {
    const match = options.find((o) => o.intent === intent);
    if (match) return match;
  }

  return null;
}

export function RadialVoiceMenu({
  menu,
  onSelect,
  voiceCommand,
  onVoiceCommandConsumed,
  statusText,
}: RadialVoiceMenuProps) {
  const { t } = useTranslation();
  // useState (not useRef) so the animated value is created once yet stays a
  // plain render value - the lint rule forbids reading refs during render.
  const [rotation] = useState(() => new Animated.Value(0));
  const currentRotationRef = useRef(0);
  const spinningRef = useRef(false);
  const lastAnnouncedRef = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  const [spinning, setSpinning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [atTopId, setAtTopId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  // External status (e.g. a parent pushing "Listening…") wins over internal
  // ones without an effect - derived during render instead of mirrored.
  const displayStatus = statusText ?? status;

  const spinTo = useCallback(
    (target: RadialOption) => {
      if (spinningRef.current) return;
      spinningRef.current = true;
      setSpinning(true);
      setSelectedId(null);
      lastAnnouncedRef.current = null;

      const targetMod = ((360 - target.angle) % 360 + 360) % 360;
      const currentMod = ((currentRotationRef.current % 360) + 360) % 360;
      let delta = targetMod - currentMod;
      if (delta <= 0) delta += 360;
      const totalDelta = delta + 360 * EXTRA_ROTATIONS;
      const startRot = currentRotationRef.current;
      const endRot = startRot + totalDelta;

      Animated.timing(rotation, {
        toValue: endRot,
        duration: SPIN_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start(() => {
        currentRotationRef.current = endRot;
        // Claim the landing node before the spin flag drops: a trailing frame
        // would otherwise let the idle wheel name it right behind the
        // destination's own announcement.
        lastAnnouncedRef.current = target.id;
        spinningRef.current = false;
        setSpinning(false);
        setSelectedId(target.id);

        void hapticConfirm();
        // The landing phrase belongs to whoever receives the selection: every
        // intent handler names its own destination (App's `open`, and
        // VoiceFlowController.start plays the feature clip before its first
        // question). Speaking it here as well echoed the same clip twice.
        announce(`Selected: ${target.label}`);
        setTimeout(() => onSelectRef.current(target), 350);
      });
    },
    [rotation],
  );

  const handleCommand = useCallback(
    (command: string) => {
      announce(`Heard: ${command}`);
      const match = matchCommandToOption(command, menu.options);
      if (match) {
        setStatus(`Heard: ${command} — spinning to ${match.label}`);
        spinTo(match);
      } else {
        const labels = menu.options.map((o) => o.label).join(', ');
        setStatus(`Did not recognize "${command}". Try: ${labels}`);
        // Same correction the command pipeline speaks (native clip when one
        // exists for the language), never an English-accented fallback first.
        const language = getAppLanguage();
        if (sayKey('vcmd.notCommandNative', { language }) === 'skipped') {
          speak(t('radial.tryAgain', 'Sorry, I did not understand. Please try again.'), language);
        }
      }
    },
    [menu.options, spinTo, t],
  );

  useEffect(() => {
    const id = rotation.addListener(({ value }) => {
      currentRotationRef.current = value;
      const topOpt = findClosestOption(value, menu.options);
      if (topOpt && topOpt.id !== lastAnnouncedRef.current) {
        lastAnnouncedRef.current = topOpt.id;
        setAtTopId(topOpt.id);
        void hapticTick();
        // Only the idle wheel names its options: during a spin every node
        // passes the selector ~3 times, and a staccato of clipped labels is
        // noise, not guidance. The landing node is named by its destination.
        if (!spinningRef.current) speakNode(topOpt);
      }
    });
    return () => rotation.removeListener(id);
  }, [menu.options, rotation]);

  useEffect(() => {
    if (voiceCommand && !spinningRef.current) {
      handleCommand(voiceCommand);
      onVoiceCommandConsumed?.();
    }
  }, [voiceCommand, handleCommand, onVoiceCommandConsumed]);

  const onOptionPress = useCallback(
    (opt: RadialOption) => {
      if (spinningRef.current) return;
      announce(opt.label);
      spinTo(opt);
    },
    [spinTo],
  );

  const quickCommands = menu.quickCommands;

  return (
    <View
      style={styles.container}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${menu.title}. ${menu.subtitle}. ${menu.options.map((o) => o.label).join(', ')}`}
      accessibilityHint="Spinning voice menu - tap an option or say a command to spin the wheel"
    >
      <View style={styles.wheelArea}>
        <Animated.View
          style={[
            styles.wheel,
            {
              width: WHEEL_SIZE,
              height: WHEEL_SIZE,
              borderRadius: WHEEL_SIZE / 2,
              transform: [
                {
                  rotate: rotation.interpolate({
                    inputRange: [0, 360 * 100],
                    outputRange: ['0deg', `${360 * 100}deg`],
                  }),
                },
              ],
            },
          ]}
        >
          {menu.options.map((opt) => {
            const pos = polarToCartesian(opt.angle, RADIUS);
            const isAtTop = atTopId === opt.id;
            const isSelected = selectedId === opt.id;
            return (
              <Pressable
                key={opt.id}
                accessible
                accessibilityRole="button"
                accessibilityLabel={`${opt.label}. ${opt.desc}`}
                accessibilityHint="Double-tap to spin the wheel to this option"
                onPress={() => onOptionPress(opt)}
                disabled={spinning}
                style={[
                  styles.node,
                  {
                    left: pos.x,
                    top: pos.y,
                    width: NODE_SIZE,
                    height: NODE_SIZE,
                    borderRadius: NODE_SIZE / 2,
                  },
                  isAtTop && !isSelected ? styles.nodeAtTop : null,
                  isSelected ? styles.nodeSelected : null,
                ]}
              >
                <Text style={[styles.nodeIcon, isSelected ? styles.nodeIconSelected : null]}>
                  {opt.icon}
                </Text>
                <Text
                  style={[styles.nodeLabel, isSelected ? styles.nodeLabelSelected : null]}
                  numberOfLines={1}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </Animated.View>

        <View style={styles.hub} pointerEvents="none">
          <Text style={styles.hubTitle}>{menu.title}</Text>
          <Text style={styles.hubSub} numberOfLines={1}>
            {menu.subtitle}
          </Text>
        </View>

        <View style={styles.selector} pointerEvents="none" />
      </View>

      <View style={styles.statusBar}>
        <Text style={styles.statusText} accessibilityLiveRegion="polite">
          {displayStatus || t('voice.sayCommand', { defaultValue: 'Say or type a command to begin' })}
        </Text>
      </View>

      {quickCommands && quickCommands.length > 0 ? (
        <View style={styles.quickRow}>
          {quickCommands.map((cmd) => (
            <Pressable
              key={cmd}
              accessible
              accessibilityRole="button"
              accessibilityLabel={cmd}
              accessibilityHint={`Spin the wheel to ${cmd}`}
              onPress={() => handleCommand(cmd)}
              disabled={spinning}
              style={({ pressed }) => [
                styles.quickBtn,
                pressed ? styles.quickBtnPressed : null,
              ]}
            >
              <Text style={styles.quickBtnText}>{cmd}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export const MAIN_MENU: RadialMenuData = {
  title: 'SafePay',
  subtitle: 'MoMo Boafoo',
  quickCommands: ['Send money', 'Check balance', 'Buy airtime', 'Withdraw'],
  options: [
    {
      id: 'send',
      label: 'Koma Sika',
      desc: 'Send Money',
      angle: 0,
      icon: 'S',
      intent: 'send',
      keywords: ['send', 'money', 'koma', 'sika', 'transfer', 'pay'],
      clipKey: 'home.sendMoney',
    },
    {
      id: 'card',
      label: 'Sika Krataa',
      desc: 'Statement',
      angle: 60,
      icon: 'K',
      intent: 'statement',
      keywords: ['card', 'bank', 'krataa', 'statement', 'history'],
      clipKey: 'home.statement',
    },
    {
      id: 'airtime',
      label: 'Airtime',
      desc: 'Airtime & Data',
      angle: 120,
      icon: 'A',
      intent: 'airtime',
      keywords: ['airtime', 'data', 'bundle', 'credit', 'recharge'],
      clipKey: 'home.buyAirtime',
    },
    {
      id: 'withdraw',
      label: 'Yi Sika',
      desc: 'Withdraw Cash',
      angle: 180,
      icon: 'W',
      intent: 'cashout',
      keywords: ['withdraw', 'cash', 'yi', 'atm', 'pull', 'cashout', 'cash out'],
      clipKey: 'home.cashOut',
    },
    {
      id: 'balance',
      label: 'Kenkan Sika',
      desc: 'Read Balance',
      angle: 240,
      icon: 'B',
      intent: 'balance',
      keywords: ['balance', 'check', 'read', 'kenkan', 'how much', 'account'],
      clipKey: 'home.listenBalance',
    },
    {
      id: 'settings',
      label: 'Settings',
      desc: 'Preferences',
      angle: 300,
      icon: 'G',
      intent: 'settings',
      keywords: ['settings', 'preference', 'options', 'contrast', 'language'],
      clipKey: 'settings.title',
    },
  ],
};

const styles = themedStyles((colors) => ({
  container: {
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
  },
  wheelArea: {
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheel: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    position: 'relative',
  },
  node: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1.5,
    borderColor: colors.safepayBlue,
    minHeight: theme.touchTarget.minSize,
    minWidth: theme.touchTarget.minSize,
  },
  nodeAtTop: {
    borderColor: colors.goldInk,
    borderWidth: 3,
  },
  nodeSelected: {
    backgroundColor: colors.momoYellow,
    borderColor: colors.momoYellow,
  },
  nodeIcon: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.goldInk,
  },
  nodeIconSelected: {
    color: colors.navyMidnight,
  },
  nodeLabel: {
    fontSize: 8,
    color: colors.textMuted,
    marginTop: 2,
  },
  nodeLabelSelected: {
    color: colors.navyMidnight,
    fontWeight: '900',
  },
  hub: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.background,
    borderWidth: 2,
    borderColor: colors.safepayBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.goldInk,
  },
  hubSub: {
    fontSize: 9,
    color: colors.textMuted,
    marginTop: 2,
    paddingHorizontal: 8,
  },
  selector: {
    position: 'absolute',
    top: -2,
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 18,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: colors.goldInk,
  },
  statusBar: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.sm,
  },
  statusText: {
    fontSize: theme.typography.body,
    color: colors.text,
    textAlign: 'center',
    lineHeight: 22,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    justifyContent: 'center',
  },
  quickBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: theme.radii.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: theme.touchTarget.minSize,
    justifyContent: 'center',
  },
  quickBtnPressed: {
    opacity: 0.7,
    borderColor: colors.safepayBlue,
  },
  quickBtnText: {
    fontSize: theme.typography.small,
    color: colors.textMuted,
  },
}));
