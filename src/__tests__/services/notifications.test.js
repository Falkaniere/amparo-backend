jest.mock('axios', () => ({ post: jest.fn() }));

const axios = require('axios');
const { sendPushNotification } = require('#services/notifications');

describe('sendPushNotification', () => {
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('does not call the Expo API when the token is missing', async () => {
    await sendPushNotification(undefined, { title: 't', body: 'b' });
    expect(axios.post).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('does not call the Expo API for a non-Expo token', async () => {
    await sendPushNotification('not-a-real-token', { title: 't', body: 'b' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('posts to the Expo API with the correct payload for a valid token', async () => {
    axios.post.mockResolvedValue({ data: { data: { status: 'ok' } } });
    await sendPushNotification('ExponentPushToken[abc]', {
      title: 'Olá', body: 'Mensagem', data: { request_id: 'r1' },
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, payload] = axios.post.mock.calls[0];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(payload).toMatchObject({
      to: 'ExponentPushToken[abc]',
      title: 'Olá',
      body: 'Mensagem',
      data: { request_id: 'r1' },
      priority: 'high',
    });
  });

  it('logs an error when the Expo API returns status "error"', async () => {
    axios.post.mockResolvedValue({ data: { data: { status: 'error', message: 'DeviceNotRegistered' } } });
    await sendPushNotification('ExponentPushToken[abc]', { title: 't', body: 'b' });
    expect(errorSpy).toHaveBeenCalledWith('[Push] Erro ao enviar:', 'DeviceNotRegistered');
  });

  it('swallows network errors without throwing', async () => {
    axios.post.mockRejectedValue(new Error('network down'));
    await expect(
      sendPushNotification('ExponentPushToken[abc]', { title: 't', body: 'b' }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
