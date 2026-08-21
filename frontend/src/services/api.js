import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/+$/, '');

/**
 * `withCredentials` is what carries the httpOnly session cookie. The token is
 * never stored in localStorage, so an XSS bug cannot read it.
 */
const client = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

/** Turns any axios failure into a plain Error carrying the server's message. */
function toError(err) {
  const payload = err?.response?.data;
  const message =
    payload?.error?.message ||
    (err.code === 'ECONNABORTED' ? 'The request timed out.' : null) ||
    (err.request && !err.response ? 'Cannot reach the server. Is the backend running?' : null) ||
    err.message ||
    'Something went wrong.';

  const error = new Error(message);
  error.status = err?.response?.status ?? 0;
  error.details = payload?.error?.details;
  return error;
}

async function request(promise) {
  try {
    const response = await promise;
    return response.data?.data ?? response.data;
  } catch (err) {
    throw toError(err);
  }
}

export const authApi = {
  /** Full-page redirect into the server-side Google OAuth flow. */
  loginUrl: () => `${API_URL}/auth/google`,
  me: () => request(client.get('/auth/me')),
  logout: () => request(client.post('/auth/logout')),
};

export const senderApi = {
  list: () => request(client.get('/senders')),
  create: (payload) => request(client.post('/senders', payload)),
};

export const emailApi = {
  scheduled: (params) => request(client.get('/emails/scheduled', { params })),
  sent: (params) => request(client.get('/emails/sent', { params })),
  stats: () => request(client.get('/emails/stats')),
  cancel: (id) => request(client.post(`/emails/${id}/cancel`)),

  /** Server-side parse of an uploaded list; the browser preview is only a hint. */
  parseRecipients: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request(
      client.post('/emails/parse-recipients', form, { headers: { 'Content-Type': undefined } })
    );
  },

  schedule: (payload, idempotencyKey) =>
    request(
      client.post('/emails/schedule', payload, {
        headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      })
    ),
};

export const campaignApi = {
  list: (params) => request(client.get('/campaigns', { params })),
  get: (id) => request(client.get(`/campaigns/${id}`)),
  cancel: (id) => request(client.post(`/campaigns/${id}/cancel`)),
};

export const healthApi = {
  check: () => request(client.get('/health')),
};

export { API_URL };
