"use client";
import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import {
  signIn as amplifySignIn,
  signUp as amplifySignUp,
  signOut as amplifySignOut,
  confirmSignUp as amplifyConfirmSignUp,
  resendSignUpCode,
  signInWithRedirect,
  fetchAuthSession,
} from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { configureAmplify } from "@/lib/amplify-config";

export interface AuthUser {
  email: string;
  idToken: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  signUp: (email: string, password: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendCode: (email: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadUser(): Promise<AuthUser | null> {
  try {
    const session = await fetchAuthSession();
    if (!session.tokens?.idToken) return null;
    const payload = session.tokens.idToken.payload;
    const email = (payload["email"] as string | undefined) ?? "";
    return { email, idToken: session.tokens.idToken.toString() };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Must run synchronously before any effects so Amplify is configured
  // before it tries to process the ?code=&state= OAuth callback in the URL.
  if (typeof window !== "undefined") configureAmplify();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUser().then(u => {
      setUser(u);
      setLoading(false);
    });

    // Update state after OAuth redirect or sign-out from any tab
    const unsub = Hub.listen("auth", ({ payload }) => {
      if (payload.event === "signInWithRedirect") {
        loadUser().then(setUser);
      }
      if (payload.event === "signedOut") {
        setUser(null);
      }
    });

    return unsub;
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ needsConfirmation: boolean }> => {
      const result = await amplifySignIn({ username: email, password });
      if (result.nextStep?.signInStep === "CONFIRM_SIGN_UP") {
        return { needsConfirmation: true };
      }
      if (result.isSignedIn) {
        const u = await loadUser();
        setUser(u);
      }
      return { needsConfirmation: false };
    },
    []
  );

  const signUp = useCallback(async (email: string, password: string): Promise<void> => {
    await amplifySignUp({
      username: email,
      password,
      options: { userAttributes: { email } },
    });
  }, []);

  const confirmSignUp = useCallback(
    async (email: string, code: string): Promise<void> => {
      await amplifyConfirmSignUp({ username: email, confirmationCode: code });
    },
    []
  );

  const resendCode = useCallback(async (email: string): Promise<void> => {
    await resendSignUpCode({ username: email });
  }, []);

  const doSignInWithGoogle = useCallback(async (): Promise<void> => {
    try { await amplifySignOut(); } catch { /* no session to clear */ }
    await signInWithRedirect({ provider: "Google" });
  }, []);

  const doSignOut = useCallback(async (): Promise<void> => {
    await amplifySignOut();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signIn,
        signUp,
        confirmSignUp,
        resendCode,
        signInWithGoogle: doSignInWithGoogle,
        signOut: doSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
