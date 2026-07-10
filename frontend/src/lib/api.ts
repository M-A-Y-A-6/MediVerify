// Centralized API client for the MediVerify backend (API Gateway + Lambda).
// Replaces the inline fetch() calls previously scattered through App.tsx.
// Response shapes are unchanged from the original FastAPI backend, so
// existing UI rendering code needs no changes.
import { AWS_CONFIG } from './awsConfig';
import { getCurrentIdToken } from './auth';
import { isCognitoConfigured } from './awsConfig';

async function authHeaders(): Promise<Record<string, string>> {
  if (!isCognitoConfigured()) return {};
  const token = await getCurrentIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function verifyDocument(file: File) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${AWS_CONFIG.apiUrl}/verify`, {
    method: 'POST',
    headers: await authHeaders(),
    body: formData,
  });

  if (!response.ok) {
    const errDetail = await response.json().catch(() => ({ detail: 'Failed to process document image' }));
    throw new Error(errDetail.detail || 'Server returned verification error');
  }

  return response.json();
}

export async function fetchFlaggedEntries() {
  const response = await fetch(`${AWS_CONFIG.apiUrl}/flagged`, {
    headers: await authHeaders(),
  });
  if (!response.ok) throw new Error('Failed to fetch flagged logs');
  return response.json();
}

export async function sendChatMessage(message: string): Promise<string> {
  const response = await fetch(`${AWS_CONFIG.apiUrl}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    throw new Error('Chat assistant is currently unavailable.');
  }

  const data = await response.json();
  return data.reply as string;
}
