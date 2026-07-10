// Centralized AWS configuration, sourced from Vite environment variables.
// Copy .env.example to .env and fill these in with the CDK stack outputs
// (see docs/DEPLOYMENT.md).

export const AWS_CONFIG = {
  apiUrl: (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, ''),
  region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
  cognito: {
    userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
    clientId: import.meta.env.VITE_COGNITO_CLIENT_ID || '',
  },
};

// When Cognito isn't configured yet (e.g. running the old local FastAPI
// backend during early development), auth falls back to the original
// localStorage mock so the UI keeps working out of the box.
export const isCognitoConfigured = (): boolean =>
  Boolean(AWS_CONFIG.cognito.userPoolId && AWS_CONFIG.cognito.clientId);
