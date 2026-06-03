import axios from 'axios';

// Reuses the global axios instance configured in request/request.js (baseURL
// ends with /api/, withCredentials). Raw calls — the caller maps success/error
// to localized UI so it can distinguish 503 (gateway) from other failures.
export const waLogin = () => axios.post('whatsapp/login').then((res) => res.data);
export const waStatus = () => axios.get('whatsapp/status').then((res) => res.data);
export const waLogout = () => axios.delete('whatsapp').then((res) => res.data);
