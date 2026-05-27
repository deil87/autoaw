"use client";
import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from "amazon-cognito-identity-js";

interface AuthUser {
  email: string;
  idToken: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendCode: (email: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function makePool(): CognitoUserPool {
  return new CognitoUserPool({
    UserPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
    ClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const pool = makePool();
    const cognitoUser = pool.getCurrentUser();
    if (!cognitoUser) {
      setLoading(false);
      return;
    }
    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (!err && session?.isValid()) {
        setUser({ email: cognitoUser.getUsername(), idToken: session.getIdToken().getJwtToken() });
      }
      setLoading(false);
    });
  }, []);

  const signIn = useCallback((email: string, password: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const pool = makePool();
      const cognitoUser = new CognitoUser({ Username: email, Pool: pool });
      const authDetails = new AuthenticationDetails({ Username: email, Password: password });
      cognitoUser.authenticateUser(authDetails, {
        onSuccess: (session: CognitoUserSession) => {
          setUser({ email, idToken: session.getIdToken().getJwtToken() });
          resolve();
        },
        onFailure: reject,
      });
    });
  }, []);

  const signUp = useCallback((email: string, password: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const pool = makePool();
      pool.signUp(email, password, [], [], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }, []);

  const confirmSignUp = useCallback((email: string, code: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const pool = makePool();
      const cognitoUser = new CognitoUser({ Username: email, Pool: pool });
      cognitoUser.confirmRegistration(code, true, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }, []);

  const resendCode = useCallback((email: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const pool = makePool();
      const cognitoUser = new CognitoUser({ Username: email, Pool: pool });
      cognitoUser.resendConfirmationCode((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }, []);

  const signOut = useCallback(() => {
    makePool().getCurrentUser()?.signOut();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, confirmSignUp, resendCode, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
