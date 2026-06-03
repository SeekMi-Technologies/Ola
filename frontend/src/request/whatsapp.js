import request from '@/request/request';

// Goes through the src/request/ layer (request.raw = shared axios, no toast
// handlers) so the caller can map HTTP status to localized UI — 503 (gateway)
// vs other failures.
export const waLogin = () => request.raw.post('whatsapp/login');
export const waStatus = () => request.raw.get('whatsapp/status');
export const waLogout = () => request.raw.delete('whatsapp');
