// PreSignUp trigger — links Google OAuth and email/password accounts that
// share the same email address so both methods map to the same Cognito sub.
//
// Direction 1 — Google signs up, native account already exists:
//   AdminLinkProviderForUser merges the Google identity into the existing
//   native user. Both sign-in methods work and resolve to the same sub.
//
// Direction 2 — Email/password signs up, Google account already exists:
//   Block the sign-up with a clear error so the UI can redirect to Google.

const {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminLinkProviderForUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const cognito = new CognitoIdentityProviderClient({});

const FEDERATED_PREFIXES = ['Google_', 'Facebook_', 'LoginWithAmazon_', 'SignInWithApple_'];

function isFederated(username) {
  return FEDERATED_PREFIXES.some(p => username.startsWith(p));
}

async function listByEmail(userPoolId, email) {
  const resp = await cognito.send(new ListUsersCommand({
    UserPoolId: userPoolId,
    Filter: `email = "${email}"`,
  }));
  return resp.Users ?? [];
}

exports.handler = async (event) => {
  const { triggerSource, userPoolId } = event;
  const email = event.request.userAttributes.email;

  // ── Direction 1: Google (external provider) signs up ─────────────────────
  // Invite-only: only allow Google sign-in if a native account was pre-created
  // by an admin. This enforces the invite flow even for OAuth users.
  if (triggerSource === 'PreSignUp_ExternalProvider') {
    if (!email) throw new Error('Email is required for sign-in.');

    const users = await listByEmail(userPoolId, email);
    const nativeUser = users.find(u => !isFederated(u.Username));

    if (!nativeUser) {
      throw new Error('Access denied. Please request an invite at autoaw.app/demo');
    }

    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;

    try {
      const underscoreIdx = event.userName.indexOf('_');
      const rawPrefix    = event.userName.slice(0, underscoreIdx);
      const providerName = rawPrefix.charAt(0).toUpperCase() + rawPrefix.slice(1);
      const providerSub  = event.userName.slice(underscoreIdx + 1);

      await cognito.send(new AdminLinkProviderForUserCommand({
        UserPoolId: userPoolId,
        DestinationUser: {
          ProviderName:           'Cognito',
          ProviderAttributeValue: nativeUser.Username,
        },
        SourceUser: {
          ProviderName:           providerName,
          ProviderAttributeName:  'Cognito_Subject',
          ProviderAttributeValue: providerSub,
        },
      }));
      console.log(`[pre-signup] linked ${providerName} → native user "${nativeUser.Username}" (${email})`);
    } catch (err) {
      console.error('[pre-signup] account linking failed:', err);
      throw err;
    }

    return event;
  }

  // ── Direction 2: Native email/password signs up ───────────────────────────
  if (triggerSource === 'PreSignUp_SignUp' && email) {
    try {
      const users = await listByEmail(userPoolId, email);
      const federatedUser = users.find(u => isFederated(u.Username));

      if (federatedUser) {
        const providerName = FEDERATED_PREFIXES
          .find(p => federatedUser.Username.startsWith(p))
          ?.replace('_', '') ?? 'Google';
        throw new Error(
          `An account with this email already exists via ${providerName}. ` +
          `Please sign in with ${providerName} instead.`
        );
      }
    } catch (err) {
      if (err.message?.includes('Please sign in with')) throw err;
      console.error('[pre-signup] federated check failed:', err);
    }
  }

  return event;
};
