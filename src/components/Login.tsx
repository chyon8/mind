import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { signIn } from '@/lib/supabase';
import { colors, fonts, noFocusRing, rounded, spacing, type } from '@/lib/theme';

// 사용자는 한 명 (SPEC §2-5). 회원가입·비번찾기 없음 — 계정은 대시보드에서 만든다.
// 세션은 AsyncStorage에 남으므로 기기당 딱 한 번 보는 화면이다.
export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const ready = email.trim() !== '' && password !== '' && !busy;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setFailed(false);
    try {
      await signIn(email.trim(), password);
      // 성공하면 onAuthChange가 루트를 다시 그린다
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.wordmark}>MIND</Text>

        <TextInput
          style={[styles.input, noFocusRing]}
          value={email}
          onChangeText={setEmail}
          placeholder="이메일"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          keyboardAppearance="dark"
          textContentType="username"
        />
        <TextInput
          style={[styles.input, noFocusRing]}
          value={password}
          onChangeText={setPassword}
          placeholder="비밀번호"
          placeholderTextColor={colors.faint}
          secureTextEntry
          keyboardAppearance="dark"
          textContentType="password"
          onSubmitEditing={submit}
          returnKeyType="go"
        />

        {failed && <Text style={styles.error}>들어가지 못했다</Text>}

        <Pressable onPress={submit} disabled={!ready} style={[styles.btn, !ready && styles.btnOff]}>
          <Text style={styles.btnLabel}>{busy ? '여는 중…' : '들어가기'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: { gap: spacing.sm, alignSelf: 'center', width: '100%', maxWidth: 360 },
  wordmark: {
    ...type.monoEyebrow,
    color: colors.mute,
    fontFamily: fonts.mono,
    letterSpacing: 4,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  input: {
    ...type.bodyLg,
    color: colors.ink,
    fontFamily: fonts.sans,
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  error: { ...type.bodyMd, color: colors.error, fontFamily: fonts.sans, textAlign: 'center' },
  btn: {
    backgroundColor: colors.ink,
    borderRadius: rounded.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  btnOff: { opacity: 0.35 },
  btnLabel: { ...type.bodyLg, color: colors.onInk, fontFamily: fonts.sansMedium },
});
