import axios from 'axios';
import { BASE_URL } from '../../config';
import { supabase } from '../supabase';

export const api = axios.create({
  baseURL: BASE_URL,
});

let pendingRefresh = null;

const refreshSessionOnce = () => {
  if (!pendingRefresh) {
    pendingRefresh = supabase.auth.refreshSession().finally(() => {
      pendingRefresh = null;
    });
  }
  return pendingRefresh;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Supabase's own session bootstrap/refresh can hit a transient network error
// (e.g. device just woke up, brief connectivity blip), which surfaces here as
// an `error` with no session even though the user is actually logged in. Only
// retry that case — if Supabase cleanly reports no session (no error), the
// user is genuinely signed out and retrying won't help.
const AUTH_SESSION_RETRIES = 2;
const AUTH_SESSION_RETRY_DELAY_MS = 500;

const getAuthenticatedSession = async ({ refresh = false } = {}) => {
  let lastError = null;

  for (let attempt = 0; attempt <= AUTH_SESSION_RETRIES; attempt += 1) {
    const {
      data: { session },
      error,
    } = await (refresh ? refreshSessionOnce() : supabase.auth.getSession());

    if (session?.access_token) {
      return session;
    }

    if (!error) {
      break;
    }

    lastError = error;
    if (attempt < AUTH_SESSION_RETRIES) {
      await delay(AUTH_SESSION_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('No Supabase session');
};

const withAuthHeader = (config, accessToken) => {
  config.headers = {
    ...(config.headers ?? {}),
    Authorization: `Bearer ${accessToken}`,
  };

  return config;
};

api.interceptors.request.use(async (config) => {
  const session = await getAuthenticatedSession();
  return withAuthHeader(config, session.access_token);
});

const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 600;

api.interceptors.response.use(undefined, async (error) => {
  const originalRequest = error.config;

  if (error.response?.status === 401 && originalRequest && !originalRequest._authRetry) {
    originalRequest._authRetry = true;
    const session = await getAuthenticatedSession({ refresh: true });
    return api(withAuthHeader(originalRequest, session.access_token));
  }

  if (RETRYABLE_STATUSES.has(error.response?.status) && originalRequest) {
    originalRequest._retryCount = (originalRequest._retryCount ?? 0) + 1;
    if (originalRequest._retryCount <= MAX_RETRIES) {
      await delay(RETRY_DELAY_MS * originalRequest._retryCount);
      return api(originalRequest);
    }
  }

  return Promise.reject(error);
});
