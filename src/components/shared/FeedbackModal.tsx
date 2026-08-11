/**
 * FeedbackModal.tsx — the ten-question survey, ported from the extension.
 *
 * Same questions, same payload keys, same "ask once" behaviour. What changed is
 * the shape of the controls: the extension's rows of small clickable pills are
 * a mouse idiom, and on a phone they become mis-taps. Every option here is a
 * full-width row or a chip with a real touch target, and the whole thing is one
 * scroll rather than a grid.
 *
 * ONLY EMAIL IS REQUIRED. Every other answer is optional and simply omitted
 * from the payload when blank — an unanswered star rating must not post 0, or
 * the backend records a one-star review nobody gave.
 */

import React, { memo, useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import CloudChip from "../brand/CloudChip";
import LiquidSheet from "./LiquidSheet";
import { FONT } from "../../theme/tokens";
import { rgba, themeTokens } from "../../theme/useThemeTokens";
import { getFeedbackRecord, markFeedbackSubmitted } from "../../lib/feedback";
import { submitFeedback, type FeedbackPayload } from "../../services/feedback";

/* The panes are sized to these EXPLICITLY (see donePane). LiquidSheet's surface
   does not give its child a bounded height, so a bare `flex: 1` has nothing to
   fill and the content collapses to the bottom instead of centring — the same
   trap that left the submit button outside the touchable area. */
const SNAP_FORM = 0.94;
const SNAP_DONE = 0.46;

const THEME_OPTS = [
  { value: "loved", label: "Loved it", emoji: "😍" },
  { value: "liked", label: "Liked it", emoji: "🙂" },
  { value: "neutral", label: "Neutral", emoji: "😐" },
  { value: "disliked", label: "Didn't like it", emoji: "🙁" },
];

const BUILD_NEXT_OPTS = [
  { value: "private_swaps", label: "Private Swaps" },
  { value: "private_prediction_markets", label: "Private Prediction Markets" },
  { value: "private_memecoin_launchpad", label: "Private Memecoin Launchpad" },
  { value: "private_dapps", label: "Private dApps" },
  { value: "more_chains", label: "More Chains" },
  { value: "ai_assistant", label: "AI Assistant" },
];

const RECOMMEND_OPTS = [
  { value: "definitely", label: "Definitely" },
  { value: "probably", label: "Probably" },
  { value: "maybe", label: "Maybe" },
  { value: "probably_not", label: "Probably Not" },
  { value: "no", label: "No" },
];

export default function FeedbackModal({
  open,
  onClose,
  isNoid,
  walletAddress,
}: {
  open: boolean;
  onClose: () => void;
  isNoid: boolean;
  walletAddress: string;
}) {
  const t = themeTokens(isNoid);
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();

  const [view, setView] = useState<"form" | "done">("form");
  const [doneEmail, setDoneEmail] = useState("");

  const [setupEase, setSetupEase] = useState(0);
  const [uiUxRating, setUiUxRating] = useState(0);
  const [noidRating, setNoidRating] = useState(0);
  const [themeFeel, setThemeFeel] = useState("");
  const [confusing, setConfusing] = useState("");
  const [buildNext, setBuildNext] = useState<string[]>([]);
  const [nps, setNps] = useState(0);
  const [improve, setImprove] = useState("");
  const [recommend, setRecommend] = useState("");
  const [additional, setAdditional] = useState("");
  const [email, setEmail] = useState("");
  const [discord, setDiscord] = useState("");
  const [twitter, setTwitter] = useState("");

  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");

  /* Surface the already-submitted state rather than asking again. */
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void getFeedbackRecord().then((rec) => {
      if (alive && rec) {
        setDoneEmail(rec.email);
        setView("done");
      }
    });
    return () => {
      alive = false;
    };
  }, [open]);

  const toggleNext = useCallback((v: string) => {
    setBuildNext((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }, []);

  async function send() {
    if (!email.trim()) {
      setErr("Please enter your email so we can reach you for the airdrop.");
      return;
    }
    setSending(true);
    setErr("");

    const payload: FeedbackPayload = {
      email: email.trim(),
      mode: isNoid ? "noid" : "open",
      walletAddress,
    };
    /* Each field is added ONLY when answered — see the header. */
    if (setupEase) payload.setupEase = setupEase;
    if (uiUxRating) payload.uiUxRating = uiUxRating;
    if (noidRating) payload.noidRating = noidRating;
    if (nps) payload.primaryWalletNps = nps;
    if (themeFeel) payload.pirateTheme = themeFeel as FeedbackPayload["pirateTheme"];
    if (recommend) payload.recommend = recommend as FeedbackPayload["recommend"];
    if (buildNext.length) payload.buildNext = buildNext as FeedbackPayload["buildNext"];
    if (confusing.trim()) payload.confusing = confusing.trim();
    if (improve.trim()) payload.improve = improve.trim();
    if (additional.trim()) payload.additional = additional.trim();
    if (discord.trim()) payload.discord = discord.trim();
    if (twitter.trim()) payload.twitter = twitter.trim();

    try {
      await submitFeedback(payload);
      await markFeedbackSubmitted(email.trim());
      setDoneEmail(email.trim());
      setView("done");
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  }

  const ink = t.inkRgb;

  return (
    <LiquidSheet
      open={open}
      onClose={onClose}
      tone={isNoid ? "ink" : "cream"}
      snap={view === "done" ? SNAP_DONE : SNAP_FORM}
      scroll={false}>
      {view === "done" ? (
        <View
          style={[
            styles.donePane,
            { height: winH * SNAP_DONE, paddingBottom: insets.bottom + 26 },
          ]}>
          <Text style={styles.doneMark}>🎉</Text>
          <Text style={[styles.doneTitle, { color: t.ink }]}>Thank you.</Text>
          <Text style={[styles.doneBody, { color: rgba(ink, 0.62) }]}>
            Your feedback is in. We'll reach {doneEmail} when the airdrop opens.
          </Text>
          <CloudChip
            tone={isNoid ? "light" : "violet"}
            fullWidth
            lobeBase={26}
            onPress={onClose}
            contentStyle={styles.cta}>
            <Text style={[styles.ctaText, { color: isNoid ? "#2A1B54" : "#FFF" }]}>DONE</Text>
          </CloudChip>
        </View>
      ) : (
        <ScrollView
          /* flex, NOT an explicit height: pinning the height here stopped the
             form scrolling altogether. Only the DONE pane needs a fixed height,
             because it centres its content and has nothing to scroll. */
          style={styles.scroll}
          /* 30 was not enough: the chip's bounds ran to the very bottom of the
             screen, so its lower half sat UNDER the system gesture bar — taps
             there did nothing and swipes dismissed the sheet instead. A cloud
             chip also overflows its content box by about half a lobe, which is
             the rest of the gap. */
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.head}>
            <Text style={[styles.eyebrow, { color: rgba(ink, 0.5) }]}>
              {isNoid ? "NOID MODE" : "OPEN MODE"}
            </Text>
            <Text style={[styles.title, { color: t.ink }]}>Help shape Menoid</Text>
            <Text style={[styles.sub, { color: rgba(ink, 0.6) }]}>
              A minute of feedback steers the whole thing.
            </Text>
          </View>

          <Question n={1} title="How easy was it to set up Menoid?" ink={ink}>
            <Stars value={setupEase} onChange={setSetupEase} ink={ink} />
          </Question>

          <Question n={2} title="How would you rate the overall UI / UX?" ink={ink}>
            <Stars value={uiUxRating} onChange={setUiUxRating} ink={ink} />
          </Question>

          <Question n={3} title="How would you rate Noid (private) mode?" ink={ink}>
            <Stars value={noidRating} onChange={setNoidRating} ink={ink} />
          </Question>

          <Question
            n={4}
            title="Did the purple cloudy theme make the wallet more enjoyable?"
            ink={ink}>
            <Choices
              options={THEME_OPTS}
              selected={themeFeel ? [themeFeel] : []}
              onSelect={setThemeFeel}
              ink={ink}
              accent={t.accentRgb}
            />
          </Question>

          <Question n={5} title="Was anything confusing while using Menoid?" ink={ink}>
            <Note value={confusing} onChange={setConfusing} placeholder="Tell us what tripped you up…" ink={ink} />
          </Question>

          <Question
            n={6}
            title="Which feature would you like us to build next?"
            hint="Select all that apply"
            ink={ink}>
            <Choices
              options={BUILD_NEXT_OPTS}
              selected={buildNext}
              onSelect={toggleNext}
              ink={ink}
              accent={t.accentRgb}
            />
          </Question>

          <Question
            n={7}
            title="How likely are you to use Menoid as your primary wallet once it's live?"
            hint="1 = unlikely · 10 = absolutely"
            ink={ink}>
            <Scale10 value={nps} onChange={setNps} ink={ink} accent={t.accentRgb} />
          </Question>

          <Question n={8} title="What is one thing you would improve?" ink={ink}>
            <Note value={improve} onChange={setImprove} placeholder="One improvement that would matter most…" ink={ink} />
          </Question>

          <Question n={9} title="Would you recommend Menoid to a friend?" ink={ink}>
            <Choices
              options={RECOMMEND_OPTS}
              selected={recommend ? [recommend] : []}
              onSelect={setRecommend}
              ink={ink}
              accent={t.accentRgb}
            />
          </Question>

          <Question n={10} title="Any additional feedback?" ink={ink}>
            <Note value={additional} onChange={setAdditional} placeholder="Anything else on your mind…" ink={ink} />
          </Question>

          {/* ── Stay in touch ── */}
          <View style={[styles.card, { backgroundColor: rgba(ink, 0.05), borderColor: rgba(ink, 0.12) }]}>
            <Text style={[styles.cardTitle, { color: t.ink }]}>Stay in touch</Text>

            <Label ink={ink} required>Email</Label>
            <TextInput
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setErr("");
              }}
              placeholder="you@example.com"
              placeholderTextColor={rgba(ink, 0.3)}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              style={[styles.input, { color: t.ink, borderColor: rgba(ink, 0.14), backgroundColor: rgba(ink, 0.04) }]}
            />

            <View style={[styles.airdrop, { backgroundColor: "rgba(232,174,58,0.12)", borderColor: "rgba(232,174,58,0.3)" }]}>
              <Text style={styles.airdropMark}>🪙</Text>
              <Text style={[styles.airdropText, { color: rgba(ink, 0.66) }]}>
                After v3, this email will receive an airdrop email to claim rewards like USDC and
                Foundation Crew badges.
              </Text>
            </View>

            <Label ink={ink}>Discord Username</Label>
            <TextInput
              value={discord}
              onChangeText={setDiscord}
              placeholder="optional"
              placeholderTextColor={rgba(ink, 0.3)}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { color: t.ink, borderColor: rgba(ink, 0.14), backgroundColor: rgba(ink, 0.04) }]}
            />

            <Label ink={ink}>X (Twitter) Username</Label>
            <TextInput
              value={twitter}
              onChangeText={setTwitter}
              placeholder="optional"
              placeholderTextColor={rgba(ink, 0.3)}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { color: t.ink, borderColor: rgba(ink, 0.14), backgroundColor: rgba(ink, 0.04) }]}
            />
          </View>

          {!!err && <Text style={styles.err}>{err}</Text>}

          <View style={styles.submitBay}>
            <CloudChip
              tone={isNoid ? "light" : "violet"}
              fullWidth
              lobeBase={26}
              disabled={sending}
              onPress={send}
              contentStyle={styles.cta}>
              {sending ? (
                <ActivityIndicator size="small" color={isNoid ? "#2A1B54" : "#FFF"} />
              ) : (
                <Text style={[styles.ctaText, { color: isNoid ? "#2A1B54" : "#FFF" }]}>
                  SUBMIT FEEDBACK
                </Text>
              )}
            </CloudChip>
          </View>
        </ScrollView>
      )}
    </LiquidSheet>
  );
}

