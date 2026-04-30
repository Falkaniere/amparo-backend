const axios = require('axios');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Envia uma notificação push via Expo Push API
 * @param {string} token - Expo push token do destinatário
 * @param {Object} opts  - { title, body, data }
 */
async function sendPushNotification(token, { title, body, data = {} }) {
  if (!token || !token.startsWith('ExponentPushToken')) {
    console.warn('[Push] Token inválido ou ausente:', token);
    return;
  }

  try {
    const response = await axios.post(
      EXPO_PUSH_URL,
      {
        to:       token,
        title,
        body,
        data,
        sound:    'default',
        priority: 'high'
      },
      {
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${process.env.EXPO_ACCESS_TOKEN}`
        }
      }
    );

    const result = response.data?.data;
    if (result?.status === 'error') {
      console.error('[Push] Erro ao enviar:', result.message);
    }
  } catch (err) {
    console.error('[Push] Falha na requisição:', err.message);
  }
}

module.exports = { sendPushNotification };
