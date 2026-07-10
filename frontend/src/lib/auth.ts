// Amazon Cognito authentication helpers.
//
// Wraps amazon-cognito-identity-js so App.tsx's existing handleLogin /
// handleSignUp / handleLogout functions can call a small, promise-based
// API without changing any screens, fields, or layout. If Cognito isn't
// configured (see awsConfig.ts), callers should fall back to the original
// localStorage-only mock behavior.
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  type ICognitoUserPoolData,
} from 'amazon-cognito-identity-js';
import { AWS_CONFIG } from './awsConfig';

let pool: CognitoUserPool | null = null;

function getPool(): CognitoUserPool {
  if (!pool) {
    const poolData: ICognitoUserPoolData = {
      UserPoolId: AWS_CONFIG.cognito.userPoolId,
      ClientId: AWS_CONFIG.cognito.clientId,
    };
    pool = new CognitoUserPool(poolData);
  }
  return pool;
}

export interface AuthedUser {
  name: string;
  email: string;
  idToken: string;
}

/** Registers a new user in the Cognito User Pool. Triggers an email verification code. */
export function cognitoSignUp(name: string, email: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const attributeList = [
      new CognitoUserAttribute({ Name: 'email', Value: email }),
      new CognitoUserAttribute({ Name: 'name', Value: name }),
    ];
    getPool().signUp(email, password, attributeList, [], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/** Confirms a newly signed-up user using the code emailed by Cognito. */
export function cognitoConfirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getPool() });
    user.confirmRegistration(code, true, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/** Re-sends the confirmation code, e.g. if the user didn't receive the first one. */
export function cognitoResendConfirmationCode(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getPool() });
    user.resendConfirmationCode((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/** Signs a user in and returns their ID token (used as a Bearer token for API calls). */
export function cognitoSignIn(email: string, password: string): Promise<AuthedUser> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getPool() });
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });

    user.authenticateUser(authDetails, {
      onSuccess: (session) => {
        const idToken = session.getIdToken();
        const payload = idToken.decodePayload() as Record<string, string>;
        resolve({
          name: payload.name || email,
          email: payload.email || email,
          idToken: idToken.getJwtToken(),
        });
      },
      onFailure: (err) => reject(err),
    });
  });
}

/** Signs the current Cognito user out locally. */
export function cognitoSignOut(): void {
  const user = getPool().getCurrentUser();
  if (user) user.signOut();
}

/** Returns a valid ID token for the currently signed-in user, refreshing if needed. */
export function getCurrentIdToken(): Promise<string | null> {
  return new Promise((resolve) => {
    const user = getPool().getCurrentUser();
    if (!user) return resolve(null);
    user.getSession((err: Error | null, session: any) => {
      if (err || !session || !session.isValid()) return resolve(null);
      resolve(session.getIdToken().getJwtToken());
    });
  });
}