/* ───────────────────────── pieces ───────────────────────── */

const Question = memo(function Question({
  n,
  title,
  hint,
  ink,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  ink: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.q}>
      <Text style={[styles.qTitle, { color: rgba(ink, 0.9) }]}>
        <Text style={{ color: rgba(ink, 0.4) }}>{n}. </Text>
        {title}
      </Text>
      {!!hint && <Text style={[styles.qHint, { color: rgba(ink, 0.45) }]}>{hint}</Text>}
      <View style={styles.qBody}>{children}</View>
    </View>
  );
});

function Stars({
  value,
  onChange,
  ink,
}: {
  value: number;
  onChange: (n: number) => void;
  ink: string;
}) {
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((i) => {
        const on = i <= value;
        return (
          <Pressable key={i} onPress={() => onChange(i)} hitSlop={6} style={styles.star}>
            <Svg width={26} height={26} viewBox="0 0 24 24">
              <Path
                d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.45l-5.81 3.05 1.11-6.47L2.6 9.45l6.5-.95z"
                fill={on ? "#F5C451" : "none"}
                stroke={on ? "#F5C451" : rgba(ink, 0.28)}
                strokeWidth={1.4}
                strokeLinejoin="round"
              />
            </Svg>
          </Pressable>
        );
      })}
    </View>
  );
}

function Scale10({
  value,
  onChange,
  ink,
  accent,
}: {
  value: number;
  onChange: (n: number) => void;
  ink: string;
  accent: string;
}) {
  return (
    <View style={styles.scaleRow}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const on = n === value;
        return (
          <Pressable
            key={n}
            onPress={() => onChange(n)}
            style={[
              styles.scaleCell,
              {
                backgroundColor: on ? rgba(accent, 0.9) : rgba(ink, 0.05),
                borderColor: on ? rgba(accent, 1) : rgba(ink, 0.12),
              },
            ]}>
            <Text style={[styles.scaleText, { color: on ? "#FFF" : rgba(ink, 0.6) }]}>{n}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Choices({
  options,
  selected,
  onSelect,
  ink,
  accent,
}: {
  options: { value: string; label: string; emoji?: string }[];
  selected: string[];
  onSelect: (v: string) => void;
  ink: string;
  accent: string;
}) {
  return (
    <View style={styles.choiceWrap}>
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <Pressable
            key={o.value}
            onPress={() => onSelect(o.value)}
            style={[
              styles.choice,
              {
                backgroundColor: on ? rgba(accent, 0.16) : rgba(ink, 0.05),
                borderColor: on ? rgba(accent, 0.6) : rgba(ink, 0.12),
              },
            ]}>
            {!!o.emoji && <Text style={styles.choiceEmoji}>{o.emoji}</Text>}
            <Text style={[styles.choiceText, { color: on ? rgba(ink, 0.95) : rgba(ink, 0.65) }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Note({
  value,
  onChange,
  placeholder,
  ink,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  ink: string;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={rgba(ink, 0.3)}
      multiline
      style={[
        styles.note,
        { color: rgba(ink, 0.9), borderColor: rgba(ink, 0.12), backgroundColor: rgba(ink, 0.04) },
      ]}
    />
  );
}

function Label({
  children,
  ink,
  required,
}: {
  children: React.ReactNode;
  ink: string;
  required?: boolean;
}) {
  return (
    <Text style={[styles.label, { color: rgba(ink, 0.55) }]}>
      {children}
      {required && <Text style={{ color: "#E8AE3A" }}> *</Text>}
    </Text>
  );
}

const styles = StyleSheet.create({
  /* flex:1 IS LOAD-BEARING. LiquidSheet gives this a fixed-height surface, and
     a ScrollView without flex sizes to its CONTENT — so a form this long
     overflowed the sheet's clip bounds. The submit button still painted, but it
     sat outside the touchable area and taps fell through to whatever was under
     it. Visible but dead is the worst failure mode there is. */
  scroll: { flex: 1, paddingHorizontal: 20 },
  head: { paddingTop: 10, paddingBottom: 18, alignItems: "center" },
  eyebrow: { fontFamily: FONT.body, fontSize: 9, letterSpacing: 3.4 },
  title: { marginTop: 6, fontFamily: FONT.roundBold, fontSize: 21 },
  sub: { marginTop: 6, fontFamily: FONT.body, fontSize: 12, textAlign: "center" },

  q: { marginBottom: 20 },
  qTitle: { fontFamily: FONT.body, fontSize: 13, lineHeight: 19 },
  qHint: { marginTop: 3, fontFamily: FONT.body, fontSize: 11 },
  qBody: { marginTop: 10 },

  starRow: { flexDirection: "row", gap: 10 },
  star: { padding: 2 },

  scaleRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  scaleCell: {
    width: 32,
    height: 34,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scaleText: { fontFamily: FONT.mono, fontSize: 12 },

  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  choiceEmoji: { fontSize: 13 },
  choiceText: { fontFamily: FONT.body, fontSize: 12 },

  note: {
    minHeight: 74,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontFamily: FONT.body,
    fontSize: 12.5,
    lineHeight: 18,
    textAlignVertical: "top",
  },

  card: { marginTop: 8, borderRadius: 20, borderWidth: 1, padding: 16 },
  cardTitle: { fontFamily: FONT.body, fontSize: 13, fontWeight: "600", marginBottom: 12 },
  label: { fontFamily: FONT.body, fontSize: 11, marginBottom: 6, marginTop: 10 },
  input: {
    height: 44,
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 13,
    fontFamily: FONT.body,
    fontSize: 13,
  },
  airdrop: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  airdropMark: { fontSize: 13 },
  airdropText: { flex: 1, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 },

  err: {
    marginTop: 14,
    fontFamily: FONT.body,
    fontSize: 12,
    color: "#E5604D",
    textAlign: "center",
  },
  submitBay: { marginTop: 22 },
  cta: { alignItems: "center", justifyContent: "center", paddingVertical: 15 },
  ctaText: { fontFamily: FONT.body, fontSize: 12, letterSpacing: 2 },

  donePane: { alignItems: "center", justifyContent: "center", paddingHorizontal: 30 },
  doneMark: { fontSize: 40 },
  doneTitle: { marginTop: 14, fontFamily: FONT.roundBold, fontSize: 22 },
  doneBody: {
    marginTop: 8,
    marginBottom: 26,
    fontFamily: FONT.body,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
});
